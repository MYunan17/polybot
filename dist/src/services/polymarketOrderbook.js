"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolymarketOrderbookService = void 0;
const axios_1 = __importDefault(require("axios"));
// TODO: adapt URL/shape to current Polymarket CLOB endpoint if changed.
const CLOB_BOOK_URL = "https://clob.polymarket.com/book";
class PolymarketOrderbookService {
    async fetchOrderbook(market) {
        const yes = await this.fetchTokenBook(market.yesTokenId);
        const no = await this.fetchTokenBook(market.noTokenId);
        const spread = yes.bestAsk && yes.bestBid ? Math.max(0, yes.bestAsk - yes.bestBid) : undefined;
        return {
            marketId: market.marketId,
            yesTokenId: market.yesTokenId,
            noTokenId: market.noTokenId,
            yesBestBid: yes.bestBid,
            yesBestAsk: yes.bestAsk,
            noBestBid: no.bestBid,
            noBestAsk: no.bestAsk,
            spread,
            depthUsd: yes.depthUsd + no.depthUsd,
            raw: { yes: yes.raw, no: no.raw }
        };
    }
    async fetchTokenBook(tokenId) {
        if (!tokenId)
            return { depthUsd: 0 };
        try {
            const res = await axios_1.default.get(CLOB_BOOK_URL, { params: { token_id: tokenId }, timeout: 10000 });
            const bids = Array.isArray(res.data?.bids) ? res.data.bids : [];
            const asks = Array.isArray(res.data?.asks) ? res.data.asks : [];
            const bestBid = bids.length ? Number(bids[0].price) : undefined;
            const bestAsk = asks.length ? Number(asks[0].price) : undefined;
            const depthUsd = [...bids.slice(0, 5), ...asks.slice(0, 5)].reduce((acc, x) => acc + Number(x?.price ?? 0) * Number(x?.size ?? 0), 0);
            return { bestBid, bestAsk, depthUsd, raw: { bids: bids.slice(0, 5), asks: asks.slice(0, 5) } };
        }
        catch {
            return { depthUsd: 0 };
        }
    }
}
exports.PolymarketOrderbookService = PolymarketOrderbookService;
