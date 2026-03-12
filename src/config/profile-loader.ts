/**
 * LLM Profile Loader — config-driven model parameters.
 *
 * Loads JSON profiles from `llm/profiles/{name}.json` with:
 * - 30s hot-reload cache (edit a profile, see changes in next cycle)
 * - Graceful fallback to defaults on missing/invalid files
 * - Provider-agnostic: works with any OpenAI-compatible server
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LLMProfile } from './types.js';

/** Sensible defaults — balanced for general-purpose use */
export const PROFILE_DEFAULTS: Readonly<Required<LLMProfile>> = {
  model: 'default',
  max_tokens: 8192,
  temperature: 0.7,
  top_p: 0.8,
  top_k: 20,
  presence_penalty: 1.5,
  repetition_penalty: 0,
  enable_thinking: false,
  tools_enabled: true,
  timeout_ms: 600_000,
};

const CACHE_TTL = 30_000; // 30s hot reload

interface CacheEntry {
  profile: Partial<LLMProfile>;
  loadedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Load a named profile, merging with defaults.
 *
 * @param name - Profile name (e.g. "fast", "thinking", "creative")
 * @param profileDir - Directory containing profile JSON files (default: `llm/profiles` relative to cwd)
 * @returns Fully resolved profile with all fields guaranteed
 */
export function loadProfile(
  name: string,
  profileDir?: string,
): Required<LLMProfile> {
  const dir = profileDir ?? join(process.cwd(), 'llm', 'profiles');
  const cacheKey = `${dir}/${name}`;
  const now = Date.now();

  const cached = cache.get(cacheKey);
  if (cached && now - cached.loadedAt < CACHE_TTL) {
    return { ...PROFILE_DEFAULTS, ...cached.profile };
  }

  const filePath = join(dir, `${name}.json`);
  let partial: Partial<LLMProfile> = {};
  try {
    partial = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<LLMProfile>;
    cache.set(cacheKey, { profile: partial, loadedAt: now });
  } catch {
    // File not found or parse error — use defaults
  }

  return { ...PROFILE_DEFAULTS, ...partial };
}

/** Clear the profile cache (useful for testing) */
export function clearProfileCache(): void {
  cache.clear();
}
