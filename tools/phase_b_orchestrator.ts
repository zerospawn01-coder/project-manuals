/**
 * tools/phase_b_orchestrator.ts
 *
 * Phase B — Sandbox Verification Orchestrator
 * schema_version: phase_b/0.1
 *
 * Responsibilities:
 *   1. Pre-screen each PatchCandidate (blast_radius, schema pre-check)
 *   2. Open a sandboxed execution environment per candidate (via SandboxRunner)
 *   3. Run the three sub-proofs IN ORDER (fail-fast — first failure wins):
 *        Gate 1: invariant_check   — all INV-xxx assertions must hold
 *        Gate 2: measurable_outcome — at least one metric met-or-exceeded prediction
 *        Gate 3: no_regression      — declared regression tests must pass
 *   4. Build VerifiedPatch or RejectedPatch from the gate results
 *   5. Derive FailureLedgerWrite when the rejection pattern matches F-001..F-004
 *   6. Assemble PhaseBBatchResult and write an audit JSON to disk
 *
 * Does NOT apply patches to production — that is Phase C.
 * Does NOT call the LLM — inputs come from PhaseACandidateList.
 *
 * The three (SandboxRunner, MetricsRunner, RegressionRunner) interfaces are
 * pluggable seams; the caller injects real implementations.  Tests inject mocks.
 *
 * Imports:
 *   - PhaseACandidateList, PatchCandidate from contract/phase_a_prompt
 *   - PhaseBBatchResult, VerifiedPatch, RejectedPatch, SandboxContext,
 *     InvariantCheckResult, MeasuredOutcome, NoRegressionCheckResult,
 *     SubproofVerdict, RejectionClass, AcceptanceCriteriaSubproof
 *     from contract/phase_b_verify
 *   - FailureLedgerEntry, FailureLedgerCode, BlockedRiskyActionCode
 *     from contract/self_evolution_metrics
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { PhaseACandidateList, PatchCandidate } from '../contract/phase_a_prompt';
import type {
  PhaseBBatchResult,
  VerifiedPatch,
  RejectedPatch,
  SandboxContext,
  InvariantCheckResult,
  MeasuredOutcome,
  NoRegressionCheckResult,
  SubproofVerdict,
  RejectionClass,
} from '../contract/phase_b_verify';
import type {
  FailureLedgerEntry,
  FailureLedgerCode,
  BlockedRiskyActionCode,
} from '../contract/self_evolution_metrics';

// ---------------------------------------------------------------------------
// RUNNER INTERFACES — injected by the caller; mocked in tests
// ---------------------------------------------------------------------------

/**
 * Raw result of running a single named invariant assertion in the sandbox.
 * The runner is responsible for applying the patch_diff before checking.
 */
export interface RawInvariantResult {
  invariant_id: string;
  outcome: 'pass' | 'fail' | 'skipped';
  failure_message?: string;
  verified_by?: string;
}

/**
 * Raw metrics snapshot taken at a specific point in the sandbox.
 * Values are the ACTUAL measured quantities, not estimates.
 */
export interface RawMetricsSnapshot {
  stability_index_score: number;
  saved_time_minutes: number | null;
  tokens_saved: number | null;
  bugs_killed: number | null;
  refined_code_lines: number | null;
}

/**
 * Provenance record attached when metrics come from a real benchmark run.
 * Stored as a sidecar in the audit log (not part of the governance schema itself).
 *
 * benchmark_signature — SHA-256 of the bench script at time of run.
 *   Changing the script invalidates comparisons to prior runs (intentional).
 * measurement_env_valid — false iff the subprocess failed or returned impossible values.
 *   When false, Phase B MUST treat this as MEASUREMENT_ENV_INVALID (F-009), not PREDICTION_OVERCLAIM.
 */
export interface BenchmarkProvenance {
  benchmark_run_id: string;
  benchmark_signature: string;
  target_function: string;
  baseline_mean_ms: number | null;
  patched_mean_ms: number | null;
  delta_ms: number | null;
  delta_pct: number | null;
  measurement_env_valid: boolean;
  iterations: number;
  repetitions: number;
  env: {
    python_version: string;
    platform: string;
    cpu_count: number | null;
    benchmark_script_path: string;
  };
  error: string | null;
}

/**
 * Raw regression test run result from the sandbox.
 * The runner executes tests specified in the candidate's no_regression list.
 */
export interface RawRegressionResult {
  test_id: string;
  outcome: 'pass' | 'fail' | 'not_found';
}

/**
 * Descriptor for a single open sandbox environment.
 * The runner is responsible for setup (apply patch) and teardown (rollback).
 */
export interface SandboxHandle {
  sandbox_id: string;
  image_tag: string;
  started_at: string; // ISO-8601 UTC
  idempotency_key: string;

  /** Apply patch_diff inside the sandbox. Throws on parse error. */
  applyPatch(patch_diff: string): Promise<void>;

  /** Run invariant assertions for the listed invariant IDs. */
  runInvariants(invariant_ids: string[]): Promise<RawInvariantResult[]>;

  /** Measure the five governance metrics inside the sandbox. */
  measureMetrics(): Promise<RawMetricsSnapshot>;

  /** Run declared regression tests. */
  runRegressionTests(test_ids: string[]): Promise<RawRegressionResult[]>;

  /**
   * Optional: run static orthogonality analysis to verify that
   * the patch doesn't touch any paths covered by the regression suite.
   * Returns 'confirmed' | 'refuted' | 'unverified'.
   */
  checkOrthogonality?(): Promise<'confirmed' | 'refuted' | 'unverified'>;

  /**
   * Optional: return the BenchmarkProvenance attached to the last measureMetrics() call.
   * Present on BenchmarkSandboxHandle; undefined on passthrough/mock handles.
   */
  getProvenance?(): BenchmarkProvenance | null;

  /** Tear down the sandbox (rollback patch, free resources). */
  close(finished_at: string): Promise<void>;
}

/**
 * Factory interface: opens a SandboxHandle for one candidate evaluation.
 * Implementations may use Docker, a VM, or a local tmpdir with git-apply.
 */
export interface SandboxRunner {
  openSandbox(candidate_id: string, cycle_id: string, attempt?: number): Promise<SandboxHandle>;
}

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

export interface PhaseBConfig {
  /**
   * Maximum blast_radius that can enter the sandbox without human review.
   * 'HIGH' blast_radius → BLAST_RADIUS_EXCEEDED (skipped, quarantined).
   */
  max_allowed_blast_radius: PatchCandidate['estimated_blast_radius'];

  /**
   * Directory where per-batch audit JSON files are written.
   * null → skip disk write (useful in unit tests).
   */
  audit_log_dir: string | null;

  /**
   * Noise floor for stability_index_delta: the improvement must be at least
   * this much to count as "improvement" (avoids F-004 inflation).
   * Default: 0.01
   */
  stability_delta_noise_floor: number;
}

export const DEFAULT_PHASE_B_CONFIG: PhaseBConfig = {
  max_allowed_blast_radius: 'TENANT',
  audit_log_dir: null,
  stability_delta_noise_floor: 0.01,
};

// ---------------------------------------------------------------------------
// SECTION 1 — Gate 1: invariant_check
// ---------------------------------------------------------------------------

/**
 * Run all invariant assertions declared in the candidate's acceptance_criteria.
 * Returns the structured results and a boolean gate pass.
 *
 * Pass condition: zero 'fail' outcomes.
 * ('skipped' is permitted but does not count toward the pass.)
 */
export async function runInvariantGate(
  candidate: PatchCandidate,
  handle: SandboxHandle
): Promise<{ results: InvariantCheckResult[]; passed: boolean; first_failing_invariant: string | null }> {
  const declared_ids = candidate.acceptance_criteria.invariant_check.map((c) => c.invariant_id);

  const raw = declared_ids.length > 0
    ? await handle.runInvariants(declared_ids)
    : [];

  const results: InvariantCheckResult[] = raw.map((r) => ({
    invariant_id: r.invariant_id,
    outcome: r.outcome,
    failure_message: r.failure_message,
    verified_by: r.verified_by,
  }));

  const first_failure = results.find((r) => r.outcome === 'fail');
  return {
    results,
    passed: first_failure === undefined,
    first_failing_invariant: first_failure?.invariant_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// SECTION 2 — Gate 2: measurable_outcome
// ---------------------------------------------------------------------------

/**
 * Compare actual measured metrics against predictions in the candidate.
 *
 * Pass conditions (all must hold):
 *   a) post_patch_stability_index >= pre_patch_stability_index + stability_delta_noise_floor
 *      OR pre_patch_stability_index == 0 (initial cycle edge case)
 *   b) at least one of the four metric predictions was met-or-exceeded
 *      (or the candidate predicted none of them — orthogonality path)
 */
export function buildMeasuredOutcome(
  pre: RawMetricsSnapshot,
  post: RawMetricsSnapshot,
  candidate: PatchCandidate,
  stability_delta_noise_floor: number
): { outcome: MeasuredOutcome; passed: boolean; failure_reason: string | null } {
  const predicted = candidate.acceptance_criteria.measurable_outcome;

  function accuracy(actual: number | null, predicted_val: number | undefined): 'met' | 'missed' | 'not_predicted' {
    if (predicted_val === undefined || predicted_val === null) return 'not_predicted';
    if (actual === null) return 'missed';
    return actual >= predicted_val ? 'met' : 'missed';
  }

  const outcome: MeasuredOutcome = {
    post_patch_stability_index: post.stability_index_score,
    pre_patch_stability_index: pre.stability_index_score,
    saved_time_minutes_actual: post.saved_time_minutes,
    tokens_saved_actual: post.tokens_saved,
    bugs_killed_actual: post.bugs_killed,
    refined_code_lines_actual: post.refined_code_lines,
    prediction_accuracy: {
      saved_time_minutes: accuracy(post.saved_time_minutes, predicted.saved_time_minutes_predicted),
      tokens_saved: accuracy(post.tokens_saved, predicted.tokens_saved_predicted),
      bugs_killed: accuracy(post.bugs_killed, predicted.bugs_killed_predicted),
      refined_code_lines: accuracy(post.refined_code_lines, predicted.refined_code_lines_predicted),
    },
  };

  // Condition A: stability must not regress
  const stability_delta = post.stability_index_score - pre.stability_index_score;
  const stability_ok = pre.stability_index_score === 0
    ? true
    : stability_delta >= -stability_delta_noise_floor; // allow tiny float drift

  if (!stability_ok) {
    return {
      outcome,
      passed: false,
      failure_reason: `stability_index regressed: ${pre.stability_index_score.toFixed(4)} → ${post.stability_index_score.toFixed(4)} (delta ${stability_delta.toFixed(4)} < ${(-stability_delta_noise_floor).toFixed(4)})`,
    };
  }

  // Condition B: at least one predicted metric was met-or-exceeded,
  //             or no metrics were predicted (orthogonality path)
  const accuracy_values = Object.values(outcome.prediction_accuracy);
  const any_predicted = accuracy_values.some((v) => v !== 'not_predicted');
  const any_met = accuracy_values.some((v) => v === 'met');

  if (any_predicted && !any_met) {
    // Distinguish: all actual values null (sandbox env broken) vs real-but-low values (candidate overclaim)
    const all_actuals_null =
      post.saved_time_minutes === null &&
      post.tokens_saved === null &&
      post.bugs_killed === null &&
      post.refined_code_lines === null;
    return {
      outcome,
      passed: false,
      failure_reason: all_actuals_null
        ? `measurement_env_invalid: sandbox returned all-null metrics (${JSON.stringify(outcome.prediction_accuracy)})`
        : `no predicted metric was met: ${JSON.stringify(outcome.prediction_accuracy)}`,
    };
  }

  return { outcome, passed: true, failure_reason: null };
}

// ---------------------------------------------------------------------------
// SECTION 3 — Gate 3: no_regression
// ---------------------------------------------------------------------------

/**
 * Run declared regression tests and optionally verify orthogonality.
 *
 * Pass conditions:
 *   a) tests_failed is empty
 *   b) If orthogonality_claimed AND orthogonality_verification = 'refuted' → FAIL
 */
export async function runNoRegressionGate(
  candidate: PatchCandidate,
  handle: SandboxHandle
): Promise<{ result: NoRegressionCheckResult; passed: boolean; failure_reason: string | null }> {
  const no_reg = candidate.acceptance_criteria.no_regression;
  const declared_ids = no_reg.regression_test_ids_verified_pass ?? [];
  const orthogonality_claimed = declared_ids.length === 0 && !!no_reg.orthogonality_rationale;

  let tests_passed: string[] = [];
  let tests_failed: string[] = [];
  let tests_not_found: string[] = [];

  if (declared_ids.length > 0) {
    const raw = await handle.runRegressionTests(declared_ids);
    for (const r of raw) {
      if (r.outcome === 'pass') tests_passed.push(r.test_id);
      else if (r.outcome === 'fail') tests_failed.push(r.test_id);
      else tests_not_found.push(r.test_id);
    }
  }

  let orthogonality_verification: 'confirmed' | 'unverified' | 'refuted' = 'unverified';
  if (orthogonality_claimed && handle.checkOrthogonality) {
    orthogonality_verification = await handle.checkOrthogonality();
  }

  const result: NoRegressionCheckResult = {
    tests_passed,
    tests_failed,
    tests_not_found,
    orthogonality_claimed,
    orthogonality_verification,
  };

  if (tests_failed.length > 0) {
    return {
      result,
      passed: false,
      failure_reason: `regression tests failed: [${tests_failed.join(', ')}]`,
    };
  }
  if (orthogonality_claimed && orthogonality_verification === 'refuted') {
    return {
      result,
      passed: false,
      failure_reason: 'orthogonality_rationale claimed but static analysis refuted it',
    };
  }

  return { result, passed: true, failure_reason: null };
}

// ---------------------------------------------------------------------------
// SECTION 4 — Failure Ledger Write derivation
// ---------------------------------------------------------------------------

/**
 * Apply the four-rule decision table from phase_b_verify.d.ts to derive
 * a FailureLedgerWrite instruction for a rejected patch.
 *
 * Returns null when no rule matches (one-off rejection, no pattern).
 *
 * Rule priority (first match wins):
 *   1  F-001_SECURITY_DOWNGRADE   — INVARIANT_VIOLATION on security invariants
 *   2  F-002_DEPENDENCY_IGNORE_DELETE — REGRESSION_TEST_FAILURE + affected_targets has delete
 *   3  F-003_CONTEXT_REGRESSION   — INVARIANT_VIOLATION + same invariant already in active ledger
 *   4  F-004_METRIC_INFLATION     — PREDICTION_OVERCLAIM + predicted > 0
 *   5  F-009_MEASUREMENT_ENV_INVALID — MEASUREMENT_ENV_INVALID (sandbox broken; no candidate blame)
 */
export function deriveFailureLedgerWrite(
  rejection_class: RejectionClass,
  candidate: PatchCandidate,
  first_failing_invariant: string | null,
  active_failure_ledger: FailureLedgerEntry[]
): { code: FailureLedgerCode; negative_constraint: string } | null {

  // Security invariants (INV-003 and INV-005 per phase_b_verify contract Rule 1)
  const SECURITY_INVARIANTS = new Set(['INV-003', 'INV-005']);

  // Rule 1
  if (
    rejection_class === 'INVARIANT_VIOLATION' &&
    first_failing_invariant !== null &&
    SECURITY_INVARIANTS.has(first_failing_invariant)
  ) {
    return {
      code: 'F-001_SECURITY_DOWNGRADE',
      negative_constraint: `Do not modify execution paths that involve approval tokens or fail-closed guards (${first_failing_invariant} violated).`,
    };
  }

  // Rule 2
  if (rejection_class === 'REGRESSION_TEST_FAILURE') {
    const has_delete = candidate.affected_targets.some((t) =>
      typeof t === 'object' && (t as { change_type?: string }).change_type === 'delete'
    );
    if (has_delete) {
      return {
        code: 'F-002_DEPENDENCY_IGNORE_DELETE',
        negative_constraint: `Patches that delete dependencies must not break existing regression tests. Validate all consumers before removing.`,
      };
    }
  }

  // Rule 3
  if (
    rejection_class === 'INVARIANT_VIOLATION' &&
    first_failing_invariant !== null
  ) {
    const already_in_ledger = active_failure_ledger.some(
      (e) =>
        e.code === 'F-003_CONTEXT_REGRESSION' &&
        e.negative_constraint.includes(first_failing_invariant)
    );
    if (already_in_ledger) {
      return {
        code: 'F-003_CONTEXT_REGRESSION',
        negative_constraint: `Invariant ${first_failing_invariant} has failed repeatedly. Do not propose patches that touch paths covered by this invariant without first confirming root cause.`,
      };
    }
  }

  // Rule 4 — PREDICTION_OVERCLAIM: candidate claimed improvement but sandbox measured less
  if (rejection_class === 'PREDICTION_OVERCLAIM') {
    const predicted = candidate.acceptance_criteria.measurable_outcome;
    const claimed_positive = (predicted.saved_time_minutes_predicted ?? 0) > 0;
    if (claimed_positive) {
      return {
        code: 'F-004_METRIC_INFLATION',
        negative_constraint: `Patch claimed saved_time_minutes improvement but delivered none. Do not predict time savings unless workflow execution data supports the claim.`,
      };
    }
  }

  // Rule 5 — MEASUREMENT_ENV_INVALID: sandbox returned broken metrics; not the candidate's fault
  if (rejection_class === 'MEASUREMENT_ENV_INVALID') {
    return {
      code: 'F-009_MEASUREMENT_ENV_INVALID',
      negative_constraint: `Measurement environment was invalid during evaluation (all metrics returned null). This entry records the infra event; no candidate constraint implied.`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// SECTION 5 — Block Event derivation
// ---------------------------------------------------------------------------

/**
 * Derive the block event that must be written to blocked_risky_actions.
 * Returns null for SANDBOX_EXECUTION_ERROR (infrastructure failure, not a policy block).
 */
export function deriveBlockEvent(
  rejection_class: RejectionClass,
  candidate: PatchCandidate,
  first_failing_invariant: string | null,
  rejected_at: string
): RejectedPatch['block_event'] {
  if (rejection_class === 'SANDBOX_EXECUTION_ERROR') return null;

  const code_map: Partial<Record<RejectionClass, BlockedRiskyActionCode>> = {
    INVARIANT_VIOLATION: 'INV_VIOLATION_REJECT',
    STABILITY_REGRESSION: 'PROMOTION_GATE_FAIL',
    REGRESSION_TEST_FAILURE: 'PROMOTION_GATE_FAIL',
    NO_MEASURABLE_IMPROVEMENT: 'PROMOTION_GATE_FAIL',
    PREDICTION_OVERCLAIM: 'PROMOTION_GATE_FAIL',
    MEASUREMENT_ENV_INVALID: 'PROMOTION_GATE_FAIL',
    BLAST_RADIUS_EXCEEDED: 'BLAST_RADIUS_QUARANTINE',
  };

  const event_code = code_map[rejection_class];
  if (!event_code) return null;

  return {
    event_code,
    ...(rejection_class === 'INVARIANT_VIOLATION' && first_failing_invariant
      ? { invariant_id: first_failing_invariant }
      : {}),
    patch_id: candidate.candidate_id,
    reason: `Phase B rejection: ${rejection_class}`,
    ts: rejected_at,
  };
}

// ---------------------------------------------------------------------------
// SECTION 6 — Single-candidate runner
// ---------------------------------------------------------------------------

export interface SingleCandidateResult {
  type: 'verified' | 'rejected' | 'skipped';
  verified?: VerifiedPatch;
  rejected?: RejectedPatch;
  skipped?: { candidate_id: string; reason: string };
}

/**
 * Run Phase B for a single PatchCandidate.
 *
 * Execution sequence:
 *   1. Pre-screen: empty patch_diff, schema issues, blast_radius cap
 *   2. Open sandbox (idempotency_key guarantees at-most-once per cycle)
 *   3. Measure pre-patch metrics baseline
 *   4. Apply patch inside sandbox
 *   5. Gate 1 — invariant_check
 *   6. Gate 2 — measurable_outcome (requires pre + post measurement)
 *   7. Gate 3 — no_regression
 *   8. Build VerifiedPatch or RejectedPatch
 *   9. Close sandbox (rollback always applied regardless of outcome)
 */
export async function runPhaseBForCandidate(
  candidate: PatchCandidate,
  sandbox_runner: SandboxRunner,
  active_failure_ledger: FailureLedgerEntry[],
  config: PhaseBConfig
): Promise<SingleCandidateResult> {

  // --- Pre-screen 1: empty patch_diff ---
  if (!candidate.patch_diff || candidate.patch_diff.trim().length === 0) {
    return {
      type: 'skipped',
      skipped: { candidate_id: candidate.candidate_id, reason: 'patch_diff is empty' },
    };
  }

  // --- Pre-screen 2: blast_radius cap ---
  const blast_order: Record<PatchCandidate['estimated_blast_radius'], number> = {
    SELF: 0, TENANT: 1, GLOBAL: 2,
  };
  const allowed_rank = blast_order[config.max_allowed_blast_radius];
  const candidate_rank = blast_order[candidate.estimated_blast_radius];
  if (candidate_rank > allowed_rank) {
    const rejected_at = new Date().toISOString();
    const rejection_class: RejectionClass = 'BLAST_RADIUS_EXCEEDED';
    const block_event = deriveBlockEvent(rejection_class, candidate, null, rejected_at);
    const rejected: RejectedPatch = {
      schema_version: 'phase_b_rejected/0.1',
      candidate_id: candidate.candidate_id,
      cycle_id: candidate.cycle_id,
      rejected_at,
      source_candidate: candidate,
      sandbox: buildNoopSandboxContext(candidate.candidate_id, candidate.cycle_id, 1),
      rejection_class,
      rejection_detail: `blast_radius '${candidate.estimated_blast_radius}' exceeds configured maximum '${config.max_allowed_blast_radius}'`,
      subproof_verdicts: [
        { subproof: 'invariant_check', outcome: 'skipped', failure_reason: 'blast_radius pre-screen rejected candidate before sandbox entry' },
        { subproof: 'measurable_outcome', outcome: 'skipped' },
        { subproof: 'no_regression', outcome: 'skipped' },
      ],
      block_event,
      failure_ledger_write: null,
      partial_measured_outcome: {},
    };
    return { type: 'rejected', rejected };
  }

  // --- Open sandbox ---
  let handle: SandboxHandle;
  try {
    handle = await sandbox_runner.openSandbox(candidate.candidate_id, candidate.cycle_id, 1);
  } catch (err) {
    const rejected_at = new Date().toISOString();
    const rejected: RejectedPatch = {
      schema_version: 'phase_b_rejected/0.1',
      candidate_id: candidate.candidate_id,
      cycle_id: candidate.cycle_id,
      rejected_at,
      source_candidate: candidate,
      sandbox: buildNoopSandboxContext(candidate.candidate_id, candidate.cycle_id, 1, rejected_at),
      rejection_class: 'SANDBOX_EXECUTION_ERROR',
      rejection_detail: `sandbox open failed: ${(err as Error).message}`,
      subproof_verdicts: [
        { subproof: 'invariant_check', outcome: 'skipped', failure_reason: 'sandbox unavailable' },
        { subproof: 'measurable_outcome', outcome: 'skipped' },
        { subproof: 'no_regression', outcome: 'skipped' },
      ],
      block_event: null,
      failure_ledger_write: null,
      partial_measured_outcome: {},
    };
    return { type: 'rejected', rejected };
  }

  const verdicts: SubproofVerdict[] = [];
  let rejection_class: RejectionClass | null = null;
  let rejection_detail = '';
  let first_failing_invariant: string | null = null;
  let invariant_results: ReturnType<typeof runInvariantGate> extends Promise<infer R> ? R : never =
    { results: [], passed: true, first_failing_invariant: null };
  let measured_outcome_result: ReturnType<typeof buildMeasuredOutcome> | null = null;
  let no_regression_result: ReturnType<typeof runNoRegressionGate> extends Promise<infer R> ? R : never =
    { result: { tests_passed: [], tests_failed: [], tests_not_found: [], orthogonality_claimed: false, orthogonality_verification: 'unverified' }, passed: true, failure_reason: null };
  let pre_snapshot: RawMetricsSnapshot | null = null;
  let post_snapshot: RawMetricsSnapshot | null = null;

  try {
    // Measure pre-patch baseline
    pre_snapshot = await handle.measureMetrics();

    // Apply patch inside sandbox
    await handle.applyPatch(candidate.patch_diff);

    // Gate 1 — invariant_check
    invariant_results = await runInvariantGate(candidate, handle);
    verdicts.push({
      subproof: 'invariant_check',
      outcome: invariant_results.passed ? 'pass' : 'fail',
      failure_reason: invariant_results.passed ? undefined : `${invariant_results.first_failing_invariant} failed`,
    });

    if (!invariant_results.passed) {
      rejection_class = 'INVARIANT_VIOLATION';
      first_failing_invariant = invariant_results.first_failing_invariant;
      rejection_detail = `${first_failing_invariant} returned false in sandbox`;
      verdicts.push({ subproof: 'measurable_outcome', outcome: 'skipped' });
      verdicts.push({ subproof: 'no_regression', outcome: 'skipped' });
    } else {
      // Gate 2 — measurable_outcome
      post_snapshot = await handle.measureMetrics();
      measured_outcome_result = buildMeasuredOutcome(
        pre_snapshot,
        post_snapshot,
        candidate,
        config.stability_delta_noise_floor
      );
      verdicts.push({
        subproof: 'measurable_outcome',
        outcome: measured_outcome_result.passed ? 'pass' : 'fail',
        failure_reason: measured_outcome_result.failure_reason ?? undefined,
      });

      if (!measured_outcome_result.passed) {
        // Determine exact rejection class:
        //   STABILITY_REGRESSION  — stability index dropped
        //   MEASUREMENT_ENV_INVALID — sandbox returned all-null metrics (broken env)
        //   PREDICTION_OVERCLAIM    — real metrics measured but below candidate's prediction
        const mo = measured_outcome_result.outcome;
        if (mo.post_patch_stability_index < mo.pre_patch_stability_index) {
          rejection_class = 'STABILITY_REGRESSION';
        } else if (measured_outcome_result.failure_reason?.startsWith('measurement_env_invalid:')) {
          rejection_class = 'MEASUREMENT_ENV_INVALID';
        } else {
          rejection_class = 'PREDICTION_OVERCLAIM';
        }
        rejection_detail = measured_outcome_result.failure_reason ?? 'measurable_outcome gate failed';
        verdicts.push({ subproof: 'no_regression', outcome: 'skipped' });
      } else {
        // Gate 3 — no_regression
        const reg_run = await runNoRegressionGate(candidate, handle);
        no_regression_result = reg_run;
        verdicts.push({
          subproof: 'no_regression',
          outcome: reg_run.passed ? 'pass' : 'fail',
          failure_reason: reg_run.failure_reason ?? undefined,
        });

        if (!reg_run.passed) {
          rejection_class = 'REGRESSION_TEST_FAILURE';
          rejection_detail = reg_run.failure_reason ?? 'no_regression gate failed';
        }
      }
    }
  } catch (err) {
    rejection_class = 'SANDBOX_EXECUTION_ERROR';
    rejection_detail = `sandbox execution error: ${(err as Error).message}`;
    // Ensure all three verdicts are present in the record
    while (verdicts.length < 3) {
      const labels: SubproofVerdict['subproof'][] = ['invariant_check', 'measurable_outcome', 'no_regression'];
      verdicts.push({ subproof: labels[verdicts.length]!, outcome: 'skipped', failure_reason: 'sandbox error' });
    }
  }

  const finished_at = new Date().toISOString();
  await handle.close(finished_at);

  const sandbox_ctx: SandboxContext = {
    image_tag: handle.image_tag,
    started_at: handle.started_at,
    finished_at,
    duration_ms: Date.parse(finished_at) - Date.parse(handle.started_at),
    idempotency_key: handle.idempotency_key,
  };

  // -------------------------------------------------------------------------
  // All gates passed → VerifiedPatch
  // -------------------------------------------------------------------------
  if (rejection_class === null && measured_outcome_result !== null) {
    const mo = measured_outcome_result.outcome;
    const acc = mo.prediction_accuracy;

    const confirmed_improvements = {
      saved_time_minutes:
        acc.saved_time_minutes === 'met' && mo.saved_time_minutes_actual !== null && mo.saved_time_minutes_actual > 0
          ? mo.saved_time_minutes_actual
          : null,
      tokens_saved:
        acc.tokens_saved === 'met' && mo.tokens_saved_actual !== null && mo.tokens_saved_actual > 0
          ? mo.tokens_saved_actual
          : null,
      bugs_killed:
        acc.bugs_killed === 'met' && mo.bugs_killed_actual !== null && mo.bugs_killed_actual > 0
          ? mo.bugs_killed_actual
          : null,
      refined_code_lines:
        acc.refined_code_lines === 'met' && mo.refined_code_lines_actual !== null && mo.refined_code_lines_actual > 0
          ? mo.refined_code_lines_actual
          : null,
    };

    const verified: VerifiedPatch = {
      schema_version: 'phase_b_verified/0.1',
      candidate_id: candidate.candidate_id,
      cycle_id: candidate.cycle_id,
      verified_at: finished_at,
      source_candidate: candidate,
      sandbox: sandbox_ctx,
      invariant_check_results: invariant_results.results,
      measured_outcome: mo,
      no_regression_result: no_regression_result.result,
      confirmed_improvements,
      stability_index_delta: mo.post_patch_stability_index - mo.pre_patch_stability_index,
    };
    return { type: 'verified', verified };
  }

  // -------------------------------------------------------------------------
  // At least one gate failed → RejectedPatch
  // -------------------------------------------------------------------------
  const final_rejection_class: RejectionClass = rejection_class ?? 'SANDBOX_EXECUTION_ERROR';
  const rejected_at = finished_at;

  const block_event = deriveBlockEvent(
    final_rejection_class,
    candidate,
    first_failing_invariant,
    rejected_at
  );

  const failure_ledger_write = deriveFailureLedgerWrite(
    final_rejection_class,
    candidate,
    first_failing_invariant,
    active_failure_ledger
  );

  const partial: Partial<import('../contract/phase_b_verify').MeasuredOutcome> = {};
  if (measured_outcome_result) {
    Object.assign(partial, measured_outcome_result.outcome);
  } else if (pre_snapshot) {
    partial.pre_patch_stability_index = pre_snapshot.stability_index_score;
  }

  const rejected: RejectedPatch = {
    schema_version: 'phase_b_rejected/0.1',
    candidate_id: candidate.candidate_id,
    cycle_id: candidate.cycle_id,
    rejected_at,
    source_candidate: candidate,
    sandbox: sandbox_ctx,
    rejection_class: final_rejection_class,
    rejection_detail,
    subproof_verdicts: verdicts,
    block_event,
    failure_ledger_write,
    partial_measured_outcome: partial,
  };
  return { type: 'rejected', rejected };
}

// ---------------------------------------------------------------------------
// HELPER — build a placeholder SandboxContext for pre-sandbox blocks
// ---------------------------------------------------------------------------

function buildNoopSandboxContext(
  candidate_id: string,
  cycle_id: string,
  attempt: number,
  ts?: string
): SandboxContext {
  const now = ts ?? new Date().toISOString();
  return {
    image_tag: 'none',
    started_at: now,
    finished_at: now,
    duration_ms: 0,
    idempotency_key: `${cycle_id}:${candidate_id}:${attempt}`,
  };
}

// ---------------------------------------------------------------------------
// SECTION 7 — Batch runner
// ---------------------------------------------------------------------------

/**
 * Run Phase B for all candidates in a PhaseACandidateList.
 *
 * Candidates are evaluated SEQUENTIALLY to avoid sandbox resource contention.
 * (Parallel evaluation is a Phase B v0.2 concern and requires explicit config opt-in.)
 *
 * If audit_log_dir is set, writes a JSON audit file:
 *   `<audit_log_dir>/phase_b_batch_<batch_id>.json`
 *
 * @throws Never — all errors are caught and recorded as SANDBOX_EXECUTION_ERROR.
 */
export async function runPhaseBBatch(
  candidate_list: PhaseACandidateList,
  sandbox_runner: SandboxRunner,
  active_failure_ledger: FailureLedgerEntry[],
  config: Partial<PhaseBConfig> = {}
): Promise<PhaseBBatchResult> {
  const resolved_config: PhaseBConfig = { ...DEFAULT_PHASE_B_CONFIG, ...config };

  const batch_id = randomUUID();
  const evaluated_at = new Date().toISOString();

  const verified: VerifiedPatch[] = [];
  const rejected: RejectedPatch[] = [];
  const skipped: PhaseBBatchResult['skipped'] = [];

  // Run each candidate sequentially
  for (const candidate of candidate_list.candidates) {
    const result = await runPhaseBForCandidate(
      candidate,
      sandbox_runner,
      active_failure_ledger,
      resolved_config
    );

    if (result.type === 'verified' && result.verified) {
      verified.push(result.verified);
    } else if (result.type === 'rejected' && result.rejected) {
      rejected.push(result.rejected);
    } else if (result.type === 'skipped' && result.skipped) {
      skipped.push(result.skipped);
    }
  }

  const failure_ledger_writes_pending = rejected.some((r) => r.failure_ledger_write !== null);
  const blocked_risky_actions_count = rejected.filter((r) => r.block_event !== null).length;

  const batch: PhaseBBatchResult = {
    schema_version: 'phase_b_batch/0.1',
    cycle_id: candidate_list.cycle_id,
    batch_id,
    evaluated_at,
    verified,
    rejected,
    skipped,
    summary: {
      total_evaluated: candidate_list.candidates.length,
      verified_count: verified.length,
      rejected_count: rejected.length,
      skipped_count: skipped.length,
      failure_ledger_writes_pending,
      blocked_risky_actions_count,
    },
  };

  // Write audit log
  if (resolved_config.audit_log_dir) {
    try {
      fs.mkdirSync(resolved_config.audit_log_dir, { recursive: true });
      const out_path = path.join(resolved_config.audit_log_dir, `phase_b_batch_${batch_id}.json`);
      fs.writeFileSync(out_path, JSON.stringify(batch, null, 2), 'utf8');
    } catch (_) {
      // Audit log write failure must never crash the orchestrator
    }
  }

  return batch;
}

// ---------------------------------------------------------------------------
// SECTION 8 — Structural pre-validator
// ---------------------------------------------------------------------------

/**
 * Quickly validate that a raw object looks like a PhaseBBatchResult before
 * downstream consumers rely on it.  Returns an array of error strings.
 * Empty array means the object passed the structural check.
 */
export function validatePhaseBBatchResultShell(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    errors.push('result is not an object');
    return errors;
  }
  const r = raw as Record<string, unknown>;

  if (r['schema_version'] !== 'phase_b_batch/0.1') {
    errors.push(`schema_version: expected 'phase_b_batch/0.1', got ${String(r['schema_version'])}`);
  }
  if (typeof r['cycle_id'] !== 'string' || r['cycle_id'].length === 0) {
    errors.push('cycle_id: missing or empty');
  }
  if (!Array.isArray(r['verified'])) errors.push('verified: must be an array');
  if (!Array.isArray(r['rejected'])) errors.push('rejected: must be an array');
  if (!Array.isArray(r['skipped'])) errors.push('skipped: must be an array');

  if (typeof r['summary'] !== 'object' || r['summary'] === null) {
    errors.push('summary: missing');
  } else {
    const s = r['summary'] as Record<string, unknown>;
    for (const field of ['total_evaluated', 'verified_count', 'rejected_count', 'skipped_count', 'blocked_risky_actions_count']) {
      if (typeof s[field] !== 'number') {
        errors.push(`summary.${field}: must be a number`);
      }
    }
    if (typeof s['failure_ledger_writes_pending'] !== 'boolean') {
      errors.push('summary.failure_ledger_writes_pending: must be a boolean');
    }
  }

  return errors;
}
