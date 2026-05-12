import { closeDb, initDb } from "../db";
import { logger } from "../logger";
import { SqliteStore } from "../services/sqliteStore";

void (async () => {
  await initDb();
  const store = new SqliteStore();
  const plans = await store.listOpenClawPlans({ approvalStatus: "pending_manual_approval" });
  if (!plans.length) {
    console.log("No pending OpenClaw plans");
    await closeDb();
    return;
  }
  console.log(`Pending OpenClaw plans (${plans.length})`);
  for (const plan of plans) {
    const token = plan.tokenId ? `${plan.tokenId.slice(0, 6)}...` : "n/a";
    console.log(
      `#${plan.id} market=${plan.marketId} side=${plan.side} size=$${plan.sizeUsd.toFixed(2)} price=${plan.limitPrice.toFixed(
        4
      )} token=${token} dry_run=${plan.dryRun} status=${plan.approvalStatus} created=${plan.createdAt}`
    );
  }
  await closeDb();
})().catch(async (err) => {
  logger.error({ err }, "openclaw:plans failed");
  await closeDb();
  process.exit(1);
});
