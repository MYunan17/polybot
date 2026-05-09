"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZepClient = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
class ZepClient {
    get enabled() {
        return Boolean(config_1.config.ZEP_API_KEY);
    }
    async saveMemory(key, summary) {
        if (!this.enabled)
            return;
        // TODO: adapt to current Zep Cloud API if endpoints differ.
        await axios_1.default.post("https://api.getzep.com/api/v2/memory", {
            collection_name: config_1.config.ZEP_COLLECTION_NAME,
            key,
            summary
        }, {
            headers: { Authorization: `Bearer ${config_1.config.ZEP_API_KEY}` },
            timeout: 10000
        }).catch(() => undefined);
    }
}
exports.ZepClient = ZepClient;
