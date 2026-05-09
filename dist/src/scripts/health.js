"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("../config");
const db_1 = require("../db");
const mirofishClient_1 = require("../services/mirofishClient");
void (async () => {
    await (0, db_1.initDb)();
    const mirofish = await new mirofishClient_1.MiroFishClient().healthCheck();
    const report = {
        dryRun: config_1.config.DRY_RUN,
        concurrency: config_1.config.CONCURRENCY,
        sqlitePath: config_1.config.SQLITE_PATH,
        mirofish
    };
    console.log(JSON.stringify(report, null, 2));
    if (!config_1.config.DRY_RUN) {
        console.log("WARNING: DRY_RUN is false. For VPS readiness keep DRY_RUN=true.");
    }
})();
