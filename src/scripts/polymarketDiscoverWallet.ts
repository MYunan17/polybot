import { config } from "../config";
import { logger } from "../logger";
import { RelayClient, TransactionType } from "@polymarket/builder-relayer-client";
import { AssetType, Chain as ClobChain, ClobClient, SignatureTypeV2 } from "@polymarket/clob-client-v2";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, getAddress, http, type Chain as ViemChain } from "viem";
import { polygon, polygonAmoy } from "viem/chains";

interface ChainResolution {
  clob: ClobChain;
  viem: ViemChain;
  rpcUrl: string;
}

function normalizePrivateKey(raw?: string): `0x${string}` {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new Error("POLYMARKET_PRIVATE_KEY is required for polymarket:discover-wallet");
  }
  return trimmed.startsWith("0x") ? (trimmed as `0x${string}`) : (`0x${trimmed}` as `0x${string}`);
}

function normalizeAddress(raw?: string): `0x${string}` | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    return getAddress(trimmed);
  } catch {
    return undefined;
  }
}

function resolveChains(chainId: number): ChainResolution {
  if (chainId === ClobChain.POLYGON) {
    const rpc = config.POLYMARKET_RPC_URL?.trim() || polygon.rpcUrls.default.http[0] || "https://polygon-rpc.com";
    return { clob: ClobChain.POLYGON, viem: polygon, rpcUrl: rpc };
  }
  if (chainId === ClobChain.AMOY) {
    const rpc = config.POLYMARKET_RPC_URL?.trim() || polygonAmoy.rpcUrls.default.http[0] || "https://rpc-amoy.polygon.technology";
    return { clob: ClobChain.AMOY, viem: polygonAmoy, rpcUrl: rpc };
  }
  throw new Error(`Unsupported POLYMARKET_CHAIN_ID=${chainId}; only Polygon mainnet or Amoy testnet are supported`);
}

function shortAddress(value?: string): string {
  if (!value) return "n/a";
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function yesNo(value?: boolean): string {
  if (value === undefined) return "unknown";
  return value ? "yes" : "no";
}

function signatureTypeLabel(value: number): string {
  if (value === SignatureTypeV2.POLY_1271) return "POLY_1271";
  if (value === SignatureTypeV2.POLY_PROXY) return "POLY_PROXY";
  if (value === SignatureTypeV2.POLY_GNOSIS_SAFE) return "POLY_GNOSIS_SAFE";
  if (value === SignatureTypeV2.EOA) return "EOA";
  return `type_${value}`;
}

function resolveSignatureTypeEnum(value: number, funder?: `0x${string}`): SignatureTypeV2 | undefined {
  if (value === SignatureTypeV2.EOA) {
    return SignatureTypeV2.EOA;
  }
  if (value === SignatureTypeV2.POLY_PROXY || value === SignatureTypeV2.POLY_GNOSIS_SAFE || value === SignatureTypeV2.POLY_1271) {
    return funder ? (value as SignatureTypeV2) : undefined;
  }
  return undefined;
}

void (async () => {
  const privateKey = normalizePrivateKey(config.POLYMARKET_PRIVATE_KEY);
  const account = privateKeyToAccount(privateKey);
  const { clob, viem, rpcUrl } = resolveChains(config.POLYMARKET_CHAIN_ID);
  const walletClient = createWalletClient({ account, chain: viem, transport: http(rpcUrl) });
  const relayClient = new RelayClient(config.POLYMARKET_RELAYER_URL, config.POLYMARKET_CHAIN_ID, walletClient);

  const configuredFunder = normalizeAddress(config.POLYMARKET_FUNDER_ADDRESS);
  const signatureTypeValue = Number(config.POLYMARKET_SIGNATURE_TYPE ?? 0);
  const signatureLabel = signatureTypeLabel(signatureTypeValue);

  let derivedDepositWallet: string | undefined;
  try {
    derivedDepositWallet = await relayClient.deriveDepositWalletAddress();
  } catch (err) {
    logger.warn({ err }, "polymarket:discover-wallet unable to derive deposit wallet address");
  }

  let depositWalletDeployed: boolean | undefined;
  if (derivedDepositWallet) {
    try {
      depositWalletDeployed = await relayClient.getDeployed(derivedDepositWallet, TransactionType.WALLET);
    } catch (err) {
      logger.warn({ err }, "polymarket:discover-wallet unable to check deposit wallet deployment status");
    }
  }

  let walletNonce: string | undefined;
  try {
    const nonce = await relayClient.getNonce(account.address, TransactionType.WALLET);
    walletNonce = nonce.nonce;
  } catch (err) {
    logger.warn({ err }, "polymarket:discover-wallet unable to fetch wallet nonce");
  }

  let proxyNonce: string | undefined;
  try {
    const nonce = await relayClient.getNonce(account.address, TransactionType.PROXY);
    proxyNonce = nonce.nonce;
  } catch (err) {
    logger.debug({ err }, "polymarket:discover-wallet unable to fetch proxy nonce (this is expected for users without proxy wallets)");
  }

  let relayerPayloadAddress: string | undefined;
  try {
    const payload = await relayClient.getRelayPayload(account.address, TransactionType.WALLET);
    relayerPayloadAddress = payload.address;
  } catch (err) {
    logger.debug({ err }, "polymarket:discover-wallet unable to fetch relay payload");
  }

  let collateralBalance: string | undefined;
  const hasClobCreds = Boolean(
    config.OPENCLAW_API_KEY?.trim() && config.OPENCLAW_API_SECRET?.trim() && config.OPENCLAW_API_PASSPHRASE?.trim()
  );
  if (hasClobCreds) {
    try {
      const signatureEnum = resolveSignatureTypeEnum(signatureTypeValue, configuredFunder);
      if (!signatureEnum) {
        throw new Error("Signature type requires POLYMARKET_FUNDER_ADDRESS but none is configured");
      }
      const clobClient = new ClobClient({
        host: (config.POLYMARKET_CLOB_HOST ?? "https://clob.polymarket.com").trim(),
        chain: clob,
        signer: walletClient,
        creds: {
          key: config.OPENCLAW_API_KEY!.trim(),
          secret: config.OPENCLAW_API_SECRET!.trim(),
          passphrase: config.OPENCLAW_API_PASSPHRASE!.trim()
        },
        signatureType: signatureEnum,
        funderAddress: configuredFunder
      });
      const balanceResponse = await clobClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      collateralBalance = balanceResponse.balance;
    } catch (err) {
      logger.warn({ err }, "polymarket:discover-wallet unable to fetch collateral balance");
    }
  }

  const depositMatchesFunder = Boolean(
    derivedDepositWallet && configuredFunder && derivedDepositWallet.toLowerCase() === configuredFunder.toLowerCase()
  );

  const suggestions: string[] = [];
  if (derivedDepositWallet && depositWalletDeployed) {
    suggestions.push(
      `Recommended to use POLYMARKET_SIGNATURE_TYPE=3 (POLY_1271) with POLYMARKET_FUNDER_ADDRESS=${derivedDepositWallet}`
    );
  } else if (derivedDepositWallet && depositWalletDeployed === false) {
    suggestions.push("Deposit wallet exists deterministically but is not deployed; deploy it via the Polymarket relayer before trading.");
  } else {
    suggestions.push("Unable to derive deposit wallet; double-check POLYMARKET_PRIVATE_KEY and relayer connectivity.");
  }

  if (!configuredFunder && derivedDepositWallet) {
    suggestions.push("Set POLYMARKET_FUNDER_ADDRESS to the derived deposit wallet address for future runs.");
  }

  console.log("Polymarket wallet discovery:");
  console.log(`relayer_url=${config.POLYMARKET_RELAYER_URL}`);
  console.log(`signer_address=${account.address}`);
  console.log(`configured_funder=${configuredFunder ?? "n/a"}`);
  console.log(`signature_type=${signatureTypeValue} (${signatureLabel})`);
  console.log(`derived_deposit_wallet=${derivedDepositWallet ?? "n/a"}`);
  console.log(`deposit_wallet_deployed=${yesNo(depositWalletDeployed)}`);
  console.log(`deposit_matches_configured_funder=${yesNo(depositMatchesFunder)}`);
  console.log(`wallet_nonce=${walletNonce ?? "n/a"}`);
  console.log(`proxy_nonce=${proxyNonce ?? "n/a"}`);
  console.log(`relay_payload_address=${relayerPayloadAddress ?? "n/a"}`);
  console.log(`collateral_balance=${collateralBalance ?? (hasClobCreds ? "unavailable" : "skipped (missing API creds)")}`);

  suggestions.forEach((suggestion, index) => {
    console.log(`suggestion_${index + 1}=${suggestion}`);
  });
})().catch((err) => {
  logger.error({ err }, "polymarket:discover-wallet failed");
  process.exit(1);
});
