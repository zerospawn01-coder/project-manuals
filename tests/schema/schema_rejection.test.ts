/**
 * tests/schema/schema_rejection.test.ts
 *
 * Governance test: verifies that every JSON Schema in contracts/schemas/
 * correctly REJECTS known-bad inputs via structural inspection.
 *
 * Run standalone:  node dist/tests/schema/schema_rejection.js
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCHEMAS_DIR = path.join(ROOT, 'contracts', 'schemas');

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

// ── decision.schema.json ───────────────────────────────────────────────────

function checkDecisionSchema() {
  const schema = loadSchema('decision.schema.json');
  assert.ok(schema, 'decision.schema.json must be valid JSON');

  const req = schema['required'] as string[];
  assert.ok(Array.isArray(req), 'decision schema must have required array');
  for (const f of ['decision_id', 'candidate_id', 'action', 'reason_code', 'timestamp_iso8601']) {
    assert.ok(req.includes(f), `required must include "${f}"`);
  }

  const actionEnum = ((schema['properties'] as any)?.action?.enum ?? []) as string[];
  assert.ok(actionEnum.includes('PROMOTE'), 'action enum must include PROMOTE');
  assert.ok(actionEnum.includes('REJECT'), 'action enum must include REJECT');
  assert.ok(!actionEnum.includes('BYPASS'), 'action enum MUST NOT include BYPASS');
  assert.ok(!actionEnum.includes('IGNORE'), 'action enum MUST NOT include IGNORE');

  const reasonPattern: string = ((schema['properties'] as any)?.reason_code?.pattern ?? '');
  assert.ok(reasonPattern.length > 0, 'reason_code must have a pattern constraint');
  assert.ok(!new RegExp(reasonPattern).test(''), 'reason_code pattern must reject empty string');

  assert.equal(schema['additionalProperties'], false, 'decision schema must be closed (additionalProperties:false)');

  console.log('✓ decision.schema.json: all structural rejection checks passed');
}

// ── execution-trace.schema.json ────────────────────────────────────────────

function checkExecutionTraceSchema() {
  const schema = loadSchema('execution-trace.schema.json');

  const outcomeEnum = ((schema['properties'] as any)?.outcome?.enum ?? []) as string[];
  assert.ok(outcomeEnum.includes('PASS'), 'outcome enum must include PASS');
  assert.ok(outcomeEnum.includes('FAIL'), 'outcome enum must include FAIL');
  assert.ok(!outcomeEnum.includes('UNKNOWN'), 'outcome enum MUST NOT include UNKNOWN');

  const phaseEnum = ((schema['properties'] as any)?.phase?.enum ?? []) as string[];
  assert.deepEqual(phaseEnum.sort(), ['A', 'B', 'C', 'D'], 'phase enum must be exactly A/B/C/D');

  assert.equal(schema['additionalProperties'], false, 'execution-trace schema must be closed');

  console.log('✓ execution-trace.schema.json: all structural rejection checks passed');
}

// ── canonical-event.schema.json ────────────────────────────────────────────

function checkCanonicalEventSchema() {
  const schema = loadSchema('canonical-event.schema.json');

  const typeEnum = ((schema['properties'] as any)?.event_type?.enum ?? []) as string[];
  assert.ok(typeEnum.length > 0, 'event_type must be a non-empty enum');
  assert.ok(!typeEnum.includes('*'), 'event_type enum MUST NOT contain wildcard *');
  assert.ok(!typeEnum.includes('UNKNOWN'), 'event_type enum MUST NOT include UNKNOWN');

  const req = schema['required'] as string[];
  for (const f of ['event_id', 'event_type', 'source', 'payload', 'timestamp_iso8601']) {
    assert.ok(req.includes(f), `canonical-event required must include "${f}"`);
  }

  console.log('✓ canonical-event.schema.json: all structural rejection checks passed');
}

// ── Main ───────────────────────────────────────────────────────────────────

function runTests() {
  checkDecisionSchema();
  checkExecutionTraceSchema();
  checkCanonicalEventSchema();
  console.log('\n✓ schema_rejection: all governance checks passed');
}

runTests();
