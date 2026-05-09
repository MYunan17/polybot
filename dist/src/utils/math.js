"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.round4 = exports.clamp01 = void 0;
const clamp01 = (n) => Math.min(1, Math.max(0, n));
exports.clamp01 = clamp01;
const round4 = (n) => Math.round(n * 10000) / 10000;
exports.round4 = round4;
