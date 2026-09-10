import { getHeartbeatStaleSeconds, getIspLabel } from "../config";
import {
  countMissedHeartbeatMinutes,
  getOpenHeartbeatGap,
  getOpenOutage,
  listIspStatuses,
  listSpeedtests,
} from "../db";
import type { Env, IspId, IspStatusRow } from "../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function buildIspSummary(env: Env, status: IspStatusRow) {
  const ispId = status.isp_id as IspId;
  const openOutage = await getOpenOutage(env.DB, ispId);
  const openGap = await getOpenHeartbeatGap(env.DB, ispId);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const speedtests = await listSpeedtests(env.DB, ispId, since.toISOString(), 1);
  const latestSpeedtest = speedtests[0] ?? null;

  const lastSeenMs = Date.parse(status.last_seen_at);
  const heartbeatAgeSeconds = Number.isFinite(lastSeenMs)
    ? Math.max(0, Math.floor((Date.now() - lastSeenMs) / 1000))
    : null;
  const staleSeconds = getHeartbeatStaleSeconds(env);
  const isHeartbeatStale = heartbeatAgeSeconds !== null && heartbeatAgeSeconds >= staleSeconds;

  const missedSince = new Date();
  missedSince.setUTCDate(missedSince.getUTCDate() - 1);
  let missedHeartbeatMinutes = await countMissedHeartbeatMinutes(
    env.DB,
    ispId,
    missedSince.toISOString(),
  );

  if (
    isHeartbeatStale &&
    !openGap &&
    heartbeatAgeSeconds !== null &&
    Number.isFinite(lastSeenMs)
  ) {
    const silentSinceMs = Math.max(lastSeenMs + staleSeconds * 1000, missedSince.getTime());
    const ongoingSeconds = Math.max(0, Math.floor((Date.now() - silentSinceMs) / 1000));
    missedHeartbeatMinutes += Math.floor(ongoingSeconds / 60);
  }

  const isUp = status.is_up === 1;
  const displayState = !isUp ? "down" : isHeartbeatStale ? "stale" : "up";

  return {
    isp_id: ispId,
    label: getIspLabel(env, ispId),
    is_up: isUp,
    display_state: displayState,
    last_seen_at: status.last_seen_at,
    last_success_at: status.last_success_at,
    public_ipv4: status.public_ipv4,
    isp_name: status.isp_name,
    network_asn: status.network_asn,
    traceroute: status.traceroute
      ? status.traceroute.split("\n").filter(Boolean)
      : null,
    checks: {
      dns_ok: status.dns_ok === null ? null : status.dns_ok === 1,
      https_ok: status.https_ok === null ? null : status.https_ok === 1,
      https_latency_ms: status.https_latency_ms,
    },
    consecutive_failures: status.consecutive_failures,
    consecutive_successes: status.consecutive_successes,
    presence_failures: status.presence_failures ?? 0,
    heartbeat_age_seconds: heartbeatAgeSeconds,
    heartbeat_stale: isHeartbeatStale,
    missed_heartbeat_minutes_24h: missedHeartbeatMinutes,
    open_heartbeat_gap: openGap
      ? {
          id: openGap.id,
          started_at: openGap.started_at,
          reason: openGap.reason,
        }
      : null,
    ongoing_outage: openOutage
      ? {
          id: openOutage.id,
          started_at: openOutage.started_at,
          reason: openOutage.reason,
        }
      : null,
    latest_speedtest: latestSpeedtest
      ? {
          recorded_at: latestSpeedtest.recorded_at,
          download_mbps: latestSpeedtest.download_mbps,
          upload_mbps: latestSpeedtest.upload_mbps,
          ping_ms: latestSpeedtest.ping_ms,
          server_name: latestSpeedtest.server_name,
        }
      : null,
  };
}

export async function handleStatus(env: Env): Promise<Response> {
  const statuses = await listIspStatuses(env.DB);
  const isps = await Promise.all(statuses.map((status) => buildIspSummary(env, status)));

  return jsonResponse({
    generated_at: new Date().toISOString(),
    status_page_url: env.STATUS_PAGE_URL,
    isps,
  });
}
