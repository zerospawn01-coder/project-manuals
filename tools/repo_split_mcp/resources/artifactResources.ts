import {
  getExecutionArtifactById,
  getPlanArtifactById,
  getPreviewArtifactById,
  type RepoSplitArtifactKind,
} from '../tools/artifactLookup';

export interface ArtifactResourceDefinition {
  name: string;
  kind: RepoSplitArtifactKind;
  uriTemplate: string;
  title: string;
  mimeType: 'application/json';
  summary: string;
}

export interface ArtifactResourceLookupResult {
  uri: string;
  kind: RepoSplitArtifactKind;
  title: string;
  mimeType: 'application/json';
  content: string;
}

const artifactResourceDefinitionMap: Record<RepoSplitArtifactKind, ArtifactResourceDefinition> = {
  plan: {
    name: 'repo_split.plan_artifact_resource',
    kind: 'plan',
    uriTemplate: 'repo-split://artifact/plan/{artifactId}',
    title: 'Repo Split Plan Artifact',
    mimeType: 'application/json',
    summary: 'Read a stored repo split plan artifact by URL-encoded artifact ID.',
  },
  preview: {
    name: 'repo_split.preview_artifact_resource',
    kind: 'preview',
    uriTemplate: 'repo-split://artifact/preview/{artifactId}',
    title: 'Repo Split Preview Artifact',
    mimeType: 'application/json',
    summary: 'Read a stored repo split preview artifact by URL-encoded artifact ID.',
  },
  execution: {
    name: 'repo_split.execution_artifact_resource',
    kind: 'execution',
    uriTemplate: 'repo-split://artifact/execution/{artifactId}',
    title: 'Repo Split Execution Artifact',
    mimeType: 'application/json',
    summary: 'Read a stored repo split execution artifact by URL-encoded artifact ID.',
  },
};

export const artifactResourceDefinitions = Object.values(artifactResourceDefinitionMap);

export function buildArtifactResourceUri(kind: RepoSplitArtifactKind, artifactId: string): string {
  return `repo-split://artifact/${kind}/${encodeURIComponent(artifactId)}`;
}

export function lookupArtifactResource(uri: string): ArtifactResourceLookupResult {
  const match = /^repo-split:\/\/artifact\/(plan|preview|execution)\/(.+)$/.exec(uri);
  if (!match) {
    throw new Error(`Unknown repo split artifact resource: ${uri}`);
  }

  const [, kind, encodedArtifactId] = match;
  const artifactId = decodeURIComponent(encodedArtifactId);
  const definition = artifactResourceDefinitionMap[kind as RepoSplitArtifactKind];
  const payload =
    kind === 'plan'
      ? getPlanArtifactById({ artifactId })
      : kind === 'preview'
        ? getPreviewArtifactById({ artifactId })
        : getExecutionArtifactById({ artifactId });

  return {
    uri,
    kind: payload.kind,
    title: definition.title,
    mimeType: definition.mimeType,
    content: JSON.stringify(payload, null, 2),
  };
}