import { EventEmitter } from 'node:events';

// === Types ===

/**
 * Agent event with metadata.
 * Event types follow namespace convention: 'category:name'
 * (e.g. 'trigger:workspace', 'action:chat', 'log:error')
 */
export interface AgentEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: Date;
  priority?: string;
  source?: string;
}

/** Exact event type or wildcard pattern (e.g. 'trigger:*') */
export type EventPattern = string;
export type EventHandler = (event: AgentEvent) => void;

// === Event Bus ===

export class EventBus {
  private emitter = new EventEmitter();

  constructor(maxListeners = 20) {
    this.emitter.setMaxListeners(maxListeners);
  }

  emit(
    type: string,
    data: Record<string, unknown> = {},
    meta?: { priority?: string; source?: string },
  ): void {
    const event: AgentEvent = {
      type,
      data,
      timestamp: new Date(),
      ...(meta?.priority ? { priority: meta.priority } : {}),
      ...(meta?.source ? { source: meta.source } : {}),
    };
    this.emitter.emit(type, event);
    // Wildcard: 'prefix:*' listeners receive all events in that namespace
    const colon = type.indexOf(':');
    if (colon > 0) {
      this.emitter.emit(`${type.slice(0, colon)}:*`, event);
    }
  }

  on(pattern: EventPattern, handler: EventHandler): this {
    this.emitter.on(pattern, handler);
    return this;
  }

  off(pattern: EventPattern, handler: EventHandler): this {
    this.emitter.off(pattern, handler);
    return this;
  }

  once(pattern: EventPattern, handler: EventHandler): this {
    this.emitter.once(pattern, handler);
    return this;
  }

  removeAllListeners(pattern?: EventPattern): this {
    if (pattern) {
      this.emitter.removeAllListeners(pattern);
    } else {
      this.emitter.removeAllListeners();
    }
    return this;
  }

  listenerCount(pattern: EventPattern): number {
    return this.emitter.listenerCount(pattern);
  }
}

// === Reactive Primitives ===

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): ((...args: A) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: A): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  debounced.cancel = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}

export function distinctUntilChanged<T>(
  hashFn: (value: T) => string,
): (value: T) => boolean {
  let lastHash: string | null = null;
  return (value: T): boolean => {
    const hash = hashFn(value);
    if (hash !== lastHash) {
      lastHash = hash;
      return true;
    }
    return false;
  };
}
