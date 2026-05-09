"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalibrationAgent = void 0;
class CalibrationAgent {
    store;
    constructor(store) {
        this.store = store;
    }
    async run(marketId, rawProbability) {
        const sampleSize = await this.store.countResolvedPredictions();
        const calibrationFactor = sampleSize < 30 ? 0.75 : 0.9;
        const adjustedProbability = clamp(0.5 + (rawProbability - 0.5) * calibrationFactor, 0.01, 0.99);
        return {
            marketId,
            rawProbability,
            adjustedProbability,
            calibrationFactor,
            calibrationReason: sampleSize < 30
                ? "Conservative shrinkage toward 0.5 (early sample regime)"
                : "Baseline calibration factor applied from resolved sample history",
            sampleSize,
            categoryAdjustment: undefined
        };
    }
}
exports.CalibrationAgent = CalibrationAgent;
function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}
