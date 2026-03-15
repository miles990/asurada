/**
 * ConversationStore — Unified multi-turn conversation abstraction.
 *
 * JSONL-backed conversation storage with consistent message format.
 * Generalizes the conversation model for any message source
 * (user DM, chat room, API, etc.).
 *
 * Each conversation is a daily JSONL file: conversations/YYYY-MM-DD.jsonl
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * A single message in a conversation.
 * Extends the API Message type with source tracking.
 */
export interface ConversationMessage {
  /** Unique message ID (e.g. "2026-03-14-001") */
  id: string;
  /** Who sent this message */
  from: string;
  /** Message text content */
  text: string;
  /** ISO timestamp */
  ts: string;
  /** ID of the message this replies to */
  replyTo?: string;
  /** Mentioned agent/user names */
  mentions?: string[];
  /** Source channel (e.g. "telegram", "api", "chat-room") */
  source?: string;
}

/** Options for querying messages */
export interface ConversationQuery {
  /** Filter by sender */
  from?: string;
  /** Filter by source channel */
  source?: string;
  /** Maximum messages to return (default: 50) */
  limit?: number;
  /** Only messages after this ISO timestamp */
  after?: string;
}

/** Options for ConversationStore */
export interface ConversationStoreOptions {
  /** Delete conversation files older than this many days (0 = keep forever) */
  maxDays?: number;
}

export class ConversationStore {
  private readonly dir: string;
  private readonly maxDays: number;
  private dailyCounter = 0;
  private lastDate = '';
  private lastCleanupDate = '';

  constructor(conversationsDir: string, options?: ConversationStoreOptions) {
    this.dir = conversationsDir;
    this.maxDays = options?.maxDays ?? 0;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /** Append a message to today's conversation log */
  async append(msg: Omit<ConversationMessage, 'id' | 'ts'> & { id?: string; ts?: string }): Promise<ConversationMessage> {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);

    // Auto-generate ID if not provided
    if (dateStr !== this.lastDate) {
      this.dailyCounter = await this.countTodayMessages(dateStr);
      this.lastDate = dateStr;
    }
    this.dailyCounter++;

    const message: ConversationMessage = {
      id: msg.id ?? `${dateStr}-${String(this.dailyCounter).padStart(3, '0')}`,
      from: msg.from,
      text: msg.text,
      ts: msg.ts ?? now.toISOString(),
      replyTo: msg.replyTo,
      mentions: msg.mentions,
      source: msg.source,
    };

    const filePath = this.dailyFile(dateStr);
    await fsp.appendFile(filePath, JSON.stringify(message) + '\n', 'utf-8');

    // Run cleanup at most once per day
    if (this.maxDays > 0 && dateStr !== this.lastCleanupDate) {
      this.lastCleanupDate = dateStr;
      this.cleanup().catch(() => {}); // fire-and-forget
    }

    return message;
  }

  /** Read recent messages (from today + yesterday to handle midnight boundary) */
  async recent(query?: ConversationQuery): Promise<ConversationMessage[]> {
    const limit = query?.limit ?? 50;
    let messages = await this.readDay(this.today());

    // If today's messages are insufficient, also read yesterday's
    if (messages.length < limit) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      const older = await this.readDay(yesterdayStr);
      messages = [...older, ...messages];
    }

    let filtered = messages;
    if (query?.from) filtered = filtered.filter(m => m.from === query.from);
    if (query?.source) filtered = filtered.filter(m => m.source === query.source);
    if (query?.after) filtered = filtered.filter(m => m.ts > query.after!);

    return filtered.slice(-limit);
  }

  /** Read all messages from a specific date */
  async readDay(date: string): Promise<ConversationMessage[]> {
    const filePath = this.dailyFile(date);
    if (!fs.existsSync(filePath)) return [];

    const text = await fsp.readFile(filePath, 'utf-8');
    return text
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line) as ConversationMessage; }
        catch { return null; }
      })
      .filter((m): m is ConversationMessage => m !== null);
  }

  /** Find a message by ID (searches today first, then recent days) */
  async findById(id: string): Promise<ConversationMessage | null> {
    // Extract date from ID format "YYYY-MM-DD-NNN"
    const dateMatch = id.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      const messages = await this.readDay(dateMatch[1]);
      return messages.find(m => m.id === id) ?? null;
    }

    // Fallback: search today
    const today = await this.readDay(this.today());
    return today.find(m => m.id === id) ?? null;
  }

  /** Get the thread of replies for a message */
  async thread(messageId: string): Promise<ConversationMessage[]> {
    const dateMatch = messageId.match(/^(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch?.[1] ?? this.today();
    const messages = await this.readDay(date);

    // Collect the original message and all replies
    const thread: ConversationMessage[] = [];
    const original = messages.find(m => m.id === messageId);
    if (original) thread.push(original);

    for (const msg of messages) {
      if (msg.replyTo === messageId) thread.push(msg);
    }

    return thread;
  }

  /** Delete conversation files older than maxDays */
  async cleanup(): Promise<number> {
    if (this.maxDays <= 0) return 0;
    if (!fs.existsSync(this.dir)) return 0;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.maxDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const files = await fsp.readdir(this.dir);
    let deleted = 0;
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const dateStr = file.replace('.jsonl', '');
      if (dateStr < cutoffStr) {
        await fsp.unlink(path.join(this.dir, file));
        deleted++;
      }
    }
    return deleted;
  }

  /** List available conversation dates */
  async listDates(): Promise<string[]> {
    if (!fs.existsSync(this.dir)) return [];
    const files = await fsp.readdir(this.dir);
    return files
      .filter(f => f.endsWith('.jsonl'))
      .map(f => f.replace('.jsonl', ''))
      .sort()
      .reverse();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private dailyFile(date: string): string {
    return path.join(this.dir, `${date}.jsonl`);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async countTodayMessages(date: string): Promise<number> {
    const filePath = this.dailyFile(date);
    if (!fs.existsSync(filePath)) return 0;
    const text = await fsp.readFile(filePath, 'utf-8');
    return text.split('\n').filter(Boolean).length;
  }
}
