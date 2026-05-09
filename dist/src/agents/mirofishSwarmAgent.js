"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MiroFishSwarmAgent = void 0;
const config_1 = require("../config");
class MiroFishSwarmAgent {
    client;
    constructor(client) {
        this.client = client;
    }
    async healthCheck() {
        return this.client.healthCheck();
    }
    async runLight(seed) {
        const agents = config_1.config.MIROFISH_LIGHT_AGENTS;
        const rounds = config_1.config.MIROFISH_LIGHT_ROUNDS;
        const response = await this.client.predict(seed, {
            agents,
            rounds,
            model: "deepseek-v3"
        });
        return { mode: "light", agents, rounds, response };
    }
    async runDeep(seed) {
        const agents = config_1.config.MIROFISH_DEEP_AGENTS;
        const rounds = config_1.config.MIROFISH_DEEP_ROUNDS;
        const response = await this.client.predict(seed, {
            agents,
            rounds,
            model: "deepseek-v3"
        });
        return { mode: "deep", agents, rounds, response };
    }
}
exports.MiroFishSwarmAgent = MiroFishSwarmAgent;
