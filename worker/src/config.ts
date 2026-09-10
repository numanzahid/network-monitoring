import type { Env, IspId } from "./types";

export function parseIntEnv(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isNotifyEnabled(env: Env): boolean {
  return env.NOTIFY_ENABLED.toLowerCase() === "true";
}

export function getFailureThreshold(env: Env): number {
  return parseIntEnv(env.FAILURE_THRESHOLD, 3);
}

export function getMissingHeartbeatFailureThreshold(env: Env): number {
  return parseIntEnv(env.MISSING_HEARTBEAT_FAILURE_THRESHOLD, 1);
}

export function getSuccessThreshold(env: Env): number {
  return parseIntEnv(env.SUCCESS_THRESHOLD, 2);
}

export function getHeartbeatMaxAgeSeconds(env: Env): number {
  return parseIntEnv(env.HEARTBEAT_MAX_AGE_SECONDS, 300);
}

export function getHeartbeatStaleSeconds(env: Env): number {
  return parseIntEnv(env.HEARTBEAT_STALE_SECONDS, 120);
}

export function getHeartbeatDownSeconds(env: Env): number {
  const staleSeconds = getHeartbeatStaleSeconds(env);
  const configured = parseIntEnv(env.HEARTBEAT_DOWN_SECONDS, staleSeconds + 60);
  return Math.max(configured, staleSeconds + 1);
}

export function getIspLabel(env: Env, ispId: IspId): string {
  return ispId === "isp1" ? env.ISP1_LABEL : env.ISP2_LABEL;
}

export function getProbeSecret(env: Env, ispId: IspId): string | null {
  const secret = ispId === "isp1" ? env.PROBE_SECRET_ISP1 : env.PROBE_SECRET_ISP2;
  return secret && secret.length > 0 ? secret : null;
}

export function getEnabledNotifierChannels(env: Env): string[] {
  return env.NOTIFIER_CHANNELS
    .split(",")
    .map((channel) => channel.trim().toLowerCase())
    .filter(Boolean);
}

export function isValidIspId(value: string): value is IspId {
  return value === "isp1" || value === "isp2";
}
