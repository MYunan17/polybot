"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EdgeJudgmentAgent = void 0;
class EdgeJudgmentAgent {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    async run(market, calibrated) {
        const yesAsk = market.bestAsk ?? market.currentYesPrice;
        const noAsk = market.currentNoPrice;
        const spread = market.spread ?? 1;
        if (!isValidPrice(yesAsk) || !isValidPrice(noAsk)) {
            return this.skip(market.marketId, calibrated.adjustedProbability, yesAsk, spread, "Executable price invalid");
        }
        if (!market.yesTokenId || !market.noTokenId) {
            return this.skip(market.marketId, calibrated.adjustedProbability, yesAsk, spread, "Missing token ID");
        }
        if (spread > this.cfg.MAX_SPREAD) {
            return this.skip(market.marketId, calibrated.adjustedProbability, yesAsk, spread, "Spread too wide");
        }
        const yesEdge = calibrated.adjustedProbability - yesAsk;
        const noEdge = (1 - calibrated.adjustedProbability) - noAsk;
        const yesValid = yesEdge >= this.cfg.MIN_EDGE;
        const noValid = noEdge >= this.cfg.MIN_EDGE;
        if (!yesValid && !noValid) {
            return this.skip(market.marketId, calibrated.adjustedProbability, yesAsk, spread, "Edge below minimum");
        }
        if (yesValid && (!noValid || yesEdge >= noEdge)) {
            return {
                marketId: market.marketId,
                action: "BUY_YES",
                adjustedProbability: calibrated.adjustedProbability,
                executablePrice: yesAsk,
                marketProbability: yesAsk,
                edge: yesEdge,
                spread,
                reason: "YES edge threshold met",
                confidence: yesEdge > this.cfg.MIN_EDGE * 1.5 ? "high" : "medium"
            };
        }
        if (noValid) {
            return {
                marketId: market.marketId,
                action: "BUY_NO",
                adjustedProbability: calibrated.adjustedProbability,
                executablePrice: noAsk,
                marketProbability: noAsk,
                edge: noEdge,
                spread,
                reason: "NO edge threshold met",
                confidence: noEdge > this.cfg.MIN_EDGE * 1.5 ? "high" : "medium"
            };
        }
        return this.skip(market.marketId, calibrated.adjustedProbability, yesAsk, spread, "No valid side");
    }
    skip(marketId, adjusted, price, spread, reason) {
        return {
            marketId,
            action: "SKIP",
            adjustedProbability: adjusted,
            executablePrice: price,
            marketProbability: price,
            edge: 0,
            spread,
            reason,
            confidence: "low"
        };
    }
}
exports.EdgeJudgmentAgent = EdgeJudgmentAgent;
function isValidPrice(n) {
    return Number.isFinite(n) && n > 0 && n < 1;
}
