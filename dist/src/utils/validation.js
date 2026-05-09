"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedPacketSchema = exports.rulesAnalysisSchema = exports.evidencePacketSchema = exports.scannedMarketSchema = void 0;
const zod_1 = require("zod");
exports.scannedMarketSchema = zod_1.z.object({
    marketId: zod_1.z.string(),
    question: zod_1.z.string(),
    description: zod_1.z.string().optional(),
    resolutionDate: zod_1.z.string(),
    liquidity: zod_1.z.number(),
    volume: zod_1.z.number(),
    currentYesPrice: zod_1.z.number(),
    currentNoPrice: zod_1.z.number(),
    bestBid: zod_1.z.number().optional(),
    bestAsk: zod_1.z.number().optional(),
    spread: zod_1.z.number().optional(),
    outcomes: zod_1.z.array(zod_1.z.string()).optional(),
    yesTokenId: zod_1.z.string().optional(),
    noTokenId: zod_1.z.string().optional(),
    category: zod_1.z.string().optional(),
    url: zod_1.z.string().optional(),
    raw: zod_1.z.unknown().optional()
});
exports.evidencePacketSchema = zod_1.z.object({
    marketId: zod_1.z.string(),
    question: zod_1.z.string(),
    currentOdds: zod_1.z.number().min(0).max(1),
    resolutionDate: zod_1.z.string(),
    keyEntities: zod_1.z.array(zod_1.z.string()),
    newsItems: zod_1.z.array(zod_1.z.object({
        title: zod_1.z.string(),
        source: zod_1.z.string(),
        publishedAt: zod_1.z.string(),
        url: zod_1.z.string(),
        summary: zod_1.z.string()
    })).max(5),
    officialSignals: zod_1.z.array(zod_1.z.string()),
    marketSignals: zod_1.z.object({
        liquidity: zod_1.z.number(),
        volume: zod_1.z.number(),
        spread: zod_1.z.number().optional(),
        priceMovement: zod_1.z.number().optional()
    })
});
exports.rulesAnalysisSchema = zod_1.z.object({
    marketId: zod_1.z.string(),
    resolutionSource: zod_1.z.string(),
    ambiguityScore: zod_1.z.number().min(0).max(1),
    resolutionRisk: zod_1.z.enum(["low", "medium", "high"]),
    keyRules: zod_1.z.array(zod_1.z.string()),
    skipReason: zod_1.z.string().optional()
});
exports.seedPacketSchema = zod_1.z.object({
    marketId: zod_1.z.string(),
    question: zod_1.z.string(),
    bull_case: zod_1.z.string(),
    bear_case: zod_1.z.string(),
    current_odds: zod_1.z.number().min(0).max(1),
    best_bid: zod_1.z.number().optional(),
    best_ask: zod_1.z.number().optional(),
    spread: zod_1.z.number().optional(),
    key_entities: zod_1.z.array(zod_1.z.string()),
    resolution_date: zod_1.z.string(),
    resolution_rules: zod_1.z.array(zod_1.z.string()),
    evidence_summary: zod_1.z.string(),
    uncertainty_factors: zod_1.z.array(zod_1.z.string())
});
