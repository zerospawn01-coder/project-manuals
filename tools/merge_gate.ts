/**
 * tools/merge_gate.ts
 *
 * Node-based CI gate aggregator.  Replaces the bash/jq pipeline in ci.yml.
 *
 * Reads job results from environment variables, merges with the structured
 * verify_constitution artifact, and emits a single authoritative gate result.
 *
 * Fail-closed semantics:
 *   - Artifact absent when invariants job failed  → GOVERNANCE violation (not silent skip)
 *   - JSON parse error in artifact                → GOVERNANCE violation
 *   - Any job result that is not "success"        → violation added
 *
 * Violation classification (2 axes):
 *   layer: "GOVERNANCE"  — constitution / invariant / test-governance failures
 *   layer: "QUALITY"     — lint / typecheck / schema failures
 *
 * Env vars (all optional, default "skipped"):
 *   LINT           — result of lint-typecheck job
 *   SCHEMA         — result of validate-schema job
 *   INVARIANTS     — result of validate-invariants job
 *   GOVERNANCE     — result of test-governance job
 *   VERIFY_JSON_PATH — path to verify_constitution --json output
 *                      (default: /tmp/gate-artifacts/verify_result.json)
 *
 * Exit codes:
 *   0 — PASS
 *   1 — FAIL
 */

import * as fs from 'fs';

type GateLayer = 'GOVERNANCE' | 'QUALITY';

interface GateViolation {
  type: string;
  layer: GateLayer;
  reason: string;
  id?: string;
  file?: string;
  fix?: object;
}

interface GateResult {
  status: 'PASS' | 'FAIL';
  violations: GateViolation[];
}

function jobResult(envKey: string): string {
  return (process.env[envKey] ?? 'skipped').toLowerCase();
}

function main(): void {
  const lint       = jobResult('LINT');
  const schema     = jobResult('SCHEMA');
  const invariants = jobResult('INVARIANTS');
  const governance = jobResult('GOVERNANCE');
  const verifyPath = process.env['VERIFY_JSON_PATH']
    ?? '/tmp/gate-artifacts/verify_result.json';

  const violations: GateViolation[] = [];

  // ── Quality layer ───────────────────────────────────────────────────────
  if (lint !== 'success') {
    violations.push({
      type: 'LINT_FAIL',
      layer: 'QUALITY',
      reason: 'lint-typecheck job failed',
    });
  }
  if (schema !== 'success') {
    violations.push({
      type: 'SCHEMA_FAIL',
      layer: 'QUALITY',
      reason: 'validate-schema job failed',
    });
  }

  // ── Governance layer ────────────────────────────────────────────────────
  if (invariants !== 'success') {
    if (!fs.existsSync(verifyPath)) {
      // Artifact absent: fail-closed — absence is a violation, not a skip
      violations.push({
        type: 'INVARIANT_FAIL',
        layer: 'GOVERNANCE',
        reason: 'validate-invariants failed — verify_result.json artifact absent ' +
                '(fail-closed: no artifact = total governance failure)',
      });
    } else {
      let parsed: { status?: string; violations?: GateViolation[] } = {};
      try {
        parsed = JSON.parse(fs.readFileSync(verifyPath, 'utf8')) as typeof parsed;
      } catch (e) {
        violations.push({
          type: 'INVARIANT_FAIL',
          layer: 'GOVERNANCE',
          reason: `verify_result.json parse error: ${String(e)}`,
        });
        parsed = {};
      }

      const detail: GateViolation[] = parsed.violations ?? [];
      if (detail.length === 0) {
        // Job failed but no detail: still a governance failure
        violations.push({
          type: 'INVARIANT_FAIL',
          layer: 'GOVERNANCE',
          reason: 'validate-invariants failed despite empty violation list in artifact',
        });
      } else {
        // Merge detailed violations (with fix directives) — inject GOVERNANCE layer
        for (const v of detail) {
          violations.push({ layer: 'GOVERNANCE', ...v });
        }
      }
    }
  }

  if (governance !== 'success') {
    violations.push({
      type: 'GOVERNANCE_TEST_FAIL',
      layer: 'GOVERNANCE',
      reason: 'test-governance job failed',
    });
  }

  const status: 'PASS' | 'FAIL' = violations.length === 0 ? 'PASS' : 'FAIL';
  const result: GateResult = { status, violations };
  console.log(JSON.stringify(result, null, 2));
  process.exit(status === 'PASS' ? 0 : 1);
}

main();
