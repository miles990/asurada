/**
 * VaultInit — Initialize .obsidian/ directory with minimal config.
 *
 * Creates the bare minimum for a good Obsidian experience:
 * - Graph view filter (exclude noise)
 * - CSS snippet for agent-related styling
 * - App config (no spellcheck, show frontmatter)
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Initialize .obsidian/ config in the vault directory.
 * Safe to call multiple times — skips files that already exist.
 */
export async function initVault(vaultDir: string): Promise<string[]> {
  const obsidianDir = path.join(vaultDir, '.obsidian');
  const snippetsDir = path.join(obsidianDir, 'snippets');
  const created: string[] = [];

  await fsp.mkdir(snippetsDir, { recursive: true });

  // --- app.json: basic settings ---
  const appPath = path.join(obsidianDir, 'app.json');
  if (!fs.existsSync(appPath)) {
    await fsp.writeFile(appPath, JSON.stringify({
      showFrontmatter: true,
      spellcheck: false,
      readableLineLength: true,
      strictLineBreaks: false,
    }, null, 2), 'utf-8');
    created.push('app.json');
  }

  // --- graph.json: graph view config ---
  const graphPath = path.join(obsidianDir, 'graph.json');
  if (!fs.existsSync(graphPath)) {
    await fsp.writeFile(graphPath, JSON.stringify({
      collapse_filter: false,
      search: '',
      showTags: true,
      showAttachments: false,
      showOrphans: false,
      collapse_color_groups: false,
      colorGroups: [
        { query: 'tag:#remember', color: { a: 1, r: 100, g: 200, b: 100 } },
        { query: 'tag:#learning', color: { a: 1, r: 100, g: 150, b: 255 } },
        { query: 'tag:#commitment', color: { a: 1, r: 255, g: 150, b: 100 } },
        { query: 'tag:#thread', color: { a: 1, r: 200, g: 100, b: 200 } },
        { query: 'tag:#conversation', color: { a: 1, r: 150, g: 150, b: 150 } },
      ],
      collapse_display: false,
      showArrow: true,
      textFadeMultiplier: 0,
      nodeSizeMultiplier: 1,
      lineSizeMultiplier: 1,
      collapse_forces: true,
      centerStrength: 0.5,
      repelStrength: 10,
      linkStrength: 1,
      linkDistance: 250,
    }, null, 2), 'utf-8');
    created.push('graph.json');
  }

  // --- CSS snippet: agent styling ---
  const cssPath = path.join(snippetsDir, 'asurada-agent.css');
  if (!fs.existsSync(cssPath)) {
    await fsp.writeFile(cssPath, AGENT_CSS, 'utf-8');
    created.push('snippets/asurada-agent.css');
  }

  // --- Enable the CSS snippet ---
  const appearancePath = path.join(obsidianDir, 'appearance.json');
  if (!fs.existsSync(appearancePath)) {
    await fsp.writeFile(appearancePath, JSON.stringify({
      enabledCssSnippets: ['asurada-agent'],
    }, null, 2), 'utf-8');
    created.push('appearance.json');
  }

  return created;
}

const AGENT_CSS = `/* Asurada Agent — Obsidian styling */

/* Frontmatter type badges */
.frontmatter-container .frontmatter-section:has([data-key="type"]) .frontmatter-value {
  font-weight: bold;
  color: var(--text-accent);
}

/* Tag styling in body */
.tag[href*="remember"] { color: #64c864; }
.tag[href*="learning"] { color: #6496ff; }
.tag[href*="commitment"] { color: #ff9664; }
.tag[href*="thread"] { color: #c864c8; }

/* Conversation messages */
.markdown-preview-view strong:first-child {
  color: var(--text-accent);
}
`;
