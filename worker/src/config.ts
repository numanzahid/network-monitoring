import type { Env, IspId } from "./types";

export function parseIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getProbeIntervalSeconds(env: Env): number {
  return Math.max(1, parseIntEnv(env.PROBE_INTERVAL_SECONDS, 60));
}

export function getMissedBeatThreshold(env: Env): number {
  return Math.max(1, parseIntEnv(env.NOTIFY_AFTER_MISSED_BEATS, 1));
}

export function getHeartbeatMaxAgeSeconds(env: Env): number {
  return Math.max(10, parseIntEnv(env.HEARTBEAT_MAX_AGE_SECONDS, 300));
}

export function getRemoteHistoryHours(env: Env): number {
  return Math.min(24 * 30, Math.max(1, parseIntEnv(env.REMOTE_HISTORY_HOURS, 24)));
}

export function getRemoteSpeedtestHistoryDays(env: Env): number {
  return Math.min(365, Math.max(1, parseIntEnv(env.REMOTE_SPEEDTEST_HISTORY_DAYS, 30)));
}

export function isNotifyEnabled(env: Env): boolean {
  return (env.NOTIFY_ENABLED ?? "false").toLowerCase() === "true";
}

export function getIspLabel(env: Env, ispId: IspId): string {
  return ispId === "isp1" ? env.ISP1_LABEL : env.ISP2_LABEL;
}

export function getProbeSecret(env: Env, ispId: IspId): string | null {
  const value = ispId === "isp1" ? env.PROBE_SECRET_ISP1 : env.PROBE_SECRET_ISP2;
  return value && value.length > 0 ? value : null;
}

export function isValidIspId(value: unknown): value is IspId {
  return value === "isp1" || value === "isp2";
}
