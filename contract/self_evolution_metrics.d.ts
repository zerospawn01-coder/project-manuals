/**
 * Self-Evolution Metrics Type Definitions
 * Schema version: metrics_def/0.1
 *
 * Frozen at: 2026-04-06
 * Prerequisite for: Phase A candidate generation, tier_policy evaluation, Proof summary validation.
 *
 * All values are derived from measured events in the ledger.
 * No field may be populated from free-text estimates.
 */

// ---------------------------------------------------------------------------
// Primitive
// ---------------------------------------------------------------------------

/** Scalar in [0.0, 1.0], 4 decimal places. */
export type Ratio = number;

/** Tier awarded after a completed nightly cycle. null = CRITICAL (no tier). */
export type EvolutionTier = 'STABLE' | 'GROWING' | 'BREAKTHROUGH' | null;

/** Direction of tier change relative to previous cycle. */
export type TierDelta = '+1' | '-1' | '0';

/** Agent task state — stored in the ledger, not in memory. */
export type TaskStateMachineStatus =
  | 'OBSERVING'
  | 'HYPOTHESIZING'
  | 'TESTING'
  | 'PROMOTING';

/** Explicit block event code (exhaustive). */
export type BlockedRiskyActionCode =
  | 'INV_VIOLATION_REJECT'
  | 'PROMOTION_GATE_FAIL'
  | 'BLAST_RADIUS_QUARANTINE'
  | 'HUMAN_REVIEW_DEFER'
  /** Promotion blocked this cycle because DriftMonitor detected F-010_SILENT_DRIFT. */
  | 'DRIFT_PROMOTION_BLOCK';

// ---------------------------------------------------------------------------
// stability_index — §1
// ---------------------------------------------------------------------------

export interface StabilityIndexComponents {
  /** invariants_passed / invariants_evaluated (INV-001..INV-010). 0 evaluated → 0.0. */
  invariant_pass_ratio: Ratio;
  /** regression_tests_passed / regression_tests_run. 0 tests in suite → 0.0. */
  no_regression_pass_ratio: Ratio;
  /** successful_ledger_replays / attempted_ledger_replays. 0 attempts → 1.0. */
  replay_success_ratio: Ratio;
  /** 1 - (quarantined_patch_count / max(1, patches_evaluated_count)). No patches → 1.0. */
  quarantine_adjusted_safety_factor: Ratio;
}

export interface StabilityIndex extends StabilityIndexComponents {
  /** Weighted sum: 0.40*inv + 0.30*reg + 0.20*replay + 0.10*quarantine. Range [0.0, 1.0]. */
  score: Ratio;
}

// ---------------------------------------------------------------------------
// saved_time_minutes — §2
// ---------------------------------------------------------------------------

export interface WorkflowTimeSaving {
  workflow_id: string;
  /** (baseline_median_ms - post_patch_median_ms) / 60000 * confidence_weight */
  saved_minutes: number;
  confidence_weight: Ratio;
}

export interface SavedTimeMinutes {
  /** Sum over all eligible workflows. Negative indicates aggregate regression. */
  total: number;
  top_workflows: WorkflowTimeSaving[];
  /** Workflow IDs where post-patch median is worse than baseline. */
  regression_alerts: string[];
}

// ---------------------------------------------------------------------------
// blocked_risky_actions — §6
// ---------------------------------------------------------------------------

export interface BlockedRiskyActionEvent {
  event_code: BlockedRiskyActionCode;
  ts: string; // ISO-8601 UTC
  /** Present when event_code = 'INV_VIOLATION_REJECT'. */
  invariant_id?: string;
  /** Present when event_code = 'PROMOTION_GATE_FAIL'. */
  patch_id?: string;
  reason?: string;
}

export interface BlockedRiskyActions {
  count: number;
  events: BlockedRiskyActionEvent[];
}

// ---------------------------------------------------------------------------
// ProofSummary — §8
// ---------------------------------------------------------------------------

export interface NextCycleRecommendation {
  priority: number;
  description: string;
}

export interface ProofSummary {
  schema_version: 'proof_summary/0.1';
  cycle_id: string; // UUID
  generated_at: string; // ISO-8601 UTC

  /** From AntigravityEvent legitimacy_tier. */
  legitimacy_tier: 'L0' | 'L1' | 'L2';

  /** Tier awarded this cycle. null = CRITICAL. */
  tier: EvolutionTier;

  /** Delta vs previous cycle. '+1' = upgrade, '-1' = downgrade, '0' = unchanged. */
  tier_delta: TierDelta;

  /** §1 */
  stability_index: StabilityIndex;

  /** §2 */
  saved_time_minutes: SavedTimeMinutes;

  /** §3 — integer token count */
  tokens_saved: number;

  /** §4 — count of FAIL→PASS regression tests not reverted within 72h */
  bugs_killed: number;

  /** §5 — count of non-blank, non-comment lines removed by simplification */
  refined_code_lines: number;

  /** §6 */
  blocked_risky_actions: BlockedRiskyActions;

  /** Count of INV-001..INV-010 checks that returned false this cycle. */
  invariant_failure_count: number;

  /** Patches that passed all gates and were promoted this cycle. */
  verified_patch_count: number;

  /** Cumulative total of skills promoted to production (all cycles). */
  promoted_skill_count: number;

  /** New capability nodes activated this cycle. */
  unlocked_node_count: number;

  /** Phase A output: ordered recommendations for next cycle. */
  next_cycle_recommendations: NextCycleRecommendation[];
}

// ---------------------------------------------------------------------------
// tier_policy inputs — §7
// ---------------------------------------------------------------------------

/** The complete set of metrics that tier_policy reads. No other field may be used. */
export interface TierPolicyInputs {
  stability_index: Ratio;
  invariant_failure_count: number;
  blocked_risky_actions_count_in_cycle: number;
  saved_time_minutes: number;
  verified_patch_count: number;
  promoted_skill_count: number;
  bugs_killed: number;
  unlocked_node_count: number;
  /** Number of consecutive prior cycles where stability_index >= 0.85. Required for BREAKTHROUGH. */
  consecutive_high_stability_cycles: number;
}

// ---------------------------------------------------------------------------
// Task State Machine — Appendix A
// ---------------------------------------------------------------------------

export interface TaskStateMachineRecord {
  schema_version: 'task_state/0.1';
  cycle_id: string;
  status: TaskStateMachineStatus;
  updated_at: string; // ISO-8601 UTC
  /** ID of the hypothesis / candidate currently under evaluation. null when OBSERVING. */
  active_candidate_id: string | null;
}

// ---------------------------------------------------------------------------
// Failure Constitution — Appendix B
// ---------------------------------------------------------------------------

export type FailureLedgerCode =
  | 'F-001_SECURITY_DOWNGRADE'
  | 'F-002_DEPENDENCY_IGNORE_DELETE'
  | 'F-003_CONTEXT_REGRESSION'
  | 'F-004_METRIC_INFLATION'
  /** Measurement environment returned invalid/null metrics: sandbox env issue, not candidate fault. */
  | 'F-009_MEASUREMENT_ENV_INVALID';

export interface FailureLedgerEntry {
  code: FailureLedgerCode;
  first_observed_cycle_id: string;
  last_observed_cycle_id: string;
  occurrence_count: number;
  /** Natural-language constraint injected into Phase A prompt as Negative Constraint. */
  negative_constraint: string;
}
