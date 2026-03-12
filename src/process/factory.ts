/**
 * Process Manager Factory — auto-detects platform and returns
 * the best available process manager.
 *
 *   macOS  → LaunchdManager (KeepAlive, RunAtLoad)
 *   Linux  → PidFileManager (systemd support planned)
 *   Other  → PidFileManager (universal fallback)
 */

import type { ProcessManager, ProcessBackend } from './types.js';
import { LaunchdManager } from './launchd.js';
import { PidFileManager } from './pidfile.js';

/**
 * Create a ProcessManager appropriate for the current platform.
 *
 * @param dataDir - Base data directory for storing PID files / instance data
 * @param forceBackend - Override auto-detection (useful for testing).
 *   Accepts any ProcessBackend; unimplemented backends fall back to pidfile with a warning.
 */
export function createProcessManager(
  dataDir: string,
  forceBackend?: ProcessBackend,
): ProcessManager {
  const backend = forceBackend ?? detectBackend();

  switch (backend) {
    case 'launchd':
      return new LaunchdManager(dataDir);
    case 'systemd':
      // Interface prepared — implementation planned for Linux support
      console.warn('Warning: systemd backend is not yet implemented. Falling back to pidfile.');
      return new PidFileManager(dataDir);
    case 'pidfile':
    default:
      return new PidFileManager(dataDir);
  }
}

function detectBackend(): ProcessBackend {
  if (process.platform === 'darwin') {
    return 'launchd';
  }
  // Future: detect systemd on Linux
  // if (process.platform === 'linux' && hasSystemd()) return 'systemd';
  return 'pidfile';
}
