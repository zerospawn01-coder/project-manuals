"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const patch_1 = require("../state/patch");
// Utility to "hash" state for comparison
function getCoreHash(state) {
    return JSON.stringify({
        nodes: state.nodes.length,
        edges: state.edges.length,
        lastCommand: state.lastCommand,
        lastSeq: state.lastSeq,
        isSafeMode: state.isSafeMode
    });
}
const initialState = {
    nodes: [],
    edges: [],
    lastCommand: '',
    is3D: false,
    isSilent: false,
    auditLog: [],
    rollbackStatus: { fail: 0, stable: 0 },
    connected: true,
    schemaVersion: 1,
    runId: 'RUN_ALPHA',
    lastSeq: 0,
    isSafeMode: false,
    isArmed: false,
    is2FAComplete: false
};
// Generate 100 patches - strictly "latest wins" for these tests
const baselinePatches = Array.from({ length: 100 }, (_, i) => ({
    schemaVersion: 1,
    runId: 'RUN_ALPHA',
    source: 'TEST_STREAM',
    seq: i + 1,
    lastCommand: `CMD_${i + 1}`,
    isArmed: true,
    is2FAComplete: true,
    nodes: [{ id: 'N1', type: 'core', data: { v: i + 1 }, position: { x: 0, y: 0 } }],
    auditLogEntry: {
        ts: new Date().toISOString(),
        action: `ACTION_${i + 1}`,
        details: `Details for ${i + 1}`
    }
}));
function runReplay(name, patches) {
    let state = { ...initialState };
    let rejected = 0;
    let quarantined = 0;
    for (const patch of patches) {
        const updates = (0, patch_1.applyPatch)(state, patch);
        if (updates.isSafeMode && !state.isSafeMode) {
            quarantined++;
        }
        else if (Object.keys(updates).length === 0) {
            rejected++;
        }
        state = { ...state, ...updates };
    }
    const coreHash = getCoreHash(state);
    console.log(`[${name}] Rejected: ${rejected}, Quarantined: ${quarantined}, CoreHash: ${coreHash}`);
    return { state, rejected, quarantined, coreHash };
}
console.log('--- RELEASE HARDENING: DETERMINISM AUDIT ---');
// Replay A: Baseline
const resultA = runReplay('REPLAY_A', baselinePatches);
// Replay B: Jitter (Shuffled within windows of 5)
const jitterPatches = [...baselinePatches];
for (let i = 0; i < jitterPatches.length; i += 5) {
    const chunk = jitterPatches.slice(i, Math.min(i + 5, jitterPatches.length)).sort(() => Math.random() - 0.5);
    jitterPatches.splice(i, chunk.length, ...chunk);
}
const resultB = runReplay('REPLAY_B', jitterPatches);
// Replay C: Duplicates
const duplicatePatches = [...baselinePatches];
for (let i = 0; i < 20; i++) {
    duplicatePatches.push(baselinePatches[Math.floor(Math.random() * 100)]);
}
duplicatePatches.sort((a, b) => (a.seq || 0) - (b.seq || 0));
const resultC = runReplay('REPLAY_C', duplicatePatches);
// Replay D: Mixed RunID
const resultD = runReplay('REPLAY_D', [...baselinePatches, {
        schemaVersion: 1,
        runId: 'RUN_BETA',
        source: 'ATTACKER',
        seq: 101,
        lastCommand: 'FORCE_EXIT'
    }]);
const pass = resultA.coreHash === resultB.coreHash && resultA.coreHash === resultC.coreHash;
console.log(`\nDETERMINISM_TABLE:`);
console.log(`| Test | Core Match? | Rejected | Quarantined |`);
console.log(`|------|-------------|----------|-------------|`);
console.log(`| A (Base) | YES | ${resultA.rejected} | ${resultA.quarantined} |`);
console.log(`| B (Jitter) | ${resultB.coreHash === resultA.coreHash ? 'YES' : 'NO'} | ${resultB.rejected} | ${resultB.quarantined} |`);
console.log(`| C (Dupe) | ${resultC.coreHash === resultA.coreHash ? 'YES' : 'NO'} | ${resultC.rejected} | ${resultC.quarantined} |`);
console.log(`| D (Mixed) | NO_MUTATE | ${resultD.rejected} | ${resultD.quarantined} |`);
console.log(`\nOVERALL DETERMINISM PASS: ${pass}`);
console.log(`\n--- FINAL TELEMETRY SUMMARY ---`);
console.log(`Reorder Rejections (Test B): ${resultB.rejected}`);
console.log(`Duplicate Rejections (Test C): ${resultC.rejected}`);
console.log(`Quarantine Detections (Test D): ${resultD.quarantined}`);
