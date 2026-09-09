import { handleHeartbeat } from "./api/heartbeat";
import {
  handleLatencyHistory,
  handleOutageHistory,
  handleSpeedtestHistory,
} from "./api/history";
import { handleStatus } from "./api/status";
import { handleScheduled } from "./cron";
import type { Env } from "./types";

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

async function serveStaticAsset(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  let pathname = url.pathname;

  if (pathname === "/") {
    pathname = "/index.html";
  }

  const assetRequest = new Request(new URL(pathname, url.origin), request);
  const response = await env.ASSETS.fetch(assetRequest);
  if (response.status === 404) {
    return notFound();
  }
  return response;
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/api/heartbeat") {
    return handleHeartbeat(request, env);
  }
  if (pathname === "/api/status") {
    return handleStatus(env);
  }
  if (pathname === "/api/history/outages") {
    return handleOutageHistory(request, env);
  }
  if (pathname === "/api/history/speedtests") {
    return handleSpeedtestHistory(request, env);
  }
  if (pathname === "/api/history/latency") {
    return handleLatencyHistory(request, env);
  }

  return notFound();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }

    return serveStaticAsset(env, request);
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await handleScheduled(env);
  },
};
