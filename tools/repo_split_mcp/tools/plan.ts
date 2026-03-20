import { createHash } from 'node:crypto';
import type { PlanEntry } from '../schemas/planEntry';
import { createArtifactMetadata } from '../artifacts/ids';
import { savePlanArtifact } from '../state/artifacts';

export type RepoSplitLayout = 'recommended' | 'minimal';
export type RepoSplitPlanFormat = 'json' | 'summary';

export interface RepoSplitPlanInput {
  layout: RepoSplitLayout;
  includeDeferred?: boolean;
  format?: RepoSplitPlanFormat;
}

export interface RepoSplitPlanOutput {
  layout: RepoSplitLayout;
  entries: PlanEntry[];
  planHash: string;
  counts: {
    confirmed: number;
    deferred: number;
    excluded: number;
  };
  requiredRepos: string[];
  warnings: string[];
  artifactId: string;
}

export interface RepoSplitPlanBackend {
  loadPlan(input: RepoSplitPlanInput): Promise<PlanEntry[]>;
}

export function computePlanHash(entries: PlanEntry[]): string {
  const normalized = JSON.stringify(
    entries.map((entry) => ({
      sourcePath: entry.sourcePath,
      category: entry.category,
      targetRepo: entry.targetRepo,
      targetPath: entry.targetPath,
      migrationMode: entry.migrationMode,
      confidence: entry.confidence,
      disposition: entry.disposition,
      notes: entry.notes || '',
    }))
  );
  return createHash('sha256').update(normalized).digest('hex');
}

export async function buildRepoSplitPlan(
  input: RepoSplitPlanInput,
  backend: RepoSplitPlanBackend
): Promise<RepoSplitPlanOutput> {
  const entries = await backend.loadPlan(input);
  const planHash = computePlanHash(entries);
  const requiredRepos = [...new Set(entries.filter((entry) => entry.disposition === 'migrate').map((entry) => entry.targetRepo))];
  const counts = {
    confirmed: entries.filter((entry) => entry.confidence === 'confirmed').length,
    deferred: entries.filter((entry) => entry.disposition === 'deferred').length,
    excluded: entries.filter((entry) => entry.disposition === 'exclude').length,
  };
  const warnings = entries
    .filter((entry) => entry.confidence === 'provisional' || entry.disposition !== 'migrate')
    .map((entry) => `${entry.sourcePath} -> ${entry.disposition}`);

  const artifact = createArtifactMetadata('plan', planHash, {
    layout: input.layout,
    phase: 'plan',
    planHash,
    destructive: false,
  });

  savePlanArtifact({
    artifactId: artifact.artifactId,
    layout: input.layout,
    planHash,
    entries,
    counts,
    warnings,
    requiredRepos,
    createdAt: artifact.createdAt,
  });

  return {
    layout: input.layout,
    entries,
    planHash,
    counts,
    requiredRepos,
    warnings,
    artifactId: artifact.artifactId,
  };
}
