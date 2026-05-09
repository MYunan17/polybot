"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWithLock = runWithLock;
exports.scheduleEvery6Hours = scheduleEvery6Hours;
const logger_1 = require("./logger");
let running = false;
async function runWithLock(fn) {
    if (running) {
        logger_1.logger.warn("Previous run still active, skipping overlapping run");
        return;
    }
    running = true;
    try {
        await fn();
    }
    finally {
        running = false;
    }
}
function scheduleEvery6Hours(fn) {
    void runWithLock(fn);
    setInterval(() => void runWithLock(fn), 6 * 60 * 60 * 1000);
}
