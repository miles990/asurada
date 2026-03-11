/**
 * Process Manager Factory — auto-detects platform and returns
 * the best available process manager.
 *
 *   macOS  → LaunchdManager (KeepAlive, RunAtLoad)
 *   Linux  → PidFileManager (systemd support planned)
 *   Other  → PidFileManager (universal fallback)
 */

import type { ProcessManager } from './types.js';
import { LaunchdManager } from './launchd.js';
import { PidFileManager } from './pidfile.js';

/**
 * Create a ProcessManager appropriate for the current platform.
 *
 * @param dataDir - Base data directory for storing PID files / instance data
 * @param forceBackend - Override auto-detection (useful for testing)
 */
export function createProcessManager(
  dataDir: string,
  forceBackend?: 'launchd' | 'pidfile',
): ProcessManager {
  const backend = forceBackend ?? detectBackend();

  switch (backend) {
    case 'launchd':
      return new LaunchdManager(dataDir);
    case 'pidfile':
    default:
      return new PidFileManager(dataDir);
  }
}

function detectBackend(): 'launchd' | 'pidfile' {
  if (process.platform === 'darwin') {
    return 'launchd';
  }
  // Future: detect systemd on Linux
  // if (process.platform === 'linux' && hasSystemd()) return 'systemd';
  return 'pidfile';
}
