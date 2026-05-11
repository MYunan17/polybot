import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();
const boolEnv = z.preprocess((v) => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["1", "true", "yes", "on"].includes(v.toLowerCase());
  return false;
}, z.boolean());

const envSchema = z.object({
  DEEPSEEK_API_KEY: z.string().optional().default(""),
  ZEP_API_KEY: z.string().optional().default(""),
  ZEP_COLLECTION_NAME: z.string().default("polymarket-agent-memory"),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_CHAT_ID: z.string().optional().default(""),
  MIROFISH_URL: z.string().url().default("http://localhost:5001"),
  POLYMARKET_PRIVATE_KEY: z.string().optional().default(""),
  POLYMARKET_FUNDER_ADDRESS: z.string().optional().default(""),
  POLYMARKET_PROXY_ADDRESS: z.string().optional().default(""),
  POLYMARKET_CHAIN_ID: z.coerce.number().default(137),
  OPENCLAW_URL: z.string().url().default("http://localhost:3000"),
  OPENCLAW_API_KEY: z.string().optional().default(""),
  DRY_RUN: boolEnv.default(true),
  MAX_MARKETS_PER_RUN: z.coerce.number().int().min(1).default(100),
  MAX_CANDIDATES_FOR_LIGHT_AI: z.coerce.number().int().min(1).default(15),
  MAX_CANDIDATES_FOR_MIROFISH: z.coerce.number().int().min(1).default(2),
  MIN_LIQUIDITY_USD: z.coerce.number().default(10000),
  MIN_DAYS_TO_RESOLUTION: z.coerce.number().default(7),
  MIN_ODDS: z.coerce.number().default(0.2),
  MAX_ODDS: z.coerce.number().default(0.8),
  MAX_SPREAD: z.coerce.number().default(0.03),
  MIN_EDGE: z.coerce.number().default(0.06),
  TRADE_SIZE_USD: z.coerce.number().default(10),
  MAX_DAILY_LOSS_USD: z.coerce.number().default(30),
  MAX_OPEN_POSITIONS: z.coerce.number().int().default(5),
  MAX_MARKET_EXPOSURE_USD: z.coerce.number().default(20),
  MAX_TOTAL_EXPOSURE_USD: z.coerce.number().default(100),
  MIROFISH_LIGHT_AGENTS: z.coerce.number().int().default(20),
  MIROFISH_LIGHT_ROUNDS: z.coerce.number().int().default(5),
  MIROFISH_DEEP_AGENTS: z.coerce.number().int().default(60),
  MIROFISH_DEEP_ROUNDS: z.coerce.number().int().default(12),
  RUN_DEEP_MIROFISH: boolEnv.default(false),
  MIROFISH_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120000),
  MIROFISH_ROUTE_PRIMARY: z.string().default("/predict"),
  MIROFISH_ROUTE_FALLBACK: z.string().default("/api/predict"),
  MIROFISH_WORKFLOW_MODE: boolEnv.default(true),
  MIROFISH_POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),
  MIROFISH_GRAPH_TIMEOUT_MS: z.coerce.number().int().min(5000).default(300000),
  MIROFISH_PREPARE_TIMEOUT_MS: z.coerce.number().int().min(5000).default(300000),
  MIROFISH_SIMULATION_TIMEOUT_MS: z.coerce.number().int().min(5000).default(600000),
  MIROFISH_REPORT_TIMEOUT_MS: z.coerce.number().int().min(5000).default(300000),
  MIROFISH_DEBUG_MAX_ROUNDS: z.coerce.number().int().min(1).default(3),
  CONCURRENCY: z.coerce.number().int().min(1).max(2).default(1),
  LOG_LEVEL: z.string().default("info"),
  SQLITE_PATH: z.string().default("./data/polymarket-bot.sqlite"),
  ENABLE_MIROFISH: boolEnv.default(false),
  TELEGRAM_VERBOSE: boolEnv.default(false),
  RESTART_MIROFISH_AFTER_RUN: boolEnv.default(false),
  MIROFISH_CONTAINER_NAME: z.string().default("mirofish"),
  ENABLE_NEWS_EVIDENCE: boolEnv.default(false),
  NEWS_MAX_ITEMS_PER_MARKET: z.coerce.number().int().min(1).default(5),
  NEWS_LOOKBACK_DAYS: z.coerce.number().int().min(1).default(14),
  NEWS_MIN_RELEVANCE_SCORE: z.coerce.number().int().min(1).default(2),
  NEWS_STRICT_MODE: boolEnv.default(true),
  NEWS_RSS_URLS: z.string().optional().default("")
});

export const config = envSchema.parse(process.env);
export type AppConfig = typeof config;
