/**
 * Asurada Logging Utilities
 *
 * slog — timestamped console output for server.log observability
 * diagLog — structured diagnostic recording (slog + JSONL persistence)
 * safeExec — try/catch wrapper with automatic diagLog
 * readJsonFile — safe JSON file reader
 *
 * Generalized from mini-agent's utils.ts:
 * - diagLog accepts Logger instance instead of calling getLogger() singleton
 * - safeExec chains through diagLog
 * - No global state except optional slog prefix
 */

import { existsSync, readFileSync } from 'node:fs';
import type { Logger } from './logger.js';

// =============================================================================
// slog — Server Log Helper
// =============================================================================

let slogPrefix = '';

/**
 * Set a prefix for all slog output (e.g., instanceId or agent name)
 */
export function setSlogPrefix(prefix: string): void {
  slogPrefix = prefix;
}

/**
 * Timestamped console log for server.log observability.
 * Format: `YYYY-MM-DD HH:MM:SS [TAG] message`
 */
export function slog(tag: string, msg: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const clean = (msg ?? '').replace(/\r?\n/g, '\\n');
  const prefix = slogPrefix ? ` ${slogPrefix} |` : '';
  console.log(`${ts}${prefix} [${tag}] ${clean}`);
}

// =============================================================================
// diagLog — Structured Diagnostic Recording
// =============================================================================

/**
 * Extract useful info from an error
 */
function extractErrorInfo(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { message: error.message, code };
  }
  return { message: String(error) };
}

/**
 * Structured diagnostic recording: slog [DIAG] + optional JSONL persistence.
 *
 * @param context - Call site description (e.g., 'perception.execute', 'memory.search')
 * @param error - Error object or any value
 * @param snapshot - Contextual key-value pairs
 * @param logger - Optional Logger instance for JSONL persistence
 */
export function diagLog(
  context: string,
  error: unknown,
  snapshot?: Record<string, string>,
  logger?: Logger,
): void {
  const info = extractErrorInfo(error);
  const snapshotStr = snapshot
    ? ' | ' + Object.entries(snapshot).map(([k, v]) => `${k}=${v}`).join(' ')
    : '';

  // 1. slog — immediately visible in server.log
  slog('DIAG', `[${context}] ${info.message}${info.code ? ` (${info.code})` : ''}${snapshotStr}`);

  // 2. JSONL persistence — if logger provided
  if (logger) {
    try {
      logger.logDiag(context, error, snapshot);
    } catch {
      // Logger not ready — slog already recorded it
    }
  }
}

// =============================================================================
// safeExec — Try/Catch Wrapper
// =============================================================================

/**
 * Synchronous safe execution with automatic diagLog on error.
 */
export function safeExec<T>(
  fn: () => T,
  context: string,
  fallback: T,
  snapshot?: Record<string, string>,
  logger?: Logger,
): T {
  try {
    return fn();
  } catch (error) {
    diagLog(context, error, snapshot, logger);
    return fallback;
  }
}

/**
 * Async safe execution with automatic diagLog on error.
 */
export async function safeExecAsync<T>(
  fn: () => Promise<T>,
  context: string,
  fallback: T,
  snapshot?: Record<string, string>,
  logger?: Logger,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    diagLog(context, error, snapshot, logger);
    return fallback;
  }
}

// =============================================================================
// readJsonFile — Safe JSON File Reader
// =============================================================================

/**
 * Safely read and parse a JSON file. Returns fallback on missing file or parse error.
 */
export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}
