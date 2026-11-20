export type IspId = "isp1" | "isp2";

export interface Env {
  ISP_STATE: DurableObjectNamespace;
  ASSETS: Fetcher;
  DOWN_AFTER_MISSED_BEATS: string;
  PROBE_INTERVAL_SECONDS: string;
  HEARTBEAT_MAX_AGE_SECONDS: string;
  REMOTE_HISTORY_HOURS: string;
  REMOTE_SPEEDTEST_HISTORY_DAYS: string;
  REMOTE_OUTAGE_HISTORY_DAYS: string;
  ISP1_LABEL: string;
  ISP2_LABEL: string;
  PROBE_SECRET_ISP1: string;
  PROBE_SECRET_ISP2: string;
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

export interface HistorySyncState {
  request_id: string;
  heartbeat_since: string;
  speedtest_since: string;
  outage_since: string;
  heartbeat_complete: boolean;
  speedtest_complete: boolean;
  outage_complete: boolean;
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
  history_sync: HistorySyncState | null;
}
