"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useStore = void 0;
const zustand_1 = require("zustand");
const patch_1 = require("./patch");
exports.useStore = (0, zustand_1.create)((set) => ({
    // Initial State
    nodes: [],
    edges: [],
    lastCommand: 'READY',
    is3D: false,
    isSilent: false,
    auditLog: [],
    rollbackStatus: { fail: 0, stable: 100 },
    connected: false,
    schemaVersion: 1,
    runId: 'initial',
    lastSeq: 0,
    isSafeMode: false,
    isArmed: false,
    is2FAComplete: false,
    // Actions
    handleServerMessage: (msg) => {
        set((state) => (0, patch_1.applyPatch)(state, msg));
    },
    dispatchSVP: (action, send) => {
        const state = exports.useStore.getState();
        console.log(`[SVP] Causal Gate Check: ${action}`);
        // Safety Registry
        const requiresAuth = ['EXECUTE', 'ROLLBACK_ARM'].includes(action);
        if (requiresAuth) {
            if (!state.isArmed) {
                console.error(`[CausalGate] BLOCKED: ${action} attempted without ARM state.`);
                set((s) => ({
                    auditLog: [{
                            ts: new Date().toISOString(),
                            action: 'SVP_REJECTION',
                            details: `Blocked command ${action}: System not ARMED.`
                        }, ...s.auditLog].slice(0, 50)
                }));
                return;
            }
            if (!state.is2FAComplete) {
                console.error(`[CausalGate] BLOCKED: ${action} attempted without 2FA completion.`);
                set((s) => ({
                    auditLog: [{
                            ts: new Date().toISOString(),
                            action: 'SVP_REJECTION',
                            details: `Blocked command ${action}: 2FA pending.`
                        }, ...s.auditLog].slice(0, 50)
                }));
                return;
            }
        }
        set({ lastCommand: action });
        if (send) {
            send({ action, ts: new Date().toISOString() });
        }
    },
    toggle3D: () => set((state) => ({ is3D: !state.is3D })),
    toggleSilent: () => set((state) => ({ isSilent: !state.isSilent })),
    updateStatus: (fail, stable) => set({ rollbackStatus: { fail, stable } }),
    setConnected: (connected) => set({ connected })
}));
