/**
 * Environment detection for Setup Wizard (Phase A).
 *
 * Detects OS, runtime, tools, and available LLM runners.
 * Returns a structured report that the interactive wizard
 * uses to guide the user through setup.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

// === Types ===

export interface DetectionResult {
  os: OsInfo;
  node: RuntimeInfo;
  git: ToolInfo;
  chrome: ChromeInfo;
  llm: LlmInfo;
  obsidian: ToolInfo;
}

export interface OsInfo {
  platform: NodeJS.Platform;
  arch: string;
  version: string;
  label: string; // e.g. "macOS 15.2 (ARM64)"
}

export interface RuntimeInfo {
  available: boolean;
  version: string;
}

export interface ToolInfo {
  available: boolean;
  version?: string;
  path?: string;
}

export interface ChromeInfo {
  available: boolean;
  path?: string;
  cdpAvailable: boolean;
  cdpPort?: number;
}

export interface LlmInfo {
  anthropicApi: boolean;
  claudeCli: ToolInfo;
  /** Other detected options (ollama, etc.) */
  others: Array<{ name: string; available: boolean }>;
}

// === Detection ===

export function detectEnvironment(): DetectionResult {
  return {
    os: detectOs(),
    node: detectNode(),
    git: detectGit(),
    chrome: detectChrome(),
    llm: detectLlm(),
    obsidian: detectObsidian(),
  };
}

function detectOs(): OsInfo {
  const platform = os.platform();
  const arch = os.arch();
  const release = os.release();

  let label: string;
  if (platform === 'darwin') {
    const version = tryExec('sw_vers', ['-productVersion'])?.trim() ?? release;
    const archLabel = arch === 'arm64' ? 'Apple Silicon' : 'Intel';
    label = `macOS ${version} (${archLabel})`;
  } else if (platform === 'linux') {
    const distro = tryReadFile('/etc/os-release')
      ?.match(/PRETTY_NAME="?([^"\n]+)"?/)?.[1] ?? 'Linux';
    label = `${distro} (${arch})`;
  } else if (platform === 'win32') {
    label = `Windows (${arch})`;
  } else {
    label = `${platform} (${arch})`;
  }

  return { platform, arch, version: release, label };
}

function detectNode(): RuntimeInfo {
  return {
    available: true, // we're running in Node
    version: process.version,
  };
}

function detectGit(): ToolInfo {
  const version = tryExec('git', ['--version']);
  if (!version) return { available: false };

  const match = version.match(/git version ([\d.]+)/);
  return {
    available: true,
    version: match?.[1] ?? version.trim(),
  };
}

function detectChrome(): ChromeInfo {
  const paths = chromeCandidates();

  for (const p of paths) {
    if (fs.existsSync(p)) {
      // Check if CDP port is reachable
      const cdpPort = 9222;
      const cdpAvailable = isCdpAvailable(cdpPort);
      return { available: true, path: p, cdpAvailable, cdpPort: cdpAvailable ? cdpPort : undefined };
    }
  }

  return { available: false, cdpAvailable: false };
}

function chromeCandidates(): string[] {
  switch (os.platform()) {
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      ];
    case 'linux':
      return [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
      ];
    case 'win32':
      return [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ];
    default:
      return [];
  }
}

function isCdpAvailable(port: number): boolean {
  try {
    // Quick HTTP check — synchronous via execFileSync curl
    const result = tryExec('curl', ['-sf', '--connect-timeout', '1', `http://localhost:${port}/json/version`]);
    return result !== null;
  } catch {
    return false;
  }
}

function detectLlm(): LlmInfo {
  const anthropicApi = !!process.env.ANTHROPIC_API_KEY;

  let claudeCli: ToolInfo = { available: false };
  const claudeVersion = tryExec('claude', ['--version']);
  if (claudeVersion) {
    claudeCli = { available: true, version: claudeVersion.trim() };
  }

  const others: Array<{ name: string; available: boolean }> = [];

  // Ollama
  const ollamaVersion = tryExec('ollama', ['--version']);
  others.push({ name: 'ollama', available: ollamaVersion !== null });

  return { anthropicApi, claudeCli, others };
}

function detectObsidian(): ToolInfo {
  switch (os.platform()) {
    case 'darwin':
      if (fs.existsSync('/Applications/Obsidian.app')) {
        return { available: true, path: '/Applications/Obsidian.app' };
      }
      break;
    case 'linux':
      if (tryExec('which', ['obsidian']) !== null) {
        return { available: true };
      }
      break;
  }
  return { available: false };
}

// === Formatting ===

export function formatDetection(result: DetectionResult): string {
  const lines: string[] = [];
  const ok = '\u2713'; // ✓
  const no = '\u2717'; // ✗

  lines.push('Environment Detection:');
  lines.push(`  ${ok} ${result.os.label}`);
  lines.push(`  ${ok} Node.js ${result.node.version}`);

  if (result.git.available) {
    lines.push(`  ${ok} Git ${result.git.version}`);
  } else {
    lines.push(`  ${no} Git not found — required for memory versioning`);
  }

  if (result.chrome.available) {
    lines.push(`  ${ok} Chrome detected`);
    if (result.chrome.cdpAvailable) {
      lines.push(`  ${ok} CDP available on port ${result.chrome.cdpPort}`);
    } else {
      lines.push(`  - CDP not active — can be enabled later`);
    }
  } else {
    lines.push(`  - Chrome not found — web perception will be limited`);
  }

  if (result.llm.anthropicApi) {
    lines.push(`  ${ok} Anthropic API key set`);
  }
  if (result.llm.claudeCli.available) {
    lines.push(`  ${ok} Claude CLI ${result.llm.claudeCli.version ?? ''}`);
  }
  if (!result.llm.anthropicApi && !result.llm.claudeCli.available) {
    lines.push(`  ${no} No LLM runner — set ANTHROPIC_API_KEY or install Claude CLI`);
  }

  for (const other of result.llm.others) {
    if (other.available) {
      lines.push(`  ${ok} ${other.name} available`);
    }
  }

  if (result.obsidian.available) {
    lines.push(`  ${ok} Obsidian installed`);
  }

  return lines.join('\n');
}

// === Helpers ===

function tryExec(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { timeout: 5000, stdio: 'pipe', encoding: 'utf-8' });
  } catch {
    return null;
  }
}

function tryReadFile(path: string): string | null {
  try {
    return fs.readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}
