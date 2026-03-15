import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConversationStore } from './conversation.js';

describe('ConversationStore retention', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('deletes conversation files older than maxDays', async () => {
    const store = new ConversationStore(tmpDir, { maxDays: 7 });

    // Create fake old and recent files
    const oldDate = '2026-01-01';
    const recentDate = '2026-03-14';
    fs.writeFileSync(path.join(tmpDir, `${oldDate}.jsonl`), '{"id":"1","from":"a","text":"hi","ts":"2026-01-01T00:00:00Z"}\n');
    fs.writeFileSync(path.join(tmpDir, `${recentDate}.jsonl`), '{"id":"2","from":"a","text":"hi","ts":"2026-03-14T00:00:00Z"}\n');

    const deleted = await store.cleanup();

    assert.ok(!fs.existsSync(path.join(tmpDir, `${oldDate}.jsonl`)), 'Old file should be deleted');
    assert.ok(fs.existsSync(path.join(tmpDir, `${recentDate}.jsonl`)), 'Recent file should remain');
    assert.equal(deleted, 1);
  });

  it('keeps all files when maxDays is 0', async () => {
    const store = new ConversationStore(tmpDir);
    const oldDate = '2020-01-01';
    fs.writeFileSync(path.join(tmpDir, `${oldDate}.jsonl`), '{"id":"1","from":"a","text":"hi","ts":"2020-01-01T00:00:00Z"}\n');

    const deleted = await store.cleanup();
    assert.ok(fs.existsSync(path.join(tmpDir, `${oldDate}.jsonl`)), 'File should not be deleted');
    assert.equal(deleted, 0);
  });

  it('ignores non-jsonl files during cleanup', async () => {
    const store = new ConversationStore(tmpDir, { maxDays: 1 });
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'keep me');
    fs.writeFileSync(path.join(tmpDir, '2020-01-01.jsonl'), '{"id":"1","from":"a","text":"old","ts":"2020-01-01T00:00:00Z"}\n');

    await store.cleanup();
    assert.ok(fs.existsSync(path.join(tmpDir, 'notes.txt')), 'Non-jsonl file should remain');
  });
});
