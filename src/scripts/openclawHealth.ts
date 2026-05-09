import { OpenClawClient } from "../services/openclawClient";

void (async () => {
  const ok = await new OpenClawClient().healthCheck();
  console.log(`openclaw health: ${ok ? "ok" : "failed"}`);
})();
