"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.previewOperationSchema = exports.PREVIEW_PHASES = void 0;
exports.PREVIEW_PHASES = ['copy', 'filter-repo', 'archive'];
exports.previewOperationSchema = {
    type: 'object',
    required: [
        'phase',
        'action',
        'sourcePath',
        'targetRepo',
        'targetPath',
        'destructive',
    ],
    properties: {
        phase: {
            type: 'string',
            enum: [...exports.PREVIEW_PHASES],
        },
        action: { type: 'string' },
        sourcePath: { type: 'string' },
        targetRepo: { type: 'string' },
        targetPath: { type: 'string' },
        destructive: { type: 'boolean' },
        requiresConfirmation: { type: 'boolean' },
        warnings: {
            type: 'array',
            items: { type: 'string' },
        },
    },
    additionalProperties: false,
};
