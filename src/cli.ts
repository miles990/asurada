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
import { createAgent, createAgentFromConfig, type CreateAgentOptions } from './runtime.js';
import { startServer } from './api/server.js';
import { createProcessManager } from './process/factory.js';
import { ClaudeCliRunner } from './loop/runners/claude-cli.js';
import { AnthropicApiRunner } from './loop/runners/anthropic-api.js';
import { OpenAiCompatibleRunner } from './loop/runners/openai-compatible.js';
import { ModelRouter } from './loop/model-router.js';
import type { CycleRunner } from './loop/types.js';
import type { RunnerRef } from './config/types.js';
import { slog } from './logging/index.js';
import { detectEnvironment, formatDetection, runWizard, scaffoldMemorySpace, isFirstRun, markFirstRunDone, gatherFirstRunInfo, formatFirstRunGreeting } from './setup/index.js';

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
  let persona: string | undefined;
  let traits: string | undefined;
  let language: 'en' | 'zh-TW' | 'ja' | undefined;
  let runner: string | undefined;
  let perceptions: Array<'workspace' | 'browser-tabs' | 'git-activity'> | undefined;
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

    persona = wizard.persona;
    traits = wizard.traits;
    language = wizard.language;
    perceptions = wizard.perceptions;
  }

  // Create config with wizard results
  const filePath = writeConfig(dir, {
    name,
    persona,
    language,
    port,
    runner,
    notifications,
    perceptions,
  });
  console.log(`Created ${path.relative(dir, filePath)}`);

  // Create starter plugins so perception works out of the box
  scaffoldPlugins(dir);

  // Phase D: Memory space scaffold
  initGitRepo(dir);
  const agentSlug = slugify(name);
  const scaffold = await scaffoldMemorySpace(dir, { name, persona, traits, language: language ?? 'en' }, {
    obsidian: env.obsidian.available,
    agentSlug,
  });
  if (scaffold.created.length > 0) {
    console.log(`Memory space initialized (${scaffold.created.length} items)`);
  }

  console.log();
  console.log('Next steps:');
  console.log('  1. asurada start');
  if (scaffold.obsidianInit) {
    console.log('  2. Open Obsidian → open vault at ./memory/ to browse agent memory');
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
    'chrome-cdp.sh': `#!/bin/bash
# Chrome CDP perception plugin — reports active browser tab information.

CDP_URL="http://localhost:9222/json"

if ! command -v curl &>/dev/null; then
  echo "curl not found"
  exit 0
fi

if ! command -v jq &>/dev/null; then
  echo "jq not found (install jq for browser tab perception)"
  exit 0
fi

if ! curl -sf --connect-timeout 1 "$CDP_URL/version" >/dev/null; then
  echo "Chrome CDP not available on :9222"
  exit 0
fi

tabs=$(curl -sf --connect-timeout 1 "$CDP_URL" | jq '[.[] | select(.type=="page")]')
count=$(echo "$tabs" | jq 'length')
echo "Open tabs: $count"

if [ "$count" -gt 0 ]; then
  title=$(echo "$tabs" | jq -r '.[0].title // "unknown"')
  url=$(echo "$tabs" | jq -r '.[0].url // "unknown"')
  echo "Active: $title"
  echo "URL: $url"
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

  // Apply CLI overrides (CLI flags > config file > defaults)
  const portOverride = option('port');
  if (portOverride) {
    const parsed = parseInt(portOverride, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
      console.error(`Invalid port: "${portOverride}"`);
      process.exit(1);
    }
    config.agent.port = parsed;
  }

  const agentOverride = option('agent');
  if (agentOverride) {
    if (config.agents && !(agentOverride in config.agents)) {
      console.error(`Unknown agent "${agentOverride}". Available: ${Object.keys(config.agents).join(', ')}`);
      process.exit(1);
    }
    config.activeAgent = agentOverride;
    // Also update runtime name if this agent has a persona in agents config
    if (config.agents?.[agentOverride]?.persona) {
      config.agent.persona = config.agents[agentOverride].persona;
    }
  }

  const daemon = flag('daemon') || flag('d') || command === 'up';

  if (daemon) {
    return startDaemon(configPath, config);
  }

  // Foreground mode — run directly
  const agentName = config.agent.name;
  const dataDir = getDataDir(config);
  const instanceDataDir = path.join(dataDir, slugify(agentName));
  const firstTime = isFirstRun(instanceDataDir);

  if (firstTime) {
    console.log(`\n  Starting ${agentName} for the first time...\n`);
  } else {
    console.log(`Starting ${agentName}...`);
  }

  // Auto-detect CycleRunner for OODA loop
  const agentOptions = autoDetectRunner(config);
  const configDir = path.dirname(path.resolve(configPath));
  const agent = await createAgentFromConfig(config, { ...agentOptions, baseDir: configDir });
  await agent.start();

  // Start HTTP API server
  const port = config.agent.port ?? 3001;
  const apiKey = config.agent.apiKey;
  const server = await startServer(agent, { port, apiKey });

  if (firstTime) {
    // Phase E: First-run greeting — agent introduces itself
    const pluginCount = config.perception?.plugins?.filter(p => p.enabled !== false).length ?? 0;
    const info = gatherFirstRunInfo({ name: agentName, port: server.port, pluginCount, language: config.agent.language });
    console.log(formatFirstRunGreeting(info));
    markFirstRunDone(instanceDataDir);
  } else {
    console.log(`Agent "${agentName}" running on port ${server.port}`);
  }
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
  // Forward CLI overrides so the subprocess applies them too
  const cliEntry = fileURLToPath(import.meta.url);
  const resolvedConfig = path.resolve(configPath);
  const daemonArgs = ['start', '--config', resolvedConfig];
  const portFlag = option('port');
  if (portFlag) daemonArgs.push('--port', portFlag);
  const agentFlag = option('agent');
  if (agentFlag) daemonArgs.push('--agent', agentFlag);

  const info = await pm.start({
    instanceId,
    entryScript: cliEntry,
    args: daemonArgs,
    port: config.agent.port ?? 3001,
    workDir: path.dirname(resolvedConfig),
    logsDir: path.join(dataDir, instanceId, 'logs'),
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

Start options:
  --port <port>       HTTP port (overrides config file)
  --agent <name>      Load a specific agent (multi-agent mode)

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
  const anthropicApiKey = config.loop?.anthropicApiKey;
  const escalateRunner = resolveBaseRunner(config.loop?.runner, model, anthropicApiKey);
  if (!escalateRunner) {
    console.warn('Warning: No LLM runner available. OODA loop disabled.');
    console.warn('  Set loop.anthropicApiKey in asurada.yaml or install Claude Code CLI.');
    return undefined;
  }

  // Check if router is enabled
  const routerConfig = config.loop?.router;
  if (routerConfig?.enabled) {
    const triageRunner = routerConfig.triageRunner
      ? resolveRunnerRef(routerConfig.triageRunner, anthropicApiKey)
      : null;
    const reflectRunner = routerConfig.reflectRunner
      ? resolveRunnerRef(routerConfig.reflectRunner, anthropicApiKey)
      : null;

    if (!triageRunner) {
      console.warn('Warning: Router enabled but no triageRunner configured. Using direct runner.');
      return { loop: { runner: escalateRunner } };
    }

    const router = new ModelRouter({
      triageRunner,
      reflectRunner: reflectRunner ?? escalateRunner,
      escalateRunner,
      reflectTasks: routerConfig.reflectTasks,
      halfLifeMinutes: routerConfig.halfLife,
      threadFloor: routerConfig.threadFloor,
      shadowMode: routerConfig.shadowMode,
    });

    console.log(`Runner: ModelRouter (shadow: ${router.shadowMode ? 'on' : 'off'}, halfLife: ${routerConfig.halfLife ?? 30}m)`);
    return { loop: { runner: router } };
  }

  return { loop: { runner: escalateRunner } };
}

/** Resolve a base runner from config hint or auto-detection */
function resolveBaseRunner(runnerHint: string | undefined, model: string, anthropicApiKey?: string): CycleRunner | null {
  if (runnerHint === 'anthropic-api') {
    if (!anthropicApiKey) {
      console.error('Error: loop.runner is "anthropic-api" but loop.anthropicApiKey is not set in config');
      process.exit(1);
    }
    console.log(`Runner: Anthropic API (model: ${model})`);
    return new AnthropicApiRunner({ apiKey: anthropicApiKey, model });
  }

  if (runnerHint === 'claude-cli') {
    console.log(`Runner: Claude CLI (model: ${model})`);
    return new ClaudeCliRunner({ model });
  }

  // Auto-detect
  if (anthropicApiKey) {
    console.log(`Runner: Anthropic API [auto-detected] (model: ${model})`);
    return new AnthropicApiRunner({ apiKey: anthropicApiKey, model });
  }

  if (hasClaude()) {
    console.log(`Runner: Claude CLI [auto-detected] (model: ${model})`);
    return new ClaudeCliRunner({ model });
  }

  return null;
}

/** Resolve a RunnerRef from router config to a concrete CycleRunner */
function resolveRunnerRef(ref: RunnerRef, fallbackApiKey?: string): CycleRunner | null {
  switch (ref.type) {
    case 'anthropic-api': {
      const apiKey = ref.apiKey ?? fallbackApiKey;
      if (!apiKey) return null;
      return new AnthropicApiRunner({ apiKey, model: ref.model ?? 'haiku' });
    }
    case 'claude-cli':
      return new ClaudeCliRunner({ model: ref.model ?? 'haiku' });
    case 'openai-compatible': {
      if (!ref.baseUrl || !ref.model) return null;
      return new OpenAiCompatibleRunner({
        baseUrl: ref.baseUrl,
        model: ref.model,
        apiKey: ref.apiKey,
      });
    }
    default:
      console.warn(`Unknown runner type in router config: "${ref.type}"`);
      return null;
  }
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
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/^-+|-+$/g, '')
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
