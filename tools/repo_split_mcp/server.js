"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRepoSplitMcpServer = createRepoSplitMcpServer;
exports.startRepoSplitMcpServer = startRepoSplitMcpServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const zod_1 = require("zod");
const errors_1 = require("./errors");
const artifactResources_1 = require("./resources/artifactResources");
const lookup_1 = require("./resources/lookup");
const planBackend_1 = require("./tools/planBackend");
const previewBackend_1 = require("./tools/previewBackend");
const toolSurface_1 = require("./toolSurface");
const artifactLookup_1 = require("./tools/artifactLookup");
const planInputSchema = zod_1.z.object({
    layout: zod_1.z.enum(['recommended', 'minimal']),
    includeDeferred: zod_1.z.boolean().optional(),
    format: zod_1.z.enum(['json', 'summary']).optional(),
});
const runtimeSchema = zod_1.z
    .object({
    sourceRoot: zod_1.z.string().optional(),
    destinationRoot: zod_1.z.string().optional(),
    tempRoot: zod_1.z.string().optional(),
})
    .optional();
const previewInputSchema = zod_1.z.object({
    layout: zod_1.z.enum(['recommended', 'minimal']),
    planArtifactId: zod_1.z.string().optional(),
    planHash: zod_1.z.string().optional(),
    phase: zod_1.z.enum(['copy', 'filter-repo', 'archive']),
    excludedAction: zod_1.z.enum(['keep', 'archive', 'delete']).optional(),
    remoteScheme: zod_1.z.enum(['https', 'ssh']).optional(),
    runtime: runtimeSchema,
});
const createConfirmationInputSchema = zod_1.z.object({
    layout: zod_1.z.enum(['recommended', 'minimal']),
    phase: zod_1.z.enum(['copy', 'filter-repo', 'archive']),
    planHash: zod_1.z.string(),
    planArtifactId: zod_1.z.string().optional(),
    reason: zod_1.z.string(),
    previewArtifactId: zod_1.z.string().optional(),
    ttlMinutes: zod_1.z.number().int().positive().optional(),
    scope: zod_1.z.enum(['copy', 'filter-repo', 'archive', 'full-run']).optional(),
});
const executeConfirmedInputSchema = zod_1.z.object({
    confirmationId: zod_1.z.string(),
    phase: zod_1.z.enum(['copy', 'filter-repo', 'archive']),
    planHash: zod_1.z.string(),
    layout: zod_1.z.enum(['recommended', 'minimal']),
    previewArtifactId: zod_1.z.string().optional(),
    runtime: runtimeSchema,
    excludedAction: zod_1.z.enum(['keep', 'archive', 'delete']).optional(),
    remoteScheme: zod_1.z.enum(['https', 'ssh']).optional(),
});
const artifactLookupInputSchema = zod_1.z.object({
    artifactId: zod_1.z.string(),
});
function asToolResult(payload) {
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(payload, null, 2),
            },
        ],
    };
}
function asToolError(error) {
    return {
        content: [
            {
                type: 'text',
                text: (0, errors_1.formatRepoSplitError)(error),
            },
        ],
        isError: true,
    };
}
function registerRepoSplitResources(server) {
    for (const resource of (0, lookup_1.listStaticResources)()) {
        server.registerResource(resource.uri.replace(/[^a-z0-9]+/gi, '_'), resource.uri, {
            title: resource.title,
            description: resource.summary,
            mimeType: resource.mimeType,
        }, async (uri) => {
            const resolved = (0, lookup_1.lookupStaticResource)(uri.toString());
            return {
                contents: [
                    {
                        uri: resolved.uri,
                        mimeType: resolved.mimeType,
                        text: resolved.content,
                    },
                ],
            };
        });
    }
    for (const resource of artifactResources_1.artifactResourceDefinitions) {
        server.registerResource(resource.name, new mcp_js_1.ResourceTemplate(resource.uriTemplate, {
            list: async () => ({ resources: [] }),
        }), {
            title: resource.title,
            description: resource.summary,
            mimeType: resource.mimeType,
        }, async (uri, _variables, _extra) => {
            const resolved = (0, artifactResources_1.lookupArtifactResource)(uri.toString());
            return {
                contents: [
                    {
                        uri: resolved.uri,
                        mimeType: resolved.mimeType,
                        text: resolved.content,
                    },
                ],
            };
        });
    }
}
async function createRepoSplitMcpServer() {
    const server = new mcp_js_1.McpServer({
        name: 'repo-split-mcp',
        version: '0.1.0',
    });
    registerRepoSplitResources(server);
    const toolSurface = (0, toolSurface_1.createRepoSplitToolSurface)({
        planBackend: new planBackend_1.PowerShellRepoSplitPlanBackend(),
        previewBackend: new previewBackend_1.PowerShellRepoSplitPreviewBackend(),
    });
    server.registerTool('repo_split.plan', {
        title: 'Repo Split Plan',
        description: 'Generate a normalized repository split plan and store a plan artifact.',
        inputSchema: planInputSchema,
    }, async (input, _extra) => {
        try {
            return asToolResult(await toolSurface['repo_split.plan'](input));
        }
        catch (error) {
            return asToolError(error);
        }
    });
    server.registerTool('repo_split.preview', {
        title: 'Repo Split Preview',
        description: 'Run a non-destructive preview of a repo split phase and store a preview artifact.',
        inputSchema: previewInputSchema,
    }, async (input, _extra) => {
        try {
            return asToolResult(await toolSurface['repo_split.preview'](input));
        }
        catch (error) {
            return asToolError(error);
        }
    });
    server.registerTool('repo_split.create_confirmation', {
        title: 'Create Repo Split Confirmation',
        description: 'Create a phase-scoped confirmation token for destructive repo split execution.',
        inputSchema: createConfirmationInputSchema,
    }, async (input, _extra) => {
        try {
            return asToolResult(toolSurface['repo_split.create_confirmation'](input));
        }
        catch (error) {
            return asToolError(error);
        }
    });
    server.registerTool('repo_split.execute_confirmed', {
        title: 'Execute Confirmed Repo Split Phase',
        description: 'Execute a repo split phase only when confirmation, plan hash, and preview artifact all match.',
        inputSchema: executeConfirmedInputSchema,
    }, async (input, _extra) => {
        try {
            return asToolResult(await toolSurface['repo_split.execute_confirmed'](input));
        }
        catch (error) {
            return asToolError(error);
        }
    });
    server.registerTool('repo_split.get_plan_artifact', {
        title: 'Get Plan Artifact',
        description: 'Look up a stored repo split plan artifact by artifact ID.',
        inputSchema: artifactLookupInputSchema,
    }, async (input, _extra) => {
        try {
            return asToolResult((0, artifactLookup_1.getPlanArtifactById)(input));
        }
        catch (error) {
            return asToolError(error);
        }
    });
    server.registerTool('repo_split.get_preview_artifact', {
        title: 'Get Preview Artifact',
        description: 'Look up a stored repo split preview artifact by artifact ID.',
        inputSchema: artifactLookupInputSchema,
    }, async (input, _extra) => {
        try {
            return asToolResult((0, artifactLookup_1.getPreviewArtifactById)(input));
        }
        catch (error) {
            return asToolError(error);
        }
    });
    server.registerTool('repo_split.get_execution_artifact', {
        title: 'Get Execution Artifact',
        description: 'Look up a stored repo split execution artifact by artifact ID.',
        inputSchema: artifactLookupInputSchema,
    }, async (input, _extra) => {
        try {
            return asToolResult((0, artifactLookup_1.getExecutionArtifactById)(input));
        }
        catch (error) {
            return asToolError(error);
        }
    });
    return server;
}
async function startRepoSplitMcpServer() {
    const server = await createRepoSplitMcpServer();
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
}
