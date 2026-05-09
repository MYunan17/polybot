import { randomUUID } from "node:crypto";
import { initDb } from "../db";
import { config } from "../config";
import { logger } from "../logger";
import { SqliteStore } from "../services/sqliteStore";
import { CalibrationAgent } from "../agents/calibrationAgent";
import { EdgeJudgmentAgent } from "../agents/edgeJudgmentAgent";

void (async () => {
  await initDb();
  const runId = randomUUID();
  const store = new SqliteStore();
  const calibration = new CalibrationAgent(store);
  const edgeAgent = new EdgeJudgmentAgent(config);

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
    return;
  }

  let simulated = 0;
  let skipped = 0;

  for (const p of preds) {
    try {
      if (!p.seed) {
        skipped += 1;
        continue;
      }
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
      const market = {
        marketId: p.marketId,
        question: p.seed.question,
        description: "",
        resolutionDate: p.seed.resolution_date,
        liquidity: 0,
        volume: 0,
        currentYesPrice: p.seed.current_odds,
        currentNoPrice: 1 - p.seed.current_odds,
        bestBid: p.seed.best_bid,
        bestAsk: p.seed.best_ask,
        spread: p.seed.spread,
        yesTokenId: undefined,
        noTokenId: undefined,
        category: "unknown",
        url: undefined,
        raw: undefined
      };
      const judgment = await edgeAgent.run(market, calibrated);
      if (judgment.action === "BUY_YES" || judgment.action === "BUY_NO") {
        await store.insertPaperTrade({
          runId,
          marketId: p.marketId,
          side: judgment.action === "BUY_YES" ? "YES" : "NO",
          probability: calibrated.adjustedProbability,
          marketPrice: judgment.marketProbability,
          edge: judgment.edge,
          sizeUsd: config.TRADE_SIZE_USD,
          status: "paper_open",
          note: "Local Phase 4 paper simulation only"
        });
        simulated += 1;
      } else {
        skipped += 1;
      }
      await store.insertDecision(
        runId,
        p.marketId,
        judgment,
        { approved: false, reason: "Paper-only mode; no execution" },
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
      note: "No execution/OpenClaw/private keys used"
    },
    "Paper run completed"
  );
})();
