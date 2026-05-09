import { EvidencePacket, RulesAnalysis, ScannedMarket, SeedPacket } from "../types";

export class BullBearAgent {
  async run(market: ScannedMarket, evidence: EvidencePacket, rules: RulesAnalysis): Promise<SeedPacket> {
    const topNews = evidence.newsItems.slice(0, 3).map((n) => `${n.source}: ${n.title}`);
    const supportiveSignals: string[] = [];
    const cautionSignals: string[] = [];
    if ((market.spread ?? 0.05) <= 0.02) supportiveSignals.push("tight spread suggests executable pricing");
    if (market.liquidity >= 50000) supportiveSignals.push("strong liquidity reduces execution friction");
    if ((market.spread ?? 0.05) > 0.03) cautionSignals.push("wide spread may hide true executable odds");
    if (rules.resolutionRisk !== "low") cautionSignals.push(`resolution risk is ${rules.resolutionRisk}`);
    if (evidence.newsItems.length === 0) cautionSignals.push("no recent relevant news found");

    return {
      marketId: market.marketId,
      question: market.question,
      bull_case: [
        `YES case: odds (${(market.currentYesPrice * 100).toFixed(1)}%) may lag current narrative.`,
        topNews.length ? `Recent signals: ${topNews.join(" | ")}` : "Recent signals are limited.",
        supportiveSignals.length ? `Support: ${supportiveSignals.join("; ")}.` : ""
      ].filter(Boolean).join(" "),
      bear_case: [
        "NO case: event may fail, delay, or fall short of strict resolution criteria.",
        cautionSignals.length ? `Risks: ${cautionSignals.join("; ")}.` : "Risks remain around uncertainty and interpretation.",
        rules.skipReason ? `Rule warning: ${rules.skipReason}.` : ""
      ].filter(Boolean).join(" "),
      current_odds: market.currentYesPrice,
      best_bid: market.bestBid,
      best_ask: market.bestAsk,
      spread: market.spread,
      key_entities: evidence.keyEntities,
      resolution_date: market.resolutionDate,
      resolution_rules: rules.keyRules,
      evidence_summary: topNews.join(" | ").slice(0, 600),
      uncertainty_factors: [
        `resolution_risk:${rules.resolutionRisk}`,
        `news_count:${evidence.newsItems.length}`,
        `spread:${market.spread ?? -1}`
      ]
    };
  }
}
