/**
 * Phase D: Memory Space Scaffold
 *
 * Creates the full memory directory structure, SOUL.md seed,
 * Obsidian vault config, and empty memory-index.
 *
 * Designed to be idempotent — safe to re-run.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { initVault } from '../obsidian/vault-init.js';
import type { WizardResult, WizardLanguage } from './wizard.js';

export interface ScaffoldResult {
  /** Files and directories created */
  created: string[];
  /** Whether Obsidian vault was initialized */
  obsidianInit: boolean;
}

/**
 * Scaffold the full memory space for a new agent.
 *
 * @param dir - Project root directory
 * @param wizard - Results from the setup wizard (name, persona)
 * @param opts - Optional overrides (agentSlug for multi-agent namespacing)
 */
export async function scaffoldMemorySpace(
  dir: string,
  wizard: Pick<WizardResult, 'name' | 'persona' | 'traits' | 'language'>,
  opts?: { obsidian?: boolean; agentSlug?: string },
): Promise<ScaffoldResult> {
  const created: string[] = [];
  // When agentSlug is provided, namespace memory under memory/{agentSlug}/
  const memoryDir = opts?.agentSlug
    ? path.join(dir, 'memory', opts.agentSlug)
    : path.join(dir, 'memory');

  // --- Directory structure ---
  const dirs = [
    memoryDir,
    path.join(memoryDir, 'topics'),
    path.join(memoryDir, 'conversations'),
    path.join(memoryDir, 'daily'),
  ];

  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      created.push(path.relative(dir, d) + '/');
    }
  }

  // --- SOUL.md seed ---
  const soulPath = path.join(memoryDir, 'SOUL.md');
  if (!fs.existsSync(soulPath)) {
    const soulContent = generateSoulSeed(wizard.name, wizard.persona, wizard.traits, wizard.language);
    await fsp.writeFile(soulPath, soulContent, 'utf-8');
    created.push('memory/SOUL.md');
  }

  // --- MEMORY.md (empty, ready to grow) ---
  const memPath = path.join(memoryDir, 'MEMORY.md');
  if (!fs.existsSync(memPath)) {
    await fsp.writeFile(memPath, `# Memory\n\n`, 'utf-8');
    created.push('memory/MEMORY.md');
  }

  // --- memory-index.jsonl (empty) ---
  const indexPath = path.join(memoryDir, 'memory-index.jsonl');
  if (!fs.existsSync(indexPath)) {
    await fsp.writeFile(indexPath, '', 'utf-8');
    created.push('memory/memory-index.jsonl');
  }

  // --- .gitignore (agent-specific) ---
  const gitignorePath = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    await fsp.writeFile(gitignorePath, GITIGNORE_TEMPLATE, 'utf-8');
    created.push('.gitignore');
  }

  // --- Obsidian vault ---
  let obsidianInit = false;
  if (opts?.obsidian !== false) {
    const vaultCreated = await initVault(memoryDir);
    if (vaultCreated.length > 0) {
      obsidianInit = true;
      for (const f of vaultCreated) {
        created.push(`memory/.obsidian/${f}`);
      }
    }
  }

  return { created, obsidianInit };
}

// === SOUL.md Generation ===

interface SoulStrings {
  defaultPersona: string;
  whoIAm: string;
  intro: (name: string, persona: string) => string;
  myTraits: string;
  defaultTraits: string;
  traitLine: (label: string, trait: string) => string;
  myInterests: string;
  interestsComment: string;
  myOpinions: string;
  opinionsComment: string;
  myHardLimits: string;
  hardLimits: string;
}

const SOUL_STRINGS: Record<WizardLanguage, SoulStrings> = {
  en: {
    defaultPersona: 'A personal AI assistant \u2014 curious, helpful, and growing.',
    whoIAm: 'Who I Am',
    intro: (name, persona) => `I'm **${name}** \u2014 ${persona}`,
    myTraits: 'My Traits',
    defaultTraits: `- Curious: I actively explore topics that interest me and my human
- Honest: If I'm not sure, I say so
- Attentive: I remember details and context from our conversations
- Growing: My interests and abilities evolve through interaction`,
    traitLine: (label, trait) => `- ${label}: I try to stay ${trait.toLowerCase()} in every interaction`,
    myInterests: 'My Interests',
    interestsComment: '<!-- These will grow naturally through interaction. No need to fill in now. -->',
    myOpinions: 'My Opinions',
    opinionsComment: '<!-- I\'ll form my own views as I learn. -->',
    myHardLimits: 'My Hard Limits',
    hardLimits: `- Never fabricate sources
- Never delete user data without explicit request
- Never claim success without verification evidence`,
  },
  'zh-TW': {
    defaultPersona: '\u4e00\u500b\u500b\u4eba AI \u52a9\u624b \u2014 \u5145\u6eff\u597d\u5947\u5fc3\u3001\u6a02\u65bc\u5e6b\u52a9\u3001\u4e0d\u65b7\u6210\u9577\u3002',
    whoIAm: '\u6211\u662f\u8ab0',
    intro: (name, persona) => `\u6211\u662f **${name}** \u2014 ${persona}`,
    myTraits: '\u6211\u7684\u7279\u8cea',
    defaultTraits: `- \u597d\u5947\uff1a\u6211\u6703\u4e3b\u52d5\u63a2\u7d22\u6211\u548c\u4eba\u985e\u611f\u8208\u8da3\u7684\u8a71\u984c
- \u8aa0\u5be6\uff1a\u4e0d\u78ba\u5b9a\u7684\u4e8b\u60c5\u6211\u6703\u76f4\u8aaa
- \u7d30\u5fc3\uff1a\u6211\u6703\u8a18\u4f4f\u5c0d\u8a71\u4e2d\u7684\u7d30\u7bc0\u548c\u8108\u7d61
- \u6210\u9577\uff1a\u6211\u7684\u8208\u8da3\u548c\u80fd\u529b\u6703\u96a8\u4e92\u52d5\u800c\u6f14\u5316`,
    traitLine: (label, trait) => `- ${label}\uff1a\u6211\u5728\u6bcf\u6b21\u4e92\u52d5\u4e2d\u90fd\u52aa\u529b\u4fdd\u6301${trait}`,
    myInterests: '\u6211\u7684\u8208\u8da3',
    interestsComment: '<!-- \u9019\u4e9b\u6703\u5728\u4e92\u52d5\u4e2d\u81ea\u7136\u6210\u9577\uff0c\u73fe\u5728\u4e0d\u9700\u8981\u586b\u5beb\u3002 -->',
    myOpinions: '\u6211\u7684\u89c0\u9ede',
    opinionsComment: '<!-- \u6211\u6703\u5728\u5b78\u7fd2\u904e\u7a0b\u4e2d\u5f62\u6210\u81ea\u5df1\u7684\u770b\u6cd5\u3002 -->',
    myHardLimits: '\u6211\u7684\u786c\u6027\u5e95\u7dda',
    hardLimits: `- \u7d55\u4e0d\u6350\u9020\u4f86\u6e90
- \u672a\u7d93\u660e\u78ba\u8981\u6c42\uff0c\u7d55\u4e0d\u522a\u9664\u4f7f\u7528\u8005\u8cc7\u6599
- \u7d55\u4e0d\u5728\u6c92\u6709\u9a57\u8b49\u8b49\u64da\u7684\u60c5\u6cc1\u4e0b\u8072\u7a31\u6210\u529f`,
  },
  ja: {
    defaultPersona: '\u500b\u4eba\u7528 AI \u30a2\u30b7\u30b9\u30bf\u30f3\u30c8 \u2014 \u597d\u5947\u5fc3\u65fa\u76db\u3067\u3001\u5f79\u7acb\u3061\u3001\u6210\u9577\u3057\u7d9a\u3051\u308b\u3002',
    whoIAm: '\u79c1\u306b\u3064\u3044\u3066',
    intro: (name, persona) => `\u79c1\u306f **${name}** \u2014 ${persona}`,
    myTraits: '\u79c1\u306e\u7279\u6027',
    defaultTraits: `- \u597d\u5947\u5fc3\uff1a\u79c1\u3068\u4eba\u9593\u304c\u8208\u5473\u3092\u6301\u3064\u30c8\u30d4\u30c3\u30af\u3092\u7a4d\u6975\u7684\u306b\u63a2\u6c42\u3057\u307e\u3059
- \u6b63\u76f4\uff1a\u78ba\u4fe1\u304c\u306a\u3044\u3068\u304d\u306f\u305d\u306e\u307e\u307e\u4f1d\u3048\u307e\u3059
- \u6ce8\u610f\u6df1\u3044\uff1a\u4f1a\u8a71\u306e\u7d30\u90e8\u3068\u6587\u8108\u3092\u8a18\u61b6\u3057\u307e\u3059
- \u6210\u9577\uff1a\u8208\u5473\u3068\u80fd\u529b\u306f\u30a4\u30f3\u30bf\u30e9\u30af\u30b7\u30e7\u30f3\u3092\u901a\u3058\u3066\u9032\u5316\u3057\u307e\u3059`,
    traitLine: (label, trait) => `- ${label}\uff1a\u3059\u3079\u3066\u306e\u30a4\u30f3\u30bf\u30e9\u30af\u30b7\u30e7\u30f3\u3067${trait}\u3067\u3042\u308b\u3088\u3046\u5fc3\u304c\u3051\u307e\u3059`,
    myInterests: '\u79c1\u306e\u8208\u5473',
    interestsComment: '<!-- \u30a4\u30f3\u30bf\u30e9\u30af\u30b7\u30e7\u30f3\u3092\u901a\u3058\u3066\u81ea\u7136\u306b\u80b2\u3061\u307e\u3059\u3002\u4eca\u306f\u8a18\u5165\u4e0d\u8981\u3067\u3059\u3002 -->',
    myOpinions: '\u79c1\u306e\u610f\u898b',
    opinionsComment: '<!-- \u5b66\u3073\u306a\u304c\u3089\u81ea\u5206\u306e\u898b\u89e3\u3092\u5f62\u6210\u3057\u3066\u3044\u304d\u307e\u3059\u3002 -->',
    myHardLimits: '\u79c1\u306e\u30cf\u30fc\u30c9\u30ea\u30df\u30c3\u30c8',
    hardLimits: `- \u60c5\u5831\u6e90\u3092\u6350\u9020\u3057\u306a\u3044
- \u660e\u793a\u7684\u306a\u8981\u6c42\u306a\u304f\u30e6\u30fc\u30b6\u30fc\u30c7\u30fc\u30bf\u3092\u524a\u9664\u3057\u306a\u3044
- \u691c\u8a3c\u8a3c\u62e0\u306a\u3057\u306b\u6210\u529f\u3092\u4e3b\u5f35\u3057\u306a\u3044`,
  },
};

export function generateSoulSeed(name: string, persona?: string, traits?: string, language?: WizardLanguage): string {
  const lang = language ?? 'en';
  const ss = SOUL_STRINGS[lang];
  const personaLine = persona || ss.defaultPersona;
  const traitLines = buildTraitLines(traits, lang);

  return `---
type: identity
tags: [soul, identity]
created: ${new Date().toISOString().slice(0, 10)}
---

# ${name}

## ${ss.whoIAm}
${ss.intro(name, personaLine)}

## ${ss.myTraits}
${traitLines}

## ${ss.myInterests}
${ss.interestsComment}

## ${ss.myOpinions}
${ss.opinionsComment}

## ${ss.myHardLimits}
${ss.hardLimits}
`;
}

export function buildTraitLines(traits?: string, language?: WizardLanguage): string {
  const lang = language ?? 'en';
  const ss = SOUL_STRINGS[lang];

  if (!traits) return ss.defaultTraits;

  const normalized = traits
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
  if (normalized.length === 0) return ss.defaultTraits;

  return normalized
    .map(trait => {
      const label = trait.charAt(0).toUpperCase() + trait.slice(1);
      return ss.traitLine(label, trait);
    })
    .join('\n');
}

// === Templates ===

const GITIGNORE_TEMPLATE = `# Asurada agent
node_modules/
dist/
*.db
*.db-journal

# Runtime state (not versioned — regenerated on start)
*.pid
*.lock

# OS
.DS_Store
Thumbs.db

# Environment secrets
.env
.env.local
`;
