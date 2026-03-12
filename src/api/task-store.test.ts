import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskStore } from './task-store.js';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'asurada-tasks-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('TaskStore', () => {
  let tmpDir: string;
  let store: TaskStore;

  afterEach(() => {
    if (tmpDir) cleanup(tmpDir);
  });

  function createStore(): TaskStore {
    tmpDir = mkTmpDir();
    return new TaskStore(path.join(tmpDir, 'tasks.jsonl'));
  }

  it('createTask generates sequential IDs starting at task-001', async () => {
    store = createStore();
    const t1 = await store.createTask({ title: 'First task' }, 'alex');
    const t2 = await store.createTask({ title: 'Second task' }, 'alex');
    assert.equal(t1.id, 'task-001');
    assert.equal(t2.id, 'task-002');
  });

  it('createTask sets default status to todo', async () => {
    store = createStore();
    const task = await store.createTask({ title: 'A task' }, 'alex');
    assert.equal(task.status, 'todo');
  });

  it('createTask stores createdBy and timestamps', async () => {
    store = createStore();
    const before = new Date().toISOString();
    const task = await store.createTask({ title: 'Stamped task' }, 'bot');
    assert.equal(task.createdBy, 'bot');
    assert.ok(task.createdAt >= before);
    assert.ok(task.updatedAt >= before);
  });

  it('createTask stores optional fields', async () => {
    store = createStore();
    const task = await store.createTask({
      title: 'Tagged task',
      assignee: 'alex',
      labels: ['bug', 'urgent'],
      verify: 'echo ok',
      messageRef: '2026-03-12-001',
    }, 'alex');
    assert.equal(task.assignee, 'alex');
    assert.deepEqual(task.labels, ['bug', 'urgent']);
    assert.equal(task.verify, 'echo ok');
    assert.equal(task.messageRef, '2026-03-12-001');
  });

  it('getTasks returns current state after replay', async () => {
    store = createStore();
    await store.createTask({ title: 'Task A' }, 'alex');
    await store.createTask({ title: 'Task B' }, 'alex');

    // Fresh store from same file — forces replay
    const store2 = new TaskStore(path.join(tmpDir, 'tasks.jsonl'));
    const tasks = await store2.getTasks();
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].title, 'Task A');
    assert.equal(tasks[1].title, 'Task B');
  });

  it('updateTask changes status', async () => {
    store = createStore();
    const task = await store.createTask({ title: 'Move me' }, 'alex');
    const updated = await store.updateTask(task.id, { status: 'doing' }, 'alex');
    assert.ok(updated);
    assert.equal(updated!.status, 'doing');

    const tasks = await store.getTasks();
    assert.equal(tasks[0].status, 'doing');
  });

  it('updateTask changes title', async () => {
    store = createStore();
    const task = await store.createTask({ title: 'Old title' }, 'alex');
    const updated = await store.updateTask(task.id, { title: 'New title' }, 'alex');
    assert.ok(updated);
    assert.equal(updated!.title, 'New title');
  });

  it('updateTask changes assignee', async () => {
    store = createStore();
    const task = await store.createTask({ title: 'Assign me' }, 'alex');
    const updated = await store.updateTask(task.id, { assignee: 'bot' }, 'alex');
    assert.ok(updated);
    assert.equal(updated!.assignee, 'bot');
  });

  it('updateTask bumps updatedAt', async () => {
    store = createStore();
    const task = await store.createTask({ title: 'Time check' }, 'alex');
    const createdAt = task.updatedAt;
    // Small delay to ensure timestamp differs
    await new Promise(r => setTimeout(r, 5));
    const updated = await store.updateTask(task.id, { status: 'doing' }, 'alex');
    assert.ok(updated!.updatedAt >= createdAt);
  });

  it('updateTask returns null for nonexistent task', async () => {
    store = createStore();
    const result = await store.updateTask('task-999', { status: 'done' }, 'alex');
    assert.equal(result, null);
  });

  it('deleteTask removes task from active list', async () => {
    store = createStore();
    const task = await store.createTask({ title: 'Delete me' }, 'alex');
    await store.deleteTask(task.id, 'alex');

    const tasks = await store.getTasks();
    assert.equal(tasks.length, 0);
  });

  it('deleteTask is soft — JSONL file still contains events', async () => {
    store = createStore();
    const task = await store.createTask({ title: 'Soft delete' }, 'alex');
    await store.deleteTask(task.id, 'alex');

    const content = fs.readFileSync(path.join(tmpDir, 'tasks.jsonl'), 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 2); // create + delete events
  });

  it('getTask returns a single task by ID', async () => {
    store = createStore();
    await store.createTask({ title: 'Task One' }, 'alex');
    const t2 = await store.createTask({ title: 'Task Two' }, 'alex');

    const found = await store.getTask(t2.id);
    assert.ok(found);
    assert.equal(found!.title, 'Task Two');
  });

  it('getTask returns null for deleted task', async () => {
    store = createStore();
    const task = await store.createTask({ title: 'Gone' }, 'alex');
    await store.deleteTask(task.id, 'alex');

    const found = await store.getTask(task.id);
    assert.equal(found, null);
  });

  it('event ordering: create → update → complete produces correct final state', async () => {
    store = createStore();
    const task = await store.createTask({ title: 'Workflow task' }, 'alex');
    await store.updateTask(task.id, { status: 'doing', assignee: 'bot' }, 'alex');
    await store.updateTask(task.id, { status: 'done' }, 'bot');

    const tasks = await store.getTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, 'done');
    assert.equal(tasks[0].assignee, 'bot');
  });

  it('getTasks excludes deleted tasks but includes all active statuses', async () => {
    store = createStore();
    const t1 = await store.createTask({ title: 'Todo' }, 'alex');
    const t2 = await store.createTask({ title: 'Doing' }, 'alex');
    const t3 = await store.createTask({ title: 'Done' }, 'alex');
    const t4 = await store.createTask({ title: 'Deleted' }, 'alex');

    await store.updateTask(t2.id, { status: 'doing' }, 'alex');
    await store.updateTask(t3.id, { status: 'done' }, 'alex');
    await store.deleteTask(t4.id, 'alex');

    const tasks = await store.getTasks();
    assert.equal(tasks.length, 3);
    const ids = tasks.map(t => t.id);
    assert.ok(ids.includes(t1.id));
    assert.ok(ids.includes(t2.id));
    assert.ok(ids.includes(t3.id));
    assert.ok(!ids.includes(t4.id));
  });
});
