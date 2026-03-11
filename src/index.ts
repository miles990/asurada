/**
 * Asurada — Perception-driven personal AI agent framework
 *
 * Grows with you, not just for you.
 */

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
  type MemoryEntry,
  type SearchResult,
  type MemoryConfig,
  type MemoryStoreProvider,
} from './memory/index.js';
