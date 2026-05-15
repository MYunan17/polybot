import { SignatureTypeV2 } from "@polymarket/clob-client-v2";
import { closeDb, initDb } from "../db";
import { config } from "../config";
import { logger } from "../logger";
import { OpenClawClient } from "../services/openclawClient";
import { SqliteStore } from "../services/sqliteStore";
import { buildExecutionRequestFromPlan } from "../services/openClawLiveExecutor";
import { getAddress } from "viem";

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

function secretPreview(value?: string): string {
  if (!value) return "n/a";
  const prefix = value.slice(0, 4);
  return `${prefix}… (len=${value.length})`;
}

function normalizeAddress(raw?: string): `0x${string}` | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    return getAddress(trimmed);
  } catch {
    return undefined;
  }
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
  const { payload, signedOrder, sizeTokens, payloadHash } = await client.buildVersionedPostPayload(request);
  const normalizedFunder = normalizeAddress(config.POLYMARKET_FUNDER_ADDRESS);
  const owner = payload.owner;
  const maker = payload.order.maker;
  const signer = payload.order.signer;
  const apiKey = config.OPENCLAW_API_KEY?.trim();
  const ownerIsApiKey = Boolean(apiKey && owner === apiKey);
  const ownerMatchesFunder = Boolean(
    normalizedFunder && typeof owner === "string" && owner.toLowerCase() === normalizedFunder.toLowerCase()
  );
  const ownerIsNotFunder = ownerIsApiKey && !ownerMatchesFunder;
  const makerMatchesFunder = Boolean(normalizedFunder && maker?.toLowerCase() === normalizedFunder.toLowerCase());
  const signerMatchesFunder = Boolean(normalizedFunder && signer?.toLowerCase() === normalizedFunder.toLowerCase());
  const signatureType = payload.order.signatureType;
  const signatureTypeIsPoly1271 = Number(signatureType) === SignatureTypeV2.POLY_1271;

  console.log("OpenClaw docs-aligned CLOB preview (no submission):");
  console.log(`plan_id=${plan.id}`);
  console.log(`market_id=${plan.marketId}`);
  console.log(`order_type=${payload.orderType}`);
  console.log(`docs_payload_sha256=${payloadHash}`);
  console.log(`owner_preview=${secretPreview(owner)}`);
  console.log(`owner_is_api_key=${ownerIsApiKey}`);
  console.log(`owner_is_not_funder=${ownerIsNotFunder}`);
  console.log(`maker=${preview(maker)}`);
  console.log(`signer=${preview(signer)}`);
  console.log(`maker_matches_funder=${makerMatchesFunder}`);
  console.log(`signer_matches_funder=${signerMatchesFunder}`);
  console.log(`tokenId=${payload.order.tokenId}`);
  console.log(`side=${payload.order.side}`);
  console.log(`makerAmount=${payload.order.makerAmount}`);
  console.log(`takerAmount=${payload.order.takerAmount}`);
  console.log(`signature_type=${signatureType}`);
  console.log(`payload_signature_type_is_3=${signatureTypeIsPoly1271}`);
  console.log(`size_tokens=${sizeTokens.toFixed(6)}`);
  console.log(`price=${signedOrder.price}`);
  console.log(
    "warning=POLY_1271 deposit wallets: relayer auth is only for wallet deploy/batches. Orders always use CLOB API key + L2 headers."
  );

  await closeDb();
})().catch(async (err) => {
  logger.error({ err }, "openclaw:docs-clob-preview failed");
  await closeDb();
  process.exit(1);
});
