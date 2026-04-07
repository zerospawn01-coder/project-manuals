/**
 * contract/phase_a_prompt.d.ts
 *
 * Phase A — Candidate Generation Prompt I/O Contract
 * Schema version: phase_a/0.1
 *
 * Defines the exact input pack the orchestrator feeds into Phase A,
 * and the exact output contract the candidate generator must produce.
 *
 * Downstream consumers: Phase A prompt renderer, TESTING sandbox,
 * PROMOTING gate, Guardian/Proof summary builder.
 */

import type { FailureLedgerCode, FailureLedgerEntry } from './self_evolution_metrics';

// ---------------------------------------------------------------------------
// INPUT  — PhaseAInputPack
// Assembled by the orchestrator before the Phase A LLM call.
// ---------------------------------------------------------------------------

/**
 * Layer 1 — System Layer (Negative Constraints / 憲法層)
 *
 * Loaded from failure_ledger. Injected verbatim into the system prompt
 * BEFORE any other instruction. The agent must treat these as
 * constitutionally inviolable.
 */
export interface PhaseAConstitutionLayer {
  schema_version: 'phase_a_constitution/0.1';
  /**
   * Active negative constraints derived from FailureLedgerEntry records.
   * The LLM receives these as an explicit prohibition list.
   * Any candidate that would trigger a listed code is INVALID regardless
   * of all other scores.
   */
  active_negative_constraints: Array<{
    code: FailureLedgerCode;
    /** Verbatim natural-language prohibition injected into the system prompt. */
    prohibition_text: string;
    first_observed_at: string; // ISO-8601 UTC
    occurrence_count: number;
  }>;
  /**
   * Absolute invariant IDs (INV-001..INV-010) that must NOT be weakened.
   * Any candidate modifying code covered by these invariants must provide
   * explicit invariant_check evidence (see PatchCandidateAcceptanceCriteria).
   */
  protected_invariant_ids: string[];
}

/**
 * Layer 2 — Objective Layer (Evaluation Law / 評価関数層)
 *
 * The frozen metric definitions passed to the agent.
 * Names and formulas derive exclusively from GOVERNANCE_METRICS_DEFINITION.md §1–§6.
 */
export interface PhaseAObjectiveLayer {
  schema_version: 'phase_a_objective/0.1';
  /** Current cycle stability_index score (must not decrease). */
  current_stability_index: number;
  /**
   * Value function: the numeric worth of a patch candidate.
   * Expressed as a priority-ordered list of objective fields.
   * The agent must optimize in this order; a lower-priority field
   * cannot justify violating a higher-priority constraint.
   */
  value_priority_order: ReadonlyArray<
    | 'stability_index'      // 1st — must not decrease
    | 'saved_time_minutes'   // 2nd
    | 'bugs_killed'          // 3rd
    | 'tokens_saved'         // 4th
    | 'refined_code_lines'   // 5th
  >;
  /**
   * Minimum thresholds below which a candidate provides no value.
   * A candidate that does not move at least one metric beyond its noise
   * floor MUST be discarded before output.
   */
  noise_floors: {
    saved_time_minutes_min_delta_ratio: 0.01;   // §2: <1% → discard
    tokens_saved_min_delta_ratio: 0.02;          // §3: <2% → discard
    bugs_killed_min: 1;                          // §4: 0 → no value
    refined_code_lines_min: 1;                   // §5: 0 → no value
  };
}

/**
 * Snapshot of the current observable world state.
 * Produced during OBSERVING phase and passed to Phase A.
 */
export interface WorldStateSnapshot {
  snapshot_id: string;         // UUID
  observed_at: string;         // ISO-8601 UTC
  cycle_id: string;

  /** Recent invariant check results — identifies stress points. */
  invariant_recent_results: Array<{
    invariant_id: string;
    passed: boolean;
    evaluated_at: string;
  }>;

  /**
   * Regression test summary — identifies failing test targets.
   * Only @regression-tagged tests (see metrics def §4).
   */
  regression_test_summary: {
    total: number;
    failing: number;
    failing_test_ids: string[];
  };

  /**
   * Workflow performance baselines — feeds saved_time_minutes eligibility.
   * Only workflows with baseline_run_count >= 5 are included.
   */
  workflow_baselines: Array<{
    workflow_id: string;
    baseline_median_ms: number;
    baseline_run_count: number;
  }>;

  /**
   * Active failure_ledger entries — already summarised in constitution_layer,
   * but included here for the agent to correlate with source files.
   */
  active_failure_codes: FailureLedgerCode[];

  /** Previous cycle tier (null if first cycle or prior was CRITICAL). */
  previous_tier: 'STABLE' | 'GROWING' | 'BREAKTHROUGH' | null;

  /**
   * Focus seeds — specific observations that prime Phase A toward high-value targets.
   * Assembled by collectFocusSeedsFromObservation() during OBSERVING phase.
   */
  focus_seeds: FocusSeedSet;

  /**
   * Functions currently under active rollback (drift was detected and promotion was blocked
   * in the previous cycle). Phase A should generate recovery-focused candidates for these.
   * Absent when no active rollback record exists.
   */
  active_rollback_targets?: string[];
}

// ---------------------------------------------------------------------------
// LedgerInjectionFilterConfig
// Controls which failure_ledger entries are injected into NEGATIVE_CONSTRAINTS_BLOCK.
// Prevents context overflow as failure_ledger grows over time.
// ---------------------------------------------------------------------------

/**
 * Severity assigned to a FailureLedgerEntry by the orchestrator.
 * Derived from occurrence_count and recency (not stored in the ledger itself).
 */
export type LedgerEntrySeverity = 'CRITICAL' | 'WARN' | 'INFO';

/**
 * Filter configuration applied by the orchestrator before building
 * PhaseAConstitutionLayer.active_negative_constraints.
 *
 * Selection rule (entries are included if ANY condition matches):
 *   1. computed_severity == 'CRITICAL'  (always included regardless of age)
 *   2. last_observed_cycle is within recent_cycles_window of the current cycle
 *
 * Entries that match NEITHER condition are silently excluded from the system
 * prompt but remain in the ledger for audit.
 */
export interface LedgerInjectionFilterConfig {
  /**
   * Always inject entries with this severity or higher, regardless of age.
   * Default: 'CRITICAL' — only critical failures are age-exempt.
   */
  always_inject_min_severity: LedgerEntrySeverity;

  /**
   * Number of past cycles to treat as "recent".
   * Entries whose last_observed_cycle_id falls within this window are injected
   * even if their severity is below always_inject_min_severity.
   * Minimum: 1. Recommended default: 3.
   */
  recent_cycles_window: number;

  /**
   * Hard cap on the total number of negative constraints injected.
   * If filter produces more than this count, prioritise:
   *   1. CRITICAL severity entries (all)
   *   2. Most recent entries (by last_observed_cycle_id)
   * Default: 10.
   */
  max_injected_constraints: number;
}

// ---------------------------------------------------------------------------
// FocusSeed — Target Focus Seed (観測対象の絞り込み)
// Prevents the agent from "freely improving the OS" with unbounded scope.
// Each seed is a specific, evidence-backed improvement target.
// ---------------------------------------------------------------------------

/** An error log entry that suggests a targeted fix candidate. */
export interface ErrorLogSeed {
  seed_type: 'error_log';
  /** Source file that emitted the error. */
  source_file: string;
  function_name?: string;
  error_code: string;
  error_message_excerpt: string;
  /** ISO-8601 UTC timestamp of the first occurrence in the observation window. */
  first_seen_at: string;
  occurrence_count_in_window: number;
}

/** A workflow whose recent execution time is visibly slower than its own baseline. */
export interface SlowWorkflowSeed {
  seed_type: 'slow_workflow';
  workflow_id: string;
  /** Observed median ms in the last observation window. */
  recent_median_ms: number;
  /** Stored baseline median ms (from WorldStateSnapshot.workflow_baselines). */
  baseline_median_ms: number;
  /** (recent - baseline) / baseline. Positive = slower. */
  slowdown_ratio: number;
  baseline_run_count: number;
}

/** An invariant that fired (passed=false) in the most recent cycle. */
export interface InvariantStressSeed {
  seed_type: 'invariant_stress';
  invariant_id: string;
  /** Number of times this invariant failed in the last recent_cycles_window cycles. */
  failure_count_in_window: number;
  /** ISO-8601 UTC of the most recent failure. */
  last_failed_at: string;
  /** Source file most likely related to this invariant (from invariant registry). */
  related_file?: string;
}

/** A regression test that has been failing continuously. */
export interface FlakyRegressionSeed {
  seed_type: 'flaky_regression';
  test_id: string;
  /** Number of consecutive cycles the test has been in FAIL state. */
  consecutive_fail_cycles: number;
  /** Linked incident ID from incident_registry, if any. */
  linked_incident_id?: string;
}

export type FocusSeed =
  | ErrorLogSeed
  | SlowWorkflowSeed
  | InvariantStressSeed
  | FlakyRegressionSeed;

/**
 * The complete set of focus seeds assembled for one Phase A call.
 * Seeds are ordered by estimated_impact DESC so the agent tackles the
 * highest-value targets first.
 */
export interface FocusSeedSet {
  assembled_at: string; // ISO-8601 UTC
  /**
   * Seeds ordered by estimated_impact (descending).
   * The orchestrator caps this at max_seeds before injection.
   */
  seeds: Array<FocusSeed & { estimated_impact: 'HIGH' | 'MEDIUM' | 'LOW' }>;
  /**
   * Hard cap enforced by the orchestrator.
   * Only the top `max_seeds` seeds (by estimated_impact) are included.
   * Recommended default: 5.
   */
  max_seeds: number;
  /**
   * Seeds that were evaluated but fell below the impact threshold or exceeded
   * max_seeds. Included for audit only — not passed to the LLM.
   */
  excluded_seed_count: number;
}

/**
 * Complete input pack assembled by the orchestrator.
 */
export interface PhaseAInputPack {
  schema_version: 'phase_a_input/0.1';
  cycle_id: string;
  assembled_at: string; // ISO-8601 UTC
  constitution_layer: PhaseAConstitutionLayer;
  objective_layer: PhaseAObjectiveLayer;
  world_state: WorldStateSnapshot;
  /**
   * Filter config used when building constitution_layer.active_negative_constraints.
   * Stored here for audit — allows reconstruction of why a given constraint was
   * or was not injected for this cycle.
   */
  ledger_injection_filter: LedgerInjectionFilterConfig;
  /** Maximum number of candidates to generate in one call (hard cap). */
  max_candidates: number;
}

// ---------------------------------------------------------------------------
// OUTPUT — PhaseACandidateList
// Every candidate must pass schema validation before entering TESTING.
// ---------------------------------------------------------------------------

/**
 * Layer 3 — Output Layer (The Contract / 契約層)
 *
 * Per-candidate acceptance criteria — three mandatory sub-proofs.
 * A candidate missing ANY of these three is schema-invalid and REJECTED
 * at the gate without entering the TESTING sandbox.
 */
export interface PatchCandidateAcceptanceCriteria {
  /**
   * Sub-proof 1: Invariant Check
   * For each INV-xxx the patch touches, state explicitly: pass | untouched.
   * A candidate MAY NOT declare an invariant as "pass" unless the patch
   * includes a testable assertion that verifies it.
   */
  invariant_check: Array<{
    invariant_id: string;  // e.g. "INV-003_NO_WRITE_EXECUTE_WITHOUT_APPROVAL"
    verdict: 'pass' | 'untouched';
    /** Required when verdict = 'pass': the assertion / test that verifies it. */
    verification_method?: string;
  }>;

  /**
   * Sub-proof 2: Measurable Outcome
   * Predicted delta for each metric the patch claims to improve.
   * If no metric is claimed, the candidate has no declared value and is REJECTED.
   */
  measurable_outcome: {
    /** Required: stability_index must not decrease. */
    stability_index_delta: 'neutral' | 'positive';
    /** At least ONE of the following must be non-zero / present. */
    saved_time_minutes_predicted?: number;   // positive = improvement
    tokens_saved_predicted?: number;
    bugs_killed_predicted?: number;
    refined_code_lines_predicted?: number;
    /**
     * Baseline conditions used by this prediction.
     * e.g. { workflow_id: "...", baseline_median_ms: 4200, baseline_run_count: 7 }
     */
    measurement_basis: Record<string, unknown>;
  };

  /**
   * Sub-proof 3: No-Regression Proof
   * Explicit list of test IDs or invariant IDs that confirm the patch
   * does not break existing guarantees.
   * Must include at least one @regression-tagged test ID or explicit
   * reasoning why the patch is orthogonal to all regression tests.
   */
  no_regression: {
    /** Test IDs from regression_test_summary that remain PASS. */
    regression_test_ids_verified_pass: string[];
    /** Invariants verified as untouched by this patch. */
    invariant_ids_untouched: string[];
    /**
     * If no regression tests are applicable (orthogonal patch),
     * this field is required and must not be empty.
     */
    orthogonality_rationale?: string;
  };
}

/** Negative Constraint violation found during schema pre-check. */
export interface NegativeConstraintViolation {
  code: FailureLedgerCode;
  reason: string;
}

export interface PatchCandidate {
  candidate_id: string;   // UUID assigned by the generator
  generated_at: string;   // ISO-8601 UTC
  cycle_id: string;

  /**
   * Human-readable title — single sentence, no subjective claims
   * ("feels faster", "probably better"). Must reference specific file/function.
   */
  title: string;

  /**
   * Target files and functions affected by the patch.
   * Used by the sandbox to scope the blast radius check.
   */
  affected_targets: Array<{
    file_path: string;
    function_name?: string;
    change_type: 'modify' | 'delete' | 'add';
  }>;

  /** Estimated blast_radius based on affected_targets. */
  estimated_blast_radius: 'SELF' | 'TENANT' | 'GLOBAL';

  /**
   * The patch itself — unified diff format (git diff -p).
   * Must be present for TESTING phase to proceed.
   */
  patch_diff: string;

  /** The three mandatory sub-proofs. Schema-required. */
  acceptance_criteria: PatchCandidateAcceptanceCriteria;

  /**
   * Negative constraint check — performed by generator before output.
   * Must be empty for the candidate to pass the pre-TESTING gate.
   */
  negative_constraint_violations: NegativeConstraintViolation[];
}

/**
 * Complete output of one Phase A call.
 * Validated against this schema before any candidate enters TESTING.
 */
export interface PhaseACandidateList {
  schema_version: 'phase_a_output/0.1';
  cycle_id: string;
  generated_at: string; // ISO-8601 UTC
  input_pack_id: string;

  candidates: PatchCandidate[];

  /**
   * Candidates discarded by the generator before output.
   * Required for audit — generator must not silently drop bad candidates.
   */
  discarded_candidates: Array<{
    reason: 'below_noise_floor' | 'negative_constraint_violation' | 'no_acceptance_criteria';
    description: string;
  }>;
}
