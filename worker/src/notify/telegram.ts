import type { NotificationPayload } from "../types";
import type { Notifier, NotifierFactoryContext } from "./types";

export class TelegramNotifier implements Notifier {
  readonly channel = "telegram";

  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
  ) {}

  isConfigured(): boolean {
    return this.botToken.length > 0 && this.chatId.length > 0;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const text = `*${payload.title}*\n\n${payload.body}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`telegram request failed (${response.status}): ${body}`);
    }
  }
}

export function createTelegramNotifier(context: NotifierFactoryContext): TelegramNotifier {
  return new TelegramNotifier(
    context.telegramBotToken ?? "",
    context.telegramChatId ?? "",
  );
}
