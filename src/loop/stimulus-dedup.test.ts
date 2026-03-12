import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildStimulusFingerprint, StimulusDedup, DEDUP_HINT } from './stimulus-dedup.js';

describe('buildStimulusFingerprint', () => {
  it('produces a 16-char hex string', () => {
    const fp = buildStimulusFingerprint('timer', ['git', 'workflow']);
    assert.match(fp, /^[0-9a-f]{16}$/);
  });

  it('is deterministic', () => {
    const a = buildStimulusFingerprint('timer', ['git', 'workflow']);
    const b = buildStimulusFingerprint('timer', ['git', 'workflow']);
    assert.equal(a, b);
  });

  it('is case-insensitive for trigger', () => {
    const a = buildStimulusFingerprint('Timer', ['git']);
    const b = buildStimulusFingerprint('timer', ['git']);
    assert.equal(a, b);
  });

  it('sorts topics for order independence', () => {
    const a = buildStimulusFingerprint('x', ['b', 'a', 'c']);
    const b = buildStimulusFingerprint('x', ['a', 'b', 'c']);
    assert.equal(a, b);
  });

  it('produces different fingerprints for different inputs', () => {
    const a = buildStimulusFingerprint('timer', ['git']);
    const b = buildStimulusFingerprint('workspace', ['git']);
    assert.notEqual(a, b);
  });
});

describe('StimulusDedup', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dedup-test-'));
  });

  it('first check is never duplicate', () => {
    const dedup = new StimulusDedup(tmpDir);
    const result = dedup.checkAndRecord('abc123', 'timer');
    assert.equal(result.isDuplicate, false);
    assert.equal(result.previousTimestamp, undefined);
  });

  it('second identical fingerprint within window is duplicate', () => {
    const dedup = new StimulusDedup(tmpDir);
    dedup.checkAndRecord('abc123', 'timer');
    const result = dedup.checkAndRecord('abc123', 'timer');
    assert.equal(result.isDuplicate, true);
    assert.ok(result.previousTimestamp);
  });

  it('different fingerprints are not duplicates', () => {
    const dedup = new StimulusDedup(tmpDir);
    dedup.checkAndRecord('abc123', 'timer');
    const result = dedup.checkAndRecord('def456', 'workspace');
    assert.equal(result.isDuplicate, false);
  });

  it('writes entries to JSONL file', () => {
    const dedup = new StimulusDedup(tmpDir);
    dedup.checkAndRecord('fp1', 'a');
    dedup.checkAndRecord('fp2', 'b');
    const content = fs.readFileSync(path.join(tmpDir, 'stimulus-fingerprints.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    assert.equal(lines.length, 2);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.fingerprint, 'fp1');
    assert.ok(entry.timestamp);
  });

  it('prune removes old entries', () => {
    const dedup = new StimulusDedup(tmpDir);
    const filePath = path.join(tmpDir, 'stimulus-fingerprints.jsonl');

    // Write an old entry directly
    const oldEntry = { fingerprint: 'old', timestamp: '2020-01-01T00:00:00.000Z', trigger: 'x' };
    fs.writeFileSync(filePath, JSON.stringify(oldEntry) + '\n', 'utf-8');

    // Add a fresh entry
    dedup.checkAndRecord('fresh', 'y');

    const pruned = dedup.prune();
    assert.equal(pruned, 1);

    // Only fresh entry remains
    const remaining = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    assert.equal(remaining.length, 1);
    assert.ok(remaining[0].includes('fresh'));
  });

  it('DEDUP_HINT is a non-empty string', () => {
    assert.ok(DEDUP_HINT.length > 0);
  });
});
