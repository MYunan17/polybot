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

function fmtTimestamp(ts?: number | string): string {
  if (ts == null) return "";
  const date = typeof ts === "number" ? new Date(ts * 1000) : new Date(Number(ts) || ts);
  return Number.isNaN(date.getTime()) ? String(ts) : date.toISOString();
}

void (async () => {
  const client = new OpenClawClient();
  const orders = await client.listOpenOrders(20);
  if (!orders.length) {
    console.log("No open orders for current credentials.");
    return;
  }

  console.log(`Found ${orders.length} open order(s). Showing up to 20:`);
  for (const order of orders) {
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
