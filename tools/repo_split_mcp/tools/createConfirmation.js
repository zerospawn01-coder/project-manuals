"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConfirmation = createConfirmation;
const node_crypto_1 = require("node:crypto");
const confirmations_1 = require("../state/confirmations");
function createConfirmation(input) {
    const ttlMinutes = input.ttlMinutes ?? 30;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    const scope = input.scope ?? input.phase;
    const confirmation = (0, confirmations_1.storeConfirmation)({
        confirmationId: (0, node_crypto_1.randomUUID)(),
        planHash: input.planHash,
        planArtifactId: input.planArtifactId,
        phase: input.phase,
        expiresAt,
        scope,
        previewArtifactId: input.previewArtifactId,
    });
    return {
        layout: input.layout,
        reason: input.reason,
        confirmation,
    };
}
