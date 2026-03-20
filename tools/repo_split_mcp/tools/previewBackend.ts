import type { PlanEntry } from '../schemas/planEntry';
import type { PreviewOperation } from '../schemas/previewOperation';
import { parsePreview } from '../internal/parsePreview';
import { runPowerShell } from '../internal/runPowerShell';
import { buildPhaseRuntimeArgs, resolvePreviewScriptPath } from '../internal/scriptRuntime';
import { PowerShellRepoSplitPlanBackend } from './planBackend';
import type { RepoSplitPreviewBackend, RepoSplitPreviewInput } from './preview';

function createCopyOperation(entry: PlanEntry): PreviewOperation {
  return {
    phase: 'copy',
    action: `Would copy ${entry.sourcePath} to ${entry.targetRepo}/${entry.targetPath}`,
    sourcePath: entry.sourcePath,
    targetRepo: entry.targetRepo,
    targetPath: entry.targetPath,
    destructive: false,
    requiresConfirmation: true,
    warnings: entry.confidence === 'provisional' ? ['Provisional copy mapping requires operator review.'] : undefined,
  };
}

function createFilterRepoOperation(entry: PlanEntry, remoteScheme: 'https' | 'ssh'): PreviewOperation {
  return {
    phase: 'filter-repo',
    action: `Would create a temporary filtered clone for ${entry.sourcePath} and configure ${remoteScheme} remote`,
    sourcePath: entry.sourcePath,
    targetRepo: entry.targetRepo,
    targetPath: entry.targetPath,
    destructive: false,
    requiresConfirmation: true,
    warnings: ['Validate filtered clone before any push operation.'],
  };
}

function createArchiveOperation(entry: PlanEntry, excludedAction: 'keep' | 'archive' | 'delete'): PreviewOperation {
  return {
    phase: 'archive',
    action: `Would ${excludedAction} ${entry.sourcePath}`,
    sourcePath: entry.sourcePath,
    targetRepo: entry.targetRepo,
    targetPath: entry.targetPath,
    destructive: false,
    requiresConfirmation: true,
    warnings: [
      excludedAction === 'keep'
        ? 'Excluded placeholder remains untouched in preview mode.'
        : `Excluded placeholder would be handled with action: ${excludedAction}.`,
    ],
  };
}

function mapPreviewOperations(
  entries: PlanEntry[],
  input: RepoSplitPreviewInput
): PreviewOperation[] {
  switch (input.phase) {
    case 'copy':
      return entries
        .filter((entry) => entry.migrationMode === 'copy' && entry.disposition === 'migrate')
        .map(createCopyOperation);
    case 'filter-repo':
      return entries
        .filter((entry) => entry.migrationMode === 'filter-repo' && entry.disposition === 'migrate')
        .map((entry) => createFilterRepoOperation(entry, input.remoteScheme || 'https'));
    case 'archive':
      return entries
        .filter((entry) => entry.disposition !== 'migrate')
        .map((entry) => createArchiveOperation(entry, input.excludedAction || 'keep'));
  }
}

export class PowerShellRepoSplitPreviewBackend implements RepoSplitPreviewBackend {
  constructor(private readonly planBackend = new PowerShellRepoSplitPlanBackend()) {}

  async loadPreview(input: RepoSplitPreviewInput): Promise<{ operations: PreviewOperation[]; warnings?: string[]; repos?: string[]; paths?: string[]; status?: 'ok' | 'degraded' | 'failed' }> {
    const entries = await this.planBackend.loadPlan({
      layout: input.layout,
      includeDeferred: true,
      format: 'json',
    });

    const result = await runPowerShell(
      resolvePreviewScriptPath(input.phase),
      buildPhaseRuntimeArgs(input.phase, input.runtime, {
        layout: input.layout,
        excludedAction: input.excludedAction,
        remoteScheme: input.remoteScheme,
        whatIf: true,
      })
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Preview script failed for phase ${input.phase}.`);
    }

    const parsed = parsePreview(result.stdout, result.stderr);
    const operations = mapPreviewOperations(entries, input);
    const warnings = [...parsed.warnings];

    if (parsed.detectedOperationCount > 0 && parsed.detectedOperationCount !== operations.length) {
      warnings.push(
        `Detected ${parsed.detectedOperationCount} WhatIf operations but normalized ${operations.length} preview operations.`
      );
    }

    return {
      operations,
      warnings,
      repos: parsed.repoHints,
      paths: parsed.pathHints,
      status: warnings.length > 0 ? 'degraded' : 'ok',
    };
  }
}
