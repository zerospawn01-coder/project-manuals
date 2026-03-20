import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { formatRepoSplitError } from './errors';
import {
  artifactResourceDefinitions,
  lookupArtifactResource,
} from './resources/artifactResources';
import { listStaticResources, lookupStaticResource } from './resources/lookup';
import { PowerShellRepoSplitPlanBackend } from './tools/planBackend';
import { PowerShellRepoSplitPreviewBackend } from './tools/previewBackend';
import { createRepoSplitToolSurface } from './toolSurface';
import {
  getExecutionArtifactById,
  getPlanArtifactById,
  getPreviewArtifactById,
} from './tools/artifactLookup';

const planInputSchema = z.object({
  layout: z.enum(['recommended', 'minimal']),
  includeDeferred: z.boolean().optional(),
  format: z.enum(['json', 'summary']).optional(),
});

const runtimeSchema = z
  .object({
    sourceRoot: z.string().optional(),
    destinationRoot: z.string().optional(),
    tempRoot: z.string().optional(),
  })
  .optional();

const previewInputSchema = z.object({
  layout: z.enum(['recommended', 'minimal']),
  planArtifactId: z.string().optional(),
  planHash: z.string().optional(),
  phase: z.enum(['copy', 'filter-repo', 'archive']),
  excludedAction: z.enum(['keep', 'archive', 'delete']).optional(),
  remoteScheme: z.enum(['https', 'ssh']).optional(),
  runtime: runtimeSchema,
});

const createConfirmationInputSchema = z.object({
  layout: z.enum(['recommended', 'minimal']),
  phase: z.enum(['copy', 'filter-repo', 'archive']),
  planHash: z.string(),
  planArtifactId: z.string().optional(),
  reason: z.string(),
  previewArtifactId: z.string().optional(),
  ttlMinutes: z.number().int().positive().optional(),
  scope: z.enum(['copy', 'filter-repo', 'archive', 'full-run']).optional(),
});

const executeConfirmedInputSchema = z.object({
  confirmationId: z.string(),
  phase: z.enum(['copy', 'filter-repo', 'archive']),
  planHash: z.string(),
  layout: z.enum(['recommended', 'minimal']),
  previewArtifactId: z.string().optional(),
  runtime: runtimeSchema,
  excludedAction: z.enum(['keep', 'archive', 'delete']).optional(),
  remoteScheme: z.enum(['https', 'ssh']).optional(),
});

const artifactLookupInputSchema = z.object({
  artifactId: z.string(),
});

function asToolResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function asToolError(error: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: formatRepoSplitError(error),
      },
    ],
    isError: true,
  };
}

function registerRepoSplitResources(server: McpServer) {
  for (const resource of listStaticResources()) {
    server.registerResource(
      resource.uri.replace(/[^a-z0-9]+/gi, '_'),
      resource.uri,
      {
        title: resource.title,
        description: resource.summary,
        mimeType: resource.mimeType,
      },
      async (uri) => {
        const resolved = lookupStaticResource(uri.toString());
        return {
          contents: [
            {
              uri: resolved.uri,
              mimeType: resolved.mimeType,
              text: resolved.content,
            },
          ],
        };
      }
    );
  }

  for (const resource of artifactResourceDefinitions) {
    server.registerResource(
      resource.name,
      new ResourceTemplate(resource.uriTemplate, {
        list: async () => ({ resources: [] }),
      }),
      {
        title: resource.title,
        description: resource.summary,
        mimeType: resource.mimeType,
      },
      async (uri, _variables, _extra) => {
        const resolved = lookupArtifactResource(uri.toString());
        return {
          contents: [
            {
              uri: resolved.uri,
              mimeType: resolved.mimeType,
              text: resolved.content,
            },
          ],
        };
      }
    );
  }
}

export async function createRepoSplitMcpServer() {
  const server = new McpServer({
    name: 'repo-split-mcp',
    version: '0.1.0',
  });

  registerRepoSplitResources(server);

  const toolSurface = createRepoSplitToolSurface({
    planBackend: new PowerShellRepoSplitPlanBackend(),
    previewBackend: new PowerShellRepoSplitPreviewBackend(),
  });

  server.registerTool(
    'repo_split.plan',
    {
      title: 'Repo Split Plan',
      description: 'Generate a normalized repository split plan and store a plan artifact.',
      inputSchema: planInputSchema,
    },
    async (input, _extra) => {
      try {
        return asToolResult(await toolSurface['repo_split.plan'](input));
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  server.registerTool(
    'repo_split.preview',
    {
      title: 'Repo Split Preview',
      description: 'Run a non-destructive preview of a repo split phase and store a preview artifact.',
      inputSchema: previewInputSchema,
    },
    async (input, _extra) => {
      try {
        return asToolResult(await toolSurface['repo_split.preview'](input));
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  server.registerTool(
    'repo_split.create_confirmation',
    {
      title: 'Create Repo Split Confirmation',
      description: 'Create a phase-scoped confirmation token for destructive repo split execution.',
      inputSchema: createConfirmationInputSchema,
    },
    async (input, _extra) => {
      try {
        return asToolResult(toolSurface['repo_split.create_confirmation'](input));
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  server.registerTool(
    'repo_split.execute_confirmed',
    {
      title: 'Execute Confirmed Repo Split Phase',
      description: 'Execute a repo split phase only when confirmation, plan hash, and preview artifact all match.',
      inputSchema: executeConfirmedInputSchema,
    },
    async (input, _extra) => {
      try {
        return asToolResult(await toolSurface['repo_split.execute_confirmed'](input));
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  server.registerTool(
    'repo_split.get_plan_artifact',
    {
      title: 'Get Plan Artifact',
      description: 'Look up a stored repo split plan artifact by artifact ID.',
      inputSchema: artifactLookupInputSchema,
    },
    async (input, _extra) => {
      try {
        return asToolResult(getPlanArtifactById(input));
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  server.registerTool(
    'repo_split.get_preview_artifact',
    {
      title: 'Get Preview Artifact',
      description: 'Look up a stored repo split preview artifact by artifact ID.',
      inputSchema: artifactLookupInputSchema,
    },
    async (input, _extra) => {
      try {
        return asToolResult(getPreviewArtifactById(input));
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  server.registerTool(
    'repo_split.get_execution_artifact',
    {
      title: 'Get Execution Artifact',
      description: 'Look up a stored repo split execution artifact by artifact ID.',
      inputSchema: artifactLookupInputSchema,
    },
    async (input, _extra) => {
      try {
        return asToolResult(getExecutionArtifactById(input));
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  return server;
}

export async function startRepoSplitMcpServer() {
  const server = await createRepoSplitMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
