import path from 'node:path';
import type { PreviewPhase } from '../schemas/previewOperation';

export interface RepoSplitRuntimeContext {
  sourceRoot?: string;
  destinationRoot?: string;
  tempRoot?: string;
}

const repoRoot = path.resolve(__dirname, '../../..');

export const repoSplitScriptPaths: Record<PreviewPhase, string> = {
  copy: path.join(repoRoot, 'tools', 'repo_split_copy.ps1'),
  'filter-repo': path.join(repoRoot, 'tools', 'repo_split_filter_repo.ps1'),
  archive: path.join(repoRoot, 'tools', 'repo_split_archive.ps1'),
};

export function resolvePreviewScriptPath(phase: PreviewPhase): string {
  return repoSplitScriptPaths[phase];
}

export function buildSharedScratchArgs(runtime?: RepoSplitRuntimeContext): string[] {
  if (!runtime?.sourceRoot) {
    return [];
  }

  const normalizedSourceRoot = path.resolve(runtime.sourceRoot);
  return ['-Root', path.dirname(normalizedSourceRoot), '-ScratchName', path.basename(normalizedSourceRoot)];
}

export function buildPhaseRuntimeArgs(
  phase: PreviewPhase,
  runtime: RepoSplitRuntimeContext | undefined,
  options: {
    layout: 'recommended' | 'minimal';
    excludedAction?: 'keep' | 'archive' | 'delete';
    remoteScheme?: 'https' | 'ssh';
    whatIf?: boolean;
  }
): string[] {
  const args = [...buildSharedScratchArgs(runtime), '-Layout', options.layout];
  if (options.whatIf) {
    args.push('-WhatIf');
  }

  switch (phase) {
    case 'copy':
      if (runtime?.destinationRoot) {
        args.push('-DestinationRoot', runtime.destinationRoot);
      }
      return args;
    case 'filter-repo':
      if (runtime?.tempRoot) {
        args.push('-TempRoot', runtime.tempRoot);
      }
      if (options.remoteScheme) {
        args.push('-RemoteScheme', options.remoteScheme);
      }
      return args;
    case 'archive':
      if (options.excludedAction) {
        args.push('-ExcludedAction', options.excludedAction);
      }
      return args;
  }
}
