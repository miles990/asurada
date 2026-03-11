/**
 * MemoryIndex — Unified Relational Cognitive Graph
 *
 * Append-only JSONL with same-id-last-wins semantics.
 * At personal scale (<10K entries), reading the whole file is fast enough.
 *
 * Design:
 * - Write: always append (never edit lines)
 * - Read: scan all lines, later entries with same ID win
 * - Graph: refs[] form directed edges between entries
 * - Obsidian: generate [[wikilinks]] from refs for graph view
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  IndexEntry,
  IndexQuery,
  GraphEdge,
  ResolvedIndex,
  CognitiveType,
} from './index-types.js';

/** Stop words for relevance matching (shared with MemorySearch) */
const RELEVANCE_STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'was',
  'one', 'our', 'out', 'is', 'it', 'in', 'to', 'of', 'on', 'at', 'an', 'or',
  'if', 'no', 'so', 'do', 'my', 'up', 'this', 'that', 'with', 'from', 'have',
]);

/** Generate a short unique ID (12 chars, URL-safe) */
function generateId(): string {
  return randomBytes(9).toString('base64url');
}

export class MemoryIndex {
  private readonly filePath: string;
  private cache: ResolvedIndex | null = null;

  constructor(indexFilePath: string) {
    this.filePath = indexFilePath;

    // Ensure parent directory exists
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // ---------------------------------------------------------------------------
  // Write operations (append-only)
  // ---------------------------------------------------------------------------

  /** Create a new entry. Returns the generated ID. */
  async create(
    type: CognitiveType,
    content: string,
    options?: Partial<Pick<IndexEntry, 'id' | 'refs' | 'tags' | 'source' | 'status' | 'meta'>>,
  ): Promise<string> {
    const id = options?.id ?? generateId();
    const entry: IndexEntry = {
      id,
      type,
      content,
      createdAt: new Date().toISOString(),
      ...(options?.refs && { refs: options.refs }),
      ...(options?.tags && { tags: options.tags }),
      ...(options?.source && { source: options.source }),
      ...(options?.status && { status: options.status }),
      ...(options?.meta && { meta: options.meta }),
    };

    await this.appendLine(entry);
    this.invalidateCache();
    return id;
  }

  /** Update an existing entry (same-id-last-wins: appends new version). */
  async update(id: string, changes: Partial<Omit<IndexEntry, 'id'>>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Entry not found: ${id}`);

    const updated: IndexEntry = {
      ...existing,
      ...changes,
      id, // preserve original ID
      createdAt: new Date().toISOString(),
    };

    await this.appendLine(updated);
    this.invalidateCache();
  }

  /** Add a reference from one entry to another. */
  async addRef(fromId: string, toId: string): Promise<void> {
    const entry = await this.get(fromId);
    if (!entry) throw new Error(`Entry not found: ${fromId}`);

    const refs = entry.refs ? [...new Set([...entry.refs, toId])] : [toId];
    await this.update(fromId, { refs });
  }

  // ---------------------------------------------------------------------------
  // Read operations
  // ---------------------------------------------------------------------------

  /** Get a single entry by ID (resolved: latest version wins). */
  async get(id: string): Promise<IndexEntry | null> {
    const index = await this.resolve();
    return index.get(id) ?? null;
  }

  /** Query entries with filters. */
  async query(q: IndexQuery = {}): Promise<IndexEntry[]> {
    const index = await this.resolve();
    let results = Array.from(index.values());

    // Filter by type
    if (q.type) {
      const types = Array.isArray(q.type) ? q.type : [q.type];
      results = results.filter(e => types.includes(e.type));
    }

    // Filter by tags (any match)
    if (q.tags?.length) {
      results = results.filter(e =>
        e.tags?.some(t => q.tags!.includes(t)),
      );
    }

    // Filter by status
    if (q.status) {
      results = results.filter(e => e.status === q.status);
    }

    // Filter: entries that reference a specific ID
    if (q.references) {
      results = results.filter(e => e.refs?.includes(q.references!));
    }

    // Filter: entries referenced by a specific ID
    if (q.referencedBy) {
      const refEntry = index.get(q.referencedBy);
      if (refEntry?.refs) {
        const refSet = new Set(refEntry.refs);
        results = results.filter(e => refSet.has(e.id));
      } else {
        results = [];
      }
    }

    // Sort by creation time (newest first)
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // Apply limit
    if (q.limit && q.limit > 0) {
      results = results.slice(0, q.limit);
    }

    return results;
  }

  /** Get all entries (resolved). */
  async all(): Promise<IndexEntry[]> {
    const index = await this.resolve();
    return Array.from(index.values());
  }

  /** Count entries by type. */
  async stats(): Promise<Record<string, number>> {
    const index = await this.resolve();
    const counts: Record<string, number> = { total: index.size };
    for (const entry of index.values()) {
      counts[entry.type] = (counts[entry.type] ?? 0) + 1;
    }
    return counts;
  }

  // ---------------------------------------------------------------------------
  // Graph operations
  // ---------------------------------------------------------------------------

  /** Get all edges in the cognitive graph. */
  async edges(): Promise<GraphEdge[]> {
    const index = await this.resolve();
    const edges: GraphEdge[] = [];
    for (const entry of index.values()) {
      if (entry.refs) {
        for (const ref of entry.refs) {
          if (index.has(ref)) { // only include valid refs
            edges.push({ from: entry.id, to: ref });
          }
        }
      }
    }
    return edges;
  }

  /** Get entries connected to a specific entry (both directions). */
  async neighbors(id: string): Promise<IndexEntry[]> {
    const index = await this.resolve();
    const entry = index.get(id);
    if (!entry) return [];

    const neighborIds = new Set<string>();

    // Outgoing refs
    if (entry.refs) {
      for (const ref of entry.refs) neighborIds.add(ref);
    }

    // Incoming refs (entries that reference this one)
    for (const e of index.values()) {
      if (e.refs?.includes(id)) neighborIds.add(e.id);
    }

    neighborIds.delete(id); // don't include self
    return Array.from(neighborIds)
      .map(nid => index.get(nid))
      .filter((e): e is IndexEntry => e !== undefined);
  }

  // ---------------------------------------------------------------------------
  // Obsidian integration
  // ---------------------------------------------------------------------------

  /** Generate Obsidian-compatible [[wikilinks]] for an entry's refs. */
  async toWikilinks(id: string): Promise<string[]> {
    const entry = await this.get(id);
    if (!entry?.refs) return [];

    const index = await this.resolve();
    return entry.refs
      .map(refId => {
        const ref = index.get(refId);
        if (!ref) return null;
        // Use first 50 chars of content as display text
        const display = ref.content.slice(0, 50).replace(/[[\]|]/g, '');
        return `[[${refId}|${display}]]`;
      })
      .filter((l): l is string => l !== null);
  }

  // ---------------------------------------------------------------------------
  // Relevance queries (Phase 6: Memory Index Context Boosting)
  // ---------------------------------------------------------------------------

  /**
   * Find entries relevant to a query string.
   * Matches against content, tags, and refs. Multi-token queries use OR logic.
   * Direction-change entries that reference topic X also boost topic Y (cross-topic linking).
   */
  async findRelevant(
    query: string,
    options?: { limit?: number; types?: CognitiveType[] },
  ): Promise<IndexEntry[]> {
    const index = await this.resolve();
    const limit = options?.limit ?? 10;

    // Tokenize query: split on whitespace + common delimiters, lowercase, filter noise
    const tokens = query
      .toLowerCase()
      .split(/[\s,;:./\-_]+/)
      .filter(t => t.length > 1)
      .filter(t => !RELEVANCE_STOP_WORDS.has(t));

    if (tokens.length === 0) return [];

    const scored: Array<{ entry: IndexEntry; score: number }> = [];

    for (const entry of index.values()) {
      // Filter by types if specified
      if (options?.types && !options.types.includes(entry.type)) continue;

      let score = 0;
      const contentLower = entry.content.toLowerCase();

      for (const token of tokens) {
        // Content match (strongest signal)
        if (contentLower.includes(token)) score += 3;
        // Tag match
        if (entry.tags?.some(t => t.toLowerCase().includes(token))) score += 5;
        // Ref match (entry references something with this name)
        if (entry.refs?.some(r => r.toLowerCase().includes(token))) score += 2;
        // Source match
        if (entry.source?.toLowerCase().includes(token)) score += 1;
      }

      if (score > 0) {
        // Recency boost: entries from last 7 days get +2
        const age = Date.now() - new Date(entry.createdAt).getTime();
        if (age < 7 * 24 * 60 * 60 * 1000) score += 2;

        scored.push({ entry, score });
      }
    }

    // Sort by score descending, then by recency
    scored.sort((a, b) =>
      b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt),
    );

    return scored.slice(0, limit).map(s => s.entry);
  }

  /**
   * Find topic names relevant to a query, using memory-index entries as bridge.
   * Combines direct tag/ref matching with cross-topic linking via direction-change entries.
   *
   * Returns topic names sorted by relevance score.
   */
  async getRelevantTopics(query: string, limit = 3): Promise<string[]> {
    const entries = await this.findRelevant(query, { limit: 20 });
    const topicScores = new Map<string, number>();

    for (const entry of entries) {
      // Extract topic names from tags
      if (entry.tags) {
        for (const tag of entry.tags) {
          topicScores.set(tag, (topicScores.get(tag) ?? 0) + 3);
        }
      }

      // Extract topic names from refs (e.g. "topic:agent-architecture")
      if (entry.refs) {
        for (const ref of entry.refs) {
          const topicMatch = ref.match(/^topic:(.+)/);
          if (topicMatch) {
            topicScores.set(topicMatch[1], (topicScores.get(topicMatch[1]) ?? 0) + 4);
          }
        }
      }

      // Direction-change entries boost ALL referenced topics (cross-topic linking)
      if (entry.type === 'direction-change' && entry.refs) {
        for (const ref of entry.refs) {
          const topicMatch = ref.match(/^topic:(.+)/);
          if (topicMatch) {
            topicScores.set(topicMatch[1], (topicScores.get(topicMatch[1]) ?? 0) + 2);
          }
        }
      }

      // Source file as implicit topic
      if (entry.source) {
        const topicFromSource = entry.source.replace(/\.md$/, '');
        topicScores.set(topicFromSource, (topicScores.get(topicFromSource) ?? 0) + 1);
      }
    }

    return Array.from(topicScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([topic]) => topic);
  }

  /**
   * Get direction-change entries related to given topics.
   * Used by ContextBuilder to inject strategy audit trails alongside topic content.
   */
  async getDirectionChanges(topicNames: string[], limit = 5): Promise<IndexEntry[]> {
    const index = await this.resolve();
    const results: IndexEntry[] = [];

    const topicSet = new Set(topicNames.map(t => t.toLowerCase()));

    for (const entry of index.values()) {
      if (entry.type !== 'direction-change') continue;

      // Match by tags
      const tagMatch = entry.tags?.some(t => topicSet.has(t.toLowerCase()));
      // Match by refs (topic:xxx format)
      const refMatch = entry.refs?.some(r => {
        const m = r.match(/^topic:(.+)/);
        return m && topicSet.has(m[1].toLowerCase());
      });
      // Match by content mention
      const contentMatch = topicNames.some(t =>
        entry.content.toLowerCase().includes(t.toLowerCase()),
      );

      if (tagMatch || refMatch || contentMatch) {
        results.push(entry);
      }
    }

    // Most recent first
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return results.slice(0, limit);
  }

  /** Generate a Markdown summary of an entry for Obsidian vault. */
  async toMarkdown(id: string): Promise<string | null> {
    const entry = await this.get(id);
    if (!entry) return null;

    const lines: string[] = [];

    // YAML frontmatter
    lines.push('---');
    lines.push(`id: ${entry.id}`);
    lines.push(`type: ${entry.type}`);
    lines.push(`created: ${entry.createdAt}`);
    if (entry.tags?.length) lines.push(`tags: [${entry.tags.join(', ')}]`);
    if (entry.status) lines.push(`status: ${entry.status}`);
    if (entry.source) lines.push(`source: ${entry.source}`);
    if (entry.refs?.length) {
      const index = await this.resolve();
      const related = entry.refs
        .map(r => index.get(r))
        .filter((e): e is IndexEntry => e !== undefined)
        .map(e => `[[${e.id}|${e.content.slice(0, 40).replace(/[[\]|]/g, '')}]]`);
      if (related.length) lines.push(`related: ${related.join(', ')}`);
    }
    lines.push('---');
    lines.push('');

    // Content
    lines.push(entry.content);

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Internal: JSONL file operations
  // ---------------------------------------------------------------------------

  /** Read entire JSONL, apply same-id-last-wins, return resolved map. */
  private async resolve(): Promise<ResolvedIndex> {
    if (this.cache) return this.cache;

    const map: ResolvedIndex = new Map();

    if (!fs.existsSync(this.filePath)) {
      this.cache = map;
      return map;
    }

    const content = await fsp.readFile(this.filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as IndexEntry;
        // Same-id-last-wins: later line overwrites earlier
        map.set(entry.id, entry);
      } catch {
        // Skip malformed lines — resilient to corruption
      }
    }

    this.cache = map;
    return map;
  }

  /** Append a single entry as a JSON line. */
  private async appendLine(entry: IndexEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    await fsp.appendFile(this.filePath, line, 'utf-8');
  }

  /** Invalidate the in-memory cache (after writes). */
  private invalidateCache(): void {
    this.cache = null;
  }
}
