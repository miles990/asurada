/**
 * ConsoleProvider — 最簡單的通知 provider，輸出到 stdout
 *
 * 用途：開發除錯、沒有配置任何通知管道時的 fallback。
 */

import type { NotificationProvider, NotificationStats, SendOptions } from '../types.js';

export class ConsoleProvider implements NotificationProvider {
  readonly name = 'console';
  private sent = 0;

  async send(message: string, _options?: SendOptions): Promise<boolean> {
    console.log(`[asurada] ${message}`);
    this.sent++;
    return true;
  }

  getStats(): NotificationStats {
    return { sent: this.sent, failed: 0 };
  }
}
