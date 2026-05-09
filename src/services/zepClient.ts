import axios from "axios";
import { config } from "../config";

export class ZepClient {
  get enabled(): boolean {
    return Boolean(config.ZEP_API_KEY);
  }

  async saveMemory(key: string, summary: string): Promise<void> {
    if (!this.enabled) return;
    // TODO: adapt to current Zep Cloud API if endpoints differ.
    await axios.post(
      "https://api.getzep.com/api/v2/memory",
      {
        collection_name: config.ZEP_COLLECTION_NAME,
        key,
        summary
      },
      {
        headers: { Authorization: `Bearer ${config.ZEP_API_KEY}` },
        timeout: 10000
      }
    ).catch(() => undefined);
  }
}
