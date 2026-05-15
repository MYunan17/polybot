import axios from "axios";
import { config } from "../config";
import { ExecutionRequest, ExecutionResult } from "../types";

export class OpenClawClient {
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
    const { url, path } = this.buildSubmitUrl();
    try {
      const res = await axios.post(url, request, {
        headers: this.headers(),
        timeout: 10000
      });
      return {
        status: "submitted",
        orderId: String(res.data?.orderId ?? ""),
        txHash: res.data?.txHash ? String(res.data.txHash) : undefined,
        message: `Order submitted via ${path}`,
        raw: res.data
      };
    } catch (err: any) {
      const status = err?.response?.status;
      const preview = this.safePreview(err?.response?.data);
      const message = `HTTP ${status ?? "?"} POST ${path} failed: ${err?.message ?? "Unknown error"}${preview ? ` | body: ${preview}` : ""}`;
      return { status: "failed", message, raw: { status, body: preview } };
    }
  }

  async getPositions(): Promise<unknown[]> {
    const res = await axios.get(`${config.OPENCLAW_URL}/positions`, { headers: this.headers(), timeout: 8000 });
    return Array.isArray(res.data) ? res.data : [];
  }

  private headers(): Record<string, string> {
    return config.OPENCLAW_API_KEY ? { "x-api-key": config.OPENCLAW_API_KEY } : {};
  }

  private buildSubmitUrl(): { url: string; path: string } {
    const base = (config.OPENCLAW_URL ?? "").trim();
    const path = (config.OPENCLAW_SUBMIT_ORDER_PATH ?? "").trim();
    if (!base) {
      throw new Error("OPENCLAW_URL not configured");
    }
    if (!path) {
      throw new Error("OPENCLAW_SUBMIT_ORDER_PATH not configured");
    }
    const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return { url: `${normalizedBase}${normalizedPath}`, path: normalizedPath };
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
