import { verifyHeartbeatAuth } from "../auth";
import { isValidIspId } from "../config";
import { nonceExists, storeNonce } from "../db";
import { processHeartbeat } from "../outages";
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

export async function handleHeartbeat(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const rawBody = await request.text();
  let ispId: IspId | null = null;

  try {
    const parsed = JSON.parse(rawBody) as { isp_id?: string };
    if (parsed.isp_id && isValidIspId(parsed.isp_id)) {
      ispId = parsed.isp_id;
    }
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!ispId) {
    return jsonResponse({ error: "Invalid isp_id" }, 400);
  }

  const auth = await verifyHeartbeatAuth(
    env,
    ispId,
    rawBody,
    request.headers.get("Authorization"),
  );
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, 401);
  }

  if (await nonceExists(env.DB, auth.payload.nonce)) {
    return jsonResponse({ error: "Replayed nonce" }, 409);
  }

  await storeNonce(env.DB, ispId, auth.payload.nonce, new Date().toISOString());

  const result = await processHeartbeat(env, auth.payload);
  if (!result.ok) {
    return jsonResponse({ error: result.error }, 500);
  }

  return jsonResponse({ ok: true });
}
