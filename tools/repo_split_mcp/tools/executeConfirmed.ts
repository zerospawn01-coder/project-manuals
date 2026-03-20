import { createArtifactMetadata } from '../artifacts/ids';
import { RepoSplitError } from '../errors';
import { parsePreview } from '../internal/parsePreview';
import { runPowerShell } from '../internal/runPowerShell';
import { buildPhaseRuntimeArgs, type RepoSplitRuntimeContext, resolvePreviewScriptPath } from '../internal/scriptRuntime';
import { getConfirmation } from '../state/confirmations';
import { saveExecutionArtifact } from '../state/artifacts';
import { assertConfirmationForPhase, assertConfirmationForPreviewArtifact, requireState } from '../state/guards';
import { createInitialExecutionState, type ExecutionStateSnapshot } from '../state/model';
import type { PreviewPhase } from '../schemas/previewOperation';

export interface ExecuteConfirmedInput {
  confirmationId: string;
  phase: PreviewPhase;
  planHash: string;
  layout: 'recommended' | 'minimal';
  previewArtifactId?: string;
  runtime?: RepoSplitRuntimeContext;
  excludedAction?: 'keep' | 'archive' | 'delete';
  remoteScheme?: 'https' | 'ssh';
  snapshot?: ExecutionStateSnapshot;
}

export interface ExecuteConfirmedOutput {
  phase: 'execute';
  status: 'completed' | 'failed';
  confirmationId: string;
  planHash: string;
  planArtifactId?: string;
  previewArtifactId?: string;
  exitCode: number;
  warnings: string[];
  artifactId: string;
}

export async function executeConfirmed(input: ExecuteConfirmedInput): Promise<ExecuteConfirmedOutput> {
  const snapshot = input.snapshot ?? {
    ...createInitialExecutionState(),
    state: 'confirmed',
    planHash: input.planHash,
    confirmationId: input.confirmationId,
  };

  requireState(snapshot, 'confirmed');

  const confirmation = getConfirmation(input.confirmationId);
  if (!confirmation) {
    throw new RepoSplitError('CONFIRMATION_NOT_FOUND', `Confirmation not found: ${input.confirmationId}`, {
      confirmationId: input.confirmationId,
    });
  }

  assertConfirmationForPhase(confirmation, input.phase, input.planHash);
  assertConfirmationForPreviewArtifact(confirmation, input.previewArtifactId);

  const result = await runPowerShell(
    resolvePreviewScriptPath(input.phase),
    buildPhaseRuntimeArgs(input.phase, input.runtime, {
      layout: input.layout,
      excludedAction: input.excludedAction,
      remoteScheme: input.remoteScheme,
      whatIf: false,
    })
  );

  if (result.exitCode !== 0) {
    throw new RepoSplitError('EXECUTION_FAILED', `Execution failed for phase ${input.phase}.`, {
      confirmationId: input.confirmationId,
      phase: input.phase,
      exitCode: result.exitCode,
      stderr: result.stderr,
    });
  }

  const parsed = parsePreview(result.stdout, result.stderr);
  const artifactSeed = JSON.stringify({
    confirmationId: input.confirmationId,
    phase: input.phase,
    planHash: input.planHash,
    layout: input.layout,
    runtime: input.runtime,
  });
  const artifact = createArtifactMetadata('execution', artifactSeed, {
    layout: input.layout,
    phase: input.phase,
    planHash: input.planHash,
    destructive: true,
  });

  saveExecutionArtifact({
    artifactId: artifact.artifactId,
    confirmationId: input.confirmationId,
    planArtifactId: confirmation.planArtifactId,
    previewArtifactId: confirmation.previewArtifactId,
    planHash: input.planHash,
    layout: input.layout,
    phase: input.phase,
    status: 'completed',
    exitCode: result.exitCode,
    warnings: parsed.warnings,
    createdAt: artifact.createdAt,
  });

  return {
    phase: 'execute',
    status: 'completed',
    confirmationId: input.confirmationId,
    planHash: input.planHash,
    planArtifactId: confirmation.planArtifactId,
    previewArtifactId: confirmation.previewArtifactId,
    exitCode: result.exitCode,
    warnings: parsed.warnings,
    artifactId: artifact.artifactId,
  };
}
