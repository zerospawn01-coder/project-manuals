"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertStateTransition = assertStateTransition;
exports.requireState = requireState;
exports.isConfirmationExpired = isConfirmationExpired;
exports.assertConfirmationForPhase = assertConfirmationForPhase;
exports.assertConfirmationForPreviewArtifact = assertConfirmationForPreviewArtifact;
const errors_1 = require("../errors");
const model_1 = require("./model");
function assertStateTransition(snapshot, nextState) {
    (0, model_1.assertValidTransition)(snapshot.state, nextState);
}
function requireState(snapshot, expectedState) {
    if (snapshot.state !== expectedState) {
        throw new errors_1.RepoSplitError('EXECUTION_NOT_ALLOWED', `Expected repo split state ${expectedState} but found ${snapshot.state}`, {
            expectedState,
            actualState: snapshot.state,
        });
    }
}
function isConfirmationExpired(confirmation, now = new Date()) {
    return new Date(confirmation.expiresAt).getTime() <= now.getTime();
}
function assertConfirmationForPhase(confirmation, phase, planHash, now = new Date()) {
    if (confirmation.planHash !== planHash) {
        throw new errors_1.RepoSplitError('PLAN_HASH_MISMATCH', 'Confirmation planHash does not match the current plan.', {
            confirmationId: confirmation.confirmationId,
            confirmationPlanHash: confirmation.planHash,
            planHash,
        });
    }
    if (confirmation.phase !== phase && confirmation.scope !== 'full-run') {
        throw new errors_1.RepoSplitError('EXECUTION_NOT_ALLOWED', `Confirmation scope ${confirmation.scope} does not permit phase ${phase}.`, {
            confirmationId: confirmation.confirmationId,
            phase,
            scope: confirmation.scope,
        });
    }
    if (isConfirmationExpired(confirmation, now)) {
        throw new errors_1.RepoSplitError('EXECUTION_NOT_ALLOWED', `Confirmation ${confirmation.confirmationId} has expired.`, {
            confirmationId: confirmation.confirmationId,
            expiresAt: confirmation.expiresAt,
        });
    }
}
function assertConfirmationForPreviewArtifact(confirmation, previewArtifactId) {
    if (!previewArtifactId) {
        return;
    }
    if (confirmation.previewArtifactId !== previewArtifactId) {
        throw new errors_1.RepoSplitError('PREVIEW_ARTIFACT_MISMATCH', `Confirmation ${confirmation.confirmationId} is not bound to preview artifact ${previewArtifactId}.`, {
            confirmationId: confirmation.confirmationId,
            confirmationPreviewArtifactId: confirmation.previewArtifactId,
            previewArtifactId,
        });
    }
}
