import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Chain as ClobChain, ClobClient, SignatureTypeV2 } from "@polymarket/clob-client-v2";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, getAddress, http, type Chain as ViemChain } from "viem";
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

function normalizeAddress(raw?: string): `0x${string}` | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return getAddress(trimmed);
  } catch {
    throw new Error(`Invalid POLYMARKET_FUNDER_ADDRESS=${trimmed}`);
  }
}

function shortAddress(value?: string): string {
  if (!value) return "";
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function signatureTypeLabel(signatureType: number): string {
  if (signatureType === SignatureTypeV2.POLY_1271) return "POLY_1271";
  if (signatureType === SignatureTypeV2.POLY_PROXY) return "POLY_PROXY";
  if (signatureType === SignatureTypeV2.POLY_GNOSIS_SAFE) return "POLY_GNOSIS_SAFE";
  if (signatureType === SignatureTypeV2.EOA) return "EOA";
  return `type_${signatureType}`;
}

function resolveSignatureType(): { signatureType: SignatureTypeV2; funder?: `0x${string}` } {
  const typeValue = Number(config.POLYMARKET_SIGNATURE_TYPE ?? 0);
  if (typeValue === SignatureTypeV2.EOA) {
    return { signatureType: SignatureTypeV2.EOA };
  }
  if (typeValue === SignatureTypeV2.POLY_PROXY || typeValue === SignatureTypeV2.POLY_GNOSIS_SAFE || typeValue === SignatureTypeV2.POLY_1271) {
    const funder = normalizeAddress(config.POLYMARKET_FUNDER_ADDRESS);
    if (!funder) {
      throw new Error(`POLYMARKET_SIGNATURE_TYPE=${typeValue} requires POLYMARKET_FUNDER_ADDRESS`);
    }
    if (typeValue === SignatureTypeV2.POLY_PROXY) {
      return { signatureType: SignatureTypeV2.POLY_PROXY, funder };
    }
    if (typeValue === SignatureTypeV2.POLY_GNOSIS_SAFE) {
      return { signatureType: SignatureTypeV2.POLY_GNOSIS_SAFE, funder };
    }
    return { signatureType: SignatureTypeV2.POLY_1271, funder };
  }
  throw new Error(`Unsupported POLYMARKET_SIGNATURE_TYPE=${config.POLYMARKET_SIGNATURE_TYPE}`);
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
  const { signatureType, funder } = resolveSignatureType();

  const { clob, viem, rpcUrl } = resolveChains(config.POLYMARKET_CHAIN_ID);
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: viem, transport: http(rpcUrl) });

  const host = process.env.POLYMARKET_CLOB_HOST?.trim() || DEFAULT_CLOB_HOSTS[clob] || DEFAULT_CLOB_HOSTS[ClobChain.POLYGON];

  logger.info(
    {
      signer: shortAddress(account.address),
      funder: shortAddress(funder),
      signatureType
    },
    "Preparing Polymarket API key derivation"
  );

  const client = new ClobClient({
    host,
    chain: clob,
    signer: wallet,
    signatureType,
    funderAddress: funder
  });
  const creds = await client.createOrDeriveApiKey();
  let ownerHint: string | undefined;
  try {
    const response = await client.getApiKeys();
    const selfEntry = Array.isArray((response as any)?.apiKeys)
      ? (response as any).apiKeys.find((entry: any) => entry?.apiKey === creds.key)
      : undefined;
    ownerHint = selfEntry?.owner ?? selfEntry?.owner_address ?? selfEntry?.user ?? selfEntry?.address;
  } catch (err: any) {
    logger.warn({ message: err?.message }, "Unable to fetch API key owner after derivation");
  }

  const output = {
    OPENCLAW_API_KEY: creds.key,
    OPENCLAW_API_SECRET: creds.secret,
    OPENCLAW_API_PASSPHRASE: creds.passphrase
  };

  console.log(`signer_address=${shortAddress(account.address)}`);
  console.log(`funder_address=${shortAddress(funder) || "n/a"}`);
  console.log(`signature_type=${signatureType} (${signatureTypeLabel(signatureType)})`);
  Object.entries(output).forEach(([key, value]) => {
    console.log(`${key}=${value}`);
  });
  if (ownerHint) {
    console.log(`derived_api_key_owner=${ownerHint}`);
  }
  if (signatureType === SignatureTypeV2.POLY_1271 && ownerHint && funder && ownerHint.toLowerCase() !== funder.toLowerCase()) {
    console.log(
      "warning: SDK-derived API key appears to be owned by the signer EOA, not the deposit wallet; you may need to request a deposit-wallet-bound API key via the Polymarket UI or relayer support"
    );
  } else if (signatureType === SignatureTypeV2.POLY_1271 && !ownerHint) {
    console.log(
      "warning: unable to confirm API key ownership; deposit wallet orders require the API key to be owned by the deposit wallet"
    );
  }

  if (options.writeEnv) {
    await upsertEnvFile(output);
    logger.info({ env: ".env" }, "Updated .env with derived OpenClaw API credentials");
  }
})().catch((err) => {
  logger.error({ err }, "polymarket:derive-api-key failed");
  process.exit(1);
});
