"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mirofishClient_1 = require("../services/mirofishClient");
void (async () => {
    const info = await new mirofishClient_1.MiroFishClient().healthCheck();
    console.log(JSON.stringify(info, null, 2));
})();
