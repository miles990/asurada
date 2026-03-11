/**
 * Setup Wizard — interactive Phase B & C.
 *
 * Phase B: Connect brain (LLM) and mouth (notification).
 * Phase C: Name the agent.
 *
 * Uses Node.js readline — zero external deps.
 */

import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import type { DetectionResult } from './detect.js';

// === Types ===

export interface WizardResult {
  /** Agent name (Phase C) */
  name: string;
  /** Agent persona (Phase C) */
  persona?: string;
  /** LLM runner type */
  runner?: 'anthropic-api' | 'claude-cli' | 'openai-compatible';
  /** LLM model */
  model?: string;
  /** OpenAI-compatible base URL */
  baseUrl?: string;
  /** Notification providers to configure */
  notifications: Array<{ type: string; options?: Record<string, unknown> }>;
}

// === Prompt Helpers ===

function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()));
  });
}

async function choose(
  rl: readline.Interface,
  question: string,
  options: string[],
  defaultIdx = 0,
): Promise<number> {
  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIdx ? '*' : ' ';
    console.log(`  ${marker} ${i + 1}. ${options[i]}`);
  }

  const answer = await ask(rl, `${question} [${defaultIdx + 1}]: `);
  if (!answer) return defaultIdx;
  const num = parseInt(answer, 10);
  if (num >= 1 && num <= options.length) return num - 1;
  return defaultIdx;
}

// === Validation ===

async function validateAnthropicKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function validateClaudeCli(): { ok: boolean; version?: string } {
  try {
    const out = execFileSync('claude', ['--version'], {
      timeout: 5000,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return { ok: true, version: out.trim() };
  } catch {
    return { ok: false };
  }
}

async function validateOpenAiEndpoint(baseUrl: string): Promise<{ ok: boolean; models?: string[] }> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json() as { data?: Array<{ id: string }> };
    const models = data.data?.map(m => m.id) ?? [];
    return { ok: true, models };
  } catch {
    return { ok: false };
  }
}

async function validateTelegram(
  token: string,
  chatId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getChat?chat_id=${chatId}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  rl: readline.Interface,
  label: string,
  maxRetries = 2,
): Promise<T | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await fn();
    if (result) return result;
    if (attempt < maxRetries) {
      const retry = await ask(rl, `  ${label} failed. Retry? [Y/n]: `);
      if (retry.toLowerCase() === 'n') return null;
    }
  }
  return null;
}

// === Wizard Flow ===

export async function runWizard(env: DetectionResult): Promise<WizardResult> {
  const rl = createInterface();
  const result: WizardResult = {
    name: 'My Assistant',
    notifications: [],
  };

  try {
    // Phase C: Name (ask first — sets the tone)
    console.log('\n--- Phase C: Identity ---\n');
    const nameInput = await ask(rl, 'What should your agent be called? [My Assistant]: ');
    result.name = nameInput || 'My Assistant';

    const personaInput = await ask(rl, 'One-line persona (optional): ');
    if (personaInput) result.persona = personaInput;

    // Phase B: Brain
    console.log('\n--- Phase B: Connection ---\n');
    console.log('Brain — your agent needs an LLM to think.\n');

    const brainOptions: string[] = [];
    const brainValues: string[] = [];

    if (env.llm.anthropicApi) {
      brainOptions.push('Claude API (ANTHROPIC_API_KEY detected)');
      brainValues.push('anthropic-api-env');
    }
    brainOptions.push('Claude API (enter key)');
    brainValues.push('anthropic-api-manual');
    if (env.llm.claudeCli.available) {
      brainOptions.push(`Claude CLI (${env.llm.claudeCli.version ?? 'installed'})`);
      brainValues.push('claude-cli');
    }
    brainOptions.push('OpenAI-compatible (Ollama, vLLM, oMLX, etc.)');
    brainValues.push('openai-compatible');
    brainOptions.push('Skip — I\'ll configure later');
    brainValues.push('skip');

    const brainChoice = await choose(rl, 'Which LLM?', brainOptions, 0);
    const brainValue = brainValues[brainChoice];

    if (brainValue === 'anthropic-api-env') {
      process.stdout.write('  Validating API key... ');
      const validated = await withRetry(
        async () => validateAnthropicKey(process.env.ANTHROPIC_API_KEY!),
        rl, 'API key validation',
      );
      console.log(validated ? '\u2713 connected' : '\u2717 failed (will use key anyway)');
      result.runner = 'anthropic-api';
    } else if (brainValue === 'anthropic-api-manual') {
      const key = await ask(rl, '  Enter ANTHROPIC_API_KEY: ');
      if (key) {
        process.stdout.write('  Validating... ');
        const validated = await withRetry(
          async () => validateAnthropicKey(key),
          rl, 'API key validation',
        );
        console.log(validated ? '\u2713 connected' : '\u2717 failed — check key later');
        process.env.ANTHROPIC_API_KEY = key;
        result.runner = 'anthropic-api';
        console.log('  Note: Add ANTHROPIC_API_KEY to your shell profile for persistence.');
      }
    } else if (brainValue === 'claude-cli') {
      const check = validateClaudeCli();
      console.log(check.ok ? `  \u2713 Claude CLI ready` : '  \u2717 Claude CLI not found');
      result.runner = 'claude-cli';
    } else if (brainValue === 'openai-compatible') {
      const baseUrl = await ask(rl, '  Base URL (e.g. http://localhost:8000): ');
      if (baseUrl) {
        process.stdout.write('  Checking endpoint... ');
        const check = await withRetry(
          async () => {
            const r = await validateOpenAiEndpoint(baseUrl);
            return r.ok ? r : null;
          },
          rl, 'Endpoint check',
        );
        if (check && typeof check === 'object' && 'models' in check) {
          const models = (check as { models?: string[] }).models ?? [];
          console.log(`\u2713 connected (${models.length} model${models.length !== 1 ? 's' : ''} available)`);
          if (models.length > 0) {
            console.log(`  Available: ${models.slice(0, 5).join(', ')}${models.length > 5 ? '...' : ''}`);
          }
          const modelInput = await ask(rl, `  Model ID [${models[0] ?? 'default'}]: `);
          result.model = modelInput || models[0] || 'default';
        } else {
          console.log('\u2717 could not reach endpoint — configure baseUrl in asurada.yaml later');
        }
        result.runner = 'openai-compatible';
        result.baseUrl = baseUrl;
      }
    }
    // skip → no runner set

    // Mouth — notification
    console.log('\nMouth — how should your agent reach you?\n');

    const mouthOptions = ['Telegram', 'Console only (dashboard)', 'Skip'];
    const mouthChoice = await choose(rl, 'Notification method?', mouthOptions, 0);

    if (mouthChoice === 0) {
      // Telegram
      const token = await ask(rl, '  Telegram bot token: ');
      const chatId = await ask(rl, '  Telegram chat ID: ');

      if (token && chatId) {
        process.stdout.write('  Validating... ');
        const ok = await validateTelegram(token, chatId);
        console.log(ok ? '\u2713 connected' : '\u2717 failed — check credentials later');
        result.notifications.push({
          type: 'telegram',
          options: { botToken: token, chatId },
        });
      }
    } else if (mouthChoice === 1) {
      result.notifications.push({ type: 'console' });
    }

    console.log();
    return result;
  } finally {
    rl.close();
  }
}
