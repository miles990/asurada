/**
 * Notification — Asurada 通知抽象層
 *
 * Agent 需要一個「嘴巴」跟使用者說話。具體用什麼管道（Telegram/Discord/Slack/email）
 * 是個人化配置，核心只關心 interface。
 */

export interface NotificationProvider {
  /** Provider 名稱（用於日誌和 UI 顯示） */
  readonly name: string;

  /** 發送通知。回傳是否成功 */
  send(message: string, options?: SendOptions): Promise<boolean>;

  /** 取得累計統計 */
  getStats(): NotificationStats;

  /** 啟動 provider（建立連線、驗證 token 等） */
  start?(): Promise<void>;

  /** 停止 provider（清理資源） */
  stop?(): Promise<void>;
}

export interface SendOptions {
  /** 回覆特定訊息（provider-specific ID） */
  replyTo?: string | number;
  /** 通知層級 — provider 可據此決定是否靜音、格式等 */
  tier?: NotificationTier;
}

export type NotificationTier = 'critical' | 'normal' | 'low';

export interface NotificationStats {
  sent: number;
  failed: number;
}
