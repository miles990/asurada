/**
 * CronScheduler — schedule recurring tasks via cron expressions.
 *
 * Design: Fire events on EventBus when cron triggers, let the loop
 * or a handler decide execution. Queue-drain pattern prevents overlap:
 * cron tick → queue → drain after cycle completes.
 *
 * Framework-agnostic: no coupling to LLM runners or dispatchers.
 */

import cron from 'node-cron';
import type { EventBus } from './event-bus.js';
import type { CronEntry } from '../config/types.js';

// === Types ===

export type { CronEntry };

export interface CronJobInfo {
  schedule: string;
  task: string;
  enabled: boolean;
}

export type CronTickHandler = (entry: CronEntry) => void | Promise<void>;

interface QueuedTask {
  entry: CronEntry;
  queuedAt: number;
  retries: number;
}

interface ScheduledJob {
  entry: CronEntry;
  job: cron.ScheduledTask;
}

// === CronScheduler ===

const MAX_QUEUE_SIZE = 10;
const MAX_RETRIES = 2;

export class CronScheduler {
  private jobs: ScheduledJob[] = [];
  private queue: QueuedTask[] = [];
  private events: EventBus;
  private tickHandler: CronTickHandler | null = null;
  private logFn: (msg: string) => void;

  constructor(events: EventBus, log?: (msg: string) => void) {
    this.events = events;
    this.logFn = log ?? (() => {});
  }

  /** Register a handler called when draining queued tasks */
  onTick(handler: CronTickHandler): void {
    this.tickHandler = handler;
  }

  /** Start scheduling from config entries */
  start(entries: CronEntry[]): void {
    this.stop();

    for (const entry of entries) {
      if (entry.enabled === false) {
        this.logFn(`Cron skipped (disabled): ${entry.task.slice(0, 60)}`);
        continue;
      }

      if (!cron.validate(entry.schedule)) {
        this.logFn(`Cron invalid schedule: ${entry.schedule}`);
        continue;
      }

      const job = cron.schedule(entry.schedule, () => {
        this.enqueue(entry);
      });

      this.jobs.push({ entry, job });
      this.logFn(`Cron scheduled: "${entry.task.slice(0, 60)}" (${entry.schedule})`);
    }

    if (this.jobs.length > 0) {
      this.logFn(`Cron: ${this.jobs.length} job(s) active`);
    }
  }

  /** Stop all scheduled jobs */
  stop(): void {
    for (const { job } of this.jobs) {
      job.stop();
    }
    if (this.jobs.length > 0) {
      this.logFn(`Cron: stopped ${this.jobs.length} job(s)`);
    }
    this.jobs = [];
  }

  /** Dynamically add a job */
  add(entry: CronEntry): { ok: boolean; error?: string } {
    if (entry.enabled === false) {
      return { ok: false, error: 'Entry is disabled' };
    }
    if (!cron.validate(entry.schedule)) {
      return { ok: false, error: `Invalid schedule: ${entry.schedule}` };
    }
    // Deduplicate
    const exists = this.jobs.some(
      j => j.entry.schedule === entry.schedule && j.entry.task === entry.task,
    );
    if (exists) {
      return { ok: false, error: 'Already scheduled' };
    }

    const job = cron.schedule(entry.schedule, () => {
      this.enqueue(entry);
    });
    this.jobs.push({ entry, job });
    this.logFn(`Cron added: "${entry.task.slice(0, 60)}" (${entry.schedule})`);
    return { ok: true };
  }

  /** Remove a job by index */
  remove(index: number): { ok: boolean; error?: string } {
    if (index < 0 || index >= this.jobs.length) {
      return { ok: false, error: 'Index out of range' };
    }
    const removed = this.jobs[index];
    removed.job.stop();
    this.jobs.splice(index, 1);
    this.logFn(`Cron removed: "${removed.entry.task.slice(0, 60)}"`);
    return { ok: true };
  }

  /** List active jobs */
  list(): CronJobInfo[] {
    return this.jobs.map(j => ({
      schedule: j.entry.schedule,
      task: j.entry.task,
      enabled: true,
    }));
  }

  /** Number of active jobs */
  get count(): number {
    return this.jobs.length;
  }

  /** Number of queued tasks awaiting drain */
  get queueSize(): number {
    return this.queue.length;
  }

  /**
   * Drain one queued task. Call this after each OODA cycle completes.
   * Returns true if a task was drained, false if queue was empty.
   */
  async drain(): Promise<boolean> {
    if (this.queue.length === 0) return false;

    const item = this.queue.shift()!;

    if (!this.tickHandler) {
      this.logFn(`Cron: no tick handler, discarding "${item.entry.task.slice(0, 60)}"`);
      return true;
    }

    try {
      await this.tickHandler(item.entry);
      this.logFn(`Cron done: "${item.entry.task.slice(0, 60)}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logFn(`Cron error: ${msg}`);

      if (item.retries < MAX_RETRIES) {
        item.retries++;
        this.queue.push(item);
        this.logFn(`Cron re-queued (retry ${item.retries}): "${item.entry.task.slice(0, 60)}"`);
      }
    }

    return true;
  }

  // === Internal ===

  private enqueue(entry: CronEntry): void {
    // Deduplicate in queue
    const dup = this.queue.some(
      q => q.entry.schedule === entry.schedule && q.entry.task === entry.task,
    );
    if (dup) return;

    // Drop oldest if full
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      const dropped = this.queue.shift();
      this.logFn(`Cron queue full, dropped: "${dropped?.entry.task.slice(0, 60)}"`);
    }

    this.queue.push({ entry, queuedAt: Date.now(), retries: 0 });
    this.events.emit('trigger:cron', {
      schedule: entry.schedule,
      task: entry.task.slice(0, 100),
    });
  }
}
