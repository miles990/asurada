/**
 * Stimulus Fingerprint Dedup — prevents repeated responses to similar stimuli.
 *
 * When the same trigger + topics combination appears within a time window,
 * the loop injects a dedup hint telling the LLM to only respond if it has
 * genuinely new information.
 *
 * Storage: append-only JSONL at {dataDir}/stimulus-fingerprints.jsonl
 *
 * Ported from mini-agent's Layer 2 repeated-response prevention.
 */

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { slog } from '../logging/index.js';

/** A recorded fingerprint entry */
interface FingerprintEntry {
  fingerprint: string;
  timestamp: string;
  trigger: string;
}

/** Result of checking a fingerprint against the window */
export interface DedupCheckResult {
  isDuplicate: boolean;
  previousTimestamp?: string;
}

/** Default dedup window: 4 hours */
const DEFAULT_WINDOW_MS = 4 * 3600 * 1000;

/**
 * Build a fingerprint from the cycle trigger and matched topic names.
 * The fingerprint is a short SHA-256 hash of the normalized inputs.
 */
export function buildStimulusFingerprint(trigger: string, topics: string[]): string {
  const normalized = [
    trigger.toLowerCase().trim(),
    ...topics.slice().sort(),
  ].join('|');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * StimulusDedup manages the append-only fingerprint log.
 *
 * Usage:
 *   const dedup = new StimulusDedup('/path/to/data');
 *   const fp = buildStimulusFingerprint('timer', ['git-workflow']);
 *   const result = dedup.checkAndRecord(fp, 'timer');
 *   if (result.isDuplicate) { // inject hint }
 */
export class StimulusDedup {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = `${dataDir}/stimulus-fingerprints.jsonl`;
  }

  /**
   * Check whether a fingerprint was seen within the time window,
   * then record it regardless.
   *
   * @param fingerprint - The stimulus fingerprint (from buildStimulusFingerprint)
   * @param trigger - Raw trigger string (stored for debugging)
   * @param windowMs - Dedup window in ms (default: 4 hours)
   */
  checkAndRecord(
    fingerprint: string,
    trigger: string,
    windowMs: number = DEFAULT_WINDOW_MS,
  ): DedupCheckResult {
    const now = new Date();
    const cutoff = new Date(now.getTime() - windowMs);

    // Read existing entries within window
    let previousTimestamp: string | undefined;
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);

        // Scan from newest to oldest for a match within window
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const entry = JSON.parse(lines[i]) as FingerprintEntry;
            const entryTime = new Date(entry.timestamp);

            // Stop scanning if we're past the window
            if (entryTime < cutoff) break;

            if (entry.fingerprint === fingerprint) {
              previousTimestamp = entry.timestamp;
              break;
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch (err) {
      slog('stimulus-dedup', `Read error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Record the new entry (append-only)
    const entry: FingerprintEntry = {
      fingerprint,
      timestamp: now.toISOString(),
      trigger: trigger.slice(0, 200),
    };
    try {
      fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      slog('stimulus-dedup', `Write error: ${err instanceof Error ? err.message : String(err)}`);
    }

    const isDuplicate = previousTimestamp !== undefined;
    if (isDuplicate) {
      slog('stimulus-dedup', `Duplicate detected (fp=${fingerprint.slice(0, 8)}, prev=${previousTimestamp})`);
    }

    return { isDuplicate, previousTimestamp };
  }

  /** Prune entries older than the window (call periodically to prevent unbounded growth) */
  prune(windowMs: number = DEFAULT_WINDOW_MS): number {
    if (!fs.existsSync(this.filePath)) return 0;

    try {
      const cutoff = new Date(Date.now() - windowMs);
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      const kept: string[] = [];
      let pruned = 0;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as FingerprintEntry;
          if (new Date(entry.timestamp) >= cutoff) {
            kept.push(line);
          } else {
            pruned++;
          }
        } catch {
          pruned++;
        }
      }

      if (pruned > 0) {
        fs.writeFileSync(this.filePath, kept.join('\n') + (kept.length ? '\n' : ''), 'utf-8');
        slog('stimulus-dedup', `Pruned ${pruned} entries (${kept.length} remaining)`);
      }

      return pruned;
    } catch {
      return 0;
    }
  }
}

/** The hint message injected when a duplicate stimulus is detected */
export const DEDUP_HINT =
  'NOTE: You responded to a similar stimulus recently. Only respond if you have genuinely new information. If nothing has changed, a brief acknowledgment or skip is appropriate.';
