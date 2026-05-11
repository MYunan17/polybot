import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";
import { Database, open } from "sqlite";
import { config } from "./config";

let dbInstance: Database | null = null;

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;
  const dbDir = path.dirname(config.SQLITE_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  dbInstance = await open({
    filename: config.SQLITE_PATH,
    driver: sqlite3.Database
  });
  await dbInstance.exec("PRAGMA journal_mode = WAL;");
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  if (!dbInstance) return;
  await dbInstance.close();
  dbInstance = null;
}

export async function initDb(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS markets (
      market_id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      category TEXT,
      resolution_date TEXT NOT NULL,
      liquidity REAL NOT NULL,
      url TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      raw_probability REAL NOT NULL,
      adjusted_probability REAL NOT NULL,
      market_price REAL NOT NULL,
      edge REAL NOT NULL,
      action TEXT NOT NULL,
      confidence TEXT NOT NULL,
      reasoning_summary TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      judgment_json TEXT NOT NULL,
      risk_json TEXT NOT NULL,
      execution_json TEXT NOT NULL,
      dry_run INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      side TEXT NOT NULL,
      size_usd REAL NOT NULL,
      avg_price REAL NOT NULL,
      status TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      pnl REAL
    );
    CREATE TABLE IF NOT EXISTS resolutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id TEXT NOT NULL,
      resolved_outcome TEXT NOT NULL,
      resolved_at TEXT NOT NULL,
      prediction_correct INTEGER NOT NULL,
      pnl REAL
    );
    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      component TEXT NOT NULL,
      error_message TEXT NOT NULL,
      raw_error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seed_packets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      seed_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mirofish_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      seed_packet_id INTEGER,
      mode TEXT NOT NULL,
      agents INTEGER NOT NULL,
      rounds INTEGER NOT NULL,
      raw_confidence_score REAL,
      raw_probability REAL,
      report_text TEXT,
      result_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      side TEXT NOT NULL,
      probability REAL NOT NULL,
      market_price REAL NOT NULL,
      edge REAL NOT NULL,
      size_usd REAL NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS calibrated_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      raw_probability REAL NOT NULL,
      adjusted_probability REAL NOT NULL,
      calibration_factor REAL NOT NULL,
      calibration_reason TEXT NOT NULL,
      sample_size INTEGER NOT NULL,
      category_adjustment REAL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS news_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      url TEXT NOT NULL,
      published_at TEXT NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL
    );
  `);
  await ensurePaperTradeCloseColumns(db);
}

async function ensurePaperTradeCloseColumns(db: Database): Promise<void> {
  const columns = await db.all<Array<{ name: string }>>(`PRAGMA table_info(paper_trades)`);
  const existing = new Set(columns.map((column) => column.name));
  const required = [
    { name: "close_price", type: "REAL" },
    { name: "close_reason", type: "TEXT" },
    { name: "pnl_usd", type: "REAL" },
    { name: "closed_at", type: "TEXT" }
  ];
  for (const column of required) {
    if (!existing.has(column.name)) {
      await db.exec(`ALTER TABLE paper_trades ADD COLUMN ${column.name} ${column.type}`);
    }
  }
}
