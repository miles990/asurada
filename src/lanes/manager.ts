/**
 * LaneManager — Concurrent task orchestration
 *
 * Manages parallel "tentacles" with:
 * - Configurable concurrency limit + auto-queuing
 * - Per-task timeout with graceful abort
 * - Verify step after completion
 * - Fire-and-forget lifecycle logging
 *
 * Provider-agnostic: actual execution is delegated to TaskExecutor.
 */

import { execSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import type {
  TaskSpec,
  TaskResult,
  TaskStatus,
  TaskType,
  TaskTypeConfig,
  TaskExecutor,
  ExecutionHandle,
  LaneConfig,
  LaneEvents,
  VerifyResult,
} from './types.js';

const DEFAULT_MAX_CONCURRENT = 6;
const DEFAULT_MAX_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_TURNS_CAP = 10;
const DEFAULT_OUTPUT_TAIL_CHARS = 5000;

const DEFAULT_TYPE_CONFIGS: Record<string, TaskTypeConfig> = {
  code:     { maxTurns: 5, timeoutMs: 300_000 },
  learn:    { maxTurns: 3, timeoutMs: 300_000 },
  research: { maxTurns: 5, timeoutMs: 480_000 },
  create:   { maxTurns: 5, timeoutMs: 480_000 },
  review:   { maxTurns: 3, timeoutMs: 180_000 },
  shell:    { maxTurns: 1, timeoutMs: 60_000 },
};

interface QueueEntry {
  task: TaskSpec;
  resolve: (id: string) => void;
}

interface ActiveEntry {
  handle: ExecutionHandle;
  result: TaskResult;
  timeout: ReturnType<typeof setTimeout>;
  output: string;
}

export class LaneManager extends EventEmitter {
  private active = new Map<string, ActiveEntry>();
  private completed = new Map<string, TaskResult>();
  private queue: QueueEntry[] = [];
  private executor: TaskExecutor;
  private config: Required<Omit<LaneConfig, 'typeDefaults'>> & { typeDefaults: Record<TaskType, TaskTypeConfig> };
  private idCounter = 0;

  constructor(executor: TaskExecutor, config?: LaneConfig) {
    super();
    this.executor = executor;
    this.config = {
      maxConcurrent: config?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
      maxTimeoutMs: config?.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS,
      maxTurnsCap: config?.maxTurnsCap ?? DEFAULT_MAX_TURNS_CAP,
      outputTailChars: config?.outputTailChars ?? DEFAULT_OUTPUT_TAIL_CHARS,
      typeDefaults: { ...DEFAULT_TYPE_CONFIGS, ...config?.typeDefaults },
    };
  }

  /** Type-safe emit */
  override emit<K extends keyof LaneEvents>(event: K, ...args: Parameters<LaneEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  /** Type-safe on */
  override on<K extends keyof LaneEvents>(event: K, listener: LaneEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  /**
   * Spawn a task. Returns task ID immediately (fire-and-forget).
   * If at capacity, task is queued and auto-started when a slot opens.
   */
  spawn(task: TaskSpec): string {
    const taskId = task.id ?? this.generateId();
    const typeConfig = this.config.typeDefaults[task.type] ?? DEFAULT_TYPE_CONFIGS.code;

    const maxTurns = Math.min(task.maxTurns ?? typeConfig.maxTurns, this.config.maxTurnsCap);
    const timeoutMs = Math.min(task.timeoutMs ?? typeConfig.timeoutMs, this.config.maxTimeoutMs);

    const normalizedTask: TaskSpec = {
      ...task,
      id: taskId,
      maxTurns,
      timeoutMs,
      workdir: task.workdir.replace(/^~/, os.homedir()),
    };

    if (this.active.size >= this.config.maxConcurrent) {
      const result: TaskResult = {
        id: taskId,
        type: task.type,
        status: 'queued',
        startedAt: new Date().toISOString(),
        output: '',
        meta: task.meta,
      };
      this.queue.push({ task: normalizedTask, resolve: () => {} });
      this.emit('task:queued', result);
      return taskId;
    }

    this.startTask(normalizedTask);
    return taskId;
  }

  /** List tasks (active + optionally completed) */
  list(options?: { includeCompleted?: boolean }): TaskResult[] {
    const results: TaskResult[] = [];
    for (const { result } of this.active.values()) {
      results.push(result);
    }
    if (options?.includeCompleted) {
      for (const result of this.completed.values()) {
        results.push(result);
      }
    }
    return results;
  }

  /** Get a specific task result */
  get(taskId: string): TaskResult | undefined {
    return this.active.get(taskId)?.result ?? this.completed.get(taskId);
  }

  /** Current stats */
  stats(): { active: number; queued: number; completed: number; maxConcurrent: number } {
    return {
      active: this.active.size,
      queued: this.queue.length,
      completed: this.completed.size,
      maxConcurrent: this.config.maxConcurrent,
    };
  }

  /** Drain completed results (returns and clears) */
  drain(): TaskResult[] {
    const results = [...this.completed.values()];
    this.completed.clear();
    return results;
  }

  /** Cleanup completed tasks older than maxAgeMs */
  cleanup(maxAgeMs = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, result] of this.completed) {
      if (result.completedAt && new Date(result.completedAt).getTime() < cutoff) {
        this.completed.delete(id);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private generateId(): string {
    return `lane-${Date.now()}-${(++this.idCounter).toString(36)}`;
  }

  private startTask(task: TaskSpec): void {
    const taskId = task.id!;

    const result: TaskResult = {
      id: taskId,
      type: task.type,
      status: 'running',
      startedAt: new Date().toISOString(),
      output: '',
      meta: task.meta,
    };

    // Execute via the provided executor
    let handle: ExecutionHandle;
    try {
      handle = this.executor.execute(task);
    } catch (err) {
      result.status = 'failed';
      result.completedAt = new Date().toISOString();
      result.output = `Executor failed to start: ${(err as Error).message}`;
      this.completed.set(taskId, result);
      this.emit('task:completed', result);
      this.dequeue();
      return;
    }

    // Collect output
    let output = '';
    handle.onOutput((chunk) => {
      output += chunk;
    });

    // Timeout
    const timeoutMs = task.timeoutMs!;
    const timeout = setTimeout(() => {
      result.status = 'timeout';
      handle.abort();
    }, timeoutMs);

    const entry: ActiveEntry = { handle, result, timeout, output: '' };
    this.active.set(taskId, entry);

    this.emit('task:started', result);

    // Completion
    handle.onClose(async (code) => {
      clearTimeout(timeout);

      // Trim output
      const tailChars = this.config.outputTailChars;
      result.output = output.length > tailChars ? output.slice(-tailChars) : output;

      if (result.status !== 'timeout') {
        result.status = code === 0 ? 'completed' : 'failed';
      }

      result.completedAt = new Date().toISOString();
      result.durationMs = Date.now() - new Date(result.startedAt).getTime();

      // Run verify commands if task completed successfully
      if (result.status === 'completed' && task.meta?.verify) {
        const verifyCommands = task.meta.verify as string[];
        result.verifyResults = this.runVerify(verifyCommands, task.workdir);
        const allPassed = result.verifyResults.every(v => v.passed);
        if (!allPassed) result.status = 'failed';
      }

      this.active.delete(taskId);
      this.completed.set(taskId, result);
      this.emit('task:completed', result);
      this.dequeue();
    });
  }

  private dequeue(): void {
    while (this.active.size < this.config.maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      this.startTask(entry.task);
      entry.resolve(entry.task.id!);
    }
  }

  private runVerify(commands: string[], workdir: string): VerifyResult[] {
    return commands.map((cmd) => {
      try {
        const output = execSync(cmd, {
          cwd: workdir,
          encoding: 'utf-8',
          timeout: 30_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { cmd, passed: true, output: output.slice(0, 1000) };
      } catch (err) {
        const output = (err as { stderr?: string; stdout?: string }).stderr
          ?? (err as { stderr?: string; stdout?: string }).stdout
          ?? (err as Error).message;
        return { cmd, passed: false, output: (output ?? '').slice(0, 1000) };
      }
    });
  }
}
