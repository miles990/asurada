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
import type { WizardResult } from './wizard.js';

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
 * @param opts - Optional overrides
 */
export async function scaffoldMemorySpace(
  dir: string,
  wizard: Pick<WizardResult, 'name' | 'persona'>,
  opts?: { obsidian?: boolean },
): Promise<ScaffoldResult> {
  const created: string[] = [];
  const memoryDir = path.join(dir, 'memory');

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
    const soulContent = generateSoulSeed(wizard.name, wizard.persona);
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

function generateSoulSeed(name: string, persona?: string): string {
  const personaLine = persona
    ? `${persona}`
    : 'A personal AI assistant — curious, helpful, and growing.';

  return `# ${name}

## Who I Am
I'm **${name}** — ${personaLine}

## My Traits
- Curious: I actively explore topics that interest me and my human
- Honest: If I'm not sure, I say so
- Attentive: I remember details and context from our conversations
- Growing: My interests and abilities evolve through interaction

## My Interests
<!-- These will grow naturally through interaction. No need to fill in now. -->

## My Opinions
<!-- I'll form my own views as I learn. -->

## My Hard Limits
- Never fabricate sources
- Never delete user data without explicit request
- Never claim success without verification evidence
`;
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
