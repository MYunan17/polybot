import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { closeDb, initDb } from "../db";
import { logger } from "../logger";
import { SqliteStore } from "../services/sqliteStore";

function parseArgs(): { planId: number } {
  const idx = process.argv.findIndex((arg) => arg === "--plan-id");
  if (idx === -1 || idx + 1 >= process.argv.length) {
    throw new Error("Missing --plan-id <id>");
  }
  const id = Number(process.argv[idx + 1]);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("plan-id must be a positive integer");
  }
  return { planId: id };
}

void (async () => {
  await initDb();
  const store = new SqliteStore();
  const { planId } = parseArgs();
  const plan = await store.getOpenClawPlanById(planId);
  if (!plan) {
    throw new Error(`Plan ${planId} not found`);
  }
  if (plan.dryRun) {
    throw new Error(`Plan ${planId} is marked dry_run=1 and cannot be approved for live execution`);
  }
  if (plan.approvalStatus === "approved") {
    console.log(`Plan ${planId} already approved`);
    await closeDb();
    return;
  }
  if (plan.approvalStatus !== "pending_manual_approval") {
    throw new Error(`Plan ${planId} has status ${plan.approvalStatus} and cannot be approved`);
  }

  const rl = readline.createInterface({ input, output });
  const confirmation = await rl.question(`Type "APPROVE LIVE ORDER ${planId}" to confirm: `);
  await rl.close();
  if (confirmation.trim() !== `APPROVE LIVE ORDER ${planId}`) {
    throw new Error("Confirmation phrase mismatch; aborting");
  }

  await store.updateOpenClawPlanApproval(planId, "approved");
  console.log(`Plan ${planId} marked as approved`);
  await closeDb();
})().catch(async (err) => {
  logger.error({ err }, "openclaw:approve failed");
  await closeDb();
  process.exit(1);
});
