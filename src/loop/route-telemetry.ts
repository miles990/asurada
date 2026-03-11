/**
 * RouteTelemetry — persistent JSONL log of routing decisions.
 *
 * Subscribes to EventBus 'action:model-route' events and appends to
 * {dataDir}/route-telemetry.jsonl. Provides summarize() for shadow mode
 * analysis before going live.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EventBus } from '../core/event-bus.js';
import type { RoutingDecision, RouteLogEvent } from './model-router.js';

export interface TelemetryEntry extends RouteLogEvent {
  timestamp: string;
}

export interface TelemetrySummary {
  total: number;
  triageCounts: Partial<Record<RoutingDecision, number>>;
  executedCounts: Partial<Record<RoutingDecision, number>>;
  shadowModeRatio: number;
  avgTemperature: number;
  since: string | null;
  until: string | null;
}

export class RouteTelemetry {
  private readonly filePath: string;

  constructor(dataDir: string, events?: EventBus) {
    this.filePath = path.join(dataDir, 'route-telemetry.jsonl');

    if (events) {
      events.on('action:model-route', (event) => {
        this.record(event.data as unknown as RouteLogEvent);
      });
    }
  }

  record(event: RouteLogEvent): void {
    const entry: TelemetryEntry = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    try {
      fs.appendFileSync(this.filePath, JSON.stringify(entry) + '\n');
    } catch {
      // fire-and-forget — telemetry must never block the cycle
    }
  }

  readAll(): TelemetryEntry[] {
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      return content
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TelemetryEntry);
    } catch {
      return [];
    }
  }

  summarize(): TelemetrySummary {
    const entries = this.readAll();
    const total = entries.length;

    const triageCounts: Partial<Record<RoutingDecision, number>> = {};
    const executedCounts: Partial<Record<RoutingDecision, number>> = {};
    let shadowCount = 0;
    let tempSum = 0;

    for (const e of entries) {
      triageCounts[e.triage] = (triageCounts[e.triage] ?? 0) + 1;
      executedCounts[e.executed] = (executedCounts[e.executed] ?? 0) + 1;
      if (e.shadowMode) shadowCount++;
      tempSum += e.temperature;
    }

    return {
      total,
      triageCounts,
      executedCounts,
      shadowModeRatio: total > 0 ? shadowCount / total : 0,
      avgTemperature: total > 0 ? tempSum / total : 0,
      since: entries[0]?.timestamp ?? null,
      until: entries.at(-1)?.timestamp ?? null,
    };
  }
}
