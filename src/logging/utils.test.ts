import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { safeExec, safeExecAsync, readJsonFile, setSlogPrefix, slog } from './utils.js';

describe('safeExec', () => {
  it('returns function result on success', () => {
    const result = safeExec(() => 42, 'test', -1);
    assert.equal(result, 42);
  });

  it('returns fallback on error', () => {
    const result = safeExec(() => { throw new Error('boom'); }, 'test', -1);
    assert.equal(result, -1);
  });

  it('returns fallback for type errors', () => {
    const result = safeExec(() => {
      const obj: any = null;
      return obj.missing.prop;
    }, 'test', 'default');
    assert.equal(result, 'default');
  });
});

describe('safeExecAsync', () => {
  it('returns async function result on success', async () => {
    const result = await safeExecAsync(async () => 'ok', 'test', 'fail');
    assert.equal(result, 'ok');
  });

  it('returns fallback on async error', async () => {
    const result = await safeExecAsync(
      async () => { throw new Error('async boom'); },
      'test',
      'recovered',
    );
    assert.equal(result, 'recovered');
  });
});

describe('readJsonFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asurada-test-'));
  });

  it('returns parsed JSON from valid file', () => {
    const filePath = path.join(tmpDir, 'data.json');
    fs.writeFileSync(filePath, JSON.stringify({ key: 'value' }));
    const result = readJsonFile(filePath, {});
    assert.deepEqual(result, { key: 'value' });
  });

  it('returns fallback for missing file', () => {
    const result = readJsonFile(path.join(tmpDir, 'missing.json'), { default: true });
    assert.deepEqual(result, { default: true });
  });

  it('returns fallback for invalid JSON', () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, 'not json {{{');
    const result = readJsonFile(filePath, []);
    assert.deepEqual(result, []);
  });

  it('reads array JSON', () => {
    const filePath = path.join(tmpDir, 'arr.json');
    fs.writeFileSync(filePath, '[1, 2, 3]');
    const result = readJsonFile<number[]>(filePath, []);
    assert.deepEqual(result, [1, 2, 3]);
  });
});

describe('slog', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => slog('test', 'hello'));
  });

  it('handles null/undefined message gracefully', () => {
    assert.doesNotThrow(() => slog('test', undefined as any));
    assert.doesNotThrow(() => slog('test', null as any));
  });
});

describe('setSlogPrefix', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => setSlogPrefix('test-prefix'));
    setSlogPrefix(''); // reset
  });
});
