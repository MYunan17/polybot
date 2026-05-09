"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteStore = void 0;
const db_1 = require("../db");
const time_1 = require("../utils/time");
class SqliteStore {
    async upsertMarket(m) {
        const db = await (0, db_1.getDb)();
        await db.run(`
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
    `, m.marketId, m.question, m.category ?? null, m.resolutionDate, m.liquidity, m.url ?? null, JSON.stringify(m.raw ?? {}), (0, time_1.nowIso)(), (0, time_1.nowIso)());
    }
    async insertDecision(runId, marketId, judgment, risk, exec, dryRun) {
        const db = await (0, db_1.getDb)();
        await db.run(`
      INSERT INTO decisions (market_id, run_id, judgment_json, risk_json, execution_json, dry_run, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, marketId, runId, JSON.stringify(judgment), JSON.stringify(risk), JSON.stringify(exec), dryRun ? 1 : 0, (0, time_1.nowIso)());
    }
    async getResolvedPredictionsCount() {
        return this.countResolvedPredictions();
    }
    async countResolvedPredictions() {
        const db = await (0, db_1.getDb)();
        const row = await db.get(`SELECT COUNT(*) as count FROM resolutions`);
        return row?.count ?? 0;
    }
    async insertSeedPacket(runId, marketId, seed) {
        const db = await (0, db_1.getDb)();
        await db.run(`
      INSERT INTO seed_packets (run_id, market_id, seed_json, created_at)
      VALUES (?, ?, ?, ?)
    `, runId, marketId, JSON.stringify(seed), (0, time_1.nowIso)());
    }
    async getLatestSeedPackets(limit) {
        const db = await (0, db_1.getDb)();
        const rows = await db.all(`
      SELECT id, run_id, market_id, seed_json, created_at
      FROM seed_packets
      ORDER BY id DESC
      LIMIT ?
    `, limit);
        return rows.map((r) => ({
            id: r.id,
            runId: r.run_id,
            marketId: r.market_id,
            seed: JSON.parse(r.seed_json),
            createdAt: r.created_at
        }));
    }
    async insertMiroFishResult(input) {
        const db = await (0, db_1.getDb)();
        await db.run(`
      INSERT INTO mirofish_results
      (run_id, market_id, seed_packet_id, mode, agents, rounds, raw_confidence_score, raw_probability, report_text, result_json, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, input.runId, input.marketId, input.seedPacketId ?? null, input.mode, input.agents, input.rounds, input.result?.rawConfidenceScore ?? null, input.result?.rawProbability ?? null, input.result?.reportText ?? null, JSON.stringify(input.raw ?? input.result ?? {}), input.errorMessage ?? null, (0, time_1.nowIso)());
    }
    async getLatestSuccessfulMiroFishPredictions(limit) {
        const db = await (0, db_1.getDb)();
        const rows = await db.all(`
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
    `, limit);
        return rows.map((r) => ({
            resultId: r.id,
            runId: r.run_id,
            marketId: r.market_id,
            rawProbability: Number(r.raw_probability),
            rawConfidenceScore: Number(r.raw_confidence_score),
            seedPacketId: r.seed_packet_id ?? undefined,
            seed: r.seed_json ? JSON.parse(r.seed_json) : undefined,
            createdAt: r.created_at
        }));
    }
    async insertPaperTrade(input) {
        const db = await (0, db_1.getDb)();
        await db.run(`
      INSERT INTO paper_trades (run_id, market_id, side, probability, market_price, edge, size_usd, status, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, input.runId, input.marketId, input.side, input.probability, input.marketPrice, input.edge, input.sizeUsd, input.status, input.note ?? null, (0, time_1.nowIso)());
    }
    async insertCalibratedPrediction(input) {
        const db = await (0, db_1.getDb)();
        await db.run(`
      INSERT INTO calibrated_predictions
      (run_id, market_id, raw_probability, adjusted_probability, calibration_factor, calibration_reason, sample_size, category_adjustment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, input.runId, input.marketId, input.rawProbability, input.adjustedProbability, input.calibrationFactor, input.calibrationReason, input.sampleSize, input.categoryAdjustment ?? null, (0, time_1.nowIso)());
    }
}
exports.SqliteStore = SqliteStore;
