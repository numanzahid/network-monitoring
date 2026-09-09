import type { Env, IspId, NotificationPayload, NotificationType, OutageEventRow } from "../types";
import { getEnabledNotifierChannels, getIspLabel, isNotifyEnabled } from "../config";
import { getIspStatus, listPendingNotifications, logNotification, markOutageNotified } from "../db";
import { createDiscordNotifier } from "./discord";
import { createNtfyNotifier } from "./ntfy";
import { createTelegramNotifier } from "./telegram";
import type { Notifier, NotifierFactoryContext } from "./types";

function buildNotifierContext(env: Env): NotifierFactoryContext {
  return {
    ntfyServer: env.NTFY_SERVER,
    ntfyTopic: env.NTFY_TOPIC,
    ntfyAuthToken: env.NTFY_AUTH_TOKEN,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramChatId: env.TELEGRAM_CHAT_ID,
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL,
  };
}

const NOTIFIER_FACTORIES: Record<
  string,
  (context: NotifierFactoryContext) => Notifier
> = {
  ntfy: createNtfyNotifier,
  telegram: createTelegramNotifier,
  discord: createDiscordNotifier,
};

export function createNotifiers(env: Env): Notifier[] {
  const context = buildNotifierContext(env);
  const channels = getEnabledNotifierChannels(env);
  const notifiers: Notifier[] = [];

  for (const channel of channels) {
    const factory = NOTIFIER_FACTORIES[channel];
    if (!factory) {
      continue;
    }
    const notifier = factory(context);
    if (notifier.isConfigured()) {
      notifiers.push(notifier);
    }
  }

  return notifiers;
}

function formatTimestamp(value: string): string {
  return new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

export function buildDownNotification(
  env: Env,
  ispId: IspId,
  reason: string,
  lastSeenAt: string,
  publicIpv4: string | null,
): NotificationPayload {
  const label = getIspLabel(env, ispId);
  const lines = [
    `Internet checks failed repeatedly.`,
    `Reason: ${reason}`,
    `Last seen: ${formatTimestamp(lastSeenAt)}`,
  ];
  if (publicIpv4) {
    lines.push(`Last public IP: ${publicIpv4}`);
  }
  if (env.STATUS_PAGE_URL) {
    lines.push(`Status: ${env.STATUS_PAGE_URL}`);
  }

  return {
    type: "down",
    title: `[DOWN] ${label}`,
    body: lines.join("\n"),
    priority: env.NTFY_PRIORITY_DOWN as NotificationPayload["priority"],
    tags: ["warning", ispId, "down"],
  };
}

export function buildRecoveryNotification(
  env: Env,
  ispId: IspId,
  outage: OutageEventRow,
  publicIpv4: string | null,
): NotificationPayload {
  const label = getIspLabel(env, ispId);
  const duration = outage.duration_seconds ?? 0;
  const lines = [
    `Back online after ${formatDuration(duration)}.`,
    `Down: ${formatTimestamp(outage.started_at)}`,
    `Up: ${formatTimestamp(outage.ended_at ?? new Date().toISOString())}`,
  ];
  if (publicIpv4) {
    lines.push(`Public IP: ${publicIpv4}`);
  }
  if (env.STATUS_PAGE_URL) {
    lines.push(`Status: ${env.STATUS_PAGE_URL}`);
  }

  return {
    type: "recovery",
    title: `[UP] ${label}`,
    body: lines.join("\n"),
    priority: env.NTFY_PRIORITY_UP as NotificationPayload["priority"],
    tags: ["white_check_mark", ispId, "up"],
  };
}

export async function sendNotification(
  env: Env,
  ispId: IspId,
  outageId: number | null,
  payload: NotificationPayload,
): Promise<boolean> {
  if (!isNotifyEnabled(env)) {
    return true;
  }

  const notifiers = createNotifiers(env);
  if (notifiers.length === 0) {
    return false;
  }

  const sentAt = new Date().toISOString();
  let allSucceeded = true;

  for (const notifier of notifiers) {
    try {
      await notifier.send(payload);
      await logNotification(env.DB, {
        ispId,
        outageId,
        type: payload.type,
        channel: notifier.channel,
        success: true,
        errorMessage: null,
        sentAt,
      });
    } catch (error) {
      allSucceeded = false;
      const message = error instanceof Error ? error.message : "Unknown notification error";
      await logNotification(env.DB, {
        ispId,
        outageId,
        type: payload.type,
        channel: notifier.channel,
        success: false,
        errorMessage: message,
        sentAt,
      });
    }
  }

  return allSucceeded;
}

export async function notifyOutageDown(
  env: Env,
  ispId: IspId,
  outage: OutageEventRow,
  reason: string,
  lastSeenAt: string,
  publicIpv4: string | null,
): Promise<void> {
  if (outage.notified_down_at) {
    return;
  }

  const payload = buildDownNotification(env, ispId, reason, lastSeenAt, publicIpv4);
  const success = await sendNotification(env, ispId, outage.id, payload);
  if (success) {
    await markOutageNotified(env.DB, outage.id, "down", new Date().toISOString());
  }
}

export async function notifyOutageRecovery(
  env: Env,
  ispId: IspId,
  outage: OutageEventRow,
  publicIpv4: string | null,
): Promise<void> {
  if (outage.notified_up_at) {
    return;
  }

  const payload = buildRecoveryNotification(env, ispId, outage, publicIpv4);
  const success = await sendNotification(env, ispId, outage.id, payload);
  if (success) {
    await markOutageNotified(env.DB, outage.id, "recovery", new Date().toISOString());
  }
}

export async function retryPendingNotifications(env: Env): Promise<void> {
  const outages = await listPendingNotifications(env.DB);

  for (const outage of outages) {
    const ispId = outage.isp_id as IspId;
    const status = await getIspStatus(env.DB, ispId);
    const publicIpv4 = status?.public_ipv4 ?? null;

    if (!outage.ended_at && !outage.notified_down_at) {
      await notifyOutageDown(
        env,
        ispId,
        outage,
        outage.reason ?? "unknown",
        outage.started_at,
        publicIpv4,
      );
      continue;
    }

    if (outage.ended_at && !outage.notified_up_at) {
      await notifyOutageRecovery(env, ispId, outage, publicIpv4);
    }
  }
}
