import axios from "axios";
import { config } from "../config";
import { logger } from "../logger";
import { ScannedMarket } from "../types";
import { daysUntil } from "../utils/time";

const GAMMA_URL = "https://gamma-api.polymarket.com/markets";

type TargetBucket = "macro" | "politics" | "geopolitics" | "crypto" | "sports";

interface ScoredMarket {
  market: ScannedMarket;
  score: number;
  sourceBucket?: TargetBucket;
  inferredBucket?: TargetBucket;
  source: "general" | "targeted";
}

interface FilterStats {
  skippedMissingResolutionDate: number;
  skippedLiquidity: number;
  skippedOdds: number;
  skippedPrice: number;
  rejectedNovelty: number;
}

interface TargetedFetchStats {
  fetched: number;
  accepted: number;
  byBucket: Record<TargetBucket, number>;
}

const TARGET_BUCKET_SCORES: Record<TargetBucket, number> = {
  macro: 3,
  politics: 3,
  geopolitics: 3,
  crypto: 2,
  sports: 1
};

const NOVELTY_REGEXES: RegExp[] = [
  /\bgta\s*vi\b/i,
  /\bgrand\s+theft\s+auto\b/i,
  /\bjesus\s+christ\b/i,
  /\balbum\s+before\s+gta\s*vi\b/i,
  /\bplayboi\s+c(arti)?\b/i,
  /\brit?anna\s+album\b/i,
  /\btaylor\s+swift\b/i,
  /\bkardashian\b/i,
  /\bcelebrity\b/i,
  /\bmeme\b/i,
  /\bviral\b/i,
  /\blove\s+island\b/i,
  /\breality\s+show\b/i
];

const SPORTS_REGEXES: RegExp[] = [
  /\bnba\b/i,
  /\bnhl\b/i,
  /\bstanley\s+cup\b/i,
  /\bchampions?\s+league\b/i,
  /\bpremier\s+league\b/i,
  /\bsuper\s+bowl\b/i,
  /\bconference\s+finals?\b/i,
  /\bnba\s+finals?\b/i,
  /\bnhl\s+finals?\b/i
];

const CRYPTO_REGEXES: RegExp[] = [
  /\bbitcoin\b/i,
  /\bbtc\b/i,
  /\bethereum\b/i,
  /\beth\b/i,
  /\bcrypto\b/i,
  /\betf\b/i
];

const MACRO_REGEXES: RegExp[] = [
  /\bfed(?:eral\s+reserve)?\b/i,
  /\bfomc\b/i,
  /\binterest\s+rates?\b/i,
  /\brate\s+cuts?\b/i,
  /\brate\s+hikes?\b/i,
  /\bcpi\b/i,
  /\binflation\b/i,
  /\bunemployment\b/i,
  /\brecession\b/i,
  /\bjobs?\s+report\b/i,
  /\btreasury\s+yields?\b/i
];

const GEOPOLITICS_REGEXES: RegExp[] = [
  /\bchina\b/i,
  /\btaiwan\b/i,
  /\brussia\b/i,
  /\bukraine\b/i,
  /\bisrael\b/i,
  /\biran\b/i,
  /\bceasefire\b/i,
  /\bnato\b/i,
  /\bwar\b/i,
  /\binvasion\b/i
];

const POLITICS_REGEXES: RegExp[] = [
  /\bsenate\b/i,
  /\bhouse\b/i,
  /\bmidterms?\b/i,
  /\belections?\b/i,
  /\bprimary\b/i,
  /\bpresidential\s+nomination\b/i,
  /\bpresident\b/i,
  /\brepublican\b/i,
  /\bdemocrat(ic)?\b/i,
  /\bgop\b/i,
  /\btrump\b/i,
  /\bbiden\b/i,
  /\bvance\b/i,
  /\brubio\b/i,
  /\bnewsom\b/i,
  /\bpaxton\b/i,
  /\bcornyn\b/i
];

const CATEGORY_SCORING_RULES: { score: number; keywords: string[] }[] = [
  {
    score: 3,
    keywords: [
      "fed",
      "fomc",
      "interest rate",
      "rate cut",
      "cpi",
      "inflation",
      "jobs report",
      "unemployment",
      "recession"
    ]
  },
  {
    score: 3,
    keywords: [
      "election",
      "primary",
      "senate",
      "house",
      "governor",
      "midterm",
      "nomination",
      "trump",
      "biden"
    ]
  },
  {
    score: 3,
    keywords: ["nato", "taiwan", "ukraine", "israel", "iran", "ceasefire", "war", "conflict"]
  },
  {
    score: 2,
    keywords: ["bitcoin", "btc", "ethereum", "eth", "crypto", "etf", "stablecoin"]
  },
  {
    score: 1,
    keywords: [
      "nba",
      "nhl",
      "nfl",
      "mlb",
      "champions league",
      "stanley cup",
      "super bowl",
      "playoffs"
    ]
  }
];

const BUCKET_KEYWORDS: Record<TargetBucket, string[]> = {
  macro: [
    "fed",
    "federal reserve",
    "fomc",
    "interest rate",
    "rate cut",
    "rate hike",
    "cpi",
    "inflation",
    "unemployment",
    "recession",
    "jobs report",
    "treasury yield"
  ],
  politics: [
    "senate",
    "house",
    "midterm",
    "election",
    "primary",
    "presidential nomination",
    "president",
    "republican",
    "democratic",
    "democrat",
    "gop",
    "trump",
    "biden",
    "vance",
    "rubio",
    "newsom",
    "paxton",
    "cornyn"
  ],
  geopolitics: [
    "china",
    "taiwan",
    "russia",
    "ukraine",
    "israel",
    "iran",
    "ceasefire",
    "nato",
    "war",
    "invasion"
  ],
  crypto: ["bitcoin", "btc", "ethereum", "eth", "crypto", "etf"],
  sports: [
    "nba",
    "nhl",
    "stanley cup",
    "champions league",
    "premier league",
    "super bowl",
    "finals",
    "conference finals"
  ]
};

const NOVELTY_KEYWORDS = [
  "gta",
  "grand theft auto",
  "gta vi",
  "celebrity",
  "meme",
  "viral",
  "taylor swift",
  "kardashian",
  "oscars",
  "grammys",
  "love island",
  "reality show",
  "jesus christ",
  "album before gta vi",
  "playboi carti",
  "rihanna album"
];

export class PolymarketGammaService {
  async fetchMarkets(): Promise<ScannedMarket[]> {
    const filterStats = createFilterStats();
    const fetchLimit = Math.max(config.MAX_MARKETS_PER_RUN * 3, 200);
    const generalRows = await this.requestMarkets({
      limit: fetchLimit,
      active: true,
      closed: false
    });
    const generalMarkets = this.filterAndScoreRows(generalRows, filterStats, "general");

    let targetedEntries: ScoredMarket[] = [];
    let targetedStats: TargetedFetchStats = createTargetedStats();
    if (config.ENABLE_TARGETED_MARKET_SCAN) {
      ({ entries: targetedEntries, stats: targetedStats } = await this.fetchTargetedMarkets(filterStats));
    }

    const combinedEntries = [...generalMarkets, ...targetedEntries];
    const deduped = this.dedupEntries(combinedEntries);
    const {
      selected,
      finalByInferredBucket,
      finalBySourceBucket,
      finalOther,
      bucketMismatchCount,
      bucketMismatches
    } = this.selectWithBucketQuotas(deduped);
    const limited = selected.map((entry) => entry.market);
    const finalSelectedQuestions = selected
      .map((entry) => formatQuestionSummary(entry))
      .slice(0, 15);
    const finalMacroQuestions = selected
      .filter((entry) => entry.inferredBucket === "macro")
      .map((entry) => formatQuestionSummary(entry))
      .slice(0, 10);
    const finalSportsQuestions = selected
      .filter((entry) => entry.inferredBucket === "sports")
      .map((entry) => formatQuestionSummary(entry))
      .slice(0, 10);

    logger.info(
      {
        generalFetched: generalRows.length,
        generalAccepted: generalMarkets.length,
        targetedFetched: targetedStats.fetched,
        targetedAccepted: targetedStats.accepted,
        targetedByBucket: targetedStats.byBucket,
        deduped: combinedEntries.length - deduped.length,
        finalSelected: limited.length,
        finalByInferredBucket,
        finalBySourceBucket,
        finalOtherSelected: finalOther,
        finalMacroSelected: finalByInferredBucket.macro,
        finalSportsSelected: finalByInferredBucket.sports,
        finalSelectedQuestions,
        finalMacroQuestions,
        finalSportsQuestions,
        bucketMismatchCount,
        bucketMismatches,
        rejectedNovelty: filterStats.rejectedNovelty,
        skippedMissingResolutionDate: filterStats.skippedMissingResolutionDate,
        skippedLiquidity: filterStats.skippedLiquidity,
        skippedOdds: filterStats.skippedOdds,
        skippedPrice: filterStats.skippedPrice
      },
      "Gamma market filter summary"
    );

    return limited.filter((m) => m.marketId && m.question);
  }

  private async requestMarkets(params: Record<string, unknown>): Promise<any[]> {
    const res = await axios.get(GAMMA_URL, {
      timeout: 10000,
      params
    });
    return Array.isArray(res.data) ? res.data : [];
  }

  private filterAndScoreRows(
    rows: any[],
    stats: FilterStats,
    source: ScoredMarket["source"],
    bucket?: TargetBucket
  ): ScoredMarket[] {
    const entries: ScoredMarket[] = [];
    for (const row of rows) {
      const market = this.transformRow(row, stats);
      if (!market) continue;
      const score = this.scoreMarket(market, bucket);
      entries.push({ market, score, sourceBucket: bucket, source });
    }
    return entries;
  }

  private transformRow(row: any, stats: FilterStats): ScannedMarket | null {
    const parsedOutcomePrices = parseOutcomePrices(row?.outcomePrices);
    const yesCandidate = parsedOutcomePrices?.[0] ?? coerceNumber(row?.yesPrice);
    if (!Number.isFinite(yesCandidate)) {
      stats.skippedPrice += 1;
      return null;
    }
    const yes = yesCandidate as number;
    const noCandidate = parsedOutcomePrices?.[1] ?? coerceNumber(row?.noPrice);
    const no = Number.isFinite(noCandidate as number) ? (noCandidate as number) : 1 - yes;
    const resolutionDate = row?.endDateIso ?? row?.endDate ?? row?.resolutionDate;
    const liquidity = Number(row?.liquidity ?? 0);
    const active = Boolean(row?.active ?? true);
    const closed = Boolean(row?.closed ?? false);
    if (!resolutionDate || !active || closed) {
      stats.skippedMissingResolutionDate += 1;
      return null;
    }
    if (daysUntil(resolutionDate) < config.MIN_DAYS_TO_RESOLUTION) {
      stats.skippedMissingResolutionDate += 1;
      return null;
    }
    if (liquidity < config.MIN_LIQUIDITY_USD) {
      stats.skippedLiquidity += 1;
      return null;
    }
    if (yes < config.MIN_ODDS || yes > config.MAX_ODDS) {
      stats.skippedOdds += 1;
      return null;
    }
    const outcomeStrings = parseMaybeJsonArray(row?.outcomes)
      .map((value) => (typeof value === "string" ? value : undefined))
      .filter((value): value is string => Boolean(value));
    const { yesTokenId, noTokenId } = extractTokenIds(row);
    const candidate: ScannedMarket = {
      marketId: String(row?.id ?? row?.slug ?? ""),
      question: String(row?.question ?? ""),
      description: String(row?.description ?? ""),
      resolutionDate,
      liquidity,
      volume: Number(row?.volume ?? 0),
      currentYesPrice: yes,
      currentNoPrice: Number.isFinite(no) ? no : 1 - yes,
      outcomes: outcomeStrings.length ? outcomeStrings : undefined,
      yesTokenId,
      noTokenId,
      category: String(row?.category ?? "unknown"),
      url: row?.slug ? `https://polymarket.com/event/${row.slug}` : undefined,
      raw: row
    };

    if (looksLikeNovelty(candidate)) {
      stats.rejectedNovelty += 1;
      return null;
    }

    return candidate;
  }

  private scoreMarket(market: ScannedMarket, sourceBucket?: TargetBucket): number {
    let score = 0;
    if (sourceBucket) {
      score += TARGET_BUCKET_SCORES[sourceBucket] ?? 0;
    }
    const haystack = buildMarketText(market);
    for (const rule of CATEGORY_SCORING_RULES) {
      if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
        score += rule.score;
      }
    }
    return score;
  }

  private async fetchTargetedMarkets(filterStats: FilterStats): Promise<{
    entries: ScoredMarket[];
    stats: TargetedFetchStats;
  }> {
    const buckets = buildTargetedBuckets();
    const entries: ScoredMarket[] = [];
    const stats = createTargetedStats();
    for (const bucket of Object.keys(buckets) as TargetBucket[]) {
      const queries = buckets[bucket];
      if (!queries.length) continue;
      for (const query of queries) {
        try {
          const rows = await this.requestMarkets({
            limit: config.TARGETED_MARKET_LIMIT_PER_QUERY,
            active: true,
            closed: false,
            search: query
          });
          stats.fetched += rows.length;
          const scored = this.filterAndScoreRows(rows, filterStats, "targeted", bucket);
          if (!scored.length) continue;
          stats.accepted += scored.length;
          stats.byBucket[bucket] = (stats.byBucket[bucket] ?? 0) + scored.length;
          entries.push(...scored);
        } catch (error) {
          logger.warn({ bucket, query, error: (error as Error).message }, "Failed targeted Gamma fetch");
        }
      }
    }
    return { entries, stats };
  }

  private dedupEntries(entries: ScoredMarket[]): ScoredMarket[] {
    const map = new Map<string, ScoredMarket>();
    for (const entry of entries) {
      const key = entry.market.marketId;
      if (!key) continue;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, entry);
        continue;
      }
      if (entry.score > existing.score) {
        map.set(key, entry);
      } else if (entry.score === existing.score && entry.market.liquidity > existing.market.liquidity) {
        map.set(key, entry);
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.market.liquidity - a.market.liquidity;
    });
  }

  private selectWithBucketQuotas(entries: ScoredMarket[]): {
    selected: (ScoredMarket & { inferredBucket?: TargetBucket })[];
    finalByInferredBucket: Record<TargetBucket, number>;
    finalBySourceBucket: Record<TargetBucket, number>;
    finalOther: number;
    bucketMismatchCount: number;
    bucketMismatches: string[];
  } {
    const bucketMismatches: string[] = [];
    let bucketMismatchCount = 0;
    const enriched = entries.map((entry) => {
      const inferredBucket = inferBucket(entry.market);
      if (entry.sourceBucket && inferredBucket && entry.sourceBucket !== inferredBucket) {
        bucketMismatchCount += 1;
        if (bucketMismatches.length < 15) {
          bucketMismatches.push(formatBucketMismatch(entry.sourceBucket, inferredBucket, entry.market));
        }
      }
      return {
        ...entry,
        inferredBucket
      };
    });
    const targetMins: Record<TargetBucket, number> = {
      macro: config.FINAL_BUCKET_MIN_MACRO,
      politics: config.FINAL_BUCKET_MIN_POLITICS,
      geopolitics: config.FINAL_BUCKET_MIN_GEOPOLITICS,
      crypto: config.FINAL_BUCKET_MIN_CRYPTO,
      sports: 0
    };
    const sportsMax = Math.min(config.TARGETED_BUCKET_MAX_SPORTS, config.FINAL_BUCKET_MAX_SPORTS);
    const selected: (ScoredMarket & { inferredBucket?: TargetBucket })[] = [];
    const finalByInferredBucket = emptyBucketCounts();
    const finalBySourceBucket = emptyBucketCounts();
    let finalOther = 0;
    const seen = new Set<string>();

    const tryAdd = (entry: ScoredMarket & { inferredBucket?: TargetBucket }): boolean => {
      const marketId = entry.market.marketId;
      if (!marketId || seen.has(marketId)) return false;
      if (selected.length >= config.MAX_MARKETS_PER_RUN) return false;
      if (entry.inferredBucket === "sports" && finalByInferredBucket.sports >= sportsMax) return false;
      selected.push(entry);
      seen.add(marketId);
      if (entry.inferredBucket) {
        finalByInferredBucket[entry.inferredBucket] += 1;
      } else {
        finalOther += 1;
      }
      if (entry.sourceBucket) {
        finalBySourceBucket[entry.sourceBucket] += 1;
      }
      return true;
    };

    const reserveBucket = (bucket: TargetBucket, minimum: number) => {
      if (minimum <= 0) return;
      for (const entry of enriched) {
        if (entry.inferredBucket !== bucket) continue;
        if (entry.source !== "targeted") continue;
        if (tryAdd(entry) && finalByInferredBucket[bucket] >= minimum) {
          break;
        }
      }
    };

    reserveBucket("macro", targetMins.macro);
    reserveBucket("politics", targetMins.politics);
    reserveBucket("geopolitics", targetMins.geopolitics);
    reserveBucket("crypto", targetMins.crypto);

    const fill = (predicate: (entry: ScoredMarket & { inferredBucket?: TargetBucket }) => boolean) => {
      for (const entry of enriched) {
        if (selected.length >= config.MAX_MARKETS_PER_RUN) break;
        if (!predicate(entry)) continue;
        tryAdd(entry);
      }
    };

    fill((entry) => entry.inferredBucket !== "sports");
    if (selected.length < config.MAX_MARKETS_PER_RUN && finalByInferredBucket.sports < sportsMax) {
      fill((entry) => entry.inferredBucket === "sports");
    }

    return {
      selected,
      finalByInferredBucket,
      finalBySourceBucket,
      finalOther,
      bucketMismatchCount,
      bucketMismatches
    };
  }
}

function parseOutcomePrices(input: unknown): number[] | null {
  let values: unknown[] = [];
  if (Array.isArray(input)) {
    values = input;
  } else if (typeof input === "string") {
    values = parseMaybeJsonArray(input);
  }
  if (!values.length) return null;
  const normalized = values
    .map((value) => coerceNumber(value))
    .filter((value): value is number => typeof value === "number");
  return normalized.length ? normalized : null;
}

function parseMaybeJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length);
    }
  }
  return [];
}

function extractTokenIds(m: any): { yesTokenId?: string; noTokenId?: string } {
  const result: { yesTokenId?: string; noTokenId?: string } = {};
  if (!m) return result;

  const normalizeTokenId = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length ? trimmed : undefined;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    return undefined;
  };

  const normalizeOutcomeLabel = (value: unknown): "YES" | "NO" | undefined => {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === "yes") return "YES";
    if (normalized === "no") return "NO";
    return undefined;
  };

  const clobTokenIdsRaw = parseMaybeJsonArray(m?.clobTokenIds);
  const clobTokenIds = clobTokenIdsRaw.map((value) => normalizeTokenId(value));
  if (clobTokenIds[0]) result.yesTokenId = clobTokenIds[0];
  if (clobTokenIds[1]) result.noTokenId = clobTokenIds[1];
  if (result.yesTokenId && result.noTokenId) {
    return result;
  }

  const tokens = parseMaybeJsonArray(m?.tokens);
  for (const token of tokens) {
    if (!token || typeof token !== "object") continue;
    const label = normalizeOutcomeLabel(
      (token as any).outcome ?? (token as any).name ?? (token as any).side
    );
    const tokenId = normalizeTokenId(
      (token as any).token_id ?? (token as any).id ?? (token as any).tokenId
    );
    if (!label || !tokenId) continue;
    if (label === "YES" && !result.yesTokenId) result.yesTokenId = tokenId;
    if (label === "NO" && !result.noTokenId) result.noTokenId = tokenId;
  }
  if (result.yesTokenId && result.noTokenId) {
    return result;
  }

  const outcomes = parseMaybeJsonArray(m?.outcomes);
  if (outcomes.length && clobTokenIds.length && outcomes.length === clobTokenIds.length) {
    outcomes.forEach((outcome, idx) => {
      const label = normalizeOutcomeLabel(outcome);
      const tokenId = clobTokenIds[idx];
      if (!label || !tokenId) return;
      if (label === "YES" && !result.yesTokenId) result.yesTokenId = tokenId;
      if (label === "NO" && !result.noTokenId) result.noTokenId = tokenId;
    });
  }

  return result;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function createFilterStats(): FilterStats {
  return {
    skippedMissingResolutionDate: 0,
    skippedLiquidity: 0,
    skippedOdds: 0,
    skippedPrice: 0,
    rejectedNovelty: 0
  };
}

function createTargetedStats(): TargetedFetchStats {
  const base: Record<TargetBucket, number> = {
    macro: 0,
    politics: 0,
    geopolitics: 0,
    crypto: 0,
    sports: 0
  };
  return {
    fetched: 0,
    accepted: 0,
    byBucket: { ...base }
  };
}

function buildTargetedBuckets(): Record<TargetBucket, string[]> {
  return {
    macro: parseQueryList(config.TARGETED_MARKET_QUERIES_MACRO),
    politics: parseQueryList(config.TARGETED_MARKET_QUERIES_POLITICS),
    geopolitics: parseQueryList(config.TARGETED_MARKET_QUERIES_GEOPOLITICS),
    crypto: parseQueryList(config.TARGETED_MARKET_QUERIES_CRYPTO),
    sports: parseQueryList(config.TARGETED_MARKET_QUERIES_SPORTS)
  };
}

function parseQueryList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function looksLikeNovelty(market: ScannedMarket): boolean {
  const haystack = buildMarketText(market);
  return matchesAnyRegex(haystack, NOVELTY_REGEXES);
}

function buildMarketText(market: ScannedMarket): string {
  const fields = [market.question, market.description ?? "", market.category ?? ""];
  if (market.outcomes?.length) fields.push(market.outcomes.join(" "));
  return fields.join(" ").toLowerCase();
}

function inferBucket(market: ScannedMarket): TargetBucket | undefined {
  const text = cleanBucketText(market);
  if (!text.length) return undefined;
  if (matchesAnyRegex(text, NOVELTY_REGEXES)) return undefined;
  if (matchesSports(text)) return "sports";
  if (matchesAnyRegex(text, CRYPTO_REGEXES)) return "crypto";
  if (matchesAnyRegex(text, MACRO_REGEXES)) return "macro";
  if (matchesAnyRegex(text, GEOPOLITICS_REGEXES)) return "geopolitics";
  if (matchesAnyRegex(text, POLITICS_REGEXES)) return "politics";
  return undefined;
}

function formatQuestionSummary(entry: ScoredMarket & { inferredBucket?: TargetBucket }): string {
  const bucket = entry.inferredBucket ?? "other";
  const marketId = entry.market.marketId;
  const question = entry.market.question?.replace(/\s+/g, " ").trim() ?? "";
  const truncated = question.length > 140 ? `${question.slice(0, 137)}...` : question;
  const cleanSnippet = cleanBucketText(entry.market).slice(0, 80);
  const textPreview = cleanSnippet.length ? `|text:${cleanSnippet}` : "";
  return `${bucket}:${marketId}:${truncated}${textPreview}`;
}

function formatBucketMismatch(
  sourceBucket: TargetBucket,
  inferredBucket: TargetBucket,
  market: ScannedMarket
): string {
  const question = market.question?.replace(/\s+/g, " ").trim() ?? "";
  const truncated = question.length > 120 ? `${question.slice(0, 117)}...` : question;
  const cleanSnippet = cleanBucketText(market).slice(0, 80);
  const textPreview = cleanSnippet.length ? `|text:${cleanSnippet}` : "";
  return `${sourceBucket}->${inferredBucket}:${market.marketId}:${truncated}${textPreview}`;
}

function emptyBucketCounts(): Record<TargetBucket, number> {
  return {
    macro: 0,
    politics: 0,
    geopolitics: 0,
    crypto: 0,
    sports: 0
  };
}

function cleanBucketText(market: ScannedMarket): string {
  const parts: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length) parts.push(trimmed);
    }
  };
  push(market.question);
  push(market.category);
  const raw = market.raw;
  if (raw && typeof raw === "object") {
    push((raw as any).groupItemTitle);
    const events = (raw as any).events;
    if (Array.isArray(events) && events.length && events[0] && typeof events[0] === "object") {
      push((events[0] as any).title);
    }
  }
  return parts
    .map((part) => part.toLowerCase())
    .join(" ");
}

function matchesAnyRegex(text: string, patterns: RegExp[]): boolean {
  return patterns.some((regex) => regex.test(text));
}

function matchesSports(text: string): boolean {
  if (matchesAnyRegex(text, SPORTS_REGEXES)) return true;
  if (/\bfinals?\b/i.test(text) && /\b(nba|nhl|conference)\b/i.test(text)) return true;
  return false;
}
