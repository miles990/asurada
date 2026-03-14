/**
 * Asurada Doctor — systematic diagnostic checks.
 *
 * Runs a checklist against the current environment and reports
 * pass/warn/fail for each component.
 *
 * Usage: asurada doctor
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findConfigFile, loadConfig } from '../config/index.js';

export interface DiagnosticResult {
  check: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export async function runDiagnostics(dir: string): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  // 1. Node.js version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split('.')[0], 10);
  if (major >= 20) {
    results.push({ check: 'node', status: 'pass', message: `Node.js ${nodeVersion}` });
  } else {
    results.push({ check: 'node', status: 'fail', message: `Node.js ${nodeVersion} — requires >=20.0.0` });
  }

  // 2. Git
  try {
    execFileSync('git', ['--version'], { timeout: 5000, stdio: 'pipe' });
    results.push({ check: 'git', status: 'pass', message: 'Git available' });
  } catch {
    results.push({ check: 'git', status: 'fail', message: 'Git not found — required for memory versioning' });
  }

  // 3. Config file
  const configFile = findConfigFile(dir);
  if (!configFile) {
    results.push({ check: 'config', status: 'fail', message: 'No asurada.yaml found. Run `asurada init`' });
    return results;
  }

  let config;
  try {
    config = loadConfig(configFile);
    results.push({ check: 'config', status: 'pass', message: `Config loaded: ${path.basename(configFile)}` });
  } catch (err) {
    results.push({ check: 'config', status: 'fail', message: `Config parse error: ${err instanceof Error ? err.message : String(err)}` });
    return results;
  }

  // 4. Agent name
  if (config.agent?.name?.trim()) {
    results.push({ check: 'agent-name', status: 'pass', message: `Agent: "${config.agent.name}"` });
  } else {
    results.push({ check: 'agent-name', status: 'fail', message: 'Agent name is empty' });
  }

  // 5. Memory directory
  const memoryDir = config.paths?.memory
    ? path.resolve(dir, config.paths.memory)
    : config.memory?.dir
      ? path.resolve(dir, config.memory.dir)
      : path.join(dir, 'memory');

  if (fs.existsSync(memoryDir)) {
    const soulPath = path.join(memoryDir, 'SOUL.md');
    if (fs.existsSync(soulPath)) {
      results.push({ check: 'memory', status: 'pass', message: 'Memory dir OK, SOUL.md present' });
    } else {
      results.push({ check: 'memory', status: 'warn', message: 'Memory dir exists but SOUL.md missing — run `asurada init`' });
    }
  } else {
    results.push({ check: 'memory', status: 'warn', message: `Memory dir not found: ${memoryDir}` });
  }

  // 6. Perception plugins
  const plugins = config.perception?.plugins ?? [];
  if (plugins.length === 0) {
    results.push({ check: 'plugins', status: 'warn', message: 'No perception plugins configured' });
  } else {
    let missing = 0;
    for (const plugin of plugins) {
      if (plugin.enabled === false) continue;
      if (plugin.command) continue;
      if (plugin.script) {
        const scriptPath = path.resolve(dir, plugin.script);
        if (!fs.existsSync(scriptPath)) {
          missing++;
          results.push({ check: 'plugins', status: 'warn', message: `Plugin "${plugin.name}" script not found: ${plugin.script}` });
        }
      }
    }
    if (missing === 0) {
      const activeCount = plugins.filter(p => p.enabled !== false).length;
      results.push({ check: 'plugins', status: 'pass', message: `${activeCount} plugin(s) configured, all scripts found` });
    }
  }

  // 7. Runner availability
  const runner = config.loop?.runner;
  if (config.loop?.enabled === false) {
    results.push({ check: 'runner', status: 'pass', message: 'OODA loop disabled (no runner needed)' });
  } else if (runner === 'anthropic-api') {
    if (config.loop?.anthropicApiKey) {
      results.push({ check: 'runner', status: 'pass', message: 'Anthropic API key configured' });
    } else {
      results.push({ check: 'runner', status: 'fail', message: 'Runner is anthropic-api but no API key set (loop.anthropicApiKey)' });
    }
  } else if (runner === 'claude-cli' || !runner) {
    try {
      execFileSync('claude', ['--version'], { timeout: 5000, stdio: 'pipe' });
      results.push({ check: 'runner', status: 'pass', message: 'Claude CLI available' });
    } catch {
      if (config.loop?.anthropicApiKey) {
        results.push({ check: 'runner', status: 'pass', message: 'Claude CLI not found, but Anthropic API key available' });
      } else {
        results.push({ check: 'runner', status: 'fail', message: 'No LLM runner available. Install Claude Code or set loop.anthropicApiKey' });
      }
    }
  } else {
    results.push({ check: 'runner', status: 'pass', message: `Runner: ${runner}` });
  }

  // 8. Port availability
  const port = config.agent?.port ?? 3001;
  if (port < 1 || port > 65535) {
    results.push({ check: 'port', status: 'fail', message: `Invalid port: ${port} (must be 1-65535)` });
  } else {
    const portInUse = await isPortInUse(port);
    if (portInUse) {
      results.push({ check: 'port', status: 'warn', message: `Port ${port} is already in use — agent may already be running, or choose a different port` });
    } else {
      results.push({ check: 'port', status: 'pass', message: `HTTP port: ${port} (available)` });
    }
  }

  // 9. Memory file integrity
  if (fs.existsSync(memoryDir)) {
    const memoryFile = path.join(memoryDir, 'MEMORY.md');
    if (fs.existsSync(memoryFile)) {
      const content = fs.readFileSync(memoryFile, 'utf-8');
      if (content.length === 0) {
        results.push({ check: 'memory-integrity', status: 'warn', message: 'MEMORY.md is empty' });
      } else {
        const lines = content.split('\n').filter(Boolean).length;
        results.push({ check: 'memory-integrity', status: 'pass', message: `MEMORY.md: ${lines} lines` });
      }
    }

    // Check topics directory
    const topicsDir = path.join(memoryDir, 'topics');
    if (fs.existsSync(topicsDir)) {
      const topicFiles = fs.readdirSync(topicsDir).filter(f => f.endsWith('.md'));
      results.push({ check: 'topics', status: 'pass', message: `${topicFiles.length} topic file(s)` });
    }
  }

  // 10. Notification providers
  const notifProviders = config.notification?.providers ?? [];
  if (notifProviders.length === 0) {
    results.push({ check: 'notifications', status: 'warn', message: 'No notification providers — agent won\'t be able to message you. Add console or telegram in config.' });
  } else {
    const names = notifProviders.map(p => p.type).join(', ');
    results.push({ check: 'notifications', status: 'pass', message: `Notification providers: ${names}` });
  }

  return results;
}

/** Check if a port is in use by attempting to connect */
async function isPortInUse(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/`, {
      signal: AbortSignal.timeout(1000),
    });
    // If we got any response, port is in use
    return true;
  } catch (err) {
    // ECONNREFUSED = port not in use, timeout/other = might be in use
    const code = (err as NodeJS.ErrnoException).cause
      ? ((err as { cause?: { code?: string } }).cause?.code)
      : (err as NodeJS.ErrnoException).code;
    if (code === 'ECONNREFUSED') return false;
    // For timeout or AbortError, the port might be in use but slow
    if (err instanceof DOMException && err.name === 'AbortError') return false;
    return false;
  }
}

/** Format diagnostic results for terminal output */
export function formatDiagnostics(results: DiagnosticResult[]): string {
  const icons = { pass: '✓', warn: '⚠', fail: '✗' };
  const lines = results.map(r => `  ${icons[r.status]} ${r.check}: ${r.message}`);

  const passCount = results.filter(r => r.status === 'pass').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  const failCount = results.filter(r => r.status === 'fail').length;

  lines.push('');
  lines.push(`  ${passCount} passed, ${warnCount} warnings, ${failCount} failures`);

  if (failCount > 0) {
    lines.push('  Fix the failures above before starting the agent.');
  } else if (warnCount > 0) {
    lines.push('  Warnings are non-fatal but worth addressing.');
  } else {
    lines.push('  All checks passed. Ready to start!');
  }

  return lines.join('\n');
}
