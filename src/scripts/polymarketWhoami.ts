import { config } from "../config";
import { privateKeyToAccount } from "viem/accounts";

function normalizePrivateKey(raw?: string): `0x${string}` | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("0x") ? (trimmed as `0x${string}`) : (`0x${trimmed}` as `0x${string}`);
}

function shortValue(value?: string): string {
  if (!value) return "n/a";
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function yesNo(value?: string): string {
  return value?.trim() ? "yes" : "no";
}

function apiKeyPreview(key?: string): string {
  if (!key?.trim()) return "n/a";
  const trimmed = key.trim();
  const prefix = trimmed.slice(0, 6);
  return `${prefix}… (${trimmed.length} chars)`;
}

void (async () => {
  const normalizedPk = normalizePrivateKey(config.POLYMARKET_PRIVATE_KEY);
  let signerAddress = "missing";
  if (normalizedPk) {
    try {
      signerAddress = privateKeyToAccount(normalizedPk).address;
    } catch (err) {
      signerAddress = `invalid (${(err as Error)?.message ?? "unknown error"})`;
    }
  }

  const funderAddress = config.POLYMARKET_FUNDER_ADDRESS?.trim() || "";
  const signatureType = Number(config.POLYMARKET_SIGNATURE_TYPE ?? 0);
  const clobHost = (config.POLYMARKET_CLOB_HOST ?? "").trim() || "https://clob.polymarket.com";
  const chainId = config.POLYMARKET_CHAIN_ID;

  console.log("Polymarket identity overview:");
  console.log(`signer_address=${signerAddress}`);
  console.log(`funder_address=${shortValue(funderAddress)}`);
  console.log(`signature_type=${signatureType}`);
  console.log(`clob_host=${clobHost}`);
  console.log(`chain_id=${chainId}`);
  console.log(`openclaw_api_key_present=${yesNo(config.OPENCLAW_API_KEY)}`);
  console.log(`openclaw_api_secret_present=${yesNo(config.OPENCLAW_API_SECRET)}`);
  console.log(`openclaw_api_passphrase_present=${yesNo(config.OPENCLAW_API_PASSPHRASE)}`);
  console.log(`openclaw_api_key_preview=${apiKeyPreview(config.OPENCLAW_API_KEY)}`);
})();
