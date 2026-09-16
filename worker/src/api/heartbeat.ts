import { verifyHeartbeat } from "../auth";
import { isValidIspId } from "../config";
import type { Env } from "../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function handleHeartbeat(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const contentLength = Number.parseInt(request.headers.get("Content-Length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > 16 * 1024) return jsonResponse({ error: "Heartbeat body too large" }, 413);
  const rawBody = await request.text();
  let ispId: unknown;
  try {
    ispId = (JSON.parse(rawBody) as { isp_id?: unknown }).isp_id;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!isValidIspId(ispId)) return jsonResponse({ error: "Invalid isp_id" }, 400);
  const verified = await verifyHeartbeat(env, rawBody, request.headers.get("Authorization"));
  if (!verified.ok) return jsonResponse({ error: verified.error }, verified.status);
  const id = env.ISP_STATE.idFromName(ispId);
  const response = await env.ISP_STATE.get(id).fetch("https://state.internal/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(verified.payload),
  });
  return new Response(response.body, response);
}
