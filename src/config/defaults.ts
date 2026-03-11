/**
 * Sensible defaults — a minimal config should just work.
 */

import type { AgentConfig } from './types.js';

/** Default agent configuration (merged under user config) */
export const DEFAULT_CONFIG: Omit<AgentConfig, 'agent'> = {
  loop: {
    enabled: true,
    interval: '5m',
    model: 'sonnet',
  },
  notification: {
    providers: [{ type: 'console' }],
  },
  perception: {
    categoryIntervals: {
      workspace: 60_000,
      network: 120_000,
      heartbeat: 1_800_000,
    },
    plugins: [],
  },
  memory: {
    topics: true,
    search: {
      enabled: true,
      maxResults: 5,
    },
  },
  logging: {
    categories: ['agent', 'api', 'error', 'diag', 'behavior'],
  },
  lanes: {
    maxConcurrent: 6,
    maxTimeoutMs: 600_000,
    maxTurnsCap: 10,
    outputTailChars: 5_000,
    typeDefaults: {
      code:     { maxTurns: 5, timeoutMs: 300_000 },
      learn:    { maxTurns: 3, timeoutMs: 300_000 },
      research: { maxTurns: 5, timeoutMs: 480_000 },
      create:   { maxTurns: 5, timeoutMs: 480_000 },
      review:   { maxTurns: 3, timeoutMs: 180_000 },
    },
  },
  skills: [],
  cron: [],
};

/** Minimal starter config for new agents */
export const STARTER_CONFIG: AgentConfig = {
  agent: {
    name: 'My Assistant',
    persona: 'A helpful personal AI assistant that monitors your workspace.',
    port: 3001,
  },
  ...DEFAULT_CONFIG,
  perception: {
    ...DEFAULT_CONFIG.perception,
    plugins: [
      { name: 'tasks', script: './plugins/task-tracker.sh', category: 'workspace' },
      { name: 'git', script: './plugins/git-status.sh', category: 'workspace' },
    ],
  },
  cron: [
    { schedule: '*/30 * * * *', task: 'Check pending tasks and execute if any' },
  ],
};
