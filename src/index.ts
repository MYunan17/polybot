import { randomUUID } from "node:crypto";
import { config } from "./config";
import { initDb } from "./db";
import { logger } from "./logger";
import { scheduleEvery6Hours } from "./scheduler";
import { MarketScannerAgent } from "./agents/marketScannerAgent";
import { PolymarketGammaService } from "./services/polymarketGamma";
import { PolymarketOrderbookService } from "./services/polymarketOrderbook";
import { SqliteStore } from "./services/sqliteStore";
import { EvidenceAgent } from "./agents/evidenceAgent";
import { GoogleNewsService } from "./services/googleNews";
import { RulesResolutionAgent } from "./agents/rulesResolutionAgent";
import { BullBearAgent } from "./agents/bullBearAgent";
import { TelegramClient } from "./services/telegramClient";
import { evidencePacketSchema, rulesAnalysisSchema, seedPacketSchema } from "./utils/validation";

export interface Phase2Options {
  suppressTelegram?: boolean;
}

export async function runPhase2Seed(options?: Phase2Options): Promise<void> {
  await initDb();
  const runId = randomUUID();
  const store = new SqliteStore();
  const scanner = new MarketScannerAgent(
    config,
    new PolymarketGammaService(),
    new PolymarketOrderbookService(),
    store
  );
  const evidence = new EvidenceAgent(new GoogleNewsService());
  const rules = new RulesResolutionAgent();
  const bullBear = new BullBearAgent();
  const telegram = new TelegramClient();
  const suppressTelegram = options?.suppressTelegram ?? process.env.SUPPRESS_PHASE_TELEGRAM === "true";
  const telegramEnabled = telegram.enabled && !suppressTelegram;

  const markets = await scanner.run();
  const selected = markets.slice(0, config.MAX_CANDIDATES_FOR_LIGHT_AI);
  let seeded = 0;
  let skippedAmbiguity = 0;
  let errors = 0;

  for (const market of selected) {
    try {
      const ra = rulesAnalysisSchema.parse(await rules.run(market));
      if (ra.ambiguityScore > 0.6 || ra.resolutionRisk === "high") {
        skippedAmbiguity += 1;
        if (config.TELEGRAM_VERBOSE && telegramEnabled) {
          await telegram.sendText(
            `SKIP ambiguity\nMarket: ${market.question}\nRisk: ${ra.resolutionRisk}\nReason: ${ra.skipReason ?? "-"}`
          );
        }
        continue;
      }

      const ev = evidencePacketSchema.parse(await evidence.run(market));
      const seed = seedPacketSchema.parse(await bullBear.run(market, ev, ra));
      await store.insertSeedPacket(runId, market.marketId, seed);
      await store.insertDecision(
        runId,
        market.marketId,
        {
          marketId: market.marketId,
          action: "SKIP",
          adjustedProbability: market.currentYesPrice,
          executablePrice: market.bestAsk ?? market.currentYesPrice,
          marketProbability: market.currentYesPrice,
          edge: 0,
          spread: market.spread ?? 0,
          reason: "Phase 2 seed-only dry run (no execution)",
          confidence: "low"
        },
        { approved: false, reason: "Phase 2 disables execution" },
        { status: "dry_run", message: "Phase 2 seed-only dry run" },
        true
      );
      seeded += 1;

      if (config.TELEGRAM_VERBOSE && telegramEnabled) {
        await telegram.sendText(
          `SEEDED\nMarket: ${market.question}\nEntities: ${ev.keyEntities.slice(0, 5).join(", ")}\nNews: ${ev.newsItems.length}`
        );
      }
    } catch (err) {
      errors += 1;
      logger.error({ err, marketId: market.marketId }, "Phase 2 market processing failed");
    }
  }

  if (telegramEnabled) {
    await telegram.sendText(
      [
        "Phase 2 Summary",
        `Run ID: ${runId}`,
        `Markets scanned: ${markets.length}`,
        `Markets considered: ${selected.length}`,
        `Markets seeded: ${seeded}`,
        `Skipped for ambiguity: ${skippedAmbiguity}`,
        `Errors: ${errors}`,
        "Execution: disabled (dry-run seed-only)"
      ].join("\n")
    );
  }

  logger.info(
    {
      runId,
      scanned: markets.length,
      considered: selected.length,
      seeded,
      skippedAmbiguity,
      errors
    },
    "Phase 2 run completed"
  );
}

if (require.main === module) {
  if (process.argv.includes("--once")) {
    runPhase2Seed().catch((err) => {
      logger.error({ err }, "Phase 2 run failed");
      process.exit(1);
    });
  } else {
    scheduleEvery6Hours(runPhase2Seed);
  }
}
