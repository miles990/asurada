/**
 * Minimal Asurada agent — proves the framework works end-to-end.
 *
 * This agent:
 * 1. Uses a mock CycleRunner (no LLM needed)
 * 2. Runs one OODA cycle
 * 3. Parses actions from the response
 * 4. Stores a memory entry
 *
 * Run: npx tsx examples/minimal.ts
 */

import {
  createAgentFromConfig,
  type CycleRunner,
  type ParsedAction,
  type CycleContext,
} from '../src/index.js';

// === Mock LLM — responds with agent tags ===

const mockRunner: CycleRunner = {
  async run(prompt, _systemPrompt) {
    console.log('\n--- LLM received prompt ---');
    console.log(prompt.slice(0, 200) + (prompt.length > 200 ? '...' : ''));
    console.log('--- end prompt ---\n');

    // Simulate an LLM response with action tags
    return `
## Decision
chose: Check in and say hello (trigger: timer — first cycle)

I see ${Object.keys(JSON.parse('{}') || {}).length || 'no'} perception signals. This is my first cycle.

<agent:remember>First cycle completed successfully at ${new Date().toISOString()}</agent:remember>

<agent:chat>Hello! I'm alive and running my first OODA cycle.</agent:chat>

<agent:schedule next="1m" reason="Just started, checking in soon" />
    `.trim();
  },
};

// === Action handler — what happens when the LLM emits tags ===

async function handleAction(action: ParsedAction, _context: CycleContext): Promise<void> {
  switch (action.tag) {
    case 'remember':
      console.log(`[memory] Storing: "${action.content}"`);
      break;
    case 'chat':
      console.log(`[chat] Agent says: "${action.content}"`);
      break;
    default:
      console.log(`[action] ${action.tag}: ${action.content || JSON.stringify(action.attrs)}`);
  }
}

// === Main ===

async function main() {
  console.log('Creating agent...');

  const agent = await createAgentFromConfig(
    {
      agent: { name: 'Demo', persona: 'Minimal Asurada example agent' },
      loop: { enabled: true, interval: '30s' },
    },
    {
      loop: {
        runner: mockRunner,
        systemPrompt: 'You are a helpful agent. Respond with action tags.',
        actionNamespace: 'agent',
        onAction: handleAction,
      },
    },
  );

  console.log(`Agent "${agent.config.agent.name}" created (instance: ${agent.instanceId})`);

  // Listen to lifecycle events
  agent.events.on('action:*', (event) => {
    if (event.type === 'action:lifecycle') {
      console.log(`[lifecycle] ${(event.data as { event: string }).event}`);
    }
    if (event.type === 'action:cycle') {
      const d = event.data as { event: string; cycle?: number; duration?: number; actionCount?: number };
      if (d.event === 'complete') {
        console.log(`[cycle] #${d.cycle} done in ${d.duration}ms — ${d.actionCount} action(s)`);
      }
    }
  });

  // Start the agent
  await agent.start();
  console.log('Agent started. Waiting for first cycle...\n');

  // Manually trigger one cycle instead of waiting for timer
  agent.loop?.trigger();

  // Wait for cycle to complete, then stop
  await new Promise(resolve => setTimeout(resolve, 2000));

  await agent.stop();
  console.log('\nAgent stopped. Done.');
}

main().catch(console.error);
