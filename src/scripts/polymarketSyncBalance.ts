import { logger } from "../logger";
import { OpenClawClient } from "../services/openclawClient";

function summarizeAllowances(data: Record<string, string> | undefined): string {
  if (!data) return "{}";
  const entries = Object.entries(data);
  if (!entries.length) return "{}";
  const preview = entries.slice(0, 5).map(([key, value]) => `${key}:${value}`);
  const suffix = entries.length > 5 ? ` … (+${entries.length - 5} more)` : "";
  return `{ ${preview.join(", ")} }${suffix}`;
}

void (async () => {
  const client = new OpenClawClient();
  const { before, after } = await client.syncCollateralBalance();

  console.log("Polymarket balance allowance sync:");
  console.log(`before_balance=${before.balance}`);
  console.log(`before_allowances=${summarizeAllowances(before.allowances)}`);
  console.log(`after_balance=${after.balance}`);
  console.log(`after_allowances=${summarizeAllowances(after.allowances)}`);
})().catch((err) => {
  logger.error({ err }, "polymarket:sync-balance failed");
  process.exit(1);
});
