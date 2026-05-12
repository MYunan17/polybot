import { closeDb, initDb } from "../db";
import { config } from "../config";
import { logger } from "../logger";
import { OpenClawLiveExecutor } from "../services/openClawLiveExecutor";
import { OpenClawClient } from "../services/openclawClient";
import { SqliteStore } from "../services/sqliteStore";

void (async () => {
  await initDb();
  const store = new SqliteStore();
  const executor = new OpenClawLiveExecutor(config, store, new OpenClawClient());
  const stats = await executor.executeApprovedPlans();
  console.log("OpenClaw execution stats", stats);
  await closeDb();
})().catch(async (err) => {
  logger.error({ err }, "openclaw:execute-approved failed");
  await closeDb();
  process.exit(1);
});
