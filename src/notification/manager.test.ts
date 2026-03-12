import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationManager } from './manager.js';
import type { NotificationProvider, NotificationStats, SendOptions } from './types.js';

/** Minimal mock provider */
function mockProvider(
  name: string,
  sendResult: boolean = true,
): NotificationProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    calls,
    send: async (msg: string, _opts?: SendOptions) => {
      calls.push(msg);
      return sendResult;
    },
    getStats: () => ({ sent: calls.length, failed: 0 }),
  };
}

function failProvider(name: string): NotificationProvider {
  let failed = 0;
  return {
    name,
    send: async () => { failed++; return false; },
    getStats: () => ({ sent: 0, failed }),
  };
}

describe('NotificationManager', () => {
  it('returns false when no providers registered', async () => {
    const mgr = new NotificationManager();
    assert.equal(await mgr.notify('hello'), false);
  });

  it('returns false for empty message', async () => {
    const mgr = new NotificationManager();
    mgr.register(mockProvider('test'));
    assert.equal(await mgr.notify(''), false);
    assert.equal(await mgr.notify('   '), false);
  });

  it('sends to registered provider', async () => {
    const mgr = new NotificationManager();
    const p = mockProvider('telegram');
    mgr.register(p);
    const result = await mgr.notify('hello world');
    assert.equal(result, true);
    assert.deepEqual(p.calls, ['hello world']);
  });

  it('sends to multiple providers', async () => {
    const mgr = new NotificationManager();
    const p1 = mockProvider('telegram');
    const p2 = mockProvider('discord');
    mgr.register(p1);
    mgr.register(p2);
    await mgr.notify('broadcast');
    assert.deepEqual(p1.calls, ['broadcast']);
    assert.deepEqual(p2.calls, ['broadcast']);
  });

  it('returns true if at least one provider succeeds', async () => {
    const mgr = new NotificationManager();
    mgr.register(failProvider('broken'));
    mgr.register(mockProvider('works'));
    assert.equal(await mgr.notify('test'), true);
  });

  it('returns false if all providers fail', async () => {
    const mgr = new NotificationManager();
    mgr.register(failProvider('broken1'));
    mgr.register(failProvider('broken2'));
    assert.equal(await mgr.notify('test'), false);
  });

  it('aggregates stats across providers', () => {
    const mgr = new NotificationManager();
    const p1 = mockProvider('a');
    const p2 = mockProvider('b');
    mgr.register(p1);
    mgr.register(p2);
    // Simulate some sends
    p1.calls.push('x', 'y');
    p2.calls.push('z');
    const stats = mgr.getStats();
    assert.equal(stats.sent, 3);
    assert.equal(stats.failed, 0);
  });

  it('lists provider names', () => {
    const mgr = new NotificationManager();
    mgr.register(mockProvider('telegram'));
    mgr.register(mockProvider('discord'));
    assert.deepEqual(mgr.providerNames, ['telegram', 'discord']);
  });

  it('handles provider that throws', async () => {
    const mgr = new NotificationManager();
    const throwing: NotificationProvider = {
      name: 'throw',
      send: async () => { throw new Error('boom'); },
      getStats: () => ({ sent: 0, failed: 0 }),
    };
    const good = mockProvider('good');
    mgr.register(throwing);
    mgr.register(good);
    // Should not throw, and good provider still succeeds
    const result = await mgr.notify('test');
    assert.equal(result, true);
    assert.deepEqual(good.calls, ['test']);
  });

  it('startAll and stopAll call providers', async () => {
    const mgr = new NotificationManager();
    let started = false;
    let stopped = false;
    const p: NotificationProvider = {
      name: 'lifecycle',
      send: async () => true,
      getStats: () => ({ sent: 0, failed: 0 }),
      start: async () => { started = true; },
      stop: async () => { stopped = true; },
    };
    mgr.register(p);
    await mgr.startAll();
    assert.equal(started, true);
    await mgr.stopAll();
    assert.equal(stopped, true);
  });
});
