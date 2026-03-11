/**
 * Asurada HTTP API Server
 *
 * Minimal, generic API for observing and interacting with an agent.
 * Routes:
 *   GET  /health        — health check
 *   GET  /status        — agent status
 *   GET  /context       — all perception data
 *   GET  /api/events    — SSE real-time event stream
 *   POST /api/message   — send a message to the agent
 *   GET  /api/messages  — recent messages
 */

import express from 'express';
import type { Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Agent } from '../runtime.js';
import type { ServerOptions, Message, AgentStatus, HealthResponse } from './types.js';
import { slog } from '../logging/index.js';

const VERSION = '0.1.0';

export interface AgentServer {
  /** The Express app (for custom route extensions) */
  readonly app: express.Express;
  /** The underlying HTTP server */
  readonly server: Server;
  /** The port the server is listening on */
  readonly port: number;
  /** Stop the server */
  close(): Promise<void>;
}

/**
 * Start the HTTP API server for an agent.
 *
 *   const server = await startServer(agent, { port: 3000 });
 */
export async function startServer(
  agent: Agent,
  options?: ServerOptions,
): Promise<AgentServer> {
  const app = express();
  const port = options?.port ?? parseInt(process.env.PORT ?? '3000', 10);
  const startTime = Date.now();

  // --- Middleware ---
  app.use(express.json({ limit: '1mb' }));

  // CORS
  const corsOrigin = options?.corsOrigin ?? '*';
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Auth middleware (optional)
  const apiKey = options?.apiKey ?? process.env.ASURADA_API_KEY;
  if (apiKey) {
    app.use((req, res, next) => {
      // Skip auth for health check
      if (req.path === '/health') return next();

      const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
        ?? (req.query.key as string | undefined);
      if (token !== apiKey) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });
  }

  // --- Messages storage (file-based) ---
  const messagesFile = path.join(
    agent.config.paths?.data
      ? path.resolve(agent.config.paths.data)
      : path.join(process.cwd(), '.asurada'),
    'messages.jsonl',
  );

  function appendMessage(msg: Message): void {
    const dir = path.dirname(messagesFile);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(messagesFile, JSON.stringify(msg) + '\n');
  }

  function readRecentMessages(limit = 50): Message[] {
    try {
      const content = fs.readFileSync(messagesFile, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines.slice(-limit).map(line => JSON.parse(line) as Message);
    } catch {
      return [];
    }
  }

  // --- Routes ---

  // Health check
  app.get('/health', (_req, res) => {
    const response: HealthResponse = {
      status: 'ok',
      uptime: Date.now() - startTime,
      version: VERSION,
    };
    res.json(response);
  });

  // Agent status
  app.get('/status', (_req, res) => {
    const laneStats = agent.lanes.stats();
    const status: AgentStatus = {
      agent: {
        name: agent.config.agent.name,
        instanceId: agent.instanceId,
        running: agent.running,
        uptime: Date.now() - startTime,
      },
      loop: agent.loop ? {
        running: agent.loop.isRunning,
        cycles: agent.loop.cycles,
      } : null,
      lanes: {
        running: laneStats.active,
        queued: laneStats.queued,
        completed: laneStats.completed,
      },
      perception: {
        plugins: agent.perception.getCachedResults().length,
        lastRun: null,  // TODO: track in PerceptionManager
      },
    };
    res.json(status);
  });

  // Perception context
  app.get('/context', (_req, res) => {
    const results = agent.perception.getCachedResults();
    const parts: string[] = [];
    for (const r of results) {
      if (r.output) {
        parts.push(`<${r.name}>\n${r.output}\n</${r.name}>`);
      }
    }
    res.json({ context: parts.join('\n\n') });
  });

  // SSE event stream
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Forward all events to SSE
    const handler = (event: { type: string; data?: unknown }) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    agent.events.on('*', handler);

    // Heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30_000);

    req.on('close', () => {
      agent.events.off('*', handler);
      clearInterval(heartbeat);
    });
  });

  // Send message to agent
  app.post('/api/message', (req, res) => {
    const { from, text, replyTo } = req.body as {
      from?: string;
      text?: string;
      replyTo?: string;
    };

    if (!from || !text) {
      res.status(400).json({ error: 'Missing required fields: from, text' });
      return;
    }

    // Generate message ID: YYYY-MM-DD-NNN
    const today = new Date().toISOString().slice(0, 10);
    const todayMessages = readRecentMessages(1000).filter(m => m.id.startsWith(today));
    const seq = String(todayMessages.length + 1).padStart(3, '0');
    const id = `${today}-${seq}`;

    // Extract mentions (@name)
    const mentionMatches = text.match(/@\w+/g);
    const mentions = mentionMatches?.map(m => m.slice(1)) ?? [];

    const message: Message = {
      id,
      from,
      text,
      replyTo,
      mentions,
      timestamp: new Date().toISOString(),
    };

    appendMessage(message);

    // Emit event so the loop can pick it up
    agent.events.emit('trigger:message', { message });

    slog('api', `Message ${id} from ${from}: ${text.slice(0, 80)}`);
    res.status(201).json({ id, timestamp: message.timestamp });
  });

  // Recent messages
  app.get('/api/messages', (req, res) => {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const messages = readRecentMessages(limit);
    res.json({ messages });
  });

  // --- Start server ---
  return new Promise<AgentServer>((resolve, reject) => {
    const server = app.listen(port, () => {
      slog('api', `HTTP API listening on port ${port}`);

      resolve({
        app,
        server,
        port,
        async close() {
          return new Promise<void>((res, rej) => {
            server.close(err => err ? rej(err) : res());
          });
        },
      });
    });

    server.on('error', reject);
  });
}
