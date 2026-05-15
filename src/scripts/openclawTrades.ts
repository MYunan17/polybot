import { logger } from "../logger";
import { OpenClawClient } from "../services/openclawClient";

interface CliFilters {
  tokenId?: string;
  marketId?: string;
}

function parseArgs(): CliFilters {
  const filters: CliFilters = {};
  for (let i = 0; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--token-id" && i + 1 < process.argv.length) {
      filters.tokenId = process.argv[i + 1];
    }
    if (arg === "--market-id" && i + 1 < process.argv.length) {
      filters.marketId = process.argv[i + 1];
    }
  }
  return filters;
}

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
  const filters = parseArgs();
  const client = new OpenClawClient();
  const trades = await client.listRecentTrades(50);
  if (!trades.length) {
    console.log("No recent trades for current credentials.");
    return;
  }

  const filtered = trades.filter((trade) => {
    if (filters.tokenId && trade.asset_id !== filters.tokenId) return false;
    if (filters.marketId && trade.market !== filters.marketId) return false;
    return true;
  });

  console.log(
    `Fetched ${trades.length} trades. After filters token=${filters.tokenId ?? "*"} market=${filters.marketId ?? "*"}, showing ${Math.min(
      filtered.length,
      20
    )}:`
  );
  logger.debug({ responseKeys: trades.length ? Object.keys(trades[0]).slice(0, 20) : [] }, "Trades response keys");

  if (!filtered.length) {
    console.log("No trades matched filters.");
    return;
  }

  for (const trade of filtered.slice(0, 20)) {
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
