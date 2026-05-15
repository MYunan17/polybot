import { SignatureTypeV2 } from "@polymarket/clob-client-v2";
import { getAddress } from "viem";
import { config } from "../config";
import { logger } from "../logger";
import { OpenClawClient } from "../services/openclawClient";

interface CliOptions {
  forceRefresh: boolean;
}

function parseArgs(): CliOptions {
  return {
    forceRefresh: process.argv.includes("--force-refresh")
  };
}

function previewKey(value?: string): string {
  if (!value) return "n/a";
  if (value.length <= 10) return `${value} (len=${value.length})`;
  return `${value.slice(0, 4)}…${value.slice(-2)} (len=${value.length})`;
}

function shortAddress(value?: string): string {
  if (!value) return "n/a";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
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

void (async () => {
  const { forceRefresh } = parseArgs();
  const client = new OpenClawClient();
  const diagnostics = await client.getApiKeyOwnershipDiagnostics(forceRefresh);
  const ownership = diagnostics.ownership;
  const owner = ownership?.owner;
  const signer = diagnostics.signerAddress;
  const funder = diagnostics.funderAddress ?? normalizeAddress(config.POLYMARKET_FUNDER_ADDRESS);
  const signatureType = diagnostics.signatureType ?? SignatureTypeV2.EOA;
  const ownerMatchesFunder = Boolean(owner && funder && owner.toLowerCase() === funder.toLowerCase());
  const ownerMatchesSigner = Boolean(owner && signer && owner.toLowerCase() === signer.toLowerCase());
  const signatureTypeLabel = SignatureTypeV2[signatureType] ?? `type_${signatureType}`;

  const fieldsPreview = ownership?.fields ? JSON.stringify(ownership.fields) : "{}";

  console.log("Polymarket API key ownership diagnostics:");
  console.log(`signer_address=${shortAddress(signer)}`);
  console.log(`configured_funder=${shortAddress(funder)}`);
  console.log(`signature_type=${signatureType} (${signatureTypeLabel})`);
  console.log(`openclaw_api_key_preview=${previewKey(config.OPENCLAW_API_KEY)}`);
  console.log(`api_key_owner=${shortAddress(owner)}`);
  console.log(`api_key_owner_matches_funder=${ownerMatchesFunder}`);
  console.log(`api_key_owner_matches_signer=${ownerMatchesSigner}`);
  console.log(`ownership_fields=${fieldsPreview}`);

  if (signatureType === SignatureTypeV2.POLY_1271 && !ownerMatchesFunder) {
    console.log(
      "warning: deposit wallet orders require an API key owned by the deposit wallet; current key owner does not match configured funder"
    );
  }
})().catch((err) => {
  logger.error({ err }, "polymarket:api-key-owner failed");
  process.exit(1);
});
