/**
 * Asurada Process Management — platform-agnostic daemon lifecycle.
 *
 * Interface that backends implement:
 *   - LaunchdManager (macOS)
 *   - PidFileManager (universal fallback)
 *   - SystemdManager (Linux — future)
 */

/** Options for starting an agent as a background process */
export interface ProcessStartOptions {
  /** Unique instance identifier */
  instanceId: string;
  /** Path to the JS entry file to run */
  entryScript: string;
  /** HTTP port for the agent */
  port: number;
  /** Working directory */
  workDir?: string;
  /** Directory for log files */
  logsDir?: string;
  /** Additional arguments to pass after the entry script */
  args?: string[];
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Auto-restart on crash (default: true for launchd/systemd, false for pidfile) */
  keepAlive?: boolean;
}

/** Runtime info about a managed process */
export interface ProcessInfo {
  /** Instance identifier */
  instanceId: string;
  /** OS process ID (undefined if not running) */
  pid?: number;
  /** Whether the process is currently alive */
  running: boolean;
  /** Port (from config, not probed) */
  port?: number;
  /** Which backend manages this process */
  backend: ProcessBackend;
}

/** Supported process management backends */
export type ProcessBackend = 'launchd' | 'systemd' | 'pidfile';

/**
 * ProcessManager — start/stop/monitor agent daemon processes.
 *
 * Each platform backend implements this interface.
 * Users don't interact with this directly — the CLI uses it.
 */
export interface ProcessManager {
  /** Which backend this is */
  readonly backend: ProcessBackend;

  /**
   * Start the agent as a background process.
   * Performs a health check after starting.
   * Throws if health check fails.
   */
  start(opts: ProcessStartOptions): Promise<ProcessInfo>;

  /**
   * Stop a running agent process.
   * Returns true if the process was stopped (or was already stopped).
   */
  stop(instanceId: string): Promise<boolean>;

  /** Check if the process is currently running */
  isRunning(instanceId: string): boolean;

  /** Get process info (null if instance unknown) */
  status(instanceId: string): ProcessInfo | null;

  /** Stop then start */
  restart(opts: ProcessStartOptions): Promise<ProcessInfo>;

  /** Stop all managed processes */
  stopAll(): Promise<void>;
}
