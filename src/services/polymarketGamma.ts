import axios from "axios";
import { config } from "../config";
import { ScannedMarket } from "../types";
import { daysUntil } from "../utils/time";

const GAMMA_URL = "https://gamma-api.polymarket.com/markets";

export class PolymarketGammaService {
  async fetchMarkets(): Promise<ScannedMarket[]> {
    const res = await axios.get(GAMMA_URL, { timeout: 10000 });
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
      out.push({
        marketId: String(m?.id ?? m?.slug ?? ""),
        question: String(m?.question ?? ""),
        description: String(m?.description ?? ""),
        resolutionDate,
        liquidity,
        volume: Number(m?.volume ?? 0),
        currentYesPrice: yes,
        currentNoPrice: Number.isFinite(no) ? no : 1 - yes,
        outcomes: Array.isArray(m?.outcomes) ? m.outcomes : undefined,
        yesTokenId: m?.clobTokenIds?.[0] ? String(m.clobTokenIds[0]) : undefined,
        noTokenId: m?.clobTokenIds?.[1] ? String(m.clobTokenIds[1]) : undefined,
        category: String(m?.category ?? "unknown"),
        url: m?.slug ? `https://polymarket.com/event/${m.slug}` : undefined,
        raw: {
          id: m?.id,
          slug: m?.slug,
          active: m?.active,
          closed: m?.closed
        }
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
