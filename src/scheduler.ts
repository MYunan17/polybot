import { logger } from "./logger";

let running = false;

export async function runWithLock(fn: () => Promise<void>): Promise<void> {
  if (running) {
    logger.warn("Previous run still active, skipping overlapping run");
    return;
  }
  running = true;
  try {
    await fn();
  } finally {
    running = false;
  }
}

export function scheduleEvery6Hours(fn: () => Promise<void>): void {
  void runWithLock(fn);
  setInterval(() => void runWithLock(fn), 6 * 60 * 60 * 1000);
}
