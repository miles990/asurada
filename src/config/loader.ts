/**
 * Config loader — read YAML, validate, merge with defaults.
 *
 * No external deps beyond 'yaml' (already in project).
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { AgentConfig } from './types.js';
import { DEFAULT_CONFIG, STARTER_CONFIG } from './defaults.js';

const CONFIG_FILENAMES = ['asurada.yaml', 'asurada.yml', 'agent-compose.yaml'];

// =============================================================================
// Load
// =============================================================================

/**
 * Find config file in directory (tries known filenames)
 */
export function findConfigFile(dir?: string, specificFile?: string): string | null {
  if (specificFile) {
    const resolved = path.resolve(specificFile);
    return fs.existsSync(resolved) ? resolved : null;
  }

  const searchDir = dir || process.cwd();
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(searchDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Load and validate agent config from YAML file.
 * Merges with defaults — user only needs to specify what differs.
 */
export function loadConfig(filePath: string): AgentConfig {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = parseYaml(raw) as Partial<AgentConfig>;

  // Validate: agent.name is required
  if (!parsed.agent?.name) {
    throw new Error(`Config error: agent.name is required (in ${filePath})`);
  }

  // Deep merge with defaults
  const config: AgentConfig = {
    agent: parsed.agent,
    loop: { ...DEFAULT_CONFIG.loop, ...parsed.loop },
    notification: {
      providers: parsed.notification?.providers ?? DEFAULT_CONFIG.notification?.providers ?? [],
    },
    perception: {
      categoryIntervals: {
        ...DEFAULT_CONFIG.perception?.categoryIntervals,
        ...parsed.perception?.categoryIntervals,
      },
      plugins: parsed.perception?.plugins ?? DEFAULT_CONFIG.perception?.plugins ?? [],
    },
    memory: {
      ...DEFAULT_CONFIG.memory,
      ...parsed.memory,
      search: {
        ...DEFAULT_CONFIG.memory?.search,
        ...parsed.memory?.search,
      },
    },
    logging: {
      ...DEFAULT_CONFIG.logging,
      ...parsed.logging,
    },
    lanes: {
      ...DEFAULT_CONFIG.lanes,
      ...parsed.lanes,
      typeDefaults: {
        ...DEFAULT_CONFIG.lanes?.typeDefaults,
        ...parsed.lanes?.typeDefaults,
      },
    },
    skills: parsed.skills ?? DEFAULT_CONFIG.skills ?? [],
    cron: parsed.cron ?? DEFAULT_CONFIG.cron ?? [],
    paths: parsed.paths,
  };

  // Resolve relative paths against config file directory
  const configDir = path.dirname(path.resolve(filePath));
  resolvePaths(config, configDir);

  return config;
}

/**
 * Load config from directory (auto-finds config file)
 */
export function loadConfigFromDir(dir?: string): AgentConfig | null {
  const file = findConfigFile(dir);
  if (!file) return null;
  return loadConfig(file);
}

// =============================================================================
// Generate
// =============================================================================

/**
 * Generate a starter config YAML string
 */
export function generateConfig(options?: {
  name?: string;
  persona?: string;
  port?: number;
  runner?: string;
  notifications?: Array<{ type: string; options?: Record<string, unknown> }>;
}): string {
  const config = structuredClone(STARTER_CONFIG);
  if (options?.name) config.agent.name = options.name;
  if (options?.persona) config.agent.persona = options.persona;
  if (options?.port) config.agent.port = options.port;

  // Apply wizard-selected runner
  if (options?.runner) {
    config.loop = { ...config.loop, runner: options.runner };
  }

  // Apply wizard-selected notification providers
  if (options?.notifications && options.notifications.length > 0) {
    config.notification = {
      providers: options.notifications.map(n => ({
        type: n.type,
        ...(n.options ? { options: n.options } : {}),
      })),
    };
  }

  const header = `# Asurada Agent Configuration
# Docs: https://github.com/miles990/asurada
#
# perception.plugins — shell scripts defining what the agent can see
# skills — markdown files defining what the agent knows how to do
# loop — autonomous perception-driven cycle

`;

  return header + stringifyYaml(config);
}

/**
 * Write starter config to disk
 */
export function writeConfig(dir: string, options?: Parameters<typeof generateConfig>[0]): string {
  const filePath = path.join(dir, 'asurada.yaml');
  const content = generateConfig(options);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// =============================================================================
// Paths
// =============================================================================

/**
 * Default data directory following platform conventions.
 * - macOS: ~/Library/Application Support/asurada
 * - Linux: $XDG_DATA_HOME/asurada or ~/.local/share/asurada
 * - Windows: %USERPROFILE%/.local/share/asurada (fallback)
 */
export function getDefaultDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return path.join(xdg, 'asurada');

  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'asurada');
  }
  return path.join(home, '.local', 'share', 'asurada');
}

// =============================================================================
// Internal
// =============================================================================

function resolvePaths(config: AgentConfig, baseDir: string): void {
  // Resolve plugin script paths
  if (config.perception?.plugins) {
    for (const plugin of config.perception.plugins) {
      if (plugin.script && !path.isAbsolute(plugin.script)) {
        plugin.script = path.resolve(baseDir, plugin.script);
      }
    }
  }

  // Resolve skill paths
  if (config.skills) {
    config.skills = config.skills.map(s =>
      path.isAbsolute(s) ? s : path.resolve(baseDir, s)
    );
  }

  // Resolve memory/logs dirs
  if (config.memory?.dir && !path.isAbsolute(config.memory.dir)) {
    config.memory.dir = path.resolve(baseDir, config.memory.dir);
  }
  if (config.logging?.dir && !path.isAbsolute(config.logging.dir)) {
    config.logging.dir = path.resolve(baseDir, config.logging.dir);
  }
  if (config.paths?.data && !path.isAbsolute(config.paths.data)) {
    config.paths.data = path.resolve(baseDir, config.paths.data);
  }
  if (config.paths?.memory && !path.isAbsolute(config.paths.memory)) {
    config.paths.memory = path.resolve(baseDir, config.paths.memory);
  }
  if (config.paths?.logs && !path.isAbsolute(config.paths.logs)) {
    config.paths.logs = path.resolve(baseDir, config.paths.logs);
  }
}
