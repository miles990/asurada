/**
 * Asurada Logging Types
 *
 * File-based JSONL logging — human-readable, git-friendly, auditable.
 */

/**
 * Built-in log categories. Users can extend with custom string types.
 */
export type LogCategory = 'llm-call' | 'api-request' | 'cron' | 'error' | 'diag' | 'behavior' | (string & {});

/**
 * Log entry metadata
 */
export interface LogMetadata {
  duration?: number;
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Core log entry — all log types share this shape
 */
export interface LogEntry {
  timestamp: string;
  category: LogCategory;
  instanceId: string;
  requestId: string;
  data: Record<string, unknown>;
  metadata: LogMetadata;
}

/**
 * Query options for reading logs
 */
export interface LogQueryOptions {
  category?: LogCategory;
  date?: string;  // YYYY-MM-DD
  limit?: number;
  offset?: number;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Directory to store log files */
  logsDir: string;
  /** Instance identifier */
  instanceId: string;
  /** Log categories to create directories for (defaults to built-in set) */
  categories?: LogCategory[];
}

/**
 * Log statistics for a given date
 */
export interface LogStats {
  date: string;
  counts: Record<LogCategory, number>;
  total: number;
}
