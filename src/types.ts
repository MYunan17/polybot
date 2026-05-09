export type Side = "YES" | "NO";
export type Action = "BUY_YES" | "BUY_NO" | "SKIP" | "PREDICTION_ONLY";

export interface ScannedMarket {
  marketId: string;
  question: string;
  description?: string;
  resolutionDate: string;
  liquidity: number;
  volume: number;
  currentYesPrice: number;
  currentNoPrice: number;
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
  outcomes?: string[];
  yesTokenId?: string;
  noTokenId?: string;
  category?: string;
  url?: string;
  raw?: unknown;
}

export interface OrderbookSnapshot {
  marketId: string;
  yesTokenId?: string;
  noTokenId?: string;
  yesBestBid?: number;
  yesBestAsk?: number;
  noBestBid?: number;
  noBestAsk?: number;
  spread?: number;
  depthUsd?: number;
  raw?: unknown;
}

export interface EvidencePacket {
  marketId: string;
  question: string;
  currentOdds: number;
  resolutionDate: string;
  keyEntities: string[];
  newsItems: Array<{
    title: string;
    source: string;
    publishedAt: string;
    url: string;
    summary: string;
  }>;
  officialSignals: string[];
  marketSignals: {
    liquidity: number;
    volume: number;
    spread?: number;
    priceMovement?: number;
  };
}

export interface RulesAnalysis {
  marketId: string;
  resolutionSource: string;
  ambiguityScore: number;
  resolutionRisk: "low" | "medium" | "high";
  keyRules: string[];
  skipReason?: string;
}

export interface SeedPacket {
  marketId: string;
  question: string;
  bull_case: string;
  bear_case: string;
  current_odds: number;
  best_bid?: number;
  best_ask?: number;
  spread?: number;
  key_entities: string[];
  resolution_date: string;
  resolution_rules: string[];
  evidence_summary: string;
  uncertainty_factors: string[];
}

export interface MiroFishResult {
  marketId: string;
  rawConfidenceScore: number;
  rawProbability: number;
  reportText: string;
  strongestYesArguments: string[];
  strongestNoArguments: string[];
  uncertainty: string;
  modelMetadata?: Record<string, unknown>;
}

export interface SeedPacketRecord {
  id: number;
  runId: string;
  marketId: string;
  seed: SeedPacket;
  createdAt: string;
}

export interface SuccessfulMiroFishPrediction {
  resultId: number;
  runId: string;
  marketId: string;
  rawProbability: number;
  rawConfidenceScore: number;
  seedPacketId?: number;
  seed?: SeedPacket;
  createdAt: string;
}

export interface CalibratedPrediction {
  marketId: string;
  rawProbability: number;
  adjustedProbability: number;
  calibrationFactor: number;
  calibrationReason: string;
  sampleSize: number;
  categoryAdjustment?: number;
}

export interface Judgment {
  marketId: string;
  action: Action;
  adjustedProbability: number;
  executablePrice: number;
  marketProbability: number;
  edge: number;
  spread: number;
  reason: string;
  confidence: "low" | "medium" | "high";
}

export interface ExecutionRequest {
  marketId: string;
  question: string;
  tokenId: string;
  side: Side;
  action: "BUY";
  limitPrice: number;
  sizeUsd: number;
  maxSlippage: number;
  dryRun: boolean;
  reason: string;
  metadata: {
    rawProbability: number;
    adjustedProbability: number;
    edge: number;
    spread: number;
    resolutionDate: string;
  };
}

export interface RiskDecision {
  approved: boolean;
  reason: string;
  executionRequest?: ExecutionRequest;
}

export interface ExecutionResult {
  status: "dry_run" | "submitted" | "failed" | "rejected";
  orderId?: string;
  txHash?: string;
  message: string;
  raw?: unknown;
}

export interface TelegramNotification {
  market: string;
  rawProbability?: number;
  adjustedProbability?: number;
  price?: number;
  spread?: number;
  edge?: number;
  action: Action | "DRY_RUN" | "ERROR";
  risk: string;
  url?: string;
  extra?: string;
}

export interface BotRunContext {
  runId: string;
  startedAt: string;
  dryRun: boolean;
}
