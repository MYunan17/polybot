import { MiroFishClient } from "../services/mirofishClient";
import { seedPacketSchema } from "../utils/validation";
import { config } from "../config";

void (async () => {
  const client = new MiroFishClient();
  const parserCase1 = client.parseProbabilityFromReport({
    reportText: "",
    raw: { data: { outline: { summary: "胜选概率为54%" } } }
  });
  const parserCase2 = client.parseProbabilityFromReport({
    reportText: "",
    raw: { data: { outline: { summary: "YES probability 72%, confidence_score 0.81" } } }
  });
  console.log("Parser checks:");
  console.log(JSON.stringify({
    case1: parserCase1.ok
      ? { probability: parserCase1.rawProbability, confidenceScore: parserCase1.rawConfidenceScore, source: parserCase1.source }
      : { error: parserCase1.error },
    case2: parserCase2.ok
      ? { probability: parserCase2.rawProbability, confidenceScore: parserCase2.rawConfidenceScore, source: parserCase2.source }
      : { error: parserCase2.error }
  }, null, 2));

  const health = await client.healthCheck();
  console.log("Health check:");
  console.log(JSON.stringify(health, null, 2));

  const syntheticSeed = seedPacketSchema.parse({
    marketId: "debug-test",
    question: "Will Candidate Alice win the 2028 Metro City mayoral election?",
    bull_case:
      "Alice benefits from incumbency, older voters, and business support.",
    bear_case:
      "Brian Lee is gaining among youth voters and housing activists.",
    current_odds: 0.54,
    best_bid: 0.53,
    best_ask: 0.55,
    spread: 0.02,
    key_entities: [
      "Alice Morgan",
      "Brian Lee",
      "Metro City Election Commission",
      "Youth voters",
      "Senior voters",
      "Local business owners",
      "Public transit unions",
      "Housing activists",
      "Local newspapers",
      "Polling agencies"
    ],
    resolution_date: "2099-01-01",
    resolution_rules: [
      "Synthetic debug market, not real.",
      "Resolve YES if Alice Morgan wins the 2028 Metro City mayoral election."
    ],
    evidence_summary:
      "Alice has strong name recognition and incumbent advantage. Brian Lee has momentum among younger voters. Housing affordability and transit reliability are major issues. Local business owners are split. Recent polling is mixed.",
    uncertainty_factors: [
      "turnout",
      "late scandals",
      "polling error",
      "endorsements"
    ]
  });

  const result = await client.predict(syntheticSeed, {
    agents: 5,
    rounds: config.MIROFISH_DEBUG_MAX_ROUNDS,
    model: "deepseek-v3",
    debugMode: true
  });

  console.log("\nWorkflow raw response:");
  console.log(JSON.stringify(result.raw ?? {}, null, 2));

  const wf = (result.raw as any)?.workflow;
  if (wf) {
    console.log("\nWorkflow steps:");
    console.log(`project_id: ${wf.projectId ?? "-"}`);
    console.log(`graph task: ${wf.graphTaskId ?? "-"}`);
    console.log(`graph_id: ${wf.graphId ?? "-"}`);
    console.log(`simulation_id: ${wf.simulationId ?? "-"}`);
    console.log(`prepare task: ${wf.prepareTaskId ?? "-"}`);
    console.log(`report task: ${wf.reportTaskId ?? "-"}`);
    console.log(`report_id: ${wf.reportId ?? "-"}`);
    console.log("final run-status:");
    console.log(JSON.stringify(wf.finalRunStatusRaw ?? {}, null, 2));
    console.log("report generate raw response:");
    console.log(JSON.stringify(wf.reportGenerateRaw ?? {}, null, 2));
    console.log("report status raw response:");
    console.log(JSON.stringify(wf.reportStatusRaw ?? {}, null, 2));
    console.log(`parseAttemptSource: ${wf.parseAttemptSource ?? "-"}`);
    console.log(`numericProbabilityFound: ${wf.numericProbabilityFound === true ? "true" : "false"}`);
    if (wf.reportReadyReason) {
      console.log(wf.reportReadyReason);
    }
  }

  if (!result.ok || !result.result) {
    console.log("\nParsed probability: FAILED (graceful)");
    console.log(`Reason: ${result.error ?? "unknown parsing/request error"}`);
    const failureStep = (result.raw as any)?.step;
    if (failureStep) {
      console.log(`Failure step: ${failureStep}`);
    }
    const rawPrepareStatus = (result.raw as any)?.rawPrepareStatus;
    if (rawPrepareStatus) {
      console.log("Raw prepare status:");
      console.log(JSON.stringify(rawPrepareStatus, null, 2));
    }
    const rawReportStatus = (result.raw as any)?.rawReportStatus;
    if (rawReportStatus) {
      console.log("Latest report status raw:");
      console.log(JSON.stringify(rawReportStatus, null, 2));
    }
    const parseAttemptSource = (result.raw as any)?.parseAttemptSource;
    if (parseAttemptSource) {
      console.log(`parseAttemptSource: ${parseAttemptSource}`);
    }
    console.log("final exit reason: graceful failure");
    process.exit(0);
  }

  console.log("\nParsed probability:");
  console.log(
    JSON.stringify(
      {
        marketId: result.result.marketId,
        rawConfidenceScore: result.result.rawConfidenceScore,
        rawProbability: result.result.rawProbability,
        parseSource: (result.result.modelMetadata as any)?.parseSource ?? "-"
      },
      null,
      2
    )
  );
  console.log("final exit reason: success");
})();
