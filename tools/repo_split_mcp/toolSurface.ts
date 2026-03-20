import type { RepoSplitPlanBackend } from './tools/plan';
import type { RepoSplitPreviewBackend } from './tools/preview';
import { buildRepoSplitPlan } from './tools/plan';
import { buildRepoSplitPreview } from './tools/preview';
import { createConfirmation } from './tools/createConfirmation';
import { executeConfirmed } from './tools/executeConfirmed';

export const REPO_SPLIT_TOOL_NAMES = [
  'repo_split.plan',
  'repo_split.preview',
  'repo_split.create_confirmation',
  'repo_split.execute_confirmed',
] as const;

export interface RepoSplitToolSurfaceDependencies {
  planBackend: RepoSplitPlanBackend;
  previewBackend: RepoSplitPreviewBackend;
}

export function createRepoSplitToolSurface(dependencies: RepoSplitToolSurfaceDependencies) {
  return {
    'repo_split.plan': (input: Parameters<typeof buildRepoSplitPlan>[0]) =>
      buildRepoSplitPlan(input, dependencies.planBackend),
    'repo_split.preview': (input: Parameters<typeof buildRepoSplitPreview>[0]) =>
      buildRepoSplitPreview(input, dependencies.previewBackend),
    'repo_split.create_confirmation': createConfirmation,
    'repo_split.execute_confirmed': executeConfirmed,
  };
}
