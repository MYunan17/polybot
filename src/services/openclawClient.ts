import { createHash } from "crypto";
import axios from "axios";
import {
  AssetType,
  Chain as ClobChain,
  ClobClient,
  OrderType,
  Side as ClobSide,
  SignatureTypeV2,
  isV2Order,
  orderToJsonV2,
  createL2Headers,
  type ApiKeyCreds,
  type BalanceAllowanceResponse,
  type CreateOrderOptions,
  type NewOrderV2,
  type OpenOrder,
  type SignedOrder,
  type Trade,
  type UserOrderV2
} from "@polymarket/clob-client-v2";
import { createWalletClient, getAddress, http, type Chain } from "viem";
import { polygon, polygonAmoy } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import { ExecutionRequest, ExecutionResult } from "../types";
import { logger } from "../logger";
import { extractApiKeyOwnership, type ApiKeyOwnershipDetails } from "./apiKeyOwnership";

const POST_ORDER_PATH = "/order";

export class OpenClawClient {
  private clob?: ClobClient;
  private clobSigner?: ReturnType<typeof createWalletClient>;
  private clobCreds?: ApiKeyCreds;
  private clobHost?: string;
  private signerAddress?: `0x${string}`;
  private signatureType?: SignatureTypeV2;
  private funderAddress?: `0x${string}`;
  private apiKeyOwnership?: ApiKeyOwnershipDetails;

  async healthCheck(): Promise<boolean> {
    try {
      await axios.get(`${config.OPENCLAW_URL}/health`, {
        headers: this.headers(),
        timeout: 6000
      });
      return true;
    } catch {
      return false;
    }
  }

  private async assertApiKeyOwnershipMatches(): Promise<void> {
    await this.ensureClobClient();
    if (this.signatureType !== SignatureTypeV2.POLY_1271) {
      return;
    }
    const funder = this.funderAddress;
    if (!funder) {
      return;
    }
    const ownership = await this.ensureApiKeyOwnershipDetails();
    if (!ownership?.owner) {
      logger.warn("Unable to determine API key owner; skipping ownership validation");
      return;
    }
    if (ownership.owner.toLowerCase() !== funder.toLowerCase()) {
      const fieldsPreview = this.ownershipFieldsPreview(ownership.fields);
      throw new Error(
        `OPENCLAW_API_KEY owner ${ownership.owner} does not match POLYMARKET_FUNDER_ADDRESS ${funder}. Fields=${fieldsPreview}`
      );
    }
  }

  private ownershipFieldsPreview(fields: Record<string, string>): string {
    const entries = Object.entries(fields)
      .slice(0, 6)
      .map(([key, value]) => `${key}=${value}`);
    return entries.join(", ") || "n/a";
  }

  private async ensureApiKeyOwnershipDetails(forceRefresh = false): Promise<ApiKeyOwnershipDetails | undefined> {
    if (!forceRefresh && this.apiKeyOwnership) {
      return this.apiKeyOwnership;
    }
    const details = await this.fetchApiKeyOwnershipDetails();
    if (details) {
      this.apiKeyOwnership = details;
    }
    return details;
  }

  private async fetchApiKeyOwnershipDetails(): Promise<ApiKeyOwnershipDetails | undefined> {
    try {
      const client = await this.ensureClobClient();
      const response = await client.getApiKeys();
      return extractApiKeyOwnership(response, this.clobCreds?.key);
    } catch (err: any) {
      logger.warn({ message: err?.message }, "Failed to fetch API key ownership details");
      return undefined;
    }
  }

  async getCapabilities(): Promise<unknown> {
    // TODO: adjust if endpoint differs.
    const res = await axios.get(`${config.OPENCLAW_URL}/capabilities`, { headers: this.headers(), timeout: 6000 });
    return res.data;
  }

  async placeLimitOrder(request: ExecutionRequest): Promise<ExecutionResult> {
    try {
      await this.assertApiKeyOwnershipMatches();
      const { payload, payloadJson, payloadHash } = await this.buildVersionedPostPayload(request);
      const response = await this.submitVersionedPayload(payload, payloadJson);
      const orderId = this.extractOrderId(response);
      logger.debug({ livePayloadSha256: payloadHash }, "Polymarket CLOB live payload hash");
      logger.debug({ orderKeys: this.safeKeys(response), dataKeys: this.safeKeys(response?.data) }, "Polymarket CLOB order response keys");
      const responsePreview = this.safeResponsePreview(response);
      if (orderId) {
        return {
          status: "submitted",
          orderId,
          message: `Polymarket CLOB order submitted at ${(request.limitPrice * 100).toFixed(2)}%`,
          raw: this.sanitizedResponse(response)
        };
      }
      const statusFlag = this.extractStatusFlag(response);
      if (statusFlag === "accepted" || statusFlag === "open" || statusFlag === true) {
        return {
          status: "submitted",
          orderId,
          message: `Polymarket CLOB order accepted (pending id) at ${(request.limitPrice * 100).toFixed(2)}%`,
          raw: this.sanitizedResponse(response)
        };
      }
      return {
        status: "rejected",
        orderId: undefined,
        message: `Polymarket CLOB response missing order id; response_preview=${responsePreview}`,
        raw: this.sanitizedResponse(response)
      };
    } catch (err: any) {
      const { message, raw } = this.describeClobError(err);
      return { status: "failed", message, raw };
    }
  }

  async getPositions(): Promise<unknown[]> {
    const res = await axios.get(`${config.OPENCLAW_URL}/positions`, { headers: this.headers(), timeout: 8000 });
    return Array.isArray(res.data) ? res.data : [];
  }

  async buildLimitOrder(
    request: ExecutionRequest
  ): Promise<{
    tokenID: string;
    price: number;
    sizeTokens: number;
    side: ClobSide;
    orderType: OrderType;
    tickSize: string;
    negRisk: boolean;
    orderHash?: string;
  }> {
    const client = await this.ensureClobClient();
    const { userOrder, sizeTokens } = this.prepareUserOrder(request);
    const options = this.orderOptions();
    const signed = await client.createOrder(userOrder, options);
    const orderHash = this.extractOrderId(signed);
    return {
      tokenID: userOrder.tokenID,
      price: userOrder.price,
      sizeTokens,
      side: userOrder.side,
      orderType: OrderType.GTC,
      tickSize: String(options.tickSize ?? ""),
      negRisk: Boolean(options.negRisk),
      orderHash
    };
  }

  async buildSignedOrderPreview(request: ExecutionRequest): Promise<{
    signedOrder: SignedOrder;
    userOrder: UserOrderV2;
    sizeTokens: number;
  }> {
    const client = await this.ensureClobClient();
    const { userOrder, sizeTokens } = this.prepareUserOrder(request);
    const options = this.orderOptions();
    const signedOrder = await client.createOrder(userOrder, options);
    if (!isV2Order(signedOrder)) {
      throw new Error("Polymarket deposit wallets require V2 order payloads");
    }
    return { signedOrder, userOrder, sizeTokens };
  }

  async buildVersionedPostPayload(request: ExecutionRequest): Promise<{
    payload: NewOrderV2<OrderType>;
    signedOrder: SignedOrder;
    sizeTokens: number;
    payloadJson: string;
    payloadHash: string;
  }> {
    const client = await this.ensureClobClient();
    const { userOrder, sizeTokens } = this.prepareUserOrder(request);
    const options = this.orderOptions();
    const signedOrder = await client.createOrder(userOrder, options);
    if (!isV2Order(signedOrder)) {
      throw new Error("Polymarket deposit wallets require V2 order payloads");
    }
    const owner = this.resolveOrderOwner();
    const payload = orderToJsonV2(signedOrder, owner, OrderType.GTC, false, false);
    const payloadJson = JSON.stringify(payload);
    const payloadHash = this.hashPayload(payloadJson);
    return { payload, signedOrder, sizeTokens, payloadJson, payloadHash };
  }

  async listOpenOrders(limit = 20): Promise<OpenOrder[]> {
    const client = await this.ensureClobClient();
    const orders = await client.getOpenOrders(undefined, true);
    if (!Array.isArray(orders)) return [];
    return orders.slice(0, limit);
  }

  async getOpenOrderById(orderId: string): Promise<OpenOrder | undefined> {
    if (!orderId) return undefined;
    const client = await this.ensureClobClient();
    const orders = await client.getOpenOrders({ id: orderId }, true);
    if (!Array.isArray(orders) || !orders.length) return undefined;
    return orders[0];
  }

  async listRecentTrades(limit = 20): Promise<Trade[]> {
    const client = await this.ensureClobClient();
    const trades = await client.getTrades(undefined, true);
    if (!Array.isArray(trades)) return [];
    return trades.slice(0, limit);
  }

  async syncCollateralBalance(): Promise<{ before: BalanceAllowanceResponse; after: BalanceAllowanceResponse }> {
    const client = await this.ensureClobClient();
    const params = { asset_type: AssetType.COLLATERAL } as const;
    const before = await client.getBalanceAllowance(params);
    await client.updateBalanceAllowance(params);
    const after = await client.getBalanceAllowance(params);
    return { before, after };
  }

  async getApiKeyOwnershipDiagnostics(forceRefresh = false): Promise<{
    signerAddress?: `0x${string}`;
    funderAddress?: `0x${string}`;
    signatureType?: SignatureTypeV2;
    ownership?: ApiKeyOwnershipDetails;
  }> {
    await this.ensureClobClient();
    const ownership = await this.ensureApiKeyOwnershipDetails(forceRefresh);
    return {
      signerAddress: this.signerAddress,
      funderAddress: this.funderAddress,
      signatureType: this.signatureType,
      ownership
    };
  }

  private headers(): Record<string, string> {
    return config.OPENCLAW_API_KEY ? { "x-api-key": config.OPENCLAW_API_KEY } : {};
  }

  private async ensureClobClient(): Promise<ClobClient> {
    if (this.clob) return this.clob;
    const host = (config.POLYMARKET_CLOB_HOST ?? "").trim() || "https://clob.polymarket.com";
    const account = privateKeyToAccount(this.normalizePrivateKey(config.POLYMARKET_PRIVATE_KEY));
    const { clobChain, viemChain, defaultRpc } = this.resolveChain(config.POLYMARKET_CHAIN_ID);
    const rpcUrl = config.POLYMARKET_RPC_URL?.trim() || defaultRpc;
    const wallet = createWalletClient({ account, chain: viemChain, transport: http(rpcUrl) });
    const creds = this.resolveApiCreds();
    const funder = this.normalizeAddress(config.POLYMARKET_FUNDER_ADDRESS);
    const signatureType = this.resolveSignatureType(funder);
    this.clob = new ClobClient({
      host,
      chain: clobChain,
      signer: wallet,
      creds,
      signatureType,
      funderAddress: funder
    });
    this.clobSigner = wallet;
    this.clobCreds = creds;
    this.clobHost = host;
    this.signerAddress = account.address;
    this.signatureType = signatureType;
    this.funderAddress = funder;
    this.apiKeyOwnership = undefined;
    return this.clob;
  }

  private prepareUserOrder(request: ExecutionRequest): { userOrder: UserOrderV2; sizeTokens: number } {
    const price = Number(request.limitPrice);
    if (!(price > 0 && price < 1)) {
      throw new Error("Invalid limit price for CLOB order");
    }
    const sizeUsd = Number(request.sizeUsd);
    if (!(sizeUsd > 0)) {
      throw new Error("Invalid size for CLOB order");
    }
    const sizeTokens = Number((sizeUsd / price).toFixed(6));
    if (!Number.isFinite(sizeTokens) || sizeTokens <= 0) {
      throw new Error("Derived token size invalid");
    }
    const userOrder: UserOrderV2 = {
      tokenID: request.tokenId,
      price,
      size: sizeTokens,
      side: ClobSide.BUY
    };
    return { userOrder, sizeTokens };
  }

  private orderOptions(): Partial<CreateOrderOptions> {
    return {
      tickSize: "0.01",
      negRisk: false
    };
  }

  private resolveApiCreds(): ApiKeyCreds {
    const key = config.OPENCLAW_API_KEY?.trim();
    const secret = config.OPENCLAW_API_SECRET?.trim();
    const passphrase = config.OPENCLAW_API_PASSPHRASE?.trim();
    if (!key || !secret || !passphrase) {
      throw new Error("OPENCLAW API credentials are incomplete");
    }
    return { key, secret, passphrase };
  }

  private resolveOrderOwner(): string {
    const funder = this.normalizeAddress(config.POLYMARKET_FUNDER_ADDRESS);
    if (!funder) {
      throw new Error("POLYMARKET_FUNDER_ADDRESS is required for deposit wallet orders");
    }
    return funder;
  }

  private hashPayload(serialized: string): string {
    return createHash("sha256").update(serialized).digest("hex");
  }

  private async submitVersionedPayload(payload: NewOrderV2<OrderType>, payloadJson: string): Promise<any> {
    await this.ensureClobClient();
    if (!this.clobSigner || !this.clobCreds || !this.clobHost) {
      throw new Error("Clob client is not fully initialized");
    }
    const l2HeaderArgs = {
      method: "POST",
      requestPath: POST_ORDER_PATH,
      body: payloadJson
    } as const;
    const headers = await createL2Headers(this.clobSigner, this.clobCreds, l2HeaderArgs);
    const response = await axios.post(`${this.clobHost}${POST_ORDER_PATH}`, payload, {
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      timeout: 8000
    });
    return response?.data ?? response;
  }

  private resolveSignatureType(funder?: `0x${string}`): SignatureTypeV2 {
    const typeValue = Number(config.POLYMARKET_SIGNATURE_TYPE ?? 0);
    if (typeValue === SignatureTypeV2.EOA) {
      return SignatureTypeV2.EOA;
    }
    if (typeValue === SignatureTypeV2.POLY_PROXY) {
      if (!funder) {
        throw new Error("POLYMARKET_SIGNATURE_TYPE=1 (POLY_PROXY) requires POLYMARKET_FUNDER_ADDRESS");
      }
      return SignatureTypeV2.POLY_PROXY;
    }
    if (typeValue === SignatureTypeV2.POLY_GNOSIS_SAFE) {
      if (!funder) {
        throw new Error("POLYMARKET_SIGNATURE_TYPE=2 (POLY_GNOSIS_SAFE) requires POLYMARKET_FUNDER_ADDRESS");
      }
      return SignatureTypeV2.POLY_GNOSIS_SAFE;
    }
    if (typeValue === SignatureTypeV2.POLY_1271) {
      if (!funder) {
        throw new Error("POLYMARKET_SIGNATURE_TYPE=3 (POLY_1271) requires POLYMARKET_FUNDER_ADDRESS (deposit wallet)");
      }
      return SignatureTypeV2.POLY_1271;
    }
    throw new Error(`Unsupported POLYMARKET_SIGNATURE_TYPE=${config.POLYMARKET_SIGNATURE_TYPE}`);
  }

  private resolveChain(chainId: number): { clobChain: ClobChain; viemChain: Chain; defaultRpc: string } {
    if (chainId === ClobChain.POLYGON) {
      return { clobChain: ClobChain.POLYGON, viemChain: polygon, defaultRpc: polygon.rpcUrls.default.http[0] ?? "https://polygon-rpc.com" };
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

  private normalizePrivateKey(raw?: string): `0x${string}` {
    const trimmed = raw?.trim();
    if (!trimmed) throw new Error("POLYMARKET_PRIVATE_KEY not configured");
    return trimmed.startsWith("0x") ? (trimmed as `0x${string}`) : (`0x${trimmed}` as `0x${string}`);
  }

  private normalizeAddress(raw?: string): `0x${string}` | undefined {
    const trimmed = raw?.trim();
    if (!trimmed) return undefined;
    try {
      return getAddress(trimmed);
    } catch {
      throw new Error(`Invalid POLYMARKET_FUNDER_ADDRESS=${trimmed}`);
    }
  }

  private describeClobError(err: any): { message: string; raw?: unknown } {
    const status = err?.response?.status;
    const preview = this.safeResponsePreview(err?.response?.data ?? err?.data);
    const baseMessage = err?.message ?? "Polymarket CLOB request failed";
    const statusPart = status ? `HTTP ${status}` : "";
    const suggestion = this.shouldSuggestDepositFlow(err)
      ? "Suggestion: set POLYMARKET_SIGNATURE_TYPE=3 and configure POLYMARKET_FUNDER_ADDRESS per Polymarket deposit wallet flow."
      : "";
    const detail = [statusPart, baseMessage, preview && `body: ${preview}`, suggestion].filter(Boolean).join(" | ");
    return { message: detail || "Polymarket CLOB request failed", raw: err?.response?.data ?? err?.data ?? err?.message };
  }

  private shouldSuggestDepositFlow(err: any): boolean {
    if (config.POLYMARKET_SIGNATURE_TYPE === SignatureTypeV2.POLY_1271) {
      return false;
    }
    return this.includesMakerAddressNotAllowed(err);
  }

  private includesMakerAddressNotAllowed(err: any): boolean {
    const needles = ["maker address not allowed", "deposit wallet flow"];
    const candidates = [
      err?.response?.data?.error,
      err?.response?.data?.message,
      err?.response?.data,
      err?.data,
      err?.message
    ];
    for (const candidate of candidates) {
      let str: string | undefined;
      if (typeof candidate === "string") {
        str = candidate;
      } else if (candidate && typeof candidate === "object") {
        try {
          str = JSON.stringify(candidate);
        } catch {
          str = undefined;
        }
      }
      if (!str) continue;
      const lower = str.toLowerCase();
      if (needles.some((needle) => lower.includes(needle))) {
        return true;
      }
    }
    return false;
  }

  private safePreview(data: unknown): string {
    if (data == null) return "";
    try {
      const str = typeof data === "string" ? data : JSON.stringify(data);
      return str.length > 200 ? `${str.slice(0, 200)}…` : str;
    } catch {
      return "[unserializable]";
    }
  }

  private extractOrderId(response: any): string | undefined {
    if (!response) return undefined;
    const candidates = [
      response.orderID,
      response.orderId,
      response.id,
      response.hash,
      response.orderHash,
      response.transactionHash,
      response?.data?.orderId,
      response?.data?.id,
      response?.data?.orderHash
    ];
    const match = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
    return match?.trim();
  }

  private safeKeys(response: any): string[] {
    if (!response || typeof response !== "object") return [];
    return Object.keys(response).slice(0, 20);
  }

  private extractStatusFlag(response: any): string | boolean | undefined {
    if (!response) return undefined;
    return response.status ?? response.state ?? response.success;
  }

  private sanitizedResponse(response: any): Record<string, unknown> {
    if (!response || typeof response !== "object") return {};
    const allowedKeys = ["status", "state", "success", "message", "error", "orderId", "orderID", "id", "hash", "orderHash", "data"];
    return allowedKeys.reduce<Record<string, unknown>>((acc, key) => {
      if (key === "data") {
        const sanitizedData = this.sanitizeData(response[key]);
        if (sanitizedData && Object.keys(sanitizedData).length) {
          acc[key] = sanitizedData;
        }
        return acc;
      }
      if (key in response) {
        acc[key] = redactValueForKey(key, response[key]);
      }
      return acc;
    }, {});
  }

  private sanitizeData(data: any, depth = 0): Record<string, unknown> | undefined {
    if (!data || typeof data !== "object") return undefined;
    const entries = Object.entries(data).slice(0, 20);
    const result: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      if (typeof value === "object" && value !== null && depth < 1) {
        const nested = this.sanitizeData(value, depth + 1);
        if (nested && Object.keys(nested).length) {
          result[key] = nested;
        }
      } else {
        result[key] = redactValueForKey(key, value);
      }
    }
    return result;
  }

  private safeResponsePreview(response: any): string {
    try {
      const sanitized = this.sanitizedResponse(response);
      const json = JSON.stringify(sanitized);
      if (!json) return "";
      return json.length > 1000 ? `${json.slice(0, 1000)}…` : json;
    } catch {
      return "[unserializable]";
    }
  }
}

const SENSITIVE_KEY_SET = new Set([
  "privatekey",
  "apikey",
  "secret",
  "apisecret",
  "passphrase",
  "signature",
  "authorization",
  "authheader",
  "bearer"
]);

function normalizeKeyName(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  if (!key) return false;
  return SENSITIVE_KEY_SET.has(normalizeKeyName(key));
}

function redactValueForKey(key: string, value: unknown): unknown {
  if (isSensitiveKey(key)) {
    return "[redacted]";
  }
  return value;
}

function runSanitizerSelfCheck(): void {
  const makerError = redactValueForKey("error", "maker address not allowed, please use the deposit wallet flow");
  if (makerError !== "maker address not allowed, please use the deposit wallet flow") {
    throw new Error("Response sanitizer should not redact non-sensitive 'error' fields");
  }
  const apiSecret = redactValueForKey("apiSecret", "super-secret-value");
  if (apiSecret !== "[redacted]") {
    throw new Error("Response sanitizer failed to redact sensitive apiSecret field");
  }
}

runSanitizerSelfCheck();
