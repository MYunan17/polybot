"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MiroFishClient = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const retry_1 = require("../utils/retry");
class MiroFishClient {
    async healthCheck() {
        const routes = ["/", "/health", "/api/health", "/docs"];
        for (const route of routes) {
            const url = `${config_1.config.MIROFISH_URL}${route}`;
            try {
                const res = await axios_1.default.get(url, {
                    timeout: Math.min(config_1.config.MIROFISH_REQUEST_TIMEOUT_MS, 8000),
                    validateStatus: () => true
                });
                if (res.status >= 200 && res.status < 500) {
                    return {
                        ok: true,
                        url: config_1.config.MIROFISH_URL,
                        detectedRoute: route,
                        statusCode: res.status,
                        message: `Endpoint reachable: ${route}`
                    };
                }
            }
            catch (err) {
                if (err?.response?.status) {
                    return {
                        ok: true,
                        url: config_1.config.MIROFISH_URL,
                        detectedRoute: route,
                        statusCode: err.response.status,
                        message: `Endpoint responded with status ${err.response.status} on ${route}`
                    };
                }
            }
        }
        return {
            ok: false,
            url: config_1.config.MIROFISH_URL,
            message: "MiroFish unreachable. Ensure container is running and port is mapped (e.g., localhost:5001)."
        };
    }
    async predict(seed, options) {
        const routes = [config_1.config.MIROFISH_ROUTE_PRIMARY, config_1.config.MIROFISH_ROUTE_FALLBACK]
            .map((r) => r.trim())
            .filter(Boolean);
        const routeTried = [];
        for (const route of routes) {
            const url = `${config_1.config.MIROFISH_URL}${route.startsWith("/") ? route : `/${route}`}`;
            routeTried.push(route);
            try {
                const res = await (0, retry_1.withRetry)(async () => axios_1.default.post(url, {
                    seed,
                    agents: options.agents,
                    rounds: options.rounds,
                    model: options.model ?? "deepseek-v3"
                }, { timeout: config_1.config.MIROFISH_REQUEST_TIMEOUT_MS }), 2, 800);
                const parsed = parseMiroFishResult(seed.marketId, res.data);
                if (!parsed.ok) {
                    return { ok: false, routeTried, error: parsed.error, raw: res.data };
                }
                return { ok: true, routeTried, result: parsed.result, raw: res.data };
            }
            catch (err) {
                const e = err;
                const status = e.response?.status;
                if (status === 404)
                    continue;
                return {
                    ok: false,
                    routeTried,
                    error: `MiroFish request failed on ${route}: ${e.message}`,
                    raw: e.response?.data
                };
            }
        }
        return {
            ok: false,
            routeTried,
            error: `Unsupported MiroFish routes. Tried: ${routeTried.join(", ")}`
        };
    }
}
exports.MiroFishClient = MiroFishClient;
function parseMiroFishResult(marketId, payload) {
    const p = (payload ?? {});
    const reportObj = (p.report && typeof p.report === "object") ? p.report : {};
    const rawConfidenceCandidate = pickFirstNumber([
        p.confidence_score,
        p.confidenceScore,
        p.confidence,
        reportObj.confidence_score,
        reportObj.confidence
    ]);
    const rawProbabilityCandidate = pickFirstNumber([
        p.rawProbability,
        p.probability,
        reportObj.probability
    ]);
    const reportText = [
        asString(p.reportText),
        asString(p.report),
        asString(p.summary),
        asString(p.text),
        asString(reportObj.text)
    ].filter(Boolean).join("\n");
    const textParsed = parseFromText(reportText);
    const confidence = normalizeToScore(rawConfidenceCandidate ?? textParsed.confidence);
    const probability = normalizeToProbability(rawProbabilityCandidate ?? textParsed.probability ?? (confidence === null ? undefined : confidence));
    if (confidence === null || probability === null) {
        return { ok: false, error: "Unable to parse confidence/probability from MiroFish response" };
    }
    return {
        ok: true,
        result: {
            marketId,
            rawConfidenceScore: confidence,
            rawProbability: probability,
            reportText: reportText.slice(0, 6000),
            strongestYesArguments: normalizeStringArray(p.strongestYesArguments ?? reportObj.strongestYesArguments),
            strongestNoArguments: normalizeStringArray(p.strongestNoArguments ?? reportObj.strongestNoArguments),
            uncertainty: asString(p.uncertainty ?? reportObj.uncertainty) || "unknown",
            modelMetadata: p.modelMetadata ?? reportObj.modelMetadata ?? {}
        }
    };
}
function parseFromText(text) {
    if (!text)
        return {};
    const confPatterns = [
        /confidence[_\s-]*score\s*:\s*(\d+(?:\.\d+)?)\s*%?/i,
        /confidence\s*:\s*(\d+(?:\.\d+)?)\s*%?/i
    ];
    const probPatterns = [
        /probability\s*:\s*(\d+(?:\.\d+)?)\s*%?/i,
        /yes\s+probability\s*:\s*(\d+(?:\.\d+)?)\s*%?/i
    ];
    const confidence = extractPatternNumber(text, confPatterns);
    const probability = extractPatternNumber(text, probPatterns);
    return { confidence, probability };
}
function extractPatternNumber(text, patterns) {
    for (const pattern of patterns) {
        const m = text.match(pattern);
        if (m?.[1])
            return Number(m[1]);
    }
    return undefined;
}
function pickFirstNumber(vals) {
    for (const v of vals) {
        const n = Number(v);
        if (Number.isFinite(n))
            return n;
    }
    return undefined;
}
function normalizeToScore(n) {
    if (!Number.isFinite(n))
        return null;
    if (n <= 1)
        return clamp(n * 100, 0, 100);
    return clamp(n, 0, 100);
}
function normalizeToProbability(n) {
    if (!Number.isFinite(n))
        return null;
    if (n > 1)
        return clamp(n / 100, 0, 1);
    return clamp(n, 0, 1);
}
function normalizeStringArray(v) {
    if (!Array.isArray(v))
        return [];
    return v.map((x) => String(x)).filter(Boolean).slice(0, 8);
}
function asString(v) {
    if (typeof v === "string")
        return v;
    if (v && typeof v === "object") {
        try {
            return JSON.stringify(v);
        }
        catch {
            return "";
        }
    }
    return "";
}
function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}
