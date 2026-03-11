/**
 * AgentLoop — the OODA heartbeat.
 *
 * Event/Timer → gatherPerception() → buildPrompt() → runner.run()
 *   → parseActions() → onAction() → scheduleNext()
 *
 * The loop listens for events on the EventBus and runs cycles.
 * Users bring their own LLM via CycleRunner.
 */

import type { EventBus, AgentEvent } from '../core/event-bus.js';
import type { PerceptionManager } from '../perception/manager.js';
import { slog } from '../logging/index.js';
import { parseActions, parseDuration } from './action-parser.js';
import type {
  AgentLoopOptions,
  CycleContext,
  CycleResult,
  CycleTrigger,
  ParsedAction,
} from './types.js';
import { ModelRouter } from './model-router.js';

export class AgentLoop {
  private readonly events: EventBus;
  private readonly perception: PerceptionManager;
  private readonly options: Required<
    Pick<AgentLoopOptions, 'defaultInterval' | 'minInterval' | 'maxInterval'>
  > & AgentLoopOptions;

  private cycleCount = 0;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentCycleAbort: AbortController | null = null;
  private eventHandlers: Array<{ pattern: string; handler: (e: AgentEvent) => void }> = [];
  private agentName: string;

  /** Tracked for ModelRouter: when did a human last send a message? */
  private lastHumanMessageAt: Date | null = null;
  /** Tracked for ModelRouter: is there an active conversation thread? */
  private hasActiveThread = false;

  constructor(
    events: EventBus,
    perception: PerceptionManager,
    agentName: string,
    options: AgentLoopOptions,
  ) {
    this.events = events;
    this.perception = perception;
    this.agentName = agentName;
    this.options = {
      defaultInterval: 300_000,  // 5m
      minInterval: 30_000,       // 30s
      maxInterval: 14_400_000,   // 4h
      ...options,
    };
  }

  /** Start the OODA loop */
  start(): void {
    if (this.running) return;
    this.running = true;
    slog('loop', `OODA loop started (interval: ${this.options.defaultInterval}ms)`);

    // Subscribe to trigger events
    const patterns = this.options.triggerPatterns ?? ['trigger:*'];
    for (const pattern of patterns) {
      const handler = (event: AgentEvent): void => {
        if (!this.running) return;
        // Track human message timing for ModelRouter
        if (event.type.includes('chat') || event.type.includes('telegram') || event.type.includes('room')) {
          this.lastHumanMessageAt = new Date();
          this.hasActiveThread = true;
        }
        this.triggerCycle({ type: 'event', event });
      };
      this.events.on(pattern, handler);
      this.eventHandlers.push({ pattern, handler });
    }

    // Schedule first cycle
    this.scheduleNext(this.options.defaultInterval);
  }

  /** Stop the OODA loop gracefully */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    // Cancel pending timer
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Abort current cycle if running
    if (this.currentCycleAbort) {
      this.currentCycleAbort.abort();
      this.currentCycleAbort = null;
    }

    // Unsubscribe from events
    for (const { pattern, handler } of this.eventHandlers) {
      this.events.off(pattern, handler);
    }
    this.eventHandlers = [];

    slog('loop', `OODA loop stopped after ${this.cycleCount} cycles`);
  }

  /** Manually trigger a cycle */
  trigger(): void {
    this.triggerCycle({ type: 'manual' });
  }

  /** Current cycle count */
  get cycles(): number {
    return this.cycleCount;
  }

  /** Whether the loop is running */
  get isRunning(): boolean {
    return this.running;
  }

  // === Internal ===

  private triggerCycle(trigger: CycleTrigger): void {
    // Debounce: if a cycle is already running, skip
    if (this.currentCycleAbort) {
      slog('loop', `Cycle already running — skipping trigger: ${trigger.type}`);
      return;
    }

    // Cancel pending timer (we're running now)
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // Run the cycle
    this.runCycle(trigger).catch(err => {
      slog('loop', `Cycle error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private async runCycle(trigger: CycleTrigger): Promise<CycleResult | null> {
    if (!this.running) return null;

    const abort = new AbortController();
    this.currentCycleAbort = abort;
    this.cycleCount++;
    const cycleNum = this.cycleCount;
    const start = Date.now();

    slog('loop', `Cycle #${cycleNum} start (trigger: ${trigger.type})`);
    this.events.emit('action:cycle', {
      event: 'start',
      cycle: cycleNum,
      trigger: trigger.type,
    });

    try {
      // 1. Gather perception
      const perception = this.gatherPerception();

      // 2. Build context
      const context: CycleContext = {
        perception,
        trigger,
        cycleNumber: cycleNum,
        agentName: this.agentName,
      };

      // 3. Build prompt
      const prompt = this.options.buildPrompt
        ? this.options.buildPrompt(context)
        : this.defaultPrompt(context);

      // 4. Get system prompt
      const systemPrompt = typeof this.options.systemPrompt === 'function'
        ? this.options.systemPrompt()
        : this.options.systemPrompt ?? '';

      // 5. Sync ModelRouter state (if applicable)
      if (this.options.runner instanceof ModelRouter) {
        this.options.runner.lastHumanMessageAt = this.lastHumanMessageAt;
        this.options.runner.hasActiveThread = this.hasActiveThread;
      }

      // 6. Call LLM
      if (abort.signal.aborted) return null;
      const response = await this.options.runner.run(prompt, systemPrompt);

      if (abort.signal.aborted) return null;

      // 6b. If ModelRouter SKIPped (empty response), clear active thread after decay
      if (this.options.runner instanceof ModelRouter && response === '') {
        this.hasActiveThread = false;
      }

      // 7. Parse actions
      const namespace = this.options.actionNamespace ?? this.agentName.toLowerCase() ?? 'agent';
      const actions = parseActions(response, namespace);

      // 7. Execute actions
      let nextInterval = this.options.defaultInterval;
      for (const action of actions) {
        if (abort.signal.aborted) break;

        // Handle schedule action specially
        if (action.tag === 'schedule' && action.attrs.next) {
          const ms = parseDuration(action.attrs.next);
          if (ms !== null) {
            nextInterval = Math.max(
              this.options.minInterval,
              Math.min(this.options.maxInterval, ms),
            );
            slog('loop', `Schedule: next in ${action.attrs.next} (${nextInterval}ms) — ${action.attrs.reason ?? ''}`);
          }
          continue;
        }

        // Call user-provided action handler
        if (this.options.onAction) {
          try {
            await this.options.onAction(action, context);
          } catch (err) {
            slog('loop', `Action handler error (${action.tag}): ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      const duration = Date.now() - start;
      const result: CycleResult = {
        response,
        actions,
        duration,
        cycleNumber: cycleNum,
      };

      slog('loop', `Cycle #${cycleNum} done (${duration}ms, ${actions.length} actions)`);
      this.events.emit('action:cycle', {
        event: 'complete',
        cycle: cycleNum,
        duration,
        actionCount: actions.length,
      });

      // Schedule next cycle
      if (this.running) {
        this.scheduleNext(nextInterval);
      }

      return result;
    } catch (err) {
      if (abort.signal.aborted) return null;

      const duration = Date.now() - start;
      slog('loop', `Cycle #${cycleNum} failed (${duration}ms): ${err instanceof Error ? err.message : String(err)}`);
      this.events.emit('action:cycle', {
        event: 'error',
        cycle: cycleNum,
        duration,
        error: err instanceof Error ? err.message : String(err),
      });

      // Schedule retry with backoff
      if (this.running) {
        this.scheduleNext(Math.min(this.options.defaultInterval * 2, this.options.maxInterval));
      }

      return null;
    } finally {
      this.currentCycleAbort = null;
    }
  }

  private gatherPerception(): Record<string, string> {
    const results: Record<string, string> = {};
    for (const entry of this.perception.getCachedResults()) {
      if (entry.output) {
        results[entry.name] = entry.output;
      }
    }
    return results;
  }

  private scheduleNext(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.running) {
        this.triggerCycle({ type: 'timer' });
      }
    }, ms);
  }

  private defaultPrompt(context: CycleContext): string {
    const parts: string[] = [];

    parts.push(`Cycle #${context.cycleNumber} | Trigger: ${context.trigger.type}`);

    if (Object.keys(context.perception).length > 0) {
      parts.push('\n## Perception\n');
      for (const [name, output] of Object.entries(context.perception)) {
        parts.push(`<${name}>\n${output}\n</${name}>\n`);
      }
    } else {
      parts.push('\n## Perception\n\nNo perception data available.\n');
    }

    if (context.trigger.type === 'event' && context.trigger.event) {
      parts.push(`\n## Trigger Event\n\nType: ${context.trigger.event.type}`);
      parts.push(`Data: ${JSON.stringify(context.trigger.event.data)}\n`);
    }

    return parts.join('\n');
  }
}
