/**
 * ClaudeCliRunner — CycleRunner backed by `claude -p` subprocess.
 *
 * Zero-config for users who have Claude Code installed.
 * No API key needed (uses Claude Code's auth).
 *
 * Usage:
 *   import { ClaudeCliRunner } from 'asurada';
 *   const runner = new ClaudeCliRunner({ model: 'sonnet' });
 */

import { execFile } from 'node:child_process';
import type { CycleRunner } from '../types.js';

export interface ClaudeCliOptions {
  /** Model to use (default: 'sonnet') */
  model?: string;
  /** Max turns per call (default: 1) */
  maxTurns?: number;
  /** Timeout in ms (default: 120000 = 2min) */
  timeout?: number;
  /** Path to claude binary (default: 'claude') */
  binary?: string;
}

export class ClaudeCliRunner implements CycleRunner {
  private readonly model: string;
  private readonly maxTurns: number;
  private readonly timeout: number;
  private readonly binary: string;

  constructor(options?: ClaudeCliOptions) {
    this.model = options?.model ?? 'sonnet';
    this.maxTurns = options?.maxTurns ?? 1;
    this.timeout = options?.timeout ?? 120_000;
    this.binary = options?.binary ?? 'claude';
  }

  async run(prompt: string, systemPrompt: string): Promise<string> {
    const args = [
      '-p', this.buildInput(prompt, systemPrompt),
      '--max-turns', String(this.maxTurns),
      '--model', this.model,
      '--output-format', 'text',
    ];

    return new Promise<string>((resolve, reject) => {
      const child = execFile(
        this.binary,
        args,
        {
          timeout: this.timeout,
          maxBuffer: 1024 * 1024 * 5, // 5MB
          env: { ...process.env },
        },
        (error, stdout, stderr) => {
          if (error) {
            // Timeout or exit code
            if (error.killed) {
              reject(new Error(`Claude CLI timed out after ${this.timeout}ms`));
            } else {
              reject(new Error(`Claude CLI error (code ${error.code}): ${stderr || error.message}`));
            }
            return;
          }
          resolve(stdout.trim());
        },
      );

      // Handle subprocess pipe errors gracefully
      child.stdin?.on('error', () => {});
      child.stdout?.on('error', () => {});
      child.stderr?.on('error', () => {});
    });
  }

  private buildInput(prompt: string, systemPrompt: string): string {
    if (systemPrompt) {
      return `${systemPrompt}\n\n---\n\n${prompt}`;
    }
    return prompt;
  }
}
