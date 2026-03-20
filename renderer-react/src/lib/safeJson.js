"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeJson = void 0;
exports.safeJson = {
    parse: (str, fallback) => {
        try {
            return JSON.parse(str);
        }
        catch (e) {
            console.error('[SafeJSON] Parse failure:', e);
            return fallback;
        }
    },
    stringify: (obj) => {
        try {
            return JSON.stringify(obj);
        }
        catch (e) {
            console.error('[SafeJSON] Stringify failure:', e);
            return '{}';
        }
    }
};
