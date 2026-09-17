import { getIspLabel, getMissedBeatThreshold, getProbeIntervalSeconds, isNotifyEnabled } from "./config";
import type { CompactHeartbeat, Env, HeartbeatMetadata, PresenceNotification, PresenceState } from "./types";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function defaultState(ispId: CompactHeartbeat["isp_id"]): PresenceState {
  return { isp_id: ispId, boot_id: null, last_seq: 0, last_beat_probe_at: null, last_beat_recv_at: null, flags: null, latency_ms: null, metadata: null, latest_speedtest: null, presence_state: "unknown", health_state: "unknown", missed_beats: 0, outage_started_at: null, transition_number: 0, pending_notifications: [], pending_notification: null, last_notification_id: null };
}

function nowIso(): string { return new Date().toISOString(); }
function healthy(flags: number): boolean { return (flags & 7) === 7; }

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

interface NotificationPayload {
  title: string;
  body: string;
  priority: string;
  tags: string;
  clickUrl?: string;
}

async function sendNtfy(env: Env, payload: NotificationPayload): Promise<boolean> {
  if (!env.NTFY_TOPIC) return false;
  const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8", Title: payload.title, Priority: payload.priority, Tags: payload.tags });
  if (payload.clickUrl) headers.set("Click", payload.clickUrl);
  if (env.NTFY_AUTH_TOKEN) headers.set("Authorization", `Bearer ${env.NTFY_AUTH_TOKEN}`);
  try {
    const result = await fetch(`${env.NTFY_SERVER.replace(/\/$/, "")}/${encodeURIComponent(env.NTFY_TOPIC)}`, { method: "POST", headers, body: payload.body, signal: AbortSignal.timeout(5000) });
    return result.ok;
  } catch {
    return false;
  }
}

async function sendTelegram(env: Env, payload: NotificationPayload): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  try {
    const result = await fetch(`https://api.telegram.org/bot${encodeURIComponent(env.TELEGRAM_BOT_TOKEN)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: `${payload.title}\n\n${payload.body}` }),
      signal: AbortSignal.timeout(5000),
    });
    return result.ok;
  } catch {
    return false;
  }
}

async function sendDiscord(env: Env, payload: NotificationPayload): Promise<boolean> {
  if (!env.DISCORD_WEBHOOK_URL) return false;
  try {
    const result = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `**${payload.title}**\n${payload.body}` }),
      signal: AbortSignal.timeout(5000),
    });
    return result.ok;
  } catch {
    return false;
  }
}

async function sendNotification(env: Env, payload: NotificationPayload): Promise<boolean> {
  if (!isNotifyEnabled(env)) return true;
  const channels = (env.NOTIFIER_CHANNELS || "ntfy").split(",").map((channel) => channel.trim().toLowerCase()).filter(Boolean);
  if (!channels.length) return true;
  const results = await Promise.all(channels.map((channel) => {
    if (channel === "ntfy") return sendNtfy(env, payload);
    if (channel === "telegram") return sendTelegram(env, payload);
    if (channel === "discord") return sendDiscord(env, payload);
    return Promise.resolve(true);
  }));
  return results.every(Boolean);
}

async function deliverPending(state: PresenceState, env: Env): Promise<PresenceState> {
  while (state.pending_notifications.length) {
    const pending = state.pending_notifications[0];
    const label = getIspLabel(env, state.isp_id);
    const isDown = pending.type === "down";
    const missedBeats = pending.missed_beats ?? state.missed_beats;
    const lastReceive = pending.last_beat_recv_at ?? state.last_beat_recv_at;
    const latency = pending.latency_ms ?? state.latency_ms;
    const duration = pending.ended_at ? formatDuration(Math.max(0, (Date.parse(pending.ended_at) - Date.parse(pending.started_at)) / 1000)) : `${missedBeats} missed beat${missedBeats === 1 ? "" : "s"}`;
    const body = isDown
      ? `Remote presence missed ${missedBeats} beat${missedBeats === 1 ? "" : "s"}.\nLast receive: ${lastReceive ?? "unknown"}\nLast latency: ${latency === null ? "unknown" : `${latency} ms`}`
      : `Remote presence recovered after ${duration}.\nLast latency: ${latency === null ? "unknown" : `${latency} ms`}`;
    const sent = await sendNotification(env, { title: `${isDown ? "[DOWN]" : "[UP]"} ${label}`, body, priority: isDown ? env.NTFY_PRIORITY_DOWN : env.NTFY_PRIORITY_UP, tags: `${state.isp_id},${isDown ? "warning" : "white_check_mark"}`, clickUrl: env.STATUS_PAGE_URL || undefined });
    if (!sent) break;
    state.last_notification_id = pending.id;
    state.pending_notifications.shift();
  }
  return state;
}

export class IspState {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/heartbeat") {
      let payload: CompactHeartbeat;
      try { payload = await request.json() as CompactHeartbeat; } catch { return response({ error: "Invalid heartbeat" }, 400); }
      return this.state.blockConcurrencyWhile(async () => this.acceptHeartbeat(payload));
    }
    if (request.method === "GET" && url.pathname === "/status") return this.statusResponse(url.searchParams.get("isp"));
    return response({ error: "Not Found" }, 404);
  }

  async alarm(): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      const current = await this.load();
      if (!current.last_beat_recv_at) return;
      const interval = getProbeIntervalSeconds(this.env);
      const threshold = getMissedBeatThreshold(this.env);
      const age = Math.max(0, Math.floor((Date.now() - Date.parse(current.last_beat_recv_at)) / 1000));
      current.missed_beats = Math.floor(age / interval);
      if (current.missed_beats >= threshold && current.presence_state !== "down") {
        current.presence_state = "down";
        current.outage_started_at = new Date(Date.parse(current.last_beat_recv_at) + threshold * interval * 1000).toISOString();
        current.transition_number += 1;
        current.pending_notifications.push({ id: `${current.isp_id}-${current.transition_number}-down`, type: "down", started_at: current.outage_started_at, reason: "missed_heartbeat", missed_beats: current.missed_beats, last_beat_recv_at: current.last_beat_recv_at, latency_ms: current.latency_ms });
      }
      const updated = await deliverPending(current, this.env);
      await this.save(updated);
      await this.scheduleNext(updated);
    });
  }

  private async load(ispId?: CompactHeartbeat["isp_id"]): Promise<PresenceState> {
    const stored = await this.state.storage.get<PresenceState>("state");
    if (stored) {
      const legacyPending = stored.pending_notification ?? null;
      stored.pending_notifications = Array.isArray(stored.pending_notifications)
        ? stored.pending_notifications
        : legacyPending ? [legacyPending] : [];
      stored.pending_notification = null;
      return stored;
    }
    return defaultState(ispId ?? "isp1");
  }

  private async save(value: PresenceState): Promise<void> { await this.state.storage.put("state", value); }

  private async scheduleNext(value: PresenceState): Promise<void> {
    if (value.last_beat_recv_at) await this.state.storage.setAlarm(Date.now() + getProbeIntervalSeconds(this.env) * 1000);
  }

  private async acceptHeartbeat(payload: CompactHeartbeat): Promise<Response> {
    let current = await this.load(payload.isp_id);
    if (current.boot_id === payload.boot_id && payload.seq <= current.last_seq) return response({ ok: true, accepted: false, duplicate: true, status: await this.publicStatus(current) });
    const receivedAt = nowIso();
    const wasDown = current.presence_state === "down";
    const previousOutage = current.outage_started_at;
    current.boot_id = payload.boot_id;
    current.last_seq = payload.seq;
    current.last_beat_probe_at = payload.ts;
    current.last_beat_recv_at = receivedAt;
    current.flags = payload.f;
    current.latency_ms = payload.l;
    current.missed_beats = 0;
    current.health_state = healthy(payload.f) ? "healthy" : "degraded";
    if (payload.m !== undefined) current.metadata = payload.m === null ? null : payload.m as HeartbeatMetadata;
    if (payload.s !== undefined) current.latest_speedtest = payload.s ?? null;
    current.presence_state = "up";
    if (wasDown) {
      current.pending_notifications.push({ id: `${current.isp_id}-${current.transition_number}-up`, type: "up", started_at: previousOutage ?? receivedAt, ended_at: receivedAt, latency_ms: current.latency_ms });
      current.outage_started_at = null;
    }
    const updated = await deliverPending(current, this.env);
    await this.save(updated);
    await this.scheduleNext(updated);
    return response({ ok: true, accepted: true, duplicate: false, status: await this.publicStatus(updated) });
  }

  private async statusResponse(ispId: string | null): Promise<Response> {
    return response(await this.publicStatus(await this.load(ispId === "isp2" ? "isp2" : "isp1")));
  }

  private async publicStatus(state: PresenceState): Promise<Record<string, unknown>> {
    const lastSeenMs = state.last_beat_recv_at ? Date.parse(state.last_beat_recv_at) : NaN;
    const age = Number.isFinite(lastSeenMs) ? Math.max(0, Math.floor((Date.now() - lastSeenMs) / 1000)) : null;
    const interval = getProbeIntervalSeconds(this.env);
    const threshold = getMissedBeatThreshold(this.env);
    const missed = age === null ? null : Math.floor(age / interval);
    const isUp = state.presence_state === "up" && (missed ?? threshold) < threshold;
    const metadata = state.metadata;
    return {
      isp_id: state.isp_id,
      is_up: isUp,
      display_state: state.presence_state === "unknown" ? "unknown" : isUp ? "up" : "down",
      health_state: state.health_state,
      last_seen_at: state.last_beat_recv_at,
      last_beat_probe_at: state.last_beat_probe_at,
      heartbeat_age_seconds: age,
      heartbeat_stale: age !== null && age >= interval,
      missed_beats: missed,
      flags: state.flags,
      checks: { internet_ok: state.flags === null ? null : (state.flags & 1) !== 0, dns_ok: state.flags === null ? null : (state.flags & 2) !== 0, https_ok: state.flags === null ? null : (state.flags & 4) !== 0, https_latency_ms: state.latency_ms },
      public_ipv4: metadata?.public_ipv4 ?? null,
      isp_name: metadata?.isp_name ?? null,
      network_asn: metadata?.network_asn ?? null,
      traceroute: metadata?.traceroute ?? null,
      consecutive_failures: state.health_state === "degraded" ? 1 : 0,
      consecutive_successes: state.health_state === "healthy" ? 1 : 0,
      presence_failures: missed ?? 0,
      missed_heartbeat_minutes_24h: 0,
      open_heartbeat_gap: !isUp && state.last_beat_recv_at ? { started_at: state.outage_started_at ?? state.last_beat_recv_at } : null,
      ongoing_outage: !isUp && state.outage_started_at ? { started_at: state.outage_started_at, reason: "missed_heartbeat" } : null,
      latest_speedtest: state.latest_speedtest,
      notify_state: state.pending_notifications.length ? "pending" : "clear",
    };
  }
}
