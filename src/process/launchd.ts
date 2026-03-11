/**
 * LaunchdManager — macOS process manager via launchd.
 *
 * Generates a launchd plist, loads/unloads via launchctl.
 * Provides KeepAlive (auto-restart on crash) by default.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type {
  ProcessManager,
  ProcessStartOptions,
  ProcessInfo,
  ProcessBackend,
} from './types.js';

export class LaunchdManager implements ProcessManager {
  readonly backend: ProcessBackend = 'launchd';

  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async start(opts: ProcessStartOptions): Promise<ProcessInfo> {
    if (this.isRunning(opts.instanceId)) {
      return this.status(opts.instanceId)!;
    }

    const logsDir = opts.logsDir ?? path.join(this.dataDir, opts.instanceId, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    // Unload stale plist if exists
    const plistPath = this.plistPath(opts.instanceId);
    const { loaded } = this.getLaunchdStatus(opts.instanceId);
    if (loaded) {
      try { execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' }); } catch { /* ok */ }
    }

    // Generate and install plist
    const plistContent = this.generatePlist(opts);
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, plistContent);
    execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe' });

    // Health check (max 10s)
    const healthUrl = `http://localhost:${opts.port}/health`;
    const deadline = Date.now() + 10_000;

    while (Date.now() < deadline) {
      try {
        const resp = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
        if (resp.ok) {
          const { pid } = this.getLaunchdStatus(opts.instanceId);
          return { instanceId: opts.instanceId, pid, running: true, port: opts.port, backend: 'launchd' };
        }
      } catch { /* not ready yet */ }
      await sleep(200);
    }

    // Health check failed — unload and clean up
    try { execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' }); } catch { /* ok */ }
    try { fs.unlinkSync(plistPath); } catch { /* ok */ }

    const logFile = path.join(logsDir, 'server.log');
    const tail = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, 'utf-8').slice(-500)
      : '';
    throw new Error(`Health check timed out on :${opts.port}${tail ? `\n${tail}` : ''}`);
  }

  async stop(instanceId: string): Promise<boolean> {
    const plistPath = this.plistPath(instanceId);
    const { loaded } = this.getLaunchdStatus(instanceId);

    if (loaded) {
      try { execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' }); } catch { /* ok */ }
    }

    // Clean up plist file
    try { fs.unlinkSync(plistPath); } catch { /* ok */ }
    return true;
  }

  isRunning(instanceId: string): boolean {
    const { loaded, pid } = this.getLaunchdStatus(instanceId);
    return loaded && pid !== undefined;
  }

  status(instanceId: string): ProcessInfo | null {
    const { loaded, pid } = this.getLaunchdStatus(instanceId);
    if (!loaded) return null;

    return {
      instanceId,
      pid,
      running: pid !== undefined,
      backend: 'launchd',
    };
  }

  async restart(opts: ProcessStartOptions): Promise<ProcessInfo> {
    await this.stop(opts.instanceId);
    return this.start(opts);
  }

  async stopAll(): Promise<void> {
    try {
      const output = execSync('launchctl list', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const labels = output
        .split('\n')
        .map(line => line.trim().split(/\t/).pop() ?? '')
        .filter(label => label.startsWith('com.asurada.'));

      for (const label of labels) {
        const instanceId = label.replace('com.asurada.', '');
        await this.stop(instanceId);
      }
    } catch { /* ok */ }
  }

  // --- launchd helpers ---

  private label(instanceId: string): string {
    return `com.asurada.${instanceId}`;
  }

  private plistPath(instanceId: string): string {
    const home = process.env.HOME ?? '';
    return path.join(home, 'Library', 'LaunchAgents', `${this.label(instanceId)}.plist`);
  }

  private getLaunchdStatus(instanceId: string): { loaded: boolean; pid?: number } {
    try {
      const output = execSync(`launchctl list "${this.label(instanceId)}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const pidMatch = output.match(/"PID"\s*=\s*(\d+)/) ?? output.match(/^(\d+)\t/m);
      if (pidMatch) {
        return { loaded: true, pid: parseInt(pidMatch[1]) };
      }
      return { loaded: true };
    } catch {
      return { loaded: false };
    }
  }

  private generatePlist(opts: ProcessStartOptions): string {
    const label = this.label(opts.instanceId);
    const nodePath = process.execPath;
    const logFile = path.join(
      opts.logsDir ?? path.join(this.dataDir, opts.instanceId, 'logs'),
      'server.log',
    );
    const workDir = opts.workDir ?? process.cwd();
    const home = process.env.HOME ?? '';
    const envPath = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin';
    const keepAlive = opts.keepAlive !== false; // default true for launchd

    // Build environment dict entries
    const envEntries = [
      ['ASURADA_INSTANCE', opts.instanceId],
      ['PORT', String(opts.port)],
      ['NODE_ENV', 'production'],
      ['PATH', envPath],
      ['HOME', home],
      ...Object.entries(opts.env ?? {}),
    ]
      .map(([k, v]) => `        <key>${escapeXml(k)}</key>\n        <string>${escapeXml(v)}</string>`)
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(label)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(nodePath)}</string>
        <string>${escapeXml(opts.entryScript)}</string>${
      (opts.args ?? []).map(a => `\n        <string>${escapeXml(a)}</string>`).join('')
    }
    </array>
    <key>WorkingDirectory</key>
    <string>${escapeXml(workDir)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${envEntries}
    </dict>
    <key>StandardOutPath</key>
    <string>${escapeXml(logFile)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(logFile)}</string>
    <key>KeepAlive</key>
    <${keepAlive}/>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>`;
  }
}

// --- Helpers ---

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
