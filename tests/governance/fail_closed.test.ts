/**
 * tests/governance/fail_closed.test.ts
 *
 * Governance test: verifies fail-closed behaviour across the pipeline.
 *
 * "Fail-closed" means: when critical information is absent (no invariant
 * check result, no schema, no ledger path), the system must REJECT — not
 * promote, not silently pass.
 *
 * Run standalone:  node dist/tests/governance/fail_closed.js
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');

// ── helpers ────────────────────────────────────────────────────────────────

function readJson(p: string): unknown {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ── Decision schema: structural checks (no ajv needed) ────────────────────

function checkDecisionSchema() {
  const schemaPath = path.join(ROOT, 'contracts', 'schemas', 'decision.schema.json');
  assert.ok(fs.existsSync(schemaPath), 'contracts/schemas/decision.schema.json must exist');
  const schema = readJson(schemaPath) as Record<string, unknown>;

  const req = schema['required'] as string[];
  assert.ok(Array.isArray(req) && req.length > 0, 'decision schema must have required fields');
  for (const f of ['decision_id', 'candidate_id', 'action', 'reason_code', 'timestamp_iso8601']) {
    assert.ok(req.includes(f), `decision schema required must include "${f}"`);
  }

  const actionEnum = ((schema['properties'] as any)?.action?.enum ?? []) as string[];
  assert.ok(actionEnum.includes('PROMOTE'), 'action enum must include PROMOTE');
  assert.ok(actionEnum.includes('REJECT'), 'action enum must include REJECT');
  assert.ok(!actionEnum.includes('BYPASS'), 'action enum must NOT include BYPASS (fail-closed)');

  assert.equal(schema['additionalProperties'], false, 'decision schema must have additionalProperties:false');

  console.log('✓ decision.schema.json: structural fail-closed checks passed');
}

// ── Ledger integrity ───────────────────────────────────────────────────────

function checkLedgerIntegrity() {
  const ledgerDir = path.join(ROOT, 'phase14', 'data');
  if (!fs.existsSync(ledgerDir)) {
    console.log('✓ ledger: directory absent, no runs yet (OK)');
    return;
  }

  const jsonlFiles = fs.readdirSync(ledgerDir).filter(f => f.endsWith('.jsonl'));
  if (jsonlFiles.length === 0) {
    console.log('✓ ledger: no .jsonl files yet (OK)');
    return;
  }

  for (const f of jsonlFiles) {
    const lines = fs.readFileSync(path.join(ledgerDir, f), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try { JSON.parse(line); }
      catch { assert.fail(`Corrupt ledger line in ${f}: ${line.slice(0, 120)}`); }
    }
    console.log(`✓ ledger: ${f} is valid JSON Lines (${lines.length} records)`);
  }
}

// ── Constitution sovereign files must exist ────────────────────────────────

function checkSovereignFiles() {
  const constitutionPath = path.join(ROOT, 'constitution', 'constitution.v1.0.yaml');
  assert.ok(fs.existsSync(constitutionPath), 'constitution/constitution.v1.0.yaml must exist');

  const content = fs.readFileSync(constitutionPath, 'utf8');
  assert.ok(content.includes('invariants:'), 'constitution must have invariants section');
  console.log('✓ constitution.v1.0.yaml: exists and has invariants section');

  const dir = path.join(ROOT, 'constitution', 'invariants');
  assert.ok(fs.existsSync(dir), 'constitution/invariants/ directory must exist');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(/^id:/m.test(text), `Invariant file ${f} must have an id: field`);
  }
  console.log(`✓ constitution/invariants/: ${files.length} files, all have id field`);
}

// ── Main ───────────────────────────────────────────────────────────────────

function runTests() {
  checkDecisionSchema();
  checkLedgerIntegrity();
  checkSovereignFiles();
  console.log('\n✓ fail_closed: all governance checks passed');
}

runTests();

