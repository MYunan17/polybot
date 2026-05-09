"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskAgent = void 0;
class RiskAgent {
    cfg;
    openclaw;
    constructor(cfg, openclaw) {
        this.cfg = cfg;
        this.openclaw = openclaw;
    }
    async run(market, rules, judgment) {
        if (judgment.action === "SKIP")
            return { approved: false, reason: judgment.reason };
        if (rules.ambiguityScore > 0.6 || rules.resolutionRisk === "high") {
            return { approved: false, reason: "High resolution ambiguity risk" };
        }
        if (!market.yesTokenId || !market.noTokenId)
            return { approved: false, reason: "Missing token IDs" };
        if ((market.spread ?? 1) > this.cfg.MAX_SPREAD)
            return { approved: false, reason: "Spread too wide" };
        if (judgment.edge < this.cfg.MIN_EDGE)
            return { approved: false, reason: "Edge too small" };
        const health = await this.openclaw.healthCheck();
        if (!health && !this.cfg.DRY_RUN)
            return { approved: false, reason: "OpenClaw health check failed" };
        const tokenId = judgment.action === "BUY_YES" ? market.yesTokenId : market.noTokenId;
        return {
            approved: true,
            reason: this.cfg.DRY_RUN ? "Approved for dry run" : "Approved for live execution",
            executionRequest: {
                marketId: market.marketId,
                question: market.question,
                tokenId: tokenId,
                side: judgment.action === "BUY_YES" ? "YES" : "NO",
                action: "BUY",
                limitPrice: judgment.executablePrice,
                sizeUsd: Math.min(this.cfg.TRADE_SIZE_USD, this.cfg.MAX_MARKET_EXPOSURE_USD),
                maxSlippage: 0.01,
                dryRun: this.cfg.DRY_RUN,
                reason: judgment.reason,
                metadata: {
                    rawProbability: judgment.adjustedProbability,
                    adjustedProbability: judgment.adjustedProbability,
                    edge: judgment.edge,
                    spread: judgment.spread,
                    resolutionDate: market.resolutionDate
                }
            }
        };
    }
}
exports.RiskAgent = RiskAgent;
