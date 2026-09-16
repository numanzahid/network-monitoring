import { getIspLabel, isValidIspId } from "../config";
import type { Env, IspId } from "../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

async function getRemoteStatus(env: Env, ispId: IspId): Promise<Record<string, unknown>> {
  const id = env.ISP_STATE.idFromName(ispId);
  const response = await env.ISP_STATE.get(id).fetch(`https://state.internal/status?isp=${ispId}`);
  if (!response.ok) throw new Error(`state status failed for ${ispId}`);
  return await response.json() as Record<string, unknown>;
}

export async function handleStatus(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
  const isps = await Promise.all((['isp1', 'isp2'] as IspId[]).map(async (ispId) => {
    try {
      return { ...(await getRemoteStatus(env, ispId)), isp_id: ispId, label: getIspLabel(env, ispId) };
    } catch {
      return { isp_id: ispId, label: getIspLabel(env, ispId), is_up: false, display_state: "unknown", health_state: "unknown", last_seen_at: null, heartbeat_age_seconds: null, heartbeat_stale: true, missed_beats: null, checks: { internet_ok: null, dns_ok: null, https_ok: null, https_latency_ms: null }, state_error: true };
    }
  }));
  return jsonResponse({ generated_at: new Date().toISOString(), status_page_url: env.STATUS_PAGE_URL ?? "", isps });
}

export function parseStatusIsp(value: string | null): IspId | null {
  return value && isValidIspId(value) ? value : null;
}
