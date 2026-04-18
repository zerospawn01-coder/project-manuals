/**
 * contract/openclaw_action_log.d.ts
 *
 * OpenClaw Action Log — Per-action outcome records for self-improvement.
 * Schema version: openclaw_action_log/0.1
 *
 * Every Gateway request attempted by the Daily Ops Operator produces
 * one OpenClawActionLogEntry, regardless of outcome.  Successes and
 * failures are both written — failures become assets (失敗も資産化).
 *
 * Persisted to:
 *   phase14/data/openclaw_action_log.jsonl  — append-only, one entry per line
 *   phase14/data/openclaw_intent_stats.json — mutable sidecar, per intent_key
 *   phase14/data/openclaw_suggest_stats.json — mutable sidecar, per suggest_path
 *
 * Relationship to AdaptationMemory:
 *   - When outcome === 'SUCCESS' and action === 'enqueue_candidate',
 *     the promoted skill's AdaptationMemoryEntry.patch_source === 'openclaw'
 *     and its skill_id links back to this log via skill_id === entry_id.
 *   - REJECT entries represent the learning signal: what patterns to avoid
 *     and which suggest_instead paths improved future attempts.
 *
 * GOVERNANCE BOUNDARY:
 *   This log is an ANALYTICS + SELF-LEARNING LAYER.
 *   It MUST NOT modify governance weights, tier thresholds, or invariant
 *   definitions.  It is a record for human oversight and for OpenClaw to
 *   calibrate its own proposal strategy — nothing more.
 *
 * Schema freeze: openclaw_action_log/0.1
 * To change: bump minor version, add migration note here.
 *
 * Imports:
 *   - OpenClawAction, GatewayRejectCode from ./openclaw_gateway
 *   - BlastRadiusLabel from ./adaptation_memory
 */

import type { OpenClawAction, GatewayRejectCode } from './openclaw_gateway';
import type { BlastRadiusLabel } from './adaptation_memory';

// ---------------------------------------------------------------------------
// Internal reason taxonomy — mirrors Behavioral Contract in system prompt
// ---------------------------------------------------------------------------

/**
 * OpenClaw's internal classification of why an attempt did not succeed.
 *
 * Maps from GatewayRejectCode (external) or pre-submission self-check (internal):
 *
 *   invariant_violation — INVARIANT_VIOLATION | ACTION_RISK_MISMATCH |
 *                         FORBIDDEN_TARGET | UNKNOWN_ACTION (Gateway hard stops)
 *   high_risk_global    — HIGH_RISK_BLOCKED (blast_radius too wide or risk='HIGH')
 *   duplicate_strategy  — pre-submission: dedup_key already in adaptation_memory
 *   low_hint_score      — pre-submission: top hint effective_score < 0.10
 *   cap_exceeded        — outcome === 'STOPPED_BY_CAP' (no gateway request issued)
 */
export type OpenClawInternalRejectReason =
  | 'invariant_violation'
  | 'high_risk_global'
  | 'duplicate_strategy'
  | 'low_hint_score'
  | 'cap_exceeded';

// ---------------------------------------------------------------------------
// suggest_instead path taxonomy
// ---------------------------------------------------------------------------

/**
 * Which suggest_instead recovery path OpenClaw took after a REJECT.
 *
 *   reduce_blast_radius — lowered estimated_blast_radius by one tier
 *   reuse_hint          — re-anchored rationale to a higher-scoring hint
 *   find_new_target     — switched primary target file / function
 *   none                — invariant_violation; no recovery attempted
 */
export type SuggestPath =
  | 'reduce_blast_radius'
  | 'reuse_hint'
  | 'find_new_target'
  | 'none';

// ---------------------------------------------------------------------------
// Outcome taxonomy
// ---------------------------------------------------------------------------

export type OpenClawOutcome =
  | 'SUCCESS'         // Gateway returned PASS (or pre-submission check passed; request accepted)
  | 'REJECT'          // Gateway returned REJECT (soft; retryable with correction)
  | 'HARD_REJECT'     // Gateway returned HARD_REJECT (permanent; invariant hit)
  | 'PRE_REJECT'      // Stopped before Gateway submission by self-check
  | 'STOPPED_BY_CAP'; // Stopped by same-intent retry cap (attempt >= 4)

// ---------------------------------------------------------------------------
// OpenClawActionLogEntry — the per-attempt record
// ---------------------------------------------------------------------------

/**
 * One entry written per Gateway request attempt (or pre-submission stop).
 * Both successes and failures are recorded.
 *
 * Intent tracking:
 *   intent_key = "<target>::<rough_patch_intent>"
 *   Computed once when the user's natural language is first normalized and
 *   remains stable across retries of the same concept.
 *
 * Linking to AdaptationMemory:
 *   On SUCCESS for enqueue_candidate, the promoted skill's entry_id
 *   matches this entry's entry_id (written by the OS after Phase C).
 *   linked_skill_id is null until the OS writes back the promotion event.
 */
export interface OpenClawActionLogEntry {
  schema_version: 'openclaw_action_log/0.1';

  /** UUID v4 for this log entry. On SUCCESS, doubles as the candidate's linking id. */
  entry_id: string;

  /** ISO-8601 UTC when this entry was written. */
  recorded_at: string;

  // -- Action identity ------------------------------------------------------

  /** Mirrors OpenClawRequest.action. */
  action: OpenClawAction;

  /** Primary target: file path, function name, or patch_id. */
  target: string;

  /**
   * Stable key for this logical intent across retries.
   * Format: "<target>::<normalised-intent-phrase>"
   * Example: "src/auth/service.ts::openclaw fix token expiry in auth service"
   */
  intent_key: string;

  /** Attempt number within this intent_key (1-indexed). null for non-enqueue_candidate actions. */
  attempt_number: number | null;

  // -- Blast radius & risk --------------------------------------------------

  /**
   * For enqueue_candidate: the declared estimated_blast_radius.
   * null for READ ops and approve/reject_human_review.
   */
  estimated_blast_radius: BlastRadiusLabel | null;

  // -- Outcome --------------------------------------------------------------

  outcome: OpenClawOutcome;

  /**
   * Populated on any non-SUCCESS outcome.
   * null on SUCCESS.
   */
  reject_reason: OpenClawInternalRejectReason | null;

  /**
   * Gateway-level reject_code from GatewayDecision.
   * null on SUCCESS, PRE_REJECT, or STOPPED_BY_CAP.
   */
  gateway_reject_code: GatewayRejectCode | null;

  /**
   * Human-readable gateway reason string (GatewayDecision.reason).
   * null on SUCCESS, PRE_REJECT, or STOPPED_BY_CAP.
   */
  gateway_reason: string | null;

  // -- suggest_instead tracking ---------------------------------------------

  /**
   * Which suggest_instead recovery path OpenClaw chose after this REJECT.
   * null on SUCCESS or HARD_REJECT (no recovery).
   * 'none' on invariant_violation (no recovery attempted per rules).
   */
  suggest_path: SuggestPath | null;

  /**
   * Populated on the NEXT attempt within the same intent_key.
   * true   = following this suggest_path led to eventual SUCCESS.
   * false  = the subsequent attempt also failed (or no subsequent attempt yet).
   * null   = not yet resolved (this is the most recent attempt, or SUCCESS entry).
   *
   * Written by the log writer when it sees a SUCCESS entry for the same intent_key.
   */
  suggest_led_to_success: boolean | null;

  // -- Link to AdaptationMemory on success ----------------------------------

  /**
   * On SUCCESS for enqueue_candidate: the skill_id assigned in Phase C.
   * Written back by the OS after Phase C promotion (not at request time).
   * null if not yet promoted or action !== 'enqueue_candidate'.
   */
  linked_skill_id: string | null;
}

// ---------------------------------------------------------------------------
// Intent-level stats sidecar (openclaw_intent_stats.json)
// ---------------------------------------------------------------------------

/**
 * Aggregated per-intent_key stats.
 * Keyed by intent_key in the mutable sidecar JSON.
 * Recomputed after every log append.
 *
 * Surfaced in morning_brief → [OpenClaw 学習状況] section.
 */
export interface OpenClawIntentStats {
  /** Stable intent key. */
  intent_key: string;

  /** Total attempts logged for this intent (all outcomes). */
  total_attempts: number;

  /** Attempts with outcome === 'SUCCESS'. */
  success_count: number;

  /**
   * success_count / total_attempts.
   * 0.0 when no successful attempts yet.
   */
  success_rate: number;

  /** Outcome of the most recent logged attempt. */
  last_outcome: OpenClawOutcome;

  /** ISO-8601 UTC of the most recent logged entry for this intent. */
  last_recorded_at: string;

  /**
   * The dominant fail_pattern across non-SUCCESS attempts.
   * null when there are no failures (success_count === total_attempts).
   */
  dominant_fail_pattern: OpenClawInternalRejectReason | null;
}

/** Root type of openclaw_intent_stats.json. */
export interface OpenClawIntentStatsFile {
  schema_version: 'openclaw_intent_stats/0.1';
  last_updated_at: string;
  stats: { [intent_key: string]: OpenClawIntentStats };
}

// ---------------------------------------------------------------------------
// suggest_path stats sidecar (openclaw_suggest_stats.json)
// ---------------------------------------------------------------------------

/**
 * Aggregated success rate per suggest_instead recovery path.
 * Answers: "which recovery strategy works best?"
 *
 * success_rate = times_led_to_success / times_suggested
 * (only entries where suggest_led_to_success is not null are counted.)
 */
export interface OpenClawSuggestPathStats {
  suggest_path: SuggestPath;

  /** Times this path was selected as the primary recovery suggestion. */
  times_suggested: number;

  /** Times following this path led to a SUCCESS on the next attempt. */
  times_led_to_success: number;

  /**
   * times_led_to_success / times_suggested (resolved attempts only).
   * 0.0 when no resolved attempts yet.
   */
  success_rate: number;
}

/** Root type of openclaw_suggest_stats.json. */
export interface OpenClawSuggestStatsFile {
  schema_version: 'openclaw_suggest_stats/0.1';
  last_updated_at: string;
  stats: { [path in SuggestPath]?: OpenClawSuggestPathStats };
}

// ---------------------------------------------------------------------------
// Failure pattern roll-up (morning_brief display layer)
// ---------------------------------------------------------------------------

/**
 * Roll-up of how frequently each fail_pattern has appeared across the log.
 * Used for the [OpenClaw 学習状況] section in morning_brief.
 * Computed at read time — not persisted separately.
 */
export interface OpenClawFailurePatternSummary {
  fail_pattern: OpenClawInternalRejectReason;

  /** Total count across all attempts. */
  count: number;

  /** ISO-8601 UTC of the most recent occurrence. */
  last_seen_at: string;

  /**
   * Distinct intent_keys where this pattern was observed.
   * Capped at 5 for display purposes.
   */
  intent_keys: string[];
}

/**
 * Aggregated self-learning summary shown in morning_brief.
 * Computed from the JSONL + sidecar files at display time.
 */
export interface OpenClawLearningSummary {
  /** Total log entries across all time. */
  total_attempts: number;

  /** Total SUCCESS outcomes. */
  total_successes: number;

  /** Overall success_rate = total_successes / total_attempts. */
  overall_success_rate: number;

  /**
   * Failure pattern roll-up, ordered by count descending.
   * Top-3 patterns highlight the main failure modes for the operator.
   */
  top_fail_patterns: OpenClawFailurePatternSummary[];

  /**
   * suggest_path stats for the best and worst recovery paths.
   * Ordered by success_rate descending.
   */
  suggest_path_ranking: OpenClawSuggestPathStats[];

  /**
   * Intent keys with the lowest success_rate (≥ 2 attempts, success_rate < 0.5).
   * These are "stuck" intents that may need operator-guided reformulation.
   * Max 3 entries for display.
   */
  struggling_intents: OpenClawIntentStats[];

  /** ISO-8601 UTC when this summary was computed. */
  computed_at: string;
}
