/**
 * Integration test — verifies a full OODA cycle end-to-end.
 *
 * Creates an agent with a mock runner, starts it, triggers a cycle,
 * and verifies that memory was written, notifications were sent,
 * and conversation was stored.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createAgentFromConfig, type Agent } from '../runtime.js';
import type { CycleRunner } from './types.js';
import type { NotificationProvider, SendOptions, NotificationStats } from '../notification/types.js';
import type { AgentConfig } from '../config/types.js';
import type { AgentEvent } from '../core/event-bus.js';

/** Wait for a specific cycle event from the agent */
function waitForCycleEvent(agent: Agent, eventName: string): Promise<void> {
  return new Promise<void>(resolve => {
    const handler = (event: AgentEvent) => {
      if ((event.data as Record<string, unknown>).event === eventName) {
        agent.events.off('action:cycle', handler);
        resolve();
      }
    };
    agent.events.on('action:cycle', handler);
  });
}

function createMockRunner(response: string): CycleRunner {
  return {
    async run(): Promise<string> {
      return response;
    },
  };
}

function createMockNotifier(): NotificationProvider & { messages: string[] } {
  const messages: string[] = [];
  return {
    name: 'mock',
    messages,
    async send(message: string, _options?: SendOptions): Promise<boolean> {
      messages.push(message);
      return true;
    },
    getStats(): NotificationStats {
      return { sent: messages.length, failed: 0 };
    },
  };
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'asurada-test-'));
}

function baseConfig(tmpDir: string): AgentConfig {
  return {
    agent: { name: 'test-agent' },
    memory: { dir: path.join(tmpDir, 'memory') },
    paths: { data: path.join(tmpDir, 'data') },
    obsidian: { enabled: false },
  };
}

describe('Full cycle integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('remember action persists to memory file', async () => {
    const runner = createMockRunner(
      'I observed the environment.\n<agent:remember>Integration test insight</agent:remember>'
    );

    const agent = await createAgentFromConfig(baseConfig(tmpDir), {
      baseDir: tmpDir,
      loop: { runner },
    });

    await agent.start();
    const done = waitForCycleEvent(agent, 'complete');
    agent.loop!.trigger();
    await done;
    await agent.stop();

    const memoryFile = path.join(tmpDir, 'memory', 'MEMORY.md');
    assert.ok(fs.existsSync(memoryFile), 'MEMORY.md should exist');
    const content = fs.readFileSync(memoryFile, 'utf-8');
    assert.ok(content.includes('Integration test insight'), 'Memory should contain the remembered text');
  });

  it('chat action sends notification', async () => {
    const runner = createMockRunner(
      '<agent:chat>Hello from the agent!</agent:chat>'
    );
    const notifier = createMockNotifier();

    const agent = await createAgentFromConfig(baseConfig(tmpDir), {
      baseDir: tmpDir,
      loop: { runner },
      notificationProviders: [{ type: 'mock', provider: notifier }],
    });

    await agent.start();
    const done = waitForCycleEvent(agent, 'complete');
    agent.loop!.trigger();
    await done;
    await agent.stop();

    assert.ok(notifier.messages.length > 0, 'Should have sent at least one notification');
    assert.ok(notifier.messages.some(m => m.includes('Hello from the agent!')));
  });

  it('delegate action spawns lane task', async () => {
    const runner = createMockRunner(
      '<agent:delegate type="research">Find something interesting</agent:delegate>'
    );

    const spawned: Array<{ type: string; prompt: string }> = [];

    const agent = await createAgentFromConfig(baseConfig(tmpDir), {
      baseDir: tmpDir,
      loop: { runner },
      taskExecutor: {
        execute(spec) {
          spawned.push({ type: spec.type, prompt: spec.prompt });
          return {
            onOutput() {},
            onClose(cb: (code: number | null) => void) { setTimeout(() => cb(0), 0); },
            abort() {},
          };
        },
      },
    });

    await agent.start();
    const done = waitForCycleEvent(agent, 'complete');
    agent.loop!.trigger();
    await done;
    await agent.stop();

    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].type, 'research');
    assert.ok(spawned[0].prompt.includes('Find something interesting'));
  });

  it('schedule tag is handled without error', async () => {
    const runner = createMockRunner(
      'Nothing urgent.\n<agent:schedule next="2m" reason="checking later" />'
    );

    const agent = await createAgentFromConfig(baseConfig(tmpDir), {
      baseDir: tmpDir,
      loop: { runner },
    });

    await agent.start();
    const done = waitForCycleEvent(agent, 'complete');
    agent.loop!.trigger();
    await done;
    await agent.stop();

    assert.ok(true, 'Schedule tag handled without error');
  });

  it('circuit breaker opens after max consecutive failures', async () => {
    let callCount = 0;
    const failingRunner: CycleRunner = {
      async run(): Promise<string> {
        callCount++;
        throw new Error('LLM unavailable');
      },
    };

    const agent = await createAgentFromConfig(baseConfig(tmpDir), {
      baseDir: tmpDir,
      loop: {
        runner: failingRunner,
        maxConsecutiveFailures: 3,
        circuitBreakerCooldown: 0,
      },
    });

    let circuitOpenSeen = false;
    agent.events.on('action:cycle', (event) => {
      if ((event.data as Record<string, unknown>).event === 'circuit-open') {
        circuitOpenSeen = true;
      }
    });

    await agent.start();

    // Trigger 3 cycles — each will fail
    for (let i = 0; i < 3; i++) {
      const eventName = i < 2 ? 'error' : 'circuit-open';
      const done = waitForCycleEvent(agent, eventName);
      agent.loop!.trigger();
      await done;
    }

    await agent.stop();

    assert.equal(callCount, 3, 'Runner should have been called 3 times');
    assert.ok(circuitOpenSeen, 'Circuit breaker should have opened');
  });

  it('incoming user message is stored in conversation history', async () => {
    const runner = createMockRunner(
      '<agent:chat>Got your message!</agent:chat>'
    );

    const agent = await createAgentFromConfig(baseConfig(tmpDir), {
      baseDir: tmpDir,
      loop: { runner },
    });

    await agent.start();
    const done = waitForCycleEvent(agent, 'complete');
    agent.events.emit('trigger:chat', {
      message: { id: 'test-001', from: 'alex', text: 'Hello agent!' },
    });
    await done;
    await agent.stop();

    // Small delay to let async append finish
    await new Promise(r => setTimeout(r, 50));

    const messages = await agent.conversations.recent({ limit: 10 });
    const userMsg = messages.find(m => m.from === 'alex');
    assert.ok(userMsg, 'User message should be stored in conversation history');
    assert.equal(userMsg!.text, 'Hello agent!');
  });
});
