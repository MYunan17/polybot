import { getDb, initDb } from "../db";

void (async () => {
  await initDb();
  const db = await getDb();
  const tables = ["markets", "predictions", "decisions", "positions", "resolutions", "errors", "seed_packets", "mirofish_results", "paper_trades", "calibrated_predictions"];
  for (const t of tables) {
    const row = await db.get<{ count: number }>(`SELECT COUNT(*) as count FROM ${t}`);
    console.log(`${t}: ${row?.count ?? 0}`);
  }
})();
