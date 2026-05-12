import { closeDb, initDb } from "../db";
import { config } from "../config";
import { logger } from "../logger";
import { SqliteStore } from "../services/sqliteStore";

interface CliOptions {
  fromPlanId: number;
  allowSizeOver1: boolean;
}

function parseArgs(): CliOptions {
  let fromPlanId: number | undefined;
  let allowSizeOver1 = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--from-plan-id") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("--from-plan-id requires a value");
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--from-plan-id must be a positive integer");
      }
      fromPlanId = parsed;
      i += 1;
    } else if (arg === "--allow-size-over-1") {
      allowSizeOver1 = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!fromPlanId) {
    throw new Error("Missing --from-plan-id <id>");
  }
  return { fromPlanId, allowSizeOver1 };
}

function clonePlanJson(original: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(original ?? {}));
}

void (async () => {
  const options = parseArgs();
  await initDb();
  const store = new SqliteStore();

  if (config.OPENCLAW_ALLOW_MARKET_BUY) {
    throw new Error("OPENCLAW_ALLOW_MARKET_BUY=true; refusing to stage live plan");
  }

  if (config.OPENCLAW_MAX_ORDER_USD > 1 && !options.allowSizeOver1) {
    throw new Error(
      `OPENCLAW_MAX_ORDER_USD=${config.OPENCLAW_MAX_ORDER_USD} exceeds $1. Re-run with --allow-size-over-1 after double-checking safety.`
    );
  }

  const sourcePlan = await store.getOpenClawPlanById(options.fromPlanId);
  if (!sourcePlan) {
    throw new Error(`Plan ${options.fromPlanId} not found`);
  }

  if (!sourcePlan.dryRun) {
    throw new Error(`Plan ${options.fromPlanId} already marked dry_run=0`);
  }

  if (sourcePlan.approvalStatus !== "pending_manual_approval" && sourcePlan.approvalStatus !== "approved") {
    throw new Error(
      `Plan ${options.fromPlanId} has status ${sourcePlan.approvalStatus}; only pending_manual_approval or approved plans can be staged`
    );
  }

  if (sourcePlan.side === "BOTH") {
    throw new Error("Cannot stage plan with side=BOTH");
  }

  if (!sourcePlan.tokenId) {
    throw new Error("Source plan is missing token_id");
  }

  const sizeCap = options.allowSizeOver1
    ? Math.min(sourcePlan.sizeUsd, config.OPENCLAW_MAX_ORDER_USD)
    : Math.min(sourcePlan.sizeUsd, config.OPENCLAW_MAX_ORDER_USD, 1);

  if (!Number.isFinite(sizeCap) || sizeCap <= 0) {
    throw new Error(`Computed staged size ${sizeCap} is invalid`);
  }

  const planJson = clonePlanJson(sourcePlan.planJson ?? {}) as Record<string, unknown>;
  planJson["stagedFromPlanId"] = sourcePlan.id;
  planJson["stagedForLive"] = true;
  planJson["dryRunSource"] = true;

  const riskChecks = Array.from(new Set([...(sourcePlan.riskChecks ?? []), "staged_from_plan"]));

  const newPlanId = await store.insertOpenClawExecutionPlan({
    runId: sourcePlan.runId,
    marketId: sourcePlan.marketId,
    action: sourcePlan.action,
    side: sourcePlan.side,
    tokenId: sourcePlan.tokenId,
    sizeUsd: sizeCap,
    limitPrice: sourcePlan.limitPrice,
    maxSlippage: sourcePlan.maxSlippage ?? undefined,
    dryRun: false,
    approvalStatus: "pending_manual_approval",
    reason: sourcePlan.reason ?? "Staged from dry-run plan",
    riskChecks,
    planJson
  });

  console.log(`Staged live-intent plan ${newPlanId} from plan ${sourcePlan.id} with size $${sizeCap.toFixed(2)}`);
  await closeDb();
})().catch(async (err) => {
  logger.error({ err }, "openclaw:stage-live-plan failed");
  await closeDb();
  process.exit(1);
});
