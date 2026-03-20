"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePlanHash = computePlanHash;
exports.buildRepoSplitPlan = buildRepoSplitPlan;
const node_crypto_1 = require("node:crypto");
const ids_1 = require("../artifacts/ids");
const artifacts_1 = require("../state/artifacts");
function computePlanHash(entries) {
    const normalized = JSON.stringify(entries.map((entry) => ({
        sourcePath: entry.sourcePath,
        category: entry.category,
        targetRepo: entry.targetRepo,
        targetPath: entry.targetPath,
        migrationMode: entry.migrationMode,
        confidence: entry.confidence,
        disposition: entry.disposition,
        notes: entry.notes || '',
    })));
    return (0, node_crypto_1.createHash)('sha256').update(normalized).digest('hex');
}
async function buildRepoSplitPlan(input, backend) {
    const entries = await backend.loadPlan(input);
    const planHash = computePlanHash(entries);
    const requiredRepos = [...new Set(entries.filter((entry) => entry.disposition === 'migrate').map((entry) => entry.targetRepo))];
    const counts = {
        confirmed: entries.filter((entry) => entry.confidence === 'confirmed').length,
        deferred: entries.filter((entry) => entry.disposition === 'deferred').length,
        excluded: entries.filter((entry) => entry.disposition === 'exclude').length,
    };
    const warnings = entries
        .filter((entry) => entry.confidence === 'provisional' || entry.disposition !== 'migrate')
        .map((entry) => `${entry.sourcePath} -> ${entry.disposition}`);
    const artifact = (0, ids_1.createArtifactMetadata)('plan', planHash, {
        layout: input.layout,
        phase: 'plan',
        planHash,
        destructive: false,
    });
    (0, artifacts_1.savePlanArtifact)({
        artifactId: artifact.artifactId,
        layout: input.layout,
        planHash,
        entries,
        counts,
        warnings,
        requiredRepos,
        createdAt: artifact.createdAt,
    });
    return {
        layout: input.layout,
        entries,
        planHash,
        counts,
        requiredRepos,
        warnings,
        artifactId: artifact.artifactId,
    };
}
