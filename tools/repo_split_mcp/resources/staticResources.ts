import path from 'node:path';

export interface StaticResourceDefinition {
  uri: string;
  title: string;
  filePath: string;
  mimeType: 'text/markdown' | 'application/json';
  summary: string;
}

const repoRoot = path.resolve(__dirname, '../../..');

export const staticResources: StaticResourceDefinition[] = [
  {
    uri: 'repo-split://runbook/main',
    title: 'Repo Split Runbook',
    filePath: path.join(repoRoot, 'REPO_SPLIT_POWERSHELL_RUNBOOK.md'),
    mimeType: 'text/markdown',
    summary: 'Primary runbook for the repository split workflow.',
  },
  {
    uri: 'repo-split://checklist/cognitive-lab-phase1',
    title: 'Cognitive Lab Phase 1 Checklist',
    filePath: path.join(repoRoot, 'COGNITIVE_LAB_PHASE1_CHECKLIST.md'),
    mimeType: 'text/markdown',
    summary: 'Operator checklist for the cognitive-lab split path.',
  },
  {
    uri: 'repo-split://checklist/lab-experiments',
    title: 'Lab Experiments Checklist',
    filePath: path.join(repoRoot, 'LAB_EXPERIMENTS_CHECKLIST.md'),
    mimeType: 'text/markdown',
    summary: 'Operator checklist for the lab-experiments split path.',
  },
  {
    uri: 'repo-split://spec/v0.1',
    title: 'Repo Split MCP v0.1 Spec',
    filePath: path.join(repoRoot, 'REPO_SPLIT_MCP_V0_1_SPEC.md'),
    mimeType: 'text/markdown',
    summary: 'Implementation specification for the first Repo Split MCP release.',
  },
  {
    uri: 'repo-split://guide/client-quickstart',
    title: 'Repo Split MCP Client Quickstart',
    filePath: path.join(repoRoot, 'REPO_SPLIT_MCP_CLIENT_QUICKSTART.md'),
    mimeType: 'text/markdown',
    summary: 'Minimal client configuration and non-destructive connectivity checks for Repo Split MCP.',
  },
];

export function getStaticResourceByUri(uri: string): StaticResourceDefinition | undefined {
  return staticResources.find((resource) => resource.uri === uri);
}
