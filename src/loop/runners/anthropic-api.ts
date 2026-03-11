/**
 * AnthropicApiRunner — CycleRunner backed by the Anthropic Messages API.
 *
 * For users with an API key. Direct HTTP call, no SDK dependency.
 *
 * Usage:
 *   import { AnthropicApiRunner } from 'asurada';
 *   const runner = new AnthropicApiRunner({ apiKey: process.env.ANTHROPIC_API_KEY! });
 */

import type { CycleRunner } from '../types.js';

export interface AnthropicApiOptions {
  /** Anthropic API key (required) */
  apiKey: string;
  /** Model ID (default: 'claude-sonnet-4-20250514') */
  model?: string;
  /** Max tokens (default: 4096) */
  maxTokens?: number;
  /** Timeout in ms (default: 120000 = 2min) */
  timeout?: number;
  /** API base URL (default: 'https://api.anthropic.com') */
  baseUrl?: string;
}

export class AnthropicApiRunner implements CycleRunner {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeout: number;
  private readonly baseUrl: string;

  constructor(options: AnthropicApiOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'claude-sonnet-4-20250514';
    this.maxTokens = options.maxTokens ?? 4096;
    this.timeout = options.timeout ?? 120_000;
    this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
  }

  async run(prompt: string, systemPrompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          system: systemPrompt || undefined,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Anthropic API ${response.status}: ${body.slice(0, 200)}`);
      }

      const data = await response.json() as {
        content: Array<{ type: string; text?: string }>;
      };

      // Extract text blocks
      return data.content
        .filter(b => b.type === 'text' && b.text)
        .map(b => b.text!)
        .join('\n');
    } finally {
      clearTimeout(timer);
    }
  }
}
