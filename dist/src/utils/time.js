"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.daysUntil = exports.nowIso = void 0;
const nowIso = () => new Date().toISOString();
exports.nowIso = nowIso;
const daysUntil = (isoDate) => (new Date(isoDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
exports.daysUntil = daysUntil;
