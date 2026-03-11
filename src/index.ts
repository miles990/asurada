/**
 * Asurada — Perception-driven personal AI agent framework
 *
 * Grows with you, not just for you.
 */

// Runtime — the main entry point
export {
  createAgent,
  createAgentFromDir,
  createAgentFromConfig,
  type Agent,
  type CreateAgentOptions,
} from './runtime.js';

// Config
export {
  loadConfig,
  loadConfigFromDir,
  findConfigFile,
  generateConfig,
  writeConfig,
  DEFAULT_CONFIG,
  STARTER_CONFIG,
  type AgentConfig,
  type AgentIdentity,
  type LoopConfig,
  type NotificationConfig,
  type AgentPerceptionConfig,
  type PluginEntry,
  type AgentMemoryConfig,
  type AgentLoggingConfig,
  type CronEntry,
  type PathsConfig,
} from './config/index.js';

export {
  EventBus,
  debounce,
  distinctUntilChanged,
  type AgentEvent,
  type EventPattern,
  type EventHandler,
} from './core/index.js';

export {
  NotificationManager,
  type NotificationProvider,
  type NotificationStats,
  type NotificationTier,
  type SendOptions,
} from './notification/index.js';

export {
  PerceptionManager,
  executePlugin,
  executeAllPlugins,
  formatResults,
  type PerceptionPlugin,
  type PerceptionResult,
  type PerceptionConfig,
  type PerceptionStats,
} from './perception/index.js';

export {
  MemoryStore,
  MemorySearch,
  MemoryIndex,
  type MemoryEntry,
  type SearchResult,
  type MemoryConfig,
  type MemoryStoreProvider,
  type CognitiveType,
  type IndexEntry,
  type IndexQuery,
  type GraphEdge,
  type ResolvedIndex,
} from './memory/index.js';

export {
  Logger,
  slog,
  setSlogPrefix,
  diagLog,
  safeExec,
  safeExecAsync,
  readJsonFile,
  type LogCategory,
  type LogEntry,
  type LogMetadata,
  type LogQueryOptions,
  type LogStats,
  type LoggerConfig,
} from './logging/index.js';

export {
  LaneManager,
  type TaskSpec,
  type TaskResult,
  type TaskStatus,
  type TaskType,
  type TaskTypeConfig,
  type TaskExecutor,
  type ExecutionHandle,
  type LaneConfig,
  type LaneEvents,
  type VerifyResult,
} from './lanes/index.js';

export {
  AgentLoop,
  parseActions,
  parseDuration,
  ClaudeCliRunner,
  AnthropicApiRunner,
  type ClaudeCliOptions,
  type AnthropicApiOptions,
  type AgentLoopOptions,
  type CycleRunner,
  type CycleContext,
  type CycleTrigger,
  type CycleResult,
  type ParsedAction,
} from './loop/index.js';

// HTTP API
export {
  startServer,
  type AgentServer,
  type ServerOptions,
  type Message,
  type AgentStatus,
  type HealthResponse,
} from './api/index.js';

// Obsidian Integration
export {
  VaultSync,
  initVault,
  parseFrontmatter,
  generateFrontmatter,
  setFrontmatter,
  mergeFrontmatter,
  type SyncResult,
  type Frontmatter,
  type VaultSyncOptions,
  type ObsidianConfig,
} from './obsidian/index.js';

// Process Management
export {
  createProcessManager,
  LaunchdManager,
  PidFileManager,
  type ProcessManager,
  type ProcessStartOptions,
  type ProcessInfo,
  type ProcessBackend,
} from './process/index.js';
