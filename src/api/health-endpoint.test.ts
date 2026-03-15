import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HealthResponse } from './types.js';

describe('/health response contract', () => {
  it('ok status when all plugins healthy', () => {
    const response: HealthResponse = {
      status: 'ok',
      uptime: 12345,
      version: '0.1.0',
      perception: { pluginCount: 3, healthyCount: 3, unhealthyPlugins: [] },
      loop: { running: true, cycles: 42 },
      lanes: { active: 1, queued: 0, completed: 15 },
      memory: { indexEntries: 120, topicCount: 5 },
    };
    assert.equal(response.status, 'ok');
    assert.equal(response.perception!.unhealthyPlugins.length, 0);
  });

  it('degraded status when plugins unhealthy', () => {
    const response: HealthResponse = {
      status: 'degraded',
      uptime: 12345,
      version: '0.1.0',
      perception: { pluginCount: 3, healthyCount: 2, unhealthyPlugins: ['chrome-cdp'] },
      loop: null,
      lanes: { active: 0, queued: 0, completed: 0 },
      memory: { indexEntries: 0, topicCount: 0 },
    };
    assert.equal(response.status, 'degraded');
    assert.deepEqual(response.perception!.unhealthyPlugins, ['chrome-cdp']);
  });

  it('loop can be null when not configured', () => {
    const response: HealthResponse = {
      status: 'ok',
      uptime: 100,
      version: '0.1.0',
      loop: null,
    };
    assert.equal(response.loop, null);
  });
});
