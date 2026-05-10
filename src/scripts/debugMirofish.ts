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
  const parserCase3 = client.parseProbabilityFromReport({
    reportText: "",
    raw: { data: { outline: { summary: "卡罗莱纳飓风队有34.5%的概率赢得2026年斯坦利杯" } } }
  });
  const parserCase4 = client.parseProbabilityFromReport({
    reportText: "",
    raw: { data: { outline: { summary: "科罗拉多雪崩队赢得2026年NHL斯坦利杯的预测概率为**37.0%**" } } }
  });
  const parserCase5 = client.parseProbabilityFromReport({
    reportText: "",
    raw: { data: { outline: { summary: "Recent signals suggest Colorado Avalanche has a 37.0% chance to win the 2026 NHL Stanley Cup." } } }
  });

  const formatParserCase = (
    result: ReturnType<MiroFishClient["parseProbabilityFromReport"]>
  ) =>
    result.ok
      ? {
          probability: result.rawProbability,
          confidenceScore: result.rawConfidenceScore,
          source: result.source
        }
      : { error: result.error };

  console.log("Parser checks:");
  console.log(JSON.stringify({
    case1: formatParserCase(parserCase1),
    case2: formatParserCase(parserCase2),
    case3: formatParserCase(parserCase3),
    case4: formatParserCase(parserCase4),
    case5: formatParserCase(parserCase5)
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
