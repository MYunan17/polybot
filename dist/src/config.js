"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
const boolEnv = zod_1.z.preprocess((v) => {
    if (v === undefined || v === null || v === "")
        return undefined;
    if (typeof v === "boolean")
        return v;
    if (typeof v === "string")
        return ["1", "true", "yes", "on"].includes(v.toLowerCase());
    return false;
}, zod_1.z.boolean());
const envSchema = zod_1.z.object({
    DEEPSEEK_API_KEY: zod_1.z.string().optional().default(""),
    ZEP_API_KEY: zod_1.z.string().optional().default(""),
    ZEP_COLLECTION_NAME: zod_1.z.string().default("polymarket-agent-memory"),
    TELEGRAM_BOT_TOKEN: zod_1.z.string().optional().default(""),
    TELEGRAM_CHAT_ID: zod_1.z.string().optional().default(""),
    MIROFISH_URL: zod_1.z.string().url().default("http://localhost:5001"),
    POLYMARKET_PRIVATE_KEY: zod_1.z.string().optional().default(""),
    POLYMARKET_FUNDER_ADDRESS: zod_1.z.string().optional().default(""),
    POLYMARKET_PROXY_ADDRESS: zod_1.z.string().optional().default(""),
    POLYMARKET_CHAIN_ID: zod_1.z.coerce.number().default(137),
    OPENCLAW_URL: zod_1.z.string().url().default("http://localhost:3000"),
    OPENCLAW_API_KEY: zod_1.z.string().optional().default(""),
    DRY_RUN: boolEnv.default(true),
    MAX_MARKETS_PER_RUN: zod_1.z.coerce.number().int().min(1).default(100),
    MAX_CANDIDATES_FOR_LIGHT_AI: zod_1.z.coerce.number().int().min(1).default(15),
    MAX_CANDIDATES_FOR_MIROFISH: zod_1.z.coerce.number().int().min(1).default(2),
    MIN_LIQUIDITY_USD: zod_1.z.coerce.number().default(10000),
    MIN_DAYS_TO_RESOLUTION: zod_1.z.coerce.number().default(7),
    MIN_ODDS: zod_1.z.coerce.number().default(0.2),
    MAX_ODDS: zod_1.z.coerce.number().default(0.8),
    MAX_SPREAD: zod_1.z.coerce.number().default(0.03),
    MIN_EDGE: zod_1.z.coerce.number().default(0.06),
    TRADE_SIZE_USD: zod_1.z.coerce.number().default(10),
    MAX_DAILY_LOSS_USD: zod_1.z.coerce.number().default(30),
    MAX_OPEN_POSITIONS: zod_1.z.coerce.number().int().default(5),
    MAX_MARKET_EXPOSURE_USD: zod_1.z.coerce.number().default(20),
    MAX_TOTAL_EXPOSURE_USD: zod_1.z.coerce.number().default(100),
    MIROFISH_LIGHT_AGENTS: zod_1.z.coerce.number().int().default(20),
    MIROFISH_LIGHT_ROUNDS: zod_1.z.coerce.number().int().default(5),
    MIROFISH_DEEP_AGENTS: zod_1.z.coerce.number().int().default(60),
    MIROFISH_DEEP_ROUNDS: zod_1.z.coerce.number().int().default(12),
    RUN_DEEP_MIROFISH: boolEnv.default(false),
    MIROFISH_REQUEST_TIMEOUT_MS: zod_1.z.coerce.number().int().min(1000).default(120000),
    MIROFISH_ROUTE_PRIMARY: zod_1.z.string().default("/predict"),
    MIROFISH_ROUTE_FALLBACK: zod_1.z.string().default("/api/predict"),
    CONCURRENCY: zod_1.z.coerce.number().int().min(1).max(2).default(1),
    LOG_LEVEL: zod_1.z.string().default("info"),
    SQLITE_PATH: zod_1.z.string().default("./data/polymarket-bot.sqlite"),
    ENABLE_MIROFISH: boolEnv.default(false),
    TELEGRAM_VERBOSE: boolEnv.default(false)
});
exports.config = envSchema.parse(process.env);
