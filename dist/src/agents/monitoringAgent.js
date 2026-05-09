"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MonitoringAgent = void 0;
class MonitoringAgent {
    telegram;
    constructor(telegram) {
        this.telegram = telegram;
    }
    async run(note) {
        await this.telegram.sendNotification(note);
    }
}
exports.MonitoringAgent = MonitoringAgent;
