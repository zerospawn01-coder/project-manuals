export const REPO_SPLIT_STATES = [
  'idle',
  'planned',
  'previewed',
  'confirmed',
  'executing',
  'executed',
  'failed',
  'archived',
] as const;

export type RepoSplitState = (typeof REPO_SPLIT_STATES)[number];

export interface ExecutionStateSnapshot {
  state: RepoSplitState;
  planHash?: string;
  confirmationId?: string;
  executionId?: string;
  updatedAt: string;
}

const VALID_TRANSITIONS: Record<RepoSplitState, RepoSplitState[]> = {
  idle: ['planned'],
  planned: ['previewed'],
  previewed: ['confirmed'],
  confirmed: ['executing'],
  executing: ['executed', 'failed'],
  executed: ['archived'],
  failed: [],
  archived: [],
};

export function canTransition(from: RepoSplitState, to: RepoSplitState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function assertValidTransition(from: RepoSplitState, to: RepoSplitState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid repo split state transition: ${from} -> ${to}`);
  }
}

export function createInitialExecutionState(): ExecutionStateSnapshot {
  return {
    state: 'idle',
    updatedAt: new Date().toISOString(),
  };
}

export const executionStateSchema = {
  type: 'object',
  required: ['state', 'updatedAt'],
  properties: {
    state: {
      type: 'string',
      enum: [...REPO_SPLIT_STATES],
    },
    planHash: { type: 'string' },
    confirmationId: { type: 'string' },
    executionId: { type: 'string' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  additionalProperties: false,
} as const;
