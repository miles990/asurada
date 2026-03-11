/**
 * Personality Configs — same framework, different agents.
 *
 * Shows how YAML configuration shapes agent behavior:
 * 1. A focused dev assistant (fast cycles, code-aware perception)
 * 2. A calm research companion (slow cycles, web + reading perception)
 * 3. A security sentinel (alert-driven, system monitoring)
 *
 * Each config demonstrates different perception plugins, intervals,
 * notification strategies, and multi-lane delegation settings.
 *
 * Run: npx tsx examples/personality-configs.ts
 */

import {
  createAgentFromConfig,
  type AgentConfig,
  type CycleRunner,
  type ParsedAction,
  type CycleContext,
} from '../src/index.js';

// === Three agent personalities, defined entirely through config ===

const devAssistant: AgentConfig = {
  agent: {
    name: 'Hachi',
    persona: 'Fast-moving dev assistant — watches code, catches bugs, ships fixes',
    port: 4001,
  },
  loop: {
    enabled: true,
    interval: '2m',     // Short cycles — responsive to code changes
    model: 'sonnet',
  },
  perception: {
    categoryIntervals: {
      workspace: 30_000,   // Watch for file changes every 30s
      system: 120_000,     // System health every 2m
    },
    plugins: [
      {
        name: 'git-status',
        command: 'git status --porcelain 2>/dev/null | head -20',
        category: 'workspace',
        interval: 30_000,
      },
      {
        name: 'test-results',
        command: 'cat .test-results 2>/dev/null || echo "no recent test run"',
        category: 'workspace',
        interval: 60_000,
      },
      {
        name: 'build-errors',
        command: 'cat .build-log 2>/dev/null | tail -10 || echo "clean"',
        category: 'workspace',
        interval: 60_000,
      },
    ],
  },
  notification: {
    providers: [
      { type: 'console' },  // Terminal output
    ],
  },
  lanes: {
    maxConcurrent: 4,      // More parallel tasks for code work
    taskTypes: {
      code:    { maxTurns: 8, timeoutMs: 600_000 },
      review:  { maxTurns: 3, timeoutMs: 180_000 },
      test:    { maxTurns: 5, timeoutMs: 300_000 },
    } as Record<string, import('../src/lanes/types.js').TaskTypeConfig>,
  },
};

const researchCompanion: AgentConfig = {
  agent: {
    name: 'Mizu',
    persona: 'Patient research companion — reads deeply, connects ideas, never rushes',
    port: 4002,
  },
  loop: {
    enabled: true,
    interval: '15m',      // Long cycles — quality over speed
    model: 'opus',        // Deep reasoning model
  },
  perception: {
    categoryIntervals: {
      workspace: 300_000,   // Check files every 5m (not urgent)
      web: 600_000,         // Web sources every 10m
    },
    plugins: [
      {
        name: 'reading-list',
        command: 'cat ~/reading-list.md 2>/dev/null | head -30 || echo "empty"',
        category: 'workspace',
        interval: 300_000,
      },
      {
        name: 'recent-notes',
        command: 'find ~/notes -name "*.md" -mmin -60 -type f 2>/dev/null | head -10 || echo "no recent notes"',
        category: 'workspace',
        interval: 300_000,
      },
    ],
  },
  notification: {
    providers: [
      { type: 'console', minTier: 'important' },  // Only important stuff
    ],
  },
  lanes: {
    maxConcurrent: 2,      // Fewer lanes — focus over breadth
    taskTypes: {
      research: { maxTurns: 5, timeoutMs: 480_000 },
      learn:    { maxTurns: 3, timeoutMs: 300_000 },
    } as Record<string, import('../src/lanes/types.js').TaskTypeConfig>,
  },
};

const securitySentinel: AgentConfig = {
  agent: {
    name: 'Sentinel',
    persona: 'Vigilant security monitor — watches systems, alerts on anomalies, never sleeps',
    port: 4003,
  },
  loop: {
    enabled: true,
    interval: '1m',        // Fast heartbeat
    model: 'haiku',        // Speed over depth for triage
  },
  perception: {
    categoryIntervals: {
      system: 30_000,       // System checks every 30s
      network: 60_000,      // Network every 1m
    },
    plugins: [
      {
        name: 'disk-usage',
        command: 'df -h / | tail -1 | awk \'{print $5}\'',
        category: 'system',
        interval: 60_000,
      },
      {
        name: 'process-count',
        command: 'ps aux | wc -l | tr -d " "',
        category: 'system',
        interval: 30_000,
      },
      {
        name: 'failed-logins',
        command: 'last -10 2>/dev/null | grep -c "invalid" || echo "0"',
        category: 'system',
        interval: 60_000,
      },
      {
        name: 'open-ports',
        command: 'lsof -i -P -n 2>/dev/null | grep LISTEN | wc -l | tr -d " "',
        category: 'network',
        interval: 120_000,
      },
    ],
  },
  notification: {
    providers: [
      { type: 'console' },
      // In production, add Telegram/Discord for alerts:
      // { type: 'telegram', options: { botToken: '...', chatId: '...' } },
    ],
  },
  lanes: {
    maxConcurrent: 2,
    taskTypes: {
      scan:  { maxTurns: 3, timeoutMs: 120_000 },
      alert: { maxTurns: 1, timeoutMs: 30_000 },
    } as Record<string, import('../src/lanes/types.js').TaskTypeConfig>,
  },
};

// === Demo: create each agent and show its config ===

const mockRunner: CycleRunner = {
  async run(prompt) {
    // Each agent "thinks" differently based on its perception
    const name = prompt.includes('Hachi') ? 'Hachi'
      : prompt.includes('Mizu') ? 'Mizu'
      : 'Sentinel';

    const responses: Record<string, string> = {
      Hachi: `
## Decision
chose: Review uncommitted changes (drive — git-status shows modifications)

I see code changes. Let me check what's been modified and whether tests pass.

<agent:chat>Found uncommitted changes — reviewing before they get stale.</agent:chat>
      `.trim(),

      Mizu: `
## Decision
chose: Deep read on recent notes (drive — new .md files in ~/notes)

Three new notes from today. Let me read them and find connections to existing research threads.

<agent:remember>Connected note on distributed systems to earlier research on slime mold networks — both optimize for resilience over efficiency.</agent:remember>
      `.trim(),

      Sentinel: `
## Decision
chose: Routine system check (drive — scheduled heartbeat)

Disk: 45% used. 312 processes. 0 failed logins. 8 listening ports (expected). All nominal.

<agent:schedule next="1m" reason="All clear, continuing watch" />
      `.trim(),
    };

    return responses[name] || responses['Sentinel'];
  },
};

async function handleAction(action: ParsedAction, _ctx: CycleContext): Promise<void> {
  switch (action.tag) {
    case 'remember':
      console.log(`  [memory] ${action.content}`);
      break;
    case 'chat':
      console.log(`  [chat] ${action.content}`);
      break;
    default:
      console.log(`  [${action.tag}] ${action.content || JSON.stringify(action.attrs)}`);
  }
}

async function demoAgent(config: AgentConfig) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${config.agent.name} — "${config.agent.persona}"`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Cycle interval: ${config.loop?.interval}`);
  console.log(`  Model: ${config.loop?.model}`);
  console.log(`  Plugins: ${config.perception?.plugins?.map(p => p.name).join(', ')}`);
  console.log(`  Max lanes: ${config.lanes?.maxConcurrent ?? 6}`);
  console.log();

  const agent = await createAgentFromConfig(config, {
    loop: {
      runner: mockRunner,
      systemPrompt: `You are ${config.agent.name}. ${config.agent.persona}.`,
      actionNamespace: 'agent',
      onAction: handleAction,
    },
  });

  await agent.start();
  agent.loop?.trigger();

  await new Promise(resolve => setTimeout(resolve, 2000));
  await agent.stop();
}

async function main() {
  console.log('Asurada Personality Configs Demo');
  console.log('Three agents, same framework, different behaviors.\n');

  await demoAgent(devAssistant);
  await demoAgent(researchCompanion);
  await demoAgent(securitySentinel);

  console.log('\n--- All done. Same framework, three personalities. ---');
  console.log('Config shapes behavior: intervals, models, plugins, lanes.');
  console.log('Your agent is defined by what it perceives and how it thinks.');
}

main().catch(console.error);
