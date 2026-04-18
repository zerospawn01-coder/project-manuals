import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert';

import {
  ComparisonRow,
  auditComparisonDiff,
  detectComparisonConflicts,
  enforceComparisonPolicy,
  scoreEvidence,
  scoreEvidences,
  validateComparisonRowsWithSchema,
} from '../renderer-react/src/app/comparison_loader';

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function run(): void {
  const root = process.cwd().replace(/^\\\\\?\\/, '');
  const appDir = path.join(root, 'renderer-react', 'src', 'app');

  const schema = readJson(path.join(appDir, 'comparison_schema.json'));
  const data = readJson(path.join(appDir, 'comparison_data.json'));
  const rows = validateComparisonRowsWithSchema(data, schema);

  const baselineConflicts = detectComparisonConflicts(rows);
  const baselineErrors = baselineConflicts.filter((conflict) => conflict.severity === 'error');
  assert.equal(baselineErrors.length, 0, 'baseline data must not contain error-level semantic conflicts');
  const baselineDecision = enforceComparisonPolicy(rows);
  assert.equal(baselineDecision.accepted, true, 'baseline data should pass policy gate');
  assert.equal(['ACCEPT', 'REVIEW_REQUIRED'].includes(baselineDecision.decision), true, 'baseline should produce a valid decision');

  const withConflict = deepClone(rows) as ComparisonRow[];
  withConflict[0].openclaw.status = 'implemented';
  withConflict[0].openclaw.evidences = [
    {
      type: 'analysis',
      ref: 'analysis-only-ref',
      confidence: 0.9,
      scope: 'runtime',
      note: 'analysis only',
      owner: 'test-owner',
      last_verified: '2026-04-14T00:00:00Z',
    },
  ];
  const conflicts = detectComparisonConflicts(withConflict);
  assert.equal(conflicts.length > 0, true, 'implemented + analysis must be detected as conflict');
  assert.equal(enforceComparisonPolicy(withConflict).accepted, false, 'conflicted data should be rejected by policy gate');

  const strong = scoreEvidence({
    type: 'official_docs',
    ref: 'r1',
    confidence: 0.9,
    scope: 'runtime',
    note: 'n1',
    owner: 'test-owner',
    last_verified: '2026-04-14T00:00:00Z',
  });
  const weak = scoreEvidence({
    type: 'analysis',
    ref: 'r2',
    confidence: 0.6,
    scope: 'inference',
    note: 'n2',
    owner: 'test-owner',
    last_verified: '2026-04-14T00:00:00Z',
  });
  assert.equal(strong > weak, true, 'official_docs/runtime should score higher than analysis/inference');
  assert.equal(
    scoreEvidences([
      { type: 'official_docs', ref: 'r3', confidence: 0.9, scope: 'runtime', note: 'n3', owner: 'test-owner', last_verified: '2026-04-14T00:00:00Z' },
      { type: 'issue', ref: 'r4', confidence: 0.8, scope: 'runtime', note: 'n4', owner: 'test-owner', last_verified: '2026-04-14T00:00:00Z' },
    ]) >
      scoreEvidences([{ type: 'analysis', ref: 'r5', confidence: 0.6, scope: 'inference', note: 'n5', owner: 'test-owner', last_verified: '2026-04-14T00:00:00Z' }]),
    true,
    'multi-evidence scoring should preserve stronger combined evidence'
  );

  const previous = deepClone(rows) as ComparisonRow[];
  const next = deepClone(rows) as ComparisonRow[];
  next[1].openclaw.detail = `${next[1].openclaw.detail} (updated)`;
  next[1].openclaw.evidences[0].confidence = 0.8;

  const diff = auditComparisonDiff(previous, next);
  assert.equal(diff.changedRows.length > 0, true, 'diff audit must detect modified rows');
  assert.equal(diff.changedRows[0].axis, next[1].axis, 'diff audit should report changed axis');
  assert.equal(diff.changedRows[0].impactScore > 0, true, 'diff audit should include impact score');
  assert.equal(['low', 'medium', 'high', 'critical'].includes(diff.changedRows[0].riskLevel), true, 'diff audit should include risk level');
  assert.equal(['monitor', 'review', 'freeze'].includes(diff.changedRows[0].action), true, 'diff audit should include policy action');

  console.log('comparison_governance_logic.test: all cases passed');
}

run();
