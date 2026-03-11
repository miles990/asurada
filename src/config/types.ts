/**
 * Asurada Agent Configuration — unified config system
 *
 * One YAML file defines the entire agent. Each section maps
 * directly to a core module's config interface.
 */

import type { LaneConfig, TaskTypeConfig } from '../lanes/types.js';

/** Top-level agent configuration */
export interface AgentConfig {
  /** Agent identity */
  agent: AgentIdentity;
  /** Perception loop settings */
  loop?: LoopConfig;
  /** Notification providers */
  notification?: NotificationConfig;
  /** Perception plugins */
  perception?: AgentPerceptionConfig;
  /** Memory settings */
  memory?: AgentMemoryConfig;
  /** Logging settings */
  logging?: AgentLoggingConfig;
  /** Multi-lane parallel delegation */
  lanes?: LaneConfig;
  /** Obsidian vault integration */
  obsidian?: ObsidianConfig;
  /** Skill files to load */
  skills?: string[];
  /** Cron jobs */
  cron?: CronEntry[];
  /** Paths (resolved relative to config file) */
  paths?: PathsConfig;
}

/** Agent identity — the minimum to get started */
export interface AgentIdentity {
  /** Agent name (required) */
  name: string;
  /** One-line persona description */
  persona?: string;
  /** HTTP API port */
  port?: number;
}

/** OODA loop configuration */
export interface LoopConfig {
  /** Enable autonomous loop */
  enabled?: boolean;
  /** Default cycle interval (e.g. "5m", "30s") */
  interval?: string;
  /** LLM model to use (e.g. "sonnet", "opus", "claude-sonnet-4-6") */
  model?: string;
  /** Runner type hint for CLI auto-detection: "claude-cli" | "anthropic-api" */
  runner?: string;
}

/** Notification configuration */
export interface NotificationConfig {
  providers?: NotificationProviderEntry[];
}

/** A notification provider entry */
export interface NotificationProviderEntry {
  /** Provider type identifier (e.g. "console", "telegram", "discord") */
  type: string;
  /** Provider-specific options */
  options?: Record<string, unknown>;
  /** Only send notifications at or above this tier */
  minTier?: string;
}

/** Perception configuration */
export interface AgentPerceptionConfig {
  /** Category-level intervals in ms (e.g. { workspace: 60000, network: 120000 }) */
  categoryIntervals?: Record<string, number>;
  /** Plugin definitions */
  plugins?: PluginEntry[];
}

/** A perception plugin entry */
export interface PluginEntry {
  /** Plugin name (unique identifier) */
  name: string;
  /** Shell script path (relative to config file) */
  script: string;
  /** Category for interval grouping */
  category?: string;
  /** Override interval in ms (0 = event-driven) */
  interval?: number;
  /** Max output characters */
  outputCap?: number;
  /** Explicitly enable/disable */
  enabled?: boolean;
}

/** Memory configuration */
export interface AgentMemoryConfig {
  /** Memory directory path */
  dir?: string;
  /** Enable topic-scoped memory */
  topics?: boolean;
  /** Search settings */
  search?: {
    /** Enable FTS5 search */
    enabled?: boolean;
    /** Max search results */
    maxResults?: number;
  };
}

/** Logging configuration */
export interface AgentLoggingConfig {
  /** Logs directory path */
  dir?: string;
  /** Log categories to enable */
  categories?: string[];
}

/** Cron job entry */
export interface CronEntry {
  /** Cron expression (e.g. every 30 minutes) */
  schedule: string;
  /** Task description */
  task: string;
}

/** Obsidian vault integration */
export interface ObsidianConfig {
  /** Enable vault sync (default: true) */
  enabled?: boolean;
  /** Subdirectory for index entry pages (default: "index-pages") */
  pagesSubdir?: string;
  /** Subdirectory for conversation summaries (default: "conversations") */
  conversationsSubdir?: string;
  /** Generate daily .md summaries from JSONL logs (default: true) */
  generateDailySummaries?: boolean;
}

/** Resolved paths */
export interface PathsConfig {
  /** Base data directory (default: XDG or ~/Library/Application Support/asurada on macOS) */
  data?: string;
  /** Memory directory */
  memory?: string;
  /** Logs directory */
  logs?: string;
}
