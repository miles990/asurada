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
import { fileURLToPath } from 'node:url';
import { findConfigFile, loadConfig, writeConfig } from './config/index.js';
import { createAgent } from './runtime.js';
import { startServer } from './api/server.js';
import { createProcessManager } from './process/factory.js';
import { slog } from './logging/index.js';

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

function cmdInit(): void {
  const dir = process.cwd();
  const existing = findConfigFile(dir);
  if (existing) {
    console.error(`Config already exists: ${existing}`);
    process.exit(1);
  }

  const name = option('name') ?? 'My Assistant';
  const port = option('port') ? parseInt(option('port')!, 10) : undefined;

  const filePath = writeConfig(dir, { name, port });
  console.log(`Created ${path.relative(dir, filePath)}`);
  console.log();
  console.log('Next steps:');
  console.log('  1. Edit asurada.yaml to customize your agent');
  console.log('  2. asurada start');
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

  const agent = await createAgent(configPath);
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

  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return path.join(xdg, 'asurada');

  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'asurada');
  }
  return path.join(home, '.local', 'share', 'asurada');
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
