import { randomUUID } from 'node:crypto';
import type { Confirmation, ConfirmationScope } from '../schemas/confirmation';
import type { PreviewPhase } from '../schemas/previewOperation';
import { storeConfirmation } from '../state/confirmations';

export interface CreateConfirmationInput {
  layout: 'recommended' | 'minimal';
  phase: PreviewPhase;
  planHash: string;
  planArtifactId?: string;
  reason: string;
  previewArtifactId?: string;
  ttlMinutes?: number;
  scope?: ConfirmationScope;
}

export interface CreateConfirmationOutput {
  confirmation: Confirmation;
  layout: 'recommended' | 'minimal';
  reason: string;
}

export function createConfirmation(input: CreateConfirmationInput): CreateConfirmationOutput {
  const ttlMinutes = input.ttlMinutes ?? 30;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const scope = input.scope ?? input.phase;

  const confirmation = storeConfirmation({
    confirmationId: randomUUID(),
    planHash: input.planHash,
    planArtifactId: input.planArtifactId,
    phase: input.phase,
    expiresAt,
    scope,
    previewArtifactId: input.previewArtifactId,
  });

  return {
    layout: input.layout,
    reason: input.reason,
    confirmation,
  };
}
