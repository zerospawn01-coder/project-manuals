"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.savePlanArtifact = savePlanArtifact;
exports.getPlanArtifact = getPlanArtifact;
exports.listPlanArtifacts = listPlanArtifacts;
exports.savePreviewArtifact = savePreviewArtifact;
exports.getPreviewArtifact = getPreviewArtifact;
exports.listPreviewArtifacts = listPreviewArtifacts;
exports.saveExecutionArtifact = saveExecutionArtifact;
exports.getExecutionArtifact = getExecutionArtifact;
exports.listExecutionArtifacts = listExecutionArtifacts;
const planArtifacts = new Map();
const previewArtifacts = new Map();
const executionArtifacts = new Map();
function savePlanArtifact(artifact) {
    planArtifacts.set(artifact.artifactId, artifact);
    return artifact;
}
function getPlanArtifact(artifactId) {
    return planArtifacts.get(artifactId);
}
function listPlanArtifacts() {
    return [...planArtifacts.values()];
}
function savePreviewArtifact(artifact) {
    previewArtifacts.set(artifact.artifactId, artifact);
    return artifact;
}
function getPreviewArtifact(artifactId) {
    return previewArtifacts.get(artifactId);
}
function listPreviewArtifacts() {
    return [...previewArtifacts.values()];
}
function saveExecutionArtifact(artifact) {
    executionArtifacts.set(artifact.artifactId, artifact);
    return artifact;
}
function getExecutionArtifact(artifactId) {
    return executionArtifacts.get(artifactId);
}
function listExecutionArtifacts() {
    return [...executionArtifacts.values()];
}
