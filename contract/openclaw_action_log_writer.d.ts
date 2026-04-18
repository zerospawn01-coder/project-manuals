/**
 * contract/openclaw_action_log_writer.d.ts
 *
 * OpenClaw Action Log Writer — Contract for the logging pipeline.
 * Schema version: openclaw_action_log_writer/0.1
 *
 * Defines the writer and sidecar-update interfaces that connect
 * OpenClawGateway.process() to the three persisted stores:
 *
 *   openclaw_action_log.jsonl     — append-only per-attempt audit log
 *   openclaw_intent_stats.json    — mutable per-intent_key success counters
 *   openclaw_suggest_stats.json   — mutable per-suggest_path success counters
 *
 * Write sequence (called by OpenClawGateway after every process() call):
 *
 *   1. resolve_intent_key(request, pre_reject_reason?)
 *      ↓
 *   2. build_entry(request, decision, intent_ctx)  → OpenClawActionLogEntry
 *      ↓
 *   3. append_to_jsonl(entry)                      — atomic append
 *      ↓
 *   4. update_intent_stats(entry)                  — upsert in-memory JSON
 *      ↓
 *   5. update_suggest_stats(entry)                 — upsert in-memory JSON (if suggest_path set)
 *      ↓
 *   6. back_fill_suggest_led_to_success(entry)     — resolve prior REJECT entries
 *                                                     for same intent_key when SUCCESS arrives
 *      ↓
 *   7. flush_sidecars()                            — atomic write intent_stats + suggest_stats JSON
 *
 * Pre-submission triggers (no Gateway request issued):
 *   The Daily Ops Operator also calls append_pre_reject() before attempting
 *   a Gateway submission when a soft stop is detected:
 *     - dedup_key already in adaptation_memory  → outcome: 'PRE_REJECT', reject_reason: 'duplicate_strategy'
 *     - top hint effective_score < 0.10         → outcome: 'PRE_REJECT', reject_reason: 'low_hint_score'
 *     - attempt_number ≥ 4                      → outcome: 'STOPPED_BY_CAP', reject_reason: 'cap_exceeded'
 *
 * GOVERNANCE BOUNDARY:
 *   This writer is ANALYTICS LAYER ONLY.
 *   It MUST NOT modify governance weights, tier thresholds, invariant
 *   definitions, FailureLedger, or any OS pipeline file.
 *   Its sole purpose is logging OpenClaw's own operational history.
 *
 * Schema freeze: openclaw_action_log_writer/0.1
 * To change: bump minor version, add migration note here.
 *
 * Imports:
 *   - OpenClawRequest, GatewayDecision              from ./openclaw_gateway
 *   - OpenClawActionLogEntry, OpenClawOutcome,
 *     OpenClawInternalRejectReason, SuggestPath,
 *     OpenClawIntentStatsFile, OpenClawSuggestStatsFile from ./openclaw_action_log
 */

import type { OpenClawRequest, GatewayDecision } from './openclaw_gateway';
import type {
  OpenClawActionLogEntry,
  OpenClawOutcome,
  OpenClawInternalRejectReason,
  SuggestPath,
  OpenClawIntentStatsFile,
  OpenClawSuggestStatsFile,
} from './openclaw_action_log';

// ---------------------------------------------------------------------------
// Writer configuration
// ---------------------------------------------------------------------------

/**
 * Runtime paths injected into OpenClawActionLogWriter.
 * All paths are absolute; directories are created automatically.
 */
export interface OpenClawActionLogWriterConfig {
  /**
   * Absolute path to openclaw_action_log.jsonl.
   * Append-only. One JSON line per entry.
   */
  action_log_path: string;

  /**
   * Absolute path to openclaw_intent_stats.json.
   * Mutable sidecar. Rewritten on every flush.
   * Contains all-time per-intent_key success rate data.
   */
  intent_stats_path: string;

  /**
   * Absolute path to openclaw_suggest_stats.json.
   * Mutable sidecar. Rewritten on every flush.
   * Contains all-time per-suggest_path success rate data.
   */
  suggest_stats_path: string;
}

// ---------------------------------------------------------------------------
// Intent resolution context
// ---------------------------------------------------------------------------

/**
 * Resolved intent context for a single Gateway request.
 * Computed once before entry construction to ensure consistency.
 */
export interface ResolvedIntentContext {
  /**
   * Stable intent key for this logical attempt.
   * Format: "<target>::<normalised-intent-phrase>"
   * Normalisation: lowercase, collapse whitespace, strip leading articles.
   * Example: "src/auth/service.ts::fix token expiry in auth service"
   */
  intent_key: string;

  /**
   * Attempt number within this intent_key, 1-indexed.
   * null for actions that are not enqueue_candidate.
   * Derived from current OpenClawIntentStats.total_attempts + 1
   * before the new entry is written.
   */
  attempt_number: number | null;
}

// ---------------------------------------------------------------------------
// Pre-submission stop record
// ---------------------------------------------------------------------------

/**
 * Used by the Daily Ops Operator to record a soft stop BEFORE a Gateway
 * request is issued.  No GatewayDecision exists because the request was
 * never submitted.
 */
export interface PreSubmitStopEvent {
  /** Matches OpenClawRequest.request_id (generated by the operator). */
  request_id: string;

  /** ISO-8601 UTC when the operator detected the stop condition. */
  detected_at: string;

  /** Action that was about to be submitted. */
  action: OpenClawRequest['action'];

  /** Primary target that was about to be targeted. */
  target: string;

  /**
   * Why the submission was stopped.
   *   duplicate_strategy — dedup_key already in adaptation_memory
   *   low_hint_score     — top hint effective_score < 0.10
   *   cap_exceeded       — attempt_number ≥ 4 for this intent_key
   */
  stop_reason: Extract<
    OpenClawInternalRejectReason,
    'duplicate_strategy' | 'low_hint_score' | 'cap_exceeded'
  >;

  /**
   * The suggest_path chosen by the operator after this stop.
   * 'none' when stop_reason === 'cap_exceeded' (no further attempt is made).
   */
  suggest_path: SuggestPath;
}

// ---------------------------------------------------------------------------
// Writer interface
// ---------------------------------------------------------------------------

/**
 * The main writer interface.
 *
 * Implementations:
 *   OpenClawActionLogWriterImpl (TypeScript, phase14/loggers/)
 *
 * Lifecycle:
 *   Instantiated once per Gateway instance.
 *   flush_sidecars() is called after every write to keep stats current.
 */
export interface OpenClawActionLogWriter {
  /**
   * Build and append one log entry from a completed Gateway evaluation.
   *
   * Called by OpenClawGateway.process() after verdict is determined.
   *
   * Steps:
   *   1. Compute intent_key + attempt_number (via resolve_intent_key).
   *   2. Map GatewayDecision.reject_code → OpenClawInternalRejectReason.
   *   3. Construct OpenClawActionLogEntry.
   *   4. append_to_jsonl(entry).
   *   5. update_intent_stats(entry).
   *   6. back_fill_suggest_led_to_success(entry) if outcome === 'SUCCESS'.
   *   7. flush_sidecars().
   *
   * @param request  The original OpenClawRequest submitted to the gateway.
   * @param decision The GatewayDecision returned by process().
   * @param suggest_path  The suggest_path the operator chose for this attempt.
   *                      Null if outcome is SUCCESS or HARD_REJECT.
   * @returns The written OpenClawActionLogEntry.
   */
  append_gateway_result(
    request: OpenClawRequest,
    decision: GatewayDecision,
    suggest_path: SuggestPath | null,
  ): OpenClawActionLogEntry;

  /**
   * Build and append a pre-submission stop entry (no Gateway verdict exists).
   *
   * Called by the Daily Ops Operator when a soft stop is detected before
   * the request is submitted to the Gateway.
   *
   * @param event  The stop event describing why the submission was aborted.
   * @returns The written OpenClawActionLogEntry.
   */
  append_pre_reject(event: PreSubmitStopEvent): OpenClawActionLogEntry;

  /**
   * Write-back the linked_skill_id for a SUCCESS entry after Phase C promotion.
   *
   * Called by the nightly loop runner's Phase C aggregator when a promoted
   * PromotedSkill has patch_source === 'openclaw'.
   *
   * @param entry_id     The OpenClawActionLogEntry.entry_id to update.
   * @param skill_id     The PromotedSkill.skill_id from Phase C.
   */
  link_promoted_skill(entry_id: string, skill_id: string): void;

  /**
   * Read the current in-memory intent stats (pre-flush snapshot).
   * Used to determine attempt_number before a new submission.
   */
  get_intent_stats(): OpenClawIntentStatsFile;

  /**
   * Read the current in-memory suggest stats (pre-flush snapshot).
   * Used by the operator to choose the best suggest_path.
   */
  get_suggest_stats(): OpenClawSuggestStatsFile;
}

// ---------------------------------------------------------------------------
// Internal helpers (types exposed for testing)
// ---------------------------------------------------------------------------

/**
 * Maps a GatewayDecision into the OpenClaw internal reason taxonomy.
 *
 * Called once per append_gateway_result() invocation.
 *
 * Mapping rules:
 *   PASS verdict                     → null (no reject reason)
 *   INVARIANT_VIOLATION              → 'invariant_violation'
 *   ACTION_RISK_MISMATCH             → 'invariant_violation'
 *   FORBIDDEN_TARGET                 → 'invariant_violation'
 *   UNKNOWN_ACTION                   → 'invariant_violation'
 *   HIGH_RISK_BLOCKED                → 'high_risk_global'
 */
export type MapRejectCode = (
  decision: GatewayDecision,
) => OpenClawInternalRejectReason | null;

/**
 * Maps a GatewayDecision.verdict to an OpenClawOutcome.
 *
 *   'PASS'         → 'SUCCESS'
 *   'REJECT'       → 'REJECT'
 *   'HARD_REJECT'  → 'HARD_REJECT'
 */
export type MapVerdictToOutcome = (verdict: GatewayDecision['verdict']) => OpenClawOutcome;

/**
 * Given an entry whose outcome === 'SUCCESS', scans the in-memory
 * intent_stats log for the most recent REJECT entry with the same
 * intent_key and sets suggest_led_to_success = true on it.
 *
 * Only the most recent unresolved REJECT entry is updated per SUCCESS.
 * The JSONL is read-append-only; the back-fill is recorded as a separate
 * tombstone entry or via the suggest_stats sidecar (not an in-place mutation).
 */
export type BackFillSuggestResult = (
  intent_key: string,
  success_entry_id: string,
) => void;
