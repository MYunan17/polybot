import { closeDb, initDb } from "../db";
import { config } from "../config";
import { logger } from "../logger";
import { getMissingOpenClawCredentials, OpenClawLiveExecutor } from "../services/openClawLiveExecutor";
import { OpenClawClient } from "../services/openclawClient";
import { SqliteStore } from "../services/sqliteStore";

void (async () => {
  await initDb();
  const store = new SqliteStore();
  const missingCredentials = getMissingOpenClawCredentials(config);

  if (config.OPENCLAW_DRY_RUN) {
    logger.warn("OPENCLAW_DRY_RUN=true; refusing to execute approved plans");
    throw new Error("OPENCLAW_DRY_RUN=true; cannot run openclaw:execute-approved");
  }

  if (config.OPENCLAW_KILL_SWITCH) {
    logger.warn("OPENCLAW_KILL_SWITCH=true; expecting skipped_kill_switch statuses only");
  } else if (missingCredentials.length) {
    logger.error({ missingCredentials }, "Missing credentials for live OpenClaw execution; marking plans as failed");
  } else {
    logger.info("OpenClaw live executor ready: kill switch OFF and credentials present");
  }

  const executor = new OpenClawLiveExecutor(config, store, new OpenClawClient());
  const stats = await executor.executeApprovedPlans();
  console.log("OpenClaw execution stats", stats);
  await closeDb();
})().catch(async (err) => {
  logger.error({ err }, "openclaw:execute-approved failed");
  await closeDb();
  process.exit(1);
});
