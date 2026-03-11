/**
 * Frontmatter — parse and generate YAML frontmatter for Markdown files.
 *
 * Handles the --- delimited block at the top of .md files.
 * No external YAML library needed — personal-scale frontmatter is simple enough.
 */

import type { Frontmatter } from './types.js';

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?/;

/** Parse YAML frontmatter from markdown content. Returns null if no frontmatter. */
export function parseFrontmatter(content: string): { data: Frontmatter; body: string } | null {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) return null;

  const yamlBlock = match[1];
  const body = content.slice(match[0].length);
  const data: Frontmatter = {};

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    if (!key) continue;

    // Array value: [item1, item2] or [[wikilink1]], [[wikilink2]]
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1);
      data[key] = inner
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    } else {
      data[key] = rawValue;
    }
  }

  return { data, body };
}

/** Generate YAML frontmatter string from a Frontmatter object. */
export function generateFrontmatter(data: Frontmatter): string {
  const lines: string[] = ['---'];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}: [${value.join(', ')}]`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

/** Replace or insert frontmatter in a markdown file's content. */
export function setFrontmatter(content: string, data: Frontmatter): string {
  const parsed = parseFrontmatter(content);
  const newFrontmatter = generateFrontmatter(data);

  if (parsed) {
    // Replace existing frontmatter, keep body
    return newFrontmatter + '\n' + parsed.body;
  }
  // Insert frontmatter before existing content
  return newFrontmatter + '\n\n' + content;
}

/** Merge new frontmatter fields into existing, preserving user-set values. */
export function mergeFrontmatter(existing: Frontmatter, updates: Frontmatter): Frontmatter {
  const merged = { ...existing };

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'related' && Array.isArray(value) && Array.isArray(existing.related)) {
      // Merge related links, deduplicate
      merged.related = [...new Set([...existing.related, ...value])];
    } else if (key === 'tags' && Array.isArray(value) && Array.isArray(existing.tags)) {
      // Merge tags, deduplicate
      merged.tags = [...new Set([...existing.tags, ...value])];
    } else if (existing[key] === undefined) {
      // Only set if not already present (don't overwrite user edits)
      merged[key] = value;
    }
  }

  return merged;
}
