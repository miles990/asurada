/**
 * Perception plugin executor — runs shell scripts and captures output.
 *
 * Any executable file can be a perception plugin:
 * - stdout = result, wrapped in <tag>...</tag> for context injection
 * - Supports any language (bash, python, go binary, etc.)
 * - Error isolation: one plugin's failure never affects others
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { PerceptionPlugin, PerceptionResult } from './types.js';

const DEFAULT_TIMEOUT = 10_000;
const MAX_BUFFER = 1024 * 1024; // 1MB

/**
 * Execute a single perception plugin script.
 * Returns result with output or error — never throws.
 */
export async function executePlugin(
  plugin: PerceptionPlugin,
  cwd?: string,
): Promise<PerceptionResult> {
  const timeout = plugin.timeout ?? DEFAULT_TIMEOUT;
  const startTime = Date.now();

  const scriptPath = path.isAbsolute(plugin.script)
    ? plugin.script
    : path.resolve(cwd ?? process.cwd(), plugin.script);

  if (!fs.existsSync(scriptPath)) {
    return {
      name: plugin.name,
      output: null,
      error: `Script not found: ${scriptPath}`,
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        scriptPath,
        [],
        {
          encoding: 'utf-8',
          timeout,
          cwd: cwd ?? process.cwd(),
          maxBuffer: MAX_BUFFER,
        },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        },
      );
    });

    return {
      name: plugin.name,
      output: output.trim() || null,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      name: plugin.name,
      output: null,
      error: msg.split('\n')[0].slice(0, 200),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute all plugins in parallel.
 * Each runs independently — one failure doesn't affect others.
 */
export async function executeAllPlugins(
  plugins: PerceptionPlugin[],
  cwd?: string,
): Promise<PerceptionResult[]> {
  return Promise.all(plugins.map(p => executePlugin(p, cwd)));
}

/**
 * Format perception results as XML context sections.
 */
export function formatResults(
  results: PerceptionResult[],
  defaultCap = 4000,
  capOverrides?: Record<string, number>,
): string {
  return results
    .filter(r => r.output)
    .map(r => {
      const cap = capOverrides?.[r.name] ?? defaultCap;
      const output = r.output!.length > cap
        ? r.output!.slice(0, cap) + '\n[... truncated]'
        : r.output!;
      return `<${r.name}>\n${output}\n</${r.name}>`;
    })
    .join('\n\n');
}
