"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeConfirmed = executeConfirmed;
const ids_1 = require("../artifacts/ids");
const errors_1 = require("../errors");
const parsePreview_1 = require("../internal/parsePreview");
const runPowerShell_1 = require("../internal/runPowerShell");
const scriptRuntime_1 = require("../internal/scriptRuntime");
const confirmations_1 = require("../state/confirmations");
const artifacts_1 = require("../state/artifacts");
const guards_1 = require("../state/guards");
const model_1 = require("../state/model");
async function executeConfirmed(input) {
    const snapshot = input.snapshot ?? {
        ...(0, model_1.createInitialExecutionState)(),
        state: 'confirmed',
        planHash: input.planHash,
        confirmationId: input.confirmationId,
    };
    (0, guards_1.requireState)(snapshot, 'confirmed');
    const confirmation = (0, confirmations_1.getConfirmation)(input.confirmationId);
    if (!confirmation) {
        throw new errors_1.RepoSplitError('CONFIRMATION_NOT_FOUND', `Confirmation not found: ${input.confirmationId}`, {
            confirmationId: input.confirmationId,
        });
    }
    (0, guards_1.assertConfirmationForPhase)(confirmation, input.phase, input.planHash);
    (0, guards_1.assertConfirmationForPreviewArtifact)(confirmation, input.previewArtifactId);
    const result = await (0, runPowerShell_1.runPowerShell)((0, scriptRuntime_1.resolvePreviewScriptPath)(input.phase), (0, scriptRuntime_1.buildPhaseRuntimeArgs)(input.phase, input.runtime, {
        layout: input.layout,
        excludedAction: input.excludedAction,
        remoteScheme: input.remoteScheme,
        whatIf: false,
    }));
    if (result.exitCode !== 0) {
        throw new errors_1.RepoSplitError('EXECUTION_FAILED', `Execution failed for phase ${input.phase}.`, {
            confirmationId: input.confirmationId,
            phase: input.phase,
            exitCode: result.exitCode,
            stderr: result.stderr,
        });
    }
    const parsed = (0, parsePreview_1.parsePreview)(result.stdout, result.stderr);
    const artifactSeed = JSON.stringify({
        confirmationId: input.confirmationId,
        phase: input.phase,
        planHash: input.planHash,
        layout: input.layout,
        runtime: input.runtime,
    });
    const artifact = (0, ids_1.createArtifactMetadata)('execution', artifactSeed, {
        layout: input.layout,
        phase: input.phase,
        planHash: input.planHash,
        destructive: true,
    });
    (0, artifacts_1.saveExecutionArtifact)({
        artifactId: artifact.artifactId,
        confirmationId: input.confirmationId,
        planArtifactId: confirmation.planArtifactId,
        previewArtifactId: confirmation.previewArtifactId,
        planHash: input.planHash,
        layout: input.layout,
        phase: input.phase,
        status: 'completed',
        exitCode: result.exitCode,
        warnings: parsed.warnings,
        createdAt: artifact.createdAt,
    });
    return {
        phase: 'execute',
        status: 'completed',
        confirmationId: input.confirmationId,
        planHash: input.planHash,
        planArtifactId: confirmation.planArtifactId,
        previewArtifactId: confirmation.previewArtifactId,
        exitCode: result.exitCode,
        warnings: parsed.warnings,
        artifactId: artifact.artifactId,
    };
}
