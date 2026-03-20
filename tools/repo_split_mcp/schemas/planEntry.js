"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planEntrySchema = exports.PLAN_ENTRY_DISPOSITIONS = exports.PLAN_ENTRY_CONFIDENCE_LEVELS = exports.PLAN_ENTRY_MIGRATION_MODES = void 0;
exports.PLAN_ENTRY_MIGRATION_MODES = [
    'copy',
    'filter-repo',
    'archive',
    'exclude',
];
exports.PLAN_ENTRY_CONFIDENCE_LEVELS = ['confirmed', 'provisional'];
exports.PLAN_ENTRY_DISPOSITIONS = [
    'migrate',
    'deferred',
    'exclude',
    'archive',
];
exports.planEntrySchema = {
    type: 'object',
    required: [
        'sourcePath',
        'category',
        'targetRepo',
        'targetPath',
        'migrationMode',
        'confidence',
        'disposition',
    ],
    properties: {
        sourcePath: { type: 'string' },
        category: { type: 'string' },
        targetRepo: { type: 'string' },
        targetPath: { type: 'string' },
        migrationMode: {
            type: 'string',
            enum: [...exports.PLAN_ENTRY_MIGRATION_MODES],
        },
        confidence: {
            type: 'string',
            enum: [...exports.PLAN_ENTRY_CONFIDENCE_LEVELS],
        },
        disposition: {
            type: 'string',
            enum: [...exports.PLAN_ENTRY_DISPOSITIONS],
        },
        notes: { type: 'string' },
    },
    additionalProperties: false,
};
