/**
 * Perception types — plugin definitions, results, and configuration.
 */

/** A perception plugin definition */
export interface PerceptionPlugin {
  name: string;
  /** Path to executable script (absolute or relative to cwd) */
  script: string;
  /** Inline shell command (alternative to script — runs via /bin/sh -c) */
  command?: string;
  /** Category for grouping and interval defaults (e.g. 'workspace', 'browser') */
  category?: string;
  /** Polling interval in ms. Overrides category default. 0 = event-driven only. */
  interval?: number;
  /** Script execution timeout in ms (default: 10000) */
  timeout?: number;
  /** Set false to disable this plugin */
  enabled?: boolean;
  /** Max output chars before truncation (default: 4000) */
  outputCap?: number;
}

/** Result from executing a perception plugin */
export interface PerceptionResult {
  name: string;
  output: string | null;
  error?: string;
  durationMs: number;
}

/** Configuration for the perception manager */
export interface PerceptionConfig {
  plugins: PerceptionPlugin[];
  /** Working directory for resolving relative script paths */
  cwd: string;
  /** Default polling interval in ms (default: 60000) */
  defaultInterval?: number;
  /** Default script timeout in ms (default: 10000) */
  defaultTimeout?: number;
  /** Default output cap in chars (default: 4000) */
  defaultOutputCap?: number;
  /** Per-category interval defaults in ms (e.g. { workspace: 30000, browser: 120000 }) */
  categoryIntervals?: Record<string, number>;
  /** Extra environment variables passed to all plugin processes */
  pluginEnv?: Record<string, string>;
}

/** Per-plugin runtime stats */
export interface PerceptionStats {
  name: string;
  category: string;
  interval: number;
  updatedAt: string | null;
  ageMs: number | null;
  avgMs: number;
  timeouts: number;
  runCount: number;
  restarts: number;
  healthy: boolean;
}
