import { getDb } from "../db";
import {
  ExecutionResult,
  ExternalNewsItem,
  Judgment,
  MiroFishResult,
  RiskDecision,
  ScannedMarket,
  SeedPacket,
  SeedPacketRecord,
  SuccessfulMiroFishPrediction
} from "../types";
import { nowIso } from "../utils/time";

interface OpenPaperTradeRow {
  id: number;
  run_id: string;
  market_id: string;
  side: "YES" | "NO";
  probability: number;
  market_price: number;
  edge: number;
  size_usd: number;
  status: string;
  note: string | null;
  created_at: string;
}

interface PaperTradeDbRow {
  id: number;
  run_id: string;
  market_id: string;
  side: "YES" | "NO";
  probability: number;
  market_price: number;
  edge: number;
  size_usd: number;
  status: "paper_open" | "paper_closed" | "paper_skipped";
  note: string | null;
  created_at: string;
  close_price: number | null;
  close_reason: string | null;
  pnl_usd: number | null;
  closed_at: string | null;
}

export interface PaperTradeRecord {
  id: number;
  runId: string;
  marketId: string;
  side: "YES" | "NO";
  probability: number;
  marketPrice: number;
  edge: number;
  sizeUsd: number;
  status: "paper_open" | "paper_closed" | "paper_skipped";
  note: string | null;
  createdAt: string;
  closePrice: number | null;
  closeReason: string | null;
  pnlUsd: number | null;
  closedAt: string | null;
  runIdRef?: string; // alias to keep backwards compatibility if needed
}

export interface PaperPortfolioSummary {
  openCount: number;
  closedCount: number;
  totalPnlUsd: number;
  duplicateClosedCount: number;
  latestOpen: PaperTradeRecord[];
  latestClosed: PaperTradeRecord[];
}

export interface OpenClawPlanInsert {
  runId: string;
  marketId: string;
  action: "BUY" | "SELL" | "CLOSE" | "SKIP";
  side: "YES" | "NO" | "BOTH";
  tokenId?: string;
  sizeUsd: number;
  limitPrice: number;
  maxSlippage?: number;
  dryRun: boolean;
  approvalStatus: string;
  reason: string;
  riskChecks: string[];
  planJson: Record<string, unknown>;
}

export interface OpenClawPlanRow {
  id: number;
  runId: string;
  marketId: string;
  action: "BUY" | "SELL" | "CLOSE" | "SKIP";
  side: "YES" | "NO" | "BOTH";
  tokenId?: string;
  sizeUsd: number;
  limitPrice: number;
  maxSlippage?: number | null;
  dryRun: boolean;
  approvalStatus: string;
  reason?: string | null;
  riskChecks: string[];
  planJson: Record<string, unknown>;
  createdAt: string;
}

export interface OpenClawExecutionInsert {
  planId: number;
  runId: string;
  marketId: string;
  action: string;
  side: string;
  tokenId?: string;
  sizeUsd: number;
  limitPrice: number;
  status: string;
  txOrOrderId?: string;
  errorMessage?: string;
  dryRun: boolean;
}

function mapPaperTradeRow(row: PaperTradeDbRow): PaperTradeRecord {
  return {
    id: row.id,
    runId: row.run_id,
    marketId: row.market_id,
    side: row.side,
    probability: Number(row.probability ?? 0),
    marketPrice: Number(row.market_price ?? 0),
    edge: Number(row.edge ?? 0),
    sizeUsd: Number(row.size_usd ?? 0),
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    closePrice: row.close_price != null ? Number(row.close_price) : null,
    closeReason: row.close_reason,
    pnlUsd: row.pnl_usd != null ? Number(row.pnl_usd) : null,
    closedAt: row.closed_at,
    runIdRef: row.run_id
  };
}

function mapOpenClawPlanRow(row: any): OpenClawPlanRow {
  return {
    id: row.id,
    runId: row.run_id,
    marketId: row.market_id,
    action: row.action,
    side: row.side,
    tokenId: row.token_id ?? undefined,
    sizeUsd: Number(row.size_usd ?? 0),
    limitPrice: Number(row.limit_price ?? 0),
    maxSlippage: row.max_slippage != null ? Number(row.max_slippage) : null,
    dryRun: Boolean(row.dry_run),
    approvalStatus: row.approval_status,
    reason: row.reason,
    riskChecks: (parseJson(row.risk_checks) ?? []) as string[],
    planJson: (parseJson(row.plan_json) ?? {}) as Record<string, unknown>,
    createdAt: row.created_at
  };
}

export class SqliteStore {
  async upsertMarket(m: ScannedMarket): Promise<void> {
    const db = await getDb();
    await db.run(
      `
      INSERT INTO markets (market_id, question, category, resolution_date, liquidity, url, raw_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(market_id) DO UPDATE SET
        question=excluded.question,
        category=excluded.category,
        resolution_date=excluded.resolution_date,
        liquidity=excluded.liquidity,
        url=excluded.url,
        raw_json=excluded.raw_json,
        updated_at=excluded.updated_at
    `,
      m.marketId,
      m.question,
      m.category ?? null,
      m.resolutionDate,
      m.liquidity,
      m.url ?? null,
      JSON.stringify(m.raw ?? {}),
      nowIso(),
      nowIso()
    );
  }

  async insertOpenClawExecutionPlan(input: OpenClawPlanInsert): Promise<number> {
    const db = await getDb();
    const result = await db.run(
      `
        INSERT INTO openclaw_execution_plans
          (run_id, market_id, action, side, token_id, size_usd, limit_price, max_slippage, dry_run, approval_status, reason, risk_checks, plan_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      input.runId,
      input.marketId,
      input.action,
      input.side,
      input.tokenId ?? null,
      input.sizeUsd,
      input.limitPrice,
      input.maxSlippage ?? null,
      input.dryRun ? 1 : 0,
      input.approvalStatus,
      input.reason,
      JSON.stringify(input.riskChecks ?? []),
      JSON.stringify(input.planJson),
      nowIso()
    );
    return Number(result.lastID);
  }

  async listOpenClawPlans(filter?: { approvalStatus?: string; dryRun?: boolean; unexecuted?: boolean }): Promise<OpenClawPlanRow[]> {
    const db = await getDb();
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.approvalStatus) {
      clauses.push("approval_status = ?");
      params.push(filter.approvalStatus);
    }
    if (filter?.dryRun !== undefined) {
      clauses.push("dry_run = ?");
      params.push(filter.dryRun ? 1 : 0);
    }
    if (filter?.unexecuted) {
      clauses.push(
        "NOT EXISTS (SELECT 1 FROM openclaw_executions e WHERE e.plan_id = openclaw_execution_plans.id)"
      );
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await db.all<Array<any>>(
      `SELECT id, run_id, market_id, action, side, token_id, size_usd, limit_price, max_slippage, dry_run, approval_status, reason, risk_checks, plan_json, created_at
       FROM openclaw_execution_plans
       ${where}
       ORDER BY id DESC`,
      ...params
    );
    return rows.map(mapOpenClawPlanRow);
  }

  async getOpenClawPlanById(planId: number): Promise<OpenClawPlanRow | null> {
    const db = await getDb();
    const row = await db.get<any>(
      `SELECT id, run_id, market_id, action, side, token_id, size_usd, limit_price, max_slippage, dry_run, approval_status, reason, risk_checks, plan_json, created_at
       FROM openclaw_execution_plans
       WHERE id = ?`,
      planId
    );
    return row ? mapOpenClawPlanRow(row) : null;
  }

  async updateOpenClawPlanApproval(planId: number, approvalStatus: string): Promise<void> {
    const db = await getDb();
    await db.run(`UPDATE openclaw_execution_plans SET approval_status = ? WHERE id = ?`, approvalStatus, planId);
  }

  async insertOpenClawExecution(input: OpenClawExecutionInsert): Promise<void> {
    const db = await getDb();
    await db.run(
      `INSERT INTO openclaw_executions (plan_id, run_id, market_id, action, side, token_id, size_usd, limit_price, status, tx_or_order_id, error_message, dry_run, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.planId,
      input.runId,
      input.marketId,
      input.action,
      input.side,
      input.tokenId ?? null,
      input.sizeUsd,
      input.limitPrice,
      input.status,
      input.txOrOrderId ?? null,
      input.errorMessage ?? null,
      input.dryRun ? 1 : 0,
      nowIso()
    );
  }

  async getOpenClawDailyUsage(): Promise<{ orderCount: number; usdTotal: number }> {
    const db = await getDb();
    const row = await db.get<{ count: number; total: number }>(
      `SELECT COUNT(*) as count, COALESCE(SUM(size_usd), 0) as total
       FROM openclaw_executions
       WHERE date(created_at) = date('now', 'localtime')
         AND status = 'submitted'
         AND dry_run = 0`
    );
    return { orderCount: row?.count ?? 0, usdTotal: row?.total ?? 0 };
  }

  async getOpenClawExecutionSummary(runId?: string): Promise<Record<string, number>> {
    if (!runId) return {};
    const db = await getDb();
    const rows = await db.all<Array<{ status: string; count: number }>>(
      `SELECT status, COUNT(*) as count FROM openclaw_executions WHERE run_id = ? GROUP BY status`,
      runId
    );
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});
  }

  async countOpenClawPlans(runId?: string): Promise<number> {
    if (!runId) return 0;
    const db = await getDb();
    const row = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM openclaw_execution_plans WHERE run_id = ?`,
      runId
    );
    return row?.count ?? 0;
  }

  async getPaperPortfolioSummary(limit = 5): Promise<PaperPortfolioSummary> {
    const db = await getDb();
    const [openRow, closedRow, pnlRow, duplicateRow] = await Promise.all([
      db.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM paper_trades WHERE status = 'paper_open'"
      ),
      db.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM paper_trades WHERE status = 'paper_closed'"
      ),
      db.get<{ total: number | null }>(
        "SELECT SUM(pnl_usd) as total FROM paper_trades WHERE status = 'paper_closed'"
      ),
      db.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM paper_trades WHERE status = 'paper_closed' AND close_reason LIKE 'Signal flipped%'"
      )
    ]);

    const latestOpenRows = await db.all<PaperTradeDbRow[]>(
      `
        SELECT id, run_id, market_id, side, probability, market_price, edge, size_usd, status, note,
               created_at, close_price, close_reason, pnl_usd, closed_at
        FROM paper_trades
        WHERE status = 'paper_open'
        ORDER BY id DESC
        LIMIT ?
      `,
      limit
    );

    const latestClosedRows = await db.all<PaperTradeDbRow[]>(
      `
        SELECT id, run_id, market_id, side, probability, market_price, edge, size_usd, status, note,
               created_at, close_price, close_reason, pnl_usd, closed_at
        FROM paper_trades
        WHERE status = 'paper_closed'
        ORDER BY COALESCE(closed_at, created_at) DESC, id DESC
        LIMIT ?
      `,
      limit
    );

    return {
      openCount: openRow?.count ?? 0,
      closedCount: closedRow?.count ?? 0,
      totalPnlUsd: pnlRow?.total ?? 0,
      duplicateClosedCount: duplicateRow?.count ?? 0,
      latestOpen: latestOpenRows.map(mapPaperTradeRow),
      latestClosed: latestClosedRows.map(mapPaperTradeRow)
    };
  }

  async insertNewsItems(marketId: string, items: ExternalNewsItem[]): Promise<void> {
    if (!items.length) return;
    const db = await getDb();
    await db.run("BEGIN TRANSACTION");
    try {
      for (const item of items) {
        await db.run(
          `
            INSERT INTO news_items (market_id, title, source, url, published_at, summary, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          marketId,
          item.title,
          item.source,
          item.url,
          item.publishedAt,
          item.summary,
          nowIso()
        );
      }
      await db.run("COMMIT");
    } catch (err) {
      await db.run("ROLLBACK");
      throw err;
    }
  }

  async hasOpenPaperTrade(marketId: string): Promise<boolean> {
    const db = await getDb();
    const row = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM paper_trades WHERE market_id = ? AND status = 'paper_open'`,
      marketId
    );
    return (row?.count ?? 0) > 0;
  }

  async getOpenPaperTrade(marketId: string): Promise<OpenPaperTradeRow | null> {
    const db = await getDb();
    const row = await db.get<OpenPaperTradeRow>(
      `
        SELECT id, run_id, market_id, side, probability, market_price, edge, size_usd, status, note, created_at
        FROM paper_trades
        WHERE market_id = ? AND status = 'paper_open'
        ORDER BY id DESC
        LIMIT 1
      `,
      marketId
    );
    return row ?? null;
  }

  async closePaperTrade(input: { tradeId: number; closePrice: number; closeReason: string; pnlUsd: number }): Promise<void> {
    const db = await getDb();
    await db.run(
      `
        UPDATE paper_trades
        SET status = 'paper_closed',
            close_price = ?,
            close_reason = ?,
            pnl_usd = ?,
            closed_at = ?
        WHERE id = ?
      `,
      input.closePrice,
      input.closeReason,
      input.pnlUsd,
      nowIso(),
      input.tradeId
    );
  }

  async getMarketSnapshot(marketId: string): Promise<Partial<ScannedMarket> | null> {
    const db = await getDb();
    const row = await db.get<{
      market_id: string;
      question: string;
      category: string | null;
      resolution_date: string;
      liquidity: number;
      url: string | null;
      raw_json: string | null;
    }>(
      `
      SELECT market_id, question, category, resolution_date, liquidity, url, raw_json
      FROM markets
      WHERE market_id = ?
    `,
      marketId
    );
    if (!row) return null;
    const raw = parseJson(row.raw_json);
    const parsedOutcomePrices = raw ? parseOutcomePrices(raw?.outcomePrices) : null;
    const { yesTokenId, noTokenId } = raw ? extractTokenIds(raw) : {};
    const outcomes = raw ? parseOutcomeStrings(raw?.outcomes) : undefined;
    const bestBid = raw
      ? coerceNumber(raw?.bestBid ?? raw?.yesBestBid ?? raw?.book?.yesBestBid)
      : undefined;
    const bestAsk = raw
      ? coerceNumber(raw?.bestAsk ?? raw?.yesBestAsk ?? raw?.book?.yesBestAsk)
      : undefined;
    const spread = raw
      ? coerceNumber(raw?.spread ?? raw?.book?.spread) ??
        (bestBid !== undefined && bestAsk !== undefined ? Math.max(0, bestAsk - bestBid) : undefined)
      : undefined;

    return {
      marketId: row.market_id,
      question: row.question,
      resolutionDate: row.resolution_date,
      liquidity: Number(row.liquidity ?? 0),
      volume: raw ? coerceNumber(raw?.volume) ?? 0 : 0,
      currentYesPrice: parsedOutcomePrices?.[0] ?? (raw ? coerceNumber(raw?.yesPrice) : undefined),
      currentNoPrice: parsedOutcomePrices?.[1] ?? (raw ? coerceNumber(raw?.noPrice) : undefined),
      bestBid,
      bestAsk,
      spread,
      outcomes,
      yesTokenId,
      noTokenId,
      category: row.category ?? undefined,
      url: row.url ?? undefined,
      raw: raw ?? undefined
    };
  }

  async insertDecision(runId: string, marketId: string, judgment: Judgment, risk: RiskDecision, exec: ExecutionResult, dryRun: boolean): Promise<void> {
    const db = await getDb();
    await db.run(
      `
      INSERT INTO decisions (market_id, run_id, judgment_json, risk_json, execution_json, dry_run, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      marketId,
      runId,
      JSON.stringify(judgment),
      JSON.stringify(risk),
      JSON.stringify(exec),
      dryRun ? 1 : 0,
      nowIso()
    );
  }

  async getResolvedPredictionsCount(): Promise<number> {
    return this.countResolvedPredictions();
  }

  async countResolvedPredictions(): Promise<number> {
    const db = await getDb();
    const row = await db.get<{ count: number }>(`SELECT COUNT(*) as count FROM resolutions`);
    return row?.count ?? 0;
  }

  async insertSeedPacket(runId: string, marketId: string, seed: SeedPacket): Promise<void> {
    const db = await getDb();
    await db.run(
      `
      INSERT INTO seed_packets (run_id, market_id, seed_json, created_at)
      VALUES (?, ?, ?, ?)
    `,
      runId,
      marketId,
      JSON.stringify(seed),
      nowIso()
    );
  }

  async getLatestSeedPackets(limit: number): Promise<SeedPacketRecord[]> {
    const db = await getDb();
    const rows = await db.all<Array<{ id: number; run_id: string; market_id: string; seed_json: string; created_at: string }>>(
      `
      SELECT id, run_id, market_id, seed_json, created_at
      FROM seed_packets
      ORDER BY id DESC
      LIMIT ?
    `,
      limit
    );
    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      marketId: r.market_id,
      seed: JSON.parse(r.seed_json) as SeedPacket,
      createdAt: r.created_at
    }));
  }

  async insertMiroFishResult(input: {
    runId: string;
    marketId: string;
    seedPacketId?: number;
    mode: "light" | "deep";
    agents: number;
    rounds: number;
    result?: MiroFishResult;
    errorMessage?: string;
    raw?: unknown;
  }): Promise<void> {
    const db = await getDb();
    await db.run(
      `
      INSERT INTO mirofish_results
      (run_id, market_id, seed_packet_id, mode, agents, rounds, raw_confidence_score, raw_probability, report_text, result_json, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      input.runId,
      input.marketId,
      input.seedPacketId ?? null,
      input.mode,
      input.agents,
      input.rounds,
      input.result?.rawConfidenceScore ?? null,
      input.result?.rawProbability ?? null,
      input.result?.reportText ?? null,
      JSON.stringify(input.raw ?? input.result ?? {}),
      input.errorMessage ?? null,
      nowIso()
    );
  }

  async getLatestSuccessfulMiroFishPredictions(limit: number): Promise<SuccessfulMiroFishPrediction[]> {
    const db = await getDb();
    const rows = await db.all<Array<{
      id: number;
      run_id: string;
      market_id: string;
      seed_packet_id: number | null;
      raw_probability: number;
      raw_confidence_score: number;
      created_at: string;
      seed_json: string | null;
    }>>(
      `
      SELECT
        mr.id,
        mr.run_id,
        mr.market_id,
        mr.seed_packet_id,
        mr.raw_probability,
        mr.raw_confidence_score,
        mr.created_at,
        sp.seed_json
      FROM mirofish_results mr
      LEFT JOIN seed_packets sp ON sp.id = mr.seed_packet_id
      WHERE mr.error_message IS NULL
        AND mr.raw_probability IS NOT NULL
        AND mr.raw_confidence_score IS NOT NULL
      ORDER BY mr.id DESC
      LIMIT ?
    `,
      limit
    );
    return rows.map((r) => ({
      resultId: r.id,
      runId: r.run_id,
      marketId: r.market_id,
      rawProbability: Number(r.raw_probability),
      rawConfidenceScore: Number(r.raw_confidence_score),
      seedPacketId: r.seed_packet_id ?? undefined,
      seed: r.seed_json ? (JSON.parse(r.seed_json) as SeedPacket) : undefined,
      createdAt: r.created_at
    }));
  }

  async insertPaperTrade(input: {
    runId: string;
    marketId: string;
    side: "YES" | "NO";
    probability: number;
    marketPrice: number;
    edge: number;
    sizeUsd: number;
    status: "paper_open" | "paper_skipped" | "paper_closed";
    note?: string;
  }): Promise<void> {
    const db = await getDb();
    await db.run(
      `
      INSERT INTO paper_trades (run_id, market_id, side, probability, market_price, edge, size_usd, status, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      input.runId,
      input.marketId,
      input.side,
      input.probability,
      input.marketPrice,
      input.edge,
      input.sizeUsd,
      input.status,
      input.note ?? null,
      nowIso()
    );
  }

  async insertCalibratedPrediction(input: {
    runId: string;
    marketId: string;
    rawProbability: number;
    adjustedProbability: number;
    calibrationFactor: number;
    calibrationReason: string;
    sampleSize: number;
    categoryAdjustment?: number;
  }): Promise<void> {
    const db = await getDb();
    await db.run(
      `
      INSERT INTO calibrated_predictions
      (run_id, market_id, raw_probability, adjusted_probability, calibration_factor, calibration_reason, sample_size, category_adjustment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      input.runId,
      input.marketId,
      input.rawProbability,
      input.adjustedProbability,
      input.calibrationFactor,
      input.calibrationReason,
      input.sampleSize,
      input.categoryAdjustment ?? null,
      nowIso()
    );
  }
}

function parseJson(input: string | null): any | undefined {
  if (!input) return undefined;
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

function parseOutcomeStrings(value: unknown): string[] | undefined {
  const arr = parseMaybeJsonArray(value)
    .map((item) => (typeof item === "string" ? item : undefined))
    .filter((item): item is string => Boolean(item));
  return arr.length ? arr : undefined;
}

function parseOutcomePrices(input: unknown): number[] | null {
  const values = parseMaybeJsonArray(input);
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
