"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyPatch = applyPatch;
function applyPatch(state, patch) {
    const updates = {};
    // 1. Schema Validation
    if (patch.schemaVersion !== state.schemaVersion) {
        console.error(`[Determinism] Schema mismatch: Patch v${patch.schemaVersion}, State v${state.schemaVersion}`);
        updates.isSafeMode = true;
        return updates;
    }
    // 2. Run Isolation
    if (patch.runId !== state.runId) {
        console.error(`[Determinism] Run session mismatch: Patch ${patch.runId}, State ${state.runId}`);
        updates.isSafeMode = true;
        return updates;
    }
    // 3. Monotonic Sequencing
    if (patch.seq <= state.lastSeq) {
        console.warn(`[Determinism] Out-of-order or duplicate seq: Patch ${patch.seq}, Last processed ${state.lastSeq}`);
        return updates; // Drop duplicate/old patch
    }
    // Capture the new sequence number
    updates.lastSeq = patch.seq;
    // 4. Core Domain Updates (Deterministic)
    if (patch.nodes)
        updates.nodes = patch.nodes;
    if (patch.edges)
        updates.edges = patch.edges;
    if (patch.lastCommand)
        updates.lastCommand = patch.lastCommand;
    if (patch.is3D !== undefined)
        updates.is3D = patch.is3D;
    if (patch.isSilent !== undefined)
        updates.isSilent = patch.isSilent;
    if (patch.isArmed !== undefined)
        updates.isArmed = patch.isArmed;
    if (patch.is2FAComplete !== undefined)
        updates.is2FAComplete = patch.is2FAComplete;
    if (patch.auditLogEntry) {
        // Purity check: Ensure patch.auditLogEntry already has a deterministic timestamp
        updates.auditLog = [patch.auditLogEntry, ...state.auditLog].slice(0, 50);
    }
    if (patch.rollbackStatus) {
        updates.rollbackStatus = patch.rollbackStatus;
    }
    return updates;
}
