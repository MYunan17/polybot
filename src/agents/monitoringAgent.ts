import { TelegramClient } from "../services/telegramClient";
import { TelegramNotification } from "../types";

export class MonitoringAgent {
  constructor(private readonly telegram: TelegramClient) {}

  async run(note: TelegramNotification): Promise<void> {
    await this.telegram.sendNotification(note);
  }
}
