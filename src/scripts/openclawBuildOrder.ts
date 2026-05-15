import { closeDb, initDb } from "../db";
import { config } from "../config";
import { logger } from "../logger";
import { OpenClawClient } from "../services/openclawClient";
import { buildExecutionRequestFromPlan } from "../services/openClawLiveExecutor";
import { SqliteStore } from "../services/sqliteStore";

function shortValue(value?: string): string {
  if (!value) return "n/a";
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function signatureTypeLabel(): string {
  const typeValue = Number(config.POLYMARKET_SIGNATURE_TYPE ?? 0);
  if (typeValue === 3) return "POLY_1271";
  if (typeValue === 2) return "POLY_GNOSIS_SAFE";
  if (typeValue === 1) return "POLY_PROXY";
  if (typeValue === 0) return "EOA";
  return `type_${typeValue}`;
}

interface CliOptions {
  planId: number;
}

function parseArgs(): CliOptions {
  const idx = process.argv.findIndex((arg) => arg === "--plan-id");
  if (idx === -1 || idx + 1 >= process.argv.length) {
    throw new Error("Missing --plan-id <id>");
  }
  const planId = Number(process.argv[idx + 1]);
  if (!Number.isInteger(planId) || planId <= 0) {
    throw new Error("plan-id must be a positive integer");
  }
  return { planId };
}

void (async () => {
  const { planId } = parseArgs();
  await initDb();
  const store = new SqliteStore();
  const plan = await store.getOpenClawPlanById(planId);
  if (!plan) {
    throw new Error(`Plan ${planId} not found`);
  }
  const cappedSizeUsd = Math.min(plan.sizeUsd, config.OPENCLAW_MAX_ORDER_USD);
  if (!(cappedSizeUsd > 0)) {
    throw new Error(`Plan ${planId} has invalid size`);
  }

  const request = await buildExecutionRequestFromPlan(store, plan, config, cappedSizeUsd, plan.limitPrice);
  if (!request) {
    throw new Error("Unable to build execution request for this plan");
  }

  const client = new OpenClawClient();
  const preview = await client.buildLimitOrder(request);
  const tokenShort = preview.tokenID ? `${preview.tokenID.slice(0, 6)}…` : "n/a";

  console.log("OpenClaw order build preview:");
  console.log(`plan_id=${plan.id}`);
  console.log(`market_id=${plan.marketId}`);
  console.log(`token_id=${tokenShort}`);
  console.log(`tokenID=${preview.tokenID}`);
  console.log(`side=${preview.side}`);
  console.log(`size_usd=${request.sizeUsd.toFixed(2)}`);
  console.log(`size_tokens=${preview.sizeTokens.toFixed(4)}`);
  console.log(`price=${preview.price.toFixed(4)}`);
  console.log(`limit_price=${request.limitPrice.toFixed(4)}`);
  console.log(`order_type=${preview.orderType}`);
  console.log(`signature_type=${config.POLYMARKET_SIGNATURE_TYPE} (${signatureTypeLabel()})`);
  console.log(`funder_address=${shortValue(config.POLYMARKET_FUNDER_ADDRESS)}`);
  console.log(`tick_size=${preview.tickSize}`);
  console.log(`neg_risk=${preview.negRisk}`);
  if (preview.orderHash) {
    console.log(`order_hash=${preview.orderHash}`);
  }
  await closeDb();
})().catch(async (err) => {
  logger.error({ err }, "openclaw:build-order failed");
  await closeDb();
  process.exit(1);
});
