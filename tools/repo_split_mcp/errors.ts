export const REPO_SPLIT_ERROR_CODES = [
  'CONFIRMATION_NOT_FOUND',
  'PLAN_ARTIFACT_NOT_FOUND',
  'PREVIEW_ARTIFACT_NOT_FOUND',
  'EXECUTION_ARTIFACT_NOT_FOUND',
  'PLAN_HASH_MISMATCH',
  'PREVIEW_ARTIFACT_MISMATCH',
  'EXECUTION_NOT_ALLOWED',
  'ARTIFACT_NOT_FOUND',
  'PREVIEW_FAILED',
  'EXECUTION_FAILED',
] as const;

export type RepoSplitErrorCode = (typeof REPO_SPLIT_ERROR_CODES)[number];

export class RepoSplitError extends Error {
  constructor(
    public readonly code: RepoSplitErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'RepoSplitError';
  }
}

export function formatRepoSplitError(error: unknown): string {
  if (error instanceof RepoSplitError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown repo split error';
}
