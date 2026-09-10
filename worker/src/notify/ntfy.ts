import type { NotificationPayload } from "../types";
import type { Notifier, NotifierFactoryContext } from "./types";

export class NtfyNotifier implements Notifier {
  readonly channel = "ntfy";

  constructor(
    private readonly server: string,
    private readonly topic: string | undefined,
    private readonly authToken?: string,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.server) && Boolean(this.topic && this.topic.length > 0);
  }

  async send(payload: NotificationPayload): Promise<void> {
    const url = `${this.server.replace(/\/$/, "")}/${encodeURIComponent(this.topic ?? "")}`;
    const headers: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
      Title: payload.title,
      Tags: (payload.tags ?? []).join(","),
    };

    if (payload.priority) {
      headers.Priority = payload.priority;
    }
    if (payload.clickUrl) {
      headers.Click = payload.clickUrl;
    }
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: payload.body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ntfy request failed (${response.status}): ${text}`);
    }
  }
}

export function createNtfyNotifier(context: NotifierFactoryContext): NtfyNotifier {
  return new NtfyNotifier(context.ntfyServer, context.ntfyTopic, context.ntfyAuthToken);
}
