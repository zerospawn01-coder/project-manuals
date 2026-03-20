import type { Confirmation } from '../schemas/confirmation';
import type { PreviewPhase } from '../schemas/previewOperation';
import { RepoSplitError } from '../errors';
import { assertValidTransition, type ExecutionStateSnapshot, type RepoSplitState } from './model';

export function assertStateTransition(snapshot: ExecutionStateSnapshot, nextState: RepoSplitState): void {
  assertValidTransition(snapshot.state, nextState);
}

export function requireState(snapshot: ExecutionStateSnapshot, expectedState: RepoSplitState): void {
  if (snapshot.state !== expectedState) {
    throw new RepoSplitError('EXECUTION_NOT_ALLOWED', `Expected repo split state ${expectedState} but found ${snapshot.state}`, {
      expectedState,
      actualState: snapshot.state,
    });
  }
}

export function isConfirmationExpired(confirmation: Confirmation, now = new Date()): boolean {
  return new Date(confirmation.expiresAt).getTime() <= now.getTime();
}

export function assertConfirmationForPhase(
  confirmation: Confirmation,
  phase: PreviewPhase,
  planHash: string,
  now = new Date()
): void {
  if (confirmation.planHash !== planHash) {
    throw new RepoSplitError('PLAN_HASH_MISMATCH', 'Confirmation planHash does not match the current plan.', {
      confirmationId: confirmation.confirmationId,
      confirmationPlanHash: confirmation.planHash,
      planHash,
    });
  }
  if (confirmation.phase !== phase && confirmation.scope !== 'full-run') {
    throw new RepoSplitError('EXECUTION_NOT_ALLOWED', `Confirmation scope ${confirmation.scope} does not permit phase ${phase}.`, {
      confirmationId: confirmation.confirmationId,
      phase,
      scope: confirmation.scope,
    });
  }
  if (isConfirmationExpired(confirmation, now)) {
    throw new RepoSplitError('EXECUTION_NOT_ALLOWED', `Confirmation ${confirmation.confirmationId} has expired.`, {
      confirmationId: confirmation.confirmationId,
      expiresAt: confirmation.expiresAt,
    });
  }
}

export function assertConfirmationForPreviewArtifact(
  confirmation: Confirmation,
  previewArtifactId?: string
): void {
  if (!previewArtifactId) {
    return;
  }
  if (confirmation.previewArtifactId !== previewArtifactId) {
    throw new RepoSplitError('PREVIEW_ARTIFACT_MISMATCH', `Confirmation ${confirmation.confirmationId} is not bound to preview artifact ${previewArtifactId}.`, {
      confirmationId: confirmation.confirmationId,
      confirmationPreviewArtifactId: confirmation.previewArtifactId,
      previewArtifactId,
    });
  }
}
