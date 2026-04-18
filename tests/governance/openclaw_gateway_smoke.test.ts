/**
 * tests/governance/openclaw_gateway_smoke.test.ts
 *
 * Smoke tests for OpenClaw Gateway reject paths.
 * Verifies that hard-reject decisions are emitted and written to the audit log.
 *
 * Run standalone:
 *   node dist/tests/governance/openclaw_gateway_smoke.test.js
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  OpenClawGateway,
  DEFAULT_FORBIDDEN_TARGETS,
  DEFAULT_BENCHMARK_PROTECTED_PATHS,
} from '../../tools/openclaw_gateway';
import type { OpenClawRequest } from '../../contract/openclaw_gateway';

function makeGateway() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-gateway-smoke-'));
  const audit_log_path = path.join(tmp, 'openclaw_gateway_audit.jsonl');
  const gateway = new OpenClawGateway({
    max_enqueue_per_day: 10,
    forbidden_target_substrings: DEFAULT_FORBIDDEN_TARGETS,
    benchmark_protected_paths: DEFAULT_BENCHMARK_PROTECTED_PATHS,
    audit_log_path,
  });
  gateway.beginCycle(`smoke-${Date.now()}`);
  return { gateway, audit_log_path, tmp };
}

function readJsonl(p: string): Array<Record<string, unknown>> {
  return fs.readFileSync(p, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function makeRequest(overrides: Partial<OpenClawRequest>): OpenClawRequest {
  return {
    request_id: randomUUID(),
    submitted_at: new Date().toISOString(),
    action: 'query_state',
    target: '',
    risk_level: 'LOW',
    parameters: {},
    ...overrides,
  };
}

function testHighRiskHardReject() {
  const { gateway, audit_log_path } = makeGateway();
  const decision = gateway.process(makeRequest({
    action: 'query_state',
    risk_level: 'HIGH',
  }));

  assert.equal(decision.verdict, 'HARD_REJECT');
  assert.equal(decision.reject_code, 'HIGH_RISK_BLOCKED');

  const entries = readJsonl(audit_log_path);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.['verdict'], 'HARD_REJECT');
  assert.equal(entries[0]?.['reject_code'], 'HIGH_RISK_BLOCKED');
  console.log('✓ OpenClaw gateway: HIGH risk request is hard-rejected and audited');
}

function testBenchmarkProtectedPathHardReject() {
  const { gateway, audit_log_path } = makeGateway();
  const decision = gateway.process(makeRequest({
    action: 'enqueue_candidate',
    target: 'phase14/scripts/aggregate_weekly.py',
    risk_level: 'MEDIUM',
    parameters: {
      patch_diff: [
        '--- a/tools/run_benchmark.py',
        '+++ b/tools/run_benchmark.py',
        '@@ -1 +1 @@',
        '-print("old")',
        '+print("new")',
      ].join('\n'),
      rationale: 'Protect measurement integrity by validating benchmark target blocking.',
      estimated_blast_radius: 'SELF',
    },
  }));

  assert.equal(decision.verdict, 'HARD_REJECT');
  assert.equal(decision.reject_code, 'FORBIDDEN_TARGET');

  const entries = readJsonl(audit_log_path);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.['verdict'], 'HARD_REJECT');
  assert.equal(entries[0]?.['reject_code'], 'FORBIDDEN_TARGET');
  const violated = entries[0]?.['violated_invariant_ids'] as string[] | undefined;
  assert.ok(Array.isArray(violated) && violated.includes('run_benchmark'));
  console.log('✓ OpenClaw gateway: benchmark-protected path is hard-rejected and audited');
}

function runTests() {
  testHighRiskHardReject();
  testBenchmarkProtectedPathHardReject();
  console.log('\n✓ openclaw_gateway_smoke: all checks passed');
}

runTests();

