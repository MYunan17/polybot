import { AppConfig } from "../config";
import { Judgment, ScannedMarket } from "../types";
import { SqliteStore } from "./sqliteStore";

type MarketLike = Pick<ScannedMarket, "marketId"> & Partial<ScannedMarket>;

interface PlanContext {
  runId: string;
  market: MarketLike;
  snapshot?: Partial<ScannedMarket> | null;
  judgment: Judgment;
  action: "BUY" | "SELL" | "CLOSE" | "SKIP";
  side: "YES" | "NO" | "BOTH";
  note?: string;
}

export class OpenClawExecutionAdapter {
  constructor(private readonly cfg: AppConfig, private readonly store: SqliteStore) {}

  get enabled(): boolean {
    return this.cfg.ENABLE_OPENCLAW;
  }

  async planTrade(context: PlanContext): Promise<boolean> {
    if (!this.enabled) return false;
    if (context.action === "SKIP") return false;
    const sizeUsd = Math.min(this.cfg.TRADE_SIZE_USD, this.cfg.OPENCLAW_MAX_ORDER_USD);
    const limitPrice = context.judgment.marketProbability;
    const maxSlippage = this.cfg.MAX_SPREAD;
    const dryRun = this.cfg.OPENCLAW_DRY_RUN;
    const approvalStatus = this.cfg.OPENCLAW_REQUIRE_MANUAL_APPROVAL ? "pending_manual_approval" : "dry_run_only";
    const tokenId = this.resolveTokenId(context.side, (context.snapshot as MarketLike | undefined) ?? context.market);
    const enrichedMarket = (context.snapshot as MarketLike | undefined) ?? context.market;
    const planQuestion = context.market.question ?? enrichedMarket?.question;
    const planResolution = context.market.resolutionDate ?? enrichedMarket?.resolutionDate;
    const plan = {
      market_id: context.market.marketId,
      question: planQuestion,
      resolution_date: planResolution,
      token_id: tokenId,
      side: context.side,
      action: context.action,
      size_usd: sizeUsd,
      limit_price: limitPrice,
      max_slippage: maxSlippage,
      dry_run: dryRun,
      reason: context.note ?? context.judgment.reason,
      risk_checks: this.buildRiskChecks(),
      metadata: this.buildMetadata(context, planResolution)
    };
    await this.store.insertOpenClawExecutionPlan({
      runId: context.runId,
      marketId: context.market.marketId,
      action: context.action,
      side: context.side,
      tokenId,
      sizeUsd,
      limitPrice,
      maxSlippage,
      dryRun,
      approvalStatus,
      reason: plan.reason,
      riskChecks: plan.risk_checks,
      planJson: plan
    });
    return true;
  }

  private resolveTokenId(side: "YES" | "NO" | "BOTH", market?: Partial<ScannedMarket> | null): string | undefined {
    if (!market) return undefined;
    if (side === "YES") return market.yesTokenId;
    if (side === "NO") return market.noTokenId;
    return undefined;
  }

  private buildRiskChecks(): string[] {
    const checks = ["dry_run_only", "paper_trade_to_plan"];
    if (this.cfg.OPENCLAW_REQUIRE_MANUAL_APPROVAL) {
      checks.push("manual_approval_required");
    }
    checks.push(`max_order_usd<=${this.cfg.OPENCLAW_MAX_ORDER_USD}`);
    return checks;
  }

  private buildMetadata(context: PlanContext, resolutionDate?: string | null) {
    return {
      rawProbability: context.judgment.marketProbability,
      adjustedProbability: context.judgment.adjustedProbability,
      edge: context.judgment.edge,
      spread: context.judgment.spread,
      resolutionDate: resolutionDate ?? context.market.resolutionDate ?? ""
    };
  }
}
