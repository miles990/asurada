#!/usr/bin/env node
/**
 * Asurada CLI — the entry point for users.
 *
 *   asurada init            Create starter config
 *   asurada start           Start agent (foreground)
 *   asurada start -d        Start agent (daemon)
 *   asurada stop            Stop daemon
 *   asurada status          Check agent status
 *   asurada logs [-f]       Show recent logs
 *
 * No external CLI framework — just process.argv.
 */

import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findConfigFile, loadConfig, writeConfig, getDefaultDataDir, type AgentConfig } from './config/index.js';
import { createAgent, type CreateAgentOptions } from './runtime.js';
import { startServer } from './api/server.js';
import { createProcessManager } from './process/factory.js';
import { ClaudeCliRunner } from './loop/runners/claude-cli.js';
import { AnthropicApiRunner } from './loop/runners/anthropic-api.js';
import { slog } from './logging/index.js';
import { detectEnvironment, formatDetection, runWizard } from './setup/index.js';

// === Parse Args ===

const args = process.argv.slice(2);
const command = args[0] ?? 'help';

function flag(name: string): boolean {
  return args.includes(`--${name}`) || args.includes(`-${name[0]}`);
}

function option(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

// === Commands ===

async function main(): Promise<void> {
  switch (command) {
    case 'init':
      return cmdInit();
    case 'start':
    case 'up':
      return cmdStart();
    case 'stop':
    case 'down':
      return cmdStop();
    case 'status':
      return cmdStatus();
    case 'logs':
      return cmdLogs();
    case 'help':
    case '--help':
    case '-h':
      return cmdHelp();
    case 'version':
    case '--version':
    case '-v':
      return cmdVersion();
    default:
      console.error(`Unknown command: ${command}`);
      cmdHelp();
      process.exit(1);
  }
}

// --- init ---

async function cmdInit(): Promise<void> {
  const dir = process.cwd();
  const existing = findConfigFile(dir);
  if (existing) {
    console.error(`Config already exists: ${existing}`);
    console.error(`Run \`asurada init --reconfigure\` to re-detect environment.`);
    if (!flag('reconfigure')) process.exit(1);
  }

  // Phase A: Environment detection
  console.log('\nDetecting environment...\n');
  const env = detectEnvironment();
  console.log(formatDetection(env));

  // Validate hard requirements
  if (!env.git.available) {
    console.error('Git is required for memory versioning. Install git and retry.');
    process.exit(1);
  }

  // Phase B & C: Interactive wizard (or use CLI flags for non-interactive)
  const nonInteractive = flag('yes') || flag('y') || !process.stdin.isTTY;
  const port = option('port') ? parseInt(option('port')!, 10) : undefined;

  let name = option('name') ?? 'My Assistant';
  let runner: string | undefined;
  let notifications: Array<{ type: string; options?: Record<string, unknown> }> = [];

  if (nonInteractive) {
    // Non-interactive: use defaults + env detection
    if (env.llm.anthropicApi) runner = 'anthropic-api';
    else if (env.llm.claudeCli.available) runner = 'claude-cli';
    notifications = [{ type: 'console' }];
  } else {
    // Interactive wizard
    const wizard = await runWizard(env);
    name = wizard.name;
    runner = wizard.runner;
    notifications = wizard.notifications.length > 0
      ? wizard.notifications
      : [{ type: 'console' }];

    // Apply persona via config
    if (wizard.persona) {
      // Will be set in writeConfig options
    }
  }

  // Create config with wizard results
  const filePath = writeConfig(dir, {
    name,
    port,
    runner,
    notifications,
  });
  console.log(`Created ${path.relative(dir, filePath)}`);

  // Create starter plugins so perception works out of the box
  scaffoldPlugins(dir);

  // Init git repo for memory versioning
  initGitRepo(dir);

  console.log();
  console.log('Next steps:');
  console.log('  1. asurada start');
  if (env.obsidian.available) {
    console.log('  2. Open Obsidian to browse agent memory as a vault');
  }
}

function scaffoldPlugins(dir: string): void {
  const pluginsDir = path.join(dir, 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });

  const plugins: Record<string, string> = {
    'task-tracker.sh': `#!/bin/bash
# Task tracker — reads TODO/NEXT files and shows pending tasks.
# Customize this to match your task management style.

if [ -f "./NEXT.md" ]; then
  echo "## Tasks"
  grep -E "^- \\[[ x]\\]" ./NEXT.md 2>/dev/null | head -10
elif [ -f "./TODO.md" ]; then
  echo "## Tasks"
  grep -E "^- \\[[ x]\\]" ./TODO.md 2>/dev/null | head -10
else
  echo "No task file found (create NEXT.md or TODO.md)"
fi
`,
    'git-status.sh': `#!/bin/bash
# Git status — shows repo state for workspace awareness.

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "Not a git repository"
  exit 0
fi

BRANCH=$(git branch --show-current 2>/dev/null)
CHANGES=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
UNPUSHED=$(git log --oneline @{u}..HEAD 2>/dev/null | wc -l | tr -d ' ')

echo "Branch: $BRANCH"
echo "Changes: $CHANGES files"
echo "Unpushed: $UNPUSHED commits"

if [ "$CHANGES" -gt 0 ]; then
  echo ""
  echo "Modified:"
  git status --porcelain 2>/dev/null | head -10
fi
`,
  };

  let created = 0;
  for (const [name, content] of Object.entries(plugins)) {
    const filePath = path.join(pluginsDir, name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, { mode: 0o755 });
      created++;
    }
  }

  if (created > 0) {
    console.log(`Created plugins/ (${created} starter plugins)`);
  }
}

function initGitRepo(dir: string): void {
  const memDir = path.join(dir, 'memory');
  fs.mkdirSync(memDir, { recursive: true });

  // Only init if not already in a git repo
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir, timeout: 5000, stdio: 'pipe',
    });
  } catch {
    try {
      execFileSync('git', ['init'], { cwd: dir, timeout: 5000, stdio: 'pipe' });
      console.log('Initialized git repo for memory versioning');
    } catch {
      // Git init failed — non-fatal, warn and continue
      console.warn('Warning: could not initialize git repo');
    }
  }
}

// --- start ---

async function cmdStart(): Promise<void> {
  const configPath = resolveConfig();
  const config = loadConfig(configPath);
  const daemon = flag('daemon') || flag('d') || command === 'up';

  if (daemon) {
    return startDaemon(configPath, config);
  }

  // Foreground mode — run directly
  console.log(`Starting ${config.agent.name}...`);

  // Auto-detect CycleRunner for OODA loop
  const agentOptions = autoDetectRunner(config);
  const agent = await createAgent(configPath, agentOptions);
  await agent.start();

  // Start HTTP API server
  const port = config.agent.port ?? 3001;
  const apiKey = process.env.ASURADA_API_KEY;
  const server = await startServer(agent, { port, apiKey });

  console.log(`Agent "${config.agent.name}" running on port ${server.port}`);
  console.log('Press Ctrl+C to stop');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nStopping...');
    await server.close();
    await agent.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function startDaemon(
  configPath: string,
  config: import('./config/types.js').AgentConfig,
): Promise<void> {
  const dataDir = getDataDir(config);
  const pm = createProcessManager(dataDir);
  const instanceId = slugify(config.agent.name);

  if (pm.isRunning(instanceId)) {
    console.log(`Agent "${config.agent.name}" is already running`);
    return;
  }

  console.log(`Starting ${config.agent.name} (${pm.backend})...`);

  // The daemon runs this CLI in foreground mode (no -d flag)
  // via ASURADA_CONFIG env var to locate the config file
  const cliEntry = fileURLToPath(import.meta.url);
  const resolvedConfig = path.resolve(configPath);

  const info = await pm.start({
    instanceId,
    entryScript: cliEntry,
    args: ['start'],
    port: config.agent.port ?? 3001,
    workDir: path.dirname(resolvedConfig),
    logsDir: path.join(dataDir, instanceId, 'logs'),
    env: {
      ASURADA_CONFIG: resolvedConfig,
    },
  });

  if (info.running) {
    console.log(`Agent "${config.agent.name}" started (pid: ${info.pid}, backend: ${info.backend})`);
  } else {
    console.error('Failed to start agent');
    process.exit(1);
  }
}

// --- stop ---

async function cmdStop(): Promise<void> {
  const configPath = resolveConfig();
  const config = loadConfig(configPath);
  const dataDir = getDataDir(config);
  const pm = createProcessManager(dataDir);
  const instanceId = slugify(config.agent.name);

  if (!pm.isRunning(instanceId)) {
    console.log(`Agent "${config.agent.name}" is not running`);
    return;
  }

  console.log(`Stopping ${config.agent.name}...`);
  const stopped = await pm.stop(instanceId);

  if (stopped) {
    console.log('Stopped');
  } else {
    console.error('Failed to stop agent');
    process.exit(1);
  }
}

// --- status ---

async function cmdStatus(): Promise<void> {
  const configFile = findConfigFile();
  if (!configFile) {
    console.log('No asurada config found in current directory');
    console.log('Run `asurada init` to create one');
    return;
  }

  const config = loadConfig(configFile);
  const dataDir = getDataDir(config);
  const pm = createProcessManager(dataDir);
  const instanceId = slugify(config.agent.name);
  const info = pm.status(instanceId);

  console.log(`Agent: ${config.agent.name}`);
  console.log(`Instance: ${instanceId}`);
  console.log(`Backend: ${pm.backend}`);

  if (info?.running) {
    console.log(`Status: running (pid: ${info.pid})`);
    // Try HTTP health check
    const port = config.agent.port ?? 3001;
    try {
      const res = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        console.log(`Health: ok (uptime: ${data.uptime ?? 'unknown'})`);
      } else {
        console.log(`Health: HTTP ${res.status}`);
      }
    } catch {
      console.log('Health: unreachable');
    }
  } else {
    console.log('Status: stopped');
  }
}

// --- logs ---

async function cmdLogs(): Promise<void> {
  const configFile = findConfigFile();
  if (!configFile) {
    console.error('No asurada config found');
    process.exit(1);
  }

  const config = loadConfig(configFile);
  const dataDir = getDataDir(config);
  const instanceId = slugify(config.agent.name);
  const logsDir = path.join(dataDir, instanceId, 'logs');

  if (!fs.existsSync(logsDir)) {
    console.log('No logs found');
    return;
  }

  // Find most recent log file
  const files = fs.readdirSync(logsDir)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.log('No log files found');
    return;
  }

  const latest = path.join(logsDir, files[0]);
  const follow = flag('follow') || flag('f');

  if (follow) {
    // Tail -f equivalent
    const { spawn } = await import('node:child_process');
    const tail = spawn('tail', ['-f', latest], { stdio: 'inherit' });
    process.on('SIGINT', () => { tail.kill(); process.exit(0); });
  } else {
    // Show last 50 lines
    const content = fs.readFileSync(latest, 'utf-8');
    const lines = content.trim().split('\n').slice(-50);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as { ts?: string; tag?: string; msg?: string };
        const ts = entry.ts ? new Date(entry.ts).toLocaleTimeString() : '';
        console.log(`${ts} [${entry.tag ?? '?'}] ${entry.msg ?? line}`);
      } catch {
        console.log(line);
      }
    }
  }
}

// --- help ---

function cmdHelp(): void {
  const pkg = readPkg();
  console.log(`
asurada v${pkg.version ?? '0.0.0'} — Perception-driven personal AI agent framework

Usage: asurada <command> [options]

Commands:
  init                Create starter config in current directory
  start               Start agent (foreground)
  start -d / up       Start agent (daemon)
  stop / down         Stop daemon
  status              Show agent status
  logs [-f]           Show recent logs

Init options:
  --name <name>       Agent name (default: "My Assistant")
  --port <port>       HTTP port (default: 3001)

https://github.com/miles990/asurada
`.trim());
}

// --- version ---

function cmdVersion(): void {
  const pkg = readPkg();
  console.log(pkg.version ?? '0.0.0');
}

// === Runner Auto-Detection ===

function autoDetectRunner(config: AgentConfig): CreateAgentOptions | undefined {
  if (config.loop?.enabled === false) return undefined;

  const model = config.loop?.model ?? 'sonnet';
  const runnerHint = config.loop?.runner;

  // Explicit runner in config
  if (runnerHint === 'anthropic-api') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('Error: loop.runner is "anthropic-api" but ANTHROPIC_API_KEY is not set');
      process.exit(1);
    }
    console.log(`Runner: Anthropic API (model: ${model})`);
    return { loop: { runner: new AnthropicApiRunner({ apiKey, model }) } };
  }

  if (runnerHint === 'claude-cli') {
    console.log(`Runner: Claude CLI (model: ${model})`);
    return { loop: { runner: new ClaudeCliRunner({ model }) } };
  }

  // Auto-detect: API key first (more reliable), then CLI
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    console.log(`Runner: Anthropic API [auto-detected] (model: ${model})`);
    return { loop: { runner: new AnthropicApiRunner({ apiKey, model }) } };
  }

  if (hasClaude()) {
    console.log(`Runner: Claude CLI [auto-detected] (model: ${model})`);
    return { loop: { runner: new ClaudeCliRunner({ model }) } };
  }

  // No runner available
  console.warn('Warning: No LLM runner available. OODA loop disabled.');
  console.warn('  Set ANTHROPIC_API_KEY or install Claude Code CLI.');
  return undefined;
}

function hasClaude(): boolean {
  try {
    execFileSync('claude', ['--version'], { timeout: 5000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// === Helpers ===

function resolveConfig(): string {
  // Check env var first (used by daemon mode)
  const fromEnv = process.env.ASURADA_CONFIG;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const specific = option('config') ?? option('c');
  const configFile = findConfigFile(undefined, specific);
  if (!configFile) {
    console.error('No asurada config found. Run `asurada init` to create one.');
    process.exit(1);
  }
  return configFile;
}

function getDataDir(config: import('./config/types.js').AgentConfig): string {
  if (config.paths?.data) return path.resolve(config.paths.data);
  return getDefaultDataDir();
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'agent';
}

function readPkg(): Record<string, unknown> {
  try {
    const pkgPath = new URL('../package.json', import.meta.url);
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    return {};
  }
}

// === Run ===

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
