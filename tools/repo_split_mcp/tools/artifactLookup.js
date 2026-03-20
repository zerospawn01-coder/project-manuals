"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlanArtifactById = getPlanArtifactById;
exports.getPreviewArtifactById = getPreviewArtifactById;
exports.getExecutionArtifactById = getExecutionArtifactById;
const artifacts_1 = require("../state/artifacts");
const errors_1 = require("../errors");
function getPlanArtifactById(input) {
    const artifact = (0, artifacts_1.getPlanArtifact)(input.artifactId);
    if (!artifact) {
        throw new errors_1.RepoSplitError('PLAN_ARTIFACT_NOT_FOUND', `Plan artifact not found: ${input.artifactId}`, {
            artifactId: input.artifactId,
            kind: 'plan',
        });
    }
    return { kind: 'plan', artifact };
}
function getPreviewArtifactById(input) {
    const artifact = (0, artifacts_1.getPreviewArtifact)(input.artifactId);
    if (!artifact) {
        throw new errors_1.RepoSplitError('PREVIEW_ARTIFACT_NOT_FOUND', `Preview artifact not found: ${input.artifactId}`, {
            artifactId: input.artifactId,
            kind: 'preview',
        });
    }
    return { kind: 'preview', artifact };
}
function getExecutionArtifactById(input) {
    const artifact = (0, artifacts_1.getExecutionArtifact)(input.artifactId);
    if (!artifact) {
        throw new errors_1.RepoSplitError('EXECUTION_ARTIFACT_NOT_FOUND', `Execution artifact not found: ${input.artifactId}`, {
            artifactId: input.artifactId,
            kind: 'execution',
        });
    }
    return { kind: 'execution', artifact };
}
