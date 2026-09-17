import { getIspLabel, getMissedBeatThreshold, getProbeIntervalSeconds, getRemoteHistoryHours, getRemoteOutageHistoryDays, getRemoteSpeedtestHistoryDays, isNotifyEnabled } from "./config";
import type { CompactHeartbeat, Env, HeartbeatMetadata, HeartbeatSpeedtest, HistorySyncState, PresenceNotification, PresenceState } from "./types";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function defaultState(ispId: CompactHeartbeat["isp_id"]): PresenceState {
  return { isp_id: ispId, boot_id: null, last_seq: 0, last_beat_probe_at: null, last_beat_recv_at: null, flags: null, latency_ms: null, metadata: null, latest_speedtest: null, presence_state: "unknown", health_state: "unknown", missed_beats: 0, outage_started_at: null, transition_number: 0, pending_notifications: [], pending_notification: null, last_notification_id: null, history_sync: null };
}

function completeSpeedtest(value: HeartbeatSpeedtest | null | undefined): value is HeartbeatSpeedtest {
  return value !== null && value !== undefined
    && typeof value.download_mbps === "number" && Number.isFinite(value.download_mbps) && value.download_mbps >= 0
    && typeof value.upload_mbps === "number" && Number.isFinite(value.upload_mbps) && value.upload_mbps >= 0;
}

function nowIso(): string { return new Date().toISOString(); }
function healthy(flags: number): boolean { return (flags & 7) === 7; }

function newHistorySync(env: Env): HistorySyncState {
  const now = Date.now();
  return {
    request_id: crypto.randomUUID(),
    heartbeat_since: new Date(now - getRemoteHistoryHours(env) * 3600000).toISOString(),
    speedtest_since: new Date(now - getRemoteSpeedtestHistoryDays(env) * 86400000).toISOString(),
    outage_since: new Date(now - getRemoteOutageHistoryDays(env) * 86400000).toISOString(),
    heartbeat_complete: false,
    speedtest_complete: false,
    outage_complete: false,
  };
}

function historySyncResponse(sync: HistorySyncState | null): Record<string, unknown> | null {
  if (!sync) return null;
  return {
    required: !(sync.heartbeat_complete && sync.speedtest_complete && sync.outage_complete),
    request_id: sync.request_id,
    heartbeat_since: sync.heartbeat_since,
    speedtest_since: sync.speedtest_since,
    outage_since: sync.outage_since,
  };
}

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

interface RemoteBeatRow {
  [key: string]: string | number | null;
  probe_ts: string;
  received_at: string;
  flags: number;
  latency_ms: number | null;
}

interface RemoteSpeedtestRow {
  [key: string]: string | number | null;
  payload_json: string;
}

interface RemoteOutageRow {
  [key: string]: string | number | null;
  id: number;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  reason: string;
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
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS heartbeat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        boot_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        probe_ts TEXT NOT NULL,
        received_at TEXT NOT NULL,
        flags INTEGER NOT NULL,
        latency_ms INTEGER,
        UNIQUE (boot_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_heartbeat_history_probe ON heartbeat_history (probe_ts);
      CREATE TABLE IF NOT EXISTS remote_speedtests (
        result_id INTEGER PRIMARY KEY,
        recorded_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_remote_speedtests_recorded ON remote_speedtests (recorded_at);
      CREATE TABLE IF NOT EXISTS remote_outages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL UNIQUE,
        ended_at TEXT,
        duration_seconds INTEGER,
        reason TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_remote_outages_started ON remote_outages (started_at);
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/heartbeat") {
      let payload: CompactHeartbeat;
      try { payload = await request.json() as CompactHeartbeat; } catch { return response({ error: "Invalid heartbeat" }, 400); }
      return this.state.blockConcurrencyWhile(async () => this.acceptHeartbeat(payload));
    }
    if (request.method === "POST" && url.pathname === "/history/sync") {
      let payload: unknown;
      try { payload = await request.json(); } catch { return response({ error: "Invalid sync body" }, 400); }
      return this.state.blockConcurrencyWhile(async () => this.acceptHistorySync(payload));
    }
    if (request.method === "GET" && url.pathname === "/status") return this.statusResponse(url.searchParams.get("isp"));
    if (request.method === "GET" && url.pathname === "/history/latency") return this.latencyHistory(url);
    if (request.method === "GET" && url.pathname === "/history/outages") return this.outageHistory(url);
    if (request.method === "GET" && url.pathname === "/history/speedtests") return this.speedtestHistory(url);
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
        this.state.storage.sql.exec("INSERT OR IGNORE INTO remote_outages (started_at, reason) VALUES (?, ?)", current.outage_started_at, "missed_heartbeat");
        current.pending_notifications.push({ id: `${current.isp_id}-${current.transition_number}-down`, type: "down", started_at: current.outage_started_at, reason: "missed_heartbeat", missed_beats: current.missed_beats, last_beat_recv_at: current.last_beat_recv_at, latency_ms: current.latency_ms });
      }
      this.cleanupHistory();
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
      if (stored.history_sync === undefined) stored.history_sync = null;
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
    if (!current.history_sync) current.history_sync = newHistorySync(this.env);
    if (current.boot_id === payload.boot_id && payload.seq <= current.last_seq) return response({ ok: true, accepted: false, duplicate: true, history_sync: historySyncResponse(current.history_sync), status: await this.publicStatus(current) });
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
    if (completeSpeedtest(payload.s)) current.latest_speedtest = payload.s;
    current.presence_state = "up";
    this.recordHeartbeat(payload, receivedAt);
    if (wasDown) {
      if (previousOutage) {
        const duration = Math.max(0, Math.floor((Date.parse(receivedAt) - Date.parse(previousOutage)) / 1000));
        this.state.storage.sql.exec("INSERT OR IGNORE INTO remote_outages (started_at, reason) VALUES (?, ?)", previousOutage, "missed_heartbeat");
        this.state.storage.sql.exec("UPDATE remote_outages SET ended_at = ?, duration_seconds = ? WHERE started_at = ? AND ended_at IS NULL", receivedAt, duration, previousOutage);
      }
      current.pending_notifications.push({ id: `${current.isp_id}-${current.transition_number}-up`, type: "up", started_at: previousOutage ?? receivedAt, ended_at: receivedAt, latency_ms: current.latency_ms });
      current.outage_started_at = null;
    }
    const updated = await deliverPending(current, this.env);
    await this.save(updated);
    await this.scheduleNext(updated);
    return response({ ok: true, accepted: true, duplicate: false, history_sync: historySyncResponse(updated.history_sync), status: await this.publicStatus(updated) });
  }

  private async acceptHistorySync(payload: unknown): Promise<Response> {
    if (!payload || typeof payload !== "object") return response({ error: "Invalid sync body" }, 400);
    const item = payload as Record<string, unknown>;
    const ispId = item.isp_id === "isp2" ? "isp2" : item.isp_id === "isp1" ? "isp1" : null;
    if (!ispId || item.v !== 2 || typeof item.sync_id !== "string") return response({ error: "Invalid sync body" }, 400);
    const current = await this.load(ispId);
    if (!current.history_sync) current.history_sync = newHistorySync(this.env);
    if (item.sync_id !== current.history_sync.request_id) return response({ ok: false, error: "Sync request expired", history_sync: historySyncResponse(current.history_sync) }, 409);
    const receivedAt = nowIso();
    const heartbeats = Array.isArray(item.heartbeats) ? item.heartbeats : [];
    const speedtests = Array.isArray(item.speedtests) ? item.speedtests : [];
    const outages = Array.isArray(item.outages) ? item.outages : [];
    for (const value of heartbeats) {
      if (!value || typeof value !== "object") continue;
      const beat = value as Record<string, unknown>;
      if (typeof beat.boot_id !== "string" || !Number.isSafeInteger(beat.seq) || (beat.seq as number) < 1 || typeof beat.probe_ts !== "string" || !Number.isInteger(beat.flags) || !Number.isFinite(beat.latency_ms as number) && beat.latency_ms !== null) continue;
      this.state.storage.sql.exec("INSERT OR IGNORE INTO heartbeat_history (boot_id, seq, probe_ts, received_at, flags, latency_ms) VALUES (?, ?, ?, ?, ?, ?)", beat.boot_id, beat.seq, beat.probe_ts, receivedAt, beat.flags, beat.latency_ms);
    }
    for (const value of speedtests) {
      if (!value || typeof value !== "object") continue;
      const speedtest = value as HeartbeatSpeedtest;
      if (!completeSpeedtest(speedtest) || !Number.isSafeInteger(speedtest.result_id) || typeof speedtest.recorded_at !== "string") continue;
      this.state.storage.sql.exec("INSERT OR IGNORE INTO remote_speedtests (result_id, recorded_at, received_at, payload_json) VALUES (?, ?, ?, ?)", speedtest.result_id, speedtest.recorded_at, receivedAt, JSON.stringify(speedtest));
    }
    for (const value of outages) {
      if (!value || typeof value !== "object") continue;
      const outage = value as Record<string, unknown>;
      if (typeof outage.started_at !== "string" || (outage.ended_at !== null && typeof outage.ended_at !== "string") || (outage.duration_seconds !== null && !Number.isInteger(outage.duration_seconds)) || typeof outage.reason !== "string") continue;
      this.state.storage.sql.exec("INSERT OR IGNORE INTO remote_outages (started_at, ended_at, duration_seconds, reason) VALUES (?, ?, ?, ?)", outage.started_at, outage.ended_at, outage.duration_seconds, outage.reason);
    }
    if (item.complete === true) {
      current.history_sync.heartbeat_complete = true;
      current.history_sync.speedtest_complete = true;
      current.history_sync.outage_complete = true;
    }
    this.cleanupHistory();
    await this.save(current);
    return response({ ok: true, sync_id: current.history_sync.request_id, complete: item.complete === true, history_sync: historySyncResponse(current.history_sync) });
  }

  private async statusResponse(ispId: string | null): Promise<Response> {
    return response(await this.publicStatus(await this.load(ispId === "isp2" ? "isp2" : "isp1")));
  }

  private recordHeartbeat(payload: CompactHeartbeat, receivedAt: string): void {
    this.state.storage.sql.exec(
      "INSERT OR IGNORE INTO heartbeat_history (boot_id, seq, probe_ts, received_at, flags, latency_ms) VALUES (?, ?, ?, ?, ?, ?)",
      payload.boot_id,
      payload.seq,
      payload.ts,
      receivedAt,
      payload.f,
      payload.l,
    );
    if (completeSpeedtest(payload.s)) {
      this.state.storage.sql.exec(
        "INSERT OR IGNORE INTO remote_speedtests (result_id, recorded_at, received_at, payload_json) VALUES (?, ?, ?, ?)",
        payload.s.result_id,
        payload.s.recorded_at,
        receivedAt,
        JSON.stringify(payload.s),
      );
    }
    this.cleanupHistory();
  }

  private cleanupHistory(): void {
    const beatCutoff = new Date(Date.now() - getRemoteHistoryHours(this.env) * 3600 * 1000).toISOString();
    const speedtestCutoff = new Date(Date.now() - getRemoteSpeedtestHistoryDays(this.env) * 86400 * 1000).toISOString();
    const outageCutoff = new Date(Date.now() - getRemoteOutageHistoryDays(this.env) * 86400 * 1000).toISOString();
    this.state.storage.sql.exec("DELETE FROM heartbeat_history WHERE probe_ts < ?", beatCutoff);
    this.state.storage.sql.exec("DELETE FROM remote_speedtests WHERE datetime(recorded_at) < datetime(?)", speedtestCutoff);
    this.state.storage.sql.exec("DELETE FROM remote_outages WHERE started_at < ? AND ended_at IS NOT NULL", outageCutoff);
  }

  private latencyHistory(url: URL): Response {
    const requestedHours = this.historyHours(url);
    const retentionHours = getRemoteHistoryHours(this.env);
    const hours = Math.min(requestedHours, retentionHours);
    const retentionSince = new Date(Date.now() - retentionHours * 3600 * 1000).toISOString();
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const rows = this.state.storage.sql.exec<RemoteBeatRow>("SELECT probe_ts, received_at, flags, latency_ms FROM heartbeat_history WHERE probe_ts >= ? ORDER BY probe_ts ASC", since).toArray();
    const oldest = this.state.storage.sql.exec<{ oldest: string | null }>("SELECT MIN(probe_ts) AS oldest FROM heartbeat_history WHERE probe_ts >= ?", retentionSince).toArray()[0]?.oldest ?? null;
    const points = rows.map((row) => ({ recorded_at: row.probe_ts, latency_ms: row.latency_ms }));
    const gaps = this.heartbeatGaps(rows);
    const ispId = this.ispId(url);
    const availableHours = oldest ? Math.min(retentionHours, Math.max(1, Math.ceil((Date.now() - Date.parse(oldest)) / 3600000))) : 0;
    const result: Record<string, unknown> = { isp_id: ispId, label: getIspLabel(this.env, ispId), points, gaps, granularity: "sample", history_available: true, retention_hours: retentionHours, available_hours: availableHours };
    if (url.searchParams.has("hours")) result.hours = hours;
    else result.days = Math.max(1, Math.ceil(hours / 24));
    return response(result);
  }

  private heartbeatGaps(rows: RemoteBeatRow[]): Array<Record<string, unknown>> {
    const gaps: Array<Record<string, unknown>> = [];
    const interval = getProbeIntervalSeconds(this.env);
    const threshold = interval + Math.max(5, Math.floor(interval / 10));
    for (let index = 1; index < rows.length; index += 1) {
      const previous = Date.parse(rows[index - 1].probe_ts);
      const current = Date.parse(rows[index].probe_ts);
      const elapsed = Math.floor((current - previous) / 1000);
      if (Number.isFinite(previous) && Number.isFinite(current) && elapsed > threshold) {
        gaps.push({ started_at: new Date(previous + interval * 1000).toISOString(), ended_at: rows[index].probe_ts, duration_seconds: Math.max(0, elapsed - interval), reason: "heartbeat_missing" });
      }
    }
    const latest = rows[rows.length - 1];
    if (latest) {
      const latestTime = Date.parse(latest.probe_ts);
      const age = Math.floor((Date.now() - latestTime) / 1000);
      if (Number.isFinite(latestTime) && age > threshold) {
        gaps.push({ started_at: new Date(latestTime + interval * 1000).toISOString(), ended_at: nowIso(), duration_seconds: Math.max(0, age - interval), reason: "heartbeat_missing" });
      }
    }
    return gaps;
  }

  private outageHistory(url: URL): Response {
    const retentionDays = getRemoteOutageHistoryDays(this.env);
    const days = Math.min(this.historyDays(url), retentionDays);
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
    const retentionSince = new Date(Date.now() - retentionDays * 86400 * 1000).toISOString();
    const now = nowIso();
    const ispId = this.ispId(url);
    const rows = this.state.storage.sql.exec<RemoteOutageRow>("SELECT id, started_at, ended_at, duration_seconds, reason FROM remote_outages WHERE started_at <= ? AND (ended_at IS NULL OR ended_at >= ?) ORDER BY started_at DESC", now, since).toArray();
    const oldest = this.state.storage.sql.exec<{ oldest: string | null }>("SELECT MIN(started_at) AS oldest FROM remote_outages WHERE started_at >= ?", retentionSince).toArray()[0]?.oldest ?? null;
    const outages = rows.map((row) => ({ id: row.id, started_at: row.started_at, ended_at: row.ended_at, duration_seconds: row.duration_seconds, reason: row.reason, ongoing: row.ended_at === null }));
    const window = Math.max(1, days * 86400);
    let down = 0;
    for (const row of rows) {
      const start = Math.max(Date.parse(since), Date.parse(row.started_at));
      const end = Math.min(Date.parse(now), row.ended_at ? Date.parse(row.ended_at) : Date.now());
      if (Number.isFinite(start) && Number.isFinite(end)) down += Math.max(0, Math.floor((end - start) / 1000));
    }
    const availableDays = oldest ? Math.min(retentionDays, Math.max(1, Math.ceil((Date.now() - Date.parse(oldest)) / 86400000))) : 0;
    return response({ isp_id: ispId, label: getIspLabel(this.env, ispId), days, uptime_percent: Math.round(Math.max(0, window - down) / window * 10000) / 100, outages, history_available: true, retention_days: retentionDays, available_days: availableDays });
  }

  private speedtestHistory(url: URL): Response {
    const requestedDays = this.historyDays(url);
    const retentionDays = getRemoteSpeedtestHistoryDays(this.env);
    const days = Math.min(requestedDays, retentionDays);
    const retentionSince = new Date(Date.now() - retentionDays * 86400 * 1000).toISOString();
    const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
    const ispId = this.ispId(url);
    const rows = this.state.storage.sql.exec<RemoteSpeedtestRow>("SELECT payload_json FROM remote_speedtests WHERE datetime(recorded_at) >= datetime(?) ORDER BY datetime(recorded_at) ASC", since).toArray();
    const oldest = this.state.storage.sql.exec<{ oldest: string | null }>("SELECT MIN(recorded_at) AS oldest FROM remote_speedtests WHERE datetime(recorded_at) >= datetime(?)", retentionSince).toArray()[0]?.oldest ?? null;
    const results = rows.map((row) => JSON.parse(row.payload_json) as HeartbeatSpeedtest).filter((result) => completeSpeedtest(result));
    const availableDays = oldest ? Math.min(retentionDays, Math.max(1, Math.ceil((Date.now() - Date.parse(oldest)) / 86400000))) : 0;
    return response({ isp_id: ispId, label: getIspLabel(this.env, ispId), days, results, history_available: true, retention_days: retentionDays, available_days: availableDays });
  }

  private historyHours(url: URL): number {
    const rawHours = Number.parseInt(url.searchParams.get("hours") ?? "", 10);
    if (Number.isFinite(rawHours)) return Math.min(24 * 30, Math.max(1, rawHours));
    const rawDays = Number.parseInt(url.searchParams.get("days") ?? "", 10);
    return Math.min(24 * 30, Math.max(1, (Number.isFinite(rawDays) ? rawDays : 1) * 24));
  }

  private historyDays(url: URL): number {
    const rawDays = Number.parseInt(url.searchParams.get("days") ?? "", 10);
    return Math.min(365, Math.max(1, Number.isFinite(rawDays) ? rawDays : 7));
  }

  private ispId(url: URL): CompactHeartbeat["isp_id"] {
    return url.searchParams.get("isp") === "isp2" ? "isp2" : "isp1";
  }

  private latestSpeedtest(state: PresenceState): HeartbeatSpeedtest | null {
    let latest = completeSpeedtest(state.latest_speedtest) ? state.latest_speedtest : null;
    const rows = this.state.storage.sql.exec<RemoteSpeedtestRow>("SELECT payload_json FROM remote_speedtests ORDER BY datetime(recorded_at) DESC LIMIT 256").toArray();
    for (const row of rows) {
      try {
        const candidate = JSON.parse(row.payload_json) as HeartbeatSpeedtest;
        if (!completeSpeedtest(candidate)) continue;
        const candidateTime = Date.parse(candidate.recorded_at);
        const latestTime = latest ? Date.parse(latest.recorded_at) : NaN;
        if (!latest || (Number.isFinite(candidateTime) && (!Number.isFinite(latestTime) || candidateTime > latestTime))) latest = candidate;
      } catch {
        continue;
      }
    }
    return latest;
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
      latest_speedtest: this.latestSpeedtest(state),
      notify_state: state.pending_notifications.length ? "pending" : "clear",
    };
  }
}
