"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.initDb = initDb;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const sqlite3_1 = __importDefault(require("sqlite3"));
const sqlite_1 = require("sqlite");
const config_1 = require("./config");
let dbInstance = null;
async function getDb() {
    if (dbInstance)
        return dbInstance;
    const dbDir = node_path_1.default.dirname(config_1.config.SQLITE_PATH);
    if (!node_fs_1.default.existsSync(dbDir))
        node_fs_1.default.mkdirSync(dbDir, { recursive: true });
    dbInstance = await (0, sqlite_1.open)({
        filename: config_1.config.SQLITE_PATH,
        driver: sqlite3_1.default.Database
    });
    await dbInstance.exec("PRAGMA journal_mode = WAL;");
    return dbInstance;
}
async function initDb() {
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
  `);
}
