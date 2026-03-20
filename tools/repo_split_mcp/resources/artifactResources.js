"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.artifactResourceDefinitions = void 0;
exports.buildArtifactResourceUri = buildArtifactResourceUri;
exports.lookupArtifactResource = lookupArtifactResource;
const artifactLookup_1 = require("../tools/artifactLookup");
const artifactResourceDefinitionMap = {
    plan: {
        name: 'repo_split.plan_artifact_resource',
        kind: 'plan',
        uriTemplate: 'repo-split://artifact/plan/{artifactId}',
        title: 'Repo Split Plan Artifact',
        mimeType: 'application/json',
        summary: 'Read a stored repo split plan artifact by URL-encoded artifact ID.',
    },
    preview: {
        name: 'repo_split.preview_artifact_resource',
        kind: 'preview',
        uriTemplate: 'repo-split://artifact/preview/{artifactId}',
        title: 'Repo Split Preview Artifact',
        mimeType: 'application/json',
        summary: 'Read a stored repo split preview artifact by URL-encoded artifact ID.',
    },
    execution: {
        name: 'repo_split.execution_artifact_resource',
        kind: 'execution',
        uriTemplate: 'repo-split://artifact/execution/{artifactId}',
        title: 'Repo Split Execution Artifact',
        mimeType: 'application/json',
        summary: 'Read a stored repo split execution artifact by URL-encoded artifact ID.',
    },
};
exports.artifactResourceDefinitions = Object.values(artifactResourceDefinitionMap);
function buildArtifactResourceUri(kind, artifactId) {
    return `repo-split://artifact/${kind}/${encodeURIComponent(artifactId)}`;
}
function lookupArtifactResource(uri) {
    const match = /^repo-split:\/\/artifact\/(plan|preview|execution)\/(.+)$/.exec(uri);
    if (!match) {
        throw new Error(`Unknown repo split artifact resource: ${uri}`);
    }
    const [, kind, encodedArtifactId] = match;
    const artifactId = decodeURIComponent(encodedArtifactId);
    const definition = artifactResourceDefinitionMap[kind];
    const payload = kind === 'plan'
        ? (0, artifactLookup_1.getPlanArtifactById)({ artifactId })
        : kind === 'preview'
            ? (0, artifactLookup_1.getPreviewArtifactById)({ artifactId })
            : (0, artifactLookup_1.getExecutionArtifactById)({ artifactId });
    return {
        uri,
        kind: payload.kind,
        title: definition.title,
        mimeType: definition.mimeType,
        content: JSON.stringify(payload, null, 2),
    };
}
