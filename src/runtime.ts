/**
 * Asurada Runtime — the bootstrap that wires all modules together.
 *
 * Usage:
 *   const agent = await createAgent('./asurada.yaml');
 *   await agent.start();
 *   // ... agent is running (perception, lanes, etc.)
 *   await agent.stop();
 *
 * This is what makes Asurada a framework instead of a library.
 * Users write a YAML config, call createAgent(), and everything works.
 */

import path from 'node:path';
import fs from 'node:fs';
import { loadConfig, loadConfigFromDir, getDefaultDataDir, type AgentConfig } from './config/index.js';
import { EventBus } from './core/event-bus.js';
import { NotificationManager } from './notification/manager.js';
import { ConsoleProvider } from './notification/providers/console.js';
import { TelegramProvider } from './notification/providers/telegram.js';
import { PerceptionManager } from './perception/manager.js';
import type { PerceptionConfig, PerceptionPlugin } from './perception/types.js';
import { MemoryStore } from './memory/store.js';
import { MemorySearch } from './memory/search.js';
import { MemoryIndex } from './memory/memory-index.js';
import type { MemoryConfig } from './memory/types.js';
import { Logger, slog, setSlogPrefix } from './logging/index.js';
import { LaneManager } from './lanes/manager.js';
import type { TaskExecutor } from './lanes/types.js';
import { AgentLoop } from './loop/agent-loop.js';
import type { AgentLoopOptions } from './loop/types.js';
import { VaultSync } from './obsidian/vault-sync.js';
import { initVault } from './obsidian/vault-init.js';

// === Agent Interface ===

export interface Agent {
  /** Resolved configuration */
  readonly config: AgentConfig;
  /** Event bus for inter-module communication */
  readonly events: EventBus;
  /** Notification manager */
  readonly notifications: NotificationManager;
  /** Perception stream manager */
  readonly perception: PerceptionManager;
  /** Memory store (file-based) */
  readonly memory: MemoryStore;
  /** Memory search (FTS5) */
  readonly search: MemorySearch;
  /** Relational cognitive graph (append-only JSONL) */
  readonly index: MemoryIndex;
  /** Obsidian vault sync (null if obsidian integration disabled) */
  readonly vault: VaultSync | null;
  /** Logger (JSONL file-based) */
  readonly logger: Logger;
  /** Multi-lane task manager */
  readonly lanes: LaneManager;
  /** OODA loop (null if no runner configured) */
  readonly loop: AgentLoop | null;
  /** Instance ID */
  readonly instanceId: string;

  /** Start the agent (perception streams, lanes, loop) */
  start(): Promise<void>;
  /** Stop the agent gracefully */
  stop(): Promise<void>;
  /** Whether the agent is currently running */
  readonly running: boolean;
}

export interface CreateAgentOptions {
  /** Custom task executor for lanes (default: no-op) */
  taskExecutor?: TaskExecutor;
  /** Instance ID override (default: generated from agent name) */
  instanceId?: string;
  /** Additional notification providers to register */
  notificationProviders?: Array<{ type: string; provider: import('./notification/types.js').NotificationProvider }>;
  /** OODA loop configuration. Omit to disable the loop. */
  loop?: Omit<AgentLoopOptions, 'defaultInterval' | 'minInterval' | 'maxInterval'>;
}

// === Factory ===

/**
 * Create an agent from a config file path.
 *
 *   const agent = await createAgent('./asurada.yaml');
 */
export async function createAgent(
  configPath: string,
  options?: CreateAgentOptions,
): Promise<Agent> {
  const config = loadConfig(configPath);
  const configDir = path.dirname(path.resolve(configPath));
  return buildAgent(config, configDir, options);
}

/**
 * Create an agent by searching for config in a directory.
 *
 *   const agent = await createAgentFromDir('.');
 */
export async function createAgentFromDir(
  dir: string,
  options?: CreateAgentOptions,
): Promise<Agent> {
  const config = loadConfigFromDir(dir);
  if (!config) {
    throw new Error(`No asurada config found in ${dir}. Create asurada.yaml or asurada.yml.`);
  }
  return buildAgent(config, path.resolve(dir), options);
}

/**
 * Create an agent from an in-memory config object.
 *
 *   const agent = await createAgentFromConfig({ agent: { name: 'Test' } });
 */
export async function createAgentFromConfig(
  config: AgentConfig,
  options?: CreateAgentOptions & { baseDir?: string },
): Promise<Agent> {
  return buildAgent(config, options?.baseDir ?? process.cwd(), options);
}

// === Internal Builder ===

function buildAgent(
  config: AgentConfig,
  baseDir: string,
  options?: CreateAgentOptions,
): Agent {
  const instanceId = options?.instanceId ?? slugify(config.agent.name);
  const agentName = config.agent.name;

  // --- Resolve paths ---
  const dataDir = config.paths?.data
    ? path.resolve(baseDir, config.paths.data)
    : path.join(getDefaultDataDir(), instanceId);
  const memoryDir = config.paths?.memory
    ? path.resolve(baseDir, config.paths.memory)
    : config.memory?.dir
      ? path.resolve(baseDir, config.memory.dir)
      : path.join(baseDir, 'memory');
  const logsDir = config.paths?.logs
    ? path.resolve(baseDir, config.paths.logs)
    : config.logging?.dir
      ? path.resolve(baseDir, config.logging.dir)
      : path.join(dataDir, 'logs');

  // Ensure directories exist
  for (const dir of [dataDir, memoryDir, logsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // --- 1. EventBus ---
  const events = new EventBus();

  // --- 2. Logger ---
  setSlogPrefix(agentName);
  const logger = new Logger({
    logsDir,
    instanceId,
    categories: config.logging?.categories,
  });

  // --- 3. Notification ---
  const notifications = new NotificationManager();
  // Always register console as fallback
  notifications.register(new ConsoleProvider());
  // Register config-driven providers
  for (const entry of config.notification?.providers ?? []) {
    switch (entry.type) {
      case 'telegram': {
        const opts = entry.options as { botToken?: string; chatId?: string | number } | undefined;
        const botToken = opts?.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
        const chatId = opts?.chatId ?? process.env.TELEGRAM_CHAT_ID;
        if (botToken && chatId) {
          notifications.register(new TelegramProvider({ botToken, chatId }));
        } else {
          slog('runtime', 'Telegram provider skipped — missing botToken or chatId');
        }
        break;
      }
      default:
        slog('runtime', `Unknown notification provider: "${entry.type}" — register via options.notificationProviders`);
    }
  }
  // Register user-provided providers (programmatic API)
  if (options?.notificationProviders) {
    for (const { provider } of options.notificationProviders) {
      notifications.register(provider);
    }
  }

  // --- 4. Memory ---
  const memoryConfig: MemoryConfig = {
    memoryDir,
    topicsSubdir: 'topics',
    dbPath: path.join(dataDir, 'memory-index.db'),
    mainFile: 'MEMORY.md',
  };
  const memory = new MemoryStore(memoryConfig);
  const search = new MemorySearch(memoryConfig);
  const indexPath = path.join(memoryDir, 'index.jsonl');
  const index = new MemoryIndex(indexPath);

  // --- 4b. Obsidian Vault ---
  let vault: VaultSync | null = null;
  if (config.obsidian?.enabled !== false) {
    vault = new VaultSync({
      vaultDir: memoryDir,
      indexPath,
      pagesSubdir: config.obsidian?.pagesSubdir,
      conversationsSubdir: config.obsidian?.conversationsSubdir,
      generateDailySummaries: config.obsidian?.generateDailySummaries,
    });
  }

  // --- 5. Perception ---
  const perception = new PerceptionManager();

  // --- 6. Lanes ---
  const defaultExecutor: TaskExecutor = {
    execute(spec) {
      slog('lanes', `No executor configured — task "${spec.prompt.slice(0, 60)}..." skipped`);
      return {
        onOutput() {},
        onClose(cb: (code: number | null) => void) { setTimeout(() => cb(0), 0); },
        abort() {},
      };
    },
  };
  const lanes = new LaneManager(
    options?.taskExecutor ?? defaultExecutor,
    config.lanes,
  );

  // --- 7. OODA Loop ---
  let loop: AgentLoop | null = null;
  if (options?.loop?.runner) {
    const loopInterval = parseInterval(config.loop?.interval) ?? 300_000;
    loop = new AgentLoop(events, perception, agentName, {
      ...options.loop,
      defaultInterval: loopInterval,
      minInterval: 30_000,
      maxInterval: 14_400_000,
    });
  }

  // --- Wire up event-driven integrations ---
  // Lane events → EventBus
  lanes.on('task:completed', (result) => {
    events.emit('action:delegation', {
      taskId: result.id,
      type: result.type,
      status: result.status,
      output: result.output?.slice(0, 200),
    });
  });

  // --- Build perception config ---
  const perceptionConfig: PerceptionConfig = {
    plugins: (config.perception?.plugins ?? []).map(p => ({
      name: p.name,
      script: path.resolve(baseDir, p.script),
      category: p.category,
      interval: p.interval,
      enabled: p.enabled,
      outputCap: p.outputCap,
    } satisfies PerceptionPlugin)),
    cwd: baseDir,
    categoryIntervals: config.perception?.categoryIntervals,
  };

  // --- Agent state ---
  let isRunning = false;

  const agent: Agent = {
    config,
    events,
    notifications,
    perception,
    memory,
    search,
    index,
    vault,
    logger,
    lanes,
    loop,
    instanceId,

    get running() {
      return isRunning;
    },

    async start() {
      if (isRunning) return;
      isRunning = true;

      slog('runtime', `Starting agent "${agentName}" (instance: ${instanceId})`);

      // Start perception streams
      if (perceptionConfig.plugins.length > 0) {
        perception.start(perceptionConfig);
        slog('runtime', `Perception started — ${perceptionConfig.plugins.length} plugin(s)`);
      }

      // Initialize search index
      try {
        search.init();
        slog('runtime', 'Memory search index initialized');
      } catch {
        slog('runtime', 'Memory search index skipped (better-sqlite3 not available)');
      }

      // Initialize Obsidian vault
      if (vault) {
        const created = await initVault(memoryDir);
        if (created.length) slog('runtime', `Obsidian vault initialized: ${created.join(', ')}`);
        // Initial sync
        const syncResult = await vault.sync();
        if (syncResult.pagesWritten || syncResult.topicsUpdated || syncResult.summariesGenerated) {
          slog('runtime', `Vault sync: ${syncResult.pagesWritten} pages, ${syncResult.topicsUpdated} topics, ${syncResult.summariesGenerated} summaries`);
        }
      }

      // Start OODA loop
      if (loop && config.loop?.enabled !== false) {
        loop.start();
        slog('runtime', 'OODA loop started');
      }

      events.emit('action:lifecycle', { event: 'started', agent: agentName });
      slog('runtime', `Agent "${agentName}" is running`);
    },

    async stop() {
      if (!isRunning) return;

      slog('runtime', `Stopping agent "${agentName}"...`);

      // Stop OODA loop
      if (loop) {
        loop.stop();
      }

      // Stop perception
      perception.stop();

      // Clean up completed lane tasks
      lanes.cleanup(0);

      isRunning = false;
      events.emit('action:lifecycle', { event: 'stopped', agent: agentName });
      slog('runtime', `Agent "${agentName}" stopped`);
    },
  };

  return agent;
}

// === Helpers ===

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'agent';
}

/** Parse a config interval string like "5m", "30s", "2h" to ms */
function parseInterval(str?: string): number | null {
  if (!str) return null;
  const match = str.match(/^(\d+(?:\.\d+)?)\s*(s|m|h)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  switch (match[2]) {
    case 's': return Math.round(value * 1_000);
    case 'm': return Math.round(value * 60_000);
    case 'h': return Math.round(value * 3_600_000);
    default: return null;
  }
}

// getDefaultDataDir() — imported from config/loader.ts (single source of truth)
