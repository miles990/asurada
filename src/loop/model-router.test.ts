import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRoutingTemperature,
  buildTriagePrompt,
  parseRoutingDecision,
  ModelRouter,
  type RoutingDecision,
} from './model-router.js';
import type { CycleRunner } from './types.js';

// === Helper: mock runner ===

function mockRunner(response: string): CycleRunner & { callCount: number } {
  const r = {
    callCount: 0,
    async run() { r.callCount++; return response; },
  };
  return r;
}

function failRunner(error: string): CycleRunner {
  return { async run() { throw new Error(error); } };
}

// =============================================================================
// calculateRoutingTemperature
// =============================================================================

describe('calculateRoutingTemperature', () => {
  const now = Date.now();

  it('returns 0 when no human message and no active thread', () => {
    assert.equal(calculateRoutingTemperature(null, false, 30, 0.35, now), 0);
  });

  it('returns threadFloor when active thread but no human message', () => {
    assert.equal(calculateRoutingTemperature(null, true, 30, 0.35, now), 0.35);
  });

  it('returns 1 when human message is right now', () => {
    const justNow = new Date(now);
    assert.equal(calculateRoutingTemperature(justNow, false, 30, 0.35, now), 1);
  });

  it('returns 0.5 at half-life', () => {
    const halfLifeAgo = new Date(now - 15 * 60_000); // 15 min ago with 30 min half-life
    const temp = calculateRoutingTemperature(halfLifeAgo, false, 30, 0.35, now);
    assert.equal(temp, 0.5);
  });

  it('returns 0 when message is older than half-life', () => {
    const longAgo = new Date(now - 60 * 60_000); // 60 min ago with 30 min half-life
    const temp = calculateRoutingTemperature(longAgo, false, 30, 0.35, now);
    assert.equal(temp, 0);
  });

  it('thread floor wins when recency is lower', () => {
    const oldMessage = new Date(now - 60 * 60_000);
    const temp = calculateRoutingTemperature(oldMessage, true, 30, 0.35, now);
    assert.equal(temp, 0.35);
  });

  it('recency wins when higher than thread floor', () => {
    const recentMessage = new Date(now - 5 * 60_000); // 5 min ago
    const temp = calculateRoutingTemperature(recentMessage, true, 30, 0.35, now);
    assert.ok(temp > 0.35);
  });

  it('clamps threadFloor to [0, 1]', () => {
    assert.equal(calculateRoutingTemperature(null, true, 30, -1, now), 0);
    assert.equal(calculateRoutingTemperature(null, true, 30, 5, now), 1);
  });

  it('handles zero halfLife gracefully', () => {
    const msg = new Date(now);
    assert.equal(calculateRoutingTemperature(msg, false, 0, 0.35, now), 0);
  });
});

// =============================================================================
// buildTriagePrompt
// =============================================================================

describe('buildTriagePrompt', () => {
  it('includes reflect tasks and temperature', () => {
    const prompt = buildTriagePrompt('cycle data', ['task1', 'task2'], 0.75);
    assert.ok(prompt.includes('task1, task2'));
    assert.ok(prompt.includes('0.750'));
    assert.ok(prompt.includes('cycle data'));
  });

  it('shows (none) when no reflect tasks', () => {
    const prompt = buildTriagePrompt('data', [], 0);
    assert.ok(prompt.includes('(none)'));
  });

  it('truncates cycle prompt to 500 chars', () => {
    const longPrompt = 'x'.repeat(1000);
    const prompt = buildTriagePrompt(longPrompt, [], 0);
    // The truncated excerpt should be exactly 500 chars
    assert.ok(!prompt.includes('x'.repeat(501)));
  });
});

// =============================================================================
// parseRoutingDecision
// =============================================================================

describe('parseRoutingDecision', () => {
  it('parses SKIP', () => {
    assert.equal(parseRoutingDecision('SKIP'), 'SKIP');
  });

  it('parses REFLECT', () => {
    assert.equal(parseRoutingDecision('REFLECT'), 'REFLECT');
  });

  it('parses ESCALATE', () => {
    assert.equal(parseRoutingDecision('ESCALATE'), 'ESCALATE');
  });

  it('is case-insensitive', () => {
    assert.equal(parseRoutingDecision('skip'), 'SKIP');
    assert.equal(parseRoutingDecision('Reflect'), 'REFLECT');
  });

  it('extracts from surrounding text', () => {
    assert.equal(parseRoutingDecision('I think we should SKIP this cycle'), 'SKIP');
  });

  it('defaults to ESCALATE on garbage', () => {
    assert.equal(parseRoutingDecision(''), 'ESCALATE');
    assert.equal(parseRoutingDecision('unknown'), 'ESCALATE');
    assert.equal(parseRoutingDecision('maybe do something'), 'ESCALATE');
  });
});

// =============================================================================
// ModelRouter
// =============================================================================

describe('ModelRouter', () => {
  it('routes SKIP — returns empty string', async () => {
    const triage = mockRunner('SKIP');
    const reflect = mockRunner('reflect-output');
    const escalate = mockRunner('escalate-output');

    const router = new ModelRouter({
      triageRunner: triage,
      reflectRunner: reflect,
      escalateRunner: escalate,
    });

    const result = await router.run('prompt', 'system');
    assert.equal(result, '');
    assert.equal(reflect.callCount, 0);
    assert.equal(escalate.callCount, 0);
  });

  it('routes REFLECT — uses reflect runner', async () => {
    const triage = mockRunner('REFLECT');
    const reflect = mockRunner('reflect-output');
    const escalate = mockRunner('escalate-output');

    const router = new ModelRouter({
      triageRunner: triage,
      reflectRunner: reflect,
      escalateRunner: escalate,
    });

    const result = await router.run('prompt', 'system');
    assert.equal(result, 'reflect-output');
    assert.equal(escalate.callCount, 0);
  });

  it('routes ESCALATE — uses escalate runner', async () => {
    const triage = mockRunner('ESCALATE');
    const reflect = mockRunner('reflect-output');
    const escalate = mockRunner('escalate-output');

    const router = new ModelRouter({
      triageRunner: triage,
      reflectRunner: reflect,
      escalateRunner: escalate,
    });

    const result = await router.run('prompt', 'system');
    assert.equal(result, 'escalate-output');
  });

  it('shadow mode — always escalates regardless of triage', async () => {
    const triage = mockRunner('SKIP');
    const reflect = mockRunner('reflect-output');
    const escalate = mockRunner('escalate-output');

    const router = new ModelRouter({
      triageRunner: triage,
      reflectRunner: reflect,
      escalateRunner: escalate,
      shadowMode: true,
    });

    const result = await router.run('prompt', 'system');
    assert.equal(result, 'escalate-output');
  });

  it('triage failure — defaults to ESCALATE', async () => {
    const triage = failRunner('network error');
    const reflect = mockRunner('reflect-output');
    const escalate = mockRunner('escalate-output');

    const router = new ModelRouter({
      triageRunner: triage,
      reflectRunner: reflect,
      escalateRunner: escalate,
    });

    const result = await router.run('prompt', 'system');
    assert.equal(result, 'escalate-output');
  });

  it('emits route event when events provided', async () => {
    const triage = mockRunner('REFLECT');
    const reflect = mockRunner('output');
    const escalate = mockRunner('');

    let emitted: unknown = null;
    const fakeEvents = {
      emit: (event: string, data: unknown) => { emitted = data; },
    };

    const router = new ModelRouter({
      triageRunner: triage,
      reflectRunner: reflect,
      escalateRunner: escalate,
      events: fakeEvents as any,
    });

    await router.run('prompt', 'system');
    assert.ok(emitted !== null);
    assert.equal((emitted as any).triage, 'REFLECT');
    assert.equal((emitted as any).executed, 'REFLECT');
    assert.equal((emitted as any).shadowMode, false);
  });

  it('temperature reflects lastHumanMessageAt', async () => {
    const triage = mockRunner('ESCALATE');
    const reflect = mockRunner('');
    const escalate = mockRunner('output');

    let capturedTemp: number | null = null;
    const fakeEvents = {
      emit: (_: string, data: any) => { capturedTemp = data.temperature; },
    };

    const router = new ModelRouter({
      triageRunner: triage,
      reflectRunner: reflect,
      escalateRunner: escalate,
      events: fakeEvents as any,
    });

    // No human message → temperature should be 0
    await router.run('prompt', 'system');
    assert.equal(capturedTemp, 0);

    // Set human message to now → temperature should be 1
    router.lastHumanMessageAt = new Date();
    await router.run('prompt', 'system');
    assert.equal(capturedTemp, 1);
  });
});
