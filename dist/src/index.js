"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPhase2Seed = runPhase2Seed;
const node_crypto_1 = require("node:crypto");
const config_1 = require("./config");
const db_1 = require("./db");
const logger_1 = require("./logger");
const scheduler_1 = require("./scheduler");
const marketScannerAgent_1 = require("./agents/marketScannerAgent");
const polymarketGamma_1 = require("./services/polymarketGamma");
const polymarketOrderbook_1 = require("./services/polymarketOrderbook");
const sqliteStore_1 = require("./services/sqliteStore");
const evidenceAgent_1 = require("./agents/evidenceAgent");
const googleNews_1 = require("./services/googleNews");
const rulesResolutionAgent_1 = require("./agents/rulesResolutionAgent");
const bullBearAgent_1 = require("./agents/bullBearAgent");
const telegramClient_1 = require("./services/telegramClient");
const validation_1 = require("./utils/validation");
async function runPhase2Seed() {
    await (0, db_1.initDb)();
    const runId = (0, node_crypto_1.randomUUID)();
    const store = new sqliteStore_1.SqliteStore();
    const scanner = new marketScannerAgent_1.MarketScannerAgent(config_1.config, new polymarketGamma_1.PolymarketGammaService(), new polymarketOrderbook_1.PolymarketOrderbookService(), store);
    const evidence = new evidenceAgent_1.EvidenceAgent(new googleNews_1.GoogleNewsService());
    const rules = new rulesResolutionAgent_1.RulesResolutionAgent();
    const bullBear = new bullBearAgent_1.BullBearAgent();
    const telegram = new telegramClient_1.TelegramClient();
    const markets = await scanner.run();
    const selected = markets.slice(0, config_1.config.MAX_CANDIDATES_FOR_LIGHT_AI);
    let seeded = 0;
    let skippedAmbiguity = 0;
    let errors = 0;
    for (const market of selected) {
        try {
            const ra = validation_1.rulesAnalysisSchema.parse(await rules.run(market));
            if (ra.ambiguityScore > 0.6 || ra.resolutionRisk === "high") {
                skippedAmbiguity += 1;
                if (config_1.config.TELEGRAM_VERBOSE) {
                    await telegram.sendText(`SKIP ambiguity\nMarket: ${market.question}\nRisk: ${ra.resolutionRisk}\nReason: ${ra.skipReason ?? "-"}`);
                }
                continue;
            }
            const ev = validation_1.evidencePacketSchema.parse(await evidence.run(market));
            const seed = validation_1.seedPacketSchema.parse(await bullBear.run(market, ev, ra));
            await store.insertSeedPacket(runId, market.marketId, seed);
            await store.insertDecision(runId, market.marketId, {
                marketId: market.marketId,
                action: "SKIP",
                adjustedProbability: market.currentYesPrice,
                executablePrice: market.bestAsk ?? market.currentYesPrice,
                marketProbability: market.currentYesPrice,
                edge: 0,
                spread: market.spread ?? 0,
                reason: "Phase 2 seed-only dry run (no execution)",
                confidence: "low"
            }, { approved: false, reason: "Phase 2 disables execution" }, { status: "dry_run", message: "Phase 2 seed-only dry run" }, true);
            seeded += 1;
            if (config_1.config.TELEGRAM_VERBOSE) {
                await telegram.sendText(`SEEDED\nMarket: ${market.question}\nEntities: ${ev.keyEntities.slice(0, 5).join(", ")}\nNews: ${ev.newsItems.length}`);
            }
        }
        catch (err) {
            errors += 1;
            logger_1.logger.error({ err, marketId: market.marketId }, "Phase 2 market processing failed");
        }
    }
    await telegram.sendText([
        "Phase 2 Summary",
        `Run ID: ${runId}`,
        `Markets scanned: ${markets.length}`,
        `Markets considered: ${selected.length}`,
        `Markets seeded: ${seeded}`,
        `Skipped for ambiguity: ${skippedAmbiguity}`,
        `Errors: ${errors}`,
        "Execution: disabled (dry-run seed-only)"
    ].join("\n"));
    logger_1.logger.info({
        runId,
        scanned: markets.length,
        considered: selected.length,
        seeded,
        skippedAmbiguity,
        errors
    }, "Phase 2 run completed");
}
if (require.main === module) {
    if (process.argv.includes("--once")) {
        runPhase2Seed().catch((err) => {
            logger_1.logger.error({ err }, "Phase 2 run failed");
            process.exit(1);
        });
    }
    else {
        (0, scheduler_1.scheduleEvery6Hours)(runPhase2Seed);
    }
}
