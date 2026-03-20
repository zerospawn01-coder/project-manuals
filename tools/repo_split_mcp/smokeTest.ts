import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { buildArtifactResourceUri } from './resources/artifactResources';

interface TextContentItem {
  type: 'text';
  text: string;
}

function normalizeWindowsPath(value: string): string {
  return value.replace(/^\\\\\?\\/, '');
}

function getRepoRoot(): string {
  return normalizeWindowsPath(path.resolve(__dirname, '..', '..'));
}

function parseToolPayload(result: unknown) {
  const toolResult = result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  const textItem = toolResult.content?.find(
    (entry): entry is TextContentItem => entry.type === 'text' && typeof entry.text === 'string'
  );
  assert(textItem, 'Expected text content in tool response');
  if (toolResult.isError) {
    return { error: textItem.text };
  }

  return JSON.parse(textItem.text);
}

async function main() {
  const repoRoot = getRepoRoot();
  const launchPath = path.join(repoRoot, 'tools', 'repo_split_mcp', 'launch.js');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [launchPath],
    cwd: repoRoot,
    stderr: 'pipe',
  });

  const stderrChunks: string[] = [];
  transport.stderr?.on('data', (chunk) => {
    stderrChunks.push(String(chunk));
  });

  const client = new Client(
    { name: 'repo-split-smoke-test', version: '0.1.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);

    const toolNames = (await client.listTools()).tools.map((tool) => tool.name).sort();
    const staticResources = (await client.listResources()).resources.map((resource) => resource.uri).sort();
    const resourceTemplates = (await client.listResourceTemplates()).resourceTemplates
      .map((resource) => resource.uriTemplate)
      .sort();

    assert(toolNames.includes('repo_split.plan'));
    assert(toolNames.includes('repo_split.preview'));
    assert(toolNames.includes('repo_split.create_confirmation'));
    assert(toolNames.includes('repo_split.execute_confirmed'));
    assert(staticResources.includes('repo-split://guide/client-quickstart'));
    assert(resourceTemplates.includes('repo-split://artifact/plan/{artifactId}'));
    assert(resourceTemplates.includes('repo-split://artifact/preview/{artifactId}'));
    assert(resourceTemplates.includes('repo-split://artifact/execution/{artifactId}'));

    const planResult = await client.callTool({
      name: 'repo_split.plan',
      arguments: { layout: 'recommended', format: 'summary' },
    });
    const plan = parseToolPayload(planResult) as { artifactId: string; planHash: string; counts: { confirmed: number } };

    const previewResult = await client.callTool({
      name: 'repo_split.preview',
      arguments: {
        layout: 'recommended',
        phase: 'copy',
        planArtifactId: plan.artifactId,
        planHash: plan.planHash,
      },
    });
    const preview = parseToolPayload(previewResult) as { artifactId: string; phase: string; status: string };

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
    const confirmationPayload = parseToolPayload(confirmationResult) as {
      confirmation: { confirmationId: string };
    };

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
    const guardFailure = parseToolPayload(guardFailureResult) as { error: string };

    const planArtifactResource = await client.readResource({
      uri: buildArtifactResourceUri('plan', plan.artifactId),
    });
    const previewArtifactResource = await client.readResource({
      uri: buildArtifactResourceUri('preview', preview.artifactId),
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
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});