import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoop } from './agent-loop.js';
import { EventBus } from '../core/event-bus.js';
import { PerceptionManager } from '../perception/manager.js';

describe('AgentLoop graceful shutdown', () => {
  it('stop() waits for current cycle to complete', async () => {
    const events = new EventBus();
    const perception = new PerceptionManager();
    let runFinished = false;

    const slowRunner = {
      async run() {
        await new Promise(r => setTimeout(r, 200));
        runFinished = true;
        return '';
      },
    };

    const loop = new AgentLoop(events, perception, 'test', {
      runner: slowRunner,
      defaultInterval: 600_000,
    });

    loop.start();
    loop.trigger();
    await new Promise(r => setTimeout(r, 50)); // let cycle start

    await loop.stop();
    assert.equal(runFinished, true, 'Cycle should have completed before stop resolved');
    assert.equal(loop.isRunning, false);
  });

  it('stop() resolves immediately if no cycle is running', async () => {
    const events = new EventBus();
    const perception = new PerceptionManager();

    const loop = new AgentLoop(events, perception, 'test', {
      runner: { async run() { return ''; } },
      defaultInterval: 600_000,
    });

    loop.start();
    const start = Date.now();
    await loop.stop();
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 100, `stop() should resolve quickly, took ${elapsed}ms`);
    assert.equal(loop.isRunning, false);
  });

  it('does not start new cycles after stop() is called', async () => {
    const events = new EventBus();
    const perception = new PerceptionManager();
    let runCount = 0;

    const runner = {
      async run() {
        runCount++;
        await new Promise(r => setTimeout(r, 100));
        return '';
      },
    };

    const loop = new AgentLoop(events, perception, 'test', {
      runner,
      defaultInterval: 600_000,
    });

    loop.start();
    loop.trigger();
    await new Promise(r => setTimeout(r, 30));

    const stopPromise = loop.stop();
    loop.trigger(); // should be ignored — stopping
    await stopPromise;

    assert.equal(runCount, 1, 'Only the first cycle should have run');
  });
});
