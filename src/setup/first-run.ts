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
  /** User-selected language */
  language?: string;
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
  const t = getGreetingStrings(info.language);

  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(`  ${t.hello(info.name)}`);
  lines.push(`  ${t.firstWakeUp}`);
  lines.push('');

  // What I can see
  lines.push(`  ${t.whatISee}`);
  lines.push(`    ${ok} ${info.os}`);
  lines.push(`    ${ok} ${info.memory}, ${info.disk} ${t.freeDisk}`);
  lines.push(`    ${info.networkOk ? ok : no} ${t.network} ${info.networkOk ? t.connected : t.unreachable}`);
  if (info.pluginCount > 0) {
    lines.push(`    ${ok} ${t.plugins(info.pluginCount)}`);
  }
  lines.push('');

  // Where to interact
  lines.push(`  ${t.talkToMe}`);
  lines.push(`    Dashboard  \u2192 http://localhost:${info.port}`);
  lines.push(`    Chat       \u2192 http://localhost:${info.port}/chat`);
  lines.push('');

  // Closing
  lines.push(`  ${t.learnPrefs}`);
  lines.push(`  ${t.justTalk}`);
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
  language?: string;
}): FirstRunInfo {
  return {
    name: opts.name,
    os: detectOsLabel(),
    memory: formatMemory(),
    disk: formatDisk(),
    networkOk: checkNetwork(),
    pluginCount: opts.pluginCount,
    port: opts.port,
    language: opts.language,
  };
}

// === Greeting i18n ===

interface GreetingStrings {
  hello: (name: string) => string;
  firstWakeUp: string;
  whatISee: string;
  freeDisk: string;
  network: string;
  connected: string;
  unreachable: string;
  plugins: (n: number) => string;
  talkToMe: string;
  learnPrefs: string;
  justTalk: string;
}

const GREETING_STRINGS: Record<string, GreetingStrings> = {
  en: {
    hello: (name) => `Hello! I'm ${name}.`,
    firstWakeUp: 'This is my first time waking up.',
    whatISee: "Here's what I can see:",
    freeDisk: 'free disk',
    network: 'Network',
    connected: 'connected',
    unreachable: 'unreachable',
    plugins: (n) => `${n} perception plugin${n > 1 ? 's' : ''} active`,
    talkToMe: 'Talk to me:',
    learnPrefs: "I'll learn your preferences as we interact.",
    justTalk: 'No need to configure anything else \u2014 just start talking.',
  },
  'zh-TW': {
    hello: (name) => `\u4f60\u597d\uff01\u6211\u662f ${name}\u3002`,
    firstWakeUp: '\u9019\u662f\u6211\u7b2c\u4e00\u6b21\u919c\u4f86\u3002',
    whatISee: '\u6211\u770b\u5230\u7684\u74b0\u5883\uff1a',
    freeDisk: '\u53ef\u7528\u78c1\u789f',
    network: '\u7db2\u8def',
    connected: '\u5df2\u9023\u63a5',
    unreachable: '\u7121\u6cd5\u9023\u63a5',
    plugins: (n) => `${n} \u500b\u611f\u77e5\u63d2\u4ef6\u5df2\u555f\u7528`,
    talkToMe: '\u8ddf\u6211\u804a\u5929\uff1a',
    learnPrefs: '\u6211\u6703\u5728\u4e92\u52d5\u4e2d\u5b78\u7fd2\u4f60\u7684\u504f\u597d\u3002',
    justTalk: '\u4e0d\u9700\u8981\u5176\u4ed6\u8a2d\u5b9a \u2014 \u76f4\u63a5\u958b\u59cb\u5c31\u597d\u3002',
  },
  ja: {
    hello: (name) => `\u3053\u3093\u306b\u3061\u306f\uff01${name}\u3067\u3059\u3002`,
    firstWakeUp: '\u521d\u3081\u3066\u306e\u8d77\u52d5\u3067\u3059\u3002',
    whatISee: '\u74b0\u5883\u60c5\u5831\uff1a',
    freeDisk: '\u7a7a\u304d\u30c7\u30a3\u30b9\u30af',
    network: '\u30cd\u30c3\u30c8\u30ef\u30fc\u30af',
    connected: '\u63a5\u7d9a\u6e08\u307f',
    unreachable: '\u63a5\u7d9a\u4e0d\u53ef',
    plugins: (n) => `${n} \u500b\u306e\u77e5\u899a\u30d7\u30e9\u30b0\u30a4\u30f3\u304c\u6709\u52b9`,
    talkToMe: '\u8a71\u3057\u304b\u3051\u3066\u304f\u3060\u3055\u3044\uff1a',
    learnPrefs: '\u4f7f\u3044\u306a\u304c\u3089\u3042\u306a\u305f\u306e\u597d\u307f\u3092\u5b66\u3073\u307e\u3059\u3002',
    justTalk: '\u4ed6\u306e\u8a2d\u5b9a\u306f\u4e0d\u8981\u3067\u3059 \u2014 \u305d\u306e\u307e\u307e\u59cb\u3081\u3066\u304f\u3060\u3055\u3044\u3002',
  },
};

function getGreetingStrings(language?: string): GreetingStrings {
  return GREETING_STRINGS[language ?? 'en'] ?? GREETING_STRINGS.en;
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
