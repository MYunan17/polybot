import { z } from "zod";
import { EvidencePacket, RulesAnalysis, ScannedMarket, SeedPacket } from "../types";

export const scannedMarketSchema: z.ZodType<ScannedMarket> = z.object({
  marketId: z.string(),
  question: z.string(),
  description: z.string().optional(),
  resolutionDate: z.string(),
  liquidity: z.number(),
  volume: z.number(),
  currentYesPrice: z.number(),
  currentNoPrice: z.number(),
  bestBid: z.number().optional(),
  bestAsk: z.number().optional(),
  spread: z.number().optional(),
  outcomes: z.array(z.string()).optional(),
  yesTokenId: z.string().optional(),
  noTokenId: z.string().optional(),
  category: z.string().optional(),
  url: z.string().optional(),
  raw: z.unknown().optional()
});

export const evidencePacketSchema: z.ZodType<EvidencePacket> = z.object({
  marketId: z.string(),
  question: z.string(),
  currentOdds: z.number().min(0).max(1),
  resolutionDate: z.string(),
  keyEntities: z.array(z.string()),
  newsItems: z.array(z.object({
    title: z.string(),
    source: z.string(),
    publishedAt: z.string(),
    url: z.string(),
    summary: z.string()
  })).max(5),
  officialSignals: z.array(z.string()),
  marketSignals: z.object({
    liquidity: z.number(),
    volume: z.number(),
    spread: z.number().optional(),
    priceMovement: z.number().optional()
  })
});

export const rulesAnalysisSchema: z.ZodType<RulesAnalysis> = z.object({
  marketId: z.string(),
  resolutionSource: z.string(),
  ambiguityScore: z.number().min(0).max(1),
  resolutionRisk: z.enum(["low", "medium", "high"]),
  keyRules: z.array(z.string()),
  skipReason: z.string().optional()
});

export const seedPacketSchema: z.ZodType<SeedPacket> = z.object({
  marketId: z.string(),
  question: z.string(),
  bull_case: z.string(),
  bear_case: z.string(),
  current_odds: z.number().min(0).max(1),
  best_bid: z.number().optional(),
  best_ask: z.number().optional(),
  spread: z.number().optional(),
  key_entities: z.array(z.string()),
  resolution_date: z.string(),
  resolution_rules: z.array(z.string()),
  evidence_summary: z.string(),
  uncertainty_factors: z.array(z.string())
});
