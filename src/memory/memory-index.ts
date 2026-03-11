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
