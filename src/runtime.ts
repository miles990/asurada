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
import { FeedbackLoops } from './loop/feedback-loops.js';
import { ContextOptimizer } from './loop/context-optimizer.js';
import { HesitationAnalyzer } from './loop/hesitation.js';
import { ClaudeCliRunner } from './loop/runners/claude-cli.js';
import { AnthropicApiRunner } from './loop/runners/anthropic-api.js';
import { OpenAiCompatibleRunner } from './loop/runners/openai-compatible.js';
import type { RunnerRef } from './config/types.js';
import { VaultSync } from './obsidian/vault-sync.js';
import { initVault } from './obsidian/vault-init.js';
import { ContextBuilder } from './memory/context-builder.js';
import { ConversationStore } from './memory/conversation.js';
import type { ParsedAction, CycleContext } from './loop/types.js';
import { extractCitedSections } from './loop/action-parser.js';
import { buildDefaultSystemPrompt, buildCompactSystemPrompt } from './loop/system-prompt.js';
import { generateSoulSeed } from './setup/scaffold.js';

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
  /** Conversation store (multi-turn dialogue history) */
  readonly conversations: ConversationStore;
  /** Logger (JSONL file-based) */
  readonly logger: Logger;
  /** Multi-lane task manager */
  readonly lanes: LaneManager;
  /** Cron scheduler */
  readonly cron: CronScheduler;
  /** OODA loop (null if no runner configured) */
  readonly loop: AgentLoop | null;
  /** Self-learning feedback loops (error patterns, perception citations, quality audit) */
  readonly feedbackLoops: FeedbackLoops;
  /** Context window optimizer (citation-driven section demotion/promotion) */
  readonly contextOptimizer: ContextOptimizer;
  /** Hesitation analyzer (meta-cognitive quality gate for LLM responses) */
  readonly hesitation: HesitationAnalyzer;
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
    throw new Error(`No asurada config found in ${dir}. Copy asurada.yaml.example to asurada.yaml and customize it.`);
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
  // Always namespace memory under memory/{activeAgent}/
  const memoryDir = config.paths?.memory
    ? path.resolve(baseDir, config.paths.memory)
    : config.memory?.dir
      ? path.resolve(baseDir, config.memory.dir)
      : path.join(baseDir, 'memory', activeAgent);
  const logsDir = config.paths?.logs
    ? path.resolve(baseDir, config.paths.logs)
    : config.logging?.dir
      ? path.resolve(baseDir, config.logging.dir)
      : path.join(dataDir, 'logs');

  // Ensure directories exist
  for (const dir of [dataDir, memoryDir, logsDir]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to create directory "${dir}": ${msg}`);
    }
  }

  // Bootstrap essential memory files if missing (e.g. name changed without re-running init)
  bootstrapMemoryFiles(memoryDir, agentName, config.agent.persona, config.agent.language);

  slog('runtime', `Agent "${activeAgent}", memory=${memoryDir}`);

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
        const botToken = opts?.botToken;
        const chatId = opts?.chatId;
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

  // --- 4d. Conversation Store ---
  const conversationsDir = path.join(memoryDir, 'conversations');
  const conversations = new ConversationStore(conversationsDir, {
    maxDays: config.memory?.maxConversationDays,
  });

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

  // --- 8. Self-Learning Subsystems ---
  const feedbackStateDir = path.join(dataDir, 'state');
  const feedbackLoops = new FeedbackLoops({
    stateDir: feedbackStateDir,
    onErrorPattern: (description) => {
      // Create a task in the cognitive graph when recurring errors detected
      index.create('task', description, { tags: ['auto-error-pattern'], status: 'active' }).catch(() => {});
      slog('feedback', `Auto-task: ${description}`);
    },
    onAdjustInterval: (pluginName, intervalMs) => {
      // Slow down low-citation perception plugins
      perception.adjustInterval(pluginName, intervalMs);
    },
    onRestoreInterval: (pluginName) => {
      // Restore citation-recovered plugins to default interval
      perception.restoreDefaultInterval(pluginName);
    },
    onQualityWarning: (avgScore) => {
      notifications.notify(`⚠️ Decision quality low (avg ${avgScore.toFixed(1)}/6). Check recent cycles.`).catch(() => {});
    },
  });

  const contextOptimizer = new ContextOptimizer({
    stateDir: feedbackStateDir,
    protectedSections: ['soul', 'inbox', 'workspace', 'memory', 'self', 'conversation-history'],
    sectionKeywords: config.contextOptimizer?.sectionKeywords ?? {},
    demotionThreshold: config.contextOptimizer?.demotionThreshold,
    observationCycles: config.contextOptimizer?.observationCycles,
  });

  const hesitation = new HesitationAnalyzer({
    stateDir: feedbackStateDir,
  });

  // --- 9. OODA Loop ---
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
    const promptProfile = config.loop?.promptProfile ?? 'full';
    const buildPromptFn = promptProfile === 'compact' ? buildCompactSystemPrompt : buildDefaultSystemPrompt;
    const defaultSystemPrompt = options.loop.systemPrompt ?? buildPromptFn(config, agentName, namespace);

    // --- Default buildPrompt: perception + conversation + ContextBuilder memory ---
    const defaultBuildPrompt = options.loop.buildPrompt ?? (async (ctx: CycleContext): Promise<string> => {
      const parts: string[] = [];

      parts.push(`Cycle #${ctx.cycleNumber} | Trigger: ${ctx.trigger.type}`);

      // Conversation history — the agent needs to see recent messages to maintain dialogue
      const triggerMsg = ctx.trigger.event?.data?.message as
        { id?: string; from?: string; text?: string } | undefined;

      // Auto-store incoming user messages so conversation history is complete
      if (triggerMsg?.text && triggerMsg.from && triggerMsg.from !== agentName) {
        conversations.append({
          id: triggerMsg.id,
          from: triggerMsg.from,
          text: triggerMsg.text,
          source: 'user',
        }).catch((err) => {
          slog('runtime', `Failed to store user message: ${err instanceof Error ? err.message : String(err)}`);
        });
      }

      try {
        const recent = await conversations.recent({ limit: 20 });
        if (recent.length > 0) {
          parts.push('\n## Conversation\n');
          if (triggerMsg?.text) {
            parts.push(`**New message from ${triggerMsg.from ?? 'user'}:**\n> ${triggerMsg.text}\n`);
          }
          parts.push('<conversation-history>');
          for (const msg of recent) {
            const reply = msg.replyTo ? ` (↩${msg.replyTo})` : '';
            parts.push(`[${msg.id}] ${msg.from}: ${msg.text}${reply}`);
          }
          parts.push('</conversation-history>\n');
        } else if (triggerMsg?.text) {
          // No history yet, but there's a new message
          parts.push('\n## Conversation\n');
          parts.push(`**New message from ${triggerMsg.from ?? 'user'}:**\n> ${triggerMsg.text}\n`);
        }
      } catch { /* best-effort */ }

      // Perception — skip sections demoted by ContextOptimizer (unless keyword match)
      if (Object.keys(ctx.perception).length > 0) {
        const contextHints = (triggerMsg?.text ?? ctx.trigger.type).split(/\s+/).filter(Boolean);
        const included: string[] = [];
        const demoted: string[] = [];
        parts.push('\n## Perception\n');
        for (const [name, output] of Object.entries(ctx.perception)) {
          if (contextOptimizer.shouldLoad(name, contextHints)) {
            parts.push(`<${name}>\n${output}\n</${name}>\n`);
            included.push(name);
          } else {
            demoted.push(name);
          }
        }
        if (demoted.length > 0) {
          slog('runtime', `Context optimizer: skipped ${demoted.length} demoted sections (${demoted.join(', ')})`);
        }
      }

      // Memory context (via ContextBuilder)
      // Use trigger message text for better topic matching when available
      const triggerText = triggerMsg?.text
        ?? (ctx.trigger.event?.data
          ? JSON.stringify(ctx.trigger.event.data).slice(0, 200)
          : ctx.trigger.type);
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

      const assembled = parts.join('\n');

      // Prompt budget warning — rough char-to-token estimate
      const estimatedTokens = Math.ceil(assembled.length / 3.5);
      if (estimatedTokens > 180_000) {
        slog('runtime', `Prompt budget warning: ~${estimatedTokens} tokens (${assembled.length} chars). Consider enabling context optimizer or reducing perception plugins.`);
      }

      return assembled;
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
          // Store agent responses in conversation history
          conversations.append({
            from: agentName,
            text: action.content,
            source: 'agent',
          }).catch((err) => {
            slog('action', `Failed to store chat in conversation history: ${err instanceof Error ? err.message : String(err)}`);
          });
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
          try {
            fs.writeFileSync(innerPath, action.content, 'utf-8');
            slog('action', `inner: updated working memory`);
          } catch (err) {
            slog('action', `inner: FAILED to update working memory: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        }
        case 'feedback': {
          // Co-evolution: record user corrections and behavioral patterns
          const pattern = action.attrs.pattern;
          await index.create('feedback', action.content, {
            tags: pattern ? ['feedback', pattern] : ['feedback'],
            source: 'cycle',
          }).catch(() => {});
          slog('action', `feedback: ${action.content.slice(0, 80)}${pattern ? ` [${pattern}]` : ''}`);
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
    const d = event.data as { event?: string; response?: string; cycle?: number };
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

    // Self-learning: feedback loops — pass LLM response for quality audit + citation tracking
    const response = d.response ?? null;
    feedbackLoops.runAll(response).catch(() => {});

    // Context optimizer: extract cited sections from LLM response, record, and save
    if (response) {
      contextOptimizer.recordCycle({ citedSections: extractCitedSections(response) });
    }
    contextOptimizer.save();

    // Hesitation analysis: score response quality (fire-and-forget logging)
    if (response) {
      const result = hesitation.analyze(response);
      if (result.score > 0) {
        hesitation.logEvent(result, 'cycle', d.cycle as number | undefined);
        if (!result.confident) {
          slog('hesitation', result.suggestion);
        }
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
    pluginEnv: {
      ASURADA_MEMORY_DIR: memoryDir,
      ASURADA_AGENT: activeAgent,
    },
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
    conversations,
    logger,
    lanes,
    cron: cronScheduler,
    loop,
    feedbackLoops,
    contextOptimizer,
    hesitation,
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

      // Stop OODA loop (waits for current cycle to complete)
      if (loop) {
        await loop.stop();
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
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/^-+|-+$/g, '')
    || 'agent';
}

/**
 * Bootstrap essential memory files if they don't exist.
 * Handles the case where agent name was changed without re-running `asurada init`.
 */
function bootstrapMemoryFiles(memoryDir: string, agentName: string, persona?: string, language?: string): void {
  const soulPath = path.join(memoryDir, 'SOUL.md');
  if (!fs.existsSync(soulPath)) {
    try {
      const lang = (language as 'en' | 'zh-TW' | 'ja') ?? 'en';
      const content = generateSoulSeed(agentName, persona, undefined, lang);
      fs.writeFileSync(soulPath, content, 'utf-8');
      slog('runtime', `Bootstrapped SOUL.md for "${agentName}" (${lang})`);
    } catch (err) {
      slog('runtime', `Failed to bootstrap SOUL.md: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const memoryPath = path.join(memoryDir, 'MEMORY.md');
  if (!fs.existsSync(memoryPath)) {
    try {
      fs.writeFileSync(memoryPath, '# Memory\n\n', 'utf-8');
      slog('runtime', 'Bootstrapped MEMORY.md');
    } catch (err) {
      slog('runtime', `Failed to bootstrap MEMORY.md: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Ensure subdirectories
  for (const sub of ['topics', 'conversations', 'daily']) {
    const subDir = path.join(memoryDir, sub);
    try {
      if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });
    } catch (err) {
      slog('runtime', `Failed to create ${sub}/ directory: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
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
      const apiKey = ref.apiKey;
      if (!apiKey) {
        throw new Error('anthropic-api runner requires apiKey in config (set loop.anthropicApiKey in asurada.yaml)');
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

// getDefaultDataDir() — imported from config/loader.ts (single source of truth)
