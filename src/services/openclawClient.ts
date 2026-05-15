import axios from "axios";
import {
  Chain as ClobChain,
  ClobClient,
  OrderType,
  Side as ClobSide,
  SignatureType,
  type ApiKeyCreds,
  type UserOrder
} from "@polymarket/clob-client";
import { createWalletClient, http, type Chain } from "viem";
import { polygon, polygonAmoy } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import { ExecutionRequest, ExecutionResult } from "../types";

export class OpenClawClient {
  private clob?: ClobClient;

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

  async getCapabilities(): Promise<unknown> {
    // TODO: adjust if endpoint differs.
    const res = await axios.get(`${config.OPENCLAW_URL}/capabilities`, { headers: this.headers(), timeout: 6000 });
    return res.data;
  }

  async placeLimitOrder(request: ExecutionRequest): Promise<ExecutionResult> {
    try {
      const client = await this.ensureClobClient();
      const { userOrder } = this.prepareUserOrder(request);
      const response = await client.createAndPostOrder(userOrder, undefined, OrderType.GTC, false, true);
      const orderId = response?.order_id ?? response?.orderId ?? response?.id ?? undefined;
      return {
        status: "submitted",
        orderId,
        message: `Polymarket CLOB order submitted at ${(request.limitPrice * 100).toFixed(2)}%`,
        raw: response
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

  async buildLimitOrder(request: ExecutionRequest): Promise<{ tokenId: string; price: number; sizeTokens: number; orderHash?: string }> {
    const client = await this.ensureClobClient();
    const { userOrder, sizeTokens } = this.prepareUserOrder(request);
    const signed = await client.createOrder(userOrder);
    const orderHash = (signed as any)?.orderHash ?? (signed as any)?.id ?? undefined;
    return { tokenId: userOrder.tokenID, price: userOrder.price, sizeTokens, orderHash };
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
    const signatureType = this.resolveSignatureType();
    const funder = config.POLYMARKET_FUNDER_ADDRESS?.trim() || undefined;
    this.clob = new ClobClient(host, clobChain, wallet, creds, signatureType, funder);
    return this.clob;
  }

  private prepareUserOrder(request: ExecutionRequest): { userOrder: UserOrder; sizeTokens: number } {
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
    const userOrder: UserOrder = {
      tokenID: request.tokenId,
      price,
      size: sizeTokens,
      side: ClobSide.BUY
    };
    return { userOrder, sizeTokens };
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

  private resolveSignatureType(): SignatureType {
    if (config.POLYMARKET_SIGNATURE_TYPE === SignatureType.EOA) {
      return SignatureType.EOA;
    }
    throw new Error("Only SignatureType=0 (EOA) is supported for CLOB execution");
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

  private describeClobError(err: any): { message: string; raw?: unknown } {
    const status = err?.response?.status;
    const preview = this.safePreview(err?.response?.data ?? err?.data);
    const baseMessage = err?.message ?? "Polymarket CLOB request failed";
    const statusPart = status ? `HTTP ${status}` : "";
    const detail = [statusPart, baseMessage, preview && `body: ${preview}`].filter(Boolean).join(" | ");
    return { message: detail || "Polymarket CLOB request failed", raw: err?.response?.data ?? err?.data ?? err?.message };
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
}
