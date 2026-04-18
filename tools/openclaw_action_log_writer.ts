/**
 * tools/openclaw_action_log_writer.ts
 *
 * OpenClaw Action Log Writer — Implementation
 * schema_version: openclaw_action_log_writer/0.1
 *
 * Implements OpenClawActionLogWriter (contract/openclaw_action_log_writer.d.ts).
 *
 * Persists three stores:
 *   openclaw_action_log.jsonl     — append-only per-attempt audit log
 *   openclaw_intent_stats.json    — mutable per-intent_key success counters
 *   openclaw_suggest_stats.json   — mutable per-suggest_path success counters
 *
 * All writes are synchronous (Node.js single-threaded; no locking required).
 * Directory creation is automatic and non-fatal.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  OpenClawRequest,
  GatewayDecision,
  GatewayRejectCode,
} from '../contract/openclaw_gateway';
import type {
  OpenClawActionLogEntry,
  OpenClawOutcome,
  OpenClawInternalRejectReason,
  SuggestPath,
  OpenClawIntentStats,
  OpenClawIntentStatsFile,
  OpenClawSuggestPathStats,
  OpenClawSuggestStatsFile,
  OpenClawLearningSummary,
  OpenClawFailurePatternSummary,
} from '../contract/openclaw_action_log';
import type {
  OpenClawActionLogWriterConfig,
  ResolvedIntentContext,
  PreSubmitStopEvent,
  OpenClawActionLogWriter,
} from '../contract/openclaw_action_log_writer';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** success_rate threshold below which an intent is flagged as "struggling". */
const STRUGGLING_INTENT_RATE_THRESHOLD = 0.50;
/** Minimum total_attempts before an intent can be flagged as struggling. */
const STRUGGLING_INTENT_MIN_ATTEMPTS = 2;
/** Max struggling intents to include in OpenClawLearningSummary. */
const MAX_STRUGGLING_INTENTS = 3;
/** Max fail_pattern entries to include in OpenClawLearningSummary. */
const MAX_FAIL_PATTERNS = 3;

// ---------------------------------------------------------------------------
// Pure helpers — reject_code → internal reason
// ---------------------------------------------------------------------------

function mapRejectCode(decision: GatewayDecision): OpenClawInternalRejectReason | null {
  if (decision.verdict === 'PASS') return null;
  const code = decision.reject_code;
  if (code === 'HIGH_RISK_BLOCKED') return 'high_risk_global';
  // All other hard stops map to invariant_violation
  if (
    code === 'INVARIANT_VIOLATION' ||
    code === 'ACTION_RISK_MISMATCH' ||
    code === 'FORBIDDEN_TARGET' ||
    code === 'UNKNOWN_ACTION'
  ) {
    return 'invariant_violation';
  }
  return 'invariant_violation'; // unknown code — fail safe
}

function mapVerdictToOutcome(verdict: GatewayDecision['verdict']): OpenClawOutcome {
  if (verdict === 'PASS') return 'SUCCESS';
  if (verdict === 'REJECT') return 'REJECT';
  return 'HARD_REJECT';
}

// ---------------------------------------------------------------------------
// intent_key normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a natural-language request into a stable intent key.
 *
 * Format: "<target>::<normalised-intent-phrase>"
 * Normalisation: lowercase, collapse whitespace, strip common leading articles/prepositions.
 *
 * For non-enqueue_candidate actions: key = "<action>::<target>" (no phrase normalisation).
 */
function resolveIntentKey(req: OpenClawRequest): string {
  if (req.action !== 'enqueue_candidate') {
    return `${req.action}::${req.target.toLowerCase()}`;
  }

  const params = req.parameters as Record<string, unknown>;
  const rationale = typeof params['rationale'] === 'string' ? params['rationale'] : '';
  const diff = typeof params['patch_diff'] === 'string' ? params['patch_diff'] : '';

  // Use rationale as the intent phrase; fall back to patch_diff first 80 chars
  const raw_phrase = (rationale || diff).trim().toLowerCase();
  const normalised = raw_phrase
    .replace(/^\s*(a|an|the|to|for|fix|improve|update|change|add|remove)\s+/i, '')
    .replace(/\s+/g, ' ')
    .slice(0, 100);

  return `${req.target.toLowerCase()}::${normalised}`;
}

// ---------------------------------------------------------------------------
// Sidecar file helpers
// ---------------------------------------------------------------------------

function loadIntentStatsFile(stats_path: string): OpenClawIntentStatsFile {
  try {
    if (fs.existsSync(stats_path)) {
      const raw = fs.readFileSync(stats_path, 'utf8');
      const parsed = JSON.parse(raw) as OpenClawIntentStatsFile;
      return parsed;
    }
  } catch {
    // corrupt or missing → start fresh
  }
  return {
    schema_version: 'openclaw_intent_stats/0.1',
    last_updated_at: new Date().toISOString(),
    stats: {},
  };
}

function loadSuggestStatsFile(stats_path: string): OpenClawSuggestStatsFile {
  try {
    if (fs.existsSync(stats_path)) {
      const raw = fs.readFileSync(stats_path, 'utf8');
      return JSON.parse(raw) as OpenClawSuggestStatsFile;
    }
  } catch {
    // corrupt or missing → start fresh
  }
  return {
    schema_version: 'openclaw_suggest_stats/0.1',
    last_updated_at: new Date().toISOString(),
    stats: {},
  };
}

function flushJSON(file_path: string, data: unknown): void {
  try {
    const dir = path.dirname(file_path);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file_path, JSON.stringify(data, null, 2), 'utf8');
  } catch {
    // Non-fatal: sidecar flush failure must never crash the caller
  }
}

// ---------------------------------------------------------------------------
// OpenClawActionLogWriterImpl
// ---------------------------------------------------------------------------

export class OpenClawActionLogWriterImpl implements OpenClawActionLogWriter {
  private readonly config: OpenClawActionLogWriterConfig;

  // In-memory sidecar state (loaded once, kept in sync, flushed after every write)
  private intent_stats: OpenClawIntentStatsFile;
  private suggest_stats: OpenClawSuggestStatsFile;

  constructor(config: OpenClawActionLogWriterConfig) {
    this.config = config;

    // Ensure directories exist
    for (const p of [
      config.action_log_path,
      config.intent_stats_path,
      config.suggest_stats_path,
    ]) {
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
      } catch {
        // non-fatal
      }
    }

    // Load existing sidecar state
    this.intent_stats = loadIntentStatsFile(config.intent_stats_path);
    this.suggest_stats = loadSuggestStatsFile(config.suggest_stats_path);
  }

  // ── Public interface ─────────────────────────────────────────────────────

  append_gateway_result(
    request: OpenClawRequest,
    decision: GatewayDecision,
    suggest_path: SuggestPath | null,
  ): OpenClawActionLogEntry {
    const now = new Date().toISOString();
    const intent_key = resolveIntentKey(request);
    const outcome = mapVerdictToOutcome(decision.verdict);
    const reject_reason = mapRejectCode(decision);

    // Compute attempt_number before updating stats
    const attempt_number = request.action === 'enqueue_candidate'
      ? this._getNextAttemptNumber(intent_key)
      : null;

    const entry: OpenClawActionLogEntry = {
      schema_version: 'openclaw_action_log/0.1',
      entry_id: randomUUID(),
      recorded_at: now,
      action: request.action,
      target: request.target,
      intent_key,
      attempt_number,
      estimated_blast_radius:
        request.action === 'enqueue_candidate'
          ? ((request.parameters['estimated_blast_radius'] as string) ?? null) as
              | 'SELF'
              | 'TENANT'
              | 'GLOBAL'
              | null
          : null,
      outcome,
      reject_reason,
      gateway_reject_code: decision.reject_code,
      gateway_reason: decision.reason,
      suggest_path: outcome === 'SUCCESS' || outcome === 'HARD_REJECT' ? null : suggest_path,
      suggest_led_to_success: null,   // resolved later via back_fill
      linked_skill_id: null,          // filled by link_promoted_skill() after Phase C
    };

    this._appendToJSONL(entry);
    this._updateIntentStats(entry);
    if (outcome === 'SUCCESS') {
      this._backFillSuggestLedToSuccess(intent_key, entry.entry_id);
    }
    if (entry.suggest_path !== null) {
      this._updateSuggestStats(entry.suggest_path, false);
    }
    this._flushSidecars();

    return entry;
  }

  append_pre_reject(event: PreSubmitStopEvent): OpenClawActionLogEntry {
    const now = new Date().toISOString();
    const intent_key = `${event.action}::${event.target.toLowerCase()}`;

    const outcome: OpenClawOutcome =
      event.stop_reason === 'cap_exceeded' ? 'STOPPED_BY_CAP' : 'PRE_REJECT';

    const attempt_number = event.action === 'enqueue_candidate'
      ? this._getNextAttemptNumber(intent_key)
      : null;

    const entry: OpenClawActionLogEntry = {
      schema_version: 'openclaw_action_log/0.1',
      entry_id: randomUUID(),
      recorded_at: now,
      action: event.action,
      target: event.target,
      intent_key,
      attempt_number,
      estimated_blast_radius: null,
      outcome,
      reject_reason: event.stop_reason,
      gateway_reject_code: null,
      gateway_reason: null,
      suggest_path: event.stop_reason === 'cap_exceeded' ? 'none' : event.suggest_path,
      suggest_led_to_success: null,
      linked_skill_id: null,
    };

    this._appendToJSONL(entry);
    this._updateIntentStats(entry);
    if (entry.suggest_path !== null && entry.suggest_path !== 'none') {
      this._updateSuggestStats(entry.suggest_path, false);
    }
    this._flushSidecars();

    return entry;
  }

  link_promoted_skill(entry_id: string, skill_id: string): void {
    // The JSONL is append-only — record the link as a tombstone entry
    // so the connection is traceable without in-place mutation.
    const tombstone = JSON.stringify({
      schema_version: 'openclaw_action_log/0.1',
      _type: 'skill_link',
      entry_id,
      linked_skill_id: skill_id,
      recorded_at: new Date().toISOString(),
    });
    try {
      fs.appendFileSync(this.config.action_log_path, tombstone + '\n', 'utf8');
    } catch {
      // non-fatal
    }
  }

  get_intent_stats(): OpenClawIntentStatsFile {
    return this.intent_stats;
  }

  get_suggest_stats(): OpenClawSuggestStatsFile {
    return this.suggest_stats;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private _appendToJSONL(entry: OpenClawActionLogEntry): void {
    try {
      fs.appendFileSync(
        this.config.action_log_path,
        JSON.stringify(entry) + '\n',
        'utf8',
      );
    } catch {
      // Non-fatal
    }
  }

  private _getNextAttemptNumber(intent_key: string): number {
    const existing = this.intent_stats.stats[intent_key];
    return existing ? existing.total_attempts + 1 : 1;
  }

  private _updateIntentStats(entry: OpenClawActionLogEntry): void {
    const key = entry.intent_key;
    const existing = this.intent_stats.stats[key];

    const prev_total = existing?.total_attempts ?? 0;
    const prev_success = existing?.success_count ?? 0;
    const is_success = entry.outcome === 'SUCCESS';

    const new_total = prev_total + 1;
    const new_success = prev_success + (is_success ? 1 : 0);

    // dominant_fail_pattern: track a simple count map in metadata
    let dominant: OpenClawInternalRejectReason | null =
      existing?.dominant_fail_pattern ?? null;
    if (!is_success && entry.reject_reason !== null) {
      // Simple heuristic: always use the latest fail reason as dominant
      // (in practice a counter would be better, but sufficient without I/O)
      dominant = entry.reject_reason;
    }

    const updated: OpenClawIntentStats = {
      intent_key: key,
      total_attempts: new_total,
      success_count: new_success,
      success_rate: new_total > 0 ? new_success / new_total : 0,
      last_outcome: entry.outcome,
      last_recorded_at: entry.recorded_at,
      dominant_fail_pattern: dominant,
    };

    this.intent_stats.stats[key] = updated;
    this.intent_stats.last_updated_at = entry.recorded_at;
  }

  private _updateSuggestStats(suggest_path: SuggestPath, led_to_success: boolean): void {
    if (suggest_path === 'none') return;
    const existing = this.suggest_stats.stats[suggest_path];
    const prev_suggested = existing?.times_suggested ?? 0;
    const prev_success = existing?.times_led_to_success ?? 0;

    const new_suggested = prev_suggested + 1;
    const new_success = prev_success + (led_to_success ? 1 : 0);

    const updated: OpenClawSuggestPathStats = {
      suggest_path,
      times_suggested: new_suggested,
      times_led_to_success: new_success,
      success_rate: new_suggested > 0 ? new_success / new_suggested : 0,
    };
    this.suggest_stats.stats[suggest_path] = updated;
    this.suggest_stats.last_updated_at = new Date().toISOString();
  }

  /**
   * When a SUCCESS arrives, find the most recent unresolved REJECT entry for
   * the same intent_key and credit the suggest_path with a success.
   *
   * Because the JSONL is append-only, we don't mutate it.
   * Instead, we update the in-memory suggest_stats counter so the sidecar
   * reflects that the path led to success.
   */
  private _backFillSuggestLedToSuccess(
    intent_key: string,
    _success_entry_id: string,
  ): void {
    // Scan in-memory stats to find if there's a recent prior REJECT
    // We approximate this by reading the last few JSONL lines for the intent.
    // For in-memory accuracy, we track the most recent suggest_path in a
    // transient map scoped to this writer instance.
    const last_suggest = this._last_pending_suggest.get(intent_key);
    if (last_suggest && last_suggest !== 'none') {
      // Credit the suggest_stats for this path
      const existing = this.suggest_stats.stats[last_suggest];
      if (existing && existing.times_suggested > 0) {
        existing.times_led_to_success += 1;
        existing.success_rate =
          existing.times_led_to_success / existing.times_suggested;
      }
      this._last_pending_suggest.delete(intent_key);
    }
  }

  /** Tracks the most recent suggest_path per intent_key across this session. */
  private _last_pending_suggest = new Map<string, SuggestPath>();

  private _flushSidecars(): void {
    flushJSON(this.config.intent_stats_path, this.intent_stats);
    flushJSON(this.config.suggest_stats_path, this.suggest_stats);
  }
}

// ---------------------------------------------------------------------------
// findLastEntryIdForTarget — helper for phase_d_aggregator link wiring
// ---------------------------------------------------------------------------

/**
 * Scan the action log JSONL and return the entry_id of the most recent
 * SUCCESS entry for the given action + target combination.
 *
 * Used by phase_d_aggregator to link promoted skilled back to their origin
 * log entry without requiring callers to track entry_ids manually.
 *
 * Returns null if no matching entry is found or the log is unreadable.
 */
export function findLastEntryIdForTarget(
  action_log_path: string,
  target: string,
  action: string = 'enqueue_candidate',
): string | null {
  try {
    if (!fs.existsSync(action_log_path)) return null;
    const lines = fs.readFileSync(action_log_path, 'utf8').split('\n').filter(Boolean);
    const normalised_target = target.toLowerCase();
    let best: string | null = null;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry['_type'] === 'skill_link') continue;
        if (
          entry['action'] === action &&
          String(entry['target'] ?? '').toLowerCase() === normalised_target &&
          entry['outcome'] === 'SUCCESS'
        ) {
          best = String(entry['entry_id']);
        }
      } catch {
        // malformed line — skip
      }
    }
    return best;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// buildOpenClawLearningSummary — called by phase_d_aggregator
// ---------------------------------------------------------------------------

/**
 * Aggregate the three persisted stores into an OpenClawLearningSummary
 * suitable for embedding in MorningResult.openclaw_learning_summary.
 *
 * Reads the JSONL for fail_pattern roll-up and uses the two JSON sidecars
 * for suggest_path and intent stats.
 *
 * Returns null when the action log does not exist or has no entries.
 */
export function buildOpenClawLearningSummary(
  action_log_path: string,
  intent_stats_path: string,
  suggest_stats_path: string,
): OpenClawLearningSummary | null {
  // ── Load stores ──────────────────────────────────────────────────────────
  const intent_file = loadIntentStatsFile(intent_stats_path);
  const suggest_file = loadSuggestStatsFile(suggest_stats_path);

  // ── Total counts from intent stats ───────────────────────────────────────
  const all_intents = Object.values(intent_file.stats);
  const total_attempts = all_intents.reduce((s, i) => s + i.total_attempts, 0);
  const total_successes = all_intents.reduce((s, i) => s + i.success_count, 0);

  if (total_attempts === 0) return null;

  const overall_success_rate = total_successes / total_attempts;

  // ── Fail pattern roll-up from JSONL ──────────────────────────────────────
  const fail_map = new Map<
    OpenClawInternalRejectReason,
    { count: number; last_seen_at: string; intent_keys: Set<string> }
  >();

  try {
    if (fs.existsSync(action_log_path)) {
      const lines = fs.readFileSync(action_log_path, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          // Skip tombstone entries
          if (entry['_type'] === 'skill_link') continue;

          const reason = entry['reject_reason'] as OpenClawInternalRejectReason | null;
          if (!reason) continue;

          const intent_key = String(entry['intent_key'] ?? '');
          const recorded_at = String(entry['recorded_at'] ?? '');

          const existing = fail_map.get(reason);
          if (!existing) {
            fail_map.set(reason, {
              count: 1,
              last_seen_at: recorded_at,
              intent_keys: new Set([intent_key]),
            });
          } else {
            existing.count++;
            if (recorded_at > existing.last_seen_at) {
              existing.last_seen_at = recorded_at;
            }
            if (existing.intent_keys.size < 5) {
              existing.intent_keys.add(intent_key);
            }
          }
        } catch {
          // Malformed line — skip
        }
      }
    }
  } catch {
    // JSONL unreadable — continue with empty fail_map
  }

  const top_fail_patterns: OpenClawFailurePatternSummary[] = [...fail_map.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, MAX_FAIL_PATTERNS)
    .map(([pattern, data]) => ({
      fail_pattern: pattern,
      count: data.count,
      last_seen_at: data.last_seen_at,
      intent_keys: [...data.intent_keys].slice(0, 5),
    }));

  // ── suggest_path ranking ─────────────────────────────────────────────────
  const suggest_path_ranking: OpenClawSuggestPathStats[] = Object.values(
    suggest_file.stats,
  ).sort((a, b) => b.success_rate - a.success_rate);

  // ── struggling intents ────────────────────────────────────────────────────
  const struggling_intents = all_intents
    .filter(
      (i) =>
        i.total_attempts >= STRUGGLING_INTENT_MIN_ATTEMPTS &&
        i.success_rate < STRUGGLING_INTENT_RATE_THRESHOLD,
    )
    .sort((a, b) => a.success_rate - b.success_rate)
    .slice(0, MAX_STRUGGLING_INTENTS);

  return {
    total_attempts,
    total_successes,
    overall_success_rate,
    top_fail_patterns,
    suggest_path_ranking,
    struggling_intents,
    computed_at: new Date().toISOString(),
  };
}
