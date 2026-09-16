export type IspId = "isp1" | "isp2";

export interface Env {
  ISP_STATE: DurableObjectNamespace;
  ASSETS: Fetcher;
  NOTIFY_ENABLED: string;
  NOTIFIER_CHANNELS: string;
  NOTIFY_AFTER_MISSED_BEATS: string;
  PROBE_INTERVAL_SECONDS: string;
  HEARTBEAT_MAX_AGE_SECONDS: string;
  ISP1_LABEL: string;
  ISP2_LABEL: string;
  STATUS_PAGE_URL: string;
  NTFY_SERVER: string;
  NTFY_TOPIC?: string;
  NTFY_AUTH_TOKEN?: string;
  NTFY_PRIORITY_DOWN: string;
  NTFY_PRIORITY_UP: string;
  PROBE_SECRET_ISP1: string;
  PROBE_SECRET_ISP2: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  DISCORD_WEBHOOK_URL?: string;
}

export interface HeartbeatMetadata {
  public_ipv4: string | null;
  isp_name: string | null;
  network_asn: string | null;
  traceroute: string[] | null;
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

export interface CompactHeartbeat {
  v: 2;
  isp_id: IspId;
  boot_id: string;
  seq: number;
  ts: string;
  f: number;
  l: number | null;
  m?: HeartbeatMetadata | null;
  s?: HeartbeatSpeedtest | null;
}

export interface PresenceNotification {
  id: string;
  type: "down" | "up";
  started_at: string;
  ended_at?: string;
  reason?: string;
}

export interface PresenceState {
  isp_id: IspId;
  boot_id: string | null;
  last_seq: number;
  last_beat_probe_at: string | null;
  last_beat_recv_at: string | null;
  flags: number | null;
  latency_ms: number | null;
  metadata: HeartbeatMetadata | null;
  latest_speedtest: HeartbeatSpeedtest | null;
  presence_state: "unknown" | "up" | "down";
  health_state: "unknown" | "healthy" | "degraded";
  missed_beats: number;
  outage_started_at: string | null;
  transition_number: number;
  pending_notification: PresenceNotification | null;
  last_notification_id: string | null;
}
