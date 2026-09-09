import { getIspLabel, isValidIspId } from "../config";
import {
  listLatencyBuckets,
  listLatencySamples,
  listOutages,
  listSpeedtests,
} from "../db";
import type { Env, IspId } from "../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function parseDays(value: string | null, fallback = 7): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.min(parsed, 365);
}

function sinceDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function computeUptimePercent(outages: { started_at: string; ended_at: string | null; duration_seconds: number | null }[], days: number): number {
  const windowStart = Date.parse(sinceDate(days));
  const windowEnd = Date.now();
  const windowSeconds = Math.max(1, Math.floor((windowEnd - windowStart) / 1000));

  let downSeconds = 0;
  for (const outage of outages) {
    const start = Math.max(Date.parse(outage.started_at), windowStart);
    const end = outage.ended_at
      ? Date.parse(outage.ended_at)
      : windowEnd;
    if (end > start) {
      downSeconds += Math.floor((end - start) / 1000);
    }
  }

  const uptime = Math.max(0, windowSeconds - downSeconds);
  return Math.round((uptime / windowSeconds) * 10000) / 100;
}

export async function handleOutageHistory(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const ispParam = url.searchParams.get("isp");
  const days = parseDays(url.searchParams.get("days"), 7);

  if (!ispParam || !isValidIspId(ispParam)) {
    return jsonResponse({ error: "Invalid isp query parameter" }, 400);
  }

  const ispId = ispParam as IspId;
  const outages = await listOutages(env.DB, ispId, sinceDate(days));

  return jsonResponse({
    isp_id: ispId,
    label: getIspLabel(env, ispId),
    days,
    uptime_percent: computeUptimePercent(outages, days),
    outages: outages.map((outage) => ({
      id: outage.id,
      started_at: outage.started_at,
      ended_at: outage.ended_at,
      duration_seconds: outage.duration_seconds,
      reason: outage.reason,
      ongoing: outage.ended_at === null,
    })),
  });
}

export async function handleSpeedtestHistory(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const ispParam = url.searchParams.get("isp");
  const days = parseDays(url.searchParams.get("days"), 7);

  if (!ispParam || !isValidIspId(ispParam)) {
    return jsonResponse({ error: "Invalid isp query parameter" }, 400);
  }

  const ispId = ispParam as IspId;
  const results = await listSpeedtests(env.DB, ispId, sinceDate(days));

  return jsonResponse({
    isp_id: ispId,
    label: getIspLabel(env, ispId),
    days,
    results: results
      .slice()
      .reverse()
      .map((result) => ({
        id: result.id,
        recorded_at: result.recorded_at,
        download_mbps: result.download_mbps,
        upload_mbps: result.upload_mbps,
        ping_ms: result.ping_ms,
        jitter_ms: result.jitter_ms,
        packet_loss: result.packet_loss,
        server_name: result.server_name,
      })),
  });
}

export async function handleLatencyHistory(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const ispParam = url.searchParams.get("isp");
  const days = parseDays(url.searchParams.get("days"), 7);

  if (!ispParam || !isValidIspId(ispParam)) {
    return jsonResponse({ error: "Invalid isp query parameter" }, 400);
  }

  const ispId = ispParam as IspId;
  const since = sinceDate(days);

  if (days <= 1) {
    const samples = await listLatencySamples(env.DB, ispId, since);
    return jsonResponse({
      isp_id: ispId,
      label: getIspLabel(env, ispId),
      days,
      granularity: "sample",
      points: samples.map((sample) => ({
        recorded_at: sample.recorded_at,
        latency_ms: sample.https_latency_ms,
      })),
    });
  }

  const buckets = await listLatencyBuckets(env.DB, ispId, since);
  return jsonResponse({
    isp_id: ispId,
    label: getIspLabel(env, ispId),
    days,
    granularity: "hour",
    points: buckets.map((bucket) => ({
      recorded_at: bucket.bucket_at,
      latency_ms: bucket.avg_latency_ms,
      sample_count: bucket.sample_count,
    })),
  });
}
