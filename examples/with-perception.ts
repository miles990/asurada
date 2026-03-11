/**
 * Perception-driven agent — Asurada's core value proposition.
 *
 * This agent:
 * 1. Uses real shell scripts as perception plugins (git status, disk space, uptime)
 * 2. Feeds perception data into each OODA cycle
 * 3. Lets the LLM decide what to do based on what it *sees*
 *
 * The key insight: your agent doesn't follow a plan — it reacts to its environment.
 * Different environments produce different behaviors, even with the same system prompt.
 *
 * Run: npx tsx examples/with-perception.ts
 */

import {
  createAgentFromConfig,
  ClaudeCliRunner,
  type CycleRunner,
  type ParsedAction,
  type CycleContext,
} from '../src/index.js';

// === Choose your runner ===
//
// Real LLM (uncomment one):
//   const runner = new ClaudeCliRunner({ model: 'sonnet' });
//   const runner = new AnthropicApiRunner({ apiKey: process.env.ANTHROPIC_API_KEY! });
//
// Mock (no LLM needed — for testing):
const runner: CycleRunner = {
  async run(prompt) {
    // A smarter mock that reads perception data from the prompt
    const hasGitChanges = prompt.includes('modified:') || prompt.includes('Untracked');
    const diskUsage = prompt.match(/(\d+)% used/)?.[1];
    const highDisk = diskUsage && parseInt(diskUsage) > 80;

    let response = '## Decision\n';

    if (hasGitChanges) {
      response += 'chose: Noticed uncommitted git changes — flagging for attention\n\n';
      response += '<agent:chat>Hey, you have uncommitted changes in the repo. Might want to commit or stash.</agent:chat>\n';
    } else if (highDisk) {
      response += `chose: Disk usage at ${diskUsage}% — worth mentioning\n\n`;
      response += `<agent:chat>Disk usage is at ${diskUsage}%. Consider cleaning up.</agent:chat>\n`;
    } else {
      response += 'chose: Environment looks healthy, nothing urgent\n\n';
      response += '<agent:remember>Routine check — all systems nominal</agent:remember>\n';
    }

    response += '\n<agent:schedule next="2m" reason="Regular perception check" />';
    return response;
  },
};

// === Action handler ===

async function handleAction(action: ParsedAction, context: CycleContext): Promise<void> {
  const prefix = `[cycle #${context.cycleNumber}]`;

  switch (action.tag) {
    case 'remember':
      console.log(`${prefix} 💾 Memory: "${action.content}"`);
      break;
    case 'chat':
      console.log(`${prefix} 💬 Agent: "${action.content}"`);
      break;
    case 'schedule':
      console.log(`${prefix} ⏰ Next cycle in ${action.attrs.next} (${action.attrs.reason})`);
      break;
    default:
      console.log(`${prefix} 🔧 ${action.tag}: ${action.content || JSON.stringify(action.attrs)}`);
  }
}

// === Main ===

async function main() {
  const agent = await createAgentFromConfig(
    {
      agent: { name: 'Watchdog', persona: 'A perception-driven environment monitor' },
      loop: { enabled: true, interval: '2m' },
      perception: {
        plugins: [
          // Plugin 1: Git status — what's changed in the repo?
          {
            name: 'git-status',
            script: 'git status --short 2>/dev/null || echo "Not a git repo"',
            category: 'workspace',
            interval: 30000,
          },
          // Plugin 2: Disk usage — is the system healthy?
          {
            name: 'disk-usage',
            script: "df -h / | awk 'NR==2 {print $5 \" used (\" $4 \" free)\"}'",
            category: 'system',
            interval: 60000,
          },
          // Plugin 3: System uptime — how long since last reboot?
          {
            name: 'uptime',
            script: 'uptime',
            category: 'system',
            interval: 60000,
          },
        ],
      },
    },
    {
      loop: {
        runner,
        systemPrompt: `You are Watchdog, a system monitoring agent.
You observe your environment through perception plugins and report anything noteworthy.
Use <agent:chat> to alert the user about issues.
Use <agent:remember> to log routine observations.
Use <agent:schedule next="Xm"> to set your next check interval.`,
        actionNamespace: 'agent',
        onAction: handleAction,
      },
    },
  );

  console.log(`🐕 ${agent.config.agent.name} started (instance: ${agent.instanceId})`);
  console.log('Perception plugins:', agent.config.perception?.plugins?.map(p => p.name).join(', '));
  console.log('Waiting for first cycle...\n');

  // Listen to perception events
  agent.events.on('action:perception', (event) => {
    const data = event.data as { plugin: string; output: string };
    if (data.output) {
      console.log(`[perception] ${data.plugin}: ${data.output.slice(0, 100)}`);
    }
  });

  // Listen to cycle completion
  agent.events.on('action:cycle', (event) => {
    const d = event.data as { event: string; cycle?: number; duration?: number; actionCount?: number };
    if (d.event === 'complete') {
      console.log(`\n[cycle #${d.cycle}] Completed in ${d.duration}ms — ${d.actionCount} action(s)\n`);
    }
  });

  await agent.start();

  // Trigger first cycle immediately
  agent.loop?.trigger();

  // Run for 30 seconds, then stop
  await new Promise(resolve => setTimeout(resolve, 30_000));

  await agent.stop();
  console.log('\n🐕 Watchdog stopped.');
}

main().catch(console.error);
