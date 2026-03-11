/**
 * Generic action tag parser.
 *
 * Parses XML-namespaced tags from LLM responses.
 * e.g. <agent:remember topic="tech">insight here</agent:remember>
 *   → { tag: 'remember', content: 'insight here', attrs: { topic: 'tech' } }
 *
 * Also handles self-closing: <agent:schedule next="5m" reason="..." />
 */

import type { ParsedAction } from './types.js';

/**
 * Parse all namespaced action tags from a response string.
 *
 * @param response - Raw LLM response text
 * @param namespace - Tag namespace (e.g. 'kuro', 'agent')
 * @returns Array of parsed actions
 */
export function parseActions(response: string, namespace: string): ParsedAction[] {
  const actions: ParsedAction[] = [];
  const ns = escapeRegex(namespace);

  // Match opening+closing tags: <ns:tag attrs>content</ns:tag>
  const pairRegex = new RegExp(
    `<${ns}:(\\w[\\w-]*)([^>]*)>([\\s\\S]*?)<\\/${ns}:\\1>`,
    'g',
  );

  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(response)) !== null) {
    actions.push({
      tag: match[1],
      attrs: parseAttrs(match[2]),
      content: match[3].trim(),
    });
  }

  // Match self-closing tags: <ns:tag attrs />
  const selfRegex = new RegExp(
    `<${ns}:(\\w[\\w-]*)([^>]*?)\\s*\\/>`,
    'g',
  );

  while ((match = selfRegex.exec(response)) !== null) {
    // Skip if already matched as part of a pair tag
    const tag = match[1];
    const existing = actions.find(
      a => a.tag === tag && response.indexOf(`<${namespace}:${tag}`) === match!.index,
    );
    if (!existing) {
      actions.push({
        tag: match[1],
        attrs: parseAttrs(match[2]),
        content: '',
      });
    }
  }

  return actions;
}

/**
 * Parse HTML-style attributes from a string.
 * e.g. ' topic="tech" url="https://example.com"' → { topic: 'tech', url: 'https://example.com' }
 */
function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /(\w[\w-]*)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(raw)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parse a duration string to milliseconds. Supports: 30s, 5m, 2h, "now" (=30s) */
export function parseDuration(str: string): number | null {
  if (str === 'now') return 30_000;

  const match = str.match(/^(\d+(?:\.\d+)?)\s*(s|m|h)$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  switch (match[2]) {
    case 's': return Math.round(value * 1_000);
    case 'm': return Math.round(value * 60_000);
    case 'h': return Math.round(value * 3_600_000);
    default: return null;
  }
}
