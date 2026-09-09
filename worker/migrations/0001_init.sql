CREATE TABLE IF NOT EXISTS isp_status (
  isp_id TEXT PRIMARY KEY,
  is_up INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  last_success_at TEXT,
  public_ipv4 TEXT,
  dns_ok INTEGER,
  https_ok INTEGER,
  https_latency_ms INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0,
  latest_speedtest_id INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isp_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER,
  reason TEXT,
  notified_down_at TEXT,
  notified_up_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outage_events_isp_started
  ON outage_events (isp_id, started_at DESC);

CREATE TABLE IF NOT EXISTS speedtest_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isp_id TEXT NOT NULL,
  source_result_id INTEGER NOT NULL,
  recorded_at TEXT NOT NULL,
  download_mbps REAL,
  upload_mbps REAL,
  ping_ms REAL,
  jitter_ms REAL,
  packet_loss REAL,
  server_name TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (isp_id, source_result_id)
);

CREATE INDEX IF NOT EXISTS idx_speedtest_results_isp_recorded
  ON speedtest_results (isp_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS probe_nonces (
  nonce TEXT PRIMARY KEY,
  isp_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_probe_nonces_created
  ON probe_nonces (created_at);

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isp_id TEXT,
  outage_id INTEGER,
  type TEXT NOT NULL,
  channel TEXT NOT NULL,
  success INTEGER NOT NULL,
  error_message TEXT,
  sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_log_sent
  ON notification_log (sent_at DESC);

INSERT OR IGNORE INTO isp_status (
  isp_id,
  is_up,
  last_seen_at,
  consecutive_failures,
  consecutive_successes,
  updated_at
) VALUES
  ('isp1', 1, '1970-01-01T00:00:00.000Z', 0, 0, '1970-01-01T00:00:00.000Z'),
  ('isp2', 1, '1970-01-01T00:00:00.000Z', 0, 0, '1970-01-01T00:00:00.000Z');
