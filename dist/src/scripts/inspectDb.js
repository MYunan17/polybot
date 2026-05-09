"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../db");
void (async () => {
    await (0, db_1.initDb)();
    const db = await (0, db_1.getDb)();
    const tables = ["markets", "predictions", "decisions", "positions", "resolutions", "errors", "seed_packets", "mirofish_results", "paper_trades", "calibrated_predictions"];
    for (const t of tables) {
        const row = await db.get(`SELECT COUNT(*) as count FROM ${t}`);
        console.log(`${t}: ${row?.count ?? 0}`);
    }
})();
