import { isValidIspId } from "../config";
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
  const response = await env.ISP_STATE.get(id).fetch(`https://state.internal${url.pathname}${url.search}`);
  return new Response(response.body, response);
}
