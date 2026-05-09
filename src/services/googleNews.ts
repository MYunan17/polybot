import Parser from "rss-parser";
import axios from "axios";
import { withRetry } from "../utils/retry";

const parser = new Parser();

export class GoogleNewsService {
  async fetchCompactNews(query: string, max = 5): Promise<
    Array<{ title: string; source: string; publishedAt: string; url: string; summary: string }>
  > {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    try {
      const feed = await withRetry(async () => {
        const response = await axios.get(url, { timeout: 8000 });
        return parser.parseString(response.data);
      }, 2, 300);
      return (feed.items ?? []).slice(0, max).map((item) => ({
        title: item.title ?? "Untitled",
        source: (item as any).source?.name ?? "Google News",
        publishedAt: item.pubDate ?? new Date().toISOString(),
        url: item.link ?? "",
        summary: (item.contentSnippet ?? "").slice(0, 240)
      }));
    } catch {
      return [];
    }
  }
}
