"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWorkflowEvent = validateWorkflowEvent;
exports.assertValidWorkflowEvent = assertValidWorkflowEvent;
exports.createValidatedWorkflowEmitter = createValidatedWorkflowEmitter;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const _2020_1 = __importDefault(require("ajv/dist/2020"));
const ajv_formats_1 = __importDefault(require("ajv-formats"));
let validatorCache = null;
function normalizeWindowsPath(value) {
    return value.replace(/^\\\\\?\\/, '');
}
function repoRoot() {
    return normalizeWindowsPath(node_path_1.default.resolve(__dirname, '..', '..'));
}
function defaultSchemaPath() {
    return node_path_1.default.join(repoRoot(), 'workflows', 'event_schema.v0.1.json');
}
function loadValidator(schemaPath) {
    if (validatorCache) {
        return validatorCache;
    }
    const resolved = schemaPath ? node_path_1.default.resolve(repoRoot(), schemaPath) : defaultSchemaPath();
    const schema = JSON.parse(node_fs_1.default.readFileSync(resolved, 'utf8'));
    const ajv = new _2020_1.default({ allErrors: true, strict: false });
    (0, ajv_formats_1.default)(ajv);
    validatorCache = ajv.compile(schema);
    return validatorCache;
}
function validateWorkflowEvent(eventPayload, schemaPath) {
    const validate = loadValidator(schemaPath);
    const valid = validate(eventPayload);
    if (valid) {
        return { ok: true, errors: [] };
    }
    const errors = (validate.errors || []).map((error) => {
        const instancePath = error.instancePath || '/';
        return `${instancePath} ${error.message || 'invalid'}`.trim();
    });
    return { ok: false, errors };
}
function assertValidWorkflowEvent(eventPayload, schemaPath) {
    const result = validateWorkflowEvent(eventPayload, schemaPath);
    if (!result.ok) {
        throw new Error(`EVENT_SCHEMA_VALIDATION_FAILED: ${result.errors.join('; ')}`);
    }
}
function createValidatedWorkflowEmitter(emit, schemaPath) {
    return async (payload) => {
        assertValidWorkflowEvent(payload, schemaPath);
        await emit(payload);
    };
}
