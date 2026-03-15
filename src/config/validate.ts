/**
 * Config Validation — catch common errors before startup.
 *
 * Returns a list of issues (errors and warnings) so users
 * get clear feedback instead of cryptic runtime failures.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AgentConfig } from './types.js';

export interface ValidationIssue {
  level: 'error' | 'warn';
  field: string;
  message: string;
}

export function validateConfig(config: AgentConfig, baseDir: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Agent name required
  if (!config.agent?.name?.trim()) {
    issues.push({ level: 'error', field: 'agent.name', message: 'Agent name is required' });
  }

  // 2. Port range
  if (config.agent?.port !== undefined) {
    if (config.agent.port < 1 || config.agent.port > 65535) {
      issues.push({ level: 'error', field: 'agent.port', message: `Invalid port ${config.agent.port} (must be 1-65535)` });
    }
  }

  // 3. Plugin scripts exist
  for (const plugin of config.perception?.plugins ?? []) {
    if (plugin.enabled === false) continue;
    if (plugin.script && !plugin.command) {
      const resolved = path.resolve(baseDir, plugin.script);
      if (!fs.existsSync(resolved)) {
        issues.push({ level: 'warn', field: `perception.plugins.${plugin.name}`, message: `Plugin "${plugin.name}" script not found: ${plugin.script}` });
      }
    }
    if (!plugin.name?.trim()) {
      issues.push({ level: 'error', field: 'perception.plugins', message: 'Plugin missing name' });
    }
  }

  // 4. Runner config completeness
  if (config.loop?.runner === 'anthropic-api' && !config.loop.anthropicApiKey) {
    issues.push({ level: 'error', field: 'loop.anthropicApiKey', message: 'Anthropic API runner requires anthropicApiKey' });
  }

  // 5. Router requires triage runner
  if (config.loop?.router?.enabled && !config.loop.router.triageRunner) {
    issues.push({ level: 'warn', field: 'loop.router.triageRunner', message: 'Router enabled but no triageRunner configured — will use direct runner' });
  }

  // 6. Cron expressions (basic check)
  for (const entry of config.cron ?? []) {
    if (!entry.schedule?.trim()) {
      issues.push({ level: 'warn', field: 'cron', message: `Cron entry missing schedule: "${entry.task?.slice(0, 40)}"` });
    }
  }

  // 7. Loop interval format
  if (config.loop?.interval) {
    const match = config.loop.interval.match(/^(\d+(?:\.\d+)?)\s*(s|m|h)$/);
    if (!match) {
      issues.push({ level: 'warn', field: 'loop.interval', message: `Invalid interval format "${config.loop.interval}" — expected "5m", "30s", or "2h"` });
    }
  }

  return issues;
}
