import { SignatureTypeV2 } from "@polymarket/clob-client-v2";
import { getAddress } from "viem";
import { config } from "../config";
import { logger } from "../logger";
import { OpenClawClient } from "../services/openclawClient";
import { SqliteStore } from "../services/sqliteStore";
import { buildExecutionRequestFromPlan } from "../services/openClawLiveExecutor";
import { closeDb, initDb } from "../db";

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

function normalizeAddress(raw?: string): `0x${string}` | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    return getAddress(trimmed);
  } catch {
    return undefined;
  }
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

function signaturePreview(value?: string): string {
  if (!value) return "n/a";
  const prefix = value.slice(0, 10);
  return `${prefix}… (len=${value.length})`;
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

  const owner = payload.owner;
  const maker = payload.order.maker;
  const signer = payload.order.signer;
  const signatureType = payload.order.signatureType;
  const normalizedFunder = normalizeAddress(config.POLYMARKET_FUNDER_ADDRESS);
  const ownerMatchesFunder = Boolean(
    normalizedFunder && typeof owner === "string" && owner.toLowerCase() === normalizedFunder.toLowerCase()
  );
  const makerMatchesFunder = Boolean(normalizedFunder && maker?.toLowerCase() === normalizedFunder.toLowerCase());
  const signerMatchesFunder = Boolean(normalizedFunder && signer?.toLowerCase() === normalizedFunder.toLowerCase());
  const signatureTypeIsPoly1271 = Number(signatureType) === SignatureTypeV2.POLY_1271;

  console.log("OpenClaw dry payload inspector:");
  console.log(`plan_id=${plan.id}`);
  console.log(`market_id=${plan.marketId}`);
  console.log(`order_type=${payload.orderType}`);
  console.log(`dry_payload_sha256=${payloadHash}`);
  console.log(`owner_preview=${secretPreview(owner)}`);
  console.log(`maker=${preview(maker)}`);
  console.log(`signer=${preview(signer)}`);
  console.log(`signature_type=${signatureType}`);
  console.log(`signature_preview=${signaturePreview(payload.order.signature)}`);
  console.log(`size_tokens=${sizeTokens.toFixed(6)}`);
  console.log(`price=${signedOrder.price}`);
  console.log(`payload_owner_matches_funder=${ownerMatchesFunder}`);
  console.log(`payload_maker_matches_funder=${makerMatchesFunder}`);
  console.log(`payload_signer_matches_funder=${signerMatchesFunder}`);
  console.log(`payload_signature_type_is_3=${signatureTypeIsPoly1271}`);

  await closeDb();
})().catch(async (err) => {
  logger.error({ err }, "openclaw:submit-dry-payload failed");
  await closeDb();
  process.exit(1);
});
