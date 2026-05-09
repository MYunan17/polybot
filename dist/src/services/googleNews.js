"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleNewsService = void 0;
const rss_parser_1 = __importDefault(require("rss-parser"));
const axios_1 = __importDefault(require("axios"));
const retry_1 = require("../utils/retry");
const parser = new rss_parser_1.default();
class GoogleNewsService {
    async fetchCompactNews(query, max = 5) {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
        try {
            const feed = await (0, retry_1.withRetry)(async () => {
                const response = await axios_1.default.get(url, { timeout: 8000 });
                return parser.parseString(response.data);
            }, 2, 300);
            return (feed.items ?? []).slice(0, max).map((item) => ({
                title: item.title ?? "Untitled",
                source: item.source?.name ?? "Google News",
                publishedAt: item.pubDate ?? new Date().toISOString(),
                url: item.link ?? "",
                summary: (item.contentSnippet ?? "").slice(0, 240)
            }));
        }
        catch {
            return [];
        }
    }
}
exports.GoogleNewsService = GoogleNewsService;
