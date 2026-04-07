/**
 * contract/morning_result.d.ts
 *
 * Morning Result — End-to-End Aggregated Output Contract
 * Schema version: morning_result/0.1
 *
 * MorningResult is the FINAL output of the overnight pipeline.
 * It is produced ONCE per nightly cycle and contains EVERYTHING the
 * morning screen renderer needs—no additional queries are required.
 *
 * Data lineage (read-only):
 *   Phase A (HYPOTHESIZING)  → PhaseACandidateList
 *     ↓
 *   Phase B (TESTING)        → PhaseBBatchResult
 *     ↓ verified[]
 *   Phase C (PROMOTING)      → PromotingGateResult
 *     ↓ promoted_skills[]
 *   Phase D (AGGREGATE)      → MorningResult   ← THIS FILE
 *
 * Four sub-reports:
 *   1. EvolutionReport   — tier changes, promoted skills, unlocked nodes
 *   2. GuardianReport    — safety events, invariant status, failure ledger
 *   3. MetricsReport     — the 5 measurable quantities + cycle-over-cycle deltas
 *   4. ProofReport       — ProofSummary + N-cycle lineage for trend display
 *
 * Consumers:
 *   - Morning screen React renderer (reads MorningResult.display.*)
 *   - ProofSummary ledger writer (reads MorningResult.proof.proof_summary)
 *   - Phase A next-cycle seeder (reads MorningResult.proof.proof_summary.next_cycle_recommendations)
 *
 * Invariant:
 *   sum(evolution.promoted_skills[].confirmed_improvements.saved_time_minutes)
 *   == metrics.saved_time_minutes.total (within floating-point tolerance)
 *
 * Imports:
 *   - PromotedSkill, UnlockedNode from ./phase_c_promote
 *   - StabilityIndex, SavedTimeMinutes, BlockedRiskyActions,
 *     FailureLedgerEntry, FailureLedgerCode, EvolutionTier, TierDelta,
 *     ProofSummary from ./self_evolution_metrics
 */

import type { PromotedSkill, UnlockedNode } from './phase_c_promote';
import type {
  StabilityIndex,
  SavedTimeMinutes,
  BlockedRiskyActions,
  FailureLedgerEntry,
  FailureLedgerCode,
  EvolutionTier,
  TierDelta,
  ProofSummary,
} from './self_evolution_metrics';

// ---------------------------------------------------------------------------
// 1. EvolutionReport
// ---------------------------------------------------------------------------

/**
 * Summarises how the system "grew" (or didn't) this cycle.
 * Used for the tier announcement and skill parade animations.
 */
export interface EvolutionReport {
  tier: EvolutionTier;
  tier_delta: TierDelta;

  /** Skills promoted to production this cycle (from PromotingGateResult). */
  promoted_skills: PromotedSkill[];
  promoted_skill_count: number;

  /**
   * Cumulative promoted skill count across ALL cycles (not just this one).
   * Matches ProofSummary.promoted_skill_count.
   */
  cumulative_promoted_skill_count: number;

  /** Capability nodes activated for the first time this cycle. */
  unlocked_nodes: UnlockedNode[];
  unlocked_node_count: number;

  /**
   * Number of consecutive prior cycles (including this one) where
   * stability_index.score >= 0.85.  Required to display BREAKTHROUGH badge.
   * 0 if this cycle's score < 0.85.
   */
  consecutive_stable_cycles: number;

  /**
   * Human-readable labels for tier thresholds that were newly reached
   * this cycle (for display in the morning animation).
   * e.g. ["GROWING threshold crossed", "3× consecutive stability"]
   * Empty when no new thresholds were crossed.
   */
  tier_thresholds_met: string[];
}

// ---------------------------------------------------------------------------
// 2. GuardianReport
// ---------------------------------------------------------------------------

/**
 * Security posture summary.
 * Computed deterministically from blocked_risky_actions and invariant status.
 *
 * GREEN: invariant_failure_count == 0 AND blocked_risky_actions.count == 0
 * AMBER: (invariant_failure_count > 0 OR blocked_risky_actions.count > 0)
 *         AND no INV_VIOLATION_REJECT event in blocked_risky_actions.events
 * RED:   any INV_VIOLATION_REJECT event in blocked_risky_actions.events
 *         OR active_failure_codes contains F-001_SECURITY_DOWNGRADE
 */
export type SecurityPosture = 'GREEN' | 'AMBER' | 'RED';

/**
 * Summarises all Guardian-domain events: what was blocked, why, and what
 * negative patterns have accumulated in the Failure Constitution.
 */
export interface GuardianReport {
  blocked_risky_actions: BlockedRiskyActions;

  /**
   * Count of INV-001..INV-010 checks that returned false this cycle.
   * Matches ProofSummary.invariant_failure_count.
   */
  invariant_failure_count: number;

  /**
   * All active (non-cleared) Failure Ledger entries at cycle end.
   * Ordered by occurrence_count descending.
   */
  active_failure_ledger: FailureLedgerEntry[];

  /** Convenience: the set of F-xxx codes currently in the ledger. */
  active_failure_codes: FailureLedgerCode[];

  security_posture: SecurityPosture;

  /**
   * Patch IDs that are awaiting human review (DEFERRED_HUMAN disposition
   * in Phase C).  Empty most cycles.
   */
  pending_human_review_patch_ids: string[];
}

// ---------------------------------------------------------------------------
// 3. MetricsReport
// ---------------------------------------------------------------------------

/**
 * The five measurable quantities defined in GOVERNANCE_METRICS_DEFINITION.md,
 * plus cycle-over-cycle deltas for trend rendering (sparkline etc.).
 */
export interface MetricsDelta {
  /** Positive = improvement vs previous cycle. null = no previous cycle. */
  stability_index: number | null;
  saved_time_minutes: number | null;
  tokens_saved: number | null;
  bugs_killed: number | null;
  refined_code_lines: number | null;
}

export interface MetricsReport {
  /** §1 */
  stability_index: StabilityIndex;
  /** §2 */
  saved_time_minutes: SavedTimeMinutes;
  /** §3 — integer token count */
  tokens_saved: number;
  /** §4 — FAIL→PASS regression tests not reverted within 72h */
  bugs_killed: number;
  /** §5 — non-blank, non-comment lines removed by simplification */
  refined_code_lines: number;

  /**
   * Delta vs the immediately preceding cycle.
   * All null on the very first cycle (no baseline).
   */
  deltas: MetricsDelta;
}

// ---------------------------------------------------------------------------
// 4. ProofReport
// ---------------------------------------------------------------------------

/**
 * A compressed lineage record for one prior cycle.
 * Used to render the sparkline / history table on the morning screen.
 * NOT a full ProofSummary — only the fields needed for trend display.
 */
export interface CycleLineageSummary {
  cycle_id: string;
  generated_at: string;          // ISO-8601 UTC
  tier: EvolutionTier;
  stability_index_score: number;
  promoted_skill_count: number;
  blocked_risky_actions_count: number;
  saved_time_minutes_total: number;
}

/**
 * Aggregated proof record for this cycle plus historical lineage.
 * proof_summary feeds back into Phase A (next cycle) via
 * WorldStateSnapshot.active_failure_codes and previous_tier.
 */
export interface ProofReport {
  /** Full ProofSummary for this cycle. */
  proof_summary: ProofSummary;

  /**
   * Previous cycles' summaries, newest first, for trend display.
   * Maximum length: 7 (one week). Trimmed to the most recent 7 if older.
   */
  cycle_lineage: CycleLineageSummary[];
}

// ---------------------------------------------------------------------------
// Drift monitoring summary
// ---------------------------------------------------------------------------

/**
 * Per-target function drift metrics as of this cycle.
 * Includes only targets that had at least one recorded run.
 */
export interface DriftTargetSummary {
  target_function: string;
  trend: 'improving' | 'stable' | 'degrading' | 'insufficient_data';
  /** OLS slope over the last 20 runs (min/run). null if < 5 runs. */
  slope_20: number | null;
  drift_detected: boolean;
  n_runs: number;
}

/**
 * Aggregated drift status across all monitored target functions.
 * Included in MorningResult only when DriftMonitor is active in the
 * nightly loop runner (drift_monitor present in NightlyLoopContext).
 */
export interface DriftSummary {
  generated_at: string;    // ISO-8601 UTC
  targets: DriftTargetSummary[];
  /** true when at least one target has drift_detected = true. */
  any_drift_detected: boolean;
  /** Count of targets with trend = 'degrading'. */
  degrading_count: number;
  /** 'F-010_SILENT_DRIFT' when any_drift_detected, else null. */
  failure_code: 'F-010_SILENT_DRIFT' | null;
  /**
   * Adaptation decisions computed by DriftAdaptationEngine.
   * Present when DriftMonitor is wired and at least one target has n_runs >= 5.
   */
  adaptation?: {
    schema_version: 'drift_adaptation/0.1';
    computed_at: string;
    promotion_blocked: boolean;
    promotion_blocked_reason: string | null;
    max_candidates_override: number | null;
    blast_radius_ceiling: 'SELF' | 'TENANT' | 'GLOBAL' | null;
    rollback_suggestions: Array<{
      target_function: string;
      last_good_run_id: string | null;
      last_good_benchmark_signature: string | null;
      last_good_saved_time_minutes: number | null;
      last_good_measured_at: string | null;
      reason: string;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Display contract
// ---------------------------------------------------------------------------

/**
 * Which morning animation to play.
 * Determined by tier + tier_delta + security_posture.
 *
 *  'TIER_UPGRADE'    tier_delta = '+1' (any tier)
 *  'TIER_DOWNGRADE'  tier_delta = '-1' (any non-null tier)
 *  'TIER_HOLD'       tier_delta = '0'  AND tier != null
 *  'CRITICAL_HOLD'   tier = null (CRITICAL — no tier awarded)
 *  'BREAKTHROUGH'    tier = 'BREAKTHROUGH' (regardless of delta direction)
 *
 * Priority: BREAKTHROUGH > CRITICAL_HOLD > TIER_UPGRADE > TIER_DOWNGRADE > TIER_HOLD
 */
export type MorningAnimationType =
  | 'BREAKTHROUGH'
  | 'CRITICAL_HOLD'
  | 'TIER_UPGRADE'
  | 'TIER_DOWNGRADE'
  | 'TIER_HOLD';

/**
 * Badge color mapping:
 *   BREAKTHROUGH → 'gold'
 *   GROWING      → 'green'
 *   STABLE       → 'blue'
 *   null         → 'red'
 */
export type TierBadgeColor = 'gold' | 'green' | 'blue' | 'red';

/**
 * All display-layer decisions are pre-computed so the renderer
 * performs NO conditional logic — it only maps fields to UI elements.
 */
export interface MorningDisplay {
  animation: MorningAnimationType;

  /**
   * Primary headline (≤ 72 chars).
   * e.g. "BREAKTHROUGH: 4 skills promoted · +18min saved · +320 tokens"
   *      "CRITICAL: no tier awarded this cycle"
   */
  headline: string;

  /**
   * Secondary line (≤ 120 chars). null when guardian posture is GREEN.
   * e.g. "Guardian: 2 risks blocked · F-001 active"
   */
  subheadline: string | null;

  tier_badge_color: TierBadgeColor;

  /**
   * true when promoted_skill_count > 0 → triggers skill parade animation.
   */
  show_skill_parade: boolean;

  /**
   * true when security_posture = 'AMBER' or 'RED', or
   *      pending_human_review_patch_ids.length > 0.
   * Triggers the guardian alert banner.
   */
  show_guardian_alert: boolean;

  /**
   * true when unlocked_node_count > 0 → triggers node unlock burst effect.
   */
  show_node_unlock: boolean;

  /**
   * Drift monitoring status for the morning screen.
   * 'DEGRADING'  — at least one target has drift_detected = true.
   * 'STABLE'     — all monitored targets are stable or improving, none degrading.
   * 'IMPROVING'  — at least one target improving, zero degrading.
   * null         — DriftMonitor not configured or insufficient data (< 5 runs).
   */
  drift_status: 'DEGRADING' | 'STABLE' | 'IMPROVING' | null;

  /**
   * Pre-formatted one-line drift banner for the morning screen.
   * null when drift_status is null or 'STABLE'.
   * e.g. "Drift ↓: aggregate_weekly (slope -9.6e-6/run) [F-010]"
   * Maximum 120 chars.
   */
  drift_banner: string | null;

  /**
   * true when drift_status is non-null (DriftMonitor active + sufficient data).
   * Controls visibility of the inline drift section in the morning screen.
   */
  show_drift: boolean;
}

// ---------------------------------------------------------------------------
// MorningResult — top-level aggregated output
// ---------------------------------------------------------------------------

/**
 * The single export consumed by the morning screen renderer and all
 * downstream Phase A / telemetry consumers.
 *
 * All four sub-reports are self-contained: no additional lookups needed.
 *
 * Schema freeze: morning_result/0.1
 * To change: bump minor version + add migration note in GOVERNANCE_METRICS_DEFINITION.md
 */
export interface MorningResult {
  schema_version: 'morning_result/0.1';

  /** The cycle that produced this result. */
  cycle_id: string;

  /** ISO-8601 UTC timestamp when aggregation was completed. */
  generated_at: string;

  /** 1. Tier changes, promoted skills, capability unlocks. */
  evolution: EvolutionReport;

  /** 2. Safety events, invariant status, failure ledger snapshot. */
  guardian: GuardianReport;

  /** 3. The five measurable quantities + cycle-over-cycle deltas. */
  metrics: MetricsReport;

  /** 4. Full ProofSummary + N-cycle history for trend rendering. */
  proof: ProofReport;

  /** Pre-computed display instructions — renderer must not add logic. */
  display: MorningDisplay;

  /**
   * Drift monitoring summary across all observed target functions.
   * Absent when DriftMonitor is not wired into the nightly loop runner.
   */
  drift?: DriftSummary;
}
