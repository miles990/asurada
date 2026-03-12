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
import { CronScheduler } from './core/cron.js';
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
import type { AgentLoopOptions, CycleRunner } from './loop/types.js';
import { ModelRouter } from './loop/model-router.js';
import { ClaudeCliRunner } from './loop/runners/claude-cli.js';
import { AnthropicApiRunner } from './loop/runners/anthropic-api.js';
import { OpenAiCompatibleRunner } from './loop/runners/openai-compatible.js';
import type { RunnerRef } from './config/types.js';
import { VaultSync } from './obsidian/vault-sync.js';
import { initVault } from './obsidian/vault-init.js';
import { ContextBuilder } from './memory/context-builder.js';
import type { ParsedAction, CycleContext } from './loop/types.js';

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
  /** Memory-aware context builder (for prompts) */
  readonly contextBuilder: ContextBuilder;
  /** Logger (JSONL file-based) */
  readonly logger: Logger;
  /** Multi-lane task manager */
  readonly lanes: LaneManager;
  /** Cron scheduler */
  readonly cron: CronScheduler;
  /** OODA loop (null if no runner configured) */
  readonly loop: AgentLoop | null;
  /** Instance ID */
  readonly instanceId: string;
  /** Active agent name (for memory namespacing) */
  readonly activeAgent: string;

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

  // --- Resolve active agent (for memory namespacing) ---
  const activeAgent = config.activeAgent ?? slugify(agentName);

  // --- Resolve paths ---
  const dataDir = config.paths?.data
    ? path.resolve(baseDir, config.paths.data)
    : path.join(getDefaultDataDir(), instanceId);
  // When agents are configured, namespace memory under memory/{activeAgent}/
  const memoryDir = config.paths?.memory
    ? path.resolve(baseDir, config.paths.memory)
    : config.memory?.dir
      ? path.resolve(baseDir, config.memory.dir)
      : config.agents
        ? path.join(baseDir, 'memory', activeAgent)
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
  if (config.agents) {
    slog('runtime', `Multi-agent mode: active="${activeAgent}", memory=${memoryDir}`);
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
      case 'console':
        // Already registered above as fallback — skip silently
        break;
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

  // --- 4c. Context Builder ---
  const contextBuilder = new ContextBuilder(memory, index, search);

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

  // --- 7. Cron Scheduler ---
  const cronScheduler = new CronScheduler(events, (msg) => slog('cron', msg));

  // --- 8. OODA Loop ---
  let loop: AgentLoop | null = null;
  if (options?.loop?.runner) {
    const loopInterval = parseInterval(config.loop?.interval) ?? 300_000;
    const routerCfg = config.loop?.router;

    // Determine the effective runner: wrap with ModelRouter if routing enabled
    let effectiveRunner: CycleRunner = options.loop.runner;
    if (routerCfg?.enabled) {
      const triageRunner = routerCfg.triageRunner
        ? buildRunnerFromRef(routerCfg.triageRunner)
        : null;
      const reflectRunner = routerCfg.reflectRunner
        ? buildRunnerFromRef(routerCfg.reflectRunner)
        : null;

      if (triageRunner) {
        const router = new ModelRouter({
          triageRunner,
          reflectRunner: reflectRunner ?? options.loop.runner,
          escalateRunner: options.loop.runner,
          reflectTasks: routerCfg.reflectTasks,
          halfLifeMinutes: routerCfg.halfLife,
          threadFloor: routerCfg.threadFloor,
          shadowMode: routerCfg.shadowMode ?? true,
          events,
        });
        effectiveRunner = router;
        slog('runtime', `ModelRouter enabled (shadow=${router.shadowMode}, triage=${routerCfg.triageRunner!.type}/${routerCfg.triageRunner!.model ?? 'default'})`);
      } else {
        slog('runtime', 'ModelRouter enabled but no triageRunner configured — using direct runner');
      }
    }

    // --- Default system prompt: tells the LLM how to be an agent ---
    // Namespace must be valid XML (no spaces). Default to 'agent' for consistency with docs/examples.
    const namespace = options.loop.actionNamespace ?? 'agent';
    const defaultSystemPrompt = options.loop.systemPrompt ?? buildDefaultSystemPrompt(config, agentName, namespace);

    // --- Default buildPrompt: perception + ContextBuilder memory ---
    const defaultBuildPrompt = options.loop.buildPrompt ?? (async (ctx: CycleContext): Promise<string> => {
      const parts: string[] = [];

      parts.push(`Cycle #${ctx.cycleNumber} | Trigger: ${ctx.trigger.type}`);

      // Perception
      if (Object.keys(ctx.perception).length > 0) {
        parts.push('\n## Perception\n');
        for (const [name, output] of Object.entries(ctx.perception)) {
          parts.push(`<${name}>\n${output}\n</${name}>\n`);
        }
      }

      // Memory context (via ContextBuilder)
      const triggerText = ctx.trigger.event?.data
        ? JSON.stringify(ctx.trigger.event.data).slice(0, 200)
        : ctx.trigger.type;
      try {
        const memCtx = await contextBuilder.build(triggerText);
        const memoryPrompt = contextBuilder.formatForPrompt(memCtx);
        if (memoryPrompt) {
          parts.push('\n## Memory\n');
          parts.push(memoryPrompt);
        }
      } catch {
        // Memory context is best-effort — don't break the cycle
      }

      // SOUL.md (identity)
      const soulPath = path.join(memoryDir, 'SOUL.md');
      if (fs.existsSync(soulPath)) {
        try {
          const soul = fs.readFileSync(soulPath, 'utf-8');
          parts.push('\n<soul>\n' + soul + '\n</soul>\n');
        } catch { /* best-effort */ }
      }

      return parts.join('\n');
    });

    // --- Default onAction: dispatch tags to memory/notifications/lanes ---
    const defaultOnAction = options.loop.onAction ?? (async (action: ParsedAction): Promise<void> => {
      switch (action.tag) {
        case 'remember': {
          const topic = action.attrs.topic;
          await memory.append(action.content, topic);
          await index.create('remember', action.content, {
            tags: topic ? [topic] : undefined,
            source: `cycle`,
          }).catch(() => {});
          slog('action', `remember: ${action.content.slice(0, 80)}${topic ? ` [${topic}]` : ''}`);
          break;
        }
        case 'chat': {
          await notifications.notify(action.content);
          events.emit('action:chat', { content: action.content });
          slog('action', `chat: ${action.content.slice(0, 80)}`);
          break;
        }
        case 'task': {
          await index.create('task', action.content, { status: 'active' }).catch(() => {});
          events.emit('action:task', { content: action.content, attrs: action.attrs });
          slog('action', `task: ${action.content.slice(0, 80)}`);
          break;
        }
        case 'inner': {
          const innerPath = path.join(dataDir, 'inner.md');
          fs.writeFileSync(innerPath, action.content, 'utf-8');
          slog('action', `inner: updated working memory`);
          break;
        }
        case 'delegate': {
          const taskType = action.attrs.type ?? 'code';
          const workdir = action.attrs.workdir ?? baseDir;
          lanes.spawn({
            type: taskType,
            prompt: action.content,
            workdir,
          });
          slog('action', `delegate [${taskType}]: ${action.content.slice(0, 60)}`);
          break;
        }
        default: {
          // Generic: emit as event for user-land handlers
          events.emit(`action:${action.tag}`, {
            tag: action.tag,
            content: action.content,
            attrs: action.attrs,
          });
          break;
        }
      }
    });

    loop = new AgentLoop(events, perception, agentName, {
      ...options.loop,
      runner: effectiveRunner,
      systemPrompt: defaultSystemPrompt,
      buildPrompt: defaultBuildPrompt,
      onAction: defaultOnAction,
      actionNamespace: namespace,
      defaultInterval: loopInterval,
      minInterval: 30_000,
      maxInterval: 14_400_000,
      dataDir,
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

  // ModelRouter telemetry → JSONL logs (persistent, queryable)
  events.on('action:model-route', (event) => {
    const data = event.data as Record<string, unknown>;
    logger.log('routing', data);
  });

  // Post-cycle housekeeping: vault sync + cron drain
  let vaultSyncCounter = 0;
  events.on('action:cycle', (event) => {
    const d = event.data as { event?: string };
    if (d.event !== 'complete') return;

    // Drain one cron task per cycle (fire-and-forget)
    cronScheduler.drain().catch(() => {});

    // Vault sync every 10 cycles
    if (vault) {
      vaultSyncCounter++;
      if (vaultSyncCounter % 10 === 0) {
        vault.sync().catch(() => {});
      }
    }
  });

  // --- Build perception config ---
  const perceptionConfig: PerceptionConfig = {
    plugins: (config.perception?.plugins ?? []).map(p => ({
      name: p.name,
      script: p.command ? '' : path.resolve(baseDir, p.script ?? ''),
      command: p.command,
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
    contextBuilder,
    logger,
    lanes,
    cron: cronScheduler,
    loop,
    instanceId,
    activeAgent,

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

      // Start cron scheduler
      if (config.cron && config.cron.length > 0) {
        cronScheduler.start(config.cron);
        slog('runtime', `Cron started — ${cronScheduler.count} job(s)`);
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

      // Stop cron
      cronScheduler.stop();

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

/** Build a CycleRunner from a declarative RunnerRef config */
function buildRunnerFromRef(ref: RunnerRef): CycleRunner {
  switch (ref.type) {
    case 'claude-cli':
      return new ClaudeCliRunner({
        model: ref.model,
      });

    case 'anthropic-api': {
      const apiKey = ref.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('anthropic-api runner requires apiKey or ANTHROPIC_API_KEY env var');
      }
      return new AnthropicApiRunner({
        apiKey,
        model: ref.model,
        baseUrl: ref.baseUrl,
      });
    }

    case 'openai-compatible': {
      if (!ref.baseUrl) {
        throw new Error('openai-compatible runner requires baseUrl');
      }
      return new OpenAiCompatibleRunner({
        baseUrl: ref.baseUrl,
        model: ref.model ?? 'default',
        apiKey: ref.apiKey,
      });
    }

    default:
      throw new Error(`Unknown runner type: "${ref.type}"`);
  }
}

/**
 * Build the default system prompt that teaches the LLM how to be an Asurada agent.
 * Without this, the LLM receives perception data but has no idea what to do with it.
 */
function buildDefaultSystemPrompt(config: AgentConfig, agentName: string, namespace: string): string {
  const ns = namespace;
  const persona = config.agent.persona ?? 'a helpful personal AI agent';

  return `You are ${agentName}, ${persona}.

You run in an autonomous OODA loop — Observe, Orient, Decide, Act — perceiving your environment through plugins and acting through tags.

## Perception

Your environment appears as XML sections in the prompt:
\`\`\`
<plugin-name>output from plugin</plugin-name>
\`\`\`
Each plugin monitors a different aspect (git status, tasks, system health, etc.). Read them before deciding what to do.

## Memory

Relevant memories from past cycles are included in the prompt. Save new insights with \`<${ns}:remember>\`.

## Action Tags

Respond with these tags to take action. Tags outside this list are ignored.

| Tag | Purpose |
|-----|---------|
| \`<${ns}:remember>text</${ns}:remember>\` | Save to long-term memory |
| \`<${ns}:remember topic="t">text</${ns}:remember>\` | Save to a specific topic |
| \`<${ns}:chat>message</${ns}:chat>\` | Send a notification to the user |
| \`<${ns}:task>description</${ns}:task>\` | Create a tracked task |
| \`<${ns}:inner>state</${ns}:inner>\` | Update working memory (persists across cycles, overwritten each time) |
| \`<${ns}:delegate type="code" workdir="path">task</${ns}:delegate>\` | Spawn a background task (types: code, learn, research, create, review) |
| \`<${ns}:schedule next="5m" reason="why" />\` | Set next cycle interval (e.g. "30s", "5m", "2h") |

## Guidelines

- **Observe first**: Read perception data before acting. Don't act randomly.
- **Be concise**: Your response is parsed for action tags. Brief reasoning + tags.
- **One cycle, one focus**: Do one meaningful thing per cycle, not everything at once.
- **Schedule wisely**: Use \`<${ns}:schedule>\` to control pacing. Omit it to use the default interval.
- **If nothing needs attention**: Say so briefly. Don't force unnecessary actions.
`;
}

// getDefaultDataDir() — imported from config/loader.ts (single source of truth)
