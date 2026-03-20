"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.staticResources = void 0;
exports.getStaticResourceByUri = getStaticResourceByUri;
const node_path_1 = __importDefault(require("node:path"));
const repoRoot = node_path_1.default.resolve(__dirname, '../../..');
exports.staticResources = [
    {
        uri: 'repo-split://runbook/main',
        title: 'Repo Split Runbook',
        filePath: node_path_1.default.join(repoRoot, 'REPO_SPLIT_POWERSHELL_RUNBOOK.md'),
        mimeType: 'text/markdown',
        summary: 'Primary runbook for the repository split workflow.',
    },
    {
        uri: 'repo-split://checklist/cognitive-lab-phase1',
        title: 'Cognitive Lab Phase 1 Checklist',
        filePath: node_path_1.default.join(repoRoot, 'COGNITIVE_LAB_PHASE1_CHECKLIST.md'),
        mimeType: 'text/markdown',
        summary: 'Operator checklist for the cognitive-lab split path.',
    },
    {
        uri: 'repo-split://checklist/lab-experiments',
        title: 'Lab Experiments Checklist',
        filePath: node_path_1.default.join(repoRoot, 'LAB_EXPERIMENTS_CHECKLIST.md'),
        mimeType: 'text/markdown',
        summary: 'Operator checklist for the lab-experiments split path.',
    },
    {
        uri: 'repo-split://spec/v0.1',
        title: 'Repo Split MCP v0.1 Spec',
        filePath: node_path_1.default.join(repoRoot, 'REPO_SPLIT_MCP_V0_1_SPEC.md'),
        mimeType: 'text/markdown',
        summary: 'Implementation specification for the first Repo Split MCP release.',
    },
    {
        uri: 'repo-split://guide/client-quickstart',
        title: 'Repo Split MCP Client Quickstart',
        filePath: node_path_1.default.join(repoRoot, 'REPO_SPLIT_MCP_CLIENT_QUICKSTART.md'),
        mimeType: 'text/markdown',
        summary: 'Minimal client configuration and non-destructive connectivity checks for Repo Split MCP.',
    },
];
function getStaticResourceByUri(uri) {
    return exports.staticResources.find((resource) => resource.uri === uri);
}
