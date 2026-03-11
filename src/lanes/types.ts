/**
 * Multi-Lane — Parallel task delegation types
 *
 * Organic parallelism like Physarum polycephalum:
 * extend tentacles, absorb nutrients, prune dead ends.
 */

/** Task type determines default config (tools, timeout, turns) */
export type TaskType = string;

/** Task lifecycle status */
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timeout';

/** Specification for a delegated task */
export interface TaskSpec {
  id?: string;
  type: TaskType;
  prompt: string;
  workdir: string;
  maxTurns?: number;
  timeoutMs?: number;
  context?: string;
  /** Custom metadata — passed through to result */
  meta?: Record<string, unknown>;
}

/** Result of a completed (or failed/timed out) task */
export interface TaskResult {
  id: string;
  type: TaskType;
  status: TaskStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  output: string;
  verifyResults?: VerifyResult[];
  meta?: Record<string, unknown>;
}

/** Result of a verification command */
export interface VerifyResult {
  cmd: string;
  passed: boolean;
  output: string;
}

/** Type-specific defaults */
export interface TaskTypeConfig {
  maxTurns: number;
  timeoutMs: number;
}

/** Configuration for LaneManager */
export interface LaneConfig {
  /** Maximum concurrent tasks (default: 6) */
  maxConcurrent?: number;
  /** Maximum timeout cap in ms (default: 600000 = 10min) */
  maxTimeoutMs?: number;
  /** Maximum turns cap (default: 10) */
  maxTurnsCap?: number;
  /** Max characters to keep from output tail (default: 5000) */
  outputTailChars?: number;
  /** Per-type default configs */
  typeDefaults?: Record<TaskType, TaskTypeConfig>;
}

/**
 * TaskExecutor — the bridge between LaneManager and actual execution.
 *
 * Users implement this interface for their CLI (Claude, Codex, shell, etc).
 * LaneManager handles concurrency, timeouts, queuing — executor handles spawning.
 */
export interface TaskExecutor {
  /**
   * Start executing a task. Must return a handle for output collection and lifecycle.
   * LaneManager will call abort() on timeout, and listen for completion via onClose.
   */
  execute(task: TaskSpec): ExecutionHandle;
}

/** Handle to a running task — returned by TaskExecutor.execute() */
export interface ExecutionHandle {
  /** Collect output chunks as they arrive */
  onOutput(callback: (chunk: string) => void): void;
  /** Called when the process exits */
  onClose(callback: (code: number | null) => void): void;
  /** Abort the task (called on timeout) */
  abort(): void;
  /** Process ID (for logging) */
  pid?: number;
}

/** Events emitted by LaneManager */
export interface LaneEvents {
  /** Task started (dequeued and executing) */
  'task:started': (result: TaskResult) => void;
  /** Task completed (success or failure) */
  'task:completed': (result: TaskResult) => void;
  /** Task timed out */
  'task:timeout': (result: TaskResult) => void;
  /** Task queued (waiting for slot) */
  'task:queued': (result: TaskResult) => void;
}
