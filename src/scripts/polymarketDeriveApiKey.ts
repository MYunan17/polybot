import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Chain as ClobChain, ClobClient, SignatureTypeV2 } from "@polymarket/clob-client-v2";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, type Chain as ViemChain } from "viem";
import { polygon, polygonAmoy } from "viem/chains";
import { config } from "../config";
import { logger } from "../logger";

const DEFAULT_CLOB_HOSTS: Record<number, string> = {
  [ClobChain.POLYGON]: "https://clob.polymarket.com",
  [ClobChain.AMOY]: "https://clob-amoy.polymarket.com"
};

interface CliOptions {
  writeEnv: boolean;
}

function parseArgs(): CliOptions {
  const writeEnv = process.argv.includes("--write-env");
  return { writeEnv };
}

function normalizePrivateKey(raw?: string): `0x${string}` {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new Error("POLYMARKET_PRIVATE_KEY is required");
  }
  return trimmed.startsWith("0x") ? (trimmed as `0x${string}`) : (`0x${trimmed}` as `0x${string}`);
}

function resolveChains(chainId: number): { clob: ClobChain; viem: ViemChain; rpcUrl: string } {
  if (chainId === ClobChain.POLYGON) {
    const rpc = process.env.POLYMARKET_RPC_URL?.trim() || polygon.rpcUrls.default.http[0] || "https://polygon-rpc.com";
    return { clob: ClobChain.POLYGON, viem: polygon, rpcUrl: rpc };
  }
  if (chainId === ClobChain.AMOY) {
    const rpc = process.env.POLYMARKET_RPC_URL?.trim() || polygonAmoy.rpcUrls.default.http[0] || "https://rpc-amoy.polygon.technology";
    return { clob: ClobChain.AMOY, viem: polygonAmoy, rpcUrl: rpc };
  }
  throw new Error(`Unsupported POLYMARKET_CHAIN_ID=${chainId}; only Polygon mainnet or Amoy testnet are supported`);
}

async function upsertEnvFile(values: Record<string, string>): Promise<void> {
  const envPath = path.resolve(process.cwd(), ".env");
  let existing = "";
  try {
    existing = await fs.readFile(envPath, "utf8");
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
  const lines = existing ? existing.split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(values)) {
    const idx = lines.findIndex((line) => line.startsWith(`${key}=`));
    const serialized = `${key}=${value}`;
    if (idx >= 0) {
      lines[idx] = serialized;
    } else {
      lines.push(serialized);
    }
  }
  const normalized = lines.filter((line, idx) => line.length > 0 || idx < lines.length - 1);
  await fs.writeFile(envPath, normalized.join("\n") + "\n", "utf8");
}

void (async () => {
  const options = parseArgs();
  const privateKey = normalizePrivateKey(config.POLYMARKET_PRIVATE_KEY);
  if (config.POLYMARKET_SIGNATURE_TYPE !== SignatureTypeV2.EOA) {
    throw new Error("Only SignatureType=0 (EOA) is supported for automatic API key derivation");
  }

  const { clob, viem, rpcUrl } = resolveChains(config.POLYMARKET_CHAIN_ID);
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: viem, transport: http(rpcUrl) });

  const host = process.env.POLYMARKET_CLOB_HOST?.trim() || DEFAULT_CLOB_HOSTS[clob] || DEFAULT_CLOB_HOSTS[ClobChain.POLYGON];
  const funder = config.POLYMARKET_FUNDER_ADDRESS?.trim() || undefined;

  const client = new ClobClient({
    host,
    chain: clob,
    signer: wallet,
    signatureType: SignatureTypeV2.EOA,
    funderAddress: funder
  });
  const creds = await client.createOrDeriveApiKey();

  const output = {
    OPENCLAW_API_KEY: creds.key,
    OPENCLAW_API_SECRET: creds.secret,
    OPENCLAW_API_PASSPHRASE: creds.passphrase
  };

  Object.entries(output).forEach(([key, value]) => {
    console.log(`${key}=${value}`);
  });

  if (options.writeEnv) {
    await upsertEnvFile(output);
    logger.info({ env: ".env" }, "Updated .env with derived OpenClaw API credentials");
  }
})().catch((err) => {
  logger.error({ err }, "polymarket:derive-api-key failed");
  process.exit(1);
});
