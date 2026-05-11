import { AppConfig } from "../config";
import { logger } from "../logger";
import { ExternalNewsItem, ScannedMarket } from "../types";
import { SqliteStore } from "../services/sqliteStore";
import { RssNewsService } from "../services/rssNewsService";

interface NewsEnrichmentResult {
  enabled: boolean;
  items: ExternalNewsItem[];
  skippedReason?: string;
  stored: number;
}

export class NewsEvidenceAgent {
  constructor(
    private readonly cfg: AppConfig,
    private readonly newsService: RssNewsService,
    private readonly store: SqliteStore
  ) {}

  async enrich(market: ScannedMarket): Promise<NewsEnrichmentResult> {
    if (!this.cfg.ENABLE_NEWS_EVIDENCE) {
      return { enabled: false, items: [], skippedReason: "disabled", stored: 0 };
    }
    const rssUrls = this.parseNewsUrls();
    if (!rssUrls.length) {
      return { enabled: true, items: [], skippedReason: "no_provider", stored: 0 };
    }
    try {
      const feedItems = await this.newsService.fetchFeeds(rssUrls);
      if (!feedItems.length) {
        return { enabled: true, items: [], skippedReason: "no_feed_items", stored: 0 };
      }
      const keywords = this.extractKeywords(market);
      const cutoff = Date.now() - this.cfg.NEWS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
      const deduped: ExternalNewsItem[] = [];
      const seen = new Set<string>();
      for (const item of feedItems) {
        if (!item.url) continue;
        const publishedAtMs = Date.parse(item.publishedAt);
        if (Number.isFinite(publishedAtMs) && publishedAtMs < cutoff) continue;
        if (!this.matchesKeywords(item, keywords)) continue;
        const key = `${item.url.toLowerCase()}|${(item.title ?? "").toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const normalized: ExternalNewsItem = {
          title: item.title,
          source: item.source,
          url: item.url,
          summary: item.summary,
          publishedAt: Number.isFinite(publishedAtMs) ? new Date(publishedAtMs).toISOString() : new Date().toISOString()
        };
        deduped.push(normalized);
        if (deduped.length >= this.cfg.NEWS_MAX_ITEMS_PER_MARKET) break;
      }
      if (!deduped.length) {
        return { enabled: true, items: [], skippedReason: "no_matches", stored: 0 };
      }
      await this.store.insertNewsItems(market.marketId, deduped);
      return { enabled: true, items: deduped, stored: deduped.length };
    } catch (err) {
      logger.warn({ err, marketId: market.marketId }, "News enrichment failed but continuing");
      return { enabled: true, items: [], skippedReason: "fetch_failed", stored: 0 };
    }
  }

  private parseNewsUrls(): string[] {
    return (this.cfg.NEWS_RSS_URLS ?? "")
      .split(",")
      .map((url) => url.trim())
      .filter((url) => url.length > 0);
  }

  private extractKeywords(market: ScannedMarket): string[] {
    const raw = (market.raw ?? {}) as Record<string, unknown>;
    const groupTitle = typeof raw?.groupItemTitle === "string" ? raw.groupItemTitle : undefined;
    const events = Array.isArray((raw as any)?.events) ? ((raw as any).events as Array<Record<string, unknown>>) : [];
    const eventTitle = typeof events[0]?.title === "string" ? (events[0].title as string) : undefined;
    const context = [market.question, groupTitle, eventTitle, market.category]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" ");
    const tokens = context
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4)
      .slice(0, 20);
    return [...new Set(tokens)];
  }

  private matchesKeywords(item: ExternalNewsItem, keywords: string[]): boolean {
    if (!keywords.length) return true;
    const haystack = `${item.title} ${item.summary}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  }
}
