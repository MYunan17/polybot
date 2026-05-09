import axios from "axios";
import { config } from "../config";
import { TelegramNotification } from "../types";

export class TelegramClient {
  get enabled(): boolean {
    return Boolean(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID);
  }

  async sendText(text: string): Promise<void> {
    if (!this.enabled) return;
    const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
    await axios.post(url, { chat_id: config.TELEGRAM_CHAT_ID, text }, { timeout: 10000 });
  }

  async sendNotification(n: TelegramNotification): Promise<void> {
    const fmtPct = (v?: number) => (v === undefined ? "-" : `${(v * 100).toFixed(2)}%`);
    const text = [
      `Market: ${n.market}`,
      `MiroFish Raw: ${fmtPct(n.rawProbability)}`,
      `Calibrated: ${fmtPct(n.adjustedProbability)}`,
      `Odds/Price: ${fmtPct(n.price)}`,
      `Spread: ${fmtPct(n.spread)}`,
      `Edge: ${fmtPct(n.edge)}`,
      `Action: ${n.action}`,
      `Risk: ${n.risk}`,
      `URL: ${n.url ?? "-"}`,
      n.extra ? `Note: ${n.extra}` : ""
    ].filter(Boolean).join("\n");
    await this.sendText(text);
  }
}
