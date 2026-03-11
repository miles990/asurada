/**
 * Asurada Logger — File-based JSONL logging
 *
 * Each category gets its own directory. Daily rotation by date.
 * Human-readable, git-friendly, auditable.
 *
 * Generalized from mini-agent's Logger:
 * - No singleton, no global state — instantiate with config
 * - LogCategory is extensible string, not hardcoded enum
 * - No dependency on instance.ts — accepts logsDir directly
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LogCategory, LogEntry, LogMetadata, LogQueryOptions, LogStats, LoggerConfig } from './types.js';

const DEFAULT_CATEGORIES: LogCategory[] = ['llm-call', 'api-request', 'cron', 'error', 'diag', 'behavior'];

export class Logger {
  private readonly instanceId: string;
  private readonly logsDir: string;
  private readonly categories: LogCategory[];

  constructor(config: LoggerConfig) {
    this.instanceId = config.instanceId;
    this.logsDir = config.logsDir;
    this.categories = config.categories ?? DEFAULT_CATEGORIES;
    this.ensureDirs();
  }

  // ---------------------------------------------------------------------------
  // Directory Management
  // ---------------------------------------------------------------------------

  private ensureDirs(): void {
    for (const cat of this.categories) {
      const dirPath = path.join(this.logsDir, cat);
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }
    }
  }

  /** Ensure a category directory exists (for dynamic categories added after init) */
  private ensureCategory(category: LogCategory): void {
    const dirPath = path.join(this.logsDir, category);
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Core Write
  // ---------------------------------------------------------------------------

  private getToday(): string {
    return new Date().toISOString().split('T')[0];
  }

  private getLogFilePath(category: LogCategory, date?: string): string {
    return path.join(this.logsDir, category, `${date ?? this.getToday()}.jsonl`);
  }

  private writeLog(entry: LogEntry): void {
    this.ensureCategory(entry.category);
    const filePath = this.getLogFilePath(entry.category);
    appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  generateRequestId(): string {
    return randomUUID();
  }

  // ---------------------------------------------------------------------------
  // Public Logging Methods
  // ---------------------------------------------------------------------------

  /**
   * Generic log — write any category
   */
  log(
    category: LogCategory,
    data: Record<string, unknown>,
    metadata: Partial<LogMetadata> = {},
    requestId?: string,
  ): string {
    const id = requestId ?? this.generateRequestId();
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      category,
      instanceId: this.instanceId,
      requestId: id,
      data,
      metadata: { success: true, ...metadata },
    };
    this.writeLog(entry);
    return id;
  }

  /**
   * Log an LLM call (input/output/duration)
   */
  logLLMCall(
    input: Record<string, unknown>,
    output: Record<string, unknown>,
    metadata: LogMetadata,
    requestId?: string,
  ): string {
    return this.log('llm-call', { input, output }, metadata, requestId);
  }

  /**
   * Log an API request
   */
  logApiRequest(
    request: { method: string; path: string; body?: unknown },
    response: { status: number; body?: unknown },
    metadata: LogMetadata,
    requestId?: string,
  ): string {
    return this.log('api-request', { request, response }, metadata, requestId);
  }

  /**
   * Log a cron/scheduled action
   */
  logCron(
    action: string,
    result?: string,
    trigger?: string,
    metadata?: Partial<LogMetadata>,
  ): string {
    return this.log('cron', { action, result, trigger }, { success: true, ...metadata });
  }

  /**
   * Log an error
   */
  logError(
    error: Error | string,
    context?: string,
    metadata?: Partial<LogMetadata>,
  ): string {
    const errorStr = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : undefined;
    return this.log('error', { error: errorStr, stack, context }, { success: false, error: errorStr, ...metadata });
  }

  /**
   * Log diagnostic information (also writes to error/ for cross-referencing)
   */
  logDiag(
    context: string,
    error: unknown,
    snapshot?: Record<string, string>,
  ): string {
    const errorStr = error instanceof Error ? (error as Error).message : String(error);
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    const stack = error instanceof Error ? (error as Error).stack : undefined;

    const id = this.log('diag', { context, error: errorStr, code, snapshot }, { success: false, error: errorStr });

    // Cross-reference in error/ directory
    this.log('error', {
      error: snapshot ? `[${context}] ${errorStr}` : errorStr,
      stack,
      context,
    }, { success: false, error: errorStr }, id);

    return id;
  }

  /**
   * Log a behavior event (user/agent/system action)
   */
  logBehavior(
    actor: string,
    action: string,
    detail?: string,
  ): string {
    return this.log('behavior', { actor, action, detail }, { success: true });
  }

  // ---------------------------------------------------------------------------
  // Query Methods
  // ---------------------------------------------------------------------------

  private readLogFile(category: LogCategory, date: string): LogEntry[] {
    const filePath = this.getLogFilePath(category, date);
    if (!existsSync(filePath)) return [];

    try {
      const content = readFileSync(filePath, 'utf-8');
      return content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as LogEntry);
    } catch {
      return [];
    }
  }

  /**
   * Query logs with optional filtering
   */
  query(options: LogQueryOptions = {}): LogEntry[] {
    const { category, date, limit = 100, offset = 0 } = options;
    const dateStr = date ?? this.getToday();

    let entries: LogEntry[];

    if (category) {
      entries = this.readLogFile(category, dateStr);
    } else {
      entries = [];
      for (const cat of this.categories) {
        entries.push(...this.readLogFile(cat, dateStr));
      }
      entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }

    // Newest first
    entries.reverse();
    return entries.slice(offset, offset + limit);
  }

  /**
   * Get available log dates
   */
  async getAvailableDates(category?: LogCategory): Promise<string[]> {
    const dates = new Set<string>();
    const cats = category ? [category] : this.categories;

    for (const cat of cats) {
      const dirPath = path.join(this.logsDir, cat);
      try {
        const files = await readdir(dirPath);
        for (const file of files) {
          if (file.endsWith('.jsonl')) {
            dates.add(file.replace('.jsonl', ''));
          }
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          // Silently skip — directory doesn't exist yet
        }
      }
    }

    return Array.from(dates).sort().reverse();
  }

  /**
   * Get log statistics for a date
   */
  getStats(date?: string): LogStats {
    const dateStr = date ?? this.getToday();
    const counts: Record<string, number> = {};
    let total = 0;

    for (const cat of this.categories) {
      const count = this.readLogFile(cat, dateStr).length;
      counts[cat] = count;
      total += count;
    }

    return { date: dateStr, counts, total };
  }
}
