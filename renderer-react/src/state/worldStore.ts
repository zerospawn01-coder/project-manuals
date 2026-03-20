import { create } from 'zustand';
import { WorldState, WorldPatch } from './worldTypes';
import { applyPatch } from './patch';

export interface WorldStore extends WorldState {
    handleServerMessage: (msg: WorldPatch) => void;
    dispatchSVP: (action: string, send?: (data: Record<string, unknown>) => void) => void;
    toggle3D: () => void;
    toggleSilent: () => void;
    updateStatus: (fail: number, stable: number) => void;
    setConnected: (connected: boolean) => void;
}

export const useStore = create<WorldStore>((set) => ({
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
        set((state) => applyPatch(state, msg));
    },

    dispatchSVP: (action, send) => {
        const state = useStore.getState();
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
    setConnected: (connected: boolean) => set({ connected })
}));
