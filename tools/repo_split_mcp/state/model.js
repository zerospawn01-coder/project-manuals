"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executionStateSchema = exports.REPO_SPLIT_STATES = void 0;
exports.canTransition = canTransition;
exports.assertValidTransition = assertValidTransition;
exports.createInitialExecutionState = createInitialExecutionState;
exports.REPO_SPLIT_STATES = [
    'idle',
    'planned',
    'previewed',
    'confirmed',
    'executing',
    'executed',
    'failed',
    'archived',
];
const VALID_TRANSITIONS = {
    idle: ['planned'],
    planned: ['previewed'],
    previewed: ['confirmed'],
    confirmed: ['executing'],
    executing: ['executed', 'failed'],
    executed: ['archived'],
    failed: [],
    archived: [],
};
function canTransition(from, to) {
    return VALID_TRANSITIONS[from].includes(to);
}
function assertValidTransition(from, to) {
    if (!canTransition(from, to)) {
        throw new Error(`Invalid repo split state transition: ${from} -> ${to}`);
    }
}
function createInitialExecutionState() {
    return {
        state: 'idle',
        updatedAt: new Date().toISOString(),
    };
}
exports.executionStateSchema = {
    type: 'object',
    required: ['state', 'updatedAt'],
    properties: {
        state: {
            type: 'string',
            enum: [...exports.REPO_SPLIT_STATES],
        },
        planHash: { type: 'string' },
        confirmationId: { type: 'string' },
        executionId: { type: 'string' },
        updatedAt: { type: 'string', format: 'date-time' },
    },
    additionalProperties: false,
};
