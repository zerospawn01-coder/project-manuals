/**
 * tools/phase_d_aggregator.ts
 *
 * Phase D — MorningResult Aggregator
 * schema_version: morning_result/0.1
 *
 * Responsibilities:
 *   1. computeTierPolicy()       — evaluate STABLE/GROWING/BREAKTHROUGH tier per §7
 *   2. computeTierDelta()        — compare current tier to previous cycle's tier
 *   3. buildEvolutionReport()    — tier + promoted_skills + unlocked_nodes
 *   4. buildGuardianReport()     — security_posture + failure_ledger + pending reviews
 *   5. buildMetricsReport()      — 5 metrics + cycle-over-cycle deltas
 *   6. buildProofReport()        — ProofSummary + 7-cycle lineage
 *   7. computeDisplay()          — ALL display decisions pre-computed (zero IF in renderer)
 *   8. aggregateMorningResult()  — compose full MorningResult and write audit JSON
 *
 * Tier evaluation rules (§7 GOVERNANCE_METRICS_DEFINITION.md):
 *   BREAKTHROUGH: stability >= 0.85 (sustained >= 2 consecutive cycles)
 *                 AND unlocked_node_count >= 1
 *                 AND saved_time_minutes >= 5.0
 *                 AND verified_patch_count >= 3
 *                 AND blocked_risky_actions.count_in_cycle = 0
 *                 AND previous tier IN ['GROWING', 'STABLE', 'BREAKTHROUGH']
 *   STABLE:       stability >= 0.90
 *                 AND invariant_failure_count = 0
 *                 AND blocked_risky_actions.count_in_cycle = 0
 *                 AND saved_time_minutes >= 0.0
 *   GROWING:      stability >= 0.80
 *                 AND verified_patch_count >= 1
 *                 AND promoted_skill_count_cumulative >= 1
 *                 AND (bugs_killed > 0 OR saved_time_minutes > 0.0)
 *   null (CRITICAL): stability < 0.80 (or no tier conditions met)
 *
 * Tier priority (highest wins):  BREAKTHROUGH > STABLE > GROWING > null
 *
 * This function is PURE with respect to business logic — no I/O except audit log.
 * All inputs come from ledger snapshots provided by the caller.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { PhaseBBatchResult } from '../contract/phase_b_verify';
import type { PromotingGateResult } from '../contract/phase_c_promote';
import type {
  MorningResult,
  EvolutionReport,
  GuardianReport,
  MetricsReport,
  MetricsDelta,
  ProofReport,
  CycleLineageSummary,
  MorningDisplay,
  MorningAnimationType,
  TierBadgeColor,
  SecurityPosture,
  DriftSummary,
  DriftTargetSummary,
} from '../contract/morning_result';
import type { DriftMetrics } from './drift_monitor';
import type { DriftAdaptationDecision } from './drift_adaptation';
import type {
  ProofSummary,
  TierPolicyInputs,
  EvolutionTier,
  TierDelta,
  StabilityIndex,
  SavedTimeMinutes,
  BlockedRiskyActions,
  FailureLedgerEntry,
  FailureLedgerCode,
  NextCycleRecommendation,
} from '../contract/self_evolution_metrics';

// ---------------------------------------------------------------------------
// TIER THRESHOLDS (§7 GOVERNANCE_METRICS_DEFINITION.md — normative)
// ---------------------------------------------------------------------------

export const TIER_THRESHOLDS = {
  BREAKTHROUGH_STABILITY: 0.85,
  BREAKTHROUGH_CONSECUTIVE_CYCLES: 2,
  BREAKTHROUGH_SAVED_TIME_MIN: 5.0,
  BREAKTHROUGH_VERIFIED_PATCH_MIN: 3,
  STABLE_STABILITY: 0.90,
  GROWING_STABILITY: 0.80,
  CRITICAL_STABILITY: 0.80,   // below this → null tier
} as const;

// ---------------------------------------------------------------------------
// CALLER-PROVIDED INPUT PACK
// ---------------------------------------------------------------------------

/**
 * All external state the aggregator needs but cannot derive from
 * Phase B/C results alone.  Sourced from the ledger by the caller.
 */
export interface PhaseDInputPack {
  /** Phase B batch result for this cycle. */
  b_result: PhaseBBatchResult;

  /** Phase C promoting gate result for this cycle. */
  c_result: PromotingGateResult;

  /** All active (non-cleared) Failure Ledger entries at cycle end. */
  active_failure_ledger: FailureLedgerEntry[];

  /**
   * Current cycle's measured StabilityIndex (computed from ledger, not estimated).
   * This is the authoritative §1 score used for tier evaluation.
   */
  stability_index: StabilityIndex;

  /**
   * Current cycle's §2 SavedTimeMinutes aggregate.
   */
  saved_time_minutes: SavedTimeMinutes;

  /** Current cycle's §3 tokens_saved count. */
  tokens_saved: number;

  /** Current cycle's §4 bugs_killed count. */
  bugs_killed: number;

  /** Current cycle's §5 refined_code_lines count. */
  refined_code_lines: number;

  /** Tier from the immediately preceding cycle. null on first cycle. */
  previous_tier: EvolutionTier;

  /**
   * Number of consecutive prior cycles (before this one) where
   * stability_index.score >= 0.85.  Used for BREAKTHROUGH evaluation.
   * 0 on first cycle.
   */
  prior_consecutive_stable_cycles: number;

  /**
   * Cumulative promoted skill count BEFORE this cycle's promotions.
   * The aggregator adds c_result.promoted_count to get the final total.
   */
  cumulative_promoted_skill_count_before: number;

  /**
   * Snapshot of previous cycle's metrics for delta computation.
   * null on the very first cycle.
   */
  previous_cycle_metrics: {
    stability_index_score: number;
    saved_time_minutes_total: number;
    tokens_saved: number;
    bugs_killed: number;
    refined_code_lines: number;
  } | null;

  /**
   * Phase A's ordered next-cycle recommendations (pass-through to ProofSummary).
   */
  next_cycle_recommendations: NextCycleRecommendation[];

  /**
   * Prior cycles' lineage for trend display (newest first).
   * The aggregator prepends this cycle's summary and trims to 7.
   */
  prior_cycle_lineage: CycleLineageSummary[];

  /**
   * Legitimacy tier determined by the AntigravityEvent layer.
   * Pass-through to ProofSummary — not derived here.
   */
  legitimacy_tier: 'L0' | 'L1' | 'L2';

  /**
   * Drift metrics for all monitored target functions.
   * Provided when DriftMonitor is active; absent otherwise.
   */
  drift_metrics?: DriftMetrics[];

  /**
   * Adaptation decision computed by DriftAdaptationEngine before Phase C.
   * If present, included in MorningResult.drift.adaptation.
   */
  drift_adaptation?: DriftAdaptationDecision;
}

export interface PhaseDConfig {
  /** Directory for audit JSON. null → skip write. */
  audit_log_dir: string | null;
}

export const DEFAULT_PHASE_D_CONFIG: PhaseDConfig = {
  audit_log_dir: null,
};

// ---------------------------------------------------------------------------
// SECTION 1 — Tier Policy (§7)
// ---------------------------------------------------------------------------

/**
 * Evaluate the tier for this cycle from TierPolicyInputs.
 *
 * Evaluation order (highest wins):
 *   1. BREAKTHROUGH — all 5 conditions including previous-tier constraint
 *   2. STABLE       — all 4 conditions
 *   3. GROWING      — all 4 conditions
 *   4. null (CRITICAL) — none of the above
 *
 * This function is a pure function of its inputs.
 */
export function computeTierPolicy(inputs: TierPolicyInputs, previous_tier: EvolutionTier): EvolutionTier {
  const breakthrough_eligible_from = previous_tier === 'GROWING' ||
    previous_tier === 'STABLE' ||
    previous_tier === 'BREAKTHROUGH';

  const is_breakthrough =
    breakthrough_eligible_from &&
    inputs.stability_index >= TIER_THRESHOLDS.BREAKTHROUGH_STABILITY &&
    inputs.consecutive_high_stability_cycles >= TIER_THRESHOLDS.BREAKTHROUGH_CONSECUTIVE_CYCLES &&
    inputs.unlocked_node_count >= 1 &&
    inputs.saved_time_minutes >= TIER_THRESHOLDS.BREAKTHROUGH_SAVED_TIME_MIN &&
    inputs.verified_patch_count >= TIER_THRESHOLDS.BREAKTHROUGH_VERIFIED_PATCH_MIN &&
    inputs.blocked_risky_actions_count_in_cycle === 0;

  if (is_breakthrough) return 'BREAKTHROUGH';

  const is_stable =
    inputs.stability_index >= TIER_THRESHOLDS.STABLE_STABILITY &&
    inputs.invariant_failure_count === 0 &&
    inputs.blocked_risky_actions_count_in_cycle === 0 &&
    inputs.saved_time_minutes >= 0.0;

  if (is_stable) return 'STABLE';

  const is_growing =
    inputs.stability_index >= TIER_THRESHOLDS.GROWING_STABILITY &&
    inputs.verified_patch_count >= 1 &&
    inputs.promoted_skill_count >= 1 &&
    (inputs.bugs_killed > 0 || inputs.saved_time_minutes > 0.0);

  if (is_growing) return 'GROWING';

  return null;
}

/**
 * Compute the tier_delta string from previous and current tier.
 *
 * Tier order for delta: null < GROWING < STABLE < BREAKTHROUGH
 */
export function computeTierDelta(previous: EvolutionTier, current: EvolutionTier): TierDelta {
  const rank: Record<string, number> = {
    'null': 0,
    'GROWING': 1,
    'STABLE': 2,
    'BREAKTHROUGH': 3,
  };
  const prev_rank = rank[previous ?? 'null'] ?? 0;
  const curr_rank = rank[current ?? 'null'] ?? 0;
  if (curr_rank > prev_rank) return '+1';
  if (curr_rank < prev_rank) return '-1';
  return '0';
}

/**
 * Compute how many consecutive cycles (including this one) have had
 * stability_index.score >= 0.85.
 * Used for BREAKTHROUGH evaluation and EvolutionReport display.
 */
export function computeConsecutiveStableCycles(
  current_stability_score: number,
  prior_consecutive: number
): number {
  if (current_stability_score >= TIER_THRESHOLDS.BREAKTHROUGH_STABILITY) {
    return prior_consecutive + 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// SECTION 2 — EvolutionReport
// ---------------------------------------------------------------------------

export function buildEvolutionReport(
  c_result: PromotingGateResult,
  tier: EvolutionTier,
  tier_delta: TierDelta,
  cumulative_promoted_skill_count_before: number,
  consecutive_stable_cycles: number,
  previous_tier: EvolutionTier
): EvolutionReport {
  const tier_thresholds_met: string[] = [];

  // Detect newly crossed thresholds
  if (tier === 'BREAKTHROUGH' && previous_tier !== 'BREAKTHROUGH') {
    tier_thresholds_met.push('BREAKTHROUGH threshold crossed');
  } else if (tier === 'STABLE' && (previous_tier === 'GROWING' || previous_tier === null)) {
    tier_thresholds_met.push('STABLE threshold crossed');
  } else if (tier === 'GROWING' && previous_tier === null) {
    tier_thresholds_met.push('GROWING threshold crossed');
  }

  if (
    consecutive_stable_cycles >= TIER_THRESHOLDS.BREAKTHROUGH_CONSECUTIVE_CYCLES &&
    (consecutive_stable_cycles - 1) < TIER_THRESHOLDS.BREAKTHROUGH_CONSECUTIVE_CYCLES
  ) {
    tier_thresholds_met.push(`${consecutive_stable_cycles}× consecutive stability`);
  }

  return {
    tier,
    tier_delta,
    promoted_skills: c_result.promoted_skills,
    promoted_skill_count: c_result.promoted_count,
    cumulative_promoted_skill_count: cumulative_promoted_skill_count_before + c_result.promoted_count,
    unlocked_nodes: c_result.unlocked_nodes,
    unlocked_node_count: c_result.unlocked_nodes.length,
    consecutive_stable_cycles,
    tier_thresholds_met,
  };
}

// ---------------------------------------------------------------------------
// SECTION 3 — GuardianReport
// ---------------------------------------------------------------------------

/**
 * Compute security_posture deterministically from invariant status and events.
 *
 * RED:   any INV_VIOLATION_REJECT event in this cycle's blocks
 *        OR active_failure_codes contains F-001_SECURITY_DOWNGRADE
 * AMBER: (invariant_failure_count > 0 OR blocked_risky_actions.count > 0)
 *        AND not RED
 * GREEN: invariant_failure_count == 0 AND blocked_risky_actions.count == 0
 */
export function computeSecurityPosture(
  invariant_failure_count: number,
  blocked_risky_actions: BlockedRiskyActions,
  active_failure_codes: FailureLedgerCode[]
): SecurityPosture {
  const has_inv_violation = blocked_risky_actions.events.some(
    (e) => e.event_code === 'INV_VIOLATION_REJECT'
  );
  const has_f001 = active_failure_codes.includes('F-001_SECURITY_DOWNGRADE');

  if (has_inv_violation || has_f001) return 'RED';

  if (invariant_failure_count > 0 || blocked_risky_actions.count > 0) return 'AMBER';

  return 'GREEN';
}

export function buildGuardianReport(
  b_result: PhaseBBatchResult,
  c_result: PromotingGateResult,
  active_failure_ledger: FailureLedgerEntry[],
  invariant_failure_count: number
): GuardianReport {
  // Collect blocked_risky_actions from Phase B rejections + Phase C HUMAN_REVIEW_DEFER
  const all_events = [
    ...b_result.rejected
      .filter((r) => r.block_event !== null)
      .map((r) => r.block_event!),
    ...c_result.gate_results
      .filter((g) => g.human_review_event !== null)
      .map((g) => ({
        event_code: g.human_review_event!.event_code as 'HUMAN_REVIEW_DEFER',
        ts: g.human_review_event!.ts,
        patch_id: g.human_review_event!.patch_id,
        reason: g.human_review_event!.reason,
      })),
  ];

  const blocked_risky_actions: BlockedRiskyActions = {
    count: all_events.length,
    events: all_events,
  };

  // Sort failure ledger by occurrence_count descending
  const sorted_ledger = [...active_failure_ledger].sort(
    (a, b) => b.occurrence_count - a.occurrence_count
  );

  const active_failure_codes: FailureLedgerCode[] = sorted_ledger.map((e) => e.code);

  const security_posture = computeSecurityPosture(
    invariant_failure_count,
    blocked_risky_actions,
    active_failure_codes
  );

  const pending_human_review_patch_ids = c_result.gate_results
    .filter((g) => g.disposition === 'DEFERRED_HUMAN')
    .map((g) => g.candidate_id);

  return {
    blocked_risky_actions,
    invariant_failure_count,
    active_failure_ledger: sorted_ledger,
    active_failure_codes,
    security_posture,
    pending_human_review_patch_ids,
  };
}

// ---------------------------------------------------------------------------
// SECTION 4 — MetricsReport
// ---------------------------------------------------------------------------

export function buildMetricsReport(
  stability_index: StabilityIndex,
  saved_time_minutes: SavedTimeMinutes,
  tokens_saved: number,
  bugs_killed: number,
  refined_code_lines: number,
  previous_cycle_metrics: PhaseDInputPack['previous_cycle_metrics']
): MetricsReport {
  let deltas: MetricsDelta;

  if (previous_cycle_metrics === null) {
    deltas = {
      stability_index: null,
      saved_time_minutes: null,
      tokens_saved: null,
      bugs_killed: null,
      refined_code_lines: null,
    };
  } else {
    deltas = {
      stability_index: stability_index.score - previous_cycle_metrics.stability_index_score,
      saved_time_minutes: saved_time_minutes.total - previous_cycle_metrics.saved_time_minutes_total,
      tokens_saved: tokens_saved - previous_cycle_metrics.tokens_saved,
      bugs_killed: bugs_killed - previous_cycle_metrics.bugs_killed,
      refined_code_lines: refined_code_lines - previous_cycle_metrics.refined_code_lines,
    };
  }

  return {
    stability_index,
    saved_time_minutes,
    tokens_saved,
    bugs_killed,
    refined_code_lines,
    deltas,
  };
}

// ---------------------------------------------------------------------------
// SECTION 5 — ProofReport
// ---------------------------------------------------------------------------

export function buildProofSummary(
  cycle_id: string,
  generated_at: string,
  legitimacy_tier: 'L0' | 'L1' | 'L2',
  tier: EvolutionTier,
  tier_delta: TierDelta,
  stability_index: StabilityIndex,
  saved_time_minutes: SavedTimeMinutes,
  tokens_saved: number,
  bugs_killed: number,
  refined_code_lines: number,
  blocked_risky_actions: BlockedRiskyActions,
  invariant_failure_count: number,
  verified_patch_count: number,
  cumulative_promoted_skill_count: number,
  unlocked_node_count: number,
  next_cycle_recommendations: NextCycleRecommendation[]
): ProofSummary {
  return {
    schema_version: 'proof_summary/0.1',
    cycle_id,
    generated_at,
    legitimacy_tier,
    tier,
    tier_delta,
    stability_index,
    saved_time_minutes,
    tokens_saved,
    bugs_killed,
    refined_code_lines,
    blocked_risky_actions,
    invariant_failure_count,
    verified_patch_count,
    promoted_skill_count: cumulative_promoted_skill_count,
    unlocked_node_count,
    next_cycle_recommendations,
  };
}

export function buildProofReport(
  proof_summary: ProofSummary,
  prior_cycle_lineage: CycleLineageSummary[]
): ProofReport {
  // Build this cycle's lineage entry
  const this_cycle_summary: CycleLineageSummary = {
    cycle_id: proof_summary.cycle_id,
    generated_at: proof_summary.generated_at,
    tier: proof_summary.tier,
    stability_index_score: proof_summary.stability_index.score,
    promoted_skill_count: proof_summary.promoted_skill_count,
    blocked_risky_actions_count: proof_summary.blocked_risky_actions.count,
    saved_time_minutes_total: proof_summary.saved_time_minutes.total,
  };

  // Prepend this cycle, trim to max 7
  const cycle_lineage = [this_cycle_summary, ...prior_cycle_lineage].slice(0, 7);

  return { proof_summary, cycle_lineage };
}

// ---------------------------------------------------------------------------
// SECTION 6 — MorningDisplay (all decisions pre-computed, zero IF in renderer)
// ---------------------------------------------------------------------------

/**
 * Determine the morning animation type.
 * Priority (highest wins): BREAKTHROUGH > CRITICAL_HOLD > TIER_UPGRADE > TIER_DOWNGRADE > TIER_HOLD
 */
export function computeAnimationType(tier: EvolutionTier, tier_delta: TierDelta): MorningAnimationType {
  if (tier === 'BREAKTHROUGH') return 'BREAKTHROUGH';
  if (tier === null) return 'CRITICAL_HOLD';
  if (tier_delta === '+1') return 'TIER_UPGRADE';
  if (tier_delta === '-1') return 'TIER_DOWNGRADE';
  return 'TIER_HOLD';
}

/**
 * Map EvolutionTier to badge color.
 */
export function computeTierBadgeColor(tier: EvolutionTier): TierBadgeColor {
  if (tier === 'BREAKTHROUGH') return 'gold';
  if (tier === 'GROWING') return 'green';
  if (tier === 'STABLE') return 'blue';
  return 'red'; // null = CRITICAL
}

/**
 * Build the primary headline (≤ 72 chars).
 * Format rules (deterministic — no subjective language):
 *   BREAKTHROUGH: "BREAKTHROUGH: {n} skills · +{t}min · +{k} tokens"
 *   CRITICAL:     "CRITICAL: no tier awarded this cycle"
 *   TIER_UPGRADE: "UPGRADED to {tier}: {n} skills promoted"
 *   TIER_DOWNGRADE: "DOWNGRADED to {tier}: review guardian report"
 *   TIER_HOLD:    "{tier}: {n} skills promoted" or "{tier}: no promotions this cycle"
 */
export function buildHeadline(
  animation: MorningAnimationType,
  tier: EvolutionTier,
  promoted_count: number,
  saved_time_minutes_total: number,
  tokens_saved: number
): string {
  switch (animation) {
    case 'BREAKTHROUGH': {
      const t = saved_time_minutes_total.toFixed(1);
      const k = tokens_saved;
      const base = `BREAKTHROUGH: ${promoted_count} skill${promoted_count !== 1 ? 's' : ''} · +${t}min · +${k} tokens`;
      return base.slice(0, 72);
    }
    case 'CRITICAL_HOLD':
      return 'CRITICAL: no tier awarded this cycle';
    case 'TIER_UPGRADE':
      return `UPGRADED to ${tier}: ${promoted_count} skill${promoted_count !== 1 ? 's' : ''} promoted`.slice(0, 72);
    case 'TIER_DOWNGRADE':
      return `DOWNGRADED to ${tier ?? 'CRITICAL'}: review guardian report`.slice(0, 72);
    case 'TIER_HOLD': {
      if (promoted_count > 0) {
        return `${tier}: ${promoted_count} skill${promoted_count !== 1 ? 's' : ''} promoted`.slice(0, 72);
      }
      return `${tier}: no promotions this cycle`.slice(0, 72);
    }
  }
}

/**
 * Build the secondary subheadline (≤ 120 chars). null when there are no guardian concerns.
 * Format: "Guardian: {n} risk{s} blocked · {codes}"
 */
export function buildSubheadline(
  security_posture: SecurityPosture,
  blocked_risky_actions_count: number,
  active_failure_codes: FailureLedgerCode[],
  pending_human_review_count: number
): string | null {
  if (security_posture === 'GREEN' && pending_human_review_count === 0) return null;

  const parts: string[] = [];

  if (blocked_risky_actions_count > 0) {
    parts.push(`${blocked_risky_actions_count} risk${blocked_risky_actions_count !== 1 ? 's' : ''} blocked`);
  }
  if (active_failure_codes.length > 0) {
    // Show at most 2 codes to stay within 120 chars
    const shown = active_failure_codes.slice(0, 2).join(', ');
    parts.push(shown);
  }
  if (pending_human_review_count > 0) {
    parts.push(`${pending_human_review_count} awaiting human review`);
  }

  const line = `Guardian: ${parts.join(' · ')}`;
  return line.slice(0, 120);
}

// ---------------------------------------------------------------------------
// SECTION 6b — Drift summary builder
// ---------------------------------------------------------------------------

export function buildDriftSummary(
  metrics: DriftMetrics[],
  adaptation?: DriftAdaptationDecision
): DriftSummary | undefined {
  // Only include targets with actual run data
  const targets_with_data = metrics.filter((m) => m.n_total_runs >= 1);
  if (targets_with_data.length === 0) return undefined;

  const targets: DriftTargetSummary[] = targets_with_data.map((m) => ({
    target_function: m.target_function,
    trend: m.trend,
    slope_20: m.slope_20,
    drift_detected: m.drift_detected,
    n_runs: m.n_total_runs,
  }));

  const any_drift_detected = targets.some((t) => t.drift_detected);
  const degrading_count = targets.filter((t) => t.trend === 'degrading').length;

  return {
    generated_at: new Date().toISOString(),
    targets,
    any_drift_detected,
    degrading_count,
    failure_code: any_drift_detected ? 'F-010_SILENT_DRIFT' : null,
    ...(adaptation !== undefined ? { adaptation } : {}),
  };
}

function computeDriftStatus(
  drift_summary: DriftSummary | undefined
): MorningDisplay['drift_status'] {
  if (!drift_summary || drift_summary.targets.length === 0) return null;
  // Only targets with sufficient data (n_runs >= 5) count toward status
  const significant = drift_summary.targets.filter((t) => t.n_runs >= 5);
  if (significant.length === 0) return null;
  if (significant.some((t) => t.drift_detected)) return 'DEGRADING';
  if (significant.some((t) => t.trend === 'improving')) return 'IMPROVING';
  return 'STABLE';
}

function buildDriftBanner(
  drift_summary: DriftSummary | undefined,
  drift_status: MorningDisplay['drift_status']
): string | null {
  if (!drift_status || drift_status === 'STABLE' || !drift_summary) return null;
  // Show worst degrading target
  const degrading = drift_summary.targets
    .filter((t) => t.drift_detected)
    .sort((a, b) => (a.slope_20 ?? 0) - (b.slope_20 ?? 0)); // most negative first
  if (degrading.length === 0) return null;
  const worst = degrading[0]!;
  const fn_short = worst.target_function.split('.').pop() ?? worst.target_function;
  const slope_str = worst.slope_20 !== null ? worst.slope_20.toExponential(2) : '?';
  const banner = `Drift \u2193: ${fn_short} (slope ${slope_str}/run) [F-010]`;
  return banner.slice(0, 120);
}

export function buildMorningDisplay(
  tier: EvolutionTier,
  tier_delta: TierDelta,
  promoted_count: number,
  saved_time_minutes_total: number,
  tokens_saved: number,
  security_posture: SecurityPosture,
  blocked_risky_actions_count: number,
  active_failure_codes: FailureLedgerCode[],
  pending_human_review_count: number,
  unlocked_node_count: number,
  drift_summary?: DriftSummary
): MorningDisplay {
  const animation = computeAnimationType(tier, tier_delta);
  const tier_badge_color = computeTierBadgeColor(tier);
  const headline = buildHeadline(animation, tier, promoted_count, saved_time_minutes_total, tokens_saved);
  const subheadline = buildSubheadline(
    security_posture,
    blocked_risky_actions_count,
    active_failure_codes,
    pending_human_review_count
  );
  const drift_status = computeDriftStatus(drift_summary);
  const drift_banner = buildDriftBanner(drift_summary, drift_status);

  return {
    animation,
    headline,
    subheadline,
    tier_badge_color,
    show_skill_parade: promoted_count > 0,
    show_guardian_alert: security_posture !== 'GREEN' || pending_human_review_count > 0,
    show_node_unlock: unlocked_node_count > 0,
    show_drift: drift_status !== null,
    drift_status,
    drift_banner,
  };
}

// ---------------------------------------------------------------------------
// SECTION 7 — Top-level aggregator
// ---------------------------------------------------------------------------

/**
 * Aggregate all Phase B + Phase C results into a MorningResult.
 *
 * This is the single entry point for Phase D.
 * It performs no I/O except the optional audit log write.
 * All business logic is delegated to the named build/compute functions above.
 */
export async function aggregateMorningResult(
  pack: PhaseDInputPack,
  config: Partial<PhaseDConfig> = {}
): Promise<MorningResult> {
  const resolved_config: PhaseDConfig = { ...DEFAULT_PHASE_D_CONFIG, ...config };
  const generated_at = new Date().toISOString();
  const cycle_id = pack.b_result.cycle_id;

  // ── Derived counts ──────────────────────────────────────────────────────
  const cumulative_promoted = pack.cumulative_promoted_skill_count_before + pack.c_result.promoted_count;

  // invariant_failure_count = count of gate1 failures across all Phase B runs
  const invariant_failure_count = pack.b_result.rejected.filter(
    (r) => r.rejection_class === 'INVARIANT_VIOLATION'
  ).length;

  // ── Guardian report (needed for tier_policy inputs) ──────────────────────
  const guardian = buildGuardianReport(
    pack.b_result,
    pack.c_result,
    pack.active_failure_ledger,
    invariant_failure_count
  );

  // ── Consecutive stable cycles ────────────────────────────────────────────
  const consecutive_stable_cycles = computeConsecutiveStableCycles(
    pack.stability_index.score,
    pack.prior_consecutive_stable_cycles
  );

  // ── Tier policy inputs ───────────────────────────────────────────────────
  const tier_policy_inputs: TierPolicyInputs = {
    stability_index: pack.stability_index.score,
    invariant_failure_count,
    blocked_risky_actions_count_in_cycle: guardian.blocked_risky_actions.count,
    saved_time_minutes: pack.saved_time_minutes.total,
    verified_patch_count: pack.b_result.summary.verified_count,
    promoted_skill_count: cumulative_promoted,
    bugs_killed: pack.bugs_killed,
    unlocked_node_count: pack.c_result.unlocked_nodes.length,
    consecutive_high_stability_cycles: consecutive_stable_cycles,
  };

  // ── Tier evaluation ──────────────────────────────────────────────────────
  const tier = computeTierPolicy(tier_policy_inputs, pack.previous_tier);
  const tier_delta = computeTierDelta(pack.previous_tier, tier);

  // ── Four sub-reports ─────────────────────────────────────────────────────
  const evolution = buildEvolutionReport(
    pack.c_result,
    tier,
    tier_delta,
    pack.cumulative_promoted_skill_count_before,
    consecutive_stable_cycles,
    pack.previous_tier
  );

  const metrics = buildMetricsReport(
    pack.stability_index,
    pack.saved_time_minutes,
    pack.tokens_saved,
    pack.bugs_killed,
    pack.refined_code_lines,
    pack.previous_cycle_metrics
  );

  const proof_summary = buildProofSummary(
    cycle_id,
    generated_at,
    pack.legitimacy_tier,
    tier,
    tier_delta,
    pack.stability_index,
    pack.saved_time_minutes,
    pack.tokens_saved,
    pack.bugs_killed,
    pack.refined_code_lines,
    guardian.blocked_risky_actions,
    invariant_failure_count,
    pack.b_result.summary.verified_count,
    cumulative_promoted,
    pack.c_result.unlocked_nodes.length,
    pack.next_cycle_recommendations
  );

  const proof = buildProofReport(proof_summary, pack.prior_cycle_lineage);

  // ── Display (zero IF in renderer) ────────────────────────────────────────
  const drift_summary = pack.drift_metrics
    ? buildDriftSummary(pack.drift_metrics, pack.drift_adaptation)
    : undefined;

  const display = buildMorningDisplay(
    tier,
    tier_delta,
    pack.c_result.promoted_count,
    pack.saved_time_minutes.total,
    pack.tokens_saved,
    guardian.security_posture,
    guardian.blocked_risky_actions.count,
    guardian.active_failure_codes,
    guardian.pending_human_review_patch_ids.length,
    pack.c_result.unlocked_nodes.length,
    drift_summary
  );

  const result: MorningResult = {
    schema_version: 'morning_result/0.1',
    cycle_id,
    generated_at,
    evolution,
    guardian,
    metrics,
    proof,
    display,
    ...(drift_summary !== undefined ? { drift: drift_summary } : {}),
  };

  // ── Audit log ─────────────────────────────────────────────────────────────
  if (resolved_config.audit_log_dir) {
    try {
      fs.mkdirSync(resolved_config.audit_log_dir, { recursive: true });
      const out_path = path.join(
        resolved_config.audit_log_dir,
        `morning_result_${cycle_id}.json`
      );
      fs.writeFileSync(out_path, JSON.stringify(result, null, 2), 'utf8');
    } catch (_) {
      // Audit log write failure must never crash the aggregator
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// SECTION 8 — Structural validator
// ---------------------------------------------------------------------------

/**
 * Validate that a raw object structurally matches MorningResult.
 * Returns an array of error strings; empty = passed.
 */
export function validateMorningResultShell(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    errors.push('result is not an object');
    return errors;
  }
  const r = raw as Record<string, unknown>;

  if (r['schema_version'] !== 'morning_result/0.1') {
    errors.push(`schema_version: expected 'morning_result/0.1', got ${String(r['schema_version'])}`);
  }
  if (typeof r['cycle_id'] !== 'string' || r['cycle_id'].length === 0) {
    errors.push('cycle_id: missing or empty');
  }
  for (const sub of ['evolution', 'guardian', 'metrics', 'proof', 'display']) {
    if (typeof r[sub] !== 'object' || r[sub] === null) {
      errors.push(`${sub}: missing or not an object`);
    }
  }

  // Display cross-checks
  const disp = r['display'] as Record<string, unknown> | undefined;
  if (disp) {
    const valid_animations: MorningAnimationType[] = [
      'BREAKTHROUGH', 'CRITICAL_HOLD', 'TIER_UPGRADE', 'TIER_DOWNGRADE', 'TIER_HOLD',
    ];
    if (!valid_animations.includes(disp['animation'] as MorningAnimationType)) {
      errors.push(`display.animation: invalid value '${String(disp['animation'])}'`);
    }
    if (typeof disp['headline'] !== 'string' || (disp['headline'] as string).length > 72) {
      errors.push('display.headline: missing or exceeds 72 chars');
    }
    if (disp['subheadline'] !== null && typeof disp['subheadline'] === 'string') {
      if ((disp['subheadline'] as string).length > 120) {
        errors.push('display.subheadline: exceeds 120 chars');
      }
    }
    for (const flag of ['show_skill_parade', 'show_guardian_alert', 'show_node_unlock', 'show_drift']) {
      if (typeof disp[flag] !== 'boolean') {
        errors.push(`display.${flag}: must be a boolean`);
      }
    }
  }

  // ProofSummary schema_version cross-check
  const proof = r['proof'] as Record<string, unknown> | undefined;
  if (proof && typeof proof['proof_summary'] === 'object' && proof['proof_summary'] !== null) {
    const ps = proof['proof_summary'] as Record<string, unknown>;
    if (ps['schema_version'] !== 'proof_summary/0.1') {
      errors.push(`proof.proof_summary.schema_version: expected 'proof_summary/0.1'`);
    }
    if (!Array.isArray(ps['next_cycle_recommendations'])) {
      errors.push('proof.proof_summary.next_cycle_recommendations: must be an array');
    }
  }

  return errors;
}
