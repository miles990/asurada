/**
 * Hesitation Analysis — deterministic meta-cognitive constraint.
 *
 * A pure-function hesitation checker that sits between LLM response parsing
 * and action execution. Zero API calls, zero tokens — regex matching + counting
 * produces a hesitation score. High scores can trigger behavior modulation
 * (hold actions, add hedging, inject reflection).
 *
 * Design: isomorphic with ModelRouter — deterministic, zero cost, interruptible.
 * This is a ritual constraint: it doesn't filter content, it transforms the
 * reasoner's state.
 *
 * Generalized from mini-agent's hesitation.ts:
 * - No singleton state — instantiate with config
 * - Pluggable tag interface (generic action map instead of ParsedTags)
 * - State stored as JSON files in a configurable directory
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { slog } from '../logging/index.js';

// =============================================================================
// Types
// =============================================================================

export interface HesitationSignal {
  type: 'overconfidence' | 'error-pattern' | 'no-source' | 'no-hedge' | 'absolute-claim';
  detail: string;
  weight: number;
}

export interface HesitationResult {
  /** 0-100, higher = more uncertain */
  score: number;
  /** score < threshold */
  confident: boolean;
  signals: HesitationSignal[];
  /** Reflection hint for next cycle */
  suggestion: string;
}

export interface ErrorPattern {
  id: string;
  keywords: string[];
  description: string;
  source: 'correction' | 'self-review' | 'external';
  createdAt: string;
  triggerCount: number;
}

export interface HeldAction {
  type: string;
  data: unknown;
  hesitation: { score: number; signals: string[] };
  heldAt: string;
}

interface HesitationState {
  heldActions: HeldAction[];
  errorPatterns: ErrorPattern[];
}

export interface HesitationOptions {
  /** Directory to store state files */
  stateDir: string;
  /** Score threshold for confidence (default: 30) */
  threshold?: number;
  /** Max error patterns to keep (default: 50) */
  maxPatterns?: number;
  /** Additional absolute-claim regex patterns (merged with defaults) */
  absoluteTerms?: RegExp;
  /** Additional hedging regex patterns (merged with defaults) */
  hedgeTerms?: RegExp;
}

// =============================================================================
// Constants — Default Regex Patterns
// =============================================================================

const DEFAULT_ABSOLUTE_RE = /一定|不可能|顯然|毫無疑問|肯定是|clearly|obviously|definitely|impossible|certainly|undoubtedly/gi;
const SOURCE_RE = /來源|source|ref:|https?:\/\//i;
const DEFAULT_HEDGE_RE = /我不確定|也許|可能|但我不太肯定|需要確認|我的理解是|not sure|maybe|might|I think|perhaps|arguably/i;
const CONCLUSION_RE = /所以|因此|結論|答案是|therefore|conclusion|the answer|總之|簡言之/gi;
const REASONING_RE = /因為|考慮到|另一方面|但是|however|because|on the other hand|alternatively|不過|雖然|儘管/gi;

const DEFAULT_THRESHOLD = 30;
const DEFAULT_MAX_PATTERNS = 50;

// =============================================================================
// Core: hesitate() — Pure function, zero side effects
// =============================================================================

/**
 * Analyze a response for hesitation signals.
 * Pure function — no state, no side effects.
 *
 * @param response - The full LLM response text
 * @param chatTexts - Array of chat/communication texts extracted from action tags
 * @param errorPatterns - Known error patterns to match against
 * @param options - Override default regex patterns and threshold
 */
export function hesitate(
  response: string,
  chatTexts: string[],
  errorPatterns: ErrorPattern[],
  options?: { threshold?: number; absoluteRe?: RegExp; hedgeRe?: RegExp },
): HesitationResult {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const absoluteRe = options?.absoluteRe ?? DEFAULT_ABSOLUTE_RE;
  const hedgeRe = options?.hedgeRe ?? DEFAULT_HEDGE_RE;
  const signals: HesitationSignal[] = [];

  // Signal 1: Absolute claims without sources
  const absoluteMatches = response.match(absoluteRe);
  const hasSources = SOURCE_RE.test(response);
  if (absoluteMatches && !hasSources) {
    signals.push({
      type: 'absolute-claim',
      detail: `${absoluteMatches.length} absolute claim(s) without source`,
      weight: 20,
    });
  }

  // Signal 2: Matches past error patterns
  if (errorPatterns.length > 0) {
    const responseLower = response.toLowerCase();
    for (const pattern of errorPatterns) {
      if (pattern.keywords.some(kw => responseLower.includes(kw.toLowerCase()))) {
        signals.push({
          type: 'error-pattern',
          detail: `matches past error: ${pattern.description}`,
          weight: 30,
        });
        break; // only first match
      }
    }
  }

  // Signal 3: Long chat response without hedging
  if (chatTexts.length > 0) {
    const chatText = chatTexts.join(' ');
    if (!hedgeRe.test(chatText) && chatText.length > 200) {
      signals.push({
        type: 'no-hedge',
        detail: 'long chat response with no hedging language',
        weight: 15,
      });
    }
  }

  // Signal 4: More conclusions than reasoning
  const conclusionCount = (response.match(CONCLUSION_RE) || []).length;
  const reasoningCount = (response.match(REASONING_RE) || []).length;
  if (conclusionCount > 2 && reasoningCount < conclusionCount) {
    signals.push({
      type: 'overconfidence',
      detail: `${conclusionCount} conclusions vs ${reasoningCount} reasoning qualifiers`,
      weight: 15,
    });
  }

  const score = Math.min(100, signals.reduce((sum, s) => sum + s.weight, 0));

  return {
    score,
    confident: score < threshold,
    signals,
    suggestion: signals.length > 0
      ? `Hesitation (score=${score}): ${signals.map(s => s.type).join(', ')}`
      : '',
  };
}

// =============================================================================
// State Management
// =============================================================================

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
    writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  } catch { /* best effort */ }
}

// =============================================================================
// HesitationAnalyzer Class
// =============================================================================

export class HesitationAnalyzer {
  private readonly stateDir: string;
  private readonly threshold: number;
  private readonly maxPatterns: number;
  private readonly absoluteRe: RegExp;
  private readonly hedgeRe: RegExp;

  constructor(options: HesitationOptions) {
    this.stateDir = options.stateDir;
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
    this.maxPatterns = options.maxPatterns ?? DEFAULT_MAX_PATTERNS;
    this.absoluteRe = options.absoluteTerms ?? DEFAULT_ABSOLUTE_RE;
    this.hedgeRe = options.hedgeTerms ?? DEFAULT_HEDGE_RE;

    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true });
    }
  }

  private get statePath(): string {
    return path.join(this.stateDir, 'hesitation-state.json');
  }

  private get logPath(): string {
    return path.join(this.stateDir, 'hesitation-log.jsonl');
  }

  private loadState(): HesitationState {
    return readJsonState<HesitationState>(this.statePath, {
      heldActions: [],
      errorPatterns: [],
    });
  }

  private saveState(state: HesitationState): void {
    writeJsonState(this.statePath, state);
  }

  /**
   * Run hesitation analysis on a response.
   *
   * @param response - Full LLM response text
   * @param chatTexts - Extracted chat/communication texts
   */
  analyze(response: string, chatTexts: string[] = []): HesitationResult {
    const state = this.loadState();
    return hesitate(response, chatTexts, state.errorPatterns, {
      threshold: this.threshold,
      absoluteRe: this.absoluteRe,
      hedgeRe: this.hedgeRe,
    });
  }

  /** Load error patterns from state file */
  getErrorPatterns(): ErrorPattern[] {
    return this.loadState().errorPatterns;
  }

  /** Save held actions for review in next cycle */
  holdActions(held: HeldAction[]): void {
    if (held.length === 0) return;
    const state = this.loadState();
    state.heldActions = held; // replace, not append — only latest hold matters
    this.saveState(state);
    slog('hesitation', `Held ${held.length} action(s) for review: ${held.map(h => h.type).join(', ')}`);
  }

  /** Get and clear held actions (for next cycle to review) */
  drainHeldActions(): HeldAction[] {
    const state = this.loadState();
    if (state.heldActions.length === 0) return [];
    const held = state.heldActions;
    state.heldActions = [];
    this.saveState(state);
    return held;
  }

  /** Build review prompt for held actions */
  buildReviewPrompt(held: HeldAction[]): string {
    if (held.length === 0) return '';

    const lines = [
      '## Hesitation Review — Actions held from previous cycle',
      '',
      'The following actions were held due to high hesitation score. Review and decide:',
      '- Confirmed correct → re-emit the action',
      '- Found issues → modify or discard',
      '',
    ];

    for (const h of held) {
      const signals = h.hesitation.signals.join(', ');
      lines.push(`### Held [${h.type.toUpperCase()}] (score=${h.hesitation.score}, signals: ${signals})`);
      lines.push('```');
      lines.push(typeof h.data === 'string' ? h.data.slice(0, 500) : JSON.stringify(h.data, null, 2).slice(0, 500));
      lines.push('```');
      lines.push('');
    }

    return lines.join('\n');
  }

  /** Log hesitation event for audit trail */
  logEvent(result: HesitationResult, action: string, cycleId?: number): void {
    try {
      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        score: result.score,
        signals: result.signals.map(s => s.type),
        action,
        cycleId,
      });
      appendFileSync(this.logPath, entry + '\n');
    } catch { /* best effort */ }
  }

  /** Add a new error pattern */
  addErrorPattern(pattern: {
    keywords: string[];
    description: string;
    source: 'correction' | 'self-review' | 'external';
  }): void {
    const state = this.loadState();
    const id = `ep-${Date.now()}`;
    state.errorPatterns.push({
      ...pattern,
      id,
      createdAt: new Date().toISOString(),
      triggerCount: 0,
    });
    // Keep max N patterns
    if (state.errorPatterns.length > this.maxPatterns) {
      state.errorPatterns = state.errorPatterns.slice(-this.maxPatterns);
    }
    this.saveState(state);
    slog('hesitation', `New error pattern: ${pattern.description}`);
  }

  /** Remove an error pattern by ID */
  removeErrorPattern(id: string): boolean {
    const state = this.loadState();
    const before = state.errorPatterns.length;
    state.errorPatterns = state.errorPatterns.filter(p => p.id !== id);
    if (state.errorPatterns.length < before) {
      this.saveState(state);
      return true;
    }
    return false;
  }
}
