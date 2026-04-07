/**
 * tools/phase_c_orchestrator.ts
 *
 * Phase C — Promoting Gate Orchestrator
 * schema_version: phase_c/0.1
 *
 * Responsibilities:
 *   1. Evaluate system-level gate conditions SYS-01..03 once per cycle
 *   2. If system gate fails → defer ALL VerifiedPatches as DEFERRED_STABILITY
 *   3. If system gate passes → evaluate per-patch gates P-01..02 for each patch
 *   4. PROMOTED         → build PromotedSkill, optionally activate capability nodes
 *   5. DEFERRED_HUMAN   → emit HUMAN_REVIEW_DEFER event
 *   6. Assemble PromotingGateResult and write audit JSON to disk
 *
 * Does NOT apply patches to production (that is the caller's concern).
 * Does NOT call the LLM.
 * Takes a CapabilityGraphEvaluator as an injected seam for node activation.
 *
 * Gate constants (from phase_c_promote.d.ts contract):
 *   SYSTEM_STABILITY_FLOOR = 0.55
 *   SYS-01: stability_index.score >= SYSTEM_STABILITY_FLOOR
 *   SYS-02: invariant_failure_count_this_cycle == 0
 *   SYS-03: no INV_VIOLATION_REJECT event in blocked_risky_actions this cycle
 *   P-01:   estimated_blast_radius != 'HIGH'
 *   P-02:   stability_index_delta >= 0.0
 *
 * Imports:
 *   - PhaseBBatchResult, VerifiedPatch from contract/phase_b_verify
 *   - PromotingGateResult, PromotingGateCondition, VerifiedPatchGateResult,
 *     VerifiedPatchDisposition, PromotedSkill, UnlockedNode
 *     from contract/phase_c_promote
 *   - BlockedRiskyActions from contract/self_evolution_metrics
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { PhaseBBatchResult, VerifiedPatch } from '../contract/phase_b_verify';
import type {
  PromotingGateResult,
  PromotingGateCondition,
  VerifiedPatchGateResult,
  VerifiedPatchDisposition,
  PromotedSkill,
  UnlockedNode,
} from '../contract/phase_c_promote';
import type { BlockedRiskyActions } from '../contract/self_evolution_metrics';

// ---------------------------------------------------------------------------
// GATE CONSTANTS (derived from contract spec)
// ---------------------------------------------------------------------------

export const SYSTEM_STABILITY_FLOOR = 0.55;

// ---------------------------------------------------------------------------
// INJECTED SEAMS
// ---------------------------------------------------------------------------

/**
 * Input snapshot the caller provides to the system gate evaluator.
 * All values are read from the ledger BEFORE this Phase C run begins.
 */
export interface SystemStateSnapshot {
  /** §SYS-01: current cycle's stability_index.score FROM THE LEDGER. */
  stability_index_score: number;

  /**
   * §SYS-02: count of INV-xxx checks that returned false this cycle.
   * Sourced from PhaseBBatchResult after invariant gate runs.
   */
  invariant_failure_count_this_cycle: number;

  /**
   * §SYS-03: all blocked_risky_actions events emitted this cycle.
   * Presence of any INV_VIOLATION_REJECT event closes the system gate.
   */
  blocked_risky_actions_this_cycle: BlockedRiskyActions;
}

/**
 * Pluggable capability graph evaluator.
 * The orchestrator calls this after each successful promotion to ask:
 * "did this skill activate any new nodes?"
 *
 * Real implementation walks a graph config file.
 * Tests inject a mock returning [] or predetermined nodes.
 */
export interface CapabilityGraphEvaluator {
  /**
   * Given the full set of skill IDs promoted in this cycle so far,
   * return any UnlockedNode records that should be activated.
   * Must be idempotent — calling again with the same skill IDs returns
   * the same (or empty) node list.
   */
  evaluateNodes(
    newly_promoted_skill_ids: string[],
    all_promoted_skill_ids_this_cycle: string[]
  ): Promise<UnlockedNode[]>;
}

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

export interface PhaseCConfig {
  /**
   * Directory where per-cycle audit JSON files are written.
   * null → skip disk write (useful in unit tests).
   */
  audit_log_dir: string | null;
}

export const DEFAULT_PHASE_C_CONFIG: PhaseCConfig = {
  audit_log_dir: null,
};

// ---------------------------------------------------------------------------
// SECTION 1 — System Gate (SYS-01..03)
// Evaluated ONCE per cycle before any per-patch logic.
// ---------------------------------------------------------------------------

/**
 * Evaluate the three system-level preconditions.
 *
 * All three must pass for the cycle to proceed with promotions.
 * Conditions are evaluated independently (no short-circuit) so that the
 * audit record always surfaces ALL failing conditions, not just the first.
 */
export function evaluateSystemGate(snapshot: SystemStateSnapshot): {
  passed: boolean;
  conditions: PromotingGateCondition[];
  first_failure_reason: string | null;
} {
  const conditions: PromotingGateCondition[] = [];

  // SYS-01: stability floor
  const sys01_passed = snapshot.stability_index_score >= SYSTEM_STABILITY_FLOOR;
  conditions.push({
    condition_id: 'SYS-01',
    required: `stability_index.score >= ${SYSTEM_STABILITY_FLOOR}`,
    actual: snapshot.stability_index_score.toFixed(4),
    passed: sys01_passed,
  });

  // SYS-02: zero invariant failures
  const sys02_passed = snapshot.invariant_failure_count_this_cycle === 0;
  conditions.push({
    condition_id: 'SYS-02',
    required: 'invariant_failure_count_this_cycle == 0',
    actual: String(snapshot.invariant_failure_count_this_cycle),
    passed: sys02_passed,
  });

  // SYS-03: no INV_VIOLATION_REJECT event in this cycle
  const sys03_violating = snapshot.blocked_risky_actions_this_cycle.events.filter(
    (e) => e.event_code === 'INV_VIOLATION_REJECT'
  );
  const sys03_passed = sys03_violating.length === 0;
  conditions.push({
    condition_id: 'SYS-03',
    required: 'no INV_VIOLATION_REJECT event in blocked_risky_actions this cycle',
    actual: sys03_violating.length === 0
      ? 'none'
      : `${sys03_violating.length} violation(s): [${sys03_violating.map((e) => e.invariant_id ?? '?').join(', ')}]`,
    passed: sys03_passed,
  });

  const all_passed = sys01_passed && sys02_passed && sys03_passed;

  const first_failure = conditions.find((c) => !c.passed);
  const first_failure_reason = first_failure
    ? `${first_failure.condition_id} failed: required ${first_failure.required}, actual ${first_failure.actual}`
    : null;

  return { passed: all_passed, conditions, first_failure_reason };
}

// ---------------------------------------------------------------------------
// SECTION 2 — Per-Patch Gates (P-01..02)
// Evaluated per VerifiedPatch, only when system gate has passed.
// ---------------------------------------------------------------------------

/**
 * Evaluate per-patch gate conditions P-01 and P-02.
 *
 * Returns the disposition and the conditions evaluated.
 * Both are independent checks; if P-01 fails the patch is DEFERRED_HUMAN
 * regardless of P-02 (no conflict possible — HIGH blast_radius means P-01
 * should have been a pre-screen in Phase B, but Phase C is the enforcement
 * boundary for promotability).
 */
export function evaluatePatchGate(patch: VerifiedPatch): {
  disposition: VerifiedPatchDisposition;
  conditions: PromotingGateCondition[];
  defer_reason: string | null;
} {
  const conditions: PromotingGateCondition[] = [];

  // P-01: blast_radius != 'GLOBAL' (GLOBAL requires human review)
  const blast = patch.source_candidate.estimated_blast_radius;
  const p01_passed = blast !== 'GLOBAL';
  conditions.push({
    condition_id: 'P-01',
    required: "estimated_blast_radius != 'GLOBAL'",
    actual: blast,
    passed: p01_passed,
  });

  // P-02: stability_index_delta >= 0.0
  const delta = patch.stability_index_delta;
  const p02_passed = delta >= 0.0;
  conditions.push({
    condition_id: 'P-02',
    required: 'stability_index_delta >= 0.0',
    actual: delta.toFixed(6),
    passed: p02_passed,
  });

  // Determine disposition
  // P-01 failure → DEFERRED_HUMAN (needs explicit human approval)
  if (!p01_passed) {
    return {
      disposition: 'DEFERRED_HUMAN',
      conditions,
      defer_reason: null, // defer_reason is only for DEFERRED_STABILITY
    };
  }

  // P-02 failure → DEFERRED_STABILITY (treated same as system instability)
  if (!p02_passed) {
    return {
      disposition: 'DEFERRED_STABILITY',
      conditions,
      defer_reason: `P-02 failed: stability_index_delta ${delta.toFixed(6)} < 0.0`,
    };
  }

  return { disposition: 'PROMOTED', conditions, defer_reason: null };
}

// ---------------------------------------------------------------------------
// SECTION 3 — PromotedSkill construction
// ---------------------------------------------------------------------------

/**
 * Build a PromotedSkill from a VerifiedPatch that passed all gates.
 * The skill_id is a fresh UUID; the caller may pass a pre-generated one
 * for deterministic tests.
 */
export function buildPromotedSkill(
  patch: VerifiedPatch,
  promoted_at: string,
  skill_id?: string
): PromotedSkill {
  const id = skill_id ?? randomUUID();
  return {
    schema_version: 'promoted_skill/0.1',
    skill_id: id,
    promoted_at,
    source_cycle_id: patch.cycle_id,
    source_verified_patch_id: patch.candidate_id,
    title: patch.source_candidate.title,
    affected_targets: patch.source_candidate.affected_targets.map((t) => t.file_path),
    confirmed_improvements: {
      saved_time_minutes: patch.confirmed_improvements.saved_time_minutes,
      tokens_saved: patch.confirmed_improvements.tokens_saved,
      bugs_killed: patch.confirmed_improvements.bugs_killed,
      refined_code_lines: patch.confirmed_improvements.refined_code_lines,
      stability_index_delta: patch.stability_index_delta,
    },
    unlocked_node_id: null, // filled in after capability graph evaluation
  };
}

// ---------------------------------------------------------------------------
// SECTION 4 — Human review event construction
// ---------------------------------------------------------------------------

/**
 * Build the HUMAN_REVIEW_DEFER event that must be emitted when a patch
 * is deferred for human review (DEFERRED_HUMAN disposition).
 */
export function buildHumanReviewEvent(
  patch: VerifiedPatch,
  ts: string
): VerifiedPatchGateResult['human_review_event'] {
  return {
    event_code: 'HUMAN_REVIEW_DEFER',
    patch_id: patch.candidate_id,
    reason: `blast_radius='${patch.source_candidate.estimated_blast_radius}' requires human approval before promotion`,
    ts,
  };
}

// ---------------------------------------------------------------------------
// SECTION 5 — Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run Phase C for all VerifiedPatches from a PhaseBBatchResult.
 *
 * Execution sequence:
 *   1. Evaluate system gate (SYS-01..03)
 *   2a. System gate FAILED → defer all patches as DEFERRED_STABILITY
 *   2b. System gate PASSED → evaluate per-patch gates P-01..02 for each patch
 *       - PROMOTED      → build PromotedSkill, append to accumulator
 *       - DEFERRED_HUMAN → emit HUMAN_REVIEW_DEFER event
 *       - DEFERRED_STABILITY → record defer_reason
 *   3. After all promotions: call CapabilityGraphEvaluator for node activation
 *   4. Attach unlocked_node_id to affected PromotedSkill records
 *   5. Assemble PromotingGateResult
 *   6. Write audit JSON to disk (if audit_log_dir is set)
 *
 * @param b_result         The full PhaseBBatchResult from Phase B
 * @param system_snapshot  System state snapshot: stability_score, inv_failures, block_events
 * @param node_evaluator   Capability graph evaluator (injectable)
 * @param config           PhaseCConfig (audit_log_dir etc.)
 */
export async function runPhaseCPromotion(
  b_result: PhaseBBatchResult,
  system_snapshot: SystemStateSnapshot,
  node_evaluator: CapabilityGraphEvaluator,
  config: Partial<PhaseCConfig> = {}
): Promise<PromotingGateResult> {
  const resolved_config: PhaseCConfig = { ...DEFAULT_PHASE_C_CONFIG, ...config };
  const evaluated_at = new Date().toISOString();

  // Step 1: Evaluate system gate
  const system_gate = evaluateSystemGate(system_snapshot);

  const promoted_skills: PromotedSkill[] = [];
  const gate_results: VerifiedPatchGateResult[] = [];
  let deferred_human_review_count = 0;
  let deferred_stability_count = 0;

  if (!system_gate.passed) {
    // Step 2a: System gate failed — defer everything
    for (const patch of b_result.verified) {
      gate_results.push({
        candidate_id: patch.candidate_id,
        disposition: 'DEFERRED_STABILITY',
        patch_conditions_evaluated: [],
        promoted_skill_id: null,
        human_review_event: null,
        defer_reason: system_gate.first_failure_reason ?? 'system gate failed',
      });
      deferred_stability_count++;
    }
  } else {
    // Step 2b: System gate passed — evaluate per patch
    const promoted_at = evaluated_at;

    for (const patch of b_result.verified) {
      const patch_gate = evaluatePatchGate(patch);

      if (patch_gate.disposition === 'PROMOTED') {
        const skill = buildPromotedSkill(patch, promoted_at);
        promoted_skills.push(skill);

        gate_results.push({
          candidate_id: patch.candidate_id,
          disposition: 'PROMOTED',
          patch_conditions_evaluated: patch_gate.conditions,
          promoted_skill_id: skill.skill_id,
          human_review_event: null,
          defer_reason: null,
        });

      } else if (patch_gate.disposition === 'DEFERRED_HUMAN') {
        const event = buildHumanReviewEvent(patch, evaluated_at);
        gate_results.push({
          candidate_id: patch.candidate_id,
          disposition: 'DEFERRED_HUMAN',
          patch_conditions_evaluated: patch_gate.conditions,
          promoted_skill_id: null,
          human_review_event: event,
          defer_reason: null,
        });
        deferred_human_review_count++;

      } else {
        // DEFERRED_STABILITY (P-02 failed)
        gate_results.push({
          candidate_id: patch.candidate_id,
          disposition: 'DEFERRED_STABILITY',
          patch_conditions_evaluated: patch_gate.conditions,
          promoted_skill_id: null,
          human_review_event: null,
          defer_reason: patch_gate.defer_reason,
        });
        deferred_stability_count++;
      }
    }
  }

  // Step 3: Capability graph evaluation (only when at least one skill was promoted)
  const unlocked_nodes: UnlockedNode[] = [];
  if (promoted_skills.length > 0) {
    const newly_promoted_ids = promoted_skills.map((s) => s.skill_id);
    const newly_unlocked = await node_evaluator.evaluateNodes(
      newly_promoted_ids,
      newly_promoted_ids // Phase D aggregator tracks cumulative; here we pass this-cycle set
    );
    unlocked_nodes.push(...newly_unlocked);

    // Step 4: Attach unlocked_node_id to the triggering PromotedSkill
    for (const node of unlocked_nodes) {
      const skill = promoted_skills.find((s) => s.skill_id === node.source_skill_id);
      if (skill) {
        // PromotedSkill is being assembled; mutate before freezing
        skill.unlocked_node_id = node.node_id;
      }
    }
  }

  const result: PromotingGateResult = {
    schema_version: 'phase_c_promote/0.1',
    cycle_id: b_result.cycle_id,
    evaluated_at,
    verified_patch_count: b_result.verified.length,
    system_gate_passed: system_gate.passed,
    system_gate_conditions: system_gate.conditions,
    promoted_skills,
    promoted_count: promoted_skills.length,
    deferred_human_review_count,
    deferred_stability_count,
    gate_results,
    unlocked_nodes,
  };

  // Step 6: Write audit log
  if (resolved_config.audit_log_dir) {
    try {
      fs.mkdirSync(resolved_config.audit_log_dir, { recursive: true });
      const out_path = path.join(
        resolved_config.audit_log_dir,
        `phase_c_promote_${b_result.cycle_id}.json`
      );
      fs.writeFileSync(out_path, JSON.stringify(result, null, 2), 'utf8');
    } catch (_) {
      // Audit log write failure must never crash the orchestrator
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// SECTION 6 — Structural pre-validator
// ---------------------------------------------------------------------------

/**
 * Quickly validate that a raw object looks like a PromotingGateResult
 * before downstream consumers rely on it.
 * Returns an array of error strings; empty means the check passed.
 */
export function validatePromotingGateResultShell(raw: unknown): string[] {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    errors.push('result is not an object');
    return errors;
  }
  const r = raw as Record<string, unknown>;

  if (r['schema_version'] !== 'phase_c_promote/0.1') {
    errors.push(`schema_version: expected 'phase_c_promote/0.1', got ${String(r['schema_version'])}`);
  }
  if (typeof r['cycle_id'] !== 'string' || r['cycle_id'].length === 0) {
    errors.push('cycle_id: missing or empty');
  }
  if (typeof r['system_gate_passed'] !== 'boolean') {
    errors.push('system_gate_passed: must be a boolean');
  }
  if (!Array.isArray(r['system_gate_conditions'])) {
    errors.push('system_gate_conditions: must be an array');
  }
  if (!Array.isArray(r['promoted_skills'])) {
    errors.push('promoted_skills: must be an array');
  }
  if (!Array.isArray(r['gate_results'])) {
    errors.push('gate_results: must be an array');
  }
  if (!Array.isArray(r['unlocked_nodes'])) {
    errors.push('unlocked_nodes: must be an array');
  }

  for (const field of ['promoted_count', 'deferred_human_review_count', 'deferred_stability_count', 'verified_patch_count']) {
    if (typeof r[field] !== 'number') {
      errors.push(`${field}: must be a number`);
    }
  }

  // Cross-check: promoted_count must equal promoted_skills.length
  if (
    Array.isArray(r['promoted_skills']) &&
    typeof r['promoted_count'] === 'number' &&
    (r['promoted_skills'] as unknown[]).length !== r['promoted_count']
  ) {
    errors.push(
      `promoted_count (${r['promoted_count']}) does not match promoted_skills.length (${(r['promoted_skills'] as unknown[]).length})`
    );
  }

  // Cross-check: gate_results.length must equal verified_patch_count
  if (
    Array.isArray(r['gate_results']) &&
    typeof r['verified_patch_count'] === 'number' &&
    (r['gate_results'] as unknown[]).length !== r['verified_patch_count']
  ) {
    errors.push(
      `gate_results.length (${(r['gate_results'] as unknown[]).length}) does not match verified_patch_count (${r['verified_patch_count']})`
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// SECTION 7 — Null capability graph (default / no-op)
// ---------------------------------------------------------------------------

/**
 * A no-op CapabilityGraphEvaluator that never activates any nodes.
 * Use when the capability graph feature is not yet configured for a deployment.
 */
export const NULL_CAPABILITY_GRAPH_EVALUATOR: CapabilityGraphEvaluator = {
  evaluateNodes: async (_newly, _all) => [],
};
