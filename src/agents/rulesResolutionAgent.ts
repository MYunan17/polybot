import { RulesAnalysis, ScannedMarket } from "../types";

export class RulesResolutionAgent {
  async run(market: ScannedMarket): Promise<RulesAnalysis> {
    const question = (market.question ?? "").trim();
    const desc = (market.description ?? "").trim();
    const text = `${question} ${desc}`.toLowerCase();
    const ambiguityHints = [
      "according to",
      "official",
      "will resolve",
      "source",
      "criteria",
      "announcement",
      "confirmed",
      "reported"
    ];
    const hitCount = ambiguityHints.filter((h) => text.includes(h)).length;
    const vagueQuestion = question.length < 18 || /\bsoon|later|eventually|sometime\b/i.test(question);
    const missingDescription = !desc;
    const missingResolutionDate = !market.resolutionDate;
    const hasResolutionSource = /(according to|official|source|resolve|criteria|announcement)/i.test(desc);

    let ambiguityScore = Math.min(0.6, hitCount * 0.1);
    if (missingDescription) ambiguityScore += 0.25;
    if (vagueQuestion) ambiguityScore += 0.25;
    if (!hasResolutionSource) ambiguityScore += 0.2;
    if (missingResolutionDate) ambiguityScore += 0.25;
    ambiguityScore = Math.min(1, ambiguityScore);

    const high = ambiguityScore > 0.6;
    const medium = ambiguityScore > 0.35;
    const resolutionSource = hasResolutionSource ? "Market description / listed source" : "Unclear";
    const keyRules = [
      "Trade only when resolution source is explicit",
      "Skip high-ambiguity markets by default",
      "Require resolution date and concrete criteria"
    ];
    const reasons: string[] = [];
    if (missingDescription) reasons.push("missing market description/rules");
    if (vagueQuestion) reasons.push("vague question phrasing");
    if (!hasResolutionSource) reasons.push("no clear resolution source");
    if (missingResolutionDate) reasons.push("missing resolution date");

    return {
      marketId: market.marketId,
      resolutionSource,
      ambiguityScore,
      resolutionRisk: high ? "high" : medium ? "medium" : "low",
      keyRules,
      skipReason: high ? `Ambiguity too high: ${reasons.join("; ") || "unclear criteria"}` : undefined
    };
  }
}
