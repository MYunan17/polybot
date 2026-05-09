import { GoogleNewsService } from "../services/googleNews";
import { EvidencePacket, ScannedMarket } from "../types";
import { extractKeyEntities } from "../utils/entityExtraction";

export class EvidenceAgent {
  constructor(private readonly news: GoogleNewsService) {}

  async run(market: ScannedMarket): Promise<EvidencePacket> {
    const entities = extractKeyEntities(`${market.question} ${market.description ?? ""}`, 8);
    const query = [market.question, ...entities.slice(0, 3)].join(" ");
    const newsItems = await this.news.fetchCompactNews(query, 5);
    const officialSignals = newsItems
      .filter((n) => /(official|government|court|sec|fed|ministry|commission)/i.test(`${n.title} ${n.source}`))
      .map((n) => `${n.source}: ${n.title}`)
      .slice(0, 3);
    return {
      marketId: market.marketId,
      question: market.question,
      currentOdds: Number.isFinite(market.currentYesPrice) ? market.currentYesPrice : 0.5,
      resolutionDate: market.resolutionDate,
      keyEntities: entities,
      newsItems,
      officialSignals,
      marketSignals: {
        liquidity: market.liquidity,
        volume: market.volume,
        spread: market.spread
      }
    };
  }
}
