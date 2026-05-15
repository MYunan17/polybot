import { logger } from "../logger";
import { OpenClawClient } from "../services/openclawClient";

function shortId(value?: string): string {
  if (!value) return "";
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function fmtNumber(value: string | number | undefined, digits = 4): string {
  const num = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(num) ? (num as number).toFixed(digits) : "-";
}

function fmtTimestamp(ts?: string): string {
  if (!ts) return "";
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? ts : date.toISOString();
}

void (async () => {
  const client = new OpenClawClient();
  const trades = await client.listRecentTrades(20);
  if (!trades.length) {
    console.log("No recent trades for current credentials.");
    return;
  }

  console.log(`Showing up to 20 recent trades:`);
  for (const trade of trades) {
    const fields = [
      `trade=${shortId(trade.id)}`,
      `token=${shortId(trade.asset_id)}`,
      `side=${trade.side}`,
      `price=${fmtNumber(trade.price, 4)}`,
      `size=${fmtNumber(trade.size, 4)}`,
      `matched_at=${fmtTimestamp(trade.match_time)}`
    ];
    console.log(fields.join(" | "));
  }
})().catch((err) => {
  logger.error({ err }, "openclaw:trades failed");
  process.exit(1);
});
