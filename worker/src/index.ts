import { handleHeartbeat } from "./api/heartbeat";
import { handleStatus } from "./api/status";
import { handleHistory, handleHistorySync } from "./api/history";
import { IspState } from "./presence";
import type { Env } from "./types";

export { IspState };

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

async function serveStaticAsset(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const response = await env.ASSETS.fetch(new Request(new URL(pathname, url.origin), request));
  return response.status === 404 ? new Response("Not Found", { status: 404 }) : response;
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/heartbeat") return handleHeartbeat(request, env);
  if (pathname === "/api/status") return handleStatus(request, env);
  if (pathname === "/api/history/sync") return handleHistorySync(request, env);
  if (pathname === "/api/history/latency" || pathname === "/api/history/outages" || pathname === "/api/history/speedtests") return handleHistory(request, env);
  if (pathname.startsWith("/api/history/")) return jsonResponse({ error: "History is served by the local history app" }, 410);
  return new Response("Not Found", { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/api/")) return handleApi(request, env);
    return serveStaticAsset(env, request);
  },
};
