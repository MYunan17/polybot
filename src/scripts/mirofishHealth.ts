import { MiroFishClient } from "../services/mirofishClient";

void (async () => {
  const info = await new MiroFishClient().healthCheck();
  console.log(JSON.stringify(info, null, 2));
})();
