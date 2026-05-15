import { initDb, closeDb } from "../db";
import { logger } from "../logger";
import { SqliteStore } from "../services/sqliteStore";

function fmt(value: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

void (async () => {
  await initDb();
  const store = new SqliteStore();
  const executions = await store.listOpenClawExecutions(20);
  if (!executions.length) {
    console.log("No OpenClaw executions recorded yet.");
    await closeDb();
    return;
  }

  console.log("Recent OpenClaw executions:");
  for (const exec of executions) {
    const parts = [
      `id=${exec.id}`,
      `plan_id=${exec.planId}`,
      `market_id=${exec.marketId}`,
      `status=${exec.status}`,
      `size_usd=${fmt(exec.sizeUsd)}`,
      `limit_price=${fmt(exec.limitPrice, 4)}`,
      `tx_or_order_id=${exec.txOrOrderId ?? ""}`,
      `error=${exec.errorMessage ?? ""}`,
      `created_at=${exec.createdAt}`
    ];
    console.log(parts.join(" | "));
  }
  await closeDb();
})().catch(async (err) => {
  logger.error({ err }, "openclaw:executions failed");
  await closeDb();
  process.exit(1);
});
