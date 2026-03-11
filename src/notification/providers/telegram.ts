/**
 * TelegramProvider — Telegram Bot API notification provider
 *
 * Sends notifications via Telegram bot. Handles:
 * - Message splitting for long content (>4096 chars)
 * - Markdown formatting with plain-text fallback
 * - Retry on failure (1 retry, downgrade to plain text)
 * - Reply threading via replyTo
 */

import type { NotificationProvider, NotificationStats, SendOptions } from '../types.js';

const TELEGRAM_API = 'https://api.telegram.org';
const MAX_MESSAGE_LENGTH = 4096;

export interface TelegramProviderConfig {
  botToken: string;
  chatId: string | number;
}

export class TelegramProvider implements NotificationProvider {
  readonly name = 'telegram';
  private botToken: string;
  private chatId: string | number;
  private sent = 0;
  private failed = 0;

  constructor(config: TelegramProviderConfig) {
    this.botToken = config.botToken;
    this.chatId = config.chatId;
  }

  async start(): Promise<void> {
    // Validate token by calling getMe
    const res = await fetch(
      `${TELEGRAM_API}/bot${this.botToken}/getMe`
    );
    if (!res.ok) {
      throw new Error(`Telegram bot token invalid: ${res.status}`);
    }
  }

  async send(message: string, options?: SendOptions): Promise<boolean> {
    if (!message.trim()) return false;

    const chunks = splitMessage(message);
    let allOk = true;

    for (let i = 0; i < chunks.length; i++) {
      // Only first chunk carries reply_to
      const replyId = i === 0 ? options?.replyTo : undefined;
      const ok = await this.sendChunk(chunks[i], replyId);
      if (!ok) allOk = false;
    }

    return allOk;
  }

  getStats(): NotificationStats {
    return { sent: this.sent, failed: this.failed };
  }

  private async sendChunk(
    text: string,
    replyTo?: string | number,
  ): Promise<boolean> {
    // Try with Markdown first
    const result = await this.callSendMessage(text, 'Markdown', replyTo);
    if (result) {
      this.sent++;
      return true;
    }

    // Retry as plain text (Markdown parsing can fail)
    await delay(500);
    const retry = await this.callSendMessage(text, undefined, replyTo);
    if (retry) {
      this.sent++;
      return true;
    }

    this.failed++;
    return false;
  }

  private async callSendMessage(
    text: string,
    parseMode?: string,
    replyTo?: string | number,
  ): Promise<boolean> {
    const body: Record<string, unknown> = {
      chat_id: this.chatId,
      text,
    };
    if (parseMode) body.parse_mode = parseMode;
    if (replyTo) body.reply_to_message_id = replyTo;

    try {
      const res = await fetch(
        `${TELEGRAM_API}/bot${this.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json = await res.json() as { ok: boolean };
      return json.ok === true;
    } catch {
      return false;
    }
  }
}

/** Split message into chunks respecting paragraph boundaries */
function splitMessage(message: string): string[] {
  if (message.length <= MAX_MESSAGE_LENGTH) return [message];

  const paragraphs = message.split(/\n\n+/).filter(p => p.trim());
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (para.length > MAX_MESSAGE_LENGTH) {
      // Oversized paragraph — hard split
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < para.length; i += MAX_MESSAGE_LENGTH) {
        chunks.push(para.slice(i, i + MAX_MESSAGE_LENGTH));
      }
      continue;
    }

    const joined = current ? `${current}\n\n${para}` : para;
    if (joined.length <= MAX_MESSAGE_LENGTH) {
      current = joined;
    } else {
      chunks.push(current);
      current = para;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
