"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mirofishClient_1 = require("../services/mirofishClient");
const validation_1 = require("../utils/validation");
const config_1 = require("../config");
void (async () => {
    const client = new mirofishClient_1.MiroFishClient();
    const health = await client.healthCheck();
    console.log("Health check:");
    console.log(JSON.stringify(health, null, 2));
    const syntheticSeed = validation_1.seedPacketSchema.parse({
        marketId: "debug-test",
        question: "Will a coin flip land heads?",
        bull_case: "A fair coin has a 50% chance of heads.",
        bear_case: "A fair coin has a 50% chance of tails.",
        current_odds: 0.5,
        best_bid: 0.49,
        best_ask: 0.51,
        spread: 0.02,
        key_entities: ["coin flip"],
        resolution_date: "2099-01-01",
        resolution_rules: ["Synthetic debug market, not real."],
        evidence_summary: "No external evidence.",
        uncertainty_factors: ["Random event"]
    });
    const result = await client.predict(syntheticSeed, {
        agents: 5,
        rounds: config_1.config.MIROFISH_DEBUG_MAX_ROUNDS,
        model: "deepseek-v3",
        debugMode: true
    });
    console.log("\nWorkflow raw response:");
    console.log(JSON.stringify(result.raw ?? {}, null, 2));
    const wf = result.raw?.workflow;
    if (wf) {
        console.log("\nWorkflow steps:");
        console.log(`project_id: ${wf.projectId ?? "-"}`);
        console.log(`graph task: ${wf.graphTaskId ?? "-"}`);
        console.log(`graph_id: ${wf.graphId ?? "-"}`);
        console.log(`simulation_id: ${wf.simulationId ?? "-"}`);
        console.log(`prepare task: ${wf.prepareTaskId ?? "-"}`);
        console.log(`report task: ${wf.reportTaskId ?? "-"}`);
        console.log(`report_id: ${wf.reportId ?? "-"}`);
    }
    if (!result.ok || !result.result) {
        console.log("\nParsed probability: FAILED (graceful)");
        console.log(`Reason: ${result.error ?? "unknown parsing/request error"}`);
        process.exit(0);
    }
    console.log("\nParsed probability:");
    console.log(JSON.stringify({
        marketId: result.result.marketId,
        rawConfidenceScore: result.result.rawConfidenceScore,
        rawProbability: result.result.rawProbability
    }, null, 2));
})();
