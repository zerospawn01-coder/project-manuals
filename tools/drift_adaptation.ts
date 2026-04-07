/**
 * tools/drift_adaptation.ts
 *
 * DriftAdaptationEngine — Phase D: Automatic Adaptation
 * ======================================================
 *
 * 目的:
 *   DriftMonitor.computeAll() の結果（DriftMetrics[]）を受け取り、
 *   今サイクルの自動適応決定（DriftAdaptationDecision）を純粋計算で返す。
 *
 * 適応の3軸:
 *   1. Promotion Gate 強化
 *      drift_status = 'DEGRADING' → promotion_blocked = true
 *      → nightly_loop_runner が Phase C を迂回し DRIFT_PROMOTION_BLOCK を発行
 *
 *   2. 探索率制御
 *      degrading が 1 件以上 → max_candidates_override = 1
 *                              blast_radius_ceiling = 'SELF'
 *      (次サイクルの NightlyLoopConfig.max_candidates に適用 / Phase A に hint として渡す)
 *
 *   3. Rollback 提案生成
 *      各 degrading ターゲットについて、DriftState の run 履歴から
 *      「最後の安定 run」を特定し RollbackSuggestion を生成。
 *      UI で表示するだけ（自動 rollback は不実施）。
 *
 * 設計方針:
 *   - このファイルは純粋関数 + 1 つの副作用（DriftMonitor.getState() 呼び出し）のみ。
 *   - NightlyLoopContext や LedgerStore には触れない。
 *   - 誤検知を避けるため、n_runs >= 5 で drift_detected = true の場合のみブロック。
 *   - rollback_suggestions はあくまで情報提供 — 自動適用しない。
 *
 * Failure code this module triggers:
 *   DRIFT_PROMOTION_BLOCK (BlockedRiskyActionCode) — SYS-04 相当の門番
 */

import type { DriftMonitor, DriftMetrics } from './drift_monitor';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Rollback candidate for one degrading target function.
 * The "last good run" is the most recent run whose actual value was ≥ window_5.mean.
 * If no such run exists in history, last_good_* fields are null.
 */
export interface RollbackSuggestion {
  target_function: string;

  /** run_id of the last good run (saved_time_minutes >= window_5_mean). */
  last_good_run_id: string | null;

  /** benchmark_signature at the last good run. */
  last_good_benchmark_signature: string | null;

  /** saved_time_minutes_actual at the last good run. */
  last_good_saved_time_minutes: number | null;

  /** ISO-8601 UTC timestamp of the last good run. */
  last_good_measured_at: string | null;

  /** Human-readable explanation for the morning screen. */
  reason: string;
}

/**
 * The complete set of automatic adaptation decisions for one cycle.
 *
 * Computed once by computeDriftAdaptation() before Phase C (PROMOTING).
 * Stored in MorningResult.drift.adaptation for operator visibility.
 *
 * Semantics:
 *   promotion_blocked = true  → this cycle's promotions are all DEFERRED_STABILITY
 *   max_candidates_override   → apply to next cycle's NightlyLoopConfig.max_candidates
 *   blast_radius_ceiling      → apply to next cycle's PhaseBConfig.max_allowed_blast_radius
 */
export interface DriftAdaptationDecision {
  schema_version: 'drift_adaptation/0.1';
  computed_at: string;

  // ── 1. Promotion Gate ────────────────────────────────────────────────────

  /**
   * true when drift_status = 'DEGRADING' AND at least one target has n_runs >= 5.
   * Guards against premature blocking on insufficient data.
   */
  promotion_blocked: boolean;

  /** Human-readable reason for the block (or null when not blocked). */
  promotion_blocked_reason: string | null;

  // ── 2. Exploration Control (next cycle hints) ────────────────────────────

  /**
   * Reduce to 1 when any target is degrading.
   * null = no override (stable / improving / insufficient data).
   *
   * This is a HINT for next cycle; the nightly loop runner applies it when
   * reading the previous MorningResult's drift.adaptation.
   */
  max_candidates_override: number | null;

  /**
   * Cap blast_radius at 'SELF' to minimise surface when degrading.
   * null = no override.
   *
   * Applied as PhaseBConfig.max_allowed_blast_radius next cycle.
   * Uses Phase B's blast radius vocabulary: 'SELF' | 'TENANT' | 'GLOBAL'.
   */
  blast_radius_ceiling: 'SELF' | 'TENANT' | 'GLOBAL' | null;

  // ── 3. Rollback Suggestions ── ───────────────────────────────────────────

  /** One entry per target_function where drift_detected = true. */
  rollback_suggestions: RollbackSuggestion[];
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Find the "last good run" for a degrading target — the most recent run
 * whose saved_time_minutes_actual >= (window_5 mean - 0.5 * stddev).
 *
 * Reads DriftState via drift_monitor.getState() which does disk I/O.
 */
function buildRollbackSuggestion(
  metrics: DriftMetrics,
  drift_monitor: DriftMonitor
): RollbackSuggestion {
  const state = drift_monitor.getState(metrics.target_function);

  if (!state || state.runs.length === 0) {
    return {
      target_function: metrics.target_function,
      last_good_run_id: null,
      last_good_benchmark_signature: null,
      last_good_saved_time_minutes: null,
      last_good_measured_at: null,
      reason: `Degrading (slope=${metrics.slope_20?.toExponential(2) ?? '?'}/run); no history available for rollback.`,
    };
  }

  // Threshold: anything above (mean - 0.5σ) is considered "good"
  const w5_mean = metrics.window_5?.mean ?? 0;
  const w5_stddev = metrics.window_5?.stddev ?? 0;
  const stability_threshold = w5_mean - 0.5 * w5_stddev;

  // Scan history newest→oldest; pick the first run above threshold
  const runs_desc = [...state.runs].reverse();
  const good_run = runs_desc.find(
    (r) => r.saved_time_minutes_actual >= stability_threshold
  ) ?? null;

  const slope_str = metrics.slope_20 !== null ? metrics.slope_20.toExponential(2) : '?';
  const reason = good_run
    ? `Degrading (slope=${slope_str}/run). Last stable run at ${good_run.measured_at.slice(0, 10)}.`
    : `Degrading (slope=${slope_str}/run). No stable run found in history (${state.runs.length} runs).`;

  return {
    target_function: metrics.target_function,
    last_good_run_id: good_run?.run_id ?? null,
    last_good_benchmark_signature: good_run?.benchmark_signature ?? null,
    last_good_saved_time_minutes: good_run?.saved_time_minutes_actual ?? null,
    last_good_measured_at: good_run?.measured_at ?? null,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Compute adaptation decisions from the current drift metrics.
 *
 * @param drift_metrics  Output of DriftMonitor.computeAll() for this cycle.
 * @param drift_monitor  Used only to call getState() for rollback suggestions.
 * @returns DriftAdaptationDecision | null when no drift_metrics provided.
 */
export function computeDriftAdaptation(
  drift_metrics: DriftMetrics[],
  drift_monitor: DriftMonitor
): DriftAdaptationDecision {
  const computed_at = new Date().toISOString();

  // Only consider targets with sufficient data (n_runs >= 5) for decisions
  const significant = drift_metrics.filter((m) => m.n_total_runs >= 5);
  const degrading = significant.filter((m) => m.drift_detected);

  // ── 1. Promotion Gate ─────────────────────────────────────────────────
  const promotion_blocked = degrading.length > 0;
  const promotion_blocked_reason = promotion_blocked
    ? `F-010_SILENT_DRIFT on ${degrading.length} target(s): ` +
      degrading.map((m) => m.target_function.split('.').pop() ?? m.target_function).join(', ')
    : null;

  // ── 2. Exploration Control ────────────────────────────────────────────
  const max_candidates_override = degrading.length > 0 ? 1 : null;
  const blast_radius_ceiling: DriftAdaptationDecision['blast_radius_ceiling'] =
    degrading.length > 0 ? 'SELF' : null;

  // ── 3. Rollback Suggestions ───────────────────────────────────────────
  const rollback_suggestions: RollbackSuggestion[] = degrading.map((m) =>
    buildRollbackSuggestion(m, drift_monitor)
  );

  return {
    schema_version: 'drift_adaptation/0.1',
    computed_at,
    promotion_blocked,
    promotion_blocked_reason,
    max_candidates_override,
    blast_radius_ceiling,
    rollback_suggestions,
  };
}
