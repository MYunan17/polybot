import { AppConfig } from "../config";
import { logger } from "../logger";
import { ExecutionRequest, ExecutionResult } from "../types";
import { OpenClawClient } from "./openclawClient";
import { OpenClawPlanRow, SqliteStore } from "./sqliteStore";

export interface OpenClawLiveExecutionStats {
  considered: number;
  submitted: number;
  rejected: number;
  failed: number;
  skippedKillSwitch: number;
  skippedDailyCap: number;
}

export function getMissingOpenClawCredentials(cfg: AppConfig): string[] {
  const missing: string[] = [];
  if (!cfg.OPENCLAW_API_KEY?.trim()) {
    missing.push("OPENCLAW_API_KEY");
  }
  if (!cfg.POLYMARKET_PRIVATE_KEY?.trim()) {
    missing.push("POLYMARKET_PRIVATE_KEY");
  }
  return missing;
}

export class OpenClawLiveExecutor {
  constructor(
    private readonly cfg: AppConfig,
    private readonly store: SqliteStore,
    private readonly client: OpenClawClient
  ) {}

  async executeApprovedPlans(): Promise<OpenClawLiveExecutionStats> {
    if (!this.cfg.ENABLE_OPENCLAW) {
      throw new Error("ENABLE_OPENCLAW=false; refuse to execute plans");
    }
    if (this.cfg.OPENCLAW_DRY_RUN) {
      throw new Error("OPENCLAW_DRY_RUN=true; refuse to execute live orders");
    }

    const plans = await this.store.listOpenClawPlans({ approvalStatus: "approved", dryRun: false, unexecuted: true });
    if (!plans.length) {
      return {
        considered: 0,
        submitted: 0,
        rejected: 0,
        failed: 0,
        skippedKillSwitch: 0,
        skippedDailyCap: 0
      };
    }

    const stats: OpenClawLiveExecutionStats = {
      considered: plans.length,
      submitted: 0,
      rejected: 0,
      failed: 0,
      skippedKillSwitch: 0,
      skippedDailyCap: 0
    };

    const missingCredentials = getMissingOpenClawCredentials(this.cfg);
    const credentialsReady = missingCredentials.length === 0;
    if (this.cfg.OPENCLAW_KILL_SWITCH) {
      logger.warn(
        { killSwitch: true, plans: plans.length },
        "OpenClaw kill switch enabled; all approved plans will be recorded as skipped"
      );
    } else if (!credentialsReady) {
      logger.error(
        { missingCredentials, plans: plans.length },
        "OpenClaw live executor missing credentials; refusing to submit live orders"
      );
    } else {
      logger.info({ killSwitch: false, plans: plans.length }, "OpenClaw live executor ready for live submissions");
    }

    let { orderCount, usdTotal } = await this.store.getOpenClawDailyUsage();

    for (const plan of plans) {
      if (this.cfg.OPENCLAW_KILL_SWITCH) {
        await this.record(plan, "skipped_kill_switch", "Kill switch enabled");
        stats.skippedKillSwitch += 1;
        continue;
      }

      if (!credentialsReady) {
        await this.record(
          plan,
          "failed",
          `Missing credentials: ${missingCredentials.join(", ") || "unknown requirements"}`
        );
        stats.failed += 1;
        continue;
      }

      if (plan.side === "BOTH") {
        await this.record(plan, "failed", "Ambiguous side=BOTH plan");
        stats.failed += 1;
        continue;
      }

      if (!plan.tokenId) {
        await this.record(plan, "failed", "Missing token id");
        stats.failed += 1;
        continue;
      }

      if (plan.limitPrice <= 0 || plan.limitPrice >= 1) {
        await this.record(plan, "failed", "Invalid limit price");
        stats.failed += 1;
        continue;
      }

      const cappedOrderSize = Math.min(plan.sizeUsd, this.cfg.OPENCLAW_MAX_ORDER_USD);
      if (cappedOrderSize <= 0) {
        await this.record(plan, "failed", "Plan size is non-positive");
        stats.failed += 1;
        continue;
      }

      if (this.cfg.OPENCLAW_MAX_DAILY_ORDERS >= 0 && orderCount >= this.cfg.OPENCLAW_MAX_DAILY_ORDERS) {
        await this.record(plan, "skipped_daily_cap", "Daily order count cap reached");
        stats.skippedDailyCap += 1;
        continue;
      }

      if (this.cfg.OPENCLAW_MAX_DAILY_USD >= 0 && usdTotal + cappedOrderSize > this.cfg.OPENCLAW_MAX_DAILY_USD) {
        await this.record(plan, "skipped_daily_cap", "Daily USD cap reached");
        stats.skippedDailyCap += 1;
        continue;
      }

      const request = await this.buildExecutionRequest(plan, cappedOrderSize);
      if (!request) {
        await this.record(plan, "failed", "Unable to build execution request");
        stats.failed += 1;
        continue;
      }

      const result = await this.client.placeLimitOrder(request);
      await this.record(plan, result.status, result.message, result.orderId ?? result.txHash, cappedOrderSize);

      if (result.status === "submitted") {
        stats.submitted += 1;
        orderCount += 1;
        usdTotal += cappedOrderSize;
      } else if (result.status === "rejected") {
        stats.rejected += 1;
        orderCount += 1;
        usdTotal += cappedOrderSize;
      } else if (result.status === "failed") {
        stats.failed += 1;
        orderCount += 1;
        usdTotal += cappedOrderSize;
      } else {
        stats.failed += 1;
      }
    }

    return stats;
  }

  private async buildExecutionRequest(plan: OpenClawPlanRow, sizeUsd: number): Promise<ExecutionRequest | null> {
    if (!plan.tokenId) return null;
    if (plan.side !== "YES" && plan.side !== "NO") return null;
    const snapshot = await this.store.getMarketSnapshot(plan.marketId);

    const planJson = plan.planJson ?? {};
    const metadataFromPlan = (planJson.metadata ?? {}) as Partial<ExecutionRequest["metadata"]>;

    const question =
      snapshot?.question ?? (typeof planJson.question === "string" ? planJson.question : undefined) ?? "Unknown market";
    const resolutionDate =
      snapshot?.resolutionDate ??
      (typeof planJson.resolution_date === "string" ? planJson.resolution_date : undefined) ??
      "";

    const metadata: ExecutionRequest["metadata"] = {
      rawProbability: this.numberOr(metadataFromPlan.rawProbability, snapshot?.currentYesPrice ?? 0),
      adjustedProbability: this.numberOr(
        metadataFromPlan.adjustedProbability,
        snapshot?.currentYesPrice ?? metadataFromPlan.rawProbability ?? 0
      ),
      edge: this.numberOr(metadataFromPlan.edge, snapshot?.spread ?? 0),
      spread: this.numberOr(metadataFromPlan.spread, snapshot?.spread ?? 0),
      resolutionDate
    };

    const maxSlippage = plan.maxSlippage ?? this.cfg.OPENCLAW_PRICE_SLIPPAGE_BPS / 10_000;

    const request: ExecutionRequest = {
      marketId: plan.marketId,
      question,
      tokenId: plan.tokenId,
      side: plan.side,
      action: "BUY",
      limitPrice: plan.limitPrice,
      sizeUsd,
      maxSlippage,
      dryRun: false,
      reason: plan.reason ?? "Approved OpenClaw plan",
      metadata
    };

    return request;
  }

  private async record(
    plan: OpenClawPlanRow,
    status: ExecutionResult["status"],
    message: string,
    txOrOrderId?: string,
    executedSizeUsd?: number
  ) {
    await this.store.insertOpenClawExecution({
      planId: plan.id,
      runId: plan.runId,
      marketId: plan.marketId,
      action: plan.action,
      side: plan.side,
      tokenId: plan.tokenId,
      sizeUsd: executedSizeUsd ?? plan.sizeUsd,
      limitPrice: plan.limitPrice,
      status,
      txOrOrderId,
      errorMessage: message,
      dryRun: plan.dryRun
    });
    logger.info({ planId: plan.id, marketId: plan.marketId, status }, `OpenClaw plan ${status}`);
  }

  private numberOr(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
}
