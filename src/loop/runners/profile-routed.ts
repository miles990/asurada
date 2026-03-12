/**
 * ProfileRoutedRunner — CycleRunner with auto-route profile selection.
 *
 * Flow: prompt → classify (fast) → load profile → call LLM with profile params.
 *
 * Wraps any OpenAI-compatible endpoint. Use this as the escalate runner
 * in ModelRouter for intelligent per-prompt parameter tuning.
 */

import type { CycleRunner } from '../types.js';
import type { LLMProfile } from '../../config/types.js';
import { loadProfile } from '../../config/profile-loader.js';
import { autoRoute, type AutoRouteOptions } from '../auto-route.js';
import { slog } from '../../logging/index.js';

export interface ProfileRoutedOptions {
  /** OpenAI-compatible base URL (required) */
  baseUrl: string;
  /** API key (optional) */
  apiKey?: string;
  /** Directory for profile JSON files */
  profileDir?: string;
  /** Custom category→profile mapping */
  routeMap?: Record<string, string>;
  /** Force a specific profile (bypasses auto-route) */
  forceProfile?: string;
}

export class ProfileRoutedRunner implements CycleRunner {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly profileDir?: string;
  private readonly routeMap?: Record<string, string>;
  private readonly forceProfile?: string;

  constructor(options: ProfileRoutedOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.profileDir = options.profileDir;
    this.routeMap = options.routeMap;
    this.forceProfile = options.forceProfile;
  }

  async run(prompt: string, systemPrompt: string): Promise<string> {
    let profile: Required<LLMProfile>;
    let profileName: string;

    if (this.forceProfile) {
      profileName = this.forceProfile;
      profile = loadProfile(this.forceProfile, this.profileDir);
    } else {
      const routeOpts: AutoRouteOptions = {
        baseUrl: this.baseUrl,
        apiKey: this.apiKey,
        profileDir: this.profileDir,
        routeMap: this.routeMap,
      };
      const result = await autoRoute(prompt, routeOpts);
      profile = result.profile;
      profileName = result.profileName;
      slog('loop', `auto-route: ${result.category} → profile=${profileName}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), profile.timeout_ms);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const body: Record<string, unknown> = {
        model: profile.model,
        max_tokens: profile.max_tokens,
        temperature: profile.temperature,
        top_p: profile.top_p,
        top_k: profile.top_k,
        presence_penalty: profile.presence_penalty,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: prompt },
        ],
        chat_template_kwargs: { enable_thinking: profile.enable_thinking },
      };

      if (profile.repetition_penalty && profile.repetition_penalty > 0) {
        body.repetition_penalty = profile.repetition_penalty;
      }

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`ProfileRoutedRunner ${response.status}: ${errBody.slice(0, 200)}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) {
        throw new Error('ProfileRoutedRunner: empty response');
      }

      return text;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`ProfileRoutedRunner timed out after ${profile.timeout_ms}ms (profile=${profileName})`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
