"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramClient = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
class TelegramClient {
    get enabled() {
        return Boolean(config_1.config.TELEGRAM_BOT_TOKEN && config_1.config.TELEGRAM_CHAT_ID);
    }
    async sendText(text) {
        if (!this.enabled)
            return;
        const url = `https://api.telegram.org/bot${config_1.config.TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios_1.default.post(url, { chat_id: config_1.config.TELEGRAM_CHAT_ID, text }, { timeout: 10000 });
    }
    async sendNotification(n) {
        const fmtPct = (v) => (v === undefined ? "-" : `${(v * 100).toFixed(2)}%`);
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
exports.TelegramClient = TelegramClient;
