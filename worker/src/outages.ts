import {
  getFailureThreshold,
  getHeartbeatDownSeconds,
  getHeartbeatStaleSeconds,
  getMissingHeartbeatFailureThreshold,
  getSuccessThreshold,
} from "./config";
import {
  checksAreHealthy,
  closeOpenHeartbeatGap,
  closeOutage,
  createOutage,
  failureReason,
  getIspStatus,
  getOpenOutage,
  insertLatencySample,
  openHeartbeatGapIfNeeded,
  storeSpeedtestFromHeartbeat,
  updateIspStatus,
} from "./db";
import { notifyOutageDown, notifyOutageRecovery } from "./notify";
import type { Env, HeartbeatPayload, IspId } from "./types";

interface TransitionResult {
  transitionedToDown: boolean;
  transitionedToUp: boolean;
  outageId: number | null;
}

type FailureKind = "presence" | "health";

function tracerouteToText(lines: string[] | null | undefined): string | null {
  if (!lines || lines.length === 0) {
    return null;
  }
  return lines.join("\n");
}

async function applyStateTransition(
  env: Env,
  ispId: IspId,
  now: string,
  checksHealthy: boolean,
  reason: string,
  failureKind: FailureKind,
  statusFields: {
    lastSeenAt: string;
    publicIpv4: string | null;
    ispName: string | null;
    networkAsn: string | null;
    traceroute: string | null;
    dnsOk: boolean | null;
    httpsOk: boolean | null;
    httpsLatencyMs: number | null;
    latestSpeedtestId: number | null;
  },
): Promise<TransitionResult> {
  const healthFailureThreshold = getFailureThreshold(env);
  const presenceFailureThreshold = getMissingHeartbeatFailureThreshold(env);
  const successThreshold = getSuccessThreshold(env);
  const current = await getIspStatus(env.DB, ispId);

  if (!current) {
    throw new Error(`Missing isp_status row for ${ispId}`);
  }

  const wasUp = current.is_up === 1;
  let consecutiveFailures = current.consecutive_failures;
  let consecutiveSuccesses = current.consecutive_successes;
  let presenceFailures = current.presence_failures ?? 0;
  let isUp = wasUp;
  let transitionedToDown = false;
  let transitionedToUp = false;
  let outageId: number | null = null;

  if (checksHealthy) {
    consecutiveSuccesses += 1;
    consecutiveFailures = 0;
    presenceFailures = 0;
    if (!wasUp && consecutiveSuccesses >= successThreshold) {
      isUp = true;
      transitionedToUp = true;
    }
  } else if (failureKind === "presence") {
    consecutiveSuccesses = 0;
    presenceFailures += 1;
    if (wasUp && presenceFailures >= presenceFailureThreshold) {
      isUp = false;
      transitionedToDown = true;
    }
  } else {
    consecutiveSuccesses = 0;
    consecutiveFailures += 1;
    if (wasUp && consecutiveFailures >= healthFailureThreshold) {
      isUp = false;
      transitionedToDown = true;
    }
  }

  const lastSuccessAt = checksHealthy
    ? now
    : current.last_success_at;

  await updateIspStatus(env.DB, ispId, {
    isUp,
    lastSeenAt: statusFields.lastSeenAt,
    lastSuccessAt,
    publicIpv4: statusFields.publicIpv4,
    ispName: statusFields.ispName,
    networkAsn: statusFields.networkAsn,
    traceroute: statusFields.traceroute,
    dnsOk: statusFields.dnsOk,
    httpsOk: statusFields.httpsOk,
    httpsLatencyMs: statusFields.httpsLatencyMs,
    consecutiveFailures,
    consecutiveSuccesses,
    presenceFailures,
    latestSpeedtestId: statusFields.latestSpeedtestId ?? current.latest_speedtest_id,
    updatedAt: now,
  });

  if (transitionedToDown) {
    outageId = await createOutage(env.DB, ispId, now, reason);
    const outage = await getOpenOutage(env.DB, ispId);
    if (outage) {
      await notifyOutageDown(
        env,
        ispId,
        outage,
        reason,
        statusFields.lastSeenAt,
        statusFields.publicIpv4,
      );
    }
  }

  if (transitionedToUp) {
    const openOutage = await getOpenOutage(env.DB, ispId);
    if (openOutage) {
      const startedAt = Date.parse(openOutage.started_at);
      const endedAt = Date.parse(now);
      const durationSeconds = Math.max(
        0,
        Math.floor((endedAt - startedAt) / 1000),
      );
      await closeOutage(env.DB, openOutage.id, now, durationSeconds);
      const closedOutage = {
        ...openOutage,
        ended_at: now,
        duration_seconds: durationSeconds,
      };
      await notifyOutageRecovery(
        env,
        ispId,
        closedOutage,
        statusFields.publicIpv4,
      );
      outageId = openOutage.id;
    }
  }

  return { transitionedToDown, transitionedToUp, outageId };
}

export async function processHeartbeat(
  env: Env,
  payload: HeartbeatPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const ispId = payload.isp_id;
  const healthy = checksAreHealthy(payload.checks);
  const reason = healthy ? "healthy" : failureReason(payload.checks);

  await closeOpenHeartbeatGap(env.DB, ispId, now);

  const speedtestId = await storeSpeedtestFromHeartbeat(env.DB, payload, now);

  await applyStateTransition(env, ispId, now, healthy, reason, "health", {
    lastSeenAt: now,
    publicIpv4: payload.checks.public_ipv4,
    ispName: payload.checks.isp_name ?? null,
    networkAsn: payload.checks.network_asn ?? null,
    traceroute: tracerouteToText(payload.checks.traceroute),
    dnsOk: payload.checks.dns,
    httpsOk: payload.checks.https.ok,
    httpsLatencyMs: payload.checks.https.latency_ms,
    latestSpeedtestId: speedtestId,
  });

  if (payload.checks.https.latency_ms !== null) {
    await insertLatencySample(
      env.DB,
      ispId,
      now,
      payload.checks.https.latency_ms,
      now,
    );
  }

  return { ok: true };
}

export async function processMissedHeartbeat(
  env: Env,
  ispId: IspId,
): Promise<void> {
  const current = await getIspStatus(env.DB, ispId);
  if (!current) {
    return;
  }

  const staleSeconds = getHeartbeatStaleSeconds(env);
  const downSeconds = getHeartbeatDownSeconds(env);
  const lastSeen = Date.parse(current.last_seen_at);
  if (!Number.isFinite(lastSeen)) {
    return;
  }

  const ageSeconds = (Date.now() - lastSeen) / 1000;
  if (ageSeconds < staleSeconds) {
    return;
  }

  const now = new Date().toISOString();
  const gapStartedAt = new Date(lastSeen + staleSeconds * 1000).toISOString();
  await openHeartbeatGapIfNeeded(env.DB, ispId, gapStartedAt, "heartbeat_missing");

  if (ageSeconds < downSeconds) {
    return;
  }

  await applyStateTransition(env, ispId, now, false, "heartbeat_missing", "presence", {
    lastSeenAt: current.last_seen_at,
    publicIpv4: current.public_ipv4,
    ispName: current.isp_name,
    networkAsn: current.network_asn,
    traceroute: current.traceroute,
    dnsOk: current.dns_ok === null ? null : current.dns_ok === 1,
    httpsOk: current.https_ok === null ? null : current.https_ok === 1,
    httpsLatencyMs: current.https_latency_ms,
    latestSpeedtestId: current.latest_speedtest_id,
  });
}

export async function evaluateStaleProbes(env: Env): Promise<void> {
  await processMissedHeartbeat(env, "isp1");
  await processMissedHeartbeat(env, "isp2");
}
