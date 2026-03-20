"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_path_1 = __importDefault(require("node:path"));
const node_process_1 = __importDefault(require("node:process"));
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
const artifactResources_1 = require("./resources/artifactResources");
function normalizeWindowsPath(value) {
    return value.replace(/^\\\\\?\\/, '');
}
function getRepoRoot() {
    return normalizeWindowsPath(node_path_1.default.resolve(__dirname, '..', '..'));
}
function parseToolPayload(result) {
    const toolResult = result;
    const textItem = toolResult.content?.find((entry) => entry.type === 'text' && typeof entry.text === 'string');
    (0, strict_1.default)(textItem, 'Expected text content in tool response');
    if (toolResult.isError) {
        return { error: textItem.text };
    }
    return JSON.parse(textItem.text);
}
async function main() {
    const repoRoot = getRepoRoot();
    const launchPath = node_path_1.default.join(repoRoot, 'tools', 'repo_split_mcp', 'launch.js');
    const transport = new stdio_js_1.StdioClientTransport({
        command: node_process_1.default.execPath,
        args: [launchPath],
        cwd: repoRoot,
        stderr: 'pipe',
    });
    const stderrChunks = [];
    transport.stderr?.on('data', (chunk) => {
        stderrChunks.push(String(chunk));
    });
    const client = new index_js_1.Client({ name: 'repo-split-smoke-test', version: '0.1.0' }, { capabilities: {} });
    try {
        await client.connect(transport);
        const toolNames = (await client.listTools()).tools.map((tool) => tool.name).sort();
        const staticResources = (await client.listResources()).resources.map((resource) => resource.uri).sort();
        const resourceTemplates = (await client.listResourceTemplates()).resourceTemplates
            .map((resource) => resource.uriTemplate)
            .sort();
        (0, strict_1.default)(toolNames.includes('repo_split.plan'));
        (0, strict_1.default)(toolNames.includes('repo_split.preview'));
        (0, strict_1.default)(toolNames.includes('repo_split.create_confirmation'));
        (0, strict_1.default)(toolNames.includes('repo_split.execute_confirmed'));
        (0, strict_1.default)(staticResources.includes('repo-split://guide/client-quickstart'));
        (0, strict_1.default)(resourceTemplates.includes('repo-split://artifact/plan/{artifactId}'));
        (0, strict_1.default)(resourceTemplates.includes('repo-split://artifact/preview/{artifactId}'));
        (0, strict_1.default)(resourceTemplates.includes('repo-split://artifact/execution/{artifactId}'));
        const planResult = await client.callTool({
            name: 'repo_split.plan',
            arguments: { layout: 'recommended', format: 'summary' },
        });
        const plan = parseToolPayload(planResult);
        const previewResult = await client.callTool({
            name: 'repo_split.preview',
            arguments: {
                layout: 'recommended',
                phase: 'copy',
                planArtifactId: plan.artifactId,
                planHash: plan.planHash,
            },
        });
        const preview = parseToolPayload(previewResult);
        const confirmationResult = await client.callTool({
            name: 'repo_split.create_confirmation',
            arguments: {
                layout: 'recommended',
                phase: 'copy',
                reason: 'Smoke test confirmation',
                planHash: plan.planHash,
                planArtifactId: plan.artifactId,
                previewArtifactId: preview.artifactId,
            },
        });
        const confirmationPayload = parseToolPayload(confirmationResult);
        const guardFailureResult = await client.callTool({
            name: 'repo_split.execute_confirmed',
            arguments: {
                confirmationId: confirmationPayload.confirmation.confirmationId,
                phase: 'copy',
                layout: 'recommended',
                planHash: `${plan.planHash}-mismatch`,
                previewArtifactId: preview.artifactId,
            },
        });
        const guardFailure = parseToolPayload(guardFailureResult);
        const planArtifactResource = await client.readResource({
            uri: (0, artifactResources_1.buildArtifactResourceUri)('plan', plan.artifactId),
        });
        const previewArtifactResource = await client.readResource({
            uri: (0, artifactResources_1.buildArtifactResourceUri)('preview', preview.artifactId),
        });
        const summary = {
            tools: toolNames,
            staticResources,
            resourceTemplates,
            planArtifactId: plan.artifactId,
            previewArtifactId: preview.artifactId,
            confirmationId: confirmationPayload.confirmation.confirmationId,
            guardFailure: guardFailure.error,
            planArtifactResourceRead: planArtifactResource.contents[0]?.uri ?? null,
            previewArtifactResourceRead: previewArtifactResource.contents[0]?.uri ?? null,
            stderr: stderrChunks.join('').trim() || null,
        };
        console.log(JSON.stringify(summary, null, 2));
    }
    finally {
        await client.close();
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    node_process_1.default.exit(1);
});
