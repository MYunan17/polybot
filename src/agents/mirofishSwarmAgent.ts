import { config } from "../config";
import { MiroFishClient, MiroFishPredictResponse } from "../services/mirofishClient";
import { SeedPacket } from "../types";

export class MiroFishSwarmAgent {
  constructor(private readonly client: MiroFishClient) {}

  async healthCheck() {
    return this.client.healthCheck();
  }

  async runLight(seed: SeedPacket): Promise<{ mode: "light"; agents: number; rounds: number; response: MiroFishPredictResponse }> {
    const agents = config.MIROFISH_LIGHT_AGENTS;
    const rounds = config.MIROFISH_LIGHT_ROUNDS;
    const response = await this.client.predict(seed, {
      agents,
      rounds,
      model: "deepseek-v3"
    });
    return { mode: "light", agents, rounds, response };
  }

  async runDeep(seed: SeedPacket): Promise<{ mode: "deep"; agents: number; rounds: number; response: MiroFishPredictResponse }> {
    const agents = config.MIROFISH_DEEP_AGENTS;
    const rounds = config.MIROFISH_DEEP_ROUNDS;
    const response = await this.client.predict(seed, {
      agents,
      rounds,
      model: "deepseek-v3"
    });
    return { mode: "deep", agents, rounds, response };
  }
}
