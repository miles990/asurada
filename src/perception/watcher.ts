/**
 * File Watcher — watches files/directories and emits events on changes.
 *
 * Uses Node.js fs.watch with debouncing and change detection.
 * Integrates with EventBus to trigger perception cycles.
 *
 * Generalized from mini-agent's watcher.ts — watches any file, not just compose.
 */

import fs from 'node:fs';
import type { EventBus } from '../core/event-bus.js';
import { slog } from '../logging/index.js';

export interface FileWatcherOptions {
  /** Files/directories to watch */
  paths: string[];
  /** EventBus to emit events on */
  events: EventBus;
  /** Debounce interval in ms (default: 300) */
  debounceMs?: number;
  /** Event type to emit (default: 'trigger:workspace') */
  eventType?: string;
}

interface WatchEntry {
  path: string;
  watcher: fs.FSWatcher | null;
  lastContent: string;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

export class FileWatcher {
  private entries: WatchEntry[] = [];
  private readonly events: EventBus;
  private readonly debounceMs: number;
  private readonly eventType: string;

  constructor(options: FileWatcherOptions) {
    this.events = options.events;
    this.debounceMs = options.debounceMs ?? 300;
    this.eventType = options.eventType ?? 'trigger:workspace';

    for (const p of options.paths) {
      this.entries.push({
        path: p,
        watcher: null,
        lastContent: '',
        debounceTimer: null,
      });
    }
  }

  /** Start watching all configured paths */
  start(): void {
    for (const entry of this.entries) {
      if (!fs.existsSync(entry.path)) {
        slog('watcher', `Path not found, skipping: ${entry.path}`);
        continue;
      }

      try {
        entry.lastContent = fs.readFileSync(entry.path, 'utf-8');
      } catch {
        entry.lastContent = '';
      }

      try {
        entry.watcher = fs.watch(entry.path, (eventType) => {
          if (eventType !== 'change') return;
          this.handleChange(entry);
        });
        slog('watcher', `Watching: ${entry.path}`);
      } catch (err) {
        slog('watcher', `Failed to watch ${entry.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** Stop all watchers */
  stop(): void {
    for (const entry of this.entries) {
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
        entry.debounceTimer = null;
      }
      if (entry.watcher) {
        entry.watcher.close();
        entry.watcher = null;
      }
    }
    this.entries = [];
  }

  private handleChange(entry: WatchEntry): void {
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
    }

    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null;

      let newContent: string;
      try {
        newContent = fs.readFileSync(entry.path, 'utf-8');
      } catch {
        return;
      }

      if (newContent === entry.lastContent) return;
      entry.lastContent = newContent;

      slog('watcher', `Change detected: ${entry.path}`);
      this.events.emit(this.eventType, {
        path: entry.path,
        timestamp: new Date().toISOString(),
      });
    }, this.debounceMs);
  }
}
