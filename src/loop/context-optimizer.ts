/**
 * Context Optimizer — citation-driven section management.
 *
 * Tracks which context sections the LLM actually references.
 * After sustained zero citations, demotes sections from always-load
 * to conditional-load (keyword-gated). Auto-promotes when cited again.
 *
 * This reduces context window waste without losing information —
 * demoted sections are still available, just not loaded by default.
 *
 * Generalized from mini-agent's context-optimizer.ts:
 * - No singleton — instantiate with config
 * - Protected sections and keywords are configurable
 * - State stored as JSON in configurable directory
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { slog } from '../logging/index.js';

// === Types ===

export interface SectionDemotionState {
  zeroCounts: Record<string, number>;
  demoted: Record<string, { demotedAt: string; keywords: string[] }>;
  observation: Record<string, { promotedAt: string; remainingCycles: number }>;
  totalCycles: number;
}

export interface ContextOptimizerOptions {
  /** Directory to store optimizer state */
  stateDir: string;
  /** Sections that must never be demoted */
  protectedSections?: string[];
  /** Section → keyword mapping for conditional loading */
  sectionKeywords?: Record<string, string[]>;
  /** Consecutive zero-citation cycles before demotion (default: 50) */
  demotionThreshold?: number;
  /** Observation period after promotion in cycles (default: 50) */
  observationCycles?: number;
}

// === Implementation ===

export class ContextOptimizer {
  private state: SectionDemotionState;
  private readonly statePath: string;
  private readonly protectedSections: Set<string>;
  private readonly sectionKeywords: Record<string, string[]>;
  private readonly demotionThreshold: number;
  private readonly observationCycles: number;

  constructor(options: ContextOptimizerOptions) {
    this.statePath = path.join(options.stateDir, 'context-optimizer.json');
    this.protectedSections = new Set(options.protectedSections ?? [
      'soul', 'inbox', 'workspace', 'memory', 'self',
    ]);
    this.sectionKeywords = options.sectionKeywords ?? {};
    this.demotionThreshold = options.demotionThreshold ?? 50;
    this.observationCycles = options.observationCycles ?? 50;

    if (!existsSync(options.stateDir)) {
      mkdirSync(options.stateDir, { recursive: true });
    }

    this.state = this.loadState();
  }

  private loadState(): SectionDemotionState {
    if (!existsSync(this.statePath)) {
      return { zeroCounts: {}, demoted: {}, observation: {}, totalCycles: 0 };
    }
    try {
      return JSON.parse(readFileSync(this.statePath, 'utf-8'));
    } catch {
      return { zeroCounts: {}, demoted: {}, observation: {}, totalCycles: 0 };
    }
  }

  /** Save state to disk */
  save(): void {
    try {
      writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch { /* best effort */ }
  }

  /**
   * Record a cycle's citation data.
   * Call this after each OODA cycle with the sections that were referenced.
   */
  recordCycle(data: { citedSections: string[] }): void {
    this.state.totalCycles++;
    const cited = new Set(data.citedSections);

    // Track zero-citation streaks for all known sections
    const allSections = new Set([
      ...Object.keys(this.state.zeroCounts),
      ...Object.keys(this.sectionKeywords),
    ]);

    for (const section of allSections) {
      if (this.protectedSections.has(section)) continue;

      if (cited.has(section)) {
        // Section was cited — reset counter
        this.state.zeroCounts[section] = 0;

        // If demoted, promote back
        if (this.state.demoted[section]) {
          delete this.state.demoted[section];
          this.state.observation[section] = {
            promotedAt: new Date().toISOString(),
            remainingCycles: this.observationCycles,
          };
          slog('optimizer', `Auto-promoted: ${section} (cited after demotion)`);
        }
      } else {
        // Not cited — increment streak
        this.state.zeroCounts[section] = (this.state.zeroCounts[section] ?? 0) + 1;

        // Check for demotion
        if (
          this.state.zeroCounts[section] >= this.demotionThreshold &&
          !this.state.demoted[section] &&
          this.sectionKeywords[section]
        ) {
          this.state.demoted[section] = {
            demotedAt: new Date().toISOString(),
            keywords: this.sectionKeywords[section],
          };
          slog('optimizer', `Demoted: ${section} (${this.demotionThreshold} cycles uncited)`);
        }
      }
    }

    // Tick observation periods
    for (const [section, obs] of Object.entries(this.state.observation)) {
      obs.remainingCycles--;
      if (obs.remainingCycles <= 0) {
        delete this.state.observation[section];
      }
    }
  }

  /**
   * Check if a section should be loaded.
   * Returns true if the section should be included in context.
   */
  shouldLoad(section: string, contextHints?: string[]): boolean {
    // Protected sections always load
    if (this.protectedSections.has(section)) return true;

    // Not demoted → always load
    if (!this.state.demoted[section]) return true;

    // Demoted → load only if context hints contain matching keywords
    if (!contextHints || contextHints.length === 0) return false;
    const keywords = this.state.demoted[section].keywords;
    const hintsLower = contextHints.map(h => h.toLowerCase());
    return keywords.some(kw => hintsLower.some(h => h.includes(kw)));
  }

  /** Get list of currently demoted sections */
  getDemotedSections(): string[] {
    return Object.keys(this.state.demoted);
  }

  /** Get list of sections in observation */
  getObservationSections(): string[] {
    return Object.keys(this.state.observation);
  }

  /** Get total cycles tracked */
  get totalCycles(): number {
    return this.state.totalCycles;
  }
}
