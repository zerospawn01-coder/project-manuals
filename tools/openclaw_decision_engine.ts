/**
 * tools/openclaw_decision_engine.ts
 *
 * OpenClaw Decision Engine — Operational optimisation helpers.
 * Makes OpenClaw a "operations-optimising AI", not just a "learning AI".
 *
 * Exported functions (all pure unless they read files):
 *
 *   ① Morning action panel
 *       buildMorningBrief(result, intent_stats?, suggest_stats?)
 *       → MorningBrief | null
 *
 *   ② Auto scope shrink (GLOBAL → TENANT → SELF)
 *       autoShrinkBlastRadius(blast_radius)
 *       → BlastRadiusLabel
 *
 *   ③ Success-pattern reuse engine
 *       selectBestHintForTarget(target, hints)
 *       → QueryHintEntry | null
 *       selectBestSuggestPath(suggest_stats)
 *       → SuggestPath
 *
 *   ④ Struggling-intent lockdown
 *       isIntentLocked(intent_key, intent_stats)
 *       → boolean
 *
 *   ⑤ Human review prioritisation
 *       prioritizeReviewItem(patch_id, guardian, context)
 *       → { priority: 1 | 2 | 3; reason: string }
 *
 *   Skill-tree enrichment
 *       enrichSkillTreeWithOpenClawStats(skill_tree, intent_stats)
 *       → void   (mutates nodes in place)
 *
 *   ⑥ Score-based competing-actions decision  (openclaw_scoring/0.1)
 *       deriveEnvironmentState(result)
 *       → EnvironmentState
 *       buildScoringWeights(env)
 *       → ScoringWeights
 *       applyRecencyDecay(success_rate, age_seconds, tau)
 *       → { effective_success_rate; recent_weight }
 *       scoreCandidate(candidate, weights, policy?)
 *       → ScoredCandidate
 *       selectBestCandidate(candidates, env?, policy?)
 *       → { best; all_scored } | null
 *       updatePolicy(policy, action_type, reward)
 *       → ActionPolicy
 *       decideAction(intent_key, intent_stats, best_hint_quality, current_blast, result?, policy?)
 *       → { best; all_scored } | null
 *
 * GOVERNANCE BOUNDARY:
 *   This engine is DISPLAY + ANALYTICS LAYER ONLY.
 *   It MUST NOT modify governance weights, tier thresholds, invariant
 *   definitions, FailureLedger, or any OS pipeline file.
 */

import type {
  MorningResult,
  MorningBrief,
  MorningBriefCivStatus,
  MorningBriefMustActItem,
  MorningBriefReviewItem,
  SkillTreeNode,
  SkillTreeReport,
  CollapseRisk,
  TechBranch,
  GuardianReport,
} from '../contract/morning_result';
import type {
  OpenClawIntentStats,
  OpenClawIntentStatsFile,
  OpenClawSuggestStatsFile,
  SuggestPath,
} from '../contract/openclaw_action_log';
import type { BlastRadiusLabel } from '../contract/adaptation_memory';
import type {
  ActionCandidate,
  ScoredCandidate,
  ScoringWeights,
  EnvironmentState,
  ActionPolicy,
  DecisionTrace,
} from '../contract/openclaw_scoring';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** success_rate threshold below which an intent is "struggling". */
const STRUGGLING_RATE = 0.50;
/** Minimum attempts before an intent can be flagged struggling. */
const STRUGGLING_MIN_ATTEMPTS = 2;
/** success_rate threshold below which an intent is "locked". */
const LOCKED_RATE = 0.50;
/** Minimum attempts before an intent is locked. */
const LOCKED_MIN_ATTEMPTS = 2;
/** success_rate floor for "safe to ignore" (working well, skip today). */
const SAFE_IGNORE_RATE = 0.70;
/** success_rate threshold for review priority escalation. */
const REVIEW_PRIORITY2_RATE = 0.50;

// ---------------------------------------------------------------------------
// ① buildMorningBrief — main morning action panel
// ---------------------------------------------------------------------------

/**
 * Assemble a `MorningBrief` from the fully-assembled `MorningResult`.
 *
 * Returns null when there is no actionable data (no learning summary AND
 * no pending reviews AND no civ_intervention).
 *
 * @param result        The completed MorningResult for this cycle.
 * @param intent_stats  Optional: loaded intent_stats file (all-time).
 *                      When provided, safe_to_ignore and priority scoring
 *                      use full per-intent data rather than top-3 summary.
 * @param suggest_stats Optional: loaded suggest_stats file for recommended_actions.
 */
export function buildMorningBrief(
  result: MorningResult,
  intent_stats?: OpenClawIntentStatsFile,
  suggest_stats?: OpenClawSuggestStatsFile,
  last_decision_trace?: DecisionTrace,
): MorningBrief | null {
  const summary = result.openclaw_learning_summary;
  const guardian = result.guardian;
  const pending_reviews = guardian.pending_human_review_patch_ids;
  const civ_intervention = result.skill_tree?.civ_intervention;

  // Skip if nothing to act on
  const has_learning_data = summary !== undefined && summary.total_attempts > 0;
  const has_reviews = pending_reviews.length > 0;
  const has_intervention = civ_intervention?.triggered === true;
  if (!has_learning_data && !has_reviews && !has_intervention) {
    return null;
  }

  const generated_at = new Date().toISOString();

  // ── civ_status ────────────────────────────────────────────────────────────
  const civ_status = buildCivStatus(result);

  // ── must_act ─────────────────────────────────────────────────────────────
  const must_act: MorningBriefMustActItem[] = buildMustAct(summary);

  // ── safe_to_ignore ────────────────────────────────────────────────────────
  const safe_to_ignore = buildSafeToIgnore(summary, intent_stats);

  // ── recommended_actions ───────────────────────────────────────────────────
  const recommended_actions = buildRecommendedActions(
    must_act,
    pending_reviews,
    guardian,
    suggest_stats,
    civ_intervention,
  );

  // ── review_queue ──────────────────────────────────────────────────────────
  const review_queue = buildReviewQueue(pending_reviews, guardian, intent_stats);

  return {
    schema_version: 'openclaw_morning_brief/0.1',
    generated_at,
    civ_status,
    must_act,
    safe_to_ignore,
    recommended_actions,
    review_queue,
    ...(last_decision_trace !== undefined && { decision_trace: last_decision_trace }),
  };
}

// ── private helpers ──────────────────────────────────────────────────────────

function buildCivStatus(result: MorningResult): MorningBriefCivStatus {
  const civ = result.skill_tree?.civ_summary;
  const health = civ?.civilization_health_score ?? result.metrics.stability_index.score;
  const collapse_risk: CollapseRisk = civ?.collapse_risk ?? computeCollapseRisk(health);
  // dominant_strategy: prefer civ_fork recommendation, then dominant node
  const dominant_strategy: TechBranch | null =
    result.skill_tree?.civ_fork?.recommended_branch ??
    (result.skill_tree?.nodes.find((n) => n.is_dominant)?.tech_branch ?? null);
  return { health, collapse_risk, dominant_strategy };
}

function buildMustAct(
  summary: MorningResult['openclaw_learning_summary'],
): MorningBriefMustActItem[] {
  if (!summary) return [];
  return summary.struggling_intents.map((intent) => {
    const rate = (intent.success_rate * 100).toFixed(0);
    const action =
      intent.dominant_fail_pattern === 'high_risk_global'
        ? 'SELFスコープに縮小して再提案'
        : intent.dominant_fail_pattern === 'duplicate_strategy'
        ? 'hint を再利用して rationale を変形'
        : 'scope を見直すか hint を再クエリ';
    return {
      intent: intent.intent_key,
      reason: `success_rate ${rate}% (${intent.total_attempts} attempts)`,
      action,
    };
  });
}

function buildSafeToIgnore(
  summary: MorningResult['openclaw_learning_summary'],
  intent_stats?: OpenClawIntentStatsFile,
): { intent: string }[] {
  // Use full intent_stats when available
  if (intent_stats) {
    return Object.values(intent_stats.stats)
      .filter(
        (s) =>
          s.success_rate >= SAFE_IGNORE_RATE &&
          s.total_attempts >= 1,
      )
      .slice(0, 5)
      .map((s) => ({ intent: s.intent_key }));
  }
  // Fallback: anything NOT in struggling_intents with success_count > 0
  if (!summary) return [];
  const struggling_keys = new Set(summary.struggling_intents.map((i) => i.intent_key));
  // We can't enumerate "good" intents from the summary alone (it only has top-3 struggling).
  // Return an empty list in this case — safe_to_ignore is advisory.
  void struggling_keys; // suppress unused variable warning
  return [];
}

function buildRecommendedActions(
  must_act: MorningBriefMustActItem[],
  pending_reviews: string[],
  guardian: GuardianReport,
  suggest_stats?: OpenClawSuggestStatsFile,
  civ_intervention?: { triggered: boolean; recommended_actions?: string[] } | undefined,
): string[] {
  const actions: string[] = [];

  // Best suggest_path recommendation
  if (suggest_stats) {
    const best = selectBestSuggestPath(suggest_stats);
    if (best !== 'none') {
      const stat = suggest_stats.stats[best];
      const rate = stat ? Math.round(stat.success_rate * 100) : 0;
      actions.push(
        `次回提案前に suggest_path="${best}" を使用 (過去成功率 ${rate}%)`,
      );
    }
  }

  // Struggling intent actions
  for (const item of must_act) {
    actions.push(`[要対応] ${item.action}: "${item.intent}"`);
  }

  // Priority-1 review approvals
  const p1 = pending_reviews.filter((_, i) => i === 0 && guardian.security_posture === 'RED');
  for (const patch_id of p1) {
    actions.push(`approve review_id=${patch_id} (優先度1: システム不安定)`);
  }
  // Normal reviews
  const p_normal = pending_reviews.filter((id) => !p1.includes(id));
  for (const patch_id of p_normal) {
    actions.push(`review review_id=${patch_id}`);
  }

  // Civilization intervention
  if (civ_intervention?.triggered) {
    const civ_actions = civ_intervention.recommended_actions ?? [];
    for (const ca of civ_actions.slice(0, 2)) {
      actions.push(`[文明介入] ${ca}`);
    }
  }

  return actions;
}

function buildReviewQueue(
  pending_reviews: string[],
  guardian: GuardianReport,
  intent_stats?: OpenClawIntentStatsFile,
): MorningBriefReviewItem[] {
  return pending_reviews.map((patch_id) => {
    const ctx = prioritizeReviewItem(patch_id, guardian, intent_stats);
    return { id: patch_id, ...ctx };
  });
}

// ---------------------------------------------------------------------------
// ② autoShrinkBlastRadius — GLOBAL → TENANT → SELF (fail-safe scope reduction)
// ---------------------------------------------------------------------------

/**
 * Shrink blast_radius by one tier when a HIGH_RISK_BLOCKED reject occurs.
 *
 * Mapping:
 *   'GLOBAL' → 'TENANT'
 *   'TENANT' → 'SELF'
 *   'SELF'   → 'SELF'  (already minimum; no further shrink)
 *
 * Rule: OpenClaw calls this automatically when reject_reason === 'high_risk_global'.
 */
export function autoShrinkBlastRadius(blast_radius: BlastRadiusLabel): BlastRadiusLabel {
  if (blast_radius === 'GLOBAL') return 'TENANT';
  if (blast_radius === 'TENANT') return 'SELF';
  return 'SELF';
}

// ---------------------------------------------------------------------------
// ③ Success-pattern reuse engine
// ---------------------------------------------------------------------------

/**
 * Select the best suggest_path from historical success rates.
 *
 * Returns the path with the highest success_rate among those that have
 * been attempted at least once. Falls back to 'reuse_hint' (safest default).
 */
export function selectBestSuggestPath(
  suggest_stats: OpenClawSuggestStatsFile,
): SuggestPath {
  const entries = Object.entries(suggest_stats.stats) as [
    SuggestPath,
    { times_suggested: number; success_rate: number },
  ][];
  const viable = entries.filter(
    ([path, s]) => path !== 'none' && s.times_suggested > 0,
  );
  if (viable.length === 0) return 'reuse_hint';
  viable.sort((a, b) => b[1].success_rate - a[1].success_rate);
  return viable[0][0];
}

/**
 * From a list of hints for a given target, return the best one
 * (highest effective_score, selection_pressure !== 'PRUNE').
 *
 * The shape expected for each hint entry is the payload from query_hints:
 *   { dedup_key, target, effective_score, selection_pressure, ... }
 */
export function selectBestHintForTarget(
  target: string,
  hints: Array<{
    dedup_key: string;
    target: string;
    effective_score: number;
    selection_pressure: 'PERSIST' | 'NEUTRAL' | 'PRUNE';
  }>,
): {
  dedup_key: string;
  target: string;
  effective_score: number;
  selection_pressure: 'PERSIST' | 'NEUTRAL' | 'PRUNE';
} | null {
  const normalised = target.toLowerCase();
  const candidates = hints
    .filter(
      (h) =>
        h.selection_pressure !== 'PRUNE' &&
        (h.target.toLowerCase().includes(normalised) ||
          normalised.includes(h.target.toLowerCase())),
    )
    .sort((a, b) => b.effective_score - a.effective_score);
  return candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// ④ Struggling-intent lockdown
// ---------------------------------------------------------------------------

/**
 * Returns true when the given intent_key is "locked" — i.e., its success
 * rate is so low that generating new candidates is wasteful.
 *
 * Locked intents should only use reuse_hint or human review.
 *
 * Threshold: success_rate < 0.50 AND total_attempts >= 2.
 */
export function isIntentLocked(
  intent_key: string,
  intent_stats: OpenClawIntentStatsFile,
): boolean {
  const stat = intent_stats.stats[intent_key];
  if (!stat) return false;
  return (
    stat.total_attempts >= LOCKED_MIN_ATTEMPTS &&
    stat.success_rate < LOCKED_RATE
  );
}

/**
 * Given an intent_stats file, return the list of currently locked intent_keys.
 * Useful for displaying a "locked" banner in the morning panel.
 */
export function listLockedIntents(intent_stats: OpenClawIntentStatsFile): OpenClawIntentStats[] {
  return Object.values(intent_stats.stats).filter(
    (s) =>
      s.total_attempts >= LOCKED_MIN_ATTEMPTS &&
      s.success_rate < LOCKED_RATE,
  );
}

// ---------------------------------------------------------------------------
// ⑤ Human review prioritisation
// ---------------------------------------------------------------------------

/**
 * Compute the review priority for a single patch_id.
 *
 * Priority rules:
 *   1 — security_posture === RED (system is unsafe; handle immediately)
 *   2 — invariant_failure_count > 0 OR any struggling intents exist
 *   3 — normal
 *
 * When intent_stats is provided, also escalates to priority 2 if any
 * intent for the review's target has success_rate < REVIEW_PRIORITY2_RATE.
 *
 * Note: We can't know a patch's blast_radius from guardian state alone.
 *       Callers with access to the raw action log should supply intent_stats
 *       for better scoring.
 */
export function prioritizeReviewItem(
  _patch_id: string,
  guardian: GuardianReport,
  intent_stats?: OpenClawIntentStatsFile,
): { priority: 1 | 2 | 3; reason: string } {
  if (guardian.security_posture === 'RED') {
    return { priority: 1, reason: 'セキュリティ姿勢 RED — 即対応必須' };
  }

  const has_invariant_failures = guardian.invariant_failure_count > 0;
  const has_struggling = intent_stats
    ? Object.values(intent_stats.stats).some(
        (s) =>
          s.total_attempts >= STRUGGLING_MIN_ATTEMPTS &&
          s.success_rate < REVIEW_PRIORITY2_RATE,
      )
    : false;

  if (has_invariant_failures || has_struggling) {
    const reason = has_invariant_failures
      ? `invariant 違反 ${guardian.invariant_failure_count} 件あり`
      : 'struggling_intent あり — 関連する可能性';
    return { priority: 2, reason };
  }

  return { priority: 3, reason: '通常レビュー' };
}

// ---------------------------------------------------------------------------
// Skill-tree enrichment — adds openclaw stats to SkillTreeNode[]
// ---------------------------------------------------------------------------

/**
 * Overlay OpenClaw operational stats onto `SkillTreeNode` entries.
 *
 * Mutates `skill_tree.nodes` in place.
 * Fields populated: openclaw_success_rate, openclaw_failure_count,
 *                   openclaw_last_used_at, visual_signal.
 *
 * Call AFTER buildSkillTree() returns the report and BEFORE assembling
 * the final MorningResult.
 */
export function enrichSkillTreeWithOpenClawStats(
  skill_tree: SkillTreeReport,
  intent_stats: OpenClawIntentStatsFile,
): void {
  for (const node of skill_tree.nodes) {
    const target_lower = node.target.toLowerCase();

    // Find any intent_stats entry whose intent_key starts with this target
    const matches = Object.values(intent_stats.stats).filter(
      (s) => s.intent_key.startsWith(target_lower + '::'),
    );

    if (matches.length === 0) {
      node.openclaw_success_rate = null;
      node.openclaw_failure_count = null;
      node.openclaw_last_used_at = null;
    } else {
      // Aggregate across all intents for this target
      const total_attempts = matches.reduce((s, m) => s + m.total_attempts, 0);
      const total_successes = matches.reduce((s, m) => s + m.success_count, 0);
      node.openclaw_success_rate =
        total_attempts > 0 ? total_successes / total_attempts : null;
      node.openclaw_failure_count = total_attempts - total_successes;

      // Most recent SUCCESS
      const last_success = matches
        .filter((m) => m.last_outcome === 'SUCCESS')
        .sort((a, b) => b.last_recorded_at.localeCompare(a.last_recorded_at))[0];
      node.openclaw_last_used_at = last_success?.last_recorded_at ?? null;
    }

    node.visual_signal = computeVisualSignal(node);
  }
}

/**
 * Compute the visual signal for one skill tree node.
 * Priority order: gray (expired) > red (poor/pruned) > green (healthy) > yellow.
 */
export function computeVisualSignal(
  node: Pick<
    SkillTreeNode,
    | 'ttl_days_remaining'
    | 'selection_pressure'
    | 'openclaw_success_rate'
  >,
): 'green' | 'red' | 'gray' | 'yellow' {
  if (node.ttl_days_remaining === null) return 'gray';
  if (
    node.selection_pressure === 'PRUNE' ||
    (node.openclaw_success_rate !== null &&
      node.openclaw_success_rate !== undefined &&
      node.openclaw_success_rate < 0.30)
  ) {
    return 'red';
  }
  if (
    node.selection_pressure === 'PERSIST' ||
    (node.openclaw_success_rate !== null &&
      node.openclaw_success_rate !== undefined &&
      node.openclaw_success_rate >= 0.70)
  ) {
    return 'green';
  }
  return 'yellow';
}

// ---------------------------------------------------------------------------
// CollapseRisk fallback (used when skill_tree is absent)
// ---------------------------------------------------------------------------

/**
 * Derive CollapseRisk from a raw health/stability score.
 *   CRITICAL : health < 0.20
 *   WARNING  : health < 0.40
 *   SAFE     : health >= 0.40
 */
export function computeCollapseRisk(health: number): CollapseRisk {
  if (health < 0.20) return 'CRITICAL';
  if (health < 0.40) return 'WARNING';
  return 'SAFE';
}

// ===========================================================================
// ⑥ SCORING ENGINE (openclaw_scoring/0.1)
// ===========================================================================
//
//   score = effective_success × success_weight
//         + (1 − risk_level)  × risk_weight
//         + hint_quality      × hint_weight
//         + policy_bonus
//
//   best  = argmax(score)   ← competing_actions evaluation
//
// Replaces the old rule-based decision chain:
//   OLD: if (struggling) return reuseHint()
//   NEW: build N candidates → score each → return argmax
// ===========================================================================

/** Small bonus multiplier for policy signal — keeps influence bounded. */
const POLICY_WEIGHT = 0.05;

/**
 * Hard clamp for policy_bonus — prevents over-exploitation as data accumulates.
 * Even with 1000 entries, policy_bonus stays in [-0.20, +0.20].
 */
const POLICY_BONUS_CLAMP = 0.20;

/** Risk level mapped from BlastRadiusLabel. */
const BLAST_RISK: Record<BlastRadiusLabel, number> = {
  SELF:   0.0,
  TENANT: 0.5,
  GLOBAL: 1.0,
};

// ---------------------------------------------------------------------------
// Environment state
// ---------------------------------------------------------------------------

/**
 * Derive EnvironmentState from a fully-assembled MorningResult.
 *
 *   HOSTILE  — collapse_risk CRITICAL or security_posture RED
 *   DEGRADED — collapse_risk WARNING  or invariant failures present
 *   STABLE   — health ≥ 0.80 and no invariant failures  (exploit mode)
 *   NORMAL   — everything else
 */
export function deriveEnvironmentState(result: MorningResult): EnvironmentState {
  const health =
    result.skill_tree?.civ_summary?.civilization_health_score ??
    result.metrics.stability_index.score;
  const collapse_risk =
    result.skill_tree?.civ_summary?.collapse_risk ?? computeCollapseRisk(health);
  const posture         = result.guardian.security_posture;
  const invariant_count = result.guardian.invariant_failure_count;

  if (collapse_risk === 'CRITICAL' || posture === 'RED') return 'HOSTILE';
  if (collapse_risk === 'WARNING'  || invariant_count > 0) return 'DEGRADED';
  if (health >= 0.80) return 'STABLE';
  return 'NORMAL';
}

// ---------------------------------------------------------------------------
// Adaptive scoring weights
// ---------------------------------------------------------------------------

/**
 * Build ScoringWeights tuned for the current environment.
 *
 *   HOSTILE  — risk_weight 0.50; recency τ = 12 h
 *              Goal: prefer low-risk actions; recent signal matters most.
 *   DEGRADED — risk_weight 0.40; τ = 24 h
 *   NORMAL   — default 0.50 / 0.30 / 0.20; τ = 24 h
 *   STABLE   — success_weight 0.60; τ = 48 h
 *              Goal: exploit known-good patterns; tolerate older data.
 */
export function buildScoringWeights(env: EnvironmentState): ScoringWeights {
  switch (env) {
    case 'HOSTILE':  return { success_weight: 0.30, risk_weight: 0.50, hint_weight: 0.20, recency_tau:  43200 };
    case 'DEGRADED': return { success_weight: 0.40, risk_weight: 0.40, hint_weight: 0.20, recency_tau:  86400 };
    case 'STABLE':   return { success_weight: 0.60, risk_weight: 0.20, hint_weight: 0.20, recency_tau: 172800 };
    default:         return { success_weight: 0.50, risk_weight: 0.30, hint_weight: 0.20, recency_tau:  86400 };
  }
}

// ---------------------------------------------------------------------------
// Recency decay
// ---------------------------------------------------------------------------

/**
 * Apply exponential recency decay to a raw success_rate.
 *
 *   recent_weight          = exp(−age_seconds / τ)
 *   effective_success_rate = raw_success_rate × recent_weight
 *
 * With τ = 86400 s (1 day): 1-day-old result → weight ≈ 37%.
 * Prevents over-relying on stale historical patterns.
 */
export function applyRecencyDecay(
  success_rate: number,
  age_seconds: number,
  tau: number,
): { effective_success_rate: number; recent_weight: number } {
  const recent_weight = Math.exp(-age_seconds / tau);
  return {
    recent_weight,
    effective_success_rate: success_rate * recent_weight,
  };
}

// ---------------------------------------------------------------------------
// Candidate scoring
// ---------------------------------------------------------------------------

/**
 * Score one ActionCandidate using the provided weights.
 *
 *   score = effective_success × w.success_weight   ← temporal quality
 *         + (1 − risk_level)  × w.risk_weight      ← conservatism
 *         + hint_quality      × w.hint_weight       ← reuse leverage
 *         + policy_bonus                            ← accumulated reward
 *
 * Returns a ScoredCandidate with a full breakdown for logging.
 */
export function scoreCandidate(
  c: ActionCandidate,
  weights: ScoringWeights,
  policy?: ActionPolicy,
  env?: EnvironmentState,
): ScoredCandidate {
  const { effective_success_rate, recent_weight } = applyRecencyDecay(
    c.raw_success_rate,
    c.recency_seconds,
    weights.recency_tau,
  );

  const success_component = effective_success_rate * weights.success_weight;
  const risk_component    = (1 - c.risk_level)     * weights.risk_weight;
  const hint_component    = c.hint_quality          * weights.hint_weight;

  // Policy bonus: env-scoped lookup, clamped to [-POLICY_BONUS_CLAMP, +POLICY_BONUS_CLAMP]
  let policy_bonus = 0;
  if (policy) {
    const policy_key = env ? `${env}::${c.action_type}` : c.action_type;
    const entry = policy.entries[policy_key];
    if (entry && entry.update_count > 0) {
      const raw = (entry.cumulative_reward / entry.update_count) * POLICY_WEIGHT;
      policy_bonus = Math.max(-POLICY_BONUS_CLAMP, Math.min(POLICY_BONUS_CLAMP, raw));
    }
  }

  return {
    ...c,
    score: success_component + risk_component + hint_component + policy_bonus,
    effective_success_rate,
    recent_weight,
    breakdown: { success_component, risk_component, hint_component, policy_bonus },
  };
}

// ---------------------------------------------------------------------------
// Competing-actions argmax
// ---------------------------------------------------------------------------

/**
 * Score all candidates and return the one with the highest score (argmax).
 *
 * @param candidates  Competing ActionCandidates to evaluate.
 * @param env         Environment state; defaults to 'NORMAL'.
 * @param policy      Optional accumulated reward adjustment.
 * @returns           { best, all_scored } sorted descending, or null for empty input.
 */
export function selectBestCandidate(
  candidates: ActionCandidate[],
  env: EnvironmentState = 'NORMAL',
  policy?: ActionPolicy,
): { best: ScoredCandidate; all_scored: ScoredCandidate[]; trace: DecisionTrace } | null {
  if (candidates.length === 0) return null;
  const weights = buildScoringWeights(env);
  const all_scored = candidates
    .map((c) => scoreCandidate(c, weights, policy, env))
    .sort((a, b) => b.score - a.score);
  const trace: DecisionTrace = {
    chosen:   { action_type: all_scored[0].action_type, score: all_scored[0].score },
    rejected: all_scored.slice(1).map((s) => ({ action_type: s.action_type, score: s.score })),
  };
  return { best: all_scored[0], all_scored, trace };
}

// ---------------------------------------------------------------------------
// Policy update (online reward learning)
// ---------------------------------------------------------------------------

/**
 * Incorporate an outcome into the policy.
 *
 *   reward = +1 on SUCCESS,  −1 on failure
 *
 * Returns a NEW ActionPolicy (does not mutate input).
 * Callers are responsible for persisting to phase14/data/openclaw_policy.json.
 *
 * @param policy      Existing policy, or undefined to initialise fresh.
 * @param action_type The action_type that was executed.
 * @param reward      +1 if outcome = SUCCESS,  −1 otherwise.
 */
export function updatePolicy(
  policy: ActionPolicy | undefined,
  action_type: string,
  reward: 1 | -1,
  env?: EnvironmentState,
): ActionPolicy {
  const now  = new Date().toISOString();
  const base = policy ?? {
    schema_version: 'openclaw_policy/0.1' as const,
    last_updated_at: now,
    entries: {},
  };
  // Env-scoped key: "HOSTILE::reuse_hint" — isolates reward signals per environment
  const key  = env ? `${env}::${action_type}` : action_type;
  const prev = base.entries[key] ?? { cumulative_reward: 0, update_count: 0 };
  return {
    ...base,
    last_updated_at: now,
    entries: {
      ...base.entries,
      [key]: {
        cumulative_reward: prev.cumulative_reward + reward,
        update_count:      prev.update_count + 1,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Full decision loop: competing candidates → argmax
// ---------------------------------------------------------------------------

/**
 * Evaluate competing action candidates for a given intent and return the
 * scored best choice.  Replaces the old rule-based if-else chain.
 *
 * Candidates built:
 *   1. reuse_hint    — SELF risk (0.0), full hint leverage, intent success_rate
 *   2. shrink_scope  — autoShrinkBlastRadius result, partial hint leverage (50%)
 *   3. new_candidate — current blast radius (higher risk), no hint anchoring
 *                      Excluded when isIntentLocked() returns true
 *
 * Environment state derived from result when provided; defaults to NORMAL.
 *
 * @param intent_key         Stable intent identifier.
 * @param intent_stats       Full intent stats file.
 * @param best_hint_quality  effective_score of best hint (0.0 = no hint).
 * @param current_blast      Caller's current blast radius.
 * @param result             Optional MorningResult for env-state derivation.
 * @param policy             Optional accumulated reward signal.
 */
export function decideAction(
  intent_key: string,
  intent_stats: OpenClawIntentStatsFile,
  best_hint_quality: number,
  current_blast: BlastRadiusLabel,
  result?: MorningResult,
  policy?: ActionPolicy,
): { best: ScoredCandidate; all_scored: ScoredCandidate[]; trace: DecisionTrace } | null {
  const stat             = intent_stats.stats[intent_key];
  const raw_success_rate = stat?.success_rate ?? 0.5;

  // Recency: seconds since last_recorded_at (0 for brand-new intents)
  const age_seconds = stat?.last_recorded_at
    ? Math.max(0, (Date.now() - new Date(stat.last_recorded_at).getTime()) / 1000)
    : 0;

  const locked       = isIntentLocked(intent_key, intent_stats);
  const shrunk_blast = autoShrinkBlastRadius(current_blast);

  const candidates: ActionCandidate[] = [
    {
      action_type:     'reuse_hint',
      intent_key,
      raw_success_rate,
      hint_quality:    best_hint_quality,
      risk_level:      BLAST_RISK['SELF'],
      recency_seconds: age_seconds,
    },
    {
      action_type:     'shrink_scope',
      intent_key,
      raw_success_rate,
      hint_quality:    best_hint_quality * 0.5, // partial hint leverage in shrunk context
      risk_level:      BLAST_RISK[shrunk_blast],
      recency_seconds: age_seconds,
    },
  ];

  // new_candidate excluded when intent is locked — no exploration premium
  if (!locked) {
    candidates.push({
      action_type:     'new_candidate',
      intent_key,
      raw_success_rate,
      hint_quality:    0,  // exploring — no hint anchoring
      risk_level:      BLAST_RISK[current_blast],
      recency_seconds: age_seconds,
    });
  }

  const env: EnvironmentState = result ? deriveEnvironmentState(result) : 'NORMAL';
  return selectBestCandidate(candidates, env, policy);
}
