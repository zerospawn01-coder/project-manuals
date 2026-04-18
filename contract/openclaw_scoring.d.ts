/**
 * contract/openclaw_scoring.d.ts
 *
 * OpenClaw Scoring Engine — score-based competing-actions decision types.
 * Schema: openclaw_scoring/0.1
 *
 * Replaces rule-based "if A → do B" logic with:
 *
 *   score = effective_success × success_weight
 *         + (1 − risk_level)  × risk_weight
 *         + hint_quality      × hint_weight
 *         + policy_bonus
 *
 *   best = argmax(score)   ← competing_actions evaluation
 *
 * Additional features:
 *   Recency decay    effective_success = raw_success_rate × exp(−age / τ)
 *   Env-adaptive     HOSTILE → risk_weight ↑ ;  STABLE → success_weight ↑
 *   Policy learning  policy[action] += reward  (online update after each cycle)
 *
 * Relationship to existing engine:
 *   - decideAction() wraps isIntentLocked() + autoShrinkBlastRadius() +
 *     selectBestCandidate() into one call.
 *   - updatePolicy() persists reward signal to phase14/data/openclaw_policy.json.
 *   - This file is ANALYTICS + SELF-LEARNING only; see GOVERNANCE BOUNDARY
 *     in openclaw_decision_engine.ts.
 *
 * Schema freeze: openclaw_scoring/0.1
 */

// ---------------------------------------------------------------------------
// Environment state
// ---------------------------------------------------------------------------

/**
 * Derived from MorningResult at decision time.
 *
 *   HOSTILE  — collapse_risk === 'CRITICAL' or security_posture === 'RED'
 *   DEGRADED — collapse_risk === 'WARNING'  or invariant_failure_count > 0
 *   NORMAL   — default mixed state
 *   STABLE   — civilization_health >= 0.80 and no recent invariant failures
 */
export type EnvironmentState = 'HOSTILE' | 'DEGRADED' | 'NORMAL' | 'STABLE';

// ---------------------------------------------------------------------------
// Action candidates
// ---------------------------------------------------------------------------

/**
 * A single candidate action for competing_actions evaluation.
 *
 *   action_type       which kind of action this represents
 *   intent_key        the intent being evaluated
 *   raw_success_rate  historical success rate (0.0–1.0); default 0.5 for unknowns
 *   hint_quality      effective_score of best matching hint (0.0–1.0); 0 = no hint
 *   risk_level        0.0 = SELF,  0.5 = TENANT,  1.0 = GLOBAL
 *   recency_seconds   seconds since last recorded attempt; 0 for brand-new intents
 */
export interface ActionCandidate {
  action_type: 'reuse_hint' | 'shrink_scope' | 'new_candidate';
  intent_key: string;
  raw_success_rate: number;
  hint_quality: number;
  risk_level: number;
  recency_seconds: number;
}

/**
 * An ActionCandidate after the scoring formula has been applied.
 * `score` is the primary sort key (higher = better).
 */
export interface ScoredCandidate extends ActionCandidate {
  /** Final weighted composite score. */
  score: number;
  /** raw_success_rate × recent_weight */
  effective_success_rate: number;
  /** exp(−recency_seconds / τ) */
  recent_weight: number;
  /** Per-component score breakdown for logging and explanation. */
  breakdown: {
    success_component: number;   // effective_success_rate × success_weight
    risk_component:    number;   // (1 − risk_level) × risk_weight
    hint_component:    number;   // hint_quality × hint_weight
    policy_bonus:      number;   // (avg_reward) × POLICY_WEIGHT
  };
}

// ---------------------------------------------------------------------------
// Scoring weights
// ---------------------------------------------------------------------------

/**
 * Tunable parameters for the scoring formula.
 *
 * Default (NORMAL env):
 *   success_weight = 0.50
 *   risk_weight    = 0.30
 *   hint_weight    = 0.20
 *   recency_tau    = 86400  (1 day in seconds)
 *
 * Weight convention: success_weight + risk_weight + hint_weight = 1.0.
 * Enforced by buildScoringWeights(), not validated at runtime.
 */
export interface ScoringWeights {
  success_weight: number;
  risk_weight:    number;
  hint_weight:    number;
  /** Half-life for recency decay in seconds. */
  recency_tau:    number;
}

// ---------------------------------------------------------------------------
// Policy (online reward learning)
// ---------------------------------------------------------------------------

/**
 * Per-action-type accumulated reward entry.
 *
 *   reward = +1 on SUCCESS,  −1 on failure
 *
 * policy_bonus at scoring time:
 *   bonus = (cumulative_reward / update_count) × POLICY_WEIGHT
 *   where POLICY_WEIGHT = 0.05 (keeps policy influence bounded).
 */
export interface ActionPolicyEntry {
  cumulative_reward: number;
  update_count:      number;
}

/**
 * Root type for the persisted policy file.
 * Persisted to: phase14/data/openclaw_policy.json
 * Written by updatePolicy(); read by scoreCandidate() via decideAction().
 */
export interface ActionPolicy {
  schema_version: 'openclaw_policy/0.1';
  last_updated_at: string;
  /**
   * Key format: `${EnvironmentState}::${action_type}` when env-scoped (recommended),
   * or plain `action_type` for legacy data.
   *
   * Example: `"HOSTILE::reuse_hint"`
   *
   * Using env-scoped keys lets the policy adapt to each environment state
   * independently so a HOSTILE-era reward cannot pollute STABLE-env decisions.
   */
  entries: { [env_action_key: string]: ActionPolicyEntry };
}

// ---------------------------------------------------------------------------
// Decision trace
// ---------------------------------------------------------------------------

/** One entry in a DecisionTrace — single candidate with its final score. */
export interface DecisionTraceEntry {
  action_type: string;
  score: number;
}

/**
 * Full decision trace for one `decideAction()` call.
 *
 * Surfaced in `MorningBrief.decision_trace` so operators can inspect
 * why OpenClaw chose a particular action — removes the black-box.
 *
 * Example:
 *   chosen:   { action_type: "reuse_hint",    score: 0.62 }
 *   rejected: [ { action_type: "shrink_scope", score: 0.48 },
 *               { action_type: "new_candidate", score: 0.31 } ]
 */
export interface DecisionTrace {
  /** The highest-scored candidate that was selected. */
  chosen: DecisionTraceEntry;
  /** All other candidates sorted by score descending. */
  rejected: DecisionTraceEntry[];
}
