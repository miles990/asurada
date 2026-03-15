import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from './validate.js';

describe('config validation', () => {
  it('passes valid minimal config', () => {
    const issues = validateConfig({ agent: { name: 'Test' } }, '/tmp');
    const errors = issues.filter(i => i.level === 'error');
    assert.equal(errors.length, 0);
  });

  it('errors on empty agent name', () => {
    const issues = validateConfig({ agent: { name: '' } }, '/tmp');
    const errors = issues.filter(i => i.level === 'error');
    assert.ok(errors.some(e => e.message.includes('name')));
  });

  it('errors on invalid port', () => {
    const issues = validateConfig({ agent: { name: 'Test', port: 99999 } }, '/tmp');
    const errors = issues.filter(i => i.level === 'error');
    assert.ok(errors.some(e => e.message.includes('port')));
  });

  it('warns about missing plugin script', () => {
    const issues = validateConfig({
      agent: { name: 'Test' },
      perception: {
        plugins: [{ name: 'missing', script: 'nonexistent-xyz.sh' }],
      },
    }, '/tmp');
    const warnings = issues.filter(i => i.level === 'warn');
    assert.ok(warnings.some(w => w.message.includes('missing')));
  });

  it('skips disabled plugins', () => {
    const issues = validateConfig({
      agent: { name: 'Test' },
      perception: {
        plugins: [{ name: 'disabled', script: 'nonexistent.sh', enabled: false }],
      },
    }, '/tmp');
    const pluginWarns = issues.filter(i => i.message.includes('disabled'));
    assert.equal(pluginWarns.length, 0);
  });

  it('errors on anthropic-api without key', () => {
    const issues = validateConfig({
      agent: { name: 'Test' },
      loop: { runner: 'anthropic-api' },
    }, '/tmp');
    const errors = issues.filter(i => i.level === 'error');
    assert.ok(errors.some(e => e.message.includes('anthropicApiKey')));
  });

  it('warns on invalid interval format', () => {
    const issues = validateConfig({
      agent: { name: 'Test' },
      loop: { interval: 'invalid' },
    }, '/tmp');
    const warnings = issues.filter(i => i.level === 'warn');
    assert.ok(warnings.some(w => w.message.includes('interval')));
  });

  it('passes valid interval format', () => {
    const issues = validateConfig({
      agent: { name: 'Test' },
      loop: { interval: '5m' },
    }, '/tmp');
    const intervalIssues = issues.filter(i => i.field === 'loop.interval');
    assert.equal(intervalIssues.length, 0);
  });
});
