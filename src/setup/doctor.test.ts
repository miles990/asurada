import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDiagnostics, formatDiagnostics } from './doctor.js';

describe('asurada doctor', () => {
  it('returns results array with correct shape', async () => {
    const results = await runDiagnostics(process.cwd());
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
    for (const r of results) {
      assert.ok(['pass', 'warn', 'fail'].includes(r.status));
      assert.ok(r.check.length > 0);
      assert.ok(r.message.length > 0);
    }
  });

  it('node check passes on current runtime', async () => {
    const results = await runDiagnostics(process.cwd());
    const nodeCheck = results.find(r => r.check === 'node');
    assert.ok(nodeCheck);
    assert.equal(nodeCheck.status, 'pass');
  });

  it('git check passes when git is available', async () => {
    const results = await runDiagnostics(process.cwd());
    const gitCheck = results.find(r => r.check === 'git');
    assert.ok(gitCheck);
    assert.equal(gitCheck.status, 'pass');
  });

  it('config check fails for nonexistent directory', async () => {
    const results = await runDiagnostics('/tmp/nonexistent-asurada-test-dir-12345');
    const configCheck = results.find(r => r.check === 'config');
    assert.ok(configCheck);
    assert.equal(configCheck.status, 'fail');
  });

  it('formatDiagnostics produces readable output', () => {
    const results = [
      { check: 'node', status: 'pass' as const, message: 'Node.js 22.0.0' },
      { check: 'git', status: 'warn' as const, message: 'Git not configured' },
      { check: 'config', status: 'fail' as const, message: 'Missing config' },
    ];
    const output = formatDiagnostics(results);
    assert.ok(output.includes('✓'));
    assert.ok(output.includes('⚠'));
    assert.ok(output.includes('✗'));
    assert.ok(output.includes('1 passed'));
    assert.ok(output.includes('1 warnings'));
    assert.ok(output.includes('1 failures'));
  });
});
