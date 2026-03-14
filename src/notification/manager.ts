/**
 * NotificationManager — 統一通知管理
 *
 * 支援多個 provider 同時運作（例如 Telegram + Discord）。
 * 核心程式碼只呼叫 manager.notify()，不需要知道用的是什麼 provider。
 */

import type { NotificationProvider, NotificationStats, SendOptions } from './types.js';

export class NotificationManager {
  private providers: NotificationProvider[] = [];

  /** 註冊通知 provider */
  register(provider: NotificationProvider): void {
    this.providers.push(provider);
  }

  /** 發送通知到所有已註冊的 provider */
  async notify(message: string, options?: SendOptions): Promise<boolean> {
    if (this.providers.length === 0) return false;
    if (!message.trim()) return false;

    const results = await Promise.allSettled(
      this.providers.map(p => p.send(message, options))
    );

    // Log failed providers for debugging
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        const name = this.providers[i]?.name ?? `provider-${i}`;
        console.warn(`[notification] ${name} failed: ${(r.reason as Error)?.message ?? r.reason}`);
      }
    }

    // 至少有一個成功就算成功
    return results.some(
      r => r.status === 'fulfilled' && r.value === true
    );
  }

  /** 聚合所有 provider 的統計 */
  getStats(): NotificationStats {
    return this.providers.reduce(
      (acc, p) => {
        const s = p.getStats();
        return { sent: acc.sent + s.sent, failed: acc.failed + s.failed };
      },
      { sent: 0, failed: 0 }
    );
  }

  /** 啟動所有 provider */
  async startAll(): Promise<void> {
    await Promise.allSettled(
      this.providers.map(p => p.start?.())
    );
  }

  /** 停止所有 provider */
  async stopAll(): Promise<void> {
    await Promise.allSettled(
      this.providers.map(p => p.stop?.())
    );
  }

  /** 已註冊的 provider 名稱列表 */
  get providerNames(): string[] {
    return this.providers.map(p => p.name);
  }
}
