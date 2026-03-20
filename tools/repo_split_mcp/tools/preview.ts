import { createArtifactMetadata } from '../artifacts/ids';
import type { PreviewOperation, PreviewPhase } from '../schemas/previewOperation';
import type { RepoSplitRuntimeContext } from '../internal/scriptRuntime';
import { savePreviewArtifact } from '../state/artifacts';

export type RepoSplitExcludedAction = 'keep' | 'archive' | 'delete';
export type RepoSplitRemoteScheme = 'https' | 'ssh';

export interface RepoSplitPreviewInput {
  layout: 'recommended' | 'minimal';
  planArtifactId?: string;
  planHash?: string;
  phase: PreviewPhase;
  excludedAction?: RepoSplitExcludedAction;
  remoteScheme?: RepoSplitRemoteScheme;
  runtime?: RepoSplitRuntimeContext;
}

export interface RepoSplitPreviewOutput {
  phase: PreviewPhase;
  operations: PreviewOperation[];
  repos: string[];
  paths: string[];
  status: 'ok' | 'degraded' | 'failed';
  counts: {
    total: number;
    byTargetRepo: Record<string, number>;
    repos: number;
    paths: number;
  };
  warnings: string[];
  destructive: false;
  artifactId: string;
}

export interface RepoSplitPreviewBackend {
  loadPreview(input: RepoSplitPreviewInput): Promise<{
    operations: PreviewOperation[];
    warnings?: string[];
    repos?: string[];
    paths?: string[];
    status?: 'ok' | 'degraded' | 'failed';
  }>;
}

export async function buildRepoSplitPreview(
  input: RepoSplitPreviewInput,
  backend: RepoSplitPreviewBackend
): Promise<RepoSplitPreviewOutput> {
  const preview = await backend.loadPreview(input);
  const operations = preview.operations;
  const counts = operations.reduce<RepoSplitPreviewOutput['counts']>(
    (accumulator, operation) => {
      const key = operation.targetRepo || 'excluded';
      accumulator.total += 1;
      accumulator.byTargetRepo[key] = (accumulator.byTargetRepo[key] || 0) + 1;
      return accumulator;
    },
    { total: 0, byTargetRepo: {}, repos: 0, paths: 0 }
  );

  const warnings = [...(preview.warnings || []), ...operations.flatMap((operation) => operation.warnings || [])];
  const repos = preview.repos || [...new Set(operations.map((operation) => operation.targetRepo).filter(Boolean))];
  const paths = preview.paths || [...new Set(operations.map((operation) => `${operation.sourcePath} -> ${operation.targetPath}`))];
  counts.repos = repos.length;
  counts.paths = paths.length;
  const artifactSeed = JSON.stringify({
    layout: input.layout,
    phase: input.phase,
    excludedAction: input.excludedAction || 'keep',
    remoteScheme: input.remoteScheme || 'https',
    runtime: input.runtime,
    operations,
  });

  const status = preview.status || (warnings.length > 0 ? 'degraded' : 'ok');
  const artifact = createArtifactMetadata('preview', artifactSeed, {
    layout: input.layout,
    phase: input.phase,
    planHash: input.planHash,
    destructive: false,
  });

  savePreviewArtifact({
    artifactId: artifact.artifactId,
    planArtifactId: input.planArtifactId,
    planHash: input.planHash,
    layout: input.layout,
    phase: input.phase,
    status,
    repos,
    paths,
    operations,
    warnings,
    counts: {
      operations: counts.total,
      repos: counts.repos,
      paths: counts.paths,
    },
    createdAt: artifact.createdAt,
  });

  return {
    phase: input.phase,
    operations,
    repos,
    paths,
    status,
    counts,
    warnings,
    destructive: false,
    artifactId: artifact.artifactId,
  };
}
