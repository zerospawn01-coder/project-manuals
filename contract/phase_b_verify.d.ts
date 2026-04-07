/**
 * contract/phase_b_verify.d.ts
 *
 * Phase B — Sandbox Verification Output Contract
 * Schema version: phase_b/0.1
 *
 * Defines the exit records produced after a PatchCandidate has been
 * evaluated inside the isolated sandbox environment.
 *
 * Every candidate that enters TESTING must exit as EXACTLY ONE of:
 *   - VerifiedPatch  (all three acceptance-criteria sub-proofs PASS)
 *   - RejectedPatch  (at least one sub-proof FAILS or a safety gate fires)
 *
 * Downstream consumers:
 *   - VerifiedPatch  → PROMOTING gate → ProofSummary.verified_patch_count
 *   - RejectedPatch  → blocked_risky_actions bookkeeping
 *                    → FailureLedger write (when rejection_class maps to a ledger code)
 *                    → ProofSummary.blocked_risky_actions
 *
 * Imports:
 *   - PatchCandidate, PatchCandidateAcceptanceCriteria from ./phase_a_prompt
 *   - BlockedRiskyActionCode, FailureLedgerCode from ./self_evolution_metrics
 */

import type { PatchCandidate, PatchCandidateAcceptanceCriteria } from './phase_a_prompt';
import type { BlockedRiskyActionCode, FailureLedgerCode } from './self_evolution_metrics';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** The three sub-proof labels from PatchCandidateAcceptanceCriteria. */
export type AcceptanceCriteriaSubproof =
  | 'invariant_check'
  | 'measurable_outcome'
  | 'no_regression';

/** Sandbox execution environment descriptor. */
export interface SandboxContext {
  /** Container / VM image tag used for this run. */
  image_tag: string;
  /** ISO-8601 UTC timestamp when the sandbox was started. */
  started_at: string;
  /** ISO-8601 UTC timestamp when the sandbox was torn down. */
  finished_at: string;
  /** Wall-clock duration in milliseconds. */
  duration_ms: number;
  /**
   * Idempotency key — ensures one candidate is evaluated at most once
   * per cycle even on retries.
   * Format: `{cycle_id}:{candidate_id}:{attempt_number}`
   */
  idempotency_key: string;
}

// ---------------------------------------------------------------------------
// Sub-proof verification results (actual, not predicted)
// ---------------------------------------------------------------------------

/** Actual result of running invariant assertions in the sandbox. */
export interface InvariantCheckResult {
  invariant_id: string;
  /**
   * Whether the invariant held after the patch was applied.
   * `skipped` is only allowed when verdict = 'untouched' was declared in
   * acceptance_criteria AND the sandbox confirms no touched code paths.
   */
  outcome: 'pass' | 'fail' | 'skipped';
  /** When outcome = 'fail': the assertion error message. */
  failure_message?: string;
  /** When outcome = 'pass': the test / assertion ID that verified it. */
  verified_by?: string;
}

/** Actual measured outcome after applying the patch. */
export interface MeasuredOutcome {
  /**
   * Actual post-patch stability_index.score computed by the sandbox
   * using the GOVERNANCE_METRICS_DEFINITION.md §1 formula.
   * Must be >= pre_patch_stability_index for the patch to pass.
   */
  post_patch_stability_index: number;
  pre_patch_stability_index: number;

  /** Actual saved_time_minutes measured under §2 conditions. null if not applicable. */
  saved_time_minutes_actual: number | null;
  /** Actual tokens_saved measured under §3 conditions. null if not applicable. */
  tokens_saved_actual: number | null;
  /** Actual bugs_killed count under §4 conditions. null if not applicable. */
  bugs_killed_actual: number | null;
  /** Actual refined_code_lines count under §5 conditions. null if not applicable. */
  refined_code_lines_actual: number | null;

  /**
   * Comparison against predictions in acceptance_criteria.measurable_outcome.
   * Each field is true when actual >= predicted (any metric with prediction).
   */
  prediction_accuracy: {
    saved_time_minutes: 'met' | 'missed' | 'not_predicted';
    tokens_saved: 'met' | 'missed' | 'not_predicted';
    bugs_killed: 'met' | 'missed' | 'not_predicted';
    refined_code_lines: 'met' | 'missed' | 'not_predicted';
  };
}

/** Actual regression test run results. */
export interface NoRegressionCheckResult {
  /**
   * Tests from acceptance_criteria.no_regression.regression_test_ids_verified_pass
   * that actually passed in the sandbox.
   */
  tests_passed: string[];
  /**
   * Tests that were expected to pass but failed.
   * Non-empty → this sub-proof FAILS.
   */
  tests_failed: string[];
  /**
   * Tests from the declared list that could not be located in the sandbox
   * (bad test ID). Non-empty → WARN; does not fail the sub-proof on its own
   * but is surfaced to the operator.
   */
  tests_not_found: string[];
  /**
   * Whether the orthogonality_rationale path was taken.
   * True only when regression_test_ids_verified_pass was empty AND
   * orthogonality_rationale was non-empty.
   */
  orthogonality_claimed: boolean;
  /**
   * When orthogonality_claimed = true: result of automated orthogonality
   * verification (static analysis / coverage check).
   * `unverified` means the sandbox ran no automated check — counts as WARN.
   */
  orthogonality_verification: 'confirmed' | 'unverified' | 'refuted';
}

// ---------------------------------------------------------------------------
// VerifiedPatch — passed all three sub-proofs
// ---------------------------------------------------------------------------

/**
 * A PatchCandidate that passed all three acceptance-criteria sub-proofs
 * and all safety gates in the isolation sandbox.
 *
 * A VerifiedPatch is ready to enter the PROMOTING gate.
 * It contributes to ProofSummary.verified_patch_count.
 */
export interface VerifiedPatch {
  schema_version: 'phase_b_verified/0.1';

  /** Immutable reference to the input. */
  candidate_id: string;
  cycle_id: string;
  verified_at: string; // ISO-8601 UTC

  /** The original candidate (snapshot for audit — must not be mutated). */
  source_candidate: PatchCandidate;

  sandbox: SandboxContext;

  /** §sub-proof 1: all invariants passed or legitimately skipped. */
  invariant_check_results: InvariantCheckResult[];

  /** §sub-proof 2: at least one metric met or exceeded prediction. */
  measured_outcome: MeasuredOutcome;

  /** §sub-proof 3: no declared regression test failed. */
  no_regression_result: NoRegressionCheckResult;

  /**
   * Verified improvement values — these are the ACTUAL numbers that flow
   * into ProofSummary fields after PROMOTING gate passes.
   * Populated only for metrics where actual > 0 AND prediction was met.
   */
  confirmed_improvements: {
    saved_time_minutes: number | null;
    tokens_saved: number | null;
    bugs_killed: number | null;
    refined_code_lines: number | null;
  };

  /**
   * Post-patch stability_index delta (actual).
   *   post_patch_stability_index - pre_patch_stability_index
   * Negative is impossible here (a VerifiedPatch must have delta >= 0).
   */
  stability_index_delta: number;
}

// ---------------------------------------------------------------------------
// RejectedPatch — failed at least one gate
// ---------------------------------------------------------------------------

/**
 * Classification of why a patch was rejected.
 * Used to determine whether the rejection triggers a FailureLedger write.
 */
export type RejectionClass =
  /** INV-xxx check returned false in sandbox. → F-001 or F-003 candidate. */
  | 'INVARIANT_VIOLATION'
  /** stability_index.score dropped below pre-patch level. → F-002 or F-004 candidate. */
  | 'STABILITY_REGRESSION'
  /** Declared regression test(s) failed in sandbox. → F-002 candidate. */
  | 'REGRESSION_TEST_FAILURE'
  /** Measured improvement missed all predicted values (no net benefit). */
  | 'NO_MEASURABLE_IMPROVEMENT'
  /**
   * Candidate predicted X but sandbox measured < X.
   * The candidate over-claimed its benefit (candidate's fault).
   * → F-004_METRIC_INFLATION negative constraint injected.
   */
  | 'PREDICTION_OVERCLAIM'
  /**
   * Sandbox returned all-null or impossible metric values.
   * The measurement environment itself is invalid — not the candidate's fault.
   * → F-009_MEASUREMENT_ENV_INVALID; no negative constraint on the candidate.
   */
  | 'MEASUREMENT_ENV_INVALID'
  /** blast_radius exceeded allowed level for the current risk_level. */
  | 'BLAST_RADIUS_EXCEEDED'
  /** Sandbox itself failed to execute (infrastructure error, not a patch problem). */
  | 'SANDBOX_EXECUTION_ERROR';

/**
 * Maps RejectionClass to the BlockedRiskyActionCode it generates.
 * SANDBOX_EXECUTION_ERROR does not produce a block event (it is an infra event).
 */
export type RejectionClassToBlockCode = {
  INVARIANT_VIOLATION: 'INV_VIOLATION_REJECT';
  STABILITY_REGRESSION: 'PROMOTION_GATE_FAIL';
  REGRESSION_TEST_FAILURE: 'PROMOTION_GATE_FAIL';
  NO_MEASURABLE_IMPROVEMENT: 'PROMOTION_GATE_FAIL';
  PREDICTION_OVERCLAIM: 'PROMOTION_GATE_FAIL';
  MEASUREMENT_ENV_INVALID: 'PROMOTION_GATE_FAIL';
  BLAST_RADIUS_EXCEEDED: 'BLAST_RADIUS_QUARANTINE';
  SANDBOX_EXECUTION_ERROR: null;
};

/**
 * Per-sub-proof verdict pair — predicted vs actual.
 * Used in the rejection audit trail.
 */
export interface SubproofVerdict {
  subproof: AcceptanceCriteriaSubproof;
  /** 'pass' | 'fail' | 'skipped' — outcome in the sandbox. */
  outcome: 'pass' | 'fail' | 'skipped';
  /** Concise reason when outcome = 'fail'. */
  failure_reason?: string;
}

/**
 * A PatchCandidate that failed at least one gate during sandbox verification.
 *
 * A RejectedPatch:
 *   1. Is recorded as a blocked_risky_actions event in the ProofSummary
 *      (unless rejection_class = SANDBOX_EXECUTION_ERROR).
 *   2. May trigger a FailureLedger write when the pattern matches F-001..F-004.
 *   3. Is permanently archived — NOT retried in the same cycle.
 */
export interface RejectedPatch {
  schema_version: 'phase_b_rejected/0.1';

  /** Immutable reference to the input. */
  candidate_id: string;
  cycle_id: string;
  rejected_at: string; // ISO-8601 UTC

  /** The original candidate (snapshot for audit). */
  source_candidate: PatchCandidate;

  sandbox: SandboxContext;

  /** Primary reason for rejection (the first failing gate wins). */
  rejection_class: RejectionClass;

  /**
   * Verbatim description of the failure — must reference concrete values,
   * not subjective assessments.
   * e.g. "INV-003 returned false: approval token missing in executor path"
   */
  rejection_detail: string;

  /** Verdict for each sub-proof attempted before rejection was determined. */
  subproof_verdicts: SubproofVerdict[];

  /**
   * The block event written to blocked_risky_actions.
   * null only when rejection_class = SANDBOX_EXECUTION_ERROR.
   */
  block_event: {
    event_code: BlockedRiskyActionCode;
    invariant_id?: string;   // when event_code = INV_VIOLATION_REJECT
    patch_id: string;        // candidate_id
    reason: string;
    ts: string;              // ISO-8601 UTC = rejected_at
  } | null;

  /**
   * FailureLedger write instruction.
   * Present when this rejection matches an F-xxx pattern.
   * Absent (null) when the rejection is a one-off (no pattern detected).
   *
   * The Phase B orchestrator MUST write this to the failure_ledger before
   * the cycle completes — it is not optional.
   */
  failure_ledger_write: {
    code: FailureLedgerCode;
    negative_constraint: string;
  } | null;

  /**
   * Actual measurement snapshot at point of rejection.
   * Partial — only fields measured before the gate fired are populated.
   * Used for audit; NOT used for ProofSummary metric accumulation.
   */
  partial_measured_outcome: Partial<MeasuredOutcome>;
}

// ---------------------------------------------------------------------------
// Phase B batch result — one per cycle run
// ---------------------------------------------------------------------------

/**
 * Aggregate result of one Phase B (TESTING) run.
 * Contains the full disposition of every candidate that entered the sandbox.
 */
export interface PhaseBBatchResult {
  schema_version: 'phase_b_batch/0.1';
  cycle_id: string;
  batch_id: string;  // UUID
  evaluated_at: string;  // ISO-8601 UTC

  verified: VerifiedPatch[];
  rejected: RejectedPatch[];

  /**
   * Candidates from PhaseACandidateList that could not enter the sandbox
   * at all (e.g., patch_diff was empty, schema pre-check failed).
   * These are distinct from RejectedPatch because no sandbox run occurred.
   */
  skipped: Array<{
    candidate_id: string;
    reason: string;
  }>;

  summary: {
    total_evaluated: number;
    verified_count: number;
    rejected_count: number;
    skipped_count: number;
    /**
     * Whether any FailureLedger writes are pending from this batch.
     * True when at least one RejectedPatch has a non-null failure_ledger_write.
     */
    failure_ledger_writes_pending: boolean;
    /**
     * Sum of blocked_risky_actions events generated by this batch.
     * Feeds directly into ProofSummary.blocked_risky_actions.count.
     */
    blocked_risky_actions_count: number;
  };
}

// ---------------------------------------------------------------------------
// Failure Ledger write derivation rules
// Maps rejection_class → FailureLedgerCode (when pattern is detected).
// These rules are applied by the Phase B orchestrator, not the sandbox.
// ---------------------------------------------------------------------------

/**
 * Rules for deriving a FailureLedgerCode from a RejectedPatch.
 * Applied in priority order; first match wins.
 *
 * Rule 1 — F-001_SECURITY_DOWNGRADE
 *   rejection_class = INVARIANT_VIOLATION
 *   AND invariant_id IN [INV-003_NO_WRITE_EXECUTE_WITHOUT_APPROVAL,
 *                        INV-005_FAIL_CLOSED_ON_UNCERTAINTY]
 *
 * Rule 2 — F-002_DEPENDENCY_IGNORE_DELETE
 *   rejection_class = REGRESSION_TEST_FAILURE
 *   AND source_candidate.affected_targets contains change_type = 'delete'
 *
 * Rule 3 — F-003_CONTEXT_REGRESSION
 *   rejection_class = INVARIANT_VIOLATION
 *   AND the same invariant_id already appears in the active failure_ledger
 *
 * Rule 4 — F-004_METRIC_INFLATION
 *   rejection_class = PREDICTION_OVERCLAIM    ← renamed from NO_MEASURABLE_IMPROVEMENT
 *   AND source_candidate.acceptance_criteria.measurable_outcome
 *       claims saved_time_minutes_predicted > 0
 *   (Candidate over-claimed benefit; inject negative constraint into Phase A.)
 *
 * Rule 5 — F-009_MEASUREMENT_ENV_INVALID
 *   rejection_class = MEASUREMENT_ENV_INVALID
 *   (Sandbox environment was broken; do NOT inject negative constraint on candidate.)
 *
 * No match → failure_ledger_write = null (one-off rejection, no pattern)
 */
export type FailureLedgerDerivationRule = 1 | 2 | 3 | 4;
