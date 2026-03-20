"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmationSchema = exports.CONFIRMATION_SCOPES = void 0;
exports.CONFIRMATION_SCOPES = ['copy', 'filter-repo', 'archive', 'full-run'];
exports.confirmationSchema = {
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
            enum: [...exports.CONFIRMATION_SCOPES],
        },
        previewArtifactId: { type: 'string' },
    },
    additionalProperties: false,
};
