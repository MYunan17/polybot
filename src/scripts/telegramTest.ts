import { TelegramClient } from "../services/telegramClient";

void (async () => {
  const t = new TelegramClient();
  await t.sendText("Telegram test OK");
  console.log("telegram test sent (if configured)");
})();
