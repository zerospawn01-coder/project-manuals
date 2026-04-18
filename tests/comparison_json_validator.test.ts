import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert';
import Ajv from 'ajv';

function readJson(filePath: string): unknown {
  const text = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(text) as unknown;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validateWithSchema(data: unknown, schema: unknown): boolean {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema as object);
  const valid = validate(data);
  return valid === true;
}

function run(): void {
  const root = process.cwd().replace(/^\\\\\?\\/, '');
  const appDir = path.join(root, 'renderer-react', 'src', 'app');
  const schemaPath = path.join(appDir, 'comparison_schema.json');
  const dataPath = path.join(appDir, 'comparison_data.json');

  const schema = readJson(schemaPath);
  const validData = readJson(dataPath) as unknown[];

  assert.equal(validateWithSchema(validData, schema), true, 'valid comparison_data.json must pass schema validation');

  const missingRequired = deepClone(validData) as Record<string, unknown>[];
  delete ((missingRequired[0] as Record<string, unknown>).openclaw as Record<string, unknown>).detail;
  assert.equal(validateWithSchema(missingRequired, schema), false, 'missing required field must fail validation');

  const invalidMechanism = deepClone(validData) as Record<string, unknown>[];
  (((invalidMechanism[0] as Record<string, unknown>).openclaw as Record<string, unknown>).mechanism as string) = 'invalid_mechanism';
  assert.equal(validateWithSchema(invalidMechanism, schema), false, 'invalid mechanism enum must fail validation');

  const invalidStatus = deepClone(validData) as Record<string, unknown>[];
  (((invalidStatus[0] as Record<string, unknown>).agos as Record<string, unknown>).status as string) = 'invalid_status';
  assert.equal(validateWithSchema(invalidStatus, schema), false, 'invalid status enum must fail validation');

  console.log('comparison_json_validator.test: all cases passed');
}

run();
