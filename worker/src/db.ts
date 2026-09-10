import type {
  Env,
  HeartbeatGapRow,
  HeartbeatPayload,
  HeartbeatSpeedtest,
  IspId,
  IspStatusRow,
  OutageEventRow,
  SpeedtestResultRow,
} from "./types";

export async function getIspStatus(
  db: D1Database,
  ispId: IspId,
): Promise<IspStatusRow | null> {
  return db
    .prepare("SELECT * FROM isp_status WHERE isp_id = ?")
    .bind(ispId)
    .first<IspStatusRow>();
}

export async function listIspStatuses(db: D1Database): Promise<IspStatusRow[]> {
  const result = await db
    .prepare("SELECT * FROM isp_status ORDER BY isp_id ASC")
    .all<IspStatusRow>();
  return result.results ?? [];
}

export async function nonceExists(db: D1Database, nonce: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT nonce FROM probe_nonces WHERE nonce = ?")
    .bind(nonce)
    .first();
  return row !== null;
}

export async function storeNonce(
  db: D1Database,
  ispId: IspId,
  nonce: string,
  createdAt: string,
): Promise<void> {
  await db
    .prepare("INSERT INTO probe_nonces (nonce, isp_id, created_at) VALUES (?, ?, ?)")
    .bind(nonce, ispId, createdAt)
    .run();
}

export async function cleanupOldNonces(db: D1Database, olderThan: string): Promise<void> {
  await db
    .prepare("DELETE FROM probe_nonces WHERE created_at < ?")
    .bind(olderThan)
    .run();
}

export async function updateIspStatus(
  db: D1Database,
  ispId: IspId,
  fields: {
    isUp: boolean;
    lastSeenAt: string;
    lastSuccessAt: string | null;
    publicIpv4: string | null;
    ispName: string | null;
    networkAsn: string | null;
    traceroute: string | null;
    dnsOk: boolean | null;
    httpsOk: boolean | null;
    httpsLatencyMs: number | null;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    presenceFailures: number;
    latestSpeedtestId: number | null;
    updatedAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE isp_status SET
        is_up = ?,
        last_seen_at = ?,
        last_success_at = ?,
        public_ipv4 = ?,
        isp_name = ?,
        network_asn = ?,
        traceroute = ?,
        dns_ok = ?,
        https_ok = ?,
        https_latency_ms = ?,
        consecutive_failures = ?,
        consecutive_successes = ?,
        presence_failures = ?,
        latest_speedtest_id = ?,
        updated_at = ?
      WHERE isp_id = ?`,
    )
    .bind(
      fields.isUp ? 1 : 0,
      fields.lastSeenAt,
      fields.lastSuccessAt,
      fields.publicIpv4,
      fields.ispName,
      fields.networkAsn,
      fields.traceroute,
      fields.dnsOk === null ? null : fields.dnsOk ? 1 : 0,
      fields.httpsOk === null ? null : fields.httpsOk ? 1 : 0,
      fields.httpsLatencyMs,
      fields.consecutiveFailures,
      fields.consecutiveSuccesses,
      fields.presenceFailures,
      fields.latestSpeedtestId,
      fields.updatedAt,
      ispId,
    )
    .run();
}

export async function getOpenOutage(
  db: D1Database,
  ispId: IspId,
): Promise<OutageEventRow | null> {
  return db
    .prepare(
      `SELECT * FROM outage_events
       WHERE isp_id = ? AND ended_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .bind(ispId)
    .first<OutageEventRow>();
}

export async function createOutage(
  db: D1Database,
  ispId: IspId,
  startedAt: string,
  reason: string,
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO outage_events (
        isp_id, started_at, reason, created_at
      ) VALUES (?, ?, ?, ?)`,
    )
    .bind(ispId, startedAt, reason, startedAt)
    .run();
  return Number(result.meta.last_row_id);
}

export async function closeOutage(
  db: D1Database,
  outageId: number,
  endedAt: string,
  durationSeconds: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE outage_events SET
        ended_at = ?,
        duration_seconds = ?
      WHERE id = ?`,
    )
    .bind(endedAt, durationSeconds, outageId)
    .run();
}

export async function markOutageNotified(
  db: D1Database,
  outageId: number,
  type: "down" | "recovery",
  notifiedAt: string,
): Promise<void> {
  const column = type === "down" ? "notified_down_at" : "notified_up_at";
  await db
    .prepare(`UPDATE outage_events SET ${column} = ? WHERE id = ?`)
    .bind(notifiedAt, outageId)
    .run();
}

export async function listOutages(
  db: D1Database,
  ispId: IspId,
  since: string,
): Promise<OutageEventRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM outage_events
       WHERE isp_id = ? AND started_at >= ?
       ORDER BY started_at DESC`,
    )
    .bind(ispId, since)
    .all<OutageEventRow>();
  return result.results ?? [];
}

export async function listSpeedtests(
  db: D1Database,
  ispId: IspId,
  since: string,
  limit?: number,
): Promise<SpeedtestResultRow[]> {
  if (limit !== undefined) {
    const result = await db
      .prepare(
        `SELECT * FROM speedtest_results
         WHERE isp_id = ? AND recorded_at >= ?
         ORDER BY recorded_at DESC
         LIMIT ?`,
      )
      .bind(ispId, since, limit)
      .all<SpeedtestResultRow>();
    return result.results ?? [];
  }

  const result = await db
    .prepare(
      `SELECT * FROM speedtest_results
       WHERE isp_id = ? AND recorded_at >= ?
       ORDER BY recorded_at ASC`,
    )
    .bind(ispId, since)
    .all<SpeedtestResultRow>();
  return result.results ?? [];
}

export async function upsertSpeedtest(
  db: D1Database,
  ispId: IspId,
  speedtest: HeartbeatSpeedtest,
  createdAt: string,
): Promise<number> {
  await db
    .prepare(
      `INSERT INTO speedtest_results (
        isp_id,
        source_result_id,
        recorded_at,
        download_mbps,
        upload_mbps,
        ping_ms,
        jitter_ms,
        packet_loss,
        server_name,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(isp_id, source_result_id) DO UPDATE SET
        recorded_at = excluded.recorded_at,
        download_mbps = excluded.download_mbps,
        upload_mbps = excluded.upload_mbps,
        ping_ms = excluded.ping_ms,
        jitter_ms = excluded.jitter_ms,
        packet_loss = excluded.packet_loss,
        server_name = excluded.server_name,
        created_at = excluded.created_at`,
    )
    .bind(
      ispId,
      speedtest.result_id,
      speedtest.recorded_at,
      speedtest.download_mbps,
      speedtest.upload_mbps,
      speedtest.ping_ms,
      speedtest.jitter_ms,
      speedtest.packet_loss,
      speedtest.server_name,
      createdAt,
    )
    .run();

  const row = await db
    .prepare(
      `SELECT id FROM speedtest_results
       WHERE isp_id = ? AND source_result_id = ?`,
    )
    .bind(ispId, speedtest.result_id)
    .first<{ id: number }>();

  return row?.id ?? 0;
}

export async function storeSpeedtestFromHeartbeat(
  db: D1Database,
  payload: HeartbeatPayload,
  now: string,
): Promise<number | null> {
  if (!payload.speedtest) {
    return null;
  }
  return upsertSpeedtest(db, payload.isp_id, payload.speedtest, now);
}

export async function listPendingNotifications(
  db: D1Database,
): Promise<OutageEventRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM outage_events
       WHERE (ended_at IS NULL AND notified_down_at IS NULL)
          OR (ended_at IS NOT NULL AND notified_up_at IS NULL)
       ORDER BY started_at ASC`,
    )
    .all<OutageEventRow>();
  return result.results ?? [];
}

export async function logNotification(
  db: D1Database,
  entry: {
    ispId: IspId | null;
    outageId: number | null;
    type: "down" | "recovery";
    channel: string;
    success: boolean;
    errorMessage: string | null;
    sentAt: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO notification_log (
        isp_id, outage_id, type, channel, success, error_message, sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.ispId,
      entry.outageId,
      entry.type,
      entry.channel,
      entry.success ? 1 : 0,
      entry.errorMessage,
      entry.sentAt,
    )
    .run();
}

export function checksAreHealthy(checks: HeartbeatPayload["checks"]): boolean {
  return checks.internet && checks.dns && checks.https.ok;
}

function latencyHourBucketAt(recordedAt: string): string {
  return `${recordedAt.slice(0, 13)}:00:00.000Z`;
}

export async function upsertLatencyHourly(
  db: D1Database,
  ispId: IspId,
  recordedAt: string,
  httpsLatencyMs: number,
): Promise<void> {
  const bucketAt = latencyHourBucketAt(recordedAt);
  await db
    .prepare(
      `INSERT INTO latency_hourly (
        isp_id, bucket_at, min_latency_ms, max_latency_ms, sample_count
      ) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(isp_id, bucket_at) DO UPDATE SET
        min_latency_ms = MIN(latency_hourly.min_latency_ms, excluded.min_latency_ms),
        max_latency_ms = MAX(latency_hourly.max_latency_ms, excluded.max_latency_ms),
        sample_count = latency_hourly.sample_count + 1`,
    )
    .bind(ispId, bucketAt, httpsLatencyMs, httpsLatencyMs)
    .run();
}

export async function insertLatencySample(
  db: D1Database,
  ispId: IspId,
  recordedAt: string,
  httpsLatencyMs: number,
  createdAt: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO latency_samples (
        isp_id, recorded_at, https_latency_ms, created_at
      ) VALUES (?, ?, ?, ?)`,
    )
    .bind(ispId, recordedAt, httpsLatencyMs, createdAt)
    .run();
  await upsertLatencyHourly(db, ispId, recordedAt, httpsLatencyMs);
}

export interface LatencyBucketRow {
  bucket_at: string;
  min_latency_ms: number;
  max_latency_ms: number;
  sample_count: number;
}

export interface LatencySampleRow {
  recorded_at: string;
  https_latency_ms: number;
}

export async function listLatencySamples(
  db: D1Database,
  ispId: IspId,
  since: string,
  limit = 2000,
): Promise<LatencySampleRow[]> {
  const result = await db
    .prepare(
      `SELECT recorded_at, https_latency_ms
       FROM latency_samples
       WHERE isp_id = ? AND recorded_at >= ?
       ORDER BY recorded_at ASC
       LIMIT ?`,
    )
    .bind(ispId, since, limit)
    .all<LatencySampleRow>();
  return result.results ?? [];
}

export async function listLatencyBuckets(
  db: D1Database,
  ispId: IspId,
  since: string,
): Promise<LatencyBucketRow[]> {
  const result = await db
    .prepare(
      `SELECT
        bucket_at,
        min_latency_ms,
        max_latency_ms,
        sample_count
      FROM latency_hourly
      WHERE isp_id = ? AND bucket_at >= ?
      ORDER BY bucket_at ASC`,
    )
    .bind(ispId, latencyHourBucketAt(since))
    .all<LatencyBucketRow>();
  return result.results ?? [];
}

export async function cleanupOldLatencySamples(
  db: D1Database,
  olderThan: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM latency_samples WHERE recorded_at < ?")
    .bind(olderThan)
    .run();
}

export async function cleanupOldLatencyHourly(
  db: D1Database,
  olderThan: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM latency_hourly WHERE bucket_at < ?")
    .bind(olderThan)
    .run();
}

export async function getOpenHeartbeatGap(
  db: D1Database,
  ispId: IspId,
): Promise<HeartbeatGapRow | null> {
  return db
    .prepare(
      `SELECT * FROM heartbeat_gaps
       WHERE isp_id = ? AND ended_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .bind(ispId)
    .first<HeartbeatGapRow>();
}

export async function createHeartbeatGap(
  db: D1Database,
  ispId: IspId,
  startedAt: string,
  reason = "heartbeat_missing",
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO heartbeat_gaps (
        isp_id, started_at, reason, created_at
      ) VALUES (?, ?, ?, ?)`,
    )
    .bind(ispId, startedAt, reason, startedAt)
    .run();
  return Number(result.meta.last_row_id);
}

export async function closeHeartbeatGap(
  db: D1Database,
  gapId: number,
  endedAt: string,
  durationSeconds: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE heartbeat_gaps SET
        ended_at = ?,
        duration_seconds = ?
      WHERE id = ?`,
    )
    .bind(endedAt, durationSeconds, gapId)
    .run();
}

export async function openHeartbeatGapIfNeeded(
  db: D1Database,
  ispId: IspId,
  startedAt: string,
  reason = "heartbeat_missing",
): Promise<void> {
  const open = await getOpenHeartbeatGap(db, ispId);
  if (!open) {
    await createHeartbeatGap(db, ispId, startedAt, reason);
  }
}

export async function closeOpenHeartbeatGap(
  db: D1Database,
  ispId: IspId,
  endedAt: string,
): Promise<void> {
  const open = await getOpenHeartbeatGap(db, ispId);
  if (!open) {
    return;
  }

  const durationSeconds = Math.max(
    0,
    Math.floor((Date.parse(endedAt) - Date.parse(open.started_at)) / 1000),
  );
  await closeHeartbeatGap(db, open.id, endedAt, durationSeconds);
}

export async function listHeartbeatGaps(
  db: D1Database,
  ispId: IspId,
  since: string,
): Promise<HeartbeatGapRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM heartbeat_gaps
       WHERE isp_id = ? AND started_at >= ?
       ORDER BY started_at DESC`,
    )
    .bind(ispId, since)
    .all<HeartbeatGapRow>();
  return result.results ?? [];
}

export async function countMissedHeartbeatMinutes(
  db: D1Database,
  ispId: IspId,
  since: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(
        MAX(
          0,
          CAST(
            (strftime('%s', COALESCE(ended_at, datetime('now')))
             - strftime('%s', CASE WHEN started_at < ? THEN ? ELSE started_at END))
            AS INTEGER
          )
        )
      ), 0) AS total_seconds
      FROM heartbeat_gaps
      WHERE isp_id = ? AND started_at >= ?`,
    )
    .bind(since, since, ispId, since)
    .first<{ total_seconds: number }>();

  return Math.floor((row?.total_seconds ?? 0) / 60);
}

export async function cleanupOldHeartbeatGaps(
  db: D1Database,
  olderThan: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM heartbeat_gaps WHERE started_at < ?")
    .bind(olderThan)
    .run();
}

export function failureReason(checks: HeartbeatPayload["checks"]): string {
  const reasons: string[] = [];
  if (!checks.internet) {
    reasons.push("internet");
  }
  if (!checks.dns) {
    reasons.push("dns");
  }
  if (!checks.https.ok) {
    reasons.push("https");
  }
  return reasons.length > 0 ? reasons.join(",") : "checks_failed";
}
