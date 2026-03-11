/**
 * OpenAiCompatibleRunner — CycleRunner backed by OpenAI-compatible Chat Completions API.
 *
 * Works with local model servers (oMLX, Ollama, vLLM) exposing:
 *   POST /v1/chat/completions
 */

import type { CycleRunner } from '../types.js';

export interface OpenAiCompatibleOptions {
  /** OpenAI-compatible base URL (required), e.g. 'http://localhost:8000' */
  baseUrl: string;
  /** Model ID (required), e.g. 'mlx-community/Qwen3.5-9B-8bit' */
  model: string;
  /** API key (optional; some local servers do not require it) */
  apiKey?: string;
  /** Max tokens (default: 2048) */
  maxTokens?: number;
  /** Timeout in ms (default: 30000 = 30s) */
  timeout?: number;
  /** Temperature (default: 0.7) */
  temperature?: number;
}

export class OpenAiCompatibleRunner implements CycleRunner {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly maxTokens: number;
  private readonly timeout: number;
  private readonly temperature: number;

  constructor(options: OpenAiCompatibleOptions) {
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.maxTokens = options.maxTokens ?? 2048;
    this.timeout = options.timeout ?? 30_000;
    this.temperature = options.temperature ?? 0.7;
  }

  async run(prompt: string, systemPrompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          temperature: this.temperature,
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: prompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`OpenAI-compatible API ${response.status}: ${body.slice(0, 200)}`);
      }

      const data = await response.json() as {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };

      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) {
        throw new Error('OpenAI-compatible API returned empty response');
      }

      return text;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`OpenAI-compatible API timed out after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
