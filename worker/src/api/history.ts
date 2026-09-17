import { isValidIspId } from "../config";
import { verifySignedRequest } from "../auth";
import type { Env } from "../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function handleHistory(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
  const url = new URL(request.url);
  const isp = url.searchParams.get("isp");
  if (!isValidIspId(isp)) return jsonResponse({ error: "Invalid isp" }, 400);
  const id = env.ISP_STATE.idFromName(isp);
  const statePath = url.pathname.replace(/^\/api/, "");
  const response = await env.ISP_STATE.get(id).fetch(`https://state.internal${statePath}${url.search}`);
  return new Response(response.body, response);
}

export async function handleHistorySync(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 128 * 1024) return jsonResponse({ error: "Sync body too large" }, 413);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody) as Record<string, unknown>; } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
  const isp = payload.isp_id;
  if (!isValidIspId(isp)) return jsonResponse({ error: "Invalid isp" }, 400);
  const verified = await verifySignedRequest(
    env,
    isp,
    rawBody,
    request.headers.get("Authorization"),
    request.headers.get("X-Probe-Timestamp"),
    request.headers.get("X-Probe-Boot-Id"),
    request.headers.get("X-Probe-Sequence"),
  );
  if (!verified.ok) return jsonResponse({ error: verified.error }, verified.status);
  const id = env.ISP_STATE.idFromName(isp);
  const response = await env.ISP_STATE.get(id).fetch("https://state.internal/history/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: rawBody });
  return new Response(response.body, response);
}
