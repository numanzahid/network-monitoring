import {
  getFailureThreshold,
  getHeartbeatStaleSeconds,
  getSuccessThreshold,
} from "./config";
import {
  checksAreHealthy,
  closeOutage,
  createOutage,
  failureReason,
  getIspStatus,
  getOpenOutage,
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

async function applyStateTransition(
  env: Env,
  ispId: IspId,
  now: string,
  checksHealthy: boolean,
  reason: string,
  statusFields: {
    lastSeenAt: string;
    publicIpv4: string | null;
    dnsOk: boolean | null;
    httpsOk: boolean | null;
    httpsLatencyMs: number | null;
    latestSpeedtestId: number | null;
  },
): Promise<TransitionResult> {
  const failureThreshold = getFailureThreshold(env);
  const successThreshold = getSuccessThreshold(env);
  const current = await getIspStatus(env.DB, ispId);

  if (!current) {
    throw new Error(`Missing isp_status row for ${ispId}`);
  }

  const wasUp = current.is_up === 1;
  let consecutiveFailures = current.consecutive_failures;
  let consecutiveSuccesses = current.consecutive_successes;
  let isUp = wasUp;
  let transitionedToDown = false;
  let transitionedToUp = false;
  let outageId: number | null = null;

  if (checksHealthy) {
    consecutiveSuccesses += 1;
    consecutiveFailures = 0;
    if (!wasUp && consecutiveSuccesses >= successThreshold) {
      isUp = true;
      transitionedToUp = true;
    }
  } else {
    consecutiveFailures += 1;
    consecutiveSuccesses = 0;
    if (wasUp && consecutiveFailures >= failureThreshold) {
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
    dnsOk: statusFields.dnsOk,
    httpsOk: statusFields.httpsOk,
    httpsLatencyMs: statusFields.httpsLatencyMs,
    consecutiveFailures,
    consecutiveSuccesses,
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
        now,
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

  const speedtestId = await storeSpeedtestFromHeartbeat(env.DB, payload, now);

  await applyStateTransition(env, ispId, now, healthy, reason, {
    lastSeenAt: now,
    publicIpv4: payload.checks.public_ipv4,
    dnsOk: payload.checks.dns,
    httpsOk: payload.checks.https.ok,
    httpsLatencyMs: payload.checks.https.latency_ms,
    latestSpeedtestId: speedtestId,
  });

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
  const lastSeen = Date.parse(current.last_seen_at);
  if (!Number.isFinite(lastSeen)) {
    return;
  }

  const ageSeconds = (Date.now() - lastSeen) / 1000;
  if (ageSeconds < staleSeconds) {
    return;
  }

  if (current.is_up !== 1 && current.consecutive_failures >= getFailureThreshold(env)) {
    return;
  }

  const now = new Date().toISOString();
  await applyStateTransition(env, ispId, now, false, "heartbeat_missing", {
    lastSeenAt: current.last_seen_at,
    publicIpv4: current.public_ipv4,
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
