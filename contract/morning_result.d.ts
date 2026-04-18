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
  TaskStateMachineStatus,
} from './self_evolution_metrics';
import type { WorldShiftReport, EnvironmentStatus } from './world_shift';
import type { GatewayCycleSummary } from './openclaw_gateway';
import type { OpenClawLearningSummary } from './openclaw_action_log';
import type { DecisionTrace } from './openclaw_scoring';

// ---------------------------------------------------------------------------
// Skill Tree — per-entry enriched view for UI display (Phase G → H)
// ---------------------------------------------------------------------------

/**
 * A single node in the skill tree.
 * Each node represents one active AdaptationMemoryEntry enriched with
 * hint_score, TTL remaining, environment affinity, and biome decay (Phase H1).
 */
export interface SkillTreeNode {
  /** dedup_key — stable identity across re-promotions. */
  dedup_key: string;
  /** Short display title (= first 60 chars of AdaptationMemoryEntry.title). */
  title: string;
  /** Primary target file path. */
  target: string;
  /** Raw hint_score at promotion time (0.0–1.0). */
  hint_score: number;
  /** Current effective_score after temporal decay (0.0–1.0). */
  effective_score: number;
  /**
   * Days until effective_score drops below HINT_MIN_EFFECTIVE_SCORE (0.05).
   * null when hint_score is already below threshold.
   */
  ttl_days_remaining: number | null;
  /**
   * Environment affinity map: env_status → avg_hint_score accumulated in that env.
   * Sourced from adaptation_memory_env_scores.json (Phase G2 sidecar).
   */
  environment_affinity: { [environment_status: string]: number };
  /** How many times this pattern has been re-promoted (from reuse_stats). */
  reuse_count: number;
  /** blast_radius of the original patch. */
  blast_radius: string;
  /** ISO-8601 UTC when this entry was promoted. */
  recorded_at: string;
  /** 'llm' or 'openclaw'. */
  patch_source: string;

  // ── Phase H1: Biome decay ─────────────────────────────────────────────────
  /**
   * Penalty multiplier for biome mismatch.
   * 1.0 = same biome (no penalty), 0.3 = foreign biome (70% penalty).
   * null when current_environment_status is unknown at build time.
   */
  biome_penalty: number | null;
  /**
   * effective_score × biome_penalty.
   * null when current_environment_status is unknown.
   */
  biome_effective_score: number | null;
  /**
   * Days until biome-adjusted score drops below threshold.
   * Shorter than ttl_days_remaining when in a foreign biome.
   * null when biome_penalty is null OR skill is already biome-dead.
   */
  biome_ttl_days_remaining: number | null;

  // ── Phase I3: Natural selection ────────────────────────────────────────────
  /**
   * Selection pressure applied to this node.
   * PERSIST: effective_score ≥ 0.5 AND (reuse_count ≥ 1 OR home-biome match).
   * PRUNE:   effective_score < 0.2  OR biome_effective_score < 0.1 (when known).
   * NEUTRAL: all other cases.
   */
  selection_pressure: 'PRUNE' | 'NEUTRAL' | 'PERSIST';

  // ── Phase I4: Agent competition (dominance) ────────────────────────────────
  /**
   * True when this node has the highest biome-adjusted (or global) effective_score
   * among all nodes targeting the same file.  Only one node per target can be dominant.
   */
  is_dominant: boolean;

  // ── Phase J2: Technology branch ────────────────────────────────────────────
  /**
   * Evolutionary specialization direction of this skill.
   * Computed deterministically from blast_radius, reuse_count, and environment_affinity.
   */
  tech_branch: TechBranch;

  // ── OpenClaw operational signal ────────────────────────────────────────────
  /**
   * Success rate for enqueue_candidate attempts targeting this file,
   * sourced from openclaw_intent_stats.json per-intent aggregates.
   * null when no action log entries exist for this target.
   * Populated by enrichSkillTreeWithOpenClawStats() in the decision engine.
   */
  openclaw_success_rate?: number | null;

  /** Total non-SUCCESS attempt count from the action log for this target. null = no data. */
  openclaw_failure_count?: number | null;

  /** ISO-8601 UTC of the most recent SUCCESS enqueue_candidate for this target. null = no data. */
  openclaw_last_used_at?: string | null;

  /**
   * Visual signal for morning display renderer.
   *   'green'  — success_rate ≥ 0.70 OR (selection_pressure === 'PERSIST' AND not expired)
   *   'red'    — success_rate < 0.30 OR selection_pressure === 'PRUNE'
   *   'gray'   — ttl_days_remaining === null (expired / below threshold)
   *   'yellow' — all other cases
   * Populated by enrichSkillTreeWithOpenClawStats().
   */
  visual_signal?: 'green' | 'red' | 'gray' | 'yellow';
}

/**
 * A synthesized meta-skill combining two co-located nodes or meta-skills.
 *
 * Phase H2 (level 1): two active nodes targeting the same file.
 *   title: "[合成] <file>: A × B"
 * Phase I1 (level 2): two level-1 MetaSkills combined.
 *   title: "[超合成] <file>: MetaA × MetaB"
 *   component dedup_key references a level-1 synthesis_key.
 *
 * synergy_score formula:
 *   level 1: avg(eff_a, eff_b) × 1.1
 *   level 2: avg(syn_a, syn_b) × 1.1
 */
export interface MetaSkill {
  /** Stable key: sorted component keys joined with '||'. */
  synthesis_key: string;
  /** Display title. */
  title: string;
  /** Shared target file path (or dominant shared path for level-2). */
  target: string;
  /** Synergy-boosted combined score (0.0–1.0+). */
  synergy_score: number;
  component_a: { dedup_key: string; title: string; hint_score: number };
  component_b: { dedup_key: string; title: string; hint_score: number };
  /**
   * Phase I1: synthesis depth.
   * 1 = node + node (base synthesis, Phase H2)
   * 2 = MetaSkill + MetaSkill (meta-of-meta, Phase I1)
   */
  level: 1 | 2;
}

/**
 * One entry in the skill death log.
 * Phase H3: records recently-expired skills and biome-mismatch casualties.
 */
export interface ExpiredSkillEntry {
  dedup_key: string;
  title: string;
  target: string;
  /** hint_score at time of last promotion. */
  last_hint_score: number;
  /** Why this skill is considered expired at this moment. */
  expired_reason: 'ttl_decay' | 'biome_mismatch';
  /** ISO-8601 UTC when expiry was detected (= buildSkillTree() run time). */
  detected_at: string;
}

/**
 * Phase I2: Per-environment mastery stats.
 * Computed from accumulated env_scores across all promotions in that environment.
 */
export interface BiomeMastery {
  /** Total number of times any skill was promoted while in this environment. */
  total_promotions: number;
  /** Average hint_score across all promotions in this environment. */
  avg_hint_score: number;
  /**
   * Count of "wins": promotions with hint_score ≥ 0.5 (high-quality outcomes).
   * Represents the environment's yield of high-value skills.
   */
  win_count: number;
  /** win_count / total_promotions. Zero when no promotions. */
  win_rate: number;
  /**
   * Mastery rank based on total_promotions.
   * NOVICE:     < 3 promotions  (exploring the biome)
   * APPRENTICE: 3–9 promotions  (learning the terrain)
   * MASTER:     ≥ 10 promotions (dominating this environment)
   */
  mastery_rank: 'NOVICE' | 'APPRENTICE' | 'MASTER';
}

/**
 * Phase J2: Technology branch classification for a SkillTreeNode.
 *
 * SPEED:      blast_radius=SELF + effective_score ≥ 0.4   (surgical, fast)
 * STABILITY:  reuse_count ≥ 1 + effective_score ≥ 0.4    (proven, safe)
 * RESILIENCE: multiple environment_affinity keys           (cross-env adaptive)
 * GENERAL:    all other nodes                             (no specialization)
 */
export type TechBranch = 'SPEED' | 'STABILITY' | 'RESILIENCE' | 'GENERAL';

/**
 * Phase J1: A culture cluster — a group of skills sharing a dominant trait.
 * Clusters emerge from blast_radius grouping.
 */
export interface CultureCluster {
  /** Cluster identity key (= blast_radius label or 'MIXED'). */
  cluster_id: string;
  /** Human-readable faction name. */
  label: string;
  /** Number of nodes in this cluster. */
  member_count: number;
  /** Average effective_score across cluster members. */
  avg_effective_score: number;
  /** The TechBranch that appears most among cluster members. */
  dominant_tech_branch: TechBranch;
}

/**
 * Phase J3: Civilization collapse risk level.
 *
 * civilization_health_score = avg(effective_scores) × (1 − prune_ratio)
 *   CRITICAL: health < 0.20  (civilization at risk of collapse)
 *   WARNING:  health < 0.40  (deteriorating)
 *   SAFE:     health ≥ 0.40  (stable civilization)
 */
export type CollapseRisk = 'SAFE' | 'WARNING' | 'CRITICAL';

/**
 * Phase J4: Civilization summary — macro-level civilization state.
 */
export interface CivSummary {
  /**
   * Composite health metric (0.0–1.0).
   * avg(active effective_scores) × (1 − prune_fraction)
   */
  civilization_health_score: number;

  /** Collapse risk classification based on health score. */
  collapse_risk: CollapseRisk;

  /**
   * The currently dominant strategy: the PERSIST+is_dominant node
   * with the highest effective_score (or biome-adjusted when available).
   * null when no active nodes qualify.
   */
  dominant_strategy: {
    dedup_key: string;
    title: string;
    target: string;
    effective_score: number;
  } | null;

  /** Phase J1: active culture clusters (≥ 1 member). */
  culture_clusters: CultureCluster[];

  /**
   * Phase J2: fraction of nodes per tech branch.
   * e.g. { "SPEED": 0.58, "STABILITY": 0.25, "RESILIENCE": 0.08, "GENERAL": 0.08 }
   */
  tech_branch_distribution: { [branch in TechBranch]?: number };

  /** Count of nodes per TechBranch (raw counts). */
  tech_branch_counts: { [branch in TechBranch]?: number };
}

// ---------------------------------------------------------------------------
// Phase K1: Governed Intervention  (文明介入 / Policy Layer)
// ---------------------------------------------------------------------------

/**
 * Discrete actions the OS issues when intervention is triggered.
 *
 *   BOOST_RESILIENCE   — Prioritise RESILIENCE-typed hints in next cycle.
 *   REDUCE_SPEED_BIAS  — Penalise SPEED-only nodes to restore balance.
 *   PRUNE_UNSTABLE     — Force-prune PRUNE-pressure nodes immediately.
 *   EMERGENCY_REBUILD  — Collapse event: retain memory but rebuild skill set.
 */
export type InterventionAction =
  | 'BOOST_RESILIENCE'
  | 'REDUCE_SPEED_BIAS'
  | 'PRUNE_UNSTABLE'
  | 'EMERGENCY_REBUILD';

/**
 * Phase K1: OS-issued intervention directive.
 * Generated whenever collapse_risk ≠ SAFE.
 */
export interface CivIntervention {
  /** Whether any intervention has been triggered this cycle. */
  triggered: boolean;

  /** Why intervention fired. null when triggered=false. */
  trigger_reason: 'WARNING_THRESHOLD' | 'CRITICAL_THRESHOLD' | null;

  /** Ordered list of recommended corrective actions. */
  actions: InterventionAction[];

  /**
   * Recommended branch realignment.
   * Populated when a tech branch imbalance is detected.
   * e.g. { from: 'SPEED', to: 'RESILIENCE' }
   */
  target_branch_shift: { from: TechBranch; to: TechBranch } | null;

  /**
   * Number of nodes that would be directly affected
   * (SPEED nodes for WARNING, PRUNE nodes for CRITICAL).
   */
  affected_node_count: number;

  /** ISO-8601 UTC when this intervention was computed. */
  computed_at: string;
}

// ---------------------------------------------------------------------------
// Phase K2: Civilization Fork Projection  (文明分岐)
// ---------------------------------------------------------------------------

/**
 * Hypothetical civilization health if the skill tree were biased fully toward
 * a single TechBranch.  Used to compare evolutionary trajectories.
 */
export interface CivForkBranch {
  /** Target branch this fork represents. */
  target_tech_branch: TechBranch;

  /**
   * Projected health_score if only nodes aligned to this branch were retained.
   * Computed as avg(effective_score of branch nodes) × (1 − branch_prune_fraction).
   */
  projected_health: number;

  /** Projected collapse risk for this fork. */
  projected_collapse_risk: CollapseRisk;

  /**
   * Number of active nodes that align to this branch and would survive
   * in this hypothetical fork.
   */
  supporting_node_count: number;
}

/**
 * Phase K2: Fork projection report.
 * Maps out all possible TechBranch divergence pathways.
 */
export interface CivFork {
  /** True when there is meaningful divergence (≥ 2 viable branches with different projections). */
  fork_viable: boolean;

  /** One entry per TechBranch that has ≥ 1 supporting node. */
  branches: CivForkBranch[];

  /**
   * The branch with the highest projected_health.
   * null when all projections are identical (e.g. all GENERAL).
   */
  recommended_branch: TechBranch | null;
}

export interface SkillTreeReport {
  /** Total active (non-expired) nodes included. */
  active_count: number;
  /** Number of historical entries excluded due to decay expiry. */
  expired_count: number;
  /** Top active nodes sorted by effective_score DESC. Max 20. */
  nodes: SkillTreeNode[];
  /** Phase H2+I1: synthesized meta-skills (level-1 and level-2). Up to 3+(1 l2). */
  synthesized_skills: MetaSkill[];
  /** Phase H3: recently-expired + biome-dead entries (up to 5). */
  recently_expired: ExpiredSkillEntry[];
  /** Current environment used for biome decay. null when unknown. */
  current_environment: string | null;
  /** Phase I2: per-environment mastery. Empty when env_scores has no data. */
  biome_mastery: { [environment_status: string]: BiomeMastery };
  /** Phase J4: civilization-level macro summary. */
  civ_summary: CivSummary;
  /** Phase K1: OS-issued intervention directive. */
  civ_intervention: CivIntervention;
  /** Phase K2: divergence fork projection. */
  civ_fork: CivFork;
  /** Phase K3: multi-civilization competition report. */
  multi_civ: MultiCivReport;
  /** Phase K4: civilization generation tracker. */
  civ_generation: CivGeneration;
  /** ISO-8601 UTC when this report was computed. */
  computed_at: string;
}

// ---------------------------------------------------------------------------
// Phase K3: Multi-Civilization Competition  (文明間競争)
// ---------------------------------------------------------------------------

/**
 * Competitive status of a single branch-civilization in the multi-civ arena.
 *   DOMINANT   — rank 1 and projected SAFE
 *   COMPETING  — viable (≥ WARNING) but not rank 1
 *   ELIMINATED — projected CRITICAL (evolutionary dead end)
 */
export type MultiCivStatus = 'DOMINANT' | 'COMPETING' | 'ELIMINATED';

/**
 * One civilization entry in the multi-civ competition.
 * Derived from the CivFork projections but ranked against peers.
 */
export interface MultiCivRun {
  /** The TechBranch identity of this civilization. */
  branch: TechBranch;
  /** Projected health if this branch were the sole survivor. */
  projected_health: number;
  /** Projected collapse risk. */
  projected_collapse_risk: CollapseRisk;
  /** Number of nodes supporting this civilization. */
  node_count: number;
  /** Rank among all civilizations (1 = strongest). */
  rank: number;
  /** Competitive status derived from rank + collapse_risk. */
  status: MultiCivStatus;
}

/**
 * Phase K3: Multi-civilization competition summary.
 * Runs all TechBranch civilizations head-to-head.
 */
export interface MultiCivReport {
  /** Ordered ranking of all participating civilizations (strongest first). */
  runs: MultiCivRun[];
  /**
   * The dominant branch (rank 1 with SAFE projection).
   * null when no branch achieves SAFE.
   */
  dominant_branch: TechBranch | null;
  /** Branches that are projected CRITICAL — evolutionary dead ends. */
  eliminated: TechBranch[];
  /** True when ≥ 2 civilizations are both SAFE (genuine competition). */
  competition_active: boolean;
  /** ISO-8601 UTC. */
  computed_at: string;
}

// ---------------------------------------------------------------------------
// Phase K4: Civilization Collapse & Rebuild  (文明崩壊・世代交代)
// ---------------------------------------------------------------------------

/**
 * A single collapse event recording what happened at the moment of collapse.
 */
export interface CollapseEvent {
  /** Generation number at the point of collapse (the generation that fell). */
  generation: number;
  /** ISO-8601 UTC when collapse was triggered. */
  collapsed_at: string;
  /** Always 'CRITICAL_HEALTH' for now. Extensible for future triggers. */
  reason: 'CRITICAL_HEALTH';
  /**
   * Number of nodes that would be purged (PRUNE-pressure nodes).
   * Memory entries (JSONL) are retained across resets.
   */
  nodes_pruned: number;
  /** civilization_health_score at moment of collapse. */
  health_at_collapse: number;
}

/**
 * Phase K4: Civilization generation tracker.
 * Persisted across cycles via civ_generation.json sidecar.
 */
export interface CivGeneration {
  /** Monotonically increasing generation index (starts at 1). */
  current_generation: number;
  /** Total collapses ever recorded. */
  total_collapses: number;
  /**
   * True when the current cycle triggers a collapse
   * (civ_summary.collapse_risk === 'CRITICAL').
   */
  is_collapsing_this_cycle: boolean;
  /** Last 5 collapse events (oldest first). */
  collapse_history: CollapseEvent[];
}

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

  /**
   * DISPLAY-LAYER: current environment adaptation status.
   * null when world_shift_config is not active (WorldShiftDetector not wired).
   */
  environment_status: EnvironmentStatus | null;

  /**
   * Pre-formatted one-line world shift banner for the morning screen.
   * null when no shift was detected or world_shift_config is inactive.
   * e.g. "[HOSTILE] API Rift: LLMモデル変更 → Unstable Terrain"
   * Maximum 120 chars.
   */
  world_shift_banner: string | null;

  /**
   * true when world_shift_config is active AND any_shift_detected = true.
   * Controls visibility of the world shift section in the morning screen.
   */
  show_world_shift: boolean;

  /**
   * Number of OpenClaw requests processed by the gateway this cycle.
   * 0 when the gateway is not wired (openclaw_gateway absent in NightlyLoopContext).
   */
  gateway_requests_processed: number;

  /**
   * true when gateway_requests_processed > 0.
   * Controls visibility of the gateway activity section in the morning screen.
   */
  show_gateway_activity: boolean;
}

// ---------------------------------------------------------------------------
// MorningBrief — Structured daily action panel for OpenClaw Daily Ops Operator
// ---------------------------------------------------------------------------

/**
 * Civilization status digest for the morning action panel.
 * Sourced from skill_tree.civ_summary (+ metrics fallback).
 */
export interface MorningBriefCivStatus {
  /**
   * civilization_health_score (0.0–1.0) from CivSummary.
   * Falls back to stability_index.score when skill_tree is absent.
   */
  health: number;
  /** Derived from CivSummary.collapse_risk (or health threshold fallback). */
  collapse_risk: CollapseRisk;
  /**
   * Dominant TechBranch — sourced from civ_fork.recommended_branch
   * or the dominant_strategy node's tech_branch.
   * null when no dominant strategy is determinable.
   */
  dominant_strategy: TechBranch | null;
}

/** One item in the must_act list — an intent needing immediate attention. */
export interface MorningBriefMustActItem {
  /** intent_key from openclaw_intent_stats ("<target>::<phrase>"). */
  intent: string;
  /** Human-readable reason, e.g. "success_rate 0.33 (3 attempts)". */
  reason: string;
  /** Suggested next action, e.g. "review or reduce scope". */
  action: string;
}

/** One item in the human review priority queue. */
export interface MorningBriefReviewItem {
  /** patch_id from guardian.pending_human_review_patch_ids. */
  id: string;
  /**
   * Priority 1: security_posture === RED (system unsafe — handle immediately).
   * Priority 2: invariant_failure_count > 0 OR struggling intents present.
   * Priority 3: normal (handle when convenient).
   */
  priority: 1 | 2 | 3;
  /** One-sentence human-readable reason for this priority. */
  reason: string;
}

/**
 * Structured daily action panel produced once per cycle.
 *
 * Replaces free-text morning summaries with a machine-readable structure
 * that directly drives the operator's decision loop:
 *   must_act           → immediate enqueue or review required
 *   safe_to_ignore     → low-risk / high-success intents; skip today
 *   recommended_actions → ordered Gateway commands / next steps
 *   review_queue       → priority-sorted human review items
 *
 * Schema: openclaw_morning_brief/0.1
 */
export interface MorningBrief {
  schema_version: 'openclaw_morning_brief/0.1';
  generated_at: string;
  civ_status: MorningBriefCivStatus;
  /** Intents with success_rate < 0.50 AND ≥ 2 attempts — need action now. */
  must_act: MorningBriefMustActItem[];
  /** Intents with success_rate ≥ 0.70 OR only 1 attempt — safe to skip. */
  safe_to_ignore: { intent: string }[];
  /** Ordered list of recommended Gateway commands / advisory actions. */
  recommended_actions: string[];
  /** Human review items sorted by priority ASC (1 = most urgent). */
  review_queue: MorningBriefReviewItem[];
  /**
   * Decision trace from the last `decideAction()` call for this cycle.
   * Shows chosen action, score, and rejected alternatives — removes black-box.
   * Absent on the first cycle or when decideAction was not called.
   */
  decision_trace?: DecisionTrace;
}

// ---------------------------------------------------------------------------
// NightlyCycleAudit — restart safety + AC layer provenance ("生存証明")
// ---------------------------------------------------------------------------

/**
 * Emitted once per nightly cycle and embedded in MorningResult.
 * Provides a machine-readable audit trail proving that:
 *   - The cycle was not silently lost on restart (F-011 detection)
 *   - All required AC layers were evaluated before promotion
 *   - Negative constraints (F-019) were checked exactly once per candidate
 *
 * Schema freeze: nightly_cycle_audit/0.1
 */
export interface NightlyCycleAudit {
  schema_version: 'nightly_cycle_audit/0.1';

  /** The cycle_id this audit record belongs to. */
  cycle_id: string;

  /** Final TaskStateMachineStatus at cycle completion. */
  final_state: TaskStateMachineStatus;

  /**
   * Whether this cycle was resumed from a prior incomplete run
   * (task_state.json held HYPOTHESIZING/TESTING/PROMOTING on process start).
   */
  was_resume: boolean;

  /**
   * Whether F-011_STATE_LOSS_ON_RESTART was emitted on startup.
   * true means the task_state.json was unreadable or schema-invalid;
   * the cycle was reset to OBSERVING with a fresh cycle_id.
   */
  state_loss_on_startup: boolean;

  /**
   * ISO-8601 UTC timestamp when the TSM record was first read on process startup
   * (the moment the restart recovery protocol ran).
   */
  startup_tsm_read_at: string;

  /**
   * F-codes whose occurrence_count was incremented (or first created) this cycle.
   * Sourced from RejectedPatch.failure_ledger_write entries processed in Phase B.
   */
  newly_triggered_codes: FailureLedgerCode[];

  /** Total active FailureLedgerEntry count at cycle end. */
  active_ledger_count: number;
}

// ---------------------------------------------------------------------------
// ExternalComparisonSchema — OpenClaw vs AGOS architectural divergence map
// ---------------------------------------------------------------------------

/** 6-axis comparison baseline used by renderer + operator morning review. */
export type ComparisonAxis =
  | 'Runtime'
  | 'Skill'
  | 'Safety'
  | 'Provenance'
  | 'Boundary'
  | 'Recovery';

/** Soft/hard/partial mechanism class used for visual encoding. */
export type ComparisonMechanismClass = 'soft' | 'hard' | 'partial';

/** One side of a comparison row (OpenClaw or AGOS). */
export interface ComparisonSide {
  label: string;
  verdict: ComparisonMechanismClass;
  detail: string;
  mechanism: ComparisonMechanismClass;
}

/** One axis row in the 6x2 comparison matrix. */
export interface ComparisonRow {
  axis: ComparisonAxis;
  icon: string;
  openclaw: ComparisonSide;
  agos: ComparisonSide;
}

/** Boundary IDs currently modeled in the constitutional spec. */
export type ConstitutionalBoundaryId = 'CB-1' | 'CB-2' | 'CB-3' | 'CB-4';

/**
 * Trace row: which comparison axis best expresses the decisive divergence
 * for each constitutional boundary.
 */
export interface BoundaryDivergenceTraceItem {
  boundary_id: ConstitutionalBoundaryId;
  axis: ComparisonAxis;
  openclaw_mechanism: ComparisonMechanismClass;
  agos_mechanism: ComparisonMechanismClass;
  rationale: string;
}

/** Full comparison bundle embedded in MorningResult. */
export interface ComparisonSchema {
  schema_version: 'comparison_schema/0.1';
  generated_at: string;
  rows: ComparisonRow[];
  boundary_trace: BoundaryDivergenceTraceItem[];
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

  /**
   * World Shift report for this cycle.
   * Absent when world_shift_config is not wired into the nightly loop runner.
   * DISPLAY-LAYER ONLY — must not affect governance decisions.
   */
  world_shift?: WorldShiftReport;

  /**
   * OpenClaw Gateway cycle summary.
   * Absent when openclaw_gateway is not wired into the nightly loop runner.
   * DISPLAY-LAYER ONLY — must not affect governance decisions.
   */
  gateway_summary?: GatewayCycleSummary;

  /**
   * Skill tree: per-node view of accumulated adaptation memory enriched with
   * hint_score, TTL remaining, and environment_affinity.
   * Absent when adaptation_memory_path is not wired into the nightly loop runner.
   * DISPLAY-LAYER ONLY — must not affect governance decisions.
   */
  skill_tree?: SkillTreeReport;

  /**
   * OpenClaw self-improvement summary — aggregated from openclaw_action_log.jsonl
   * and the intent/suggest-path sidecar files.
   *
   * Populated by the morning_result aggregator (Phase D) when
   * action_log_path is wired into OpenClawGatewayConfig.
   * Absent when no action log exists or log is empty.
   *
   * Consumers:
   *   - Morning screen renderer → [OpenClaw 学習状況] section
   *   - Daily Ops Operator morning_brief → surfaces struggling_intents
   *     and best suggest_path to guide next-cycle proposals.
   *
   * DISPLAY-LAYER ONLY — must not affect governance decisions.
   */
  openclaw_learning_summary?: OpenClawLearningSummary;

  /**
   * Structured action panel for the Daily Ops Operator.
   * Pre-computed from openclaw_learning_summary, guardian, and civ_summary.
   * Absent when no action log data is available and no reviews are pending.
   * DISPLAY-LAYER ONLY — must not affect governance decisions.
   */
  morning_brief?: MorningBrief;

  /**
   * Per-cycle audit trail for restart safety and AC layer provenance.
   * Records F-011 detection, resume status, and newly triggered failure codes.
   * DISPLAY-LAYER ONLY — must not affect governance decisions.
   */
  nightly_audit?: NightlyCycleAudit;

  /**
   * External architectural comparison baseline (OpenClaw vs AGOS).
   * DISPLAY-LAYER ONLY — must not affect governance decisions.
   */
  comparison_schema?: ComparisonSchema;
}
