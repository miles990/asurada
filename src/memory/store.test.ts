import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MemoryStore } from './store.js';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'asurada-mem-'));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('MemoryStore', () => {
  let tmpDir: string;
  let store: MemoryStore;

  afterEach(() => { if (tmpDir) cleanup(tmpDir); });

  function createStore(): MemoryStore {
    tmpDir = mkTmpDir();
    return new MemoryStore({ memoryDir: tmpDir });
  }

  it('creates directories on construction', () => {
    store = createStore();
    assert.ok(fs.existsSync(tmpDir));
    assert.ok(fs.existsSync(path.join(tmpDir, 'topics')));
  });

  it('read() returns null when no memory file exists', async () => {
    store = createStore();
    const content = await store.read();
    assert.equal(content, null);
  });

  it('append() writes dated entries to main file', async () => {
    store = createStore();
    await store.append('first insight');
    await store.append('second insight');

    const content = await store.read();
    assert.ok(content);
    assert.ok(content.includes('first insight'));
    assert.ok(content.includes('second insight'));
    // Check date format [YYYY-MM-DD]
    assert.ok(/\[\d{4}-\d{2}-\d{2}\]/.test(content));
  });

  it('append() with topic creates topic file', async () => {
    store = createStore();
    await store.append('TypeScript is great', 'programming');

    const topics = await store.listTopics();
    assert.deepEqual(topics, ['programming']);

    const content = await store.readTopic('programming');
    assert.ok(content);
    assert.ok(content.includes('# programming'));
    assert.ok(content.includes('TypeScript is great'));
  });

  it('listTopics() returns sorted topic names', async () => {
    store = createStore();
    await store.append('a', 'zeta');
    await store.append('b', 'alpha');
    await store.append('c', 'mid');

    const topics = await store.listTopics();
    assert.deepEqual(topics, ['alpha', 'mid', 'zeta']);
  });

  it('readTopic() returns null for nonexistent topic', async () => {
    store = createStore();
    const content = await store.readTopic('nonexistent');
    assert.equal(content, null);
  });

  it('path getters return correct paths', () => {
    store = createStore();
    assert.equal(store.mainFilePath, path.join(tmpDir, 'MEMORY.md'));
    assert.equal(store.topicFilePath('test'), path.join(tmpDir, 'topics', 'test.md'));
    assert.equal(store.topicsDirPath, path.join(tmpDir, 'topics'));
  });
});
