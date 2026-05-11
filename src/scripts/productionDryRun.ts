import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { closeDb, getDb, initDb } from "../db";
import { config } from "../config";
import { logger } from "../logger";
import { runPhase2Seed } from "../index";
import { runPhase3Mirofish } from "./runMirofish";
import { runPhase4Paper } from "./runPaper";
import { TelegramClient } from "../services/telegramClient";
import { PaperPortfolioSummary, PaperTradeRecord, SqliteStore } from "../services/sqliteStore";

interface DbCounts {
  markets: number;
  seed_packets: number;
  mirofish_results: number;
  calibrated_predictions: number;
  paper_trades: number;
  decisions: number;
  errors: number;
}

const COUNT_TABLES: Array<keyof DbCounts> = [
  "markets",
  "seed_packets",
  "mirofish_results",
  "calibrated_predictions",
  "paper_trades",
  "decisions",
  "errors"
];

async function fetchCounts(): Promise<DbCounts> {
  const db = await getDb();
  const counts: Partial<DbCounts> = {};
  for (const table of COUNT_TABLES) {
    const row = await db.get<{ count: number }>(`SELECT COUNT(*) as count FROM ${table}`);
    counts[table] = row?.count ?? 0;
  }
  return counts as DbCounts;
}

async function backupDatabase(): Promise<string | null> {
  const source = config.SQLITE_PATH;
  if (!source || !fs.existsSync(source)) return null;
  const dir = path.dirname(source);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(dir, `polymarket-bot-backup-${stamp}.sqlite`);
  await fs.promises.copyFile(source, target);
  return target;
}

function formatCounts(counts: DbCounts): string {
  return COUNT_TABLES.map((table) => `${table}: ${counts[table]}`).join(" | ");
}

void (async () => {
  process.env.DRY_RUN = "true";
  await initDb();
  const telegram = new TelegramClient();
  const store = new SqliteStore();
  const shouldBackup = process.argv.includes("--backup");
  let backupPath: string | null = null;
  let phase3Summary: Awaited<ReturnType<typeof runPhase3Mirofish>> | null = null;
  let phase4Summary: Awaited<ReturnType<typeof runPhase4Paper>> | null = null;
  const failure = async (phase: string, err: unknown) => {
    logger.error({ err }, `${phase} failed`);
    if (telegram.enabled) {
      await telegram.sendText(`Production dry-run FAILED during ${phase}: ${err instanceof Error ? err.message : err}`);
    }
    try {
      await closeDb();
    } catch (closeErr) {
      logger.warn({ closeErr }, "Failed to close DB after production dry-run failure");
    }
    process.exit(1);
  };

  try {
    logger.info("Starting Phase 2 seed");
    await runPhase2Seed({ suppressTelegram: true });
  } catch (err) {
    await failure("Phase 2 seed", err);
  }

  try {
    logger.info("Starting Phase 3 MiroFish");
    phase3Summary = await runPhase3Mirofish({ suppressTelegram: true });
  } catch (err) {
    await failure("Phase 3 MiroFish", err);
  }

  try {
    logger.info("Starting Phase 4 paper");
    phase4Summary = await runPhase4Paper({ suppressTelegram: true });
  } catch (err) {
    await failure("Phase 4 paper", err);
  }

  if (shouldBackup) {
    backupPath = await backupDatabase();
  }

  const counts = await fetchCounts();
  const portfolio = await store.getPaperPortfolioSummary();
  const openClawPlans = await store.countOpenClawPlans(phase4Summary?.runId);

  const summary = {
    seed: "ok",
    mirofish: phase3Summary,
    paper: phase4Summary,
    counts,
    portfolio,
    openClaw: { enabled: config.ENABLE_OPENCLAW, plans: openClawPlans },
    backup: backupPath ?? undefined
  };

  logger.info(summary, "Production dry-run summary");

  const portfolioLine = formatPortfolioLine(portfolio);
  const latestOpenLine = `Latest open positions: ${formatOpenPositions(portfolio.latestOpen)}`;
  const latestClosedLine = `Latest closed trades: ${formatClosedTrades(portfolio.latestClosed)}`;
  const openClawLine = formatOpenClawLine(openClawPlans);

  const summaryLines = [
    "Phase 5 Production Dry Run",
    `Seed: ok`,
    phase3Summary
      ? `MiroFish: success ${phase3Summary.successCount}/${phase3Summary.considered}, avg ${(phase3Summary.avgProbability * 100).toFixed(2)}%`
      : "MiroFish: (not run)",
    phase4Summary
      ? `Paper: simulated ${phase4Summary.simulated}/${phase4Summary.considered}, skipped ${phase4Summary.skipped} (dupes ${phase4Summary.duplicateOpenSkipped}, flips closed ${phase4Summary.closedOnSignalFlip})`
      : "Paper: (not run)",
    openClawLine,
    portfolioLine,
    latestOpenLine,
    latestClosedLine,
    `DB counts => ${formatCounts(counts)}`,
    backupPath ? `DB backup: ${backupPath}` : "DB backup: skipped",
  ];

  summaryLines.forEach((line) => console.log(line));

  if (telegram.enabled) {
    await telegram.sendText(summaryLines.join("\n"));
  }

  await restartMirofishIfNeeded();
  await closeDb();
})();

function formatPortfolioLine(portfolio: PaperPortfolioSummary): string {
  const totalPnl = portfolio.totalPnlUsd.toFixed(2);
  return `Portfolio: open ${portfolio.openCount}, closed ${portfolio.closedCount}, dupClosed ${portfolio.duplicateClosedCount}, totalPnL $${totalPnl}`;
}

function formatOpenPositions(trades: PaperTradeRecord[]): string {
  if (!trades.length) return "-";
  return trades
    .map((t) => {
      const prob = (t.probability * 100).toFixed(1);
      const price = (t.marketPrice * 100).toFixed(1);
      const edge = (t.edge * 100).toFixed(1);
      return `${t.marketId} ${t.side} prob=${prob}% price=${price}% edge=${edge}%`;
    })
    .join(" | ");
}

function formatClosedTrades(trades: PaperTradeRecord[]): string {
  if (!trades.length) return "-";
  return trades
    .map((t) => {
      const pnl = t.pnlUsd != null ? t.pnlUsd.toFixed(2) : "n/a";
      const closePrice = t.closePrice != null ? `${(t.closePrice * 100).toFixed(1)}%` : "n/a";
      const reason = t.closeReason ?? "n/a";
      return `${t.marketId} ${t.side} pnl=${pnl} close=${closePrice} reason=${reason}`;
    })
    .join(" | ");
}

function formatOpenClawLine(plans: number): string {
  if (!config.ENABLE_OPENCLAW) return "OpenClaw: disabled";
  return `OpenClaw: dry-run plans ${plans}, live orders 0`;
}

async function restartMirofishIfNeeded(): Promise<void> {
  if (!config.RESTART_MIROFISH_AFTER_RUN) return;
  const container = config.MIROFISH_CONTAINER_NAME?.trim();
  if (!container) {
    logger.warn("RESTART_MIROFISH_AFTER_RUN is true but MIROFISH_CONTAINER_NAME is empty");
    return;
  }
  logger.info({ container }, "Restarting MiroFish container after run");
  try {
    const result = await execFileAsync("docker", ["restart", container]);
    logger.info({ container, stdout: result.stdout?.trim() }, "MiroFish container restart completed");
  } catch (err) {
    logger.warn({ err, container }, "Failed to restart MiroFish container after run");
  }
}

function execFileAsync(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
    });
    child.on("error", (error) => reject(error));
  });
}
