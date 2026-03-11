import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CronScheduler } from './cron.js';
import { EventBus } from './event-bus.js';

describe('CronScheduler', () => {
  let events: EventBus;
  let scheduler: CronScheduler;
  const logs: string[] = [];

  beforeEach(() => {
    events = new EventBus();
    logs.length = 0;
    scheduler = new CronScheduler(events, (msg) => logs.push(msg));
  });

  afterEach(() => {
    scheduler.stop();
    events.removeAllListeners();
  });

  it('starts with valid entries', () => {
    scheduler.start([
      { schedule: '*/5 * * * *', task: 'Test task' },
    ]);
    assert.equal(scheduler.count, 1);
    assert.ok(logs.some(l => l.includes('scheduled')));
  });

  it('skips disabled entries', () => {
    scheduler.start([
      { schedule: '*/5 * * * *', task: 'Disabled task', enabled: false },
    ]);
    assert.equal(scheduler.count, 0);
  });

  it('rejects invalid cron expressions', () => {
    scheduler.start([
      { schedule: 'not-a-cron', task: 'Bad schedule' },
    ]);
    assert.equal(scheduler.count, 0);
    assert.ok(logs.some(l => l.includes('invalid')));
  });

  it('lists active jobs', () => {
    scheduler.start([
      { schedule: '*/5 * * * *', task: 'Task A' },
      { schedule: '0 * * * *', task: 'Task B' },
    ]);
    const jobs = scheduler.list();
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].task, 'Task A');
    assert.equal(jobs[1].schedule, '0 * * * *');
  });

  it('adds jobs dynamically', () => {
    scheduler.start([]);
    const result = scheduler.add({ schedule: '*/10 * * * *', task: 'Dynamic task' });
    assert.equal(result.ok, true);
    assert.equal(scheduler.count, 1);
  });

  it('prevents duplicate adds', () => {
    scheduler.start([{ schedule: '*/5 * * * *', task: 'Task A' }]);
    const result = scheduler.add({ schedule: '*/5 * * * *', task: 'Task A' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Already scheduled');
  });

  it('removes jobs by index', () => {
    scheduler.start([
      { schedule: '*/5 * * * *', task: 'Task A' },
      { schedule: '0 * * * *', task: 'Task B' },
    ]);
    const result = scheduler.remove(0);
    assert.equal(result.ok, true);
    assert.equal(scheduler.count, 1);
    assert.equal(scheduler.list()[0].task, 'Task B');
  });

  it('rejects out-of-range remove', () => {
    scheduler.start([]);
    assert.equal(scheduler.remove(0).ok, false);
    assert.equal(scheduler.remove(-1).ok, false);
  });

  it('stops all jobs', () => {
    scheduler.start([
      { schedule: '*/5 * * * *', task: 'Task A' },
      { schedule: '0 * * * *', task: 'Task B' },
    ]);
    scheduler.stop();
    assert.equal(scheduler.count, 0);
  });

  it('drain returns false on empty queue', async () => {
    const drained = await scheduler.drain();
    assert.equal(drained, false);
  });

  it('emits trigger:cron event when enqueued', async () => {
    const emitted: unknown[] = [];
    events.on('trigger:cron', (event) => {
      emitted.push(event.data);
    });

    // Use per-second schedule to trigger quickly
    scheduler.start([
      { schedule: '* * * * * *', task: 'Every second task' },
    ]);

    await new Promise((r) => setTimeout(r, 1200));
    assert.ok(emitted.length >= 1);
    assert.ok(scheduler.queueSize >= 1);
  });

  it('drain calls tick handler and dequeues', async () => {
    const handled: string[] = [];
    scheduler.onTick(async (entry) => {
      handled.push(entry.task);
    });

    scheduler.start([
      { schedule: '* * * * * *', task: 'Fast task' },
    ]);

    await new Promise((r) => setTimeout(r, 1200));
    assert.ok(scheduler.queueSize >= 1);

    const drained = await scheduler.drain();
    assert.equal(drained, true);
    assert.ok(handled.includes('Fast task'));
  });

  it('retries on tick handler error', async () => {
    let callCount = 0;
    scheduler.onTick(async () => {
      callCount++;
      throw new Error('handler failed');
    });

    scheduler.start([
      { schedule: '* * * * * *', task: 'Failing task' },
    ]);

    await new Promise((r) => setTimeout(r, 1200));

    // First drain fails, re-queues
    await scheduler.drain();
    assert.equal(callCount, 1);
    assert.ok(scheduler.queueSize >= 1);
  });

  it('restart clears previous jobs', () => {
    scheduler.start([{ schedule: '*/5 * * * *', task: 'Old task' }]);
    assert.equal(scheduler.count, 1);

    scheduler.start([{ schedule: '*/10 * * * *', task: 'New task' }]);
    assert.equal(scheduler.count, 1);
    assert.equal(scheduler.list()[0].task, 'New task');
  });

  it('deduplicates queue entries', async () => {
    scheduler.start([
      { schedule: '* * * * * *', task: 'Dedup task' },
    ]);

    // Wait for multiple ticks — should only have 1 in queue (dedup)
    await new Promise((r) => setTimeout(r, 2200));
    assert.equal(scheduler.queueSize, 1);
  });
});
