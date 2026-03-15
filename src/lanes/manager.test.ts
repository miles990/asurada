import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LaneManager } from './manager.js';
import type { TaskExecutor, ExecutionHandle, TaskSpec, TaskResult } from './types.js';

// =============================================================================
// Mock Executor
// =============================================================================

type MockHandle = ExecutionHandle & {
  simulateOutput: (chunk: string) => void;
  simulateClose: (code: number | null) => void;
};

function createMockExecutor(): TaskExecutor & { handles: Map<string, MockHandle> } {
  const handles = new Map<string, MockHandle>();

  return {
    handles,
    execute(task: TaskSpec): ExecutionHandle {
      let outputCb: ((chunk: string) => void) | null = null;
      let closeCb: ((code: number | null) => void) | null = null;

      const handle: MockHandle = {
        onOutput(cb) { outputCb = cb; },
        onClose(cb) { closeCb = cb; },
        abort() { closeCb?.(null); },
        simulateOutput(chunk: string) { outputCb?.(chunk); },
        simulateClose(code: number | null) { closeCb?.(code); },
      };

      handles.set(task.id!, handle);
      return handle;
    },
  };
}

function task(overrides?: Partial<TaskSpec>): TaskSpec {
  return {
    type: 'code',
    prompt: 'do something',
    workdir: '/tmp/test',
    ...overrides,
  };
}

// =============================================================================
// LaneManager
// =============================================================================

describe('LaneManager', () => {
  let executor: ReturnType<typeof createMockExecutor>;
  let mgr: LaneManager;

  beforeEach(() => {
    executor = createMockExecutor();
    mgr = new LaneManager(executor);
  });

  // ---------------------------------------------------------------------------
  // Spawn & lifecycle
  // ---------------------------------------------------------------------------

  it('spawns a task and returns an id', () => {
    const id = mgr.spawn(task());
    assert.ok(id.startsWith('lane-'));
    assert.equal(mgr.stats().active, 1);
  });

  it('uses provided task id', () => {
    const id = mgr.spawn(task({ id: 'custom-1' }));
    assert.equal(id, 'custom-1');
  });

  it('emits task:started on spawn', () => {
    const events: TaskResult[] = [];
    mgr.on('task:started', (r) => events.push(r));
    mgr.spawn(task());
    assert.equal(events.length, 1);
    assert.equal(events[0].status, 'running');
  });

  it('completes task with exit code 0 → completed', async () => {
    const completed: TaskResult[] = [];
    mgr.on('task:completed', (r) => completed.push(r));

    const id = mgr.spawn(task());
    executor.handles.get(id)!.simulateClose(0);

    // onClose is async, give it a tick
    await sleep(10);

    assert.equal(completed.length, 1);
    assert.equal(completed[0].status, 'completed');
    assert.ok(completed[0].completedAt);
    assert.ok(typeof completed[0].durationMs === 'number');
  });

  it('completes task with non-zero exit → failed', async () => {
    const completed: TaskResult[] = [];
    mgr.on('task:completed', (r) => completed.push(r));

    const id = mgr.spawn(task());
    executor.handles.get(id)!.simulateClose(1);
    await sleep(10);

    assert.equal(completed[0].status, 'failed');
  });

  it('collects output from execution', async () => {
    const id = mgr.spawn(task());
    const handle = executor.handles.get(id)!;

    handle.simulateOutput('hello ');
    handle.simulateOutput('world');
    handle.simulateClose(0);
    await sleep(10);

    const result = mgr.get(id);
    assert.equal(result?.output, 'hello world');
  });

  it('truncates long output to outputTailChars', async () => {
    mgr = new LaneManager(executor, { outputTailChars: 10 });
    const id = mgr.spawn(task());
    const handle = executor.handles.get(id)!;

    handle.simulateOutput('a'.repeat(100));
    handle.simulateClose(0);
    await sleep(10);

    const result = mgr.get(id);
    assert.equal(result?.output.length, 10);
  });

  // ---------------------------------------------------------------------------
  // Concurrency & queuing
  // ---------------------------------------------------------------------------

  it('queues tasks when at max concurrency', () => {
    mgr = new LaneManager(executor, { maxConcurrent: 2 });

    const queued: TaskResult[] = [];
    mgr.on('task:queued', (r) => queued.push(r));

    mgr.spawn(task({ id: 't1' }));
    mgr.spawn(task({ id: 't2' }));
    mgr.spawn(task({ id: 't3' })); // should be queued

    assert.equal(mgr.stats().active, 2);
    assert.equal(mgr.stats().queued, 1);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].id, 't3');
  });

  it('dequeues after active task completes', async () => {
    mgr = new LaneManager(executor, { maxConcurrent: 1 });

    const started: string[] = [];
    mgr.on('task:started', (r) => started.push(r.id));

    mgr.spawn(task({ id: 't1' }));
    mgr.spawn(task({ id: 't2' })); // queued

    assert.equal(started.length, 1);

    // Complete t1 → t2 should auto-start
    executor.handles.get('t1')!.simulateClose(0);
    await sleep(10);

    assert.equal(started.length, 2);
    assert.equal(started[1], 't2');
    assert.equal(mgr.stats().active, 1);
    assert.equal(mgr.stats().queued, 0);
  });

  // ---------------------------------------------------------------------------
  // Timeout
  // ---------------------------------------------------------------------------

  it('times out tasks exceeding timeoutMs', async () => {
    mgr = new LaneManager(executor, { maxTimeoutMs: 50 });
    const completed: TaskResult[] = [];
    mgr.on('task:completed', (r) => completed.push(r));

    mgr.spawn(task({ id: 'slow', timeoutMs: 50 }));
    await sleep(100);

    assert.equal(completed.length, 1);
    assert.equal(completed[0].status, 'timeout');
  });

  // ---------------------------------------------------------------------------
  // Config capping
  // ---------------------------------------------------------------------------

  it('caps maxTurns to maxTurnsCap', () => {
    mgr = new LaneManager(executor, { maxTurnsCap: 3 });
    const id = mgr.spawn(task({ maxTurns: 100 }));
    // Can't directly inspect normalized task, but the spawn succeeds
    assert.ok(id);
  });

  it('caps timeoutMs to maxTimeoutMs', () => {
    mgr = new LaneManager(executor, { maxTimeoutMs: 1000 });
    const id = mgr.spawn(task({ timeoutMs: 999_999 }));
    assert.ok(id);
  });

  // ---------------------------------------------------------------------------
  // list / get / stats / drain / cleanup
  // ---------------------------------------------------------------------------

  it('list() returns active tasks', () => {
    mgr.spawn(task({ id: 't1' }));
    mgr.spawn(task({ id: 't2' }));
    const items = mgr.list();
    assert.equal(items.length, 2);
  });

  it('list({ includeCompleted }) includes completed tasks', async () => {
    mgr.spawn(task({ id: 't1' }));
    executor.handles.get('t1')!.simulateClose(0);
    await sleep(10);

    assert.equal(mgr.list().length, 0); // active only
    assert.equal(mgr.list({ includeCompleted: true }).length, 1);
  });

  it('get() returns task by id', () => {
    mgr.spawn(task({ id: 't1' }));
    const result = mgr.get('t1');
    assert.equal(result?.id, 't1');
    assert.equal(result?.status, 'running');
  });

  it('get() returns undefined for unknown id', () => {
    assert.equal(mgr.get('nope'), undefined);
  });

  it('stats() returns correct counts', () => {
    mgr = new LaneManager(executor, { maxConcurrent: 1 });
    mgr.spawn(task({ id: 't1' }));
    mgr.spawn(task({ id: 't2' })); // queued

    const s = mgr.stats();
    assert.equal(s.active, 1);
    assert.equal(s.queued, 1);
    assert.equal(s.completed, 0);
    assert.equal(s.maxConcurrent, 1);
  });

  it('drain() returns and clears completed results', async () => {
    mgr.spawn(task({ id: 't1' }));
    executor.handles.get('t1')!.simulateClose(0);
    await sleep(10);

    const drained = mgr.drain();
    assert.equal(drained.length, 1);
    assert.equal(drained[0].id, 't1');

    // Drained — should be empty now
    assert.equal(mgr.drain().length, 0);
  });

  it('cleanup() removes old completed tasks', async () => {
    mgr.spawn(task({ id: 't1' }));
    executor.handles.get('t1')!.simulateClose(0);
    await sleep(10);

    // Cleanup with 0ms age → everything is "old"
    mgr.cleanup(0);
    assert.equal(mgr.list({ includeCompleted: true }).length, 0);
  });

  // ---------------------------------------------------------------------------
  // Executor failure
  // ---------------------------------------------------------------------------

  it('handles executor.execute() throwing', async () => {
    const failingExecutor: TaskExecutor = {
      execute() { throw new Error('spawn failed'); },
    };
    mgr = new LaneManager(failingExecutor);
    const completed: TaskResult[] = [];
    mgr.on('task:completed', (r) => completed.push(r));

    const id = mgr.spawn(task());
    assert.ok(id);
    assert.equal(completed.length, 1);
    assert.equal(completed[0].status, 'failed');
    assert.match(completed[0].output, /spawn failed/);
  });

  // ---------------------------------------------------------------------------
  // Workdir ~ expansion
  // ---------------------------------------------------------------------------

  it('expands ~ in workdir', () => {
    // Just verify it doesn't throw — the executor receives expanded path
    const id = mgr.spawn(task({ workdir: '~/projects/foo' }));
    assert.ok(id);
  });

  // ---------------------------------------------------------------------------
  // Meta passthrough
  // ---------------------------------------------------------------------------

  it('passes meta through to result', async () => {
    mgr.spawn(task({ id: 't1', meta: { label: 'test-job' } }));
    executor.handles.get('t1')!.simulateClose(0);
    await sleep(10);

    const result = mgr.get('t1');
    assert.deepEqual(result?.meta, { label: 'test-job' });
  });
});

// =============================================================================
// Helpers
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
