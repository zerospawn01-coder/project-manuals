"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const worldStore_1 = require("../state/worldStore");
console.log('--- RELEASE HARDENING: EXECUTION SAFETY REGRESSION ---');
const store = worldStore_1.useStore.getState();
// Case 1: Execute while NOT armed
console.log('\nTesting: EXECUTE (Unarmed)');
store.dispatchSVP('EXECUTE');
let latestAudit = worldStore_1.useStore.getState().auditLog[0];
console.log(`Action: ${latestAudit?.action}, Details: ${latestAudit?.details}`);
// Case 2: Arm, then Execute without 2FA
console.log('\nTesting: EXECUTE (Armed, but no 2FA)');
// Simulate server patch to ARM the system
store.handleServerMessage({
    schemaVersion: 1,
    runId: 'initial',
    source: 'SERVER',
    seq: 1,
    isArmed: true,
    is2FAComplete: false
});
store.dispatchSVP('EXECUTE');
latestAudit = worldStore_1.useStore.getState().auditLog[0];
console.log(`Action: ${latestAudit?.action}, Details: ${latestAudit?.details}`);
// Case 3: Complete 2FA, then Execute
console.log('\nTesting: EXECUTE (Armed + 2FA)');
store.handleServerMessage({
    schemaVersion: 1,
    runId: 'initial',
    source: 'SERVER',
    seq: 2,
    is2FAComplete: true
});
store.dispatchSVP('EXECUTE');
console.log(`Last Command: ${worldStore_1.useStore.getState().lastCommand}`);
// Case 4: Schema Mismatch
console.log('\nTesting: Schema Mismatch Detection');
store.handleServerMessage({
    schemaVersion: 999, // Mismatch
    runId: 'initial',
    source: 'STALE_SERVER',
    seq: 3,
    lastCommand: 'BAD_SYNC'
});
console.log(`Safe Mode Active: ${worldStore_1.useStore.getState().isSafeMode}`);
