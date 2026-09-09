import { getHeartbeatMaxAgeSeconds, getProbeSecret } from "./config";
import type { Env, HeartbeatPayload, IspId } from "./types";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export async function signHeartbeat(
  secret: string,
  ts: string,
  nonce: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = `${ts}.${nonce}.${body}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifyHeartbeatAuth(
  env: Env,
  ispId: IspId,
  rawBody: string,
  authorization: string | null,
): Promise<{ ok: true; payload: HeartbeatPayload } | { ok: false; error: string }> {
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return { ok: false, error: "Missing or invalid Authorization header" };
  }

  const secret = getProbeSecret(env, ispId);
  if (!secret) {
    return { ok: false, error: "Probe secret is not configured for this ISP" };
  }

  let payload: HeartbeatPayload;
  try {
    payload = JSON.parse(rawBody) as HeartbeatPayload;
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }

  if (payload.isp_id !== ispId) {
    return { ok: false, error: "isp_id mismatch" };
  }

  if (!payload.ts || !payload.nonce) {
    return { ok: false, error: "Missing ts or nonce" };
  }

  const maxAgeSeconds = getHeartbeatMaxAgeSeconds(env);
  const payloadTime = Date.parse(payload.ts);
  if (!Number.isFinite(payloadTime)) {
    return { ok: false, error: "Invalid timestamp" };
  }

  const ageSeconds = Math.abs(Date.now() - payloadTime) / 1000;
  if (ageSeconds > maxAgeSeconds) {
    return { ok: false, error: "Stale heartbeat timestamp" };
  }

  const providedSignature = authorization.slice("Bearer ".length).trim();
  const expectedSignature = await signHeartbeat(
    secret,
    payload.ts,
    payload.nonce,
    rawBody,
  );

  const providedBytes = base64ToBytes(providedSignature);
  const expectedBytes = base64ToBytes(expectedSignature);
  if (!providedBytes || !expectedBytes || providedBytes.length !== expectedBytes.length) {
    return { ok: false, error: "Invalid signature" };
  }

  let mismatch = 0;
  for (let index = 0; index < providedBytes.length; index += 1) {
    mismatch |= providedBytes[index] ^ expectedBytes[index];
  }
  if (mismatch !== 0) {
    return { ok: false, error: "Invalid signature" };
  }

  return { ok: true, payload };
}
