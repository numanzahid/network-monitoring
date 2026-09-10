CREATE TABLE IF NOT EXISTS latency_hourly (
  isp_id TEXT NOT NULL,
  bucket_at TEXT NOT NULL,
  min_latency_ms INTEGER NOT NULL,
  max_latency_ms INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  PRIMARY KEY (isp_id, bucket_at)
);

CREATE INDEX IF NOT EXISTS idx_latency_hourly_isp_bucket
  ON latency_hourly (isp_id, bucket_at);

INSERT INTO latency_hourly (isp_id, bucket_at, min_latency_ms, max_latency_ms, sample_count)
SELECT
  isp_id,
  substr(recorded_at, 1, 13) || ':00:00.000Z' AS bucket_at,
  MIN(https_latency_ms) AS min_latency_ms,
  MAX(https_latency_ms) AS max_latency_ms,
  COUNT(*) AS sample_count
FROM latency_samples
GROUP BY isp_id, substr(recorded_at, 1, 13);
