"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRepoSplitPreview = buildRepoSplitPreview;
const ids_1 = require("../artifacts/ids");
const artifacts_1 = require("../state/artifacts");
async function buildRepoSplitPreview(input, backend) {
    const preview = await backend.loadPreview(input);
    const operations = preview.operations;
    const counts = operations.reduce((accumulator, operation) => {
        const key = operation.targetRepo || 'excluded';
        accumulator.total += 1;
        accumulator.byTargetRepo[key] = (accumulator.byTargetRepo[key] || 0) + 1;
        return accumulator;
    }, { total: 0, byTargetRepo: {}, repos: 0, paths: 0 });
    const warnings = [...(preview.warnings || []), ...operations.flatMap((operation) => operation.warnings || [])];
    const repos = preview.repos || [...new Set(operations.map((operation) => operation.targetRepo).filter(Boolean))];
    const paths = preview.paths || [...new Set(operations.map((operation) => `${operation.sourcePath} -> ${operation.targetPath}`))];
    counts.repos = repos.length;
    counts.paths = paths.length;
    const artifactSeed = JSON.stringify({
        layout: input.layout,
        phase: input.phase,
        excludedAction: input.excludedAction || 'keep',
        remoteScheme: input.remoteScheme || 'https',
        runtime: input.runtime,
        operations,
    });
    const status = preview.status || (warnings.length > 0 ? 'degraded' : 'ok');
    const artifact = (0, ids_1.createArtifactMetadata)('preview', artifactSeed, {
        layout: input.layout,
        phase: input.phase,
        planHash: input.planHash,
        destructive: false,
    });
    (0, artifacts_1.savePreviewArtifact)({
        artifactId: artifact.artifactId,
        planArtifactId: input.planArtifactId,
        planHash: input.planHash,
        layout: input.layout,
        phase: input.phase,
        status,
        repos,
        paths,
        operations,
        warnings,
        counts: {
            operations: counts.total,
            repos: counts.repos,
            paths: counts.paths,
        },
        createdAt: artifact.createdAt,
    });
    return {
        phase: input.phase,
        operations,
        repos,
        paths,
        status,
        counts,
        warnings,
        destructive: false,
        artifactId: artifact.artifactId,
    };
}
