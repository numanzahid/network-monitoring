import { getHeartbeatMaxAgeSeconds, getProbeSecret, isValidIspId } from "./config";
import type { CompactHeartbeat, Env, HeartbeatMetadata, HeartbeatSpeedtest } from "./types";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_BOOT_ID_LENGTH = 80;
const MAX_TRACEROUTE_LINES = 64;
const MAX_STRING_LENGTH = 256;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToBase64(new Uint8Array(digest));
}

function safeString(value: unknown, max = MAX_STRING_LENGTH): value is string {
  return typeof value === "string" && value.length <= max;
}

function validNullableNumber(value: unknown, min: number, max: number): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max);
}

function validMetadata(value: unknown): value is HeartbeatMetadata {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.public_ipv4 !== null && !safeString(item.public_ipv4, 64)) return false;
  if (item.isp_name !== null && !safeString(item.isp_name)) return false;
  if (item.network_asn !== null && !safeString(item.network_asn, 64)) return false;
  if (item.traceroute !== null) {
    if (!Array.isArray(item.traceroute) || item.traceroute.length > MAX_TRACEROUTE_LINES) return false;
    if (!item.traceroute.every((line) => safeString(line, MAX_STRING_LENGTH))) return false;
  }
  return true;
}

function validSpeedtest(value: unknown): value is HeartbeatSpeedtest {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const resultId = item.result_id;
  return Number.isSafeInteger(resultId) && (resultId as number) >= 0 && safeString(item.recorded_at, 64)
    && validNullableNumber(item.download_mbps, 0, 100000)
    && validNullableNumber(item.upload_mbps, 0, 100000)
    && validNullableNumber(item.ping_ms, 0, 100000)
    && validNullableNumber(item.jitter_ms, 0, 100000)
    && validNullableNumber(item.packet_loss, 0, 100)
    && (item.server_name === null || safeString(item.server_name));
}

function validateCompact(value: unknown, env: Env): { ok: true; payload: CompactHeartbeat } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "Invalid JSON body" };
  const item = value as Record<string, unknown>;
  if (item.v !== 2 || !isValidIspId(item.isp_id)) return { ok: false, error: "Invalid heartbeat version or ISP" };
  if (!safeString(item.boot_id, MAX_BOOT_ID_LENGTH) || !/^[A-Za-z0-9_-]{8,80}$/.test(item.boot_id)) return { ok: false, error: "Invalid boot_id" };
  const seq = item.seq;
  if (!Number.isSafeInteger(seq) || (seq as number) < 1) return { ok: false, error: "Invalid sequence" };
  if (!safeString(item.ts, 64)) return { ok: false, error: "Invalid timestamp" };
  const timestamp = Date.parse(item.ts);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) / 1000 > getHeartbeatMaxAgeSeconds(env)) return { ok: false, error: "Stale heartbeat timestamp" };
  const flags = item.f;
  if (!Number.isInteger(flags) || (flags as number) < 0 || (flags as number) > 7) return { ok: false, error: "Invalid flags" };
  if (!validNullableNumber(item.l, 0, 120000)) return { ok: false, error: "Invalid latency" };
  if (item.m !== undefined && item.m !== null && !validMetadata(item.m)) return { ok: false, error: "Invalid metadata" };
  if (item.s !== undefined && item.s !== null && !validSpeedtest(item.s)) return { ok: false, error: "Invalid speedtest" };
  return { ok: true, payload: item as unknown as CompactHeartbeat };
}

function legacyToCompact(value: Record<string, unknown>): CompactHeartbeat | null {
  if (!isValidIspId(value.isp_id) || typeof value.ts !== "string" || typeof value.nonce !== "string") return null;
  const sequence = Date.parse(value.ts);
  if (!Number.isFinite(sequence)) return null;
  const checks = value.checks;
  if (!checks || typeof checks !== "object") return null;
  const check = checks as Record<string, unknown>;
  const https = check.https;
  if (!https || typeof https !== "object") return null;
  const httpsCheck = https as Record<string, unknown>;
  const flags = (check.internet === true ? 1 : 0) | (check.dns === true ? 2 : 0) | (httpsCheck.ok === true ? 4 : 0);
  const metadata: HeartbeatMetadata = {
    public_ipv4: typeof check.public_ipv4 === "string" ? check.public_ipv4 : null,
    isp_name: typeof check.isp_name === "string" ? check.isp_name : null,
    network_asn: typeof check.network_asn === "string" ? check.network_asn : null,
    traceroute: Array.isArray(check.traceroute) && check.traceroute.every((line) => typeof line === "string") ? check.traceroute : null,
  };
  return {
    v: 2,
    isp_id: value.isp_id,
    boot_id: "legacy0",
    seq: Math.max(1, sequence),
    ts: value.ts,
    f: flags,
    l: typeof httpsCheck.latency_ms === "number" ? httpsCheck.latency_ms : null,
    m: metadata,
    s: value.speedtest && typeof value.speedtest === "object" ? value.speedtest as HeartbeatSpeedtest : null,
  };
}

function equalBytes(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

export async function verifyHeartbeat(env: Env, rawBody: string, authorization: string | null): Promise<{ ok: true; payload: CompactHeartbeat } | { ok: false; status: number; error: string }> {
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return { ok: false, status: 413, error: "Heartbeat body too large" };
  if (!authorization?.startsWith("Bearer ")) return { ok: false, status: 401, error: "Missing authorization" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, status: 400, error: "Invalid JSON body" };
  const item = parsed as Record<string, unknown>;
  if (!isValidIspId(item.isp_id)) return { ok: false, status: 400, error: "Invalid isp_id" };
  const secret = getProbeSecret(env, item.isp_id);
  if (!secret) return { ok: false, status: 503, error: "Probe secret is not configured" };
  const compact = item.v === 2 ? validateCompact(parsed, env) : null;
  if (item.v === 2 && (!compact || !compact.ok)) return { ok: false, status: 400, error: compact?.error ?? "Invalid heartbeat" };
  if (item.v !== 2) {
    if (typeof item.ts !== "string" || !Number.isFinite(Date.parse(item.ts)) || Math.abs(Date.now() - Date.parse(item.ts)) / 1000 > getHeartbeatMaxAgeSeconds(env)) {
      return { ok: false, status: 401, error: "Stale heartbeat timestamp" };
    }
  }
  const payload = compact?.ok ? compact.payload : legacyToCompact(item);
  if (!payload) return { ok: false, status: 400, error: "Invalid heartbeat payload" };
  const message = item.v === 2 ? `${payload.ts}.${payload.boot_id}.${payload.seq}.${rawBody}` : `${String(item.ts)}.${String(item.nonce)}.${rawBody}`;
  const expected = await sign(secret, message);
  const provided = base64ToBytes(authorization.slice("Bearer ".length).trim());
  if (!equalBytes(provided, base64ToBytes(expected))) return { ok: false, status: 401, error: "Invalid signature" };
  return { ok: true, payload };
}
