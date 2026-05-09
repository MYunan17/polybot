import { MiroFishClient } from "../services/mirofishClient";
import { seedPacketSchema } from "../utils/validation";

void (async () => {
  const client = new MiroFishClient();
  const health = await client.healthCheck();
  console.log("Health check:");
  console.log(JSON.stringify(health, null, 2));

  const syntheticSeed = seedPacketSchema.parse({
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

  if (!health.ok) {
    console.log("\nMiroFish is not reachable, so no prediction call was made.");
    console.log("Start MiroFish and retry: npm run debug:mirofish");
    process.exit(0);
  }

  const result = await client.predict(syntheticSeed, {
    agents: 5,
    rounds: 2,
    model: "deepseek-v3"
  });

  console.log("\nRaw predict response:");
  console.log(JSON.stringify(result.raw ?? result, null, 2));

  if (!result.ok || !result.result) {
    console.log("\nParsed probability: FAILED");
    console.log(`Reason: ${result.error ?? "unknown parsing/request error"}`);
    process.exit(0);
  }

  console.log("\nParsed probability:");
  console.log(
    JSON.stringify(
      {
        marketId: result.result.marketId,
        rawConfidenceScore: result.result.rawConfidenceScore,
        rawProbability: result.result.rawProbability
      },
      null,
      2
    )
  );
})();
