"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const openclawClient_1 = require("../services/openclawClient");
void (async () => {
    const ok = await new openclawClient_1.OpenClawClient().healthCheck();
    console.log(`openclaw health: ${ok ? "ok" : "failed"}`);
})();
