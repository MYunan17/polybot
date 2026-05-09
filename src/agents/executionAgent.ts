import { OpenClawClient } from "../services/openclawClient";
import { ExecutionResult, RiskDecision } from "../types";

export class ExecutionAgent {
  constructor(private readonly openclaw: OpenClawClient) {}

  async run(decision: RiskDecision): Promise<ExecutionResult> {
    if (!decision.approved || !decision.executionRequest) {
      return { status: "rejected", message: decision.reason };
    }
    if (decision.executionRequest.dryRun) {
      return { status: "dry_run", message: "Dry-run enabled, no live order submitted", raw: decision.executionRequest };
    }
    return this.openclaw.placeLimitOrder(decision.executionRequest);
  }
}
