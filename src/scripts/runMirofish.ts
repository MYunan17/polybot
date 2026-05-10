import { randomUUID } from "node:crypto";
import { initDb } from "../db";
import { config } from "../config";
import { logger } from "../logger";
import { SqliteStore } from "../services/sqliteStore";
import { seedPacketSchema } from "../utils/validation";
import { MiroFishClient } from "../services/mirofishClient";
import { MiroFishSwarmAgent } from "../agents/mirofishSwarmAgent";
import { TelegramClient } from "../services/telegramClient";

export interface Phase3Summary {
  runId: string;
  considered: number;
  successCount: number;
  failCount: number;
  avgProbability: number;
  health: { ok: boolean; detectedRoute?: string; message?: string };
  topConfidence: string;
}

export async function runPhase3Mirofish(): Promise<Phase3Summary> {
  await initDb();
  const runId = randomUUID();
  const store = new SqliteStore();
  const telegram = new TelegramClient();
  const client = new MiroFishClient();
  const swarm = new MiroFishSwarmAgent(client);

  const limit = Math.min(config.MAX_CANDIDATES_FOR_MIROFISH, config.MAX_CANDIDATES_FOR_LIGHT_AI);
  const seedRecords = await store.getLatestSeedPackets(limit);
  const health = await client.healthCheck();
  const healthOk = health.ok;

  let successCount = 0;
  let failCount = 0;
  const successProbs: number[] = [];
  const top: Array<{ marketId: string; confidence: number; probability: number }> = [];

  for (const record of seedRecords) {
    try {
      const seed = seedPacketSchema.parse(record.seed);
      const mode = config.RUN_DEEP_MIROFISH ? "deep" : "light";
      const run = mode === "deep" ? await swarm.runDeep(seed) : await swarm.runLight(seed);
      const response = run.response;

      if (!response.ok || !response.result) {
        failCount += 1;
        await store.insertMiroFishResult({
          runId,
          marketId: seed.marketId,
          seedPacketId: record.id,
          mode: run.mode,
          agents: run.agents,
          rounds: run.rounds,
          errorMessage: response.error ?? "unknown mirofish error",
          raw: response.raw
        });
        await store.insertDecision(
          runId,
          seed.marketId,
          {
            marketId: seed.marketId,
            action: "PREDICTION_ONLY",
            adjustedProbability: seed.current_odds,
            executablePrice: seed.best_ask ?? seed.current_odds,
            marketProbability: seed.current_odds,
            edge: 0,
            spread: seed.spread ?? 0,
            reason: `MiroFish failed: ${response.error ?? "unknown"}`,
            confidence: "low"
          },
          { approved: false, reason: "Phase 3 prediction-only mode" },
          { status: "dry_run", message: "No execution in Phase 3" },
          true
        );
        if (config.TELEGRAM_VERBOSE) {
          await telegram.sendText(`MIROFISH FAIL\nMarket: ${seed.question}\nReason: ${response.error ?? "unknown"}`);
        }
        continue;
      }

      successCount += 1;
      successProbs.push(response.result.rawProbability);
      top.push({
        marketId: seed.marketId,
        confidence: response.result.rawConfidenceScore,
        probability: response.result.rawProbability
      });
      await store.insertMiroFishResult({
        runId,
        marketId: seed.marketId,
        seedPacketId: record.id,
        mode: run.mode,
        agents: run.agents,
        rounds: run.rounds,
        result: response.result,
        raw: response.raw
      });
      await store.insertDecision(
        runId,
        seed.marketId,
        {
          marketId: seed.marketId,
          action: "PREDICTION_ONLY",
          adjustedProbability: response.result.rawProbability,
          executablePrice: seed.best_ask ?? seed.current_odds,
          marketProbability: seed.current_odds,
          edge: 0,
          spread: seed.spread ?? 0,
          reason: "MiroFish prediction captured; no execution in Phase 3",
          confidence:
            response.result.rawConfidenceScore >= 75
              ? "high"
              : response.result.rawConfidenceScore >= 60
                ? "medium"
                : "low"
        },
        { approved: false, reason: "Phase 3 prediction-only mode" },
        { status: "dry_run", message: "No execution in Phase 3" },
        true
      );
      if (config.TELEGRAM_VERBOSE) {
        await telegram.sendText(
          `MIROFISH OK\nMarket: ${seed.question}\nConfidence: ${response.result.rawConfidenceScore.toFixed(1)}%\nProbability: ${(response.result.rawProbability * 100).toFixed(1)}%`
        );
      }
    } catch (err: any) {
      failCount += 1;
      logger.error({ err, marketId: record.marketId }, "Phase 3 processing failed");
      await store.insertMiroFishResult({
        runId,
        marketId: record.marketId,
        seedPacketId: record.id,
        mode: config.RUN_DEEP_MIROFISH ? "deep" : "light",
        agents: config.RUN_DEEP_MIROFISH ? config.MIROFISH_DEEP_AGENTS : config.MIROFISH_LIGHT_AGENTS,
        rounds: config.RUN_DEEP_MIROFISH ? config.MIROFISH_DEEP_ROUNDS : config.MIROFISH_LIGHT_ROUNDS,
        errorMessage: err?.message ?? "unknown error",
        raw: err
      });
    }
  }

  const avgProb = successProbs.length
    ? successProbs.reduce((a, b) => a + b, 0) / successProbs.length
    : 0;
  const top3 = top
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map((t, i) => `${i + 1}. ${t.marketId} conf=${t.confidence.toFixed(1)}% prob=${(t.probability * 100).toFixed(1)}%`)
    .join("\n");

  await telegram.sendText(
    [
      "Phase 3 Summary (MiroFish Prediction-Only)",
      `Run ID: ${runId}`,
      `MiroFish health: ${healthOk ? "ok" : "unreachable"}`,
      `Detected route: ${health.detectedRoute ?? "-"}`,
      `Health message: ${health.message}`,
      `Seed packets considered: ${seedRecords.length}`,
      `MiroFish success: ${successCount}`,
      `MiroFish failure: ${failCount}`,
      `Average raw probability: ${(avgProb * 100).toFixed(2)}%`,
      "Top 3 confidence predictions:",
      top3 || "-",
      "Execution: not performed"
    ].join("\n")
  );

  logger.info(
    {
      runId,
      health,
      considered: seedRecords.length,
      successCount,
      failCount,
      avgProb
    },
    "Phase 3 run completed"
  );

  return {
    runId,
    considered: seedRecords.length,
    successCount,
    failCount,
    avgProbability: avgProb,
    health: { ok: healthOk, detectedRoute: health.detectedRoute, message: health.message },
    topConfidence: top3 || "-"
  };
}

if (require.main === module) {
  runPhase3Mirofish().catch((err) => {
    logger.error({ err }, "Phase 3 run crashed");
    process.exit(1);
  });
}
