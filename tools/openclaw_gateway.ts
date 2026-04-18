/**
 * tools/openclaw_gateway.ts
 *
 * OpenClaw Gateway — Fail-Closed External Integration Gate
 * schema_version: openclaw_gateway/0.1
 *
 * Entry point for ALL external automation requests from OpenClaw.
 * Direct execution of any OS operation without passing through this gate is FORBIDDEN.
 *
 * Evaluation rules (first match wins):
 *   1. risk_level === 'HIGH'                         → HARD_REJECT  HIGH_RISK_BLOCKED
 *   2. action not in OpenClawAction whitelist         → HARD_REJECT  UNKNOWN_ACTION
 *   3. target matches a forbidden governance substring → HARD_REJECT  FORBIDDEN_TARGET
 *   4. action/risk_level tier mismatch               → REJECT        ACTION_RISK_MISMATCH
 *   5. enqueue_candidate payload invariant violation  → HARD_REJECT  INVARIANT_VIOLATION
 *   6. (all rules passed)                             → PASS
 *
 * Every decision is appended as a GatewayAuditEntry line to the JSONL audit log.
 * Audit write failures are non-fatal (execution is not blocked).
 *
 * Thread safety: single-threaded Node.js event loop — no locking required.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  buildAdaptationHintBlock,
  loadRecentAdaptationMemory,
  computeEffectiveScore,
  HINT_MIN_EFFECTIVE_SCORE,
} from './adaptation_memory_writer';
import { OpenClawActionLogWriterImpl } from './openclaw_action_log_writer';
import { autoShrinkBlastRadius } from './openclaw_decision_engine';
import type { BlastRadiusLabel } from '../contract/adaptation_memory';
import type {
  OpenClawRequest,
  OpenClawAction,
  GatewayVerdict,
  GatewayDecision,
  GatewayRejectCode,
  GatewayAuditEntry,
  GatewayCycleSummary,
  OpenClawGatewayConfig,
} from '../contract/openclaw_gateway';

// ---------------------------------------------------------------------------
// Action sets
// ---------------------------------------------------------------------------

const READ_ACTIONS = new Set<OpenClawAction>([
  'query_morning_result',
  'query_state',
  'query_environment',
  'list_pending_review',
  'query_hints',
]);

const WRITE_ACTIONS = new Set<OpenClawAction>([
  'enqueue_candidate',
  'approve_human_review',
  'reject_human_review',
]);

const ALL_ACTIONS = new Set<OpenClawAction>([...READ_ACTIONS, ...WRITE_ACTIONS]);

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default forbidden target substrings.
 * Any request whose target.toLowerCase() contains any of these strings is
 * HARD_REJECTED with FORBIDDEN_TARGET.
 * Callers may extend or replace via OpenClawGatewayConfig.forbidden_target_substrings.
 */
export const DEFAULT_FORBIDDEN_TARGETS: string[] = [
  'nightly_loop_runner',
  'phase_a_orchestrator',
  'phase_b_orchestrator',
  'phase_c_orchestrator',
  'phase_d_aggregator',
  'verify_constitution',
  'merge_gate',
  'rollback_executor',
  'failure_ledger',
  'promotion_gate',
  'tier_evaluation',
  'invariant_check',
  'bench_aggregate_weekly',
  'benchmark_sandbox_runner',
];

/**
 * Default benchmark and measurement path substrings.
 * Any enqueue patch touching these paths is treated as a measurement-integrity violation.
 */
export const DEFAULT_BENCHMARK_PROTECTED_PATHS: string[] = [
  'bench_aggregate_weekly',
  'benchmark_sandbox_runner',
  'run_benchmark',
];

// ---------------------------------------------------------------------------
// Pure evaluation function (no I/O)
// ---------------------------------------------------------------------------

/**
 * Evaluate an OpenClawRequest against the gateway rules.
 * Pure function — no side effects, no I/O.
 * Returns a GatewayDecision.
 */
export function evaluateGateway(
  req: OpenClawRequest,
  config: OpenClawGatewayConfig
): GatewayDecision {
  const evaluated_at = new Date().toISOString();

  function decide(
    verdict: GatewayVerdict,
    reject_code: GatewayRejectCode | null,
    reason: string | null
  ): GatewayDecision {
    return {
      request_id: req.request_id,
      evaluated_at,
      verdict,
      reason,
      reject_code,
      approved_action: verdict === 'PASS' ? req.action : null,
      payload: null,
    };
  }

  // Rule 1: HIGH risk level → HARD_REJECT immediately (no action check needed)
  if (req.risk_level === 'HIGH') {
    return decide(
      'HARD_REJECT',
      'HIGH_RISK_BLOCKED',
      'HIGH risk requests require explicit human review — auto-approval via gateway is forbidden'
    );
  }

  // Rule 2: action must be in the whitelist
  if (!ALL_ACTIONS.has(req.action)) {
    return decide(
      'HARD_REJECT',
      'UNKNOWN_ACTION',
      `Action '${req.action}' is not in the OpenClaw action whitelist`
    );
  }

  // Rule 3: target must not match any governance kernel component
  const lower_target = req.target.toLowerCase();
  for (const forbidden of config.forbidden_target_substrings) {
    if (lower_target.includes(forbidden.toLowerCase())) {
      return decide(
        'HARD_REJECT',
        'FORBIDDEN_TARGET',
        `Target '${req.target}' matches forbidden governance component '${forbidden}'`
      );
    }
  }

  // Rule 3.5: enqueue_candidate patch_diff must not touch benchmark/measurement scripts
  if (req.action === 'enqueue_candidate') {
    const protected_paths = config.benchmark_protected_paths ?? [];
    if (protected_paths.length > 0) {
      const diff = String((req.parameters ?? {})['patch_diff'] ?? '');
      for (const protected_path of protected_paths) {
        if (diff.includes(protected_path)) {
          return decide(
            'HARD_REJECT',
            'FORBIDDEN_TARGET',
            `patch_diff touches protected benchmark path '${protected_path}' — measurement integrity violation (#9)`
          );
        }
      }
    }
  }

  // Rule 4: action/risk_level tier consistency (READ = LOW, WRITE = MEDIUM)
  if (READ_ACTIONS.has(req.action) && req.risk_level === 'MEDIUM') {
    return decide(
      'REJECT',
      'ACTION_RISK_MISMATCH',
      `READ action '${req.action}' submitted with MEDIUM risk — downgrade risk_level to LOW`
    );
  }
  if (WRITE_ACTIONS.has(req.action) && req.risk_level === 'LOW') {
    return decide(
      'REJECT',
      'ACTION_RISK_MISMATCH',
      `WRITE action '${req.action}' submitted as LOW risk — must be MEDIUM`
    );
  }

  // Rule 5: enqueue_candidate payload invariants
  if (req.action === 'enqueue_candidate') {
    const params = req.parameters;

    // GLOBAL blast_radius patches must go through human review, not OpenClaw
    if (params['estimated_blast_radius'] === 'GLOBAL') {
      return decide(
        'HARD_REJECT',
        'INVARIANT_VIOLATION',
        'Patches with GLOBAL blast_radius must go through human review — OpenClaw enqueue is forbidden for GLOBAL patches'
      );
    }

    // patch_diff must be a non-empty string
    const diff = params['patch_diff'];
    if (typeof diff !== 'string' || diff.trim().length === 0) {
      return decide(
        'HARD_REJECT',
        'INVARIANT_VIOLATION',
        'enqueue_candidate requires a non-empty patch_diff string'
      );
    }

    // rationale must be a non-empty string
    const rationale = params['rationale'];
    if (typeof rationale !== 'string' || rationale.trim().length === 0) {
      return decide(
        'HARD_REJECT',
        'INVARIANT_VIOLATION',
        'enqueue_candidate requires a non-empty rationale string'
      );
    }
  }

  // All rules passed
  return decide('PASS', null, null);
}

// ---------------------------------------------------------------------------
// OpenClawGateway — stateful class with audit log I/O
// ---------------------------------------------------------------------------

/**
 * Stateful gateway with audit log persistence and per-cycle counters.
 *
 * Lifecycle:
 *   const gw = new OpenClawGateway({ ...config, audit_log_path: '...' });
 *   gw.beginCycle(cycle_id);            // called at start of each nightly cycle
 *   const decision = gw.process(req);   // called for each incoming OpenClaw request
 *   const summary  = gw.buildCycleSummary(cycle_id); // called before Phase D aggregation
 */
export class OpenClawGateway {
  private readonly config: OpenClawGatewayConfig;
  private current_cycle_id: string | null = null;
  private writer?: OpenClawActionLogWriterImpl;

  // Per-cycle counters — reset on beginCycle()
  private counters = {
    total: 0,
    passed: 0,
    rejected: 0,
    hard_rejected: 0,
    enqueued_candidates: 0,
    approved_reviews: 0,
  };

  constructor(config: OpenClawGatewayConfig) {
    this.config = config;
    if (!config.audit_log_path) {
      throw new Error('OpenClawGateway: audit_log_path must be set in config');
    }
    // Ensure audit log directory exists at construction time
    const dir = path.dirname(config.audit_log_path);
    fs.mkdirSync(dir, { recursive: true });
    // Initialise learning log writer when all three log paths are configured
    if (config.action_log_path && config.intent_stats_path && config.suggest_stats_path) {
      this.writer = new OpenClawActionLogWriterImpl({
        action_log_path: config.action_log_path,
        intent_stats_path: config.intent_stats_path,
        suggest_stats_path: config.suggest_stats_path,
      });
    }
  }

  /**
   * Begin a new nightly cycle.
   * Resets per-cycle counters and records the active cycle_id.
   * MUST be called at the start of each cycle before any process() calls.
   */
  beginCycle(cycle_id: string): void {
    this.current_cycle_id = cycle_id;
    this.counters = {
      total: 0,
      passed: 0,
      rejected: 0,
      hard_rejected: 0,
      enqueued_candidates: 0,
      approved_reviews: 0,
    };
  }

  /**
   * Evaluate an OpenClawRequest and persist an audit entry.
   * Returns the GatewayDecision synchronously.
   * Audit write failures are non-fatal — the decision is returned regardless.
   * For query_hints PASS decisions, the hint payload is attached before return.
   */
  process(req: OpenClawRequest): GatewayDecision {
    const decision = evaluateGateway(req, this.config);

    // Enrich query_hints PASS with hint block payload (I/O allowed here)
    if (decision.verdict === 'PASS' && req.action === 'query_hints') {
      const mem_path = this.config.adaptation_memory_path;
      if (mem_path) {
        const now = new Date();
        const all = loadRecentAdaptationMemory(mem_path, 200);
        // NOTE: openclaw path has no stressed_invariant_ids by design.
        // OpenClaw is an external query endpoint that does not share FocusSeed context
        // with the nightly loop.  Consequently, patches originating from OpenClaw tend
        // to have thinner attribution than nightly-loop candidates.  If OpenClaw usage
        // grows significantly in Phase G+, consider wiring a lightweight seed context
        // (e.g. a global invariant_health snapshot) to reduce the attribution gap.
        const hint_text = buildAdaptationHintBlock(mem_path, { now });
        const expired_hints_excluded = all.filter(
          (e) => computeEffectiveScore(e.hint_score ?? 0, e.recorded_at, now) < HINT_MIN_EFFECTIVE_SCORE
        ).length;
        decision.payload = {
          hint_text,
          total_entries: all.length,
          top_n: 5,
          expired_hints_excluded,
        };
      } else {
        decision.payload = {
          hint_text: '（adaptation_memory_path が未設定です）',
          total_entries: 0,
          top_n: 0,
          expired_hints_excluded: 0,
        };
      }
    }

    this._updateCounters(req, decision);
    this._appendAudit(req, decision);
    // Record this attempt in the learning log (non-fatal if writer absent)
    this.writer?.append_gateway_result(req, decision, null);
    return decision;
  }

  /**
   * Process an OpenClawRequest with automatic scope shrink on HIGH_RISK_BLOCKED.
   *
   * Rule ②: if the first evaluation returns HIGH_RISK_BLOCKED, the request's
   * estimated_blast_radius is automatically shrunk one tier (GLOBAL→TENANT→SELF)
   * and re-evaluated once.  The final decision always reflects the shrunk attempt.
   *
   * Both attempts are written to the audit log and action log writer.
   * The returned decision's `payload.auto_shrunk` flag indicates shrink occurred.
   *
   * Use this instead of `process()` when you want the "safe-side bias" behaviour.
   */
  processWithAutoShrink(req: OpenClawRequest): GatewayDecision & { auto_shrunk?: boolean } {
    const first = this.process(req);
    if (first.reject_code !== 'HIGH_RISK_BLOCKED') {
      return first;
    }

    // Extract current blast_radius from parameters
    const params = (req.parameters ?? {}) as Record<string, unknown>;
    const current_radius = (params['estimated_blast_radius'] as BlastRadiusLabel | undefined) ?? 'GLOBAL';
    const shrunk_radius = autoShrinkBlastRadius(current_radius);

    if (shrunk_radius === current_radius) {
      // Already at SELF — cannot shrink further
      return { ...first, auto_shrunk: false };
    }

    // Build shrunk request
    const shrunk_req: OpenClawRequest = {
      ...req,
      parameters: { ...params, estimated_blast_radius: shrunk_radius },
    };

    const second = this.process(shrunk_req);
    return { ...second, auto_shrunk: true };
  }

  /**
   * Build and return the per-cycle summary.
   * Call this before Phase D aggregation so MorningResult includes gateway stats.
   */
  buildCycleSummary(cycle_id: string): GatewayCycleSummary {
    return {
      schema_version: 'openclaw_gateway/0.1',
      cycle_id,
      total_requests: this.counters.total,
      passed: this.counters.passed,
      rejected: this.counters.rejected,
      hard_rejected: this.counters.hard_rejected,
      enqueued_candidates: this.counters.enqueued_candidates,
      approved_reviews: this.counters.approved_reviews,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private _updateCounters(req: OpenClawRequest, decision: GatewayDecision): void {
    this.counters.total++;
    if (decision.verdict === 'PASS') {
      this.counters.passed++;
      if (req.action === 'enqueue_candidate') this.counters.enqueued_candidates++;
      if (req.action === 'approve_human_review') this.counters.approved_reviews++;
    } else if (decision.verdict === 'REJECT') {
      this.counters.rejected++;
    } else {
      // HARD_REJECT
      this.counters.hard_rejected++;
    }
  }

  private _appendAudit(req: OpenClawRequest, decision: GatewayDecision): void {
    // Derive violated_invariant_ids for observability (#3/#13)
    let violated_invariant_ids: string[] | undefined;
    if (decision.reject_code === 'FORBIDDEN_TARGET') {
      const lower_target = req.target.toLowerCase();
      const matched_targets = this.config.forbidden_target_substrings.filter(
        (f) => lower_target.includes(f.toLowerCase())
      );
      const protected_paths = this.config.benchmark_protected_paths ?? [];
      const diff = String(((req.parameters ?? {})['patch_diff'] as string | undefined) ?? '');
      const matched_paths = protected_paths.filter((p) => diff.includes(p));
      const all_violated = [...matched_targets, ...matched_paths];
      if (all_violated.length > 0) violated_invariant_ids = all_violated;
    } else if (decision.reject_code === 'INVARIANT_VIOLATION') {
      // Record the invariant rule that fired (derived from reason for observability)
      violated_invariant_ids = ['enqueue_candidate:payload_invariant'];
    }

    const entry: GatewayAuditEntry = {
      schema_version: 'openclaw_gateway/0.1',
      request_id: req.request_id,
      submitted_at: req.submitted_at,
      evaluated_at: decision.evaluated_at,
      action: req.action as string,
      target: req.target,
      risk_level: req.risk_level,
      verdict: decision.verdict,
      reject_code: decision.reject_code,
      reason: decision.reason,
      justification: req.justification ?? null,
      ...(violated_invariant_ids !== undefined && { violated_invariant_ids }),
    };
    try {
      fs.appendFileSync(
        this.config.audit_log_path,
        JSON.stringify(entry) + '\n',
        'utf8'
      );
    } catch {
      // Non-fatal: audit write failure MUST NOT block gateway execution
    }
  }
}
