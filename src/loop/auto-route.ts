/**
 * Auto-Route — classify prompts and select the optimal LLM profile.
 *
 * Uses a fast/cheap model call to classify the prompt into a category,
 * then maps to the best profile for that task type.
 *
 * Sits downstream of ModelRouter: after ESCALATE, auto-route picks
 * which profile to use for the actual generation.
 */

import { loadProfile, PROFILE_DEFAULTS } from '../config/profile-loader.js';
import type { LLMProfile } from '../config/types.js';

/** Task categories the classifier can produce */
export type TaskCategory = 'coding' | 'reasoning' | 'creative' | 'chat' | 'general';

/** Category → profile name mapping (customizable) */
export const DEFAULT_ROUTE_MAP: Record<TaskCategory, string> = {
  coding: 'thinking-code',
  reasoning: 'thinking',
  creative: 'creative',
  chat: 'fast',
  general: 'default',
};

const CLASSIFY_SYSTEM = `Classify the task into exactly ONE category. Output ONLY the category name, nothing else.

Categories:
- coding (writing, debugging, refactoring code)
- reasoning (analysis, planning, complex logic, math)
- creative (writing prose, poetry, storytelling, brainstorming)
- chat (quick reply, greeting, acknowledgment, short answer)
- general (everything else)`;

export interface AutoRouteOptions {
  /** OpenAI-compatible base URL */
  baseUrl: string;
  /** API key (optional) */
  apiKey?: string;
  /** Directory for profile JSON files */
  profileDir?: string;
  /** Custom category→profile mapping */
  routeMap?: Record<string, string>;
  /** Classification timeout in ms (default: 10000) */
  classifyTimeout?: number;
}

export interface AutoRouteResult {
  /** Selected profile name */
  profileName: string;
  /** Classified category */
  category: TaskCategory | 'default';
  /** Resolved profile parameters */
  profile: Required<LLMProfile>;
}

/**
 * Classify a prompt and return the optimal profile.
 *
 * Uses the "fast" profile for classification (low latency, low cost),
 * then loads the mapped profile for actual generation.
 */
export async function autoRoute(
  prompt: string,
  options: AutoRouteOptions,
): Promise<AutoRouteResult> {
  const {
    baseUrl,
    apiKey,
    profileDir,
    routeMap = DEFAULT_ROUTE_MAP,
    classifyTimeout = 10_000,
  } = options;

  // Load fast profile for classification
  const fast = loadProfile('fast', profileDir);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), classifyTimeout);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: fast.model,
        messages: [
          { role: 'system', content: CLASSIFY_SYSTEM },
          { role: 'user', content: prompt.slice(0, 500) },
        ],
        max_tokens: 16,
        temperature: 0.1,
        top_p: 0.8,
        // Disable thinking for classification (speed)
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      return fallback(profileDir);
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = (data.choices?.[0]?.message?.content ?? '').trim().toLowerCase();
    const category = parseCategory(raw);
    const profileName = routeMap[category] ?? 'default';
    const profile = loadProfile(profileName, profileDir);

    return { profileName, category, profile };
  } catch {
    return fallback(profileDir);
  }
}

function parseCategory(raw: string): TaskCategory {
  const valid: TaskCategory[] = ['coding', 'reasoning', 'creative', 'chat', 'general'];
  const found = valid.find(c => raw.includes(c));
  return found ?? 'general';
}

function fallback(profileDir?: string): AutoRouteResult {
  return {
    profileName: 'default',
    category: 'default',
    profile: loadProfile('default', profileDir),
  };
}
