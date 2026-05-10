import axios from "axios";
import { config } from "../config";
import { ScannedMarket } from "../types";
import { daysUntil } from "../utils/time";

const GAMMA_URL = "https://gamma-api.polymarket.com/markets";

export class PolymarketGammaService {
  async fetchMarkets(): Promise<ScannedMarket[]> {
    const fetchLimit = Math.max(config.MAX_MARKETS_PER_RUN * 3, 200);
    const res = await axios.get(GAMMA_URL, {
      timeout: 10000,
      params: {
        limit: fetchLimit,
        active: true,
        closed: false
      }
    });
    const rows = Array.isArray(res.data) ? res.data : [];
    const out: ScannedMarket[] = [];
    for (const m of rows) {
      if (out.length >= config.MAX_MARKETS_PER_RUN) break;
      const parsedOutcomePrices = parseOutcomePrices(m?.outcomePrices);
      const rawYes = Number(parsedOutcomePrices?.[0] ?? m?.yesPrice);
      const yes = Number.isFinite(rawYes) ? rawYes : NaN;
      const rawNo = Number(parsedOutcomePrices?.[1] ?? m?.noPrice);
      const no = Number.isFinite(rawNo) ? rawNo : NaN;
      const resolutionDate = m?.endDateIso ?? m?.endDate ?? m?.resolutionDate;
      const liquidity = Number(m?.liquidity ?? 0);
      const active = Boolean(m?.active ?? true);
      const closed = Boolean(m?.closed ?? false);
      if (!resolutionDate || !active || closed) continue;
      if (!Number.isFinite(yes)) continue;
      if (daysUntil(resolutionDate) < config.MIN_DAYS_TO_RESOLUTION) continue;
      if (liquidity < config.MIN_LIQUIDITY_USD) continue;
      if (yes < config.MIN_ODDS || yes > config.MAX_ODDS) continue;
      const outcomeStrings = parseMaybeJsonArray(m?.outcomes)
        .map((value) => (typeof value === "string" ? value : undefined))
        .filter((value): value is string => Boolean(value));
      const { yesTokenId, noTokenId } = extractTokenIds(m);
      out.push({
        marketId: String(m?.id ?? m?.slug ?? ""),
        question: String(m?.question ?? ""),
        description: String(m?.description ?? ""),
        resolutionDate,
        liquidity,
        volume: Number(m?.volume ?? 0),
        currentYesPrice: yes,
        currentNoPrice: Number.isFinite(no) ? no : 1 - yes,
        outcomes: outcomeStrings.length ? outcomeStrings : undefined,
        yesTokenId,
        noTokenId,
        category: String(m?.category ?? "unknown"),
        url: m?.slug ? `https://polymarket.com/event/${m.slug}` : undefined,
        raw: m
      });
    }
    return out.filter((m) => m.marketId && m.question);
  }
}

function parseOutcomePrices(input: unknown): string[] | number[] | null {
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
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
