import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, debounce, distinctUntilChanged } from './event-bus.js';

// =============================================================================
// EventBus
// =============================================================================

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  afterEach(() => {
    bus.removeAllListeners();
  });

  it('emits and receives events', () => {
    const events: string[] = [];
    bus.on('test:hello', (e) => events.push(e.type));
    bus.emit('test:hello');
    assert.deepEqual(events, ['test:hello']);
  });

  it('passes data and metadata in events', () => {
    let received: Record<string, unknown> | null = null;
    bus.on('action:deploy', (e) => { received = e.data; });
    bus.emit('action:deploy', { version: '1.0' }, { priority: 'P1', source: 'ci' });
    assert.deepEqual(received, { version: '1.0' });
  });

  it('includes timestamp in events', () => {
    let ts: Date | null = null;
    bus.on('log:info', (e) => { ts = e.timestamp; });
    const before = new Date();
    bus.emit('log:info');
    assert.ok(ts !== null);
    assert.ok((ts as Date) >= before);
  });

  it('supports wildcard listeners (prefix:*)', () => {
    const events: string[] = [];
    bus.on('trigger:*', (e) => events.push(e.type));

    bus.emit('trigger:workspace', { path: '/src' });
    bus.emit('trigger:telegram', { msg: 'hi' });
    bus.emit('action:deploy'); // should NOT match trigger:*

    assert.deepEqual(events, ['trigger:workspace', 'trigger:telegram']);
  });

  it('fires both exact and wildcard listeners', () => {
    const exact: string[] = [];
    const wild: string[] = [];
    bus.on('log:error', (e) => exact.push(e.type));
    bus.on('log:*', (e) => wild.push(e.type));

    bus.emit('log:error');
    assert.deepEqual(exact, ['log:error']);
    assert.deepEqual(wild, ['log:error']);
  });

  it('does not fire wildcard for events without colon', () => {
    const events: string[] = [];
    bus.on('simple:*', (e) => events.push(e.type));
    bus.emit('simple');
    assert.deepEqual(events, []);
  });

  it('once() fires only once', () => {
    let count = 0;
    bus.once('one:shot', () => count++);
    bus.emit('one:shot');
    bus.emit('one:shot');
    assert.equal(count, 1);
  });

  it('off() removes listener', () => {
    let count = 0;
    const handler = () => count++;
    bus.on('test:off', handler);
    bus.emit('test:off');
    bus.off('test:off', handler);
    bus.emit('test:off');
    assert.equal(count, 1);
  });

  it('removeAllListeners() clears specific pattern', () => {
    let a = 0, b = 0;
    bus.on('a:event', () => a++);
    bus.on('b:event', () => b++);
    bus.removeAllListeners('a:event');
    bus.emit('a:event');
    bus.emit('b:event');
    assert.equal(a, 0);
    assert.equal(b, 1);
  });

  it('removeAllListeners() without args clears everything', () => {
    let count = 0;
    bus.on('x:1', () => count++);
    bus.on('x:2', () => count++);
    bus.removeAllListeners();
    bus.emit('x:1');
    bus.emit('x:2');
    assert.equal(count, 0);
  });

  it('listenerCount() returns correct count', () => {
    const h1 = () => {};
    const h2 = () => {};
    bus.on('count:test', h1);
    bus.on('count:test', h2);
    assert.equal(bus.listenerCount('count:test'), 2);
    bus.off('count:test', h1);
    assert.equal(bus.listenerCount('count:test'), 1);
  });

  it('supports chaining', () => {
    const result = bus.on('chain:test', () => {}).off('chain:test', () => {});
    assert.ok(result instanceof EventBus);
  });
});

// =============================================================================
// debounce
// =============================================================================

describe('debounce', () => {
  it('delays execution', async () => {
    let called = 0;
    const fn = debounce(() => called++, 50);
    fn();
    assert.equal(called, 0);
    await sleep(80);
    assert.equal(called, 1);
  });

  it('resets timer on subsequent calls', async () => {
    let called = 0;
    const fn = debounce(() => called++, 50);
    fn();
    await sleep(30);
    fn(); // reset
    await sleep(30);
    assert.equal(called, 0); // still waiting
    await sleep(30);
    assert.equal(called, 1);
  });

  it('cancel() prevents execution', async () => {
    let called = 0;
    const fn = debounce(() => called++, 50);
    fn();
    fn.cancel();
    await sleep(80);
    assert.equal(called, 0);
  });

  it('passes arguments to the debounced function', async () => {
    let received: number[] = [];
    const fn = debounce((a: number, b: number) => { received = [a, b]; }, 30);
    fn(1, 2);
    fn(3, 4); // last call wins
    await sleep(60);
    assert.deepEqual(received, [3, 4]);
  });
});

// =============================================================================
// distinctUntilChanged
// =============================================================================

describe('distinctUntilChanged', () => {
  it('returns true on first call', () => {
    const isChanged = distinctUntilChanged<string>(s => s);
    assert.equal(isChanged('hello'), true);
  });

  it('returns false when hash unchanged', () => {
    const isChanged = distinctUntilChanged<string>(s => s);
    isChanged('hello');
    assert.equal(isChanged('hello'), false);
  });

  it('returns true when hash changes', () => {
    const isChanged = distinctUntilChanged<string>(s => s);
    isChanged('hello');
    assert.equal(isChanged('world'), true);
  });

  it('works with custom hash function', () => {
    const isChanged = distinctUntilChanged<{ id: number; name: string }>(
      obj => String(obj.id),
    );
    assert.equal(isChanged({ id: 1, name: 'a' }), true);
    assert.equal(isChanged({ id: 1, name: 'b' }), false); // same id
    assert.equal(isChanged({ id: 2, name: 'b' }), true);  // different id
  });
});

// =============================================================================
// Helpers
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
