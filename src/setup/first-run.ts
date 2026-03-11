/**
 * Phase E: First-Run Greeting
 *
 * When the agent starts for the first time, show a personalized
 * greeting that includes what the agent can see and where the
 * user can interact with it.
 *
 * Detection: checks for a `.first-run-done` marker in the data dir.
 * After greeting, writes the marker so it only shows once.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// === Types ===

export interface FirstRunInfo {
  /** Agent's configured name */
  name: string;
  /** OS summary line */
  os: string;
  /** Total / free memory in human-readable form */
  memory: string;
  /** Free disk space (approximate) */
  disk: string;
  /** Whether network is reachable */
  networkOk: boolean;
  /** Number of perception plugins configured */
  pluginCount: number;
  /** HTTP port the agent is running on */
  port: number;
}

// === Detection ===

/**
 * Check if this is the agent's first-ever start.
 * Uses a marker file in the data directory.
 */
export function isFirstRun(dataDir: string): boolean {
  return !fs.existsSync(path.join(dataDir, '.first-run-done'));
}

/**
 * Mark first run as complete — future starts skip the greeting.
 */
export function markFirstRunDone(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, '.first-run-done'),
    new Date().toISOString() + '\n',
    'utf-8',
  );
}

// === Greeting ===

/**
 * Build the first-run greeting text.
 *
 * Example output:
 * ┌─────────────────────────────────────────────────┐
 * │  Hello! I'm Atlas.                              │
 * │  This is my first time waking up.               │
 * │                                                 │
 * │  Here's what I can see:                         │
 * │    ✓ macOS 15.2 (Apple Silicon)                 │
 * │    ✓ 16 GB memory, 85 GB free disk              │
 * │    ✓ Network connected                          │
 * │    ✓ 2 perception plugins active                │
 * │                                                 │
 * │  Talk to me:                                    │
 * │    Dashboard  → http://localhost:3001            │
 * │    Chat       → http://localhost:3001/chat       │
 * │                                                 │
 * │  I'll learn your preferences as we interact.    │
 * │  No need to configure anything else — just talk. │
 * └─────────────────────────────────────────────────┘
 */
export function formatFirstRunGreeting(info: FirstRunInfo): string {
  const ok = '\u2713'; // ✓
  const no = '\u2717'; // ✗

  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(`  Hello! I'm ${info.name}.`);
  lines.push('  This is my first time waking up.');
  lines.push('');

  // What I can see
  lines.push("  Here's what I can see:");
  lines.push(`    ${ok} ${info.os}`);
  lines.push(`    ${ok} ${info.memory}, ${info.disk} free disk`);
  lines.push(`    ${info.networkOk ? ok : no} Network ${info.networkOk ? 'connected' : 'unreachable'}`);
  if (info.pluginCount > 0) {
    lines.push(`    ${ok} ${info.pluginCount} perception plugin${info.pluginCount > 1 ? 's' : ''} active`);
  }
  lines.push('');

  // Where to interact
  lines.push('  Talk to me:');
  lines.push(`    Dashboard  \u2192 http://localhost:${info.port}`);
  lines.push(`    Chat       \u2192 http://localhost:${info.port}/chat`);
  lines.push('');

  // Closing
  lines.push("  I'll learn your preferences as we interact.");
  lines.push('  No need to configure anything else \u2014 just start talking.');
  lines.push('');

  // Box drawing
  const contentWidth = Math.max(...lines.map(l => l.length)) + 2;
  const top = '\u250C' + '\u2500'.repeat(contentWidth) + '\u2510';
  const bottom = '\u2514' + '\u2500'.repeat(contentWidth) + '\u2518';

  const boxed = [top];
  for (const line of lines) {
    boxed.push('\u2502' + line.padEnd(contentWidth) + '\u2502');
  }
  boxed.push(bottom);

  return boxed.join('\n');
}

// === Info Gathering ===

/**
 * Gather system info for the first-run greeting.
 * All operations are synchronous and fast (<100ms).
 */
export function gatherFirstRunInfo(opts: {
  name: string;
  port: number;
  pluginCount: number;
}): FirstRunInfo {
  return {
    name: opts.name,
    os: detectOsLabel(),
    memory: formatMemory(),
    disk: formatDisk(),
    networkOk: checkNetwork(),
    pluginCount: opts.pluginCount,
    port: opts.port,
  };
}

// === Internal Helpers ===

function detectOsLabel(): string {
  const platform = os.platform();
  const arch = os.arch();

  if (platform === 'darwin') {
    try {
      const version = execFileSync('sw_vers', ['-productVersion'], {
        timeout: 3000, stdio: 'pipe', encoding: 'utf-8',
      }).trim();
      const archLabel = arch === 'arm64' ? 'Apple Silicon' : 'Intel';
      return `macOS ${version} (${archLabel})`;
    } catch {
      return `macOS (${arch})`;
    }
  }

  if (platform === 'linux') {
    try {
      const content = fs.readFileSync('/etc/os-release', 'utf-8');
      const name = content.match(/PRETTY_NAME="?([^"\n]+)"?/)?.[1];
      if (name) return `${name} (${arch})`;
    } catch { /* ignore */ }
    return `Linux (${arch})`;
  }

  return `${platform} (${arch})`;
}

function formatMemory(): string {
  const totalGB = Math.round(os.totalmem() / (1024 ** 3));
  return `${totalGB} GB memory`;
}

function formatDisk(): string {
  try {
    const output = execFileSync('df', ['-h', os.homedir()], {
      timeout: 3000, stdio: 'pipe', encoding: 'utf-8',
    });
    // Parse df output: second line, 4th column is available
    const lines = output.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      if (parts.length >= 4) {
        return `${parts[3]}B`;
      }
    }
  } catch { /* ignore */ }
  return 'unknown';
}

function checkNetwork(): boolean {
  try {
    execFileSync('curl', ['-sf', '--connect-timeout', '2', '-o', '/dev/null', 'https://httpbin.org/status/200'], {
      timeout: 5000, stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}
