import {
  Chain as ClobChain,
  ClobClient,
  Side as ClobSide,
  OrderType,
  SignatureTypeV2,
  isV2Order,
  orderToJsonV2,
  type CreateOrderOptions,
  type SignedOrder,
  type UserOrderV2
} from "@polymarket/clob-client-v2";
import { createWalletClient, http, type Chain } from "viem";
import { polygon, polygonAmoy } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import { logger } from "../logger";

interface CliOptions {
  tokenId: string;
  price: number;
  sizeUsd: number;
  live: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const getValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx === -1 || idx + 1 >= args.length) {
      return undefined;
    }
    return args[idx + 1];
  };

  const tokenId = getValue("--token-id");
  const priceRaw = getValue("--price");
  const sizeUsdRaw = getValue("--size-usd");
  const live = args.includes("--live");

  if (!tokenId) {
    throw new Error("Missing --token-id <tokenId>");
  }
  if (!priceRaw) {
    throw new Error("Missing --price <price>");
  }
  if (!sizeUsdRaw) {
    throw new Error("Missing --size-usd <usd>");
  }

  const price = Number(priceRaw);
  if (!Number.isFinite(price) || price <= 0 || price >= 1) {
    throw new Error("--price must be between 0 and 1 (fractional odds)");
  }

  const sizeUsd = Number(sizeUsdRaw);
  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
    throw new Error("--size-usd must be positive");
  }

  return { tokenId, price, sizeUsd, live };
}

function normalizePrivateKey(raw?: string): `0x${string}` {
  const trimmed = raw?.trim();
  if (!trimmed) throw new Error("POLYMARKET_PRIVATE_KEY not configured");
  return trimmed.startsWith("0x") ? (trimmed as `0x${string}`) : (`0x${trimmed}` as `0x${string}`);
}

function normalizeAddress(raw?: string): `0x${string}` {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new Error("POLYMARKET_FUNDER_ADDRESS is required for deposit wallets");
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    throw new Error(`Invalid POLYMARKET_FUNDER_ADDRESS=${trimmed}`);
  }
  return trimmed as `0x${string}`;
}

function resolveChain(): { clobChain: ClobChain; viemChain: Chain; defaultRpc: string } {
  const chainId = Number(config.POLYMARKET_CHAIN_ID ?? 137);
  if (chainId === ClobChain.POLYGON) {
    return {
      clobChain: ClobChain.POLYGON,
      viemChain: polygon,
      defaultRpc: polygon.rpcUrls.default.http[0] ?? "https://polygon-rpc.com"
    };
  }
  if (chainId === ClobChain.AMOY) {
    return {
      clobChain: ClobChain.AMOY,
      viemChain: polygonAmoy,
      defaultRpc: polygonAmoy.rpcUrls.default.http[0] ?? "https://rpc-amoy.polygon.technology"
    };
  }
  throw new Error(`Unsupported POLYMARKET_CHAIN_ID=${chainId}`);
}

function requireApiCreds(): { key: string; secret: string; passphrase: string } {
  const key = config.OPENCLAW_API_KEY?.trim();
  const secret = config.OPENCLAW_API_SECRET?.trim();
  const passphrase = config.OPENCLAW_API_PASSPHRASE?.trim();
  if (!key || !secret || !passphrase) {
    throw new Error("OPENCLAW_API_KEY/SECRET/PASSPHRASE must be configured for CLOB L2 headers");
  }
  return { key, secret, passphrase };
}

function ensureDepositSignatureType(): SignatureTypeV2 {
  if (config.POLYMARKET_SIGNATURE_TYPE !== SignatureTypeV2.POLY_1271) {
    throw new Error("POLYMARKET_SIGNATURE_TYPE must be 3 (POLY_1271) for deposit wallets");
  }
  return SignatureTypeV2.POLY_1271;
}

function buildClobClient() {
  const host = (config.POLYMARKET_CLOB_HOST ?? "https://clob.polymarket.com").trim();
  const { clobChain, viemChain, defaultRpc } = resolveChain();
  const privateKey = normalizePrivateKey(config.POLYMARKET_PRIVATE_KEY);
  const account = privateKeyToAccount(privateKey);
  const rpcUrl = config.POLYMARKET_RPC_URL?.trim() || defaultRpc;
  const wallet = createWalletClient({ account, chain: viemChain, transport: http(rpcUrl) });
  const creds = requireApiCreds();
  const funderAddress = normalizeAddress(config.POLYMARKET_FUNDER_ADDRESS);
  const signatureType = ensureDepositSignatureType();
  const client = new ClobClient({
    host,
    chain: clobChain,
    signer: wallet,
    creds,
    signatureType,
    funderAddress
  });
  return { client, signerAddress: account.address, funderAddress, signatureType };
}

function sizeTokensFromUsd(sizeUsd: number, price: number): number {
  const tokens = Number((sizeUsd / price).toFixed(6));
  if (!Number.isFinite(tokens) || tokens <= 0) {
    throw new Error("Unable to derive token size from USD/price");
  }
  return tokens;
}

function secretPreview(value?: string | null): string {
  if (!value) return "n/a";
  if (value.length <= 10) return `${value} (len=${value.length})`;
  return `${value.slice(0, 10)}… (len=${value.length})`;
}

function apiKeyPreview(value?: string | null): string {
  if (!value) return "n/a";
  return `${value.slice(0, 4)}… (len=${value.length})`;
}

function sanitizeResponse(value: any, depth = 0): any {
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeResponse(item, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (["apiKey", "key", "secret", "signature", "passphrase"].includes(key.toLowerCase())) {
      result[key] = "[redacted]";
      continue;
    }
    if (typeof val === "object" && val !== null && depth < 2) {
      result[key] = sanitizeResponse(val, depth + 1);
    } else {
      result[key] = val;
    }
  }
  return result;
}

void (async () => {
  const options = parseArgs();
  const owner = config.OPENCLAW_API_KEY?.trim();
  if (!owner) {
    throw new Error("OPENCLAW_API_KEY is required to set order owner");
  }

  const { client, signerAddress, funderAddress, signatureType } = buildClobClient();
  const sizeTokens = sizeTokensFromUsd(options.sizeUsd, options.price);
  const userOrder: UserOrderV2 = {
    tokenID: options.tokenId,
    price: options.price,
    size: sizeTokens,
    side: ClobSide.BUY
  };
  const orderOptions: Partial<CreateOrderOptions> = { tickSize: "0.01", negRisk: false };

  const signedOrder = (await client.createOrder(userOrder, orderOptions)) as SignedOrder;
  if (!signedOrder || typeof signedOrder !== "object") {
    throw new Error("createOrder did not return a signed order");
  }
  if (!isV2Order(signedOrder)) {
    throw new Error("Deposit wallets require V2 signed orders; got legacy payload");
  }
  const payload = orderToJsonV2(signedOrder, owner, OrderType.GTC, false, false); // ensure owner path matches docs
  const signaturePreview = secretPreview((signedOrder as any).signature ?? "");
  const ownerPreview = apiKeyPreview(payload.owner);

  console.log("Polymarket minimal CLOB dry-run diagnostics:");
  console.log(`signer_address=${signerAddress}`);
  console.log(`funder_address=${funderAddress}`);
  console.log(`api_key_preview=${ownerPreview}`);
  console.log(`tokenId=${userOrder.tokenID}`);
  console.log(`price=${userOrder.price}`);
  console.log(`size_tokens=${userOrder.size}`);
  console.log(`maker=${signedOrder.maker}`);
  console.log(`signer=${signedOrder.signer}`);
  console.log(`signatureType=${signatureType}`);
  console.log(`signature_preview=${signaturePreview}`);
  console.log(`owner_preview=${ownerPreview}`);
  console.log(
    "README=If this minimal script fails with invalid signature, the issue is outside OpenClaw and should be sent to Polymarket with the sanitized diagnostics."
  );

  if (!options.live) {
    return;
  }

  if (config.OPENCLAW_KILL_SWITCH) {
    throw new Error("OPENCLAW_KILL_SWITCH must be false to enable --live submissions");
  }
  if (process.env.MINIMAL_LIVE_CONFIRM !== "YES") {
    throw new Error("Set MINIMAL_LIVE_CONFIRM=YES to authorize --live order submission");
  }

  try {
    const response = await client.createAndPostOrder(userOrder, orderOptions, OrderType.GTC);
    console.log("Polymarket minimal CLOB live submission result:");
    console.log(JSON.stringify(sanitizeResponse(response)));
  } catch (err: any) {
    const sanitized = sanitizeResponse(err?.response?.data ?? err?.data ?? { message: err?.message ?? "unknown" });
    console.log("Polymarket minimal CLOB live submission error:");
    console.log(JSON.stringify(sanitized));
    throw err;
  }
})()
  .catch((err) => {
    logger.error({ err }, "polymarket:minimal-clob-order failed");
    process.exitCode = 1;
  });
