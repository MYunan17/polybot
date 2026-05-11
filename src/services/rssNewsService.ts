import Parser from "rss-parser";
import axios from "axios";
import { withRetry } from "../utils/retry";
import { ExternalNewsItem } from "../types";

const parser = new Parser();

export class RssNewsService {
  async fetchFeeds(urls: string[]): Promise<ExternalNewsItem[]> {
    if (!urls.length) return [];
    const items: ExternalNewsItem[] = [];
    for (const url of urls) {
      try {
        const feed = await withRetry(async () => {
          const response = await axios.get(url, { timeout: 8000 });
          return parser.parseString(response.data);
        }, 2, 300);
        for (const item of feed.items ?? []) {
          items.push({
            title: item.title ?? "Untitled",
            source: item.creator ?? item.author ?? feed.title ?? "RSS",
            url: item.link ?? "",
            publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
            summary: (item.contentSnippet ?? item.content ?? "").slice(0, 400)
          });
        }
      } catch {
        continue;
      }
    }
    return items;
  }
}
