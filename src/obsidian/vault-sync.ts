/**
 * VaultSync — Sync MemoryIndex to Obsidian vault.
 *
 * Generates .md files with frontmatter + [[wikilinks]] from MemoryIndex entries.
 * Users open Obsidian → see their agent's cognitive graph → browse, search, edit.
 *
 * Design:
 * - One-way sync: MemoryIndex → vault .md files (index is source of truth)
 * - Existing topic files get frontmatter injected (not overwritten)
 * - Index entries get dedicated pages in pagesSubdir
 * - JSONL conversations get daily .md summaries
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { IndexEntry } from '../memory/index-types.js';
import type { VaultSyncOptions } from './types.js';
import { parseFrontmatter, setFrontmatter, mergeFrontmatter } from './frontmatter.js';
import type { Frontmatter } from './types.js';

export class VaultSync {
  private readonly vaultDir: string;
  private readonly indexPath: string;
  private readonly pagesDir: string;
  private readonly conversationsDir: string;
  private readonly generateSummaries: boolean;

  constructor(options: VaultSyncOptions) {
    this.vaultDir = options.vaultDir;
    this.indexPath = options.indexPath;
    this.pagesDir = path.join(options.vaultDir, options.pagesSubdir ?? 'index-pages');
    this.conversationsDir = path.join(
      options.vaultDir,
      options.conversationsSubdir ?? 'conversations',
    );
    this.generateSummaries = options.generateDailySummaries !== false;
  }

  /**
   * Full sync: read MemoryIndex, generate/update all vault files.
   * Safe to call repeatedly — idempotent, only writes when content changes.
   */
  async sync(): Promise<SyncResult> {
    const result: SyncResult = { pagesWritten: 0, topicsUpdated: 0, summariesGenerated: 0 };

    // Ensure directories exist
    await fsp.mkdir(this.pagesDir, { recursive: true });

    // Read and resolve index
    const entries = await this.readIndex();
    const entryMap = new Map(entries.map(e => [e.id, e]));

    // Generate index entry pages
    for (const entry of entries) {
      const written = await this.syncEntryPage(entry, entryMap);
      if (written) result.pagesWritten++;
    }

    // Update existing topic files with frontmatter
    const topicsDir = path.join(this.vaultDir, 'topics');
    if (fs.existsSync(topicsDir)) {
      const topicFiles = (await fsp.readdir(topicsDir)).filter(f => f.endsWith('.md'));
      for (const file of topicFiles) {
        const updated = await this.enrichTopicFile(path.join(topicsDir, file), entries);
        if (updated) result.topicsUpdated++;
      }
    }

    // Generate conversation summaries
    if (this.generateSummaries) {
      result.summariesGenerated = await this.syncConversationSummaries();
    }

    return result;
  }

  /**
   * Generate/update a single entry's .md page.
   * Returns true if the file was written (content changed).
   */
  private async syncEntryPage(
    entry: IndexEntry,
    allEntries: Map<string, IndexEntry>,
  ): Promise<boolean> {
    const filePath = path.join(this.pagesDir, `${entry.id}.md`);

    // Build frontmatter
    const fm: Frontmatter = {
      id: entry.id,
      type: entry.type,
      created: entry.createdAt,
    };
    if (entry.tags?.length) fm.tags = entry.tags;
    if (entry.status) fm.status = entry.status;
    if (entry.source) fm.source = entry.source;

    // Build related wikilinks from refs
    if (entry.refs?.length) {
      fm.related = entry.refs
        .map(refId => {
          const ref = allEntries.get(refId);
          if (!ref) return null;
          const label = ref.content.slice(0, 40).replace(/[[\]|#^]/g, '');
          return `[[${refId}|${label}]]`;
        })
        .filter((l): l is string => l !== null);
    }

    // Build body
    const body = entry.content;

    // Build incoming refs section
    const incomingRefs = Array.from(allEntries.values())
      .filter(e => e.refs?.includes(entry.id))
      .map(e => {
        const label = e.content.slice(0, 50).replace(/[[\]|#^]/g, '');
        return `- [[${e.id}|${label}]]`;
      });

    let content = '';
    content += body;
    if (incomingRefs.length) {
      content += '\n\n## Referenced By\n\n' + incomingRefs.join('\n');
    }

    const fullContent = setFrontmatter(content, fm);

    // Only write if changed
    if (fs.existsSync(filePath)) {
      const existing = await fsp.readFile(filePath, 'utf-8');
      if (existing === fullContent) return false;
    }

    await fsp.writeFile(filePath, fullContent, 'utf-8');
    return true;
  }

  /**
   * Enrich an existing topic file with frontmatter.
   * Preserves user content, only adds/merges frontmatter fields.
   */
  private async enrichTopicFile(filePath: string, entries: IndexEntry[]): Promise<boolean> {
    const content = await fsp.readFile(filePath, 'utf-8');
    const topicName = path.basename(filePath, '.md');

    // Find entries that reference this topic (by tag)
    const relatedEntries = entries.filter(
      e => e.tags?.includes(topicName),
    );

    const updates: Frontmatter = {};

    // Auto-detect tags from filename
    updates.tags = [topicName];

    // Build related links from entries that tag this topic
    if (relatedEntries.length) {
      updates.related = relatedEntries.slice(0, 20).map(e => {
        const label = e.content.slice(0, 40).replace(/[[\]|#^]/g, '');
        return `[[${e.id}|${label}]]`;
      });
    }

    const parsed = parseFrontmatter(content);
    if (parsed) {
      // Merge into existing frontmatter
      const merged = mergeFrontmatter(parsed.data, updates);
      const newContent = setFrontmatter(content, merged);
      if (newContent === content) return false;
      await fsp.writeFile(filePath, newContent, 'utf-8');
      return true;
    }

    // No frontmatter yet — add it
    const newContent = setFrontmatter(content, updates);
    await fsp.writeFile(filePath, newContent, 'utf-8');
    return true;
  }

  /**
   * Generate daily .md summaries from JSONL conversation logs.
   * Each JSONL line is expected to have: { from, text, timestamp, id? }
   */
  private async syncConversationSummaries(): Promise<number> {
    const conversationsSource = path.join(this.vaultDir, 'conversations');
    if (!fs.existsSync(conversationsSource)) return 0;

    await fsp.mkdir(this.conversationsDir, { recursive: true });

    const jsonlFiles = (await fsp.readdir(conversationsSource))
      .filter(f => f.endsWith('.jsonl'));

    let generated = 0;

    for (const file of jsonlFiles) {
      const date = file.replace('.jsonl', '');
      const summaryPath = path.join(this.conversationsDir, `${date}.md`);

      // Skip if summary already exists and is newer than JSONL
      const jsonlPath = path.join(conversationsSource, file);
      if (fs.existsSync(summaryPath)) {
        const jsonlStat = await fsp.stat(jsonlPath);
        const summStat = await fsp.stat(summaryPath);
        if (summStat.mtimeMs >= jsonlStat.mtimeMs) continue;
      }

      // Parse JSONL
      const raw = await fsp.readFile(jsonlPath, 'utf-8');
      const messages = raw
        .split('\n')
        .filter(l => l.trim())
        .map(l => {
          try { return JSON.parse(l) as ConversationMessage; }
          catch { return null; }
        })
        .filter((m): m is ConversationMessage => m !== null);

      if (messages.length === 0) continue;

      // Generate markdown summary
      const fm: Frontmatter = {
        type: 'conversation',
        created: date,
        tags: ['conversation', 'daily'],
      };

      // Count participants
      const participants = [...new Set(messages.map(m => m.from))];

      let body = `# ${date} Conversations\n\n`;
      body += `**${messages.length} messages** from ${participants.join(', ')}\n\n`;
      body += '---\n\n';

      for (const msg of messages) {
        const time = msg.timestamp
          ? new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false })
          : '';
        const prefix = time ? `**${time}**` : '';
        const sender = `**${msg.from}**`;
        const text = msg.text.length > 300
          ? msg.text.slice(0, 300) + '...'
          : msg.text;
        const replyTag = msg.replyTo ? ` (reply to ${msg.replyTo})` : '';

        body += `${prefix} ${sender}${replyTag}: ${text}\n\n`;
      }

      const fullContent = setFrontmatter(body, fm);
      await fsp.writeFile(summaryPath, fullContent, 'utf-8');
      generated++;
    }

    return generated;
  }

  /** Read and resolve MemoryIndex JSONL (same-id-last-wins). */
  private async readIndex(): Promise<IndexEntry[]> {
    if (!fs.existsSync(this.indexPath)) return [];

    const content = await fsp.readFile(this.indexPath, 'utf-8');
    const map = new Map<string, IndexEntry>();

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as IndexEntry;
        map.set(entry.id, entry);
      } catch {
        // Skip malformed
      }
    }

    return Array.from(map.values());
  }
}

/** Sync result statistics. */
export interface SyncResult {
  pagesWritten: number;
  topicsUpdated: number;
  summariesGenerated: number;
}

/** Minimal conversation message shape. */
interface ConversationMessage {
  from: string;
  text: string;
  timestamp?: string;
  id?: string;
  replyTo?: string;
}
