import { config } from "../config";
import { initDb } from "../db";
import { MiroFishClient } from "../services/mirofishClient";

void (async () => {
  await initDb();
  const mirofish = await new MiroFishClient().healthCheck();
  const report = {
    dryRun: config.DRY_RUN,
    concurrency: config.CONCURRENCY,
    sqlitePath: config.SQLITE_PATH,
    mirofish
  };
  console.log(JSON.stringify(report, null, 2));
  if (!config.DRY_RUN) {
    console.log("WARNING: DRY_RUN is false. For VPS readiness keep DRY_RUN=true.");
  }
})();
