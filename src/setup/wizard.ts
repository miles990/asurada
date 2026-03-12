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

/** Supported language codes */
export type WizardLanguage = 'en' | 'zh-TW' | 'ja';

export interface WizardResult {
  /** Agent name (Phase C) */
  name: string;
  /** Agent persona (Phase C) */
  persona?: string;
  /** Optional comma-separated traits from wizard input */
  traits?: string;
  /** User-selected language */
  language: WizardLanguage;
  /** Perception plugins selected in wizard */
  perceptions?: Array<'workspace' | 'browser-tabs' | 'git-activity'>;
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

async function chooseMany(
  rl: readline.Interface,
  question: string,
  options: string[],
): Promise<number[]> {
  for (let i = 0; i < options.length; i++) {
    console.log(`  ${i + 1}. ${options[i]}`);
  }

  const answer = await ask(rl, `${question} [comma-separated, Enter to skip]: `);
  if (!answer) return [];

  const selected = new Set<number>();
  for (const part of answer.split(',')) {
    const num = parseInt(part.trim(), 10);
    if (num >= 1 && num <= options.length) selected.add(num - 1);
  }
  return Array.from(selected).sort((a, b) => a - b);
}

// === i18n Strings ===

interface WizardStrings {
  phaseIdentity: string;
  askName: string;
  askPersona: string;
  askTraits: string;
  phaseConnection: string;
  brainIntro: string;
  whichLlm: string;
  validatingApiKey: string;
  connected: string;
  failedUseAnyway: string;
  enterApiKey: string;
  validating: string;
  failedCheckLater: string;
  addKeyNote: string;
  cliReady: string;
  cliNotFound: string;
  askBaseUrl: string;
  checkingEndpoint: string;
  modelsAvailable: (n: number) => string;
  available: string;
  askModelId: string;
  endpointUnreachable: string;
  mouthIntro: string;
  notificationMethod: string;
  telegramBotToken: string;
  telegramChatId: string;
  perceptionIntro: string;
  selectPerception: string;
  workspaceChanges: string;
  browserTabs: string;
  gitActivity: string;
  skipLlm: string;
  consoleDashboard: string;
  skip: string;
}

const STRINGS: Record<WizardLanguage, WizardStrings> = {
  en: {
    phaseIdentity: '\n--- Phase C: Identity ---\n',
    askName: 'What should your agent be called? [My Assistant]: ',
    askPersona: 'One-line persona: ',
    askTraits: 'Traits (comma-separated, optional): ',
    phaseConnection: '\n--- Phase B: Connection ---\n',
    brainIntro: 'Brain — your agent needs an LLM to think.\n',
    whichLlm: 'Which LLM?',
    validatingApiKey: '  Validating API key... ',
    connected: '\u2713 connected',
    failedUseAnyway: '\u2717 failed (will use key anyway)',
    enterApiKey: '  Enter ANTHROPIC_API_KEY: ',
    validating: '  Validating... ',
    failedCheckLater: '\u2717 failed \u2014 check key later',
    addKeyNote: '  Note: Add ANTHROPIC_API_KEY to your shell profile for persistence.',
    cliReady: '  \u2713 Claude CLI ready',
    cliNotFound: '  \u2717 Claude CLI not found',
    askBaseUrl: '  Base URL (e.g. http://localhost:8000): ',
    checkingEndpoint: '  Checking endpoint... ',
    modelsAvailable: (n: number) => `\u2713 connected (${n} model${n !== 1 ? 's' : ''} available)`,
    available: '  Available: ',
    askModelId: '  Model ID',
    endpointUnreachable: '\u2717 could not reach endpoint \u2014 configure baseUrl in asurada.yaml later',
    mouthIntro: '\nMouth \u2014 how should your agent reach you?\n',
    notificationMethod: 'Notification method?',
    telegramBotToken: '  Telegram bot token: ',
    telegramChatId: '  Telegram chat ID: ',
    perceptionIntro: '\nPerception \u2014 what should your agent watch?\n',
    selectPerception: 'Select perception sources',
    workspaceChanges: 'Workspace changes',
    browserTabs: 'Browser tabs',
    gitActivity: 'Git activity',
    skipLlm: 'Skip \u2014 I\'ll configure later',
    consoleDashboard: 'Console only (dashboard)',
    skip: 'Skip',
  },
  'zh-TW': {
    phaseIdentity: '\n--- \u968e\u6bb5 C\uff1a\u8eab\u4efd\u8a2d\u5b9a ---\n',
    askName: '\u4f60\u7684 Agent \u53eb\u4ec0\u9ebc\u540d\u5b57\uff1f [\u6211\u7684\u52a9\u624b]: ',
    askPersona: '\u4e00\u53e5\u8a71\u63cf\u8ff0\u4eba\u8a2d\uff1a',
    askTraits: '\u7279\u8cea\uff08\u9017\u865f\u5206\u9694\uff0c\u53ef\u7559\u7a7a\uff09\uff1a',
    phaseConnection: '\n--- \u968e\u6bb5 B\uff1a\u9023\u63a5\u8a2d\u5b9a ---\n',
    brainIntro: '\u5927\u8166 \u2014 \u4f60\u7684 Agent \u9700\u8981\u4e00\u500b LLM \u4f86\u601d\u8003\u3002\n',
    whichLlm: '\u9078\u64c7 LLM\uff1f',
    validatingApiKey: '  \u9a57\u8b49 API key \u4e2d... ',
    connected: '\u2713 \u5df2\u9023\u63a5',
    failedUseAnyway: '\u2717 \u9a57\u8b49\u5931\u6557\uff08\u4ecd\u6703\u4f7f\u7528\u6b64 key\uff09',
    enterApiKey: '  \u8f38\u5165 ANTHROPIC_API_KEY\uff1a',
    validating: '  \u9a57\u8b49\u4e2d... ',
    failedCheckLater: '\u2717 \u5931\u6557 \u2014 \u7a0d\u5f8c\u6aa2\u67e5 key',
    addKeyNote: '  \u63d0\u793a\uff1a\u5c07 ANTHROPIC_API_KEY \u52a0\u5165 shell profile \u4ee5\u6c38\u4e45\u4fdd\u5b58\u3002',
    cliReady: '  \u2713 Claude CLI \u5c31\u7dd2',
    cliNotFound: '  \u2717 \u627e\u4e0d\u5230 Claude CLI',
    askBaseUrl: '  Base URL\uff08\u4f8b\u5982 http://localhost:8000\uff09\uff1a',
    checkingEndpoint: '  \u6aa2\u67e5\u7aef\u9ede\u4e2d... ',
    modelsAvailable: (n: number) => `\u2713 \u5df2\u9023\u63a5\uff08${n} \u500b\u6a21\u578b\u53ef\u7528\uff09`,
    available: '  \u53ef\u7528\uff1a',
    askModelId: '  \u6a21\u578b ID',
    endpointUnreachable: '\u2717 \u7121\u6cd5\u9023\u63a5\u7aef\u9ede \u2014 \u7a0d\u5f8c\u5728 asurada.yaml \u8a2d\u5b9a baseUrl',
    mouthIntro: '\n\u901a\u77e5 \u2014 \u4f60\u7684 Agent \u5982\u4f55\u806f\u7e6b\u4f60\uff1f\n',
    notificationMethod: '\u901a\u77e5\u65b9\u5f0f\uff1f',
    telegramBotToken: '  Telegram bot token\uff1a',
    telegramChatId: '  Telegram chat ID\uff1a',
    perceptionIntro: '\n\u611f\u77e5 \u2014 \u4f60\u7684 Agent \u61c9\u8a72\u89c0\u5bdf\u4ec0\u9ebc\uff1f\n',
    selectPerception: '\u9078\u64c7\u611f\u77e5\u4f86\u6e90',
    workspaceChanges: '\u5de5\u4f5c\u5340\u8b8a\u66f4',
    browserTabs: '\u700f\u89bd\u5668\u5206\u9801',
    gitActivity: 'Git \u6d3b\u52d5',
    skipLlm: '\u8df3\u904e \u2014 \u7a0d\u5f8c\u518d\u8a2d\u5b9a',
    consoleDashboard: '\u50c5\u4e3b\u63a7\u53f0\uff08dashboard\uff09',
    skip: '\u8df3\u904e',
  },
  ja: {
    phaseIdentity: '\n--- \u30d5\u30a7\u30fc\u30ba C: \u30a2\u30a4\u30c7\u30f3\u30c6\u30a3\u30c6\u30a3 ---\n',
    askName: 'Agent \u306e\u540d\u524d\u306f\uff1f [\u30a2\u30b7\u30b9\u30bf\u30f3\u30c8]: ',
    askPersona: '\u4e00\u884c\u306e\u30da\u30eb\u30bd\u30ca\u8aac\u660e\uff1a',
    askTraits: '\u7279\u6027\uff08\u30ab\u30f3\u30de\u533a\u5207\u308a\u3001\u7701\u7565\u53ef\uff09\uff1a',
    phaseConnection: '\n--- \u30d5\u30a7\u30fc\u30ba B: \u63a5\u7d9a\u8a2d\u5b9a ---\n',
    brainIntro: '\u30d6\u30ec\u30a4\u30f3 \u2014 Agent \u306b\u306f\u601d\u8003\u7528\u306e LLM \u304c\u5fc5\u8981\u3067\u3059\u3002\n',
    whichLlm: '\u3069\u306e LLM \u3092\u4f7f\u3044\u307e\u3059\u304b\uff1f',
    validatingApiKey: '  API key \u3092\u691c\u8a3c\u4e2d... ',
    connected: '\u2713 \u63a5\u7d9a\u6e08\u307f',
    failedUseAnyway: '\u2717 \u691c\u8a3c\u5931\u6557\uff08\u305d\u306e\u307e\u307e\u4f7f\u7528\u3057\u307e\u3059\uff09',
    enterApiKey: '  ANTHROPIC_API_KEY \u3092\u5165\u529b\uff1a',
    validating: '  \u691c\u8a3c\u4e2d... ',
    failedCheckLater: '\u2717 \u5931\u6557 \u2014 \u5f8c\u3067 key \u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044',
    addKeyNote: '  \u6ce8\u610f: ANTHROPIC_API_KEY \u3092 shell profile \u306b\u8ffd\u52a0\u3057\u3066\u6c38\u7d9a\u5316\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
    cliReady: '  \u2713 Claude CLI \u6e96\u5099\u5b8c\u4e86',
    cliNotFound: '  \u2717 Claude CLI \u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093',
    askBaseUrl: '  Base URL\uff08\u4f8b: http://localhost:8000\uff09\uff1a',
    checkingEndpoint: '  \u30a8\u30f3\u30c9\u30dd\u30a4\u30f3\u30c8\u3092\u78ba\u8a8d\u4e2d... ',
    modelsAvailable: (n: number) => `\u2713 \u63a5\u7d9a\u6e08\u307f\uff08${n} \u30e2\u30c7\u30eb\u5229\u7528\u53ef\u80fd\uff09`,
    available: '  \u5229\u7528\u53ef\u80fd\uff1a',
    askModelId: '  \u30e2\u30c7\u30eb ID',
    endpointUnreachable: '\u2717 \u30a8\u30f3\u30c9\u30dd\u30a4\u30f3\u30c8\u306b\u63a5\u7d9a\u3067\u304d\u307e\u305b\u3093 \u2014 asurada.yaml \u3067 baseUrl \u3092\u8a2d\u5b9a\u3057\u3066\u304f\u3060\u3055\u3044',
    mouthIntro: '\n\u901a\u77e5 \u2014 Agent \u304b\u3089\u3069\u3046\u9023\u7d61\u3057\u307e\u3059\u304b\uff1f\n',
    notificationMethod: '\u901a\u77e5\u65b9\u6cd5\uff1f',
    telegramBotToken: '  Telegram bot token\uff1a',
    telegramChatId: '  Telegram chat ID\uff1a',
    perceptionIntro: '\n\u77e5\u899a \u2014 Agent \u306f\u4f55\u3092\u76e3\u8996\u3057\u307e\u3059\u304b\uff1f\n',
    selectPerception: '\u77e5\u899a\u30bd\u30fc\u30b9\u3092\u9078\u629e',
    workspaceChanges: '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u306e\u5909\u66f4',
    browserTabs: '\u30d6\u30e9\u30a6\u30b6\u30bf\u30d6',
    gitActivity: 'Git \u30a2\u30af\u30c6\u30a3\u30d3\u30c6\u30a3',
    skipLlm: '\u30b9\u30ad\u30c3\u30d7 \u2014 \u5f8c\u3067\u8a2d\u5b9a\u3059\u308b',
    consoleDashboard: '\u30b3\u30f3\u30bd\u30fc\u30eb\u306e\u307f\uff08dashboard\uff09',
    skip: '\u30b9\u30ad\u30c3\u30d7',
  },
};

function getStrings(lang: WizardLanguage): WizardStrings {
  return STRINGS[lang];
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
    language: 'en',
    notifications: [],
  };

  try {
    // Language selection (first — affects all subsequent prompts)
    console.log('\n--- Language ---\n');
    const langChoice = await choose(
      rl,
      'Choose language / \u9078\u64c7\u8a9e\u8a00 / \u8a00\u8a9e\u3092\u9078\u629e',
      ['English', '\u7e41\u9ad4\u4e2d\u6587', '\u65e5\u672c\u8a9e'],
      0,
    );
    const langMap: WizardLanguage[] = ['en', 'zh-TW', 'ja'];
    result.language = langMap[langChoice];
    const s = getStrings(result.language);

    // Phase C: Name (ask first — sets the tone)
    console.log(s.phaseIdentity);
    const nameInput = await ask(rl, s.askName);
    result.name = nameInput || 'My Assistant';

    const personaInput = await ask(rl, s.askPersona);
    result.persona = personaInput;

    const traitsInput = await ask(rl, s.askTraits);
    if (traitsInput) result.traits = traitsInput;

    // Phase B: Brain
    console.log(s.phaseConnection);
    console.log(s.brainIntro);

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
    brainOptions.push(s.skipLlm);
    brainValues.push('skip');

    const brainChoice = await choose(rl, s.whichLlm, brainOptions, 0);
    const brainValue = brainValues[brainChoice];

    if (brainValue === 'anthropic-api-env') {
      process.stdout.write(s.validatingApiKey);
      const validated = await withRetry(
        async () => validateAnthropicKey(process.env.ANTHROPIC_API_KEY!),
        rl, 'API key validation',
      );
      console.log(validated ? s.connected : s.failedUseAnyway);
      result.runner = 'anthropic-api';
    } else if (brainValue === 'anthropic-api-manual') {
      const key = await ask(rl, s.enterApiKey);
      if (key) {
        process.stdout.write(s.validating);
        const validated = await withRetry(
          async () => validateAnthropicKey(key),
          rl, 'API key validation',
        );
        console.log(validated ? s.connected : s.failedCheckLater);
        process.env.ANTHROPIC_API_KEY = key;
        result.runner = 'anthropic-api';
        console.log(s.addKeyNote);
      }
    } else if (brainValue === 'claude-cli') {
      const check = validateClaudeCli();
      console.log(check.ok ? s.cliReady : s.cliNotFound);
      result.runner = 'claude-cli';
    } else if (brainValue === 'openai-compatible') {
      const baseUrl = await ask(rl, s.askBaseUrl);
      if (baseUrl) {
        process.stdout.write(s.checkingEndpoint);
        const check = await withRetry(
          async () => {
            const r = await validateOpenAiEndpoint(baseUrl);
            return r.ok ? r : null;
          },
          rl, 'Endpoint check',
        );
        if (check && typeof check === 'object' && 'models' in check) {
          const models = (check as { models?: string[] }).models ?? [];
          console.log(s.modelsAvailable(models.length));
          if (models.length > 0) {
            console.log(`${s.available}${models.slice(0, 5).join(', ')}${models.length > 5 ? '...' : ''}`);
          }
          const modelInput = await ask(rl, `${s.askModelId} [${models[0] ?? 'default'}]: `);
          result.model = modelInput || models[0] || 'default';
        } else {
          console.log(s.endpointUnreachable);
        }
        result.runner = 'openai-compatible';
        result.baseUrl = baseUrl;
      }
    }
    // skip → no runner set

    // Mouth — notification
    console.log(s.mouthIntro);

    const mouthOptions = ['Telegram', s.consoleDashboard, s.skip];
    const mouthChoice = await choose(rl, s.notificationMethod, mouthOptions, 0);

    if (mouthChoice === 0) {
      // Telegram
      const token = await ask(rl, s.telegramBotToken);
      const chatId = await ask(rl, s.telegramChatId);

      if (token && chatId) {
        process.stdout.write(s.validating);
        const ok = await validateTelegram(token, chatId);
        console.log(ok ? s.connected : s.failedCheckLater);
        result.notifications.push({
          type: 'telegram',
          options: { botToken: token, chatId },
        });
      }
    } else if (mouthChoice === 1) {
      result.notifications.push({ type: 'console' });
    }

    // Perception — what should the agent observe?
    console.log(s.perceptionIntro);
    const perceptionOptions: Array<{ label: string; value: 'workspace' | 'browser-tabs' | 'git-activity' }> = [
      { label: s.workspaceChanges, value: 'workspace' },
    ];
    if (env.chrome.available) {
      perceptionOptions.push({ label: s.browserTabs, value: 'browser-tabs' });
    }
    if (env.git.available) {
      perceptionOptions.push({ label: s.gitActivity, value: 'git-activity' });
    }

    const selected = await chooseMany(
      rl,
      s.selectPerception,
      perceptionOptions.map(o => o.label),
    );
    if (selected.length > 0) {
      result.perceptions = selected.map(i => perceptionOptions[i].value);
    }

    console.log();
    return result;
  } finally {
    rl.close();
  }
}
