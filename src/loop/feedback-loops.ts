/**
 * Feedback Loops — self-learning subsystem for Asurada agents.
 *
 * Three fire-and-forget loops that run after each OODA cycle:
 * - Loop A: Error Pattern Detection → auto-create tasks for recurring errors
 * - Loop B: Perception Citation Tracking → adjust plugin intervals based on usage
 * - Loop C: Decision Quality Audit → warn when decision quality drops
 *
 * All loops are fire-and-forget — they must never block or slow the OODA cycle.
 *
 * Generalized from mini-agent's feedback-loops.ts:
 * - No singleton state — instantiate with config
 * - Pluggable task creation (callback instead of hardcoded memory.addTask)
 * - Pluggable perception adjustment (callback instead of direct perceptionStreams)
 * - State stored as JSON files in a configurable directory
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { slog } from '../logging/index.js';

// === Types ===

interface ErrorPatternEntry {
  count: number;
  taskCreated: boolean;
  lastSeen: string;
}

interface ErrorPatternState {
  [key: string]: ErrorPatternEntry;
}

interface CitationState {
  cycleCount: number;
  citations: Record<string, number>;
  lastAdjusted: string;
}

interface DecisionQualityState {
  recentScores: number[];
  avgScore: number;
  warningInjected: boolean;
  lastWarningAt: string | null;
}

export interface ErrorLogEntry {
  context?: string;
  error?: string;
}

export interface FeedbackLoopsOptions {
  /** Directory to store state files */
  stateDir: string;
  /** Callback to create a task from detected error pattern */
  onErrorPattern?: (description: string) => void | Promise<void>;
  /** Callback to adjust a perception plugin's interval */
  onAdjustInterval?: (pluginName: string, intervalMs: number) => void;
  /** Callback to restore a perception plugin's default interval */
  onRestoreInterval?: (pluginName: string) => void;
  /** Callback invoked when decision quality drops below threshold */
  onQualityWarning?: (avgScore: number) => void;
  /** Perception names that should never have their intervals adjusted */
  corePerceptions?: string[];
  /** Error pattern threshold (default: 3) */
  errorThreshold?: number;
  /** Citation evaluation period in cycles (default: 50) */
  citationEvalPeriod?: number;
  /** Quality window size (default: 20) */
  qualityWindowSize?: number;
}

// === State Management ===

function readJsonState<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonState(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch { /* best effort */ }
}

// === FeedbackLoops Class ===

export class FeedbackLoops {
  private readonly stateDir: string;
  private readonly options: FeedbackLoopsOptions;
  private readonly corePerceptions: Set<string>;
  private readonly errorThreshold: number;
  private readonly citationEvalPeriod: number;
  private readonly qualityWindowSize: number;

  constructor(options: FeedbackLoopsOptions) {
    this.stateDir = options.stateDir;
    this.options = options;
    this.corePerceptions = new Set(options.corePerceptions ?? [
      'workspace', 'system', 'self',
    ]);
    this.errorThreshold = options.errorThreshold ?? 3;
    this.citationEvalPeriod = options.citationEvalPeriod ?? 50;
    this.qualityWindowSize = options.qualityWindowSize ?? 20;

    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true });
    }
  }

  /** Run all feedback loops after a cycle. Fire-and-forget. */
  async runAll(action: string | null, errorLogs?: ErrorLogEntry[]): Promise<void> {
    await Promise.allSettled([
      this.detectErrorPatterns(errorLogs ?? []),
      this.trackCitations(action),
      this.auditQuality(action),
    ]);
  }

  // === Loop A: Error Pattern Detection ===

  async detectErrorPatterns(errors: ErrorLogEntry[]): Promise<void> {
    if (errors.length === 0) return;

    const statePath = path.join(this.stateDir, 'error-patterns.json');
    const state = readJsonState<ErrorPatternState>(statePath, {});
    const today = new Date().toISOString().split('T')[0];

    // Group by (context + error code)
    const groups = new Map<string, number>();
    for (const err of errors) {
      const context = err.context ?? 'unknown';
      const errorMsg = err.error ?? '';
      const codeMatch = errorMsg.match(/^([A-Z_]+(?::[A-Z_]+)?)|^(\w+Error)/);
      const code = codeMatch?.[0] ?? errorMsg.slice(0, 30);
      const key = `${code}::${context}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }

    let changed = false;

    for (const [key, count] of groups) {
      if (count < this.errorThreshold) continue;

      const existing = state[key];
      if (existing?.taskCreated) {
        existing.count = count;
        existing.lastSeen = today;
        changed = true;
        continue;
      }

      state[key] = { count, taskCreated: true, lastSeen: today };
      changed = true;

      const [code, context] = key.split('::');
      if (this.options.onErrorPattern) {
        try {
          await this.options.onErrorPattern(`Recurring error: ${code} in ${context} (${count}×)`);
        } catch { /* fire-and-forget */ }
      }
      slog('feedback', `Error pattern: ${key} (${count}×) → task created`);
    }

    // Clean up patterns not seen in 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().split('T')[0];
    for (const key of Object.keys(state)) {
      if (state[key].lastSeen < sevenDaysAgo) {
        slog('feedback', `Error pattern resolved: ${key}`);
        delete state[key];
        changed = true;
      }
    }

    if (changed) writeJsonState(statePath, state);
  }

  // === Loop B: Perception Citation Tracking ===

  async trackCitations(action: string | null): Promise<void> {
    if (!action) return;

    const statePath = path.join(this.stateDir, 'perception-citations.json');
    const state = readJsonState<CitationState>(statePath, {
      cycleCount: 0,
      citations: {},
      lastAdjusted: '',
    });

    // Extract <section-name> references from action text
    const skipTags = new Set(['br', 'p', 'div', 'span', 'b', 'i', 'a', 'ul', 'li', 'ol']);
    for (const m of action.matchAll(/<(\w[\w-]+)>/g)) {
      if (!skipTags.has(m[1])) {
        state.citations[m[1]] = (state.citations[m[1]] ?? 0) + 1;
      }
    }

    state.cycleCount++;

    // Evaluate and adjust every N cycles
    if (state.cycleCount % this.citationEvalPeriod === 0 && state.cycleCount > 0) {
      const total = Object.values(state.citations).reduce((s, v) => s + v, 0);
      if (total > 0) {
        for (const [name, count] of Object.entries(state.citations)) {
          if (this.corePerceptions.has(name)) continue;

          const rate = count / total;
          if (rate < 0.05 && this.options.onAdjustInterval) {
            this.options.onAdjustInterval(name, 30 * 60_000);
            slog('feedback', `Low citation: ${name} (${(rate * 100).toFixed(1)}%) → slowed`);
          } else if (rate >= 0.15 && this.options.onRestoreInterval) {
            this.options.onRestoreInterval(name);
            slog('feedback', `Citation recovered: ${name} (${(rate * 100).toFixed(1)}%) → restored`);
          }
        }
        state.lastAdjusted = new Date().toISOString().split('T')[0];
      }
    }

    writeJsonState(statePath, state);
  }

  // === Loop C: Decision Quality Audit ===

  async auditQuality(action: string | null): Promise<void> {
    if (!action) return;

    const statePath = path.join(this.stateDir, 'decision-quality.json');
    const state = readJsonState<DecisionQualityState>(statePath, {
      recentScores: [],
      avgScore: 0,
      warningInjected: false,
      lastWarningAt: null,
    });

    // Score observability (0-6)
    let score = 0;
    if (/##\s*Decision|\[DECISION\]/i.test(action)) score++;
    if (/chose:|selected:|decided:/i.test(action)) score++;
    if (/why:|because:|reason:/i.test(action)) score++;
    if (/skipped:|rejected:|not:/i.test(action)) score++;
    if (/verified:|confirmed:|checked:/i.test(action)) score++;
    if (/context:|given:|based on:/i.test(action)) score++;

    state.recentScores.push(score);
    if (state.recentScores.length > this.qualityWindowSize) {
      state.recentScores = state.recentScores.slice(-this.qualityWindowSize);
    }

    const avg = state.recentScores.reduce((s, v) => s + v, 0) / state.recentScores.length;
    state.avgScore = Math.round(avg * 100) / 100;

    // Warn if quality drops below 3.0 (24h cooldown)
    const cooldownMs = 24 * 60 * 60_000;
    const cooledDown = !state.lastWarningAt ||
      Date.now() - new Date(state.lastWarningAt).getTime() > cooldownMs;

    if (avg < 3.0 && cooledDown && state.recentScores.length >= this.qualityWindowSize) {
      state.warningInjected = true;
      state.lastWarningAt = new Date().toISOString();
      if (this.options.onQualityWarning) {
        this.options.onQualityWarning(state.avgScore);
      }
      slog('feedback', `Decision quality low: avg ${state.avgScore}/${this.qualityWindowSize} cycles`);
    } else {
      state.warningInjected = false;
    }

    writeJsonState(statePath, state);
  }

  /** Get current decision quality state (for context injection) */
  getQualityState(): { avgScore: number; warningActive: boolean } | null {
    const statePath = path.join(this.stateDir, 'decision-quality.json');
    const state = readJsonState<DecisionQualityState>(statePath, {
      recentScores: [],
      avgScore: 0,
      warningInjected: false,
      lastWarningAt: null,
    });
    if (state.recentScores.length === 0) return null;
    return { avgScore: state.avgScore, warningActive: state.warningInjected };
  }
}
