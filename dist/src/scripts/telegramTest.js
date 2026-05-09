"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const telegramClient_1 = require("../services/telegramClient");
void (async () => {
    const t = new telegramClient_1.TelegramClient();
    await t.sendText("Telegram test OK");
    console.log("telegram test sent (if configured)");
})();
