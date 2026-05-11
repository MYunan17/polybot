import { randomUUID } from "node:crypto";
import { initDb } from "../db";
import { config } from "../config";
import { logger } from "../logger";
import { SqliteStore } from "../services/sqliteStore";
import { CalibrationAgent } from "../agents/calibrationAgent";
import { EdgeJudgmentAgent } from "../agents/edgeJudgmentAgent";
import { OpenClawExecutionAdapter } from "../services/openClawExecutionAdapter";
import { Judgment } from "../types";

export interface PaperSummary {
  runId: string;
  considered: number;
  simulated: number;
  skipped: number;
  duplicateOpenSkipped: number;
  closedOnSignalFlip: number;
  openClawPlans: number;
}

export interface PaperOptions {
  suppressTelegram?: boolean;
}

export async function runPhase4Paper(_options?: PaperOptions): Promise<PaperSummary> {
  await initDb();
  const runId = randomUUID();
  const store = new SqliteStore();
  const calibration = new CalibrationAgent(store);
  const edgeAgent = new EdgeJudgmentAgent(config);
  const openClawAdapter = config.ENABLE_OPENCLAW ? new OpenClawExecutionAdapter(config, store) : null;

  const limit = Math.min(config.MAX_CANDIDATES_FOR_MIROFISH, config.MAX_CANDIDATES_FOR_LIGHT_AI);
  const preds = await store.getLatestSuccessfulMiroFishPredictions(limit);

  if (preds.length === 0) {
    logger.info(
      {
        runId,
        considered: 0,
        message:
          "No successful MiroFish predictions available. Run `npm run mirofish` on a machine where MiroFish is available."
      },
      "Paper run exited gracefully"
    );
    return { runId, considered: 0, simulated: 0, skipped: 0, duplicateOpenSkipped: 0, closedOnSignalFlip: 0, openClawPlans: 0 };
  }

  let simulated = 0;
  let skipped = 0;
  let duplicateOpenSkipped = 0;
  let closedOnSignalFlip = 0;
  let openClawPlans = 0;

  for (const p of preds) {
    try {
      if (!p.seed) {
        skipped += 1;
        continue;
      }
      const openTrade = await store.getOpenPaperTrade(p.marketId);
      const calibrated = await calibration.run(p.marketId, p.rawProbability);
      await store.insertCalibratedPrediction({
        runId,
        marketId: p.marketId,
        rawProbability: calibrated.rawProbability,
        adjustedProbability: calibrated.adjustedProbability,
        calibrationFactor: calibrated.calibrationFactor,
        calibrationReason: calibrated.calibrationReason,
        sampleSize: calibrated.sampleSize,
        categoryAdjustment: calibrated.categoryAdjustment
      });
      const snapshot = await store.getMarketSnapshot(p.marketId);
      const hydratedYes = snapshot?.currentYesPrice ?? p.seed.current_odds;
      const hydratedNo = snapshot?.currentNoPrice ?? 1 - hydratedYes;
      const bestBid = snapshot?.bestBid ?? p.seed.best_bid;
      const bestAsk = snapshot?.bestAsk ?? p.seed.best_ask;
      const spread = snapshot?.spread ?? p.seed.spread ??
        (bestBid !== undefined && bestAsk !== undefined ? Math.max(0, bestAsk - bestBid) : undefined);
      const market = {
        marketId: p.marketId,
        question: p.seed.question,
        description: "",
        resolutionDate: p.seed.resolution_date,
        liquidity: snapshot?.liquidity ?? 0,
        volume: snapshot?.volume ?? 0,
        currentYesPrice: hydratedYes,
        currentNoPrice: hydratedNo,
        bestBid,
        bestAsk,
        spread,
        outcomes: snapshot?.outcomes,
        yesTokenId: snapshot?.yesTokenId,
        noTokenId: snapshot?.noTokenId,
        category: snapshot?.category ?? "unknown",
        url: snapshot?.url,
        raw: snapshot?.raw
      };
      const judgment = await edgeAgent.run(market, calibrated);
      let finalJudgment = judgment;
      const isBuySignal = judgment.action === "BUY_YES" || judgment.action === "BUY_NO";
      if (isBuySignal) {
        const desiredSide = judgment.action === "BUY_YES" ? "YES" : "NO";
        if (openTrade) {
          skipped += 1;
          if (openTrade.side === desiredSide) {
            duplicateOpenSkipped += 1;
            finalJudgment = toSkipJudgment(judgment, "Existing open paper trade for market");
          } else {
            const closePrice = judgment.marketProbability;
            const pnlUsd = calculatePaperPnl(openTrade.market_price, openTrade.size_usd, openTrade.side, closePrice);
            await store.closePaperTrade({
              tradeId: openTrade.id,
              closePrice,
              closeReason: "Signal flipped against open paper trade",
              pnlUsd
            });
            closedOnSignalFlip += 1;
            finalJudgment = toSkipJudgment(judgment, "Signal flipped against open paper trade; closed existing position");
          }
        } else {
          await store.insertPaperTrade({
            runId,
            marketId: p.marketId,
            side: desiredSide,
            probability: calibrated.adjustedProbability,
            marketPrice: judgment.marketProbability,
            edge: judgment.edge,
            sizeUsd: config.TRADE_SIZE_USD,
            status: "paper_open",
            note: "Local Phase 4 paper simulation only"
          });
          if (openClawAdapter) {
            const planned = await openClawAdapter.planTrade({
              runId,
              market,
              snapshot,
              judgment,
              action: "BUY",
              side: desiredSide,
              note: "Paper trade simulated"
            });
            if (planned) openClawPlans += 1;
          }
          simulated += 1;
        }
      } else {
        skipped += 1;
      }
      await store.insertDecision(
        runId,
        p.marketId,
        finalJudgment,
        {
          approved: false,
          reason:
            finalJudgment.action === "SKIP"
              ? finalJudgment.reason
              : "Paper-only mode; no execution"
        },
        { status: "dry_run", message: "Paper mode only; no execution performed" },
        true
      );
    } catch (err) {
      skipped += 1;
      logger.error({ err, marketId: p.marketId }, "Paper processing failed for market");
    }
  }

  logger.info(
    {
      runId,
      considered: preds.length,
      simulated,
      skipped,
      duplicateOpenSkipped,
      closedOnSignalFlip,
      openClawPlans,
      note: "No execution/OpenClaw/private keys used"
    },
    "Paper run completed"
  );

  return { runId, considered: preds.length, simulated, skipped, duplicateOpenSkipped, closedOnSignalFlip, openClawPlans };
}

function toSkipJudgment(judgment: Judgment, reason: string): Judgment {
  return {
    ...judgment,
    action: "SKIP" as const,
    edge: 0,
    reason,
    confidence: "low" as const
  };
}

function calculatePaperPnl(entryPrice: number, sizeUsd: number, side: "YES" | "NO", closePrice: number): number {
  const normalizedEntry = Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : 0;
  if (normalizedEntry === 0) return 0;
  let shares = sizeUsd / normalizedEntry;
  if (!Number.isFinite(shares) || shares <= 0) {
    shares = sizeUsd;
  }
  const pnl = side === "YES" ? (closePrice - normalizedEntry) * shares : (normalizedEntry - closePrice) * shares;
  return Number.isFinite(pnl) ? pnl : 0;
}

if (require.main === module) {
  runPhase4Paper().catch((err) => {
    logger.error({ err }, "Paper run crashed");
    process.exit(1);
  });
}
