import type { PreviewPhase } from './previewOperation';

export const CONFIRMATION_SCOPES = ['copy', 'filter-repo', 'archive', 'full-run'] as const;

export type ConfirmationScope = (typeof CONFIRMATION_SCOPES)[number];

export interface Confirmation {
  confirmationId: string;
  planHash: string;
  planArtifactId?: string;
  phase: PreviewPhase;
  expiresAt: string;
  scope: ConfirmationScope;
  previewArtifactId?: string;
}

export const confirmationSchema = {
  type: 'object',
  required: ['confirmationId', 'planHash', 'phase', 'expiresAt', 'scope'],
  properties: {
    confirmationId: { type: 'string' },
    planHash: { type: 'string' },
    planArtifactId: { type: 'string' },
    phase: { type: 'string', enum: ['copy', 'filter-repo', 'archive'] },
    expiresAt: { type: 'string', format: 'date-time' },
    scope: {
      type: 'string',
      enum: [...CONFIRMATION_SCOPES],
    },
    previewArtifactId: { type: 'string' },
  },
  additionalProperties: false,
} as const;
