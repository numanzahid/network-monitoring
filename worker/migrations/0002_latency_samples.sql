CREATE TABLE IF NOT EXISTS latency_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isp_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  https_latency_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_latency_samples_isp_recorded
  ON latency_samples (isp_id, recorded_at DESC);
