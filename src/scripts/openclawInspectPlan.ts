import { closeDb, initDb } from "../db";
import { config } from "../config";
import { logger } from "../logger";
import { OpenClawClient } from "../services/openclawClient";
import { buildExecutionRequestFromPlan } from "../services/openClawLiveExecutor";
import { SqliteStore } from "../services/sqliteStore";

function requirePlanId(): number {
  const idx = process.argv.findIndex((arg) => arg === "--plan-id");
  if (idx === -1 || idx + 1 >= process.argv.length) {
    throw new Error("Missing --plan-id <id>");
  }
  const planId = Number(process.argv[idx + 1]);
  if (!Number.isInteger(planId) || planId <= 0) {
    throw new Error("Invalid plan id");
  }
  return planId;
}

void (async () => {
  const planId = requirePlanId();
  await initDb();
  const store = new SqliteStore();
  const plan = await store.getOpenClawPlanById(planId);
  if (!plan) {
    console.log(`Plan ${planId} not found.`);
    await closeDb();
    return;
  }

  console.log("Plan summary:");
  console.log(JSON.stringify(plan, null, 2));

  const executions = await store.listOpenClawExecutionsByPlan(planId);
  console.log("Executions:");
  if (!executions.length) {
    console.log("  (none)");
  } else {
    for (const exec of executions) {
      console.log(`  [${exec.id}] status=${exec.status} size=${exec.sizeUsd} price=${exec.limitPrice} order_id=${exec.txOrOrderId ?? ""} error=${exec.errorMessage ?? ""}`);
    }
  }

  const cappedSizeUsd = Math.min(plan.sizeUsd, config.OPENCLAW_MAX_ORDER_USD);
  const request = await buildExecutionRequestFromPlan(store, plan, config, cappedSizeUsd, plan.limitPrice);
  if (!request) {
    console.log("Unable to rehydrate execution request for this plan.");
  } else {
    console.log("Rehydrated execution request (not submitting):");
    console.log(JSON.stringify({ marketId: request.marketId, tokenId: request.tokenId, limitPrice: request.limitPrice, sizeUsd: request.sizeUsd }, null, 2));
  }

  const latestExec = executions[0];
  if (latestExec?.txOrOrderId) {
    const client = new OpenClawClient();
    try {
      const order = await client.getOpenOrderById(latestExec.txOrOrderId);
      logger.debug({ responseKeys: order ? Object.keys(order).slice(0, 20) : [] }, "Inspect plan open orders keys");
      if (order) {
        console.log("Order still open:");
        console.log(JSON.stringify(order, null, 2));
      } else {
        console.log("Order id not present in current open orders.");
      }
    } catch (err) {
      logger.error({ err }, "Failed to load open orders for inspection");
    }
  }
  await closeDb();
})().catch(async (err) => {
  logger.error({ err }, "openclaw:inspect-plan failed");
  await closeDb();
  process.exit(1);
});
