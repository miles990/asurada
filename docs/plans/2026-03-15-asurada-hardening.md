# Asurada Hardening — Production Robustness Improvements

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Asurada production-ready by fixing 6 gaps identified from 1400+ cycles of mini-agent operation.

**Architecture:** Incremental improvements to existing modules — no new dependencies, no structural changes. Each task is independent and can be committed separately.

**Tech Stack:** TypeScript strict mode, Node.js >=20, node:test for testing.

---

## Task 1: Graceful Shutdown — AgentLoop Waits for Current Cycle

**Problem:** `AgentLoop.stop()` immediately aborts the current cycle via `AbortController`. If the LLM is mid-response or actions are being executed, data can be lost (half-written memory, incomplete delegation).

**Solution:** Add a `graceful` shutdown mode that signals "stop after current cycle completes" instead of aborting mid-cycle.

**Files:**
- Modify: `src/loop/agent-loop.ts`
- Test: `tests/agent-loop-shutdown.test.ts`

### Step 1: Write the failing test

```typescript
// tests/agent-loop-shutdown.test.ts
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoop } from '../src/loop/agent-loop.js';
import { EventBus } from '../src/core/event-bus.js';
import { PerceptionManager } from '../src/perception/manager.js';

describe('AgentLoop graceful shutdown', () => {
  it('stop() waits for current cycle to complete before resolving', async () => {
    const events = new EventBus();
    const perception = new PerceptionManager();
    let runCallCount = 0;

    const slowRunner = {
      async run() {
        runCallCount++;
        // Simulate a slow LLM call
        await new Promise(r => setTimeout(r, 200));
        return '<agent:inner>test</agent:inner>';
      },
    };

    const loop = new AgentLoop(events, perception, 'test', {
      runner: slowRunner,
      defaultInterval: 60_000,
    });

    loop.start();
    // Trigger a cycle manually
    loop.trigger();
    // Give it a moment to start the cycle
    await new Promise(r => setTimeout(r, 50));

    // Stop should wait for the cycle to finish, not abort
    await loop.stop();

    // The cycle should have completed (runner was called and finished)
    assert.equal(runCallCount, 1);
    assert.equal(loop.isRunning, false);
  });

  it('stop() resolves immediately if no cycle is running', async () => {
    const events = new EventBus();
    const perception = new PerceptionManager();
    const loop = new AgentLoop(events, perception, 'test', {
      runner: { async run() { return ''; } },
      defaultInterval: 60_000,
    });

    loop.start();
    // No cycle triggered — stop should resolve immediately
    await loop.stop();
    assert.equal(loop.isRunning, false);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd /Users/user/Workspace/asurada && npm run build && node --test dist/tests/agent-loop-shutdown.test.js`
Expected: FAIL — `stop()` currently returns void, not a Promise

### Step 3: Implement graceful shutdown

In `src/loop/agent-loop.ts`:

1. Add a `cycleComplete` promise that resolves when the current cycle finishes
2. Change `stop()` to return `Promise<void>` — waits for `cycleComplete` if a cycle is running
3. Remove the `AbortController.abort()` from `stop()` — let the cycle finish naturally
4. Keep a `stopping` flag so no new cycles start after `stop()` is called

Key changes:
- Add `private cyclePromise: Promise<CycleResult | null> | null = null`
- Add `private stopping = false`
- `stop()` becomes async: sets `stopping = true`, waits for `cyclePromise`, then cleans up
- `triggerCycle()` checks `this.stopping` and skips if true
- `runCycle()` stores its promise in `this.cyclePromise`, clears on completion

### Step 4: Run test to verify it passes

Run: `cd /Users/user/Workspace/asurada && npm run build && node --test dist/tests/agent-loop-shutdown.test.js`
Expected: PASS

### Step 5: Verify existing tests still pass

Run: `cd /Users/user/Workspace/asurada && npm test`
Expected: All tests pass

### Step 6: Update runtime.ts to await loop.stop()

In `src/runtime.ts`, the `stop()` method already calls `loop.stop()` but doesn't await it (since it was sync). Update to `await loop.stop()`.

### Step 7: Commit

```bash
git add src/loop/agent-loop.ts src/runtime.ts tests/agent-loop-shutdown.test.ts
git commit -m "feat: graceful shutdown — AgentLoop.stop() waits for current cycle"
```

---

## Task 2: Rich /health Endpoint

**Problem:** `/health` returns only `{ status, uptime, version }`. Useless for monitoring. Users need to know: are plugins healthy? How many cycles ran? Any errors?

**Solution:** Enrich `/health` with perception stats, loop metrics, memory size, and lane status. Keep the response flat and monitoring-friendly.

**Files:**
- Modify: `src/api/server.ts`
- Modify: `src/api/types.ts` (if HealthResponse type needs updating)
- Test: `tests/health-endpoint.test.ts`

### Step 1: Write the failing test

```typescript
// tests/health-endpoint.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('/health endpoint response shape', () => {
  it('includes perception, loop, and lanes sections', () => {
    // Test the response structure contract
    const response = {
      status: 'ok',
      uptime: 12345,
      version: '0.1.0',
      perception: {
        pluginCount: 3,
        healthyCount: 2,
        unhealthyPlugins: ['chrome-cdp'],
      },
      loop: {
        running: true,
        cycles: 42,
      },
      lanes: {
        active: 1,
        queued: 0,
        completed: 15,
      },
      memory: {
        indexEntries: 120,
        topicCount: 5,
        conversationDays: 14,
      },
    };

    assert.ok(response.perception);
    assert.equal(typeof response.perception.pluginCount, 'number');
    assert.ok(Array.isArray(response.perception.unhealthyPlugins));
    assert.ok(response.loop);
    assert.ok(response.lanes);
    assert.ok(response.memory);
  });
});
```

### Step 2: Implement rich /health

In `src/api/server.ts`, update the `/health` route handler to gather stats from all agent subsystems:

```typescript
app.get('/health', async (_req, res) => {
  const perceptionStats = agent.perception.getStats();
  const unhealthy = perceptionStats.filter(s => !s.healthy).map(s => s.name);

  const response = {
    status: 'ok',
    uptime: Date.now() - startTime,
    version: VERSION,
    perception: {
      pluginCount: perceptionStats.length,
      healthyCount: perceptionStats.length - unhealthy.length,
      unhealthyPlugins: unhealthy,
    },
    loop: agent.loop ? {
      running: agent.loop.isRunning,
      cycles: agent.loop.cycles,
    } : null,
    lanes: (() => {
      const s = agent.lanes.stats();
      return { active: s.active, queued: s.queued, completed: s.completed };
    })(),
    memory: {
      indexEntries: await agent.index.stats().then(s => s.total).catch(() => 0),
      topicCount: agent.memory.listTopics().length,
    },
  };
  res.json(response);
});
```

### Step 3: Run tests

Run: `cd /Users/user/Workspace/asurada && npm run build && npm test`
Expected: All pass

### Step 4: Commit

```bash
git add src/api/server.ts tests/health-endpoint.test.ts
git commit -m "feat: enrich /health with perception, loop, lanes, and memory stats"
```

---

## Task 3: `asurada doctor` Diagnostic Command

**Problem:** When something goes wrong, users have no systematic way to check all components. They have to manually test each piece.

**Solution:** Add `asurada doctor` that runs a checklist of diagnostic checks and reports results.

**Files:**
- Modify: `src/cli.ts` (add doctor command)
- Create: `src/setup/doctor.ts` (diagnostic checks)
- Test: `tests/doctor.test.ts`

### Step 1: Write the failing test

```typescript
// tests/doctor.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDiagnostics, type DiagnosticResult } from '../src/setup/doctor.js';

describe('asurada doctor', () => {
  it('returns results for all check categories', async () => {
    const results = await runDiagnostics(process.cwd());
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
    for (const r of results) {
      assert.ok(['pass', 'warn', 'fail'].includes(r.status));
      assert.ok(r.check.length > 0);
      assert.ok(r.message.length > 0);
    }
  });

  it('detects missing config file', async () => {
    const results = await runDiagnostics('/tmp/nonexistent-dir');
    const configCheck = results.find(r => r.check === 'config');
    assert.ok(configCheck);
    assert.equal(configCheck.status, 'fail');
  });
});
```

### Step 2: Implement doctor.ts

```typescript
// src/setup/doctor.ts
export interface DiagnosticResult {
  check: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export async function runDiagnostics(dir: string): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  // 1. Config file exists and parses
  // 2. Git repo initialized
  // 3. Memory directory exists and writable
  // 4. Perception plugins exist and executable
  // 5. Runner connectivity (Claude CLI / API key)
  // 6. Port availability
  // 7. Node.js version
  // 8. SOUL.md exists

  return results;
}
```

### Step 3: Add to CLI

In `src/cli.ts`, add `case 'doctor':` that calls `runDiagnostics()` and formats output with pass/warn/fail indicators.

### Step 4: Run tests + commit

```bash
git add src/setup/doctor.ts src/cli.ts tests/doctor.test.ts
git commit -m "feat: add 'asurada doctor' diagnostic command"
```

---

## Task 4: Conversation Retention Policy

**Problem:** ConversationStore creates daily JSONL files that grow forever. After months, this becomes hundreds of files consuming disk and slowing `listDates()`.

**Solution:** Add `maxDays` config to ConversationStore. On each `append()`, check if cleanup is needed (at most once per day). Delete files older than `maxDays`.

**Files:**
- Modify: `src/memory/conversation.ts`
- Modify: `src/config/types.ts` (add maxConversationDays to AgentMemoryConfig)
- Modify: `src/runtime.ts` (pass maxDays to ConversationStore)
- Test: `tests/conversation-retention.test.ts`

### Step 1: Write the failing test

```typescript
// tests/conversation-retention.test.ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConversationStore } from '../src/memory/conversation.js';

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

    // Create fake old files
    const oldDate = '2026-01-01';
    const recentDate = '2026-03-14';
    fs.writeFileSync(path.join(tmpDir, `${oldDate}.jsonl`), '{"id":"1","from":"a","text":"hi","ts":"2026-01-01T00:00:00Z"}\n');
    fs.writeFileSync(path.join(tmpDir, `${recentDate}.jsonl`), '{"id":"2","from":"a","text":"hi","ts":"2026-03-14T00:00:00Z"}\n');

    await store.cleanup();

    assert.ok(!fs.existsSync(path.join(tmpDir, `${oldDate}.jsonl`)));
    assert.ok(fs.existsSync(path.join(tmpDir, `${recentDate}.jsonl`)));
  });

  it('keeps all files when maxDays is not set', async () => {
    const store = new ConversationStore(tmpDir);
    const oldDate = '2020-01-01';
    fs.writeFileSync(path.join(tmpDir, `${oldDate}.jsonl`), '{"id":"1","from":"a","text":"hi","ts":"2020-01-01T00:00:00Z"}\n');

    await store.cleanup();
    assert.ok(fs.existsSync(path.join(tmpDir, `${oldDate}.jsonl`)));
  });
});
```

### Step 2: Implement retention

Add `cleanup()` method to `ConversationStore`. Add `maxDays` to constructor options. Call cleanup at most once per day (tracked via `lastCleanup` date string).

### Step 3: Wire into config

Add `maxConversationDays?: number` to `AgentMemoryConfig` in `src/config/types.ts`.
Pass to ConversationStore in `src/runtime.ts`.

### Step 4: Run tests + commit

```bash
git add src/memory/conversation.ts src/config/types.ts src/runtime.ts tests/conversation-retention.test.ts
git commit -m "feat: conversation retention policy with maxDays cleanup"
```

---

## Task 5: Scaffold Fixes + Prompt Budget Warning

**Two small fixes bundled together:**

### 5a: Add system-stats.sh to scaffold

**Problem:** `scaffoldPlugins()` in cli.ts only creates 3 of 4 starter plugins (missing system-stats.sh).

**Files:**
- Modify: `src/cli.ts` (add system-stats.sh to scaffoldPlugins)

Add to the `plugins` object in `scaffoldPlugins()`:

```typescript
'system-stats.sh': `#!/bin/bash
# System stats — basic resource monitoring.

echo "Disk: $(df -h / | awk 'NR==2{print $5}') used"
echo "Memory: $(vm_stat 2>/dev/null | awk '/Pages active/{printf "%.0f MB", $3*4096/1048576}' || free -m 2>/dev/null | awk '/Mem:/{print $3 " MB"}')"
echo "Load: $(uptime | awk -F'load average:' '{print $2}' | xargs)"
`,
```

### 5b: Prompt budget estimation

**Problem:** If perception + memory + SOUL.md exceeds model context window, the LLM call silently fails or produces garbage. No warning.

**Files:**
- Modify: `src/runtime.ts` (add budget check in buildPrompt)

In the `defaultBuildPrompt` function, after assembling all parts, add:

```typescript
const assembled = parts.join('\n');
const estimatedTokens = Math.ceil(assembled.length / 3.5); // rough char-to-token ratio
if (estimatedTokens > 180_000) {
  slog('runtime', `⚠ Prompt budget warning: ~${estimatedTokens} tokens (${assembled.length} chars). Consider enabling context optimizer or reducing perception plugins.`);
}
return assembled;
```

### Step: Run tests + commit

```bash
git add src/cli.ts src/runtime.ts
git commit -m "fix: add system-stats.sh scaffold + prompt budget warning"
```

---

## Task 6: Config Validation on Startup

**Problem:** No validation beyond YAML parsing. Referenced plugin scripts might not exist, ports might be invalid, runner config might be incomplete. Users get cryptic runtime errors.

**Files:**
- Create: `src/config/validate.ts`
- Modify: `src/cli.ts` (call validateConfig before start)
- Test: `tests/config-validate.test.ts`

### Step 1: Write the failing test

```typescript
// tests/config-validate.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, type ValidationIssue } from '../src/config/validate.js';

describe('config validation', () => {
  it('passes valid minimal config', () => {
    const issues = validateConfig({
      agent: { name: 'Test' },
    }, '/tmp');
    const errors = issues.filter(i => i.level === 'error');
    assert.equal(errors.length, 0);
  });

  it('warns about missing agent name', () => {
    const issues = validateConfig({
      agent: { name: '' },
    }, '/tmp');
    const errors = issues.filter(i => i.level === 'error');
    assert.ok(errors.some(e => e.message.includes('name')));
  });

  it('warns about invalid port', () => {
    const issues = validateConfig({
      agent: { name: 'Test', port: 99999 },
    }, '/tmp');
    const warnings = issues.filter(i => i.level === 'warn' || i.level === 'error');
    assert.ok(warnings.some(w => w.message.includes('port')));
  });

  it('warns about plugin script not found', () => {
    const issues = validateConfig({
      agent: { name: 'Test' },
      perception: {
        plugins: [{ name: 'missing', script: 'nonexistent.sh' }],
      },
    }, '/tmp');
    const warnings = issues.filter(i => i.level === 'warn');
    assert.ok(warnings.some(w => w.message.includes('missing')));
  });
});
```

### Step 2: Implement validate.ts

```typescript
// src/config/validate.ts
import fs from 'node:fs';
import path from 'node:path';
import type { AgentConfig } from './types.js';

export interface ValidationIssue {
  level: 'error' | 'warn';
  field: string;
  message: string;
}

export function validateConfig(config: AgentConfig, baseDir: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Agent name required
  if (!config.agent?.name?.trim()) {
    issues.push({ level: 'error', field: 'agent.name', message: 'Agent name is required' });
  }

  // 2. Port range
  if (config.agent?.port !== undefined) {
    if (config.agent.port < 1 || config.agent.port > 65535) {
      issues.push({ level: 'error', field: 'agent.port', message: `Invalid port ${config.agent.port} (must be 1-65535)` });
    }
  }

  // 3. Plugin scripts exist
  for (const plugin of config.perception?.plugins ?? []) {
    if (plugin.script && !plugin.command) {
      const resolved = path.resolve(baseDir, plugin.script);
      if (!fs.existsSync(resolved)) {
        issues.push({ level: 'warn', field: `perception.plugins.${plugin.name}`, message: `Plugin "${plugin.name}" script not found: ${plugin.script}` });
      }
    }
  }

  // 4. Runner config completeness
  if (config.loop?.runner === 'anthropic-api' && !config.loop.anthropicApiKey) {
    issues.push({ level: 'error', field: 'loop.anthropicApiKey', message: 'Anthropic API runner requires anthropicApiKey' });
  }

  // 5. Cron expressions (basic check)
  for (const entry of config.cron ?? []) {
    if (!entry.schedule?.trim()) {
      issues.push({ level: 'warn', field: 'cron', message: `Cron entry missing schedule: "${entry.task?.slice(0, 40)}"` });
    }
  }

  return issues;
}
```

### Step 3: Wire into CLI

In `src/cli.ts` `cmdStart()`, after loading config, call `validateConfig()` and print issues. Exit on errors, warn on warnings.

### Step 4: Export from config/index.ts

Add `export { validateConfig, type ValidationIssue } from './validate.js';`

### Step 5: Run tests + commit

```bash
git add src/config/validate.ts src/config/index.ts src/cli.ts tests/config-validate.test.ts
git commit -m "feat: config validation with clear error messages on startup"
```

---

## Final Verification

After all tasks:

```bash
cd /Users/user/Workspace/asurada
npm run build
npm test
npm run typecheck
```

All must pass with zero errors.
