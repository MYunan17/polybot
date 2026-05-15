import { getAddress } from "viem";

export interface ApiKeyOwnershipDetails {
  owner?: `0x${string}`;
  fields: Record<string, string>;
}

const INTERESTING_FIELD_SUBSTRINGS = ["owner", "address", "user", "maker", "funder", "wallet"];

function normalizeAddress(value?: unknown): `0x${string}` | undefined {
  if (!value || typeof value !== "string") return undefined;
  try {
    return getAddress(value);
  } catch {
    return undefined;
  }
}

function collectEntries(response: any): any[] {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  const candidates = [response.apiKeys, response.api_keys, response.keys, response.data, response.result];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

function matchesApiKey(entry: any, apiKey?: string): boolean {
  if (!apiKey || !entry || typeof entry !== "object") return false;
  const normalized = apiKey.toLowerCase();
  const candidates = [entry.apiKey, entry.api_key, entry.key, entry.id];
  return candidates.some((candidate) => typeof candidate === "string" && candidate.toLowerCase() === normalized);
}

function isInterestingKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return INTERESTING_FIELD_SUBSTRINGS.some((pattern) => normalized.includes(pattern));
}

function deriveOwnerFromFields(fields: Record<string, string>): `0x${string}` | undefined {
  const priorityPatterns = ["owner", "owner_address", "address", "maker", "user", "funder", "wallet"];
  for (const pattern of priorityPatterns) {
    const match = Object.entries(fields).find(([key]) => key.toLowerCase().includes(pattern));
    if (!match) continue;
    const candidate = normalizeAddress(match[1]);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

export function extractApiKeyOwnership(response: any, apiKey?: string): ApiKeyOwnershipDetails | undefined {
  const entries = collectEntries(response);
  if (!entries.length) return undefined;
  let entry = entries.find((item) => matchesApiKey(item, apiKey));
  if (!entry) {
    entry = entries[0];
  }
  if (!entry || typeof entry !== "object") return undefined;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!isInterestingKey(key)) continue;
    if (value == null) continue;
    if (typeof value === "object") continue;
    fields[key] = String(value);
  }
  const owner = deriveOwnerFromFields(fields);
  return { owner, fields };
}
