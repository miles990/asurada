import type { EventBus } from '../core/event-bus.js';
import { slog } from '../logging/index.js';
import type { CycleRunner } from './types.js';

export type RoutingDecision = 'SKIP' | 'REFLECT' | 'ESCALATE';

export interface ModelRouterOptions {
  triageRunner: CycleRunner;
  reflectRunner: CycleRunner;
  escalateRunner: CycleRunner;
  reflectTasks?: string[];
  halfLifeMinutes?: number;
  threadFloor?: number;
  shadowMode?: boolean;
  events?: EventBus;
}

export interface RouteLogEvent {
  triage: RoutingDecision;
  executed: RoutingDecision;
  shadowMode: boolean;
  temperature: number;
}

export function calculateRoutingTemperature(
  lastHumanMessageAt: Date | null,
  hasActiveThread: boolean,
  halfLifeMinutes: number,
  threadFloor: number,
  nowMs = Date.now(),
): number {
  const safeHalfLife = Math.max(0, halfLifeMinutes);
  const safeFloor = clamp(threadFloor, 0, 1);

  let recency = 0;
  if (lastHumanMessageAt && safeHalfLife > 0) {
    const elapsedMs = Math.max(0, nowMs - lastHumanMessageAt.getTime());
    const decayWindowMs = safeHalfLife * 60_000;
    recency = clamp(1 - elapsedMs / decayWindowMs, 0, 1);
  }

  const threadSignal = hasActiveThread ? safeFloor : 0;
  return Math.max(recency, threadSignal);
}

export function buildTriagePrompt(
  cyclePrompt: string,
  reflectTasks: readonly string[],
  temperature: number,
): string {
  const trimmedCyclePrompt = cyclePrompt.slice(0, 500);
  const whitelist = reflectTasks.length > 0
    ? reflectTasks.join(', ')
    : '(none)';

  return [
    'Classify this agent cycle. Reply with exactly one word: SKIP, REFLECT, or ESCALATE.',
    `Reflect-task whitelist: ${whitelist}`,
    `Routing temperature: ${temperature.toFixed(3)} (0.0-1.0).`,
    'Cycle prompt excerpt:',
    trimmedCyclePrompt,
  ].join('\n\n');
}

export function parseRoutingDecision(response: string): RoutingDecision {
  const match = response.match(/\b(SKIP|REFLECT|ESCALATE)\b/i);
  if (!match) return 'ESCALATE';
  return match[1].toUpperCase() as RoutingDecision;
}

export class ModelRouter implements CycleRunner {
  private readonly triageRunner: CycleRunner;
  private readonly reflectRunner: CycleRunner;
  private readonly escalateRunner: CycleRunner;
  private readonly reflectTasks: string[];
  private readonly halfLifeMinutes: number;
  private readonly threadFloor: number;
  private readonly events?: EventBus;

  lastHumanMessageAt: Date | null = null;
  hasActiveThread = false;
  shadowMode: boolean;

  constructor(options: ModelRouterOptions) {
    this.triageRunner = options.triageRunner;
    this.reflectRunner = options.reflectRunner;
    this.escalateRunner = options.escalateRunner;
    this.reflectTasks = options.reflectTasks ?? [];
    this.halfLifeMinutes = options.halfLifeMinutes ?? 30;
    this.threadFloor = options.threadFloor ?? 0.35;
    this.shadowMode = options.shadowMode ?? false;
    this.events = options.events;
  }

  async run(prompt: string, systemPrompt: string): Promise<string> {
    const temperature = calculateRoutingTemperature(
      this.lastHumanMessageAt,
      this.hasActiveThread,
      this.halfLifeMinutes,
      this.threadFloor,
    );

    const triagePrompt = buildTriagePrompt(prompt, this.reflectTasks, temperature);

    let triageDecision: RoutingDecision = 'ESCALATE';
    try {
      const triageResponse = await this.triageRunner.run(triagePrompt, systemPrompt);
      triageDecision = parseRoutingDecision(triageResponse);
    } catch (err) {
      slog(
        'loop',
        `ModelRouter triage failed: ${err instanceof Error ? err.message : String(err)}; defaulting to ESCALATE`,
      );
    }

    const executedDecision: RoutingDecision = this.shadowMode ? 'ESCALATE' : triageDecision;
    this.logDecision({
      triage: triageDecision,
      executed: executedDecision,
      shadowMode: this.shadowMode,
      temperature,
    });

    if (executedDecision === 'SKIP') {
      return '';
    }

    if (executedDecision === 'REFLECT') {
      return this.reflectRunner.run(prompt, systemPrompt);
    }

    return this.escalateRunner.run(prompt, systemPrompt);
  }

  private logDecision(event: RouteLogEvent): void {
    const { triage, executed, shadowMode, temperature } = event;
    slog(
      'loop',
      `ModelRouter route triage=${triage} executed=${executed} shadow=${shadowMode} temp=${temperature.toFixed(3)}`,
    );

    this.events?.emit('action:model-route', {
      triage,
      executed,
      shadowMode,
      temperature,
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
