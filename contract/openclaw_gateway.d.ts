/**
 * contract/openclaw_gateway.d.ts
 *
 * OpenClaw Gateway — External Integration Safety Contract
 * Schema version: openclaw_gateway/0.1
 *
 * Every external automation request from OpenClaw MUST pass through this
 * gateway before touching any Antigravity OS component.
 *
 * GOVERNANCE BOUNDARY (inviolable):
 *   The gateway MUST NOT allow any request to:
 *     – influence tier evaluation, promotion_gate, or invariant_check
 *     – write FailureLedger entries directly
 *     – bypass Phase A → B → C ordering
 *     – modify governance kernel files
 *       (nightly_loop_runner, phase_*_orchestrator, verify_constitution,
 *        merge_gate, rollback_executor)
 *
 * Allowed operations:
 *   READ  (LOW risk):    query_morning_result | query_state | query_environment | list_pending_review
 *   WRITE (MEDIUM risk): enqueue_candidate | approve_human_review | reject_human_review
 *   HIGH risk:           always HARD_REJECT — no action name maps to HIGH
 *
 * Data flow:
 *   [OpenClaw]
 *      ↓ OpenClawRequest
 *   [OpenClawGateway.process()]
 *      ↓ GatewayDecision (PASS / REJECT / HARD_REJECT)
 *   [Antigravity OS]
 *      ├ READ   → query ledger / morning_result (read-only, no state change)
 *      └ WRITE  → enqueue_candidate → Phase A evaluation queue
 *                 approve/reject_human_review → HumanReviewStore
 *
 * Schema freeze: openclaw_gateway/0.1
 * To change: bump minor version, add migration note here.
 */

// ---------------------------------------------------------------------------
// Request taxonomy
// ---------------------------------------------------------------------------

/**
 * All OpenClaw-permitted actions.
 *
 * READ ops (must be declared LOW risk):
 *   query_morning_result  — fetch the latest MorningResult JSON
 *   query_state           — fetch the current TaskStateMachineRecord status
 *   query_environment     — fetch the latest EnvironmentProfile / WorldShiftReport
 *   list_pending_review   — list patch IDs awaiting human review
 *
 * WRITE ops (must be declared MEDIUM risk):
 *   enqueue_candidate     — submit a patch candidate for Phase A evaluation
 *   approve_human_review  — submit human review APPROVE decision
 *   reject_human_review   — submit human review REJECT decision
 *
 * HIGH risk is not an action — it is a risk_level flag that triggers HARD_REJECT.
 */
export type OpenClawAction =
  | 'query_morning_result'
  | 'query_state'
  | 'query_environment'
  | 'list_pending_review'
  | 'query_hints'
  | 'enqueue_candidate'
  | 'approve_human_review'
  | 'reject_human_review';

export type OpenClawRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/** An external request from OpenClaw submitted to the Antigravity OS gateway. */
export interface OpenClawRequest {
  /** UUID v4 — unique per request. */
  request_id: string;

  /** ISO-8601 UTC — when OpenClaw submitted this request. */
  submitted_at: string;

  /** The operation being requested. */
  action: OpenClawAction;

  /**
   * Target of the operation.
   *   enqueue_candidate:              target_function name or target file path.
   *   approve_human_review /
   *   reject_human_review:            the patch_id under review.
   *   READ ops:                       empty string or query hint.
   */
  target: string;

  /**
   * Caller-declared risk level.
   *   HIGH → HARD_REJECT immediately regardless of action.
   *   Must match the action's allowed tier (READ = LOW, WRITE = MEDIUM).
   */
  risk_level: OpenClawRiskLevel;

  /**
   * Action-specific payload (schema varies by action):
   *   enqueue_candidate:              { patch_diff: string, rationale: string,
   *                                     estimated_blast_radius: 'SELF'|'TENANT'|'GLOBAL' }
   *   approve_human_review /
   *   reject_human_review:            { patch_id: string, operator_note: string }
   *   READ ops:                       {} (empty)
   */
  parameters: Record<string, unknown>;

  /**
   * Optional free-text justification for MEDIUM risk requests.
   * Included verbatim in the audit trail.
   */
  justification?: string;
}

// ---------------------------------------------------------------------------
// Gateway verdict
// ---------------------------------------------------------------------------

export type GatewayVerdict =
  | 'PASS'         // Request is safe and may proceed.
  | 'REJECT'       // Soft rejection; caller may retry with a corrected request.
  | 'HARD_REJECT'; // Permanent rejection; request violated an immutable invariant.

/** Machine-readable reason codes for non-PASS decisions. */
export type GatewayRejectCode =
  | 'HIGH_RISK_BLOCKED'    // risk_level === 'HIGH' (always blocked)
  | 'FORBIDDEN_TARGET'     // target matches a governance kernel component
  | 'ACTION_RISK_MISMATCH' // risk_level does not match the action's allowed tier
  | 'INVARIANT_VIOLATION'  // request payload would violate a core OS invariant
  | 'UNKNOWN_ACTION';      // action string not in OpenClawAction whitelist

/** The gateway's decision for a single request. */
export interface GatewayDecision {
  /** Mirrors OpenClawRequest.request_id for correlation. */
  request_id: string;

  /** ISO-8601 UTC — when the gate evaluated this request. */
  evaluated_at: string;

  verdict: GatewayVerdict;

  /** Human-readable reason (≤ 200 chars). Always set for REJECT / HARD_REJECT. */
  reason: string | null;

  /** Machine-readable rejection code. null on PASS. */
  reject_code: GatewayRejectCode | null;

  /**
   * The normalised action approved for execution.
   * null on REJECT / HARD_REJECT.
   */
  approved_action: OpenClawAction | null;

  /**
   * Action-specific response payload. Set on PASS for data-returning READ ops:
   *   query_hints: { hint_text: string; total_entries: number; top_n: number }
   * null for WRITE ops or non-data READ ops.
   */
  payload: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

/**
 * Immutable audit record appended to the JSONL audit log on every evaluation.
 * One line per request, unordered, append-only.
 */
export interface GatewayAuditEntry {
  schema_version: 'openclaw_gateway/0.1';
  request_id: string;
  submitted_at: string;
  evaluated_at: string;
  /** Stored as-is (may be an unrecognised string) for forensic completeness. */
  action: string;
  target: string;
  risk_level: OpenClawRiskLevel;
  verdict: GatewayVerdict;
  reject_code: GatewayRejectCode | null;
  reason: string | null;
  justification: string | null;
  /**
   * Specific invariant IDs or forbidden-path substrings that triggered the rejection.
   * Set when reject_code is 'FORBIDDEN_TARGET' or 'INVARIANT_VIOLATION'.
   * Enables #3/#13 observability: downstream tooling can enumerate which constraint
   * fired without re-parsing the human-readable reason string.
   */
  violated_invariant_ids?: string[];
}

// ---------------------------------------------------------------------------
// Per-cycle summary
// ---------------------------------------------------------------------------

/**
 * Aggregated gateway statistics for one nightly cycle.
 * Included in MorningResult.gateway_summary when the gateway is wired.
 * DISPLAY-LAYER ONLY — must not affect governance decisions.
 */
export interface GatewayCycleSummary {
  schema_version: 'openclaw_gateway/0.1';
  cycle_id: string;
  /** Total requests evaluated this cycle. */
  total_requests: number;
  /** Requests that received PASS verdict. */
  passed: number;
  /** Requests that received REJECT (soft) verdict. */
  rejected: number;
  /** Requests that received HARD_REJECT verdict (invariant / HIGH-risk blocks). */
  hard_rejected: number;
  /** enqueue_candidate requests that received PASS — candidates injected into Phase A. */
  enqueued_candidates: number;
  /** approve_human_review requests that received PASS. */
  approved_reviews: number;
}

// ---------------------------------------------------------------------------
// Gateway configuration
// ---------------------------------------------------------------------------

/** Runtime configuration injected into the OpenClawGateway. */
export interface OpenClawGatewayConfig {
  /**
   * Maximum number of enqueue_candidate requests allowed per 24-hour window.
   * Prevents Phase A queue flooding.
   * Default: 10.
   */
  max_enqueue_per_day: number;

  /**
   * Governance kernel component substrings.
   * Any request whose target.toLowerCase() includes any of these substrings
   * receives HARD_REJECT / FORBIDDEN_TARGET.
   */
  forbidden_target_substrings: string[];

  /**
   * Absolute path to the JSONL audit log file.
   * Each line is one JSON-serialised GatewayAuditEntry.
   * The directory is created automatically if it does not exist.
   */
  audit_log_path: string;

  /**
   * Absolute path to adaptation_memory.jsonl.
   * Required to serve query_hints responses.
   * If omitted, query_hints returns an empty hint block.
   */
  adaptation_memory_path?: string;

  // ── Action log integration (openclaw_action_log/0.1) ──────────────────────

  /**
   * Absolute path to openclaw_action_log.jsonl.
   * When set, process() appends one OpenClawActionLogEntry after every
   * verdict — PASS, REJECT, and HARD_REJECT alike.
   * If omitted, no action log is written.
   */
  action_log_path?: string;

  /**
   * Absolute path to openclaw_intent_stats.json sidecar.
   * Updated atomically after every action_log append.
   * Required when action_log_path is set; ignored otherwise.
   */
  intent_stats_path?: string;

  /**
   * Absolute path to openclaw_suggest_stats.json sidecar.
   * Updated atomically after every action_log append.
   * Required when action_log_path is set; ignored otherwise.
   */
  suggest_stats_path?: string;

  /**
   * File path substrings identifying benchmark / measurement scripts.
   * If an enqueue_candidate request's patch_diff contains any of these substrings,
   * the request is HARD_REJECTED with FORBIDDEN_TARGET (#9 metrics-contamination guard).
   * Default: [] (disabled).
   */
  benchmark_protected_paths?: string[];
}
