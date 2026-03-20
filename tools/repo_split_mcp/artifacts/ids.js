"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARTIFACT_KINDS = void 0;
exports.buildArtifactId = buildArtifactId;
exports.createArtifactMetadata = createArtifactMetadata;
const node_crypto_1 = require("node:crypto");
exports.ARTIFACT_KINDS = ['plan', 'preview', 'execution', 'log'];
function sanitizeTimestamp(timestamp) {
    return timestamp.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}
function buildArtifactId(kind, seed, createdAt = new Date().toISOString()) {
    const shortHash = (0, node_crypto_1.createHash)('sha256').update(seed).digest('hex').slice(0, 6);
    return `repo-split/${kind}/${sanitizeTimestamp(createdAt)}-${shortHash}`;
}
function createArtifactMetadata(kind, seed, partial = {}) {
    const createdAt = new Date().toISOString();
    return {
        artifactId: buildArtifactId(kind, seed, createdAt),
        kind,
        createdAt,
        ...partial,
    };
}
