"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenClawClient = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
class OpenClawClient {
    async healthCheck() {
        try {
            await axios_1.default.get(`${config_1.config.OPENCLAW_URL}/health`, {
                headers: this.headers(),
                timeout: 6000
            });
            return true;
        }
        catch {
            return false;
        }
    }
    async getCapabilities() {
        // TODO: adjust if endpoint differs.
        const res = await axios_1.default.get(`${config_1.config.OPENCLAW_URL}/capabilities`, { headers: this.headers(), timeout: 6000 });
        return res.data;
    }
    async placeLimitOrder(request) {
        try {
            // TODO: adjust payload/endpoint to actual OpenClaw API contract.
            const res = await axios_1.default.post(`${config_1.config.OPENCLAW_URL}/orders/limit`, request, {
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
        }
        catch (err) {
            return { status: "failed", message: err?.message ?? "OpenClaw request failed", raw: err?.response?.data };
        }
    }
    async getPositions() {
        const res = await axios_1.default.get(`${config_1.config.OPENCLAW_URL}/positions`, { headers: this.headers(), timeout: 8000 });
        return Array.isArray(res.data) ? res.data : [];
    }
    headers() {
        return config_1.config.OPENCLAW_API_KEY ? { "x-api-key": config_1.config.OPENCLAW_API_KEY } : {};
    }
}
exports.OpenClawClient = OpenClawClient;
