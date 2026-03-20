"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepoSplitError = exports.REPO_SPLIT_ERROR_CODES = void 0;
exports.formatRepoSplitError = formatRepoSplitError;
exports.REPO_SPLIT_ERROR_CODES = [
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
];
class RepoSplitError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'RepoSplitError';
    }
}
exports.RepoSplitError = RepoSplitError;
function formatRepoSplitError(error) {
    if (error instanceof RepoSplitError) {
        return `${error.code}: ${error.message}`;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'Unknown repo split error';
}
