import { SignatureTypeV2 } from "@polymarket/clob-client-v2";
import { closeDb, initDb } from "../db";
import { config } from "../config";
import { logger } from "../logger";
import { OpenClawClient } from "../services/openclawClient";
import { SqliteStore } from "../services/sqliteStore";
import { buildExecutionRequestFromPlan } from "../services/openClawLiveExecutor";

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

function preview(value?: string): string {
  if (!value) return "n/a";
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
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
  const { payload, payloadHash } = await client.buildVersionedPostPayload(request);

  const relayerHeadersPresent = Boolean(
    config.POLYMARKET_RELAYER_API_KEY?.trim() && config.POLYMARKET_RELAYER_API_KEY_ADDRESS?.trim()
  );
  const signatureType = payload.order.signatureType;

  console.log("OpenClaw relayer payload preview:");
  console.log(`plan_id=${plan.id}`);
  console.log(`market_id=${plan.marketId}`);
  console.log(`owner=${preview(payload.owner)}`);
  console.log(`maker=${preview(payload.order.maker)}`);
  console.log(`signer=${preview(payload.order.signer)}`);
  console.log(`tokenId=${payload.order.tokenId}`);
  console.log(`side=${payload.order.side}`);
  console.log(`makerAmount=${payload.order.makerAmount}`);
  console.log(`takerAmount=${payload.order.takerAmount}`);
  console.log(`signature_type=${signatureType}`);
  console.log(`relayer_payload_sha256=${payloadHash}`);
  console.log(`relayer_headers_present=${relayerHeadersPresent ? "yes" : "no"}`);

  if (Number(signatureType) !== SignatureTypeV2.POLY_1271) {
    console.log("warning=builder relayer path expects POLY_1271 signature type");
  }

  if (!relayerHeadersPresent) {
    console.log("warning=Relayer API key/address not configured; configure POLYMARKET_RELAYER_API_KEY and POLYMARKET_RELAYER_API_KEY_ADDRESS");
  }

  await closeDb();
})().catch(async (err) => {
  logger.error({ err }, "openclaw:relayer-payload-preview failed");
  await closeDb();
  process.exit(1);
});
