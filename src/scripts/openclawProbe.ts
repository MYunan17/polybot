import axios from "axios";
import { config } from "../config";
import { logger } from "../logger";

const PATHS = [
  "/",
  "/health",
  "/api",
  "/api/health",
  "/api/status",
  "/api/orders",
  "/api/order",
  "/api/route",
  "/api/trade",
  "/api/submit",
  "/api/openclaw/order"
];

const METHODS: Array<"GET" | "OPTIONS"> = ["GET", "OPTIONS"];

function buildUrl(baseUrl: string, path: string): { url: string; path: string } {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  const finalPath = normalizedPath || "/";
  const url = normalizedPath ? `${normalizedBase}${normalizedPath}` : normalizedBase;
  return { url, path: finalPath };
}

void (async () => {
  const baseUrl = (config.OPENCLAW_URL ?? "").trim();
  if (!baseUrl) {
    throw new Error("OPENCLAW_URL not configured");
  }

  console.log(`Probing OpenClaw base ${baseUrl}`);
  for (const path of PATHS) {
    const { url, path: displayPath } = buildUrl(baseUrl, path);
    for (const method of METHODS) {
      try {
        const res = await axios.request({
          method,
          url,
          timeout: 5000,
          validateStatus: () => true
        });
        console.log(`${method} ${displayPath} -> ${res.status}`);
      } catch (err: any) {
        console.log(`${method} ${displayPath} -> ERROR ${err?.message ?? "request failed"}`);
      }
    }
  }
})().catch((err) => {
  logger.error({ err }, "openclaw:probe failed");
  process.exit(1);
});
