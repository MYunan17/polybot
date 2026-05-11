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

interface KeywordContext {
  tokens: string[];
  strongPhrases: string[];
  personNames: string[];
  personLastNames: string[];
  isElectionMarket: boolean;
  isSportsMarket: boolean;
  isCryptoMarket: boolean;
  hasPersonFocus: boolean;
}

const STOP_WORDS = new Set([
  "will",
  "won",
  "win",
  "wins",
  "before",
  "after",
  "election",
  "elections",
  "primary",
  "primaries",
  "party",
  "control",
  "yes",
  "no",
  "market",
  "markets",
  "result",
  "results",
  "poll",
  "polls",
  "2024",
  "2025",
  "2026",
  "2027",
  "2028",
  "2029"
]);

const PERSON_EXCLUDE = new Set(["Republican", "Democratic", "Senate", "House", "Primary", "Election", "Party"]);

const ELECTION_PREFERRED_TERMS = [
  "senate",
  "house",
  "republican",
  "democrat",
  "democratic",
  "gop",
  "runoff",
  "texas",
  "governor",
  "mayor",
  "midterm",
  "congress",
  "cornyn",
  "paxton",
  "trump",
  "biden",
  "vance",
  "rubio",
  "newsom",
  "schumer",
  "mcconnell",
  "warnock",
  "kelly",
  "abbott"
];

const SPORTS_TERMS = [
  "nfl",
  "nba",
  "mlb",
  "nhl",
  "world cup",
  "uefa",
  "champions league",
  "premier league",
  "mls",
  "super bowl",
  "finals",
  "playoffs",
  "olympics"
];

const CRYPTO_TERMS = [
  "bitcoin",
  "btc",
  "crypto",
  "ethereum",
  "eth",
  "solana",
  "token",
  "stablecoin",
  "price",
  "rally"
];

const NEGATIVE_FILTERS = ["philippines", "cruise", "weather", "steel", "tourism", "hantavirus", "typhoon"];

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
      const keywordContext = this.buildKeywordContext(market);
      const cutoff = Date.now() - this.cfg.NEWS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
      const deduped: ExternalNewsItem[] = [];
      const seen = new Set<string>();
      const stats = {
        rssItemsFetched: feedItems.length,
        matchedItems: 0,
        rejectedLowRelevance: 0,
        rejectedCategoryGate: 0,
        rejectedPersonGate: 0,
        rejectedNegativeFilter: 0
      };
      for (const item of feedItems) {
        if (!item.url) continue;
        const publishedAtMs = Date.parse(item.publishedAt);
        if (Number.isFinite(publishedAtMs) && publishedAtMs < cutoff) continue;
        const relevance = this.evaluateRelevance(item, keywordContext);
        if (!relevance.accepted) {
          if (relevance.reason === "negative_filter") stats.rejectedNegativeFilter += 1;
          else if (relevance.reason === "person_gate") stats.rejectedPersonGate += 1;
          else if (relevance.reason === "category_gate") stats.rejectedCategoryGate += 1;
          else stats.rejectedLowRelevance += 1;
          logger.debug(
            {
              marketId: market.marketId,
              title: item.title,
              score: relevance.score,
              strongPhrase: relevance.strongPhrase,
              personMatch: relevance.personMatch,
              reason: relevance.reason
            },
            "Rejected news item for low relevance"
          );
          continue;
        }
        const key = `${item.url.toLowerCase()}|${(item.title ?? "").toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        stats.matchedItems += 1;
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
      logger.info(
        {
          marketId: market.marketId,
          rssItemsFetched: stats.rssItemsFetched,
          matchedItems: stats.matchedItems,
          rejectedLowRelevance: stats.rejectedLowRelevance,
          rejectedCategoryGate: stats.rejectedCategoryGate,
          rejectedPersonGate: stats.rejectedPersonGate,
          rejectedNegativeFilter: stats.rejectedNegativeFilter
        },
        "News enrichment stats"
      );
      if (!deduped.length) {
        return { enabled: true, items: [], skippedReason: "no_relevant_matches", stored: 0 };
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

  private buildKeywordContext(market: ScannedMarket): KeywordContext {
    const raw = (market.raw ?? {}) as Record<string, unknown>;
    const groupTitle = typeof raw?.groupItemTitle === "string" ? raw.groupItemTitle : undefined;
    const events = Array.isArray((raw as any)?.events) ? ((raw as any).events as Array<Record<string, unknown>>) : [];
    const eventTitle = typeof events[0]?.title === "string" ? (events[0].title as string) : undefined;
    const baseContext = [market.question, groupTitle, eventTitle, market.category]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" ");
    const tokens = baseContext
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
    const properPhrases = this.extractProperPhrases(baseContext);
    const personNames = this.extractPersonNames(baseContext);
    const personLastNames = personNames
      .map((name) => name.split(/\s+/).pop()?.toLowerCase())
      .filter((value): value is string => Boolean(value));
    const isElectionMarket = /primary|election|senate|governor|president|runoff|midterm/i.test(baseContext) ||
      (market.category ?? "").toLowerCase().includes("politic");
    if (isElectionMarket) {
      tokens.push(...ELECTION_PREFERRED_TERMS);
    }
    personNames.forEach((name) => {
      name
        .toLowerCase()
        .split(/\s+/)
        .filter((segment) => segment.length >= 3)
        .forEach((segment) => tokens.push(segment));
    });
    const baseLower = baseContext.toLowerCase();
    const uniqueTokens = [...new Set(tokens)].slice(0, 40);
    const isSportsMarket = /nfl|nba|mlb|nhl|world cup|champions league|premier league|super bowl|finals|playoff|olympic/i.test(baseContext);
    const isCryptoMarket = /bitcoin|btc|crypto|ethereum|eth|token|solana|defi|price|rally/i.test(baseContext);
    return {
      tokens: uniqueTokens,
      strongPhrases: properPhrases,
      personNames: personNames.map((name) => name.toLowerCase()),
      personLastNames,
      isElectionMarket,
      isSportsMarket,
      isCryptoMarket,
      hasPersonFocus: personNames.length > 0
    };
  }

  private extractProperPhrases(text: string): string[] {
    const matches = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g);
    if (!matches) return [];
    return matches.map((phrase) => phrase.trim().toLowerCase());
  }

  private extractPersonNames(text: string): string[] {
    const matches = text.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g);
    if (!matches) return [];
    return matches
      .map((phrase) => phrase.trim())
      .filter((phrase) => {
        const parts = phrase.split(/\s+/);
        return parts.length >= 2 && !PERSON_EXCLUDE.has(parts[parts.length - 1]);
      });
  }

  private evaluateRelevance(item: ExternalNewsItem, context: KeywordContext): {
    accepted: boolean;
    score: number;
    strongPhrase: boolean;
    personMatch: boolean;
    reason: string;
  } {
    const haystack = `${item.title} ${item.summary}`.toLowerCase();
    const negativeHit = this.hitNegativeFilter(haystack, context);
    if (negativeHit) {
      return { accepted: false, score: 0, strongPhrase: false, personMatch: false, reason: "negative_filter" };
    }
    const matchedTokens = new Set<string>();
    for (const token of context.tokens) {
      if (haystack.includes(token)) matchedTokens.add(token);
    }
    const strongPhrase = context.strongPhrases.some((phrase) => haystack.includes(phrase));
    const electionAnchor = context.isElectionMarket && this.containsAny(haystack, ELECTION_PREFERRED_TERMS);
    const sportsAnchor = context.isSportsMarket && this.containsAny(haystack, SPORTS_TERMS);
    const cryptoAnchor = context.isCryptoMarket && this.containsAny(haystack, CRYPTO_TERMS);
    const score = matchedTokens.size + (electionAnchor ? 1 : 0) + (sportsAnchor ? 1 : 0) + (cryptoAnchor ? 1 : 0);
    const personMatch =
      !context.hasPersonFocus ||
      context.personLastNames.some((name) => haystack.includes(name)) ||
      context.personNames.some((full) => haystack.includes(full));
    const passesCategoryGate = this.passesCategoryGate({ electionAnchor, sportsAnchor, cryptoAnchor }, context);
    const meetsScore = score >= this.cfg.NEWS_MIN_RELEVANCE_SCORE;
    const strictAccepted = strongPhrase || (meetsScore && passesCategoryGate);
    const accepted =
      this.cfg.NEWS_STRICT_MODE
        ? strictAccepted && (!context.hasPersonFocus || personMatch)
        : (meetsScore || strongPhrase) && (!context.hasPersonFocus || personMatch);
    let reason: string;
    if (negativeHit) {
      reason = "negative_filter";
    } else if (context.hasPersonFocus && !personMatch) {
      reason = "person_gate";
    } else if (!passesCategoryGate) {
      reason = "category_gate";
    } else if (!accepted) {
      reason = "low_score";
    } else {
      reason = "accepted";
    }
    return { accepted: accepted && reason === "accepted", score, strongPhrase, personMatch, reason };
  }

  private passesCategoryGate(
    anchors: { electionAnchor: boolean; sportsAnchor: boolean; cryptoAnchor: boolean },
    context: KeywordContext
  ): boolean {
    if (context.isElectionMarket && !anchors.electionAnchor) return false;
    if (context.isSportsMarket && !anchors.sportsAnchor) return false;
    if (context.isCryptoMarket && !anchors.cryptoAnchor) return false;
    return true;
  }

  private hitNegativeFilter(haystack: string, context: KeywordContext): boolean {
    return NEGATIVE_FILTERS.some((term) => haystack.includes(term) && !context.tokens.includes(term));
  }

  private containsAny(haystack: string, terms: string[]): boolean {
    return terms.some((term) => haystack.includes(term));
  }
}
