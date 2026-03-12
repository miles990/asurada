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
 *   GET  /api/tasks     — list active tasks
 *   POST /api/tasks     — create a task
 *   PATCH /api/tasks/:id — update a task
 *   DELETE /api/tasks/:id — soft delete a task
 */

import express from 'express';
import type { Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Agent } from '../runtime.js';
import type { ServerOptions, Message, AgentStatus, HealthResponse } from './types.js';
import { slog } from '../logging/index.js';
import { TaskStore } from './task-store.js';
import type { CreateTaskInput, UpdateTaskInput } from './task-store.js';

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
  const port = options?.port ?? 3001;
  const startTime = Date.now();

  // --- Middleware ---
  app.use(express.json({ limit: '1mb' }));

  // CORS
  const corsOrigin = options?.corsOrigin ?? '*';
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Auth middleware (optional — set agent.apiKey in asurada.yaml)
  const apiKey = options?.apiKey;
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
  const dataDir = agent.config.paths?.data
    ? path.resolve(agent.config.paths.data)
    : path.join(process.cwd(), '.asurada');

  const messagesFile = path.join(dataDir, 'messages.jsonl');

  // --- Task store (JSONL event-sourced) ---
  const taskStore = new TaskStore(path.join(dataDir, 'tasks.jsonl'));

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
        lastRun: agent.perception.getStats()
          .reduce((latest: string | null, s) =>
            s.updatedAt && (!latest || s.updatedAt > latest) ? s.updatedAt : latest, null),
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

  // Memory search
  app.get('/api/memory/search', (req, res) => {
    const query = req.query.q as string;
    if (!query) {
      res.status(400).json({ error: 'Missing query parameter: q' });
      return;
    }
    const limit = parseInt(req.query.limit as string, 10) || 10;
    try {
      const results = agent.search.search(query, limit);
      res.json({ results, query });
    } catch {
      res.json({ results: [], query, error: 'Search unavailable' });
    }
  });

  // Memory index — query entries
  app.get('/api/index', async (req, res) => {
    try {
      const type = req.query.type as string | undefined;
      const tags = req.query.tags ? (req.query.tags as string).split(',') : undefined;
      const limit = parseInt(req.query.limit as string, 10) || 50;
      const entries = await agent.index.query({ type: type as import('../memory/index-types.js').CognitiveType, tags, limit });
      res.json({ entries, total: entries.length });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Index query failed' });
    }
  });

  // Memory index stats
  app.get('/api/index/stats', async (_req, res) => {
    try {
      const stats = await agent.index.stats();
      res.json(stats);
    } catch {
      res.json({ total: 0, error: 'Index unavailable' });
    }
  });

  // Lanes status
  app.get('/api/lanes', (_req, res) => {
    const stats = agent.lanes.stats();
    const completed = agent.lanes.drain();
    // Put results back (drain is destructive, but we want to show them)
    res.json({
      ...stats,
      recentCompleted: completed.map(r => ({
        id: r.id,
        type: r.type,
        status: r.status,
        durationMs: r.durationMs,
        output: r.output?.slice(0, 500),
      })),
    });
  });

  // Perception plugin stats
  app.get('/api/perception', (_req, res) => {
    const results = agent.perception.getCachedResults();
    const plugins = results.map(r => ({
      name: r.name,
      // category from plugin config, not on result
      hasOutput: !!r.output,
      outputLength: r.output?.length ?? 0,
    }));
    res.json({ plugins, total: plugins.length });
  });

  // --- Task Board Routes ---

  // List all active tasks (not deleted)
  app.get('/api/tasks', async (_req, res) => {
    try {
      const tasks = await taskStore.getTasks();
      res.json({ tasks });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list tasks' });
    }
  });

  // Create a new task
  app.post('/api/tasks', async (req, res) => {
    const { title, assignee, labels, verify, messageRef, by } = req.body as {
      title?: string;
      assignee?: string;
      labels?: string[];
      verify?: string;
      messageRef?: string;
      by?: string;
    };

    if (!title) {
      res.status(400).json({ error: 'Missing required field: title' });
      return;
    }

    const creator = by ?? 'unknown';
    const input: CreateTaskInput = {
      title,
      ...(assignee !== undefined && { assignee }),
      ...(labels !== undefined && { labels }),
      ...(verify !== undefined && { verify }),
      ...(messageRef !== undefined && { messageRef }),
    };

    try {
      const task = await taskStore.createTask(input, creator);
      agent.events.emit('task:created', { task });
      slog('api', `Task ${task.id} created by ${creator}: ${task.title.slice(0, 60)}`);
      res.status(201).json({ task });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create task' });
    }
  });

  // Update a task (status, assignee, labels, title)
  app.patch('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const { status, assignee, labels, title, by } = req.body as {
      status?: string;
      assignee?: string;
      labels?: string[];
      title?: string;
      by?: string;
    };

    const validStatuses = ['todo', 'doing', 'done', 'abandoned'];
    if (status !== undefined && !validStatuses.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      return;
    }

    const updater = by ?? 'unknown';
    const input: UpdateTaskInput = {
      ...(status !== undefined && { status: status as UpdateTaskInput['status'] }),
      ...(assignee !== undefined && { assignee }),
      ...(labels !== undefined && { labels }),
      ...(title !== undefined && { title }),
    };

    try {
      const task = await taskStore.updateTask(id, input, updater);
      if (!task) {
        res.status(404).json({ error: `Task ${id} not found` });
        return;
      }
      agent.events.emit('task:updated', { task });
      slog('api', `Task ${id} updated by ${updater}`);
      res.json({ task });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update task' });
    }
  });

  // Soft delete a task
  app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const { by } = req.body as { by?: string };
    const deleter = by ?? 'unknown';

    try {
      const existing = await taskStore.getTask(id);
      if (!existing) {
        res.status(404).json({ error: `Task ${id} not found` });
        return;
      }
      await taskStore.deleteTask(id, deleter);
      agent.events.emit('task:deleted', { taskId: id });
      slog('api', `Task ${id} deleted by ${deleter}`);
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete task' });
    }
  });

  // Serve dashboard UI
  const uiDir = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '../ui',
  );

  app.get('/', (_req, res) => {
    res.redirect('/dashboard');
  });

  app.get('/dashboard', (_req, res) => {
    const dashboardPath = path.join(uiDir, 'dashboard.html');
    if (fs.existsSync(dashboardPath)) {
      res.sendFile(dashboardPath);
    } else {
      res.status(404).send('Dashboard not found');
    }
  });

  app.get('/chat', (_req, res) => {
    const chatPath = path.join(uiDir, 'chat.html');
    if (fs.existsSync(chatPath)) {
      res.sendFile(chatPath);
    } else {
      res.status(404).send('Chat not found');
    }
  });

  app.get('/board', (_req, res) => {
    const boardPath = path.join(uiDir, 'board.html');
    if (fs.existsSync(boardPath)) {
      res.sendFile(boardPath);
    } else {
      res.status(404).send('Board not found');
    }
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
