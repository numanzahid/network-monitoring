export type IspId = "isp1" | "isp2";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  NOTIFY_ENABLED: string;
  NOTIFIER_CHANNELS: string;
  FAILURE_THRESHOLD: string;
  SUCCESS_THRESHOLD: string;
  PROBE_INTERVAL_SECONDS: string;
  HEARTBEAT_MAX_AGE_SECONDS: string;
  HEARTBEAT_STALE_SECONDS: string;
  ISP1_LABEL: string;
  ISP2_LABEL: string;
  STATUS_PAGE_URL: string;
  NTFY_SERVER: string;
  NTFY_TOPIC: string;
  NTFY_PRIORITY_DOWN: string;
  NTFY_PRIORITY_UP: string;
  PROBE_SECRET_ISP1: string;
  PROBE_SECRET_ISP2: string;
  NTFY_AUTH_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  DISCORD_WEBHOOK_URL?: string;
}

export interface HeartbeatChecks {
  internet: boolean;
  dns: boolean;
  https: {
    ok: boolean;
    latency_ms: number | null;
  };
  public_ipv4: string | null;
  isp_name?: string | null;
  network_asn?: string | null;
  traceroute?: string[] | null;
}

export interface HeartbeatSpeedtest {
  result_id: number;
  recorded_at: string;
  download_mbps: number | null;
  upload_mbps: number | null;
  ping_ms: number | null;
  jitter_ms: number | null;
  packet_loss: number | null;
  server_name: string | null;
}

export interface HeartbeatPayload {
  isp_id: IspId;
  ts: string;
  nonce: string;
  checks: HeartbeatChecks;
  speedtest?: HeartbeatSpeedtest | null;
}

export interface IspStatusRow {
  isp_id: string;
  is_up: number;
  last_seen_at: string;
  last_success_at: string | null;
  public_ipv4: string | null;
  isp_name: string | null;
  network_asn: string | null;
  traceroute: string | null;
  dns_ok: number | null;
  https_ok: number | null;
  https_latency_ms: number | null;
  consecutive_failures: number;
  consecutive_successes: number;
  latest_speedtest_id: number | null;
  updated_at: string;
}

export interface OutageEventRow {
  id: number;
  isp_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  reason: string | null;
  notified_down_at: string | null;
  notified_up_at: string | null;
  created_at: string;
}

export interface SpeedtestResultRow {
  id: number;
  isp_id: string;
  source_result_id: number;
  recorded_at: string;
  download_mbps: number | null;
  upload_mbps: number | null;
  ping_ms: number | null;
  jitter_ms: number | null;
  packet_loss: number | null;
  server_name: string | null;
  created_at: string;
}

export type NotificationType = "down" | "recovery";

export interface NotificationPayload {
  title: string;
  body: string;
  type: NotificationType;
  priority?: "min" | "low" | "default" | "high" | "urgent";
  tags?: string[];
}
