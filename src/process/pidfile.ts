/**
 * PidFileManager — universal fallback process manager.
 *
 * Works on all platforms. Spawns a detached Node.js child process
 * and tracks it with a PID file. No auto-restart on crash.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type {
  ProcessManager,
  ProcessStartOptions,
  ProcessInfo,
  ProcessBackend,
} from './types.js';

export class PidFileManager implements ProcessManager {
  readonly backend: ProcessBackend = 'pidfile';

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

    const logFile = path.join(logsDir, 'server.log');
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ASURADA_INSTANCE: opts.instanceId,
      PORT: String(opts.port),
      NODE_ENV: 'production',
      ...opts.env,
    };

    const child = spawn(process.execPath, [opts.entryScript], {
      cwd: opts.workDir ?? process.cwd(),
      detached: true,
      stdio: ['ignore', out, err],
      env,
    });

    child.unref();
    const pid = child.pid;

    if (!pid) {
      throw new Error(`Failed to start process for instance ${opts.instanceId}`);
    }

    // Write PID file
    this.writePidFile(opts.instanceId, pid, opts.port);

    // Health check (max 10s)
    const healthUrl = `http://localhost:${opts.port}/health`;
    const deadline = Date.now() + 10_000;

    while (Date.now() < deadline) {
      try {
        const resp = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
        if (resp.ok) {
          return { instanceId: opts.instanceId, pid, running: true, port: opts.port, backend: 'pidfile' };
        }
      } catch { /* not ready yet */ }
      await sleep(300);
    }

    // Health check failed — kill and clean up
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
    this.removePidFile(opts.instanceId);

    throw new Error(`Health check timed out for instance ${opts.instanceId} on port ${opts.port}`);
  }

  async stop(instanceId: string): Promise<boolean> {
    const info = this.readPidFile(instanceId);
    if (!info?.pid) {
      this.removePidFile(instanceId);
      return true;
    }

    try {
      process.kill(info.pid, 'SIGTERM');
    } catch {
      // Already dead
    }

    // Wait for process to exit (max 5s)
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (!isProcessAlive(info.pid)) break;
      await sleep(200);
    }

    // Force kill if still alive
    if (isProcessAlive(info.pid)) {
      try { process.kill(info.pid, 'SIGKILL'); } catch { /* ok */ }
    }

    this.removePidFile(instanceId);
    return true;
  }

  isRunning(instanceId: string): boolean {
    const info = this.readPidFile(instanceId);
    if (!info?.pid) return false;

    if (isProcessAlive(info.pid)) return true;

    // Stale PID file — clean up
    this.removePidFile(instanceId);
    return false;
  }

  status(instanceId: string): ProcessInfo | null {
    const info = this.readPidFile(instanceId);
    if (!info) return null;

    const running = info.pid ? isProcessAlive(info.pid) : false;
    if (!running && info.pid) {
      this.removePidFile(instanceId);
    }

    return {
      instanceId,
      pid: info.pid,
      running,
      port: info.port,
      backend: 'pidfile',
    };
  }

  async restart(opts: ProcessStartOptions): Promise<ProcessInfo> {
    await this.stop(opts.instanceId);
    return this.start(opts);
  }

  async stopAll(): Promise<void> {
    const instancesDir = path.join(this.dataDir);
    try {
      const dirs = fs.readdirSync(instancesDir, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const pidPath = path.join(instancesDir, dir.name, 'process.pid');
        if (fs.existsSync(pidPath)) {
          await this.stop(dir.name);
        }
      }
    } catch { /* dir doesn't exist */ }
  }

  // --- PID file helpers ---

  private pidFilePath(instanceId: string): string {
    return path.join(this.dataDir, instanceId, 'process.pid');
  }

  private writePidFile(instanceId: string, pid: number, port: number): void {
    const dir = path.join(this.dataDir, instanceId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      this.pidFilePath(instanceId),
      JSON.stringify({ pid, port, startedAt: new Date().toISOString() }),
    );
  }

  private readPidFile(instanceId: string): { pid: number; port: number } | null {
    try {
      const raw = fs.readFileSync(this.pidFilePath(instanceId), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  private removePidFile(instanceId: string): void {
    try { fs.unlinkSync(this.pidFilePath(instanceId)); } catch { /* ok */ }
  }
}

// --- Helpers ---

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
