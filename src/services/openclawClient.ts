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
    try {
      // TODO: adjust payload/endpoint to actual OpenClaw API contract.
      const res = await axios.post(`${config.OPENCLAW_URL}/orders/limit`, request, {
        headers: this.headers(),
        timeout: 10000
      });
      return {
        status: "submitted",
        orderId: String(res.data?.orderId ?? ""),
        txHash: res.data?.txHash ? String(res.data.txHash) : undefined,
        message: "Order submitted",
        raw: res.data
      };
    } catch (err: any) {
      return { status: "failed", message: err?.message ?? "OpenClaw request failed", raw: err?.response?.data };
    }
  }

  async getPositions(): Promise<unknown[]> {
    const res = await axios.get(`${config.OPENCLAW_URL}/positions`, { headers: this.headers(), timeout: 8000 });
    return Array.isArray(res.data) ? res.data : [];
  }

  private headers(): Record<string, string> {
    return config.OPENCLAW_API_KEY ? { "x-api-key": config.OPENCLAW_API_KEY } : {};
  }
}
