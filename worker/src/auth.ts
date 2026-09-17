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
  const compact = validateCompact(parsed, env);
  if (!compact.ok) return { ok: false, status: 400, error: compact.error };
  const payload = compact.payload;
  const verified = await verifySignedRequest(env, payload.isp_id, rawBody, authorization, payload.ts, payload.boot_id, String(payload.seq));
  if (!verified.ok) return verified;
  return { ok: true, payload };
}

export async function verifySignedRequest(
  env: Env,
  ispId: CompactHeartbeat["isp_id"],
  rawBody: string,
  authorization: string | null,
  timestamp: string | null,
  bootId: string | null,
  sequence: string | null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!authorization?.startsWith("Bearer ")) return { ok: false, status: 401, error: "Missing authorization" };
  if (!timestamp || !bootId || !/^[A-Za-z0-9_-]{8,80}$/.test(bootId)) return { ok: false, status: 400, error: "Invalid signature headers" };
  const parsedTimestamp = Date.parse(timestamp);
  const parsedSequence = Number(sequence ?? "");
  if (!Number.isFinite(parsedTimestamp) || Math.abs(Date.now() - parsedTimestamp) / 1000 > getHeartbeatMaxAgeSeconds(env)) return { ok: false, status: 400, error: "Stale request timestamp" };
  if (!Number.isSafeInteger(parsedSequence) || parsedSequence < 1) return { ok: false, status: 400, error: "Invalid request sequence" };
  const secret = getProbeSecret(env, ispId);
  if (!secret) return { ok: false, status: 503, error: "Probe secret is not configured" };
  const expected = await sign(secret, `${timestamp}.${bootId}.${parsedSequence}.${rawBody}`);
  const provided = base64ToBytes(authorization.slice("Bearer ".length).trim());
  if (!equalBytes(provided, base64ToBytes(expected))) return { ok: false, status: 401, error: "Invalid signature" };
  return { ok: true };
}
