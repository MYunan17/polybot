import { RelayClient, TransactionType } from "@polymarket/builder-relayer-client";
import { AssetType, Chain as ClobChain, ClobClient, SignatureTypeV2 } from "@polymarket/clob-client-v2";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, getAddress, http, type Chain as ViemChain } from "viem";
import { polygon, polygonAmoy } from "viem/chains";
import { config } from "../config";
import { logger } from "../logger";

interface ChainResolution {
  clob: ClobChain;
  viem: ViemChain;
  rpcUrl: string;
}

function normalizePrivateKey(raw?: string): `0x${string}` {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new Error("POLYMARKET_PRIVATE_KEY is required for polymarket:relayer-whoami");
  }
  return trimmed.startsWith("0x") ? (trimmed as `0x${string}`) : (`0x${trimmed}` as `0x${string}`);
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
  throw new Error(`Unsupported POLYMARKET_CHAIN_ID=${chainId}`);
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

function yesNo(value?: boolean): string {
  if (value === undefined) return "unknown";
  return value ? "yes" : "no";
}

void (async () => {
  const privateKey = normalizePrivateKey(config.POLYMARKET_PRIVATE_KEY);
  const account = privateKeyToAccount(privateKey);
  const { clob, viem, rpcUrl } = resolveChains(config.POLYMARKET_CHAIN_ID);
  const walletClient = createWalletClient({ account, chain: viem, transport: http(rpcUrl) });
  const relayClient = new RelayClient(config.POLYMARKET_RELAYER_URL, config.POLYMARKET_CHAIN_ID, walletClient);

  const configuredFunder = normalizeAddress(config.POLYMARKET_FUNDER_ADDRESS);
  const relayerKeyAddress = normalizeAddress(config.POLYMARKET_RELAYER_API_KEY_ADDRESS);
  const relayerKeyPresent = Boolean(config.POLYMARKET_RELAYER_API_KEY?.trim());

  let derivedDepositWallet: string | undefined;
  try {
    derivedDepositWallet = await relayClient.deriveDepositWalletAddress();
  } catch (err) {
    logger.warn({ err }, "polymarket:relayer-whoami unable to derive deposit wallet");
  }

  let depositWalletDeployed: boolean | undefined;
  if (derivedDepositWallet) {
    try {
      depositWalletDeployed = await relayClient.getDeployed(derivedDepositWallet, TransactionType.WALLET);
    } catch (err) {
      logger.warn({ err }, "polymarket:relayer-whoami unable to check deposit wallet deployment status");
    }
  }

  const signatureTypeValue = Number(config.POLYMARKET_SIGNATURE_TYPE ?? 0);
  const hasClobCreds = Boolean(
    config.OPENCLAW_API_KEY?.trim() && config.OPENCLAW_API_SECRET?.trim() && config.OPENCLAW_API_PASSPHRASE?.trim()
  );
  let collateralBalance: string | undefined;
  if (hasClobCreds && configuredFunder) {
    try {
      const clobClient = new ClobClient({
        host: (config.POLYMARKET_CLOB_HOST ?? "https://clob.polymarket.com").trim(),
        chain: clob,
        signer: walletClient,
        creds: {
          key: config.OPENCLAW_API_KEY!.trim(),
          secret: config.OPENCLAW_API_SECRET!.trim(),
          passphrase: config.OPENCLAW_API_PASSPHRASE!.trim()
        },
        signatureType: signatureTypeValue as SignatureTypeV2,
        funderAddress: configuredFunder
      });
      const balanceResponse = await clobClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      collateralBalance = balanceResponse.balance;
    } catch (err) {
      logger.warn({ err }, "polymarket:relayer-whoami unable to fetch collateral balance");
    }
  }

  console.log("Polymarket relayer diagnostics:");
  console.log(`signer_address=${account.address}`);
  console.log(`relayer_api_key_present=${relayerKeyPresent ? "yes" : "no"}`);
  console.log(`relayer_api_key_address=${relayerKeyAddress ?? "n/a"}`);
  console.log(`derived_deposit_wallet=${derivedDepositWallet ?? "n/a"}`);
  console.log(`deposit_wallet_deployed=${yesNo(depositWalletDeployed)}`);
  console.log(
    `collateral_balance=${
      collateralBalance ?? (hasClobCreds ? "unavailable" : "skipped (missing OPENCLAW API credentials)")
    }`
  );
})().catch((err) => {
  logger.error({ err }, "polymarket:relayer-whoami failed");
  process.exit(1);
});
