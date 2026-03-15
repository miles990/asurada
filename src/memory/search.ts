/**
 * MemorySearch — FTS5 Full-Text Search for Memory
 *
 * Uses better-sqlite3 + FTS5 for BM25-ranked full-text search.
 * Falls back to grep when FTS5 is unavailable.
 *
 * Battle-tested patterns from mini-agent:
 * - unicode61 tokenizer for CJK character-level tokenization
 * - Stop words filtering for English
 * - Graceful degradation (FTS5 → grep fallback)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import type { MemoryEntry, SearchResult, MemoryConfig } from './types.js';

// Dynamic import: better-sqlite3 is an optional dependency (native addon).
// Falls back to grep-only search when unavailable.
let BetterSqlite3: any;
try {
  const require = createRequire(import.meta.url);
  BetterSqlite3 = require('better-sqlite3');
} catch {
  // better-sqlite3 not installed — FTS5 search disabled, grep fallback active
}

export const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'was',
  'one', 'our', 'out', 'is', 'it', 'in', 'to', 'of', 'on', 'at', 'an', 'or',
  'if', 'no', 'so', 'do', 'my', 'up', 'this', 'that', 'with', 'from', 'have',
  'been', 'will', 'into', 'more', 'when', 'some', 'them', 'than', 'its', 'also',
  'each', 'which', 'their', 'what', 'about', 'would', 'there', 'could', 'other',
  'just', 'then',
]);

export class MemorySearch {
  private db: any = null;
  private readonly dbPath: string;
  private readonly memoryDir: string;
  private readonly topicsDir: string;
  private readonly mainFile: string;

  constructor(config: MemoryConfig) {
    this.dbPath = config.dbPath;
    this.memoryDir = config.memoryDir;
    this.topicsDir = path.join(config.memoryDir, config.topicsSubdir ?? 'topics');
    this.mainFile = config.mainFile ?? 'MEMORY.md';
  }

  /** Initialize FTS5 database (no-op if better-sqlite3 not installed) */
  init(): void {
    if (!BetterSqlite3) return;

    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      this.db = new BetterSqlite3(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
          source,
          date,
          content,
          tokenize="unicode61"
        );
      `);
    } catch {
      this.db = null;
    }
  }

  /** Index all memory files (topics + main memory) */
  indexAll(): number {
    if (!this.db) return 0;

    try {
      // Clear existing index
      this.db.exec('DELETE FROM memory_fts');

      const entries: Array<{ source: string; date: string; content: string }> = [];

      // Parse topic files
      if (fs.existsSync(this.topicsDir)) {
        const files = fs.readdirSync(this.topicsDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const filePath = path.join(this.topicsDir, file);
          entries.push(...this.parseMarkdownEntries(filePath, file));
        }
      }

      // Parse main memory file
      const mainPath = path.join(this.memoryDir, this.mainFile);
      if (fs.existsSync(mainPath)) {
        entries.push(...this.parseMarkdownEntries(mainPath, this.mainFile));
      }

      // Bulk insert
      const insert = this.db.prepare('INSERT INTO memory_fts (source, date, content) VALUES (?, ?, ?)');
      const insertAll = this.db.transaction((items: typeof entries) => {
        for (const e of items) insert.run(e.source, e.date, e.content);
      });
      insertAll(entries);

      return entries.length;
    } catch {
      return 0;
    }
  }

  /** Search memory entries using FTS5 with BM25 ranking */
  search(query: string, limit = 10): SearchResult[] {
    // Try FTS5 first
    const ftsResults = this.searchFTS(query, limit);
    if (ftsResults.length > 0) return ftsResults;

    // Fallback to grep
    return this.searchGrep(query, limit);
  }

  /** Check if the search index is ready */
  get ready(): boolean {
    if (!this.db) return false;
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS count FROM memory_fts').get() as { count: number };
      return row.count > 0;
    } catch {
      return false;
    }
  }

  /** Whether FTS5 (better-sqlite3) is available */
  get ftsAvailable(): boolean {
    return this.db !== null;
  }

  /** Rebuild the entire index from scratch */
  rebuild(): number {
    if (!this.db) {
      this.init();
    }
    return this.indexAll();
  }

  /** Close the database connection */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  private searchFTS(query: string, limit: number): SearchResult[] {
    if (!this.db) return [];

    try {
      // Clean query: remove stop words, add wildcards for partial matching
      const terms = query
        .split(/\s+/)
        .filter(t => t.length > 1 && !STOP_WORDS.has(t.toLowerCase()))
        .map(t => `"${t}"*`);

      if (terms.length === 0) return [];
      const ftsQuery = terms.join(' OR ');

      const rows = this.db.prepare(`
        SELECT source, date, content, rank
        FROM memory_fts
        WHERE memory_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, limit) as SearchResult[];

      return rows;
    } catch {
      return [];
    }
  }

  private searchGrep(query: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];

    try {
      const output = execFileSync('grep', ['-ri', '--include=*.md', '-l', query, this.memoryDir], {
        encoding: 'utf-8',
        timeout: 5000,
      });

      const files = output.trim().split('\n').filter(Boolean).slice(0, limit);
      for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.toLowerCase().includes(query.toLowerCase()));
        for (const line of lines.slice(0, 3)) {
          results.push({
            source: path.basename(filePath),
            date: '',
            content: line.replace(/^- (\[\d{4}-\d{2}-\d{2}\] )?/, ''),
            rank: 0,
          });
        }
      }
    } catch {
      // grep found nothing or failed — that's fine
    }

    return results.slice(0, limit);
  }

  /** Parse markdown file into memory entries */
  private parseMarkdownEntries(
    filePath: string,
    source: string,
  ): Array<{ source: string; date: string; content: string }> {
    const entries: Array<{ source: string; date: string; content: string }> = [];

    try {
      const text = fs.readFileSync(filePath, 'utf-8');
      const lines = text.split('\n');
      const datedRegex = /^- \[(\d{4}-\d{2}-\d{2})\] (.+)/;
      const bulletRegex = /^- (.+)/;

      let current: { source: string; date: string; content: string } | null = null;

      for (const line of lines) {
        if (line.startsWith('#') || line.startsWith('---')) {
          if (current) { entries.push(current); current = null; }
          continue;
        }

        const datedMatch = line.match(datedRegex);
        if (datedMatch) {
          if (current) entries.push(current);
          current = { source, date: datedMatch[1], content: datedMatch[2] };
          continue;
        }

        const bulletMatch = line.match(bulletRegex);
        if (bulletMatch && !line.startsWith('- **')) {
          if (current) entries.push(current);
          current = { source, date: '', content: bulletMatch[1] };
          continue;
        }

        if (line.startsWith('- **') && current) {
          current.content += ' ' + line.replace(/^- /, '').trim();
          continue;
        }

        if (current && line.trim() && !line.startsWith('#')) {
          current.content += ' ' + line.trim();
        } else if (line.trim() === '' && current) {
          entries.push(current);
          current = null;
        }
      }

      if (current) entries.push(current);
    } catch {
      // Skip unreadable files
    }

    return entries;
  }
}
