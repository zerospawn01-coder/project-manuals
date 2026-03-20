import fs from 'node:fs';
import path from 'node:path';
import { type ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

export interface WorkflowEventValidationResult {
  ok: boolean;
  errors: string[];
}

let validatorCache: ValidateFunction | null = null;

function normalizeWindowsPath(value: string): string {
  return value.replace(/^\\\\\?\\/, '');
}

function repoRoot(): string {
  return normalizeWindowsPath(path.resolve(__dirname, '..', '..'));
}

function defaultSchemaPath(): string {
  return path.join(repoRoot(), 'workflows', 'event_schema.v0.1.json');
}

function loadValidator(schemaPath?: string): ValidateFunction {
  if (validatorCache) {
    return validatorCache;
  }

  const resolved = schemaPath ? path.resolve(repoRoot(), schemaPath) : defaultSchemaPath();
  const schema = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  validatorCache = ajv.compile(schema);
  return validatorCache;
}

export function validateWorkflowEvent(eventPayload: unknown, schemaPath?: string): WorkflowEventValidationResult {
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

export function assertValidWorkflowEvent(eventPayload: unknown, schemaPath?: string): void {
  const result = validateWorkflowEvent(eventPayload, schemaPath);
  if (!result.ok) {
    throw new Error(`EVENT_SCHEMA_VALIDATION_FAILED: ${result.errors.join('; ')}`);
  }
}

export function createValidatedWorkflowEmitter<T>(emit: (payload: T) => Promise<void> | void, schemaPath?: string) {
  return async (payload: T) => {
    assertValidWorkflowEvent(payload, schemaPath);
    await emit(payload);
  };
}
