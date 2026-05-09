"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withRetry = withRetry;
async function withRetry(fn, retries = 2, baseMs = 400) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        }
        catch (err) {
            lastErr = err;
            if (i < retries)
                await new Promise((r) => setTimeout(r, baseMs * (i + 1)));
        }
    }
    throw lastErr;
}
