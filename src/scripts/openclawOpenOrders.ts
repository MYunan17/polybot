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

function fmtTimestamp(ts?: number | string): string {
  if (ts == null) return "";
  const date = typeof ts === "number" ? new Date(ts * 1000) : new Date(Number(ts) || ts);
  return Number.isNaN(date.getTime()) ? String(ts) : date.toISOString();
}

void (async () => {
  const filters = parseArgs();
  const client = new OpenClawClient();
  const orders = await client.listOpenOrders(50);
  if (!orders.length) {
    console.log("No open orders for current credentials.");
    return;
  }

  const filtered = orders.filter((order) => {
    if (filters.tokenId && order.asset_id !== filters.tokenId) return false;
    if (filters.marketId && order.market !== filters.marketId) return false;
    return true;
  });

  console.log(
    `Found ${orders.length} open order(s). After filters token=${filters.tokenId ?? "*"} market=${filters.marketId ?? "*"}, showing ${Math.min(filtered.length, 20)}:`
  );
  logger.debug({ responseKeys: orders.length ? Object.keys(orders[0]).slice(0, 20) : [] }, "Open orders response keys");

  if (!filtered.length) {
    console.log("No open orders matched filters.");
    return;
  }

  for (const order of filtered.slice(0, 20)) {
    const remainingRaw = Number(order.original_size ?? 0) - Number(order.size_matched ?? 0);
    const fields = [
      `order=${shortId(order.id ?? (order as any).orderId ?? (order as any).orderID)}`,
      `token=${shortId(order.asset_id)}`,
      `side=${order.side}`,
      `price=${fmtNumber(order.price, 4)}`,
      `size=${fmtNumber(order.original_size, 4)}`,
      `remaining=${Number.isFinite(remainingRaw) ? remainingRaw.toFixed(4) : "-"}`,
      `status=${order.status}`,
      `created=${fmtTimestamp(order.created_at)}`
    ];
    console.log(fields.join(" | "));
  }
})().catch((err) => {
  logger.error({ err }, "openclaw:open-orders failed");
  process.exit(1);
});
