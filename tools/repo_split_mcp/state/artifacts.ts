import type { PlanEntry } from '../schemas/planEntry';
import type { PreviewOperation, PreviewPhase } from '../schemas/previewOperation';
import type { RepoSplitLayout } from '../tools/plan';

export interface PlanArtifact {
  artifactId: string;
  layout: RepoSplitLayout;
  planHash: string;
  entries: PlanEntry[];
  counts: {
    confirmed: number;
    deferred: number;
    excluded: number;
  };
  warnings: string[];
  requiredRepos: string[];
  createdAt: string;
}

export interface PreviewArtifact {
  artifactId: string;
  planArtifactId?: string;
  planHash?: string;
  layout: RepoSplitLayout;
  phase: PreviewPhase;
  status: 'ok' | 'degraded' | 'failed';
  repos: string[];
  paths: string[];
  operations: PreviewOperation[];
  warnings: string[];
  counts: {
    operations: number;
    repos: number;
    paths: number;
  };
  createdAt: string;
}

export interface ExecutionArtifact {
  artifactId: string;
  confirmationId: string;
  planArtifactId?: string;
  previewArtifactId?: string;
  planHash: string;
  layout: RepoSplitLayout;
  phase: PreviewPhase;
  status: 'completed' | 'failed';
  exitCode: number;
  warnings: string[];
  createdAt: string;
}

const planArtifacts = new Map<string, PlanArtifact>();
const previewArtifacts = new Map<string, PreviewArtifact>();
const executionArtifacts = new Map<string, ExecutionArtifact>();

export function savePlanArtifact(artifact: PlanArtifact): PlanArtifact {
  planArtifacts.set(artifact.artifactId, artifact);
  return artifact;
}

export function getPlanArtifact(artifactId: string): PlanArtifact | undefined {
  return planArtifacts.get(artifactId);
}

export function listPlanArtifacts(): PlanArtifact[] {
  return [...planArtifacts.values()];
}

export function savePreviewArtifact(artifact: PreviewArtifact): PreviewArtifact {
  previewArtifacts.set(artifact.artifactId, artifact);
  return artifact;
}

export function getPreviewArtifact(artifactId: string): PreviewArtifact | undefined {
  return previewArtifacts.get(artifactId);
}

export function listPreviewArtifacts(): PreviewArtifact[] {
  return [...previewArtifacts.values()];
}

export function saveExecutionArtifact(artifact: ExecutionArtifact): ExecutionArtifact {
  executionArtifacts.set(artifact.artifactId, artifact);
  return artifact;
}

export function getExecutionArtifact(artifactId: string): ExecutionArtifact | undefined {
  return executionArtifacts.get(artifactId);
}

export function listExecutionArtifacts(): ExecutionArtifact[] {
  return [...executionArtifacts.values()];
}
