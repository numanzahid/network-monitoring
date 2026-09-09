import type { NotificationPayload } from "../types";

export interface Notifier {
  readonly channel: string;
  isConfigured(): boolean;
  send(payload: NotificationPayload): Promise<void>;
}

export interface NotifierFactoryContext {
  ntfyServer: string;
  ntfyTopic: string;
  ntfyAuthToken?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  discordWebhookUrl?: string;
}
