/**
 * contract/phase_c_promote.d.ts
 *
 * Phase C — Promoting Gate Output Contract
 * Schema version: phase_c/0.1
 *
 * Consumes VerifiedPatch[] from Phase B and decides which patches are
 * actually applied to production ("promoted") versus deferred.
 *
 * State Machine transition: TESTING → PROMOTING
 *
 * Gate preconditions (evaluated once per cycle, before any individual patch):
 *   SYS-01  stability_index.score >= SYSTEM_STABILITY_FLOOR (0.55)
 *   SYS-02  invariant_failure_count_this_cycle == 0
 *   SYS-03  no INV_VIOLATION_REJECT event in blocked_risky_actions this cycle
 *
 * If ANY precondition fails → all VerifiedPatches are DEFERRED_STABILITY
 *   and the entire cycle is flagged system_gate_passed = false.
 *
 * Per-patch gate conditions (only evaluated when system gate passes):
 *   P-01  estimated_blast_radius != 'HIGH'
 *         (HIGH blast_radius → DEFERRED_HUMAN with HUMAN_REVIEW_DEFER event)
 *   P-02  stability_index_delta >= 0.0
 *         (negative delta cannot be promoted even if Phase B passed)
 *
 * Downstream consumers:
 *   - PromotedSkill[]       → MorningResult.evolution.promoted_skills
 *   - UnlockedNode[]        → MorningResult.evolution.unlocked_nodes
 *   - HUMAN_REVIEW_DEFER events → MorningResult.guardian.blocked_risky_actions
 *   - promoted_count        → ProofSummary.verified_patch_count (Phase B) is separate
 *                             ProofSummary.promoted_skill_count (Phase C, cumulative)
 *
 * Imports:
 *   - VerifiedPatch from ./phase_b_verify
 *   - EvolutionTier, Ratio, BlockedRiskyActionCode from ./self_evolution_metrics
 */

import type { VerifiedPatch } from './phase_b_verify';
import type { EvolutionTier, Ratio } from './self_evolution_metrics';

// ---------------------------------------------------------------------------
// UnlockedNode — new capability node activated by a promotion
// ---------------------------------------------------------------------------

/**
 * A capability node that becomes active for the first time this cycle
 * as a direct consequence of a skill promotion.
 *
 * Nodes represent compound emergent capabilities that require one or more
 * upstream skills before they can fire.
 * Example: "auto-hotfix" node requires both 'sandbox isolation' skill
 *          AND 'regression confidence ≥ 0.90' skill to be promoted first.
 */
export interface UnlockedNode {
  /** Stable identifier of the node in the capability graph. */
  node_id: string;
  /** Human-readable display name for the morning animation. */
  node_name: string;
  unlocked_at: string;        // ISO-8601 UTC
  /** The PromotedSkill that pushed this node over its activation threshold. */
  source_skill_id: string;
  /** One-sentence description shown on the morning screen. */
  description: string;
}

// ---------------------------------------------------------------------------
// PromotedSkill — a VerifiedPatch that has been applied to production
// ---------------------------------------------------------------------------

/**
 * A skill (patch) that passed both Phase B sandbox verification AND
 * the Phase C promoting gate, and has been applied to the live system.
 *
 * A PromotedSkill is immutable after creation — it is the permanent record
 * that something improved the system on this date.
 */
export interface PromotedSkill {
  schema_version: 'promoted_skill/0.1';

  /** Stable UUID for this promotion event. */
  skill_id: string;
  promoted_at: string;           // ISO-8601 UTC
  source_cycle_id: string;

  /** Reference back to the VerifiedPatch that produced this skill. */
  source_verified_patch_id: string;

  /** From PatchCandidate.title (verbatim). */
  title: string;

  /** From PatchCandidate.affected_targets (verbatim). */
  affected_targets: string[];

  /**
   * Actual confirmed improvements verified in sandbox (Phase B).
   * null for a metric means it was not applicable / not measured in this patch.
   */
  confirmed_improvements: {
    saved_time_minutes: number | null;
    tokens_saved: number | null;
    bugs_killed: number | null;
    refined_code_lines: number | null;
    /** Actual post_patch - pre_patch stability_index.score. Always >= 0. */
    stability_index_delta: number;
  };

  /**
   * Capability node activated by this promotion, if any.
   * null when this skill did not push any node over its threshold.
   */
  unlocked_node_id: string | null;
}

// ---------------------------------------------------------------------------
// Promoting gate evaluation
// ---------------------------------------------------------------------------

/** A single gate condition check (system-level or per-patch). */
export interface PromotingGateCondition {
  /** Machine-readable condition identifier (e.g., 'SYS-01', 'P-01'). */
  condition_id: string;
  /** Human-readable requirement string. */
  required: string;
  /** Actual observed value at evaluation time. */
  actual: string;
  passed: boolean;
}

/**
 * How each VerifiedPatch was disposed after the promoting gate evaluation.
 * PROMOTED:          All gate conditions passed → became PromotedSkill.
 * DEFERRED_HUMAN:    blast_radius='HIGH' → HUMAN_REVIEW_DEFER event emitted;
 *                    patch is held for async human approval.
 * DEFERRED_STABILITY: System gate precondition failed (SYS-01/02/03);
 *                    patch is deferred to the next cycle, NOT discarded.
 */
export type VerifiedPatchDisposition =
  | 'PROMOTED'
  | 'DEFERRED_HUMAN'
  | 'DEFERRED_STABILITY';

/** Per-patch result of the Phase C gate evaluation. */
export interface VerifiedPatchGateResult {
  candidate_id: string;     // from VerifiedPatch.candidate_id
  disposition: VerifiedPatchDisposition;
  patch_conditions_evaluated: PromotingGateCondition[];

  /**
   * Set when disposition = 'PROMOTED'.
   * The skill_id of the PromotedSkill created from this patch.
   */
  promoted_skill_id: string | null;

  /**
   * Set when disposition = 'DEFERRED_HUMAN'.
   * Must be written to blocked_risky_actions and to MorningResult.guardian.
   */
  human_review_event: {
    event_code: 'HUMAN_REVIEW_DEFER';
    patch_id: string;  // candidate_id
    reason: string;
    ts: string;        // ISO-8601 UTC
  } | null;

  /**
   * Set when disposition = 'DEFERRED_STABILITY'.
   * One-sentence reason (which SYS condition failed).
   */
  defer_reason: string | null;
}

// ---------------------------------------------------------------------------
// PromotingGateResult — top-level Phase C output
// ---------------------------------------------------------------------------

/**
 * The complete result of one Phase C (PROMOTING) run.
 * Produced once per cycle, immediately after PhaseBBatchResult is finalized.
 *
 * This is the last typed boundary before MorningResult aggregation.
 */
export interface PromotingGateResult {
  schema_version: 'phase_c_promote/0.1';
  cycle_id: string;
  evaluated_at: string;  // ISO-8601 UTC

  /**
   * Count of VerifiedPatches that entered this gate.
   * Matches PhaseBBatchResult.summary.verified_count.
   */
  verified_patch_count: number;

  /**
   * Whether the system-level preconditions (SYS-01..03) all passed.
   * false → all dispositions are DEFERRED_STABILITY regardless of patch content.
   */
  system_gate_passed: boolean;

  /** System-level conditions evaluated (SYS-01, SYS-02, SYS-03). */
  system_gate_conditions: PromotingGateCondition[];

  /**
   * Skills that were successfully promoted this cycle.
   * Empty if system_gate_passed = false.
   */
  promoted_skills: PromotedSkill[];

  /** Count of promoted_skills. Feeds ProofSummary.promoted_skill_count delta. */
  promoted_count: number;

  /** Count of patches deferred to human review (DEFERRED_HUMAN). */
  deferred_human_review_count: number;

  /** Count of patches deferred to next cycle (DEFERRED_STABILITY). */
  deferred_stability_count: number;

  /** Per-patch breakdown (all VerifiedPatches accounted for). */
  gate_results: VerifiedPatchGateResult[];

  /**
   * Capability nodes newly activated this cycle by the promotions.
   * Empty when promoted_count = 0.
   */
  unlocked_nodes: UnlockedNode[];
}
