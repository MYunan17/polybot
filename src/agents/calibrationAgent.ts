import { SqliteStore } from "../services/sqliteStore";
import { CalibratedPrediction } from "../types";

export class CalibrationAgent {
  constructor(private readonly store: SqliteStore) {}

  async run(marketId: string, rawProbability: number): Promise<CalibratedPrediction> {
    const sampleSize = await this.store.countResolvedPredictions();
    const calibrationFactor = sampleSize < 30 ? 0.75 : 0.9;
    const adjustedProbability = clamp(0.5 + (rawProbability - 0.5) * calibrationFactor, 0.01, 0.99);
    return {
      marketId,
      rawProbability,
      adjustedProbability,
      calibrationFactor,
      calibrationReason:
        sampleSize < 30
          ? "Conservative shrinkage toward 0.5 (early sample regime)"
          : "Baseline calibration factor applied from resolved sample history",
      sampleSize,
      categoryAdjustment: undefined
    };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
