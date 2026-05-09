"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionAgent = void 0;
class ExecutionAgent {
    openclaw;
    constructor(openclaw) {
        this.openclaw = openclaw;
    }
    async run(decision) {
        if (!decision.approved || !decision.executionRequest) {
            return { status: "rejected", message: decision.reason };
        }
        if (decision.executionRequest.dryRun) {
            return { status: "dry_run", message: "Dry-run enabled, no live order submitted", raw: decision.executionRequest };
        }
        return this.openclaw.placeLimitOrder(decision.executionRequest);
    }
}
exports.ExecutionAgent = ExecutionAgent;
