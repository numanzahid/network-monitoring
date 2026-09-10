ALTER TABLE isp_status ADD COLUMN presence_failures INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS heartbeat_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isp_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER,
  reason TEXT NOT NULL DEFAULT 'heartbeat_missing',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_gaps_isp_started
  ON heartbeat_gaps (isp_id, started_at DESC);
