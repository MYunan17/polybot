import { AppConfig } from "../config";
import { logger } from "../logger";
import { PolymarketGammaService } from "../services/polymarketGamma";
import { PolymarketOrderbookService } from "../services/polymarketOrderbook";
import { SqliteStore } from "../services/sqliteStore";
import { ScannedMarket } from "../types";

export class MarketScannerAgent {
  constructor(
    private readonly cfg: AppConfig,
    private readonly gamma: PolymarketGammaService,
    private readonly orderbook: PolymarketOrderbookService,
    private readonly store: SqliteStore
  ) {}

  async run(): Promise<ScannedMarket[]> {
    const markets = await this.gamma.fetchMarkets();
    const out: ScannedMarket[] = [];
    for (const m of markets) {
      const book = await this.orderbook.fetchOrderbook(m);
      m.bestBid = book.yesBestBid;
      m.bestAsk = book.yesBestAsk;
      m.spread = book.spread;
      if (!m.yesTokenId || !m.noTokenId) continue;
      if ((m.spread ?? 0) > this.cfg.MAX_SPREAD) continue;
      await this.store.upsertMarket(m);
      out.push(m);
      if (out.length >= this.cfg.MAX_MARKETS_PER_RUN) break;
    }
    logger.info({ count: out.length }, "Scanner completed");
    return out;
  }
}
