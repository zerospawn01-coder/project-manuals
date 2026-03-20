import {
  getExecutionArtifact,
  getPlanArtifact,
  getPreviewArtifact,
  type ExecutionArtifact,
  type PlanArtifact,
  type PreviewArtifact,
} from '../state/artifacts';
import { RepoSplitError } from '../errors';

export type RepoSplitArtifactKind = 'plan' | 'preview' | 'execution';

export interface GetArtifactInput {
  artifactId: string;
}

export interface ArtifactLookupOutput {
  kind: RepoSplitArtifactKind;
  artifact: PlanArtifact | PreviewArtifact | ExecutionArtifact;
}

export function getPlanArtifactById(input: GetArtifactInput): ArtifactLookupOutput {
  const artifact = getPlanArtifact(input.artifactId);
  if (!artifact) {
    throw new RepoSplitError('PLAN_ARTIFACT_NOT_FOUND', `Plan artifact not found: ${input.artifactId}`, {
      artifactId: input.artifactId,
      kind: 'plan',
    });
  }

  return { kind: 'plan', artifact };
}

export function getPreviewArtifactById(input: GetArtifactInput): ArtifactLookupOutput {
  const artifact = getPreviewArtifact(input.artifactId);
  if (!artifact) {
    throw new RepoSplitError('PREVIEW_ARTIFACT_NOT_FOUND', `Preview artifact not found: ${input.artifactId}`, {
      artifactId: input.artifactId,
      kind: 'preview',
    });
  }

  return { kind: 'preview', artifact };
}

export function getExecutionArtifactById(input: GetArtifactInput): ArtifactLookupOutput {
  const artifact = getExecutionArtifact(input.artifactId);
  if (!artifact) {
    throw new RepoSplitError('EXECUTION_ARTIFACT_NOT_FOUND', `Execution artifact not found: ${input.artifactId}`, {
      artifactId: input.artifactId,
      kind: 'execution',
    });
  }

  return { kind: 'execution', artifact };
}
