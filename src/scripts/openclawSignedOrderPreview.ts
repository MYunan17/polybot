import { closeDb, initDb } from "../db";
import { config } from "../config";
import { logger } from "../logger";
import { OpenClawClient } from "../services/openclawClient";
import { SqliteStore } from "../services/sqliteStore";
import { buildExecutionRequestFromPlan } from "../services/openClawLiveExecutor";
import { privateKeyToAccount } from "viem/accounts";
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

function normalizeAddress(raw?: string): `0x${string}` | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    return getAddress(trimmed);
  } catch {
    return undefined;
  }
}

function signaturePreview(signature?: string): string {
  if (!signature) return "n/a";
  const prefix = signature.slice(0, 10);
  return `${prefix}… (len=${signature.length})`;
}

function normalizePrivateKey(raw?: string): `0x${string}` | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("0x") ? (trimmed as `0x${string}`) : (`0x${trimmed}` as `0x${string}`);
}

function signatureTypeLabel(typeValue: number): string {
  if (typeValue === 3) return "POLY_1271";
  if (typeValue === 2) return "POLY_GNOSIS_SAFE";
  if (typeValue === 1) return "POLY_PROXY";
  if (typeValue === 0) return "EOA";
  return `type_${typeValue}`;
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
  const { signedOrder, userOrder, sizeTokens } = await client.buildSignedOrderPreview(request);

  const maker = signedOrder?.maker ?? "";
  const signer = signedOrder?.signer ?? "";
  const taker = (signedOrder as any)?.taker ?? "n/a";
  const salt = signedOrder?.salt ?? "";
  const expiration = signedOrder?.expiration ?? "";
  const nonce = (signedOrder as any)?.nonce;
  const signatureValue = typeof signedOrder?.signature === "string" ? signedOrder.signature : undefined;
  const normalizedFunder = normalizeAddress(config.POLYMARKET_FUNDER_ADDRESS);
  const privateKey = normalizePrivateKey(config.POLYMARKET_PRIVATE_KEY);
  const account = privateKey ? privateKeyToAccount(privateKey) : undefined;
  const eoa = account?.address;

  const makerMatchesFunder = Boolean(normalizedFunder && maker && maker.toLowerCase() === normalizedFunder.toLowerCase());
  const signerMatchesFunder = Boolean(normalizedFunder && signer && signer.toLowerCase() === normalizedFunder.toLowerCase());
  const signerMatchesEoa = Boolean(eoa && signer && signer.toLowerCase() === eoa.toLowerCase());

  console.log("OpenClaw signed order preview:");
  console.log(`plan_id=${plan.id}`);
  console.log(`market_id=${plan.marketId}`);
  console.log(`expected_deposit_wallet=${normalizedFunder ?? "n/a"}`);
  console.log(`maker=${maker || "n/a"}`);
  console.log(`signer=${signer || "n/a"}`);
  console.log(`taker=${taker}`);
  console.log(`tokenId=${(signedOrder as any)?.tokenId ?? "n/a"}`);
  console.log(`tokenID=${userOrder.tokenID}`);
  console.log(`side=${signedOrder?.side ?? userOrder.side}`);
  console.log(`price=${userOrder.price.toFixed(4)}`);
  console.log(`size_tokens=${sizeTokens.toFixed(6)}`);
  const orderSignatureType = Number(signedOrder?.signatureType ?? config.POLYMARKET_SIGNATURE_TYPE ?? 0);
  console.log(`signature_type=${signedOrder?.signatureType ?? "n/a"} (${signatureTypeLabel(orderSignatureType)})`);
  console.log(`salt=${salt || "n/a"}`);
  console.log(`expiration=${expiration || "0"}`);
  if (nonce !== undefined) {
    console.log(`nonce=${nonce}`);
  }
  console.log(`signature_preview=${signaturePreview(signatureValue)}`);
  console.log(`maker_matches_funder=${makerMatchesFunder}`);
  console.log(`signer_matches_funder=${signerMatchesFunder}`);
  console.log(`signer_matches_eoa=${signerMatchesEoa}`);

  if (
    Number(config.POLYMARKET_SIGNATURE_TYPE ?? 0) === 3 &&
    normalizedFunder &&
    (!makerMatchesFunder || !signerMatchesFunder)
  ) {
    console.log("Deposit wallet signature mismatch: POLY_1271 orders must use deposit wallet as maker/signer.");
  }

  await closeDb();
})().catch(async (err) => {
  logger.error({ err }, "openclaw:signed-order-preview failed");
  await closeDb();
  process.exit(1);
});
