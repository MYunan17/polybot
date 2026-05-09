"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketScannerAgent = void 0;
const logger_1 = require("../logger");
class MarketScannerAgent {
    cfg;
    gamma;
    orderbook;
    store;
    constructor(cfg, gamma, orderbook, store) {
        this.cfg = cfg;
        this.gamma = gamma;
        this.orderbook = orderbook;
        this.store = store;
    }
    async run() {
        const markets = await this.gamma.fetchMarkets();
        const out = [];
        for (const m of markets) {
            const book = await this.orderbook.fetchOrderbook(m);
            m.bestBid = book.yesBestBid;
            m.bestAsk = book.yesBestAsk;
            m.spread = book.spread;
            if (!m.yesTokenId || !m.noTokenId)
                continue;
            if ((m.spread ?? 0) > this.cfg.MAX_SPREAD)
                continue;
            await this.store.upsertMarket(m);
            out.push(m);
            if (out.length >= this.cfg.MAX_MARKETS_PER_RUN)
                break;
        }
        logger_1.logger.info({ count: out.length }, "Scanner completed");
        return out;
    }
}
exports.MarketScannerAgent = MarketScannerAgent;
