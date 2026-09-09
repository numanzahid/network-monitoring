import type { NotificationPayload } from "../types";
import type { Notifier, NotifierFactoryContext } from "./types";

export class DiscordNotifier implements Notifier {
  readonly channel = "discord";

  constructor(private readonly webhookUrl: string) {}

  isConfigured(): boolean {
    return this.webhookUrl.length > 0;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Network Monitoring",
        embeds: [
          {
            title: payload.title,
            description: payload.body,
            color: payload.type === "down" ? 0xdc2626 : 0x16a34a,
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`discord request failed (${response.status}): ${body}`);
    }
  }
}

export function createDiscordNotifier(context: NotifierFactoryContext): DiscordNotifier {
  return new DiscordNotifier(context.discordWebhookUrl ?? "");
}
