/**
 * Perception Stream Manager
 *
 * Manages perception plugin lifecycle: polling, caching, change detection,
 * health monitoring, circuit breaking, and auto-restart.
 *
 * Each plugin runs independently on its own interval. Results are cached
 * and served to context builders on demand — no blocking.
 *
 * Key patterns (battle-tested in production):
 * - distinctUntilChanged: only increment version when output actually changes
 * - Circuit breaker: 3 consecutive timeouts → double interval
 * - Health check: detect stale plugins, auto-restart up to 3 times
 * - Backpressure metrics: per-plugin duration/timeout/run tracking
 */

import crypto from 'node:crypto';
import { distinctUntilChanged } from '../core/event-bus.js';
import { executePlugin } from './executor.js';
import type {
  PerceptionConfig,
  PerceptionPlugin,
  PerceptionResult,
  PerceptionStats,
} from './types.js';

// === Internal types ===

interface StreamEntry {
  plugin: PerceptionPlugin;
  category: string;
  effectiveInterval: number;
  result: PerceptionResult | null;
  hash: string | null;
  updatedAt: Date | null;
  timer: ReturnType<typeof setInterval> | null;
  isChanged: (hash: string) => boolean;
  // Backpressure metrics
  lastDurationMs: number;
  timeoutCount: number;
  totalRunMs: number;
  runCount: number;
  // Auto-restart tracking
  consecutiveFailures: number;
  restartCount: number;
  lastRestartAt: Date | null;
}

// === Defaults ===

const DEFAULT_INTERVAL = 60_000;    // 1 min
const DEFAULT_TIMEOUT = 10_000;     // 10s
const MIN_INTERVAL = 30_000;        // 30s floor
const MAX_INTERVAL = 30 * 60_000;   // 30min ceiling
const HEALTH_CHECK_INTERVAL = 5 * 60_000; // 5 min
const MAX_RESTARTS = 3;
const CIRCUIT_BREAKER_THRESHOLD = 3;

// === Manager ===

export class PerceptionManager {
  private streams = new Map<string, StreamEntry>();
  private cwd = '';
  private pluginEnv: Record<string, string> | undefined;
  private running = false;
  private _version = 0;
  private lastBuildHashes = new Map<string, string>();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private config: PerceptionConfig | null = null;

  /** Monotonically increasing version — increments when any plugin output changes */
  get version(): number {
    return this._version;
  }

  /**
   * Start all perception streams.
   * Fires initial tick for each plugin, then schedules polling.
   */
  start(config: PerceptionConfig): void {
    if (this.running) this.stop();
    this.config = config;
    this.cwd = config.cwd;
    this.pluginEnv = config.pluginEnv;
    this.running = true;

    for (const plugin of config.plugins) {
      if (plugin.enabled === false) continue;

      const category = plugin.category ?? 'default';
      const effectiveInterval = this.resolveInterval(plugin, config);

      const entry: StreamEntry = {
        plugin,
        category,
        effectiveInterval,
        result: null,
        hash: null,
        updatedAt: null,
        timer: null,
        isChanged: distinctUntilChanged<string>(h => h),
        lastDurationMs: 0,
        timeoutCount: 0,
        totalRunMs: 0,
        runCount: 0,
        consecutiveFailures: 0,
        restartCount: 0,
        lastRestartAt: null,
      };

      this.streams.set(plugin.name, entry);

      // Initial tick (fire-and-forget)
      this.tick(entry);

      // Schedule polling (skip event-driven plugins with interval=0)
      if (effectiveInterval > 0) {
        entry.timer = setInterval(() => this.tick(entry), effectiveInterval);
      }
    }

    // Periodic health check
    if (this.streams.size > 0) {
      this.healthCheckTimer = setInterval(
        () => this.healthCheck(),
        HEALTH_CHECK_INTERVAL,
      );
    }
  }

  /** Stop all streams and clean up timers */
  stop(): void {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    this.healthCheckTimer = null;
    for (const entry of this.streams.values()) {
      if (entry.timer) clearInterval(entry.timer);
    }
    this.streams.clear();
    this.running = false;
    this.config = null;
  }

  /** Whether streams are actively running */
  isActive(): boolean {
    return this.running && this.streams.size > 0;
  }

  /**
   * Get cached results for context building.
   * Returns only plugins that have produced output.
   */
  getCachedResults(): PerceptionResult[] {
    return [...this.streams.values()]
      .filter(e => e.result?.output)
      .map(e => e.result!);
  }

  /**
   * Check if a plugin's output changed since the last context build.
   */
  hasChangedSinceLastBuild(name: string): boolean {
    const entry = this.streams.get(name);
    if (!entry?.hash) return true;
    return this.lastBuildHashes.get(name) !== entry.hash;
  }

  /** Mark current hashes as seen — call after building context */
  markContextBuilt(): void {
    for (const [name, entry] of this.streams) {
      if (entry.hash) this.lastBuildHashes.set(name, entry.hash);
    }
    // Prune stale entries
    for (const key of this.lastBuildHashes.keys()) {
      if (!this.streams.has(key)) this.lastBuildHashes.delete(key);
    }
  }

  /**
   * Count how many plugins changed since last context build.
   * More changes = more likely the next cycle will be productive.
   */
  getChangedCount(): number {
    let count = 0;
    for (const [name, entry] of this.streams) {
      if (!entry.hash) continue;
      if (this.lastBuildHashes.get(name) !== entry.hash) count++;
    }
    return count;
  }

  /**
   * Dynamically adjust a plugin's polling interval.
   * Enforces min/max bounds.
   */
  adjustInterval(name: string, newInterval: number): void {
    const entry = this.streams.get(name);
    if (!entry || !entry.timer) return;
    const bounded = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, newInterval));
    clearInterval(entry.timer);
    entry.effectiveInterval = bounded;
    entry.timer = setInterval(() => this.tick(entry), bounded);
  }

  /** Restore a plugin's interval to its configured default */
  restoreDefaultInterval(name: string): void {
    if (!this.config) return;
    const entry = this.streams.get(name);
    if (!entry) return;
    const defaultInterval = this.resolveInterval(entry.plugin, this.config);
    this.adjustInterval(name, defaultInterval);
  }

  /** Force immediate refresh of all active streams */
  async refreshAll(): Promise<void> {
    if (!this.running) return;
    await Promise.allSettled(
      [...this.streams.values()].map(entry => this.tick(entry)),
    );
  }

  /** Get performance stats for all plugins */
  getStats(): PerceptionStats[] {
    const now = Date.now();
    return [...this.streams.entries()].map(([name, e]) => {
      const ageMs = e.updatedAt ? now - e.updatedAt.getTime() : null;
      const healthy =
        e.runCount > 0 &&
        e.timeoutCount < CIRCUIT_BREAKER_THRESHOLD &&
        (e.effectiveInterval === 0 ||
          ageMs === null ||
          ageMs < e.effectiveInterval * 3);
      return {
        name,
        category: e.category,
        interval: e.effectiveInterval,
        updatedAt: e.updatedAt?.toISOString() ?? null,
        ageMs,
        avgMs: e.runCount > 0 ? Math.round(e.totalRunMs / e.runCount) : 0,
        timeouts: e.timeoutCount,
        runCount: e.runCount,
        restarts: e.restartCount,
        healthy,
      };
    });
  }

  /**
   * Trigger an event-driven plugin immediately (for plugins with interval=0).
   * Use this to wire external events to perception updates.
   */
  trigger(name: string): void {
    const entry = this.streams.get(name);
    if (entry) this.tick(entry);
  }

  // === Internal ===

  private resolveInterval(
    plugin: PerceptionPlugin,
    config: PerceptionConfig,
  ): number {
    // Plugin-level override takes priority
    if (plugin.interval !== undefined) return plugin.interval;
    // Category-level default
    const category = plugin.category ?? 'default';
    if (config.categoryIntervals?.[category] !== undefined) {
      return config.categoryIntervals[category];
    }
    // Global default
    return config.defaultInterval ?? DEFAULT_INTERVAL;
  }

  /**
   * Health check — detect stale plugins and auto-restart.
   * A plugin is stale if it hasn't updated in 5x its interval (min 5 min).
   */
  private healthCheck(): void {
    const now = Date.now();
    for (const [name, entry] of this.streams) {
      if (entry.effectiveInterval === 0) continue; // skip event-driven

      const ageMs = entry.updatedAt ? now - entry.updatedAt.getTime() : now;
      const staleThreshold = Math.max(
        entry.effectiveInterval * 5,
        HEALTH_CHECK_INTERVAL,
      );

      if (ageMs > staleThreshold && entry.restartCount < MAX_RESTARTS) {
        this.restartPlugin(name);
      }
    }
  }

  private restartPlugin(name: string): void {
    const entry = this.streams.get(name);
    if (!entry) return;

    if (entry.timer) clearInterval(entry.timer);

    entry.timeoutCount = 0;
    entry.consecutiveFailures = 0;
    entry.restartCount++;
    entry.lastRestartAt = new Date();

    // Immediate tick
    this.tick(entry);

    // Restore interval
    if (entry.effectiveInterval > 0) {
      entry.timer = setInterval(() => this.tick(entry), entry.effectiveInterval);
    }
  }

  private async tick(entry: StreamEntry): Promise<void> {
    if (!this.running) return;

    // Circuit breaker: consecutive timeouts → double interval
    if (entry.timeoutCount >= CIRCUIT_BREAKER_THRESHOLD) {
      this.adjustInterval(entry.plugin.name, entry.effectiveInterval * 2);
      entry.timeoutCount = 0;
      return;
    }

    const timeoutMs = entry.plugin.timeout ?? this.config?.defaultTimeout ?? DEFAULT_TIMEOUT;
    let result: PerceptionResult;

    const start = Date.now();
    try {
      result = await Promise.race([
        executePlugin(entry.plugin, this.cwd, this.pluginEnv),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Plugin ${entry.plugin.name} timed out`)),
            timeoutMs,
          ),
        ),
      ]);
      entry.timeoutCount = 0;
      if (entry.consecutiveFailures > 0) {
        entry.consecutiveFailures = 0;
        this.restoreDefaultInterval(entry.plugin.name);
      }
    } catch {
      entry.timeoutCount++;
      entry.consecutiveFailures++;
      return;
    }

    entry.lastDurationMs = Date.now() - start;
    entry.totalRunMs += entry.lastDurationMs;
    entry.runCount++;

    const hash = crypto
      .createHash('md5')
      .update(result.output ?? '')
      .digest('hex');

    entry.result = result;
    entry.updatedAt = new Date();

    if (entry.isChanged(hash)) {
      entry.hash = hash;
      this._version++;
    }
  }
}
