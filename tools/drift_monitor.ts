/**
 * tools/drift_monitor.ts
 *
 * DriftMonitor — 時系列ドリフト監視 (Phase B)
 * =============================================
 *
 * 目的:
 *   BenchmarkSandboxRunner が生成する実測値（saved_time_minutes_actual）を
 *   run ごとに蓄積し、5-run / 20-run の統計ウィンドウと OLS 回帰スロープで
 *   「静かな劣化（F-010_SILENT_DRIFT）」を検知する。
 *
 * アーキテクチャ上の位置づけ:
 *   A2 で「現実との接続」が完成した。  ← loop が 1 回完走するたびに record()
 *   B で「時間に耐える進化」を実装する。 ← compute() が trend/drift を返す
 *
 *   ┌──────────────────────────────────────────┐
 *   │  BenchmarkSandboxHandle.close()          │
 *   │    └▶ drift_monitor.record(entry)        │  ← A2 から B へのブリッジ
 *   └──────────────────────────────────────────┘
 *   ┌──────────────────────────────────────────┐
 *   │  phase14_live_fire (observation summary) │
 *   │    └▶ drift_monitor.compute(target_fn)   │  ← B の出力
 *   └──────────────────────────────────────────┘
 *
 * State ファイル:
 *   phase14/data/drift_state/<slug>.json
 *   最大 max_history エントリ（デフォルト 100）を保持し、古いものから削除する。
 *
 * 検知ロジック:
 *   主判定 (slope)  : OLS slope over last 20 valid runs < slope_drift_threshold
 *                    → trend = 'degrading', drift_detected = true (F-010_SILENT_DRIFT)
 *   副判定 (z-score): latest run's z-score vs window_5 < -zscore_drift_threshold
 *                    → sudden drop 検知（スロープが不足するほど長い安定期の後の急落）
 *
 *   閾値のデフォルト:
 *     slope_drift_threshold = -1e-6 (min/run)
 *       — 20 run で saved_time が 0.00002 min 減少 = 小サンプル 0.0001 の 20% 劣化
 *     zscore_drift_threshold = 2.5
 *       — window_5 の平均から 2.5σ 下がったら急落とみなす
 *
 *   どちらも保守的に設定してあり、オペレーターが DriftMonitorConfig で調整可能。
 *
 * 失敗コード:
 *   F-010_SILENT_DRIFT — 候補単体ではなくターゲット関数の時系列劣化を表す。
 *   既存コード体系:
 *     F-001_SECURITY_DOWNGRADE
 *     F-002_DEPENDENCY_IGNORE_DELETE
 *     F-003_CONTEXT_REGRESSION       ← 既存; 候補が既に失敗中の invariant を再踏み
 *     F-004_METRIC_INFLATION
 *     F-009_MEASUREMENT_ENV_INVALID
 *     F-010_SILENT_DRIFT             ← 今回追加; システムレベルの時系列劣化
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** 1 回の live-fire run で計測した記録。measurement_env_valid=true の場合のみ記録する。 */
export interface DriftRunEntry {
  /** live_fire run の run_id（LoopRunRecord の run_id） */
  run_id: string;

  /** BenchmarkProvenance.benchmark_run_id */
  benchmark_run_id: string;

  /**
   * BenchmarkProvenance.benchmark_signature (SHA-256 of bench script).
   * スクリプトが変わると変わるため、異なる signature をまたぐ比較には注意が必要。
   */
  benchmark_signature: string;

  /** ISO-8601 UTC */
  measured_at: string;

  /** saved_time_minutes_actual (measurement_env_valid=true の場合のみ記録) */
  saved_time_minutes_actual: number;

  /** その run における stability_index_score */
  stability_index_score: number;

  /** baseline_mean_ms - patched_mean_ms (null = baseline-only run) */
  delta_ms: number | null;

  /** delta_ms / baseline_mean_ms * 100 */
  delta_pct: number | null;
}

/** ターゲット関数ごとに disk に保存する状態ファイル */
export interface DriftState {
  schema_version: 'drift/0.1';
  target_function: string;
  slug: string;
  max_history: number;
  runs: DriftRunEntry[];
  created_at: string;
  last_updated: string;
}

/** 固定ウィンドウ（n 件）の基本統計 */
export interface WindowStats {
  n: number;
  mean: number;
  stddev: number;
  min: number;
  max: number;
  /** 中央値 (even n の場合は 2 中間値の平均) */
  p50: number;
}

/** compute() が返す純粋計算結果（disk に書かない） */
export interface DriftMetrics {
  target_function: string;
  n_total_runs: number;

  /** 直近 5 run の統計 (runs が 1 件以上ある場合のみ) */
  window_5: WindowStats | null;

  /** 直近 20 run の統計 (runs が 5 件以上ある場合のみ) */
  window_20: WindowStats | null;

  /**
   * OLS 回帰スロープ（直近 min(20, n) run、y = saved_time_minutes_actual, x = run index）
   * 単位: min/run
   * null = runs が min_runs_for_slope 未満
   */
  slope_20: number | null;

  trend: 'improving' | 'stable' | 'degrading' | 'insufficient_data';

  /** true ならドリフトが検知されており F-010_SILENT_DRIFT を発行すべき */
  drift_detected: boolean;

  /** drift_detected = true の場合のみ 'F-010_SILENT_DRIFT'; それ以外 null */
  drift_failure_code: 'F-010_SILENT_DRIFT' | null;

  /** 人間可読の理由文字列 */
  drift_reason: string | null;

  /** この DriftMetrics が計算された UTC ISO-8601 */
  computed_at: string;

  /**
   * 直近の benchmark_signature（複数の signature が混在している場合は警告）
   * 異なる signature をまたぐ比較は意味が変わる可能性がある。
   */
  latest_benchmark_signature: string | null;

  /** state が複数の benchmark_signature を含む場合 true */
  mixed_benchmark_signatures: boolean;
}

export interface DriftMonitorConfig {
  /**
   * 保持する最大 run 数（古い順に削除）
   * Default: 100
   */
  max_history?: number;

  /**
   * スロープ計算に最低限必要な run 数
   * Default: 5
   */
  min_runs_for_slope?: number;

  /**
   * slope_20 がこの値を下回ると drift_detected = true
   * 単位: min/run (負値)
   * Default: -1e-6
   */
  slope_drift_threshold?: number;

  /**
   * window_5 に対する latest run の z-score がこれを下回ると急落判定
   * Default: 2.5
   */
  zscore_drift_threshold?: number;
}

// ---------------------------------------------------------------------------
// DriftMonitor class
// ---------------------------------------------------------------------------

export class DriftMonitor {
  private readonly state_dir: string;
  private readonly config: Required<DriftMonitorConfig>;

  constructor(state_dir: string, config?: DriftMonitorConfig) {
    this.state_dir = state_dir;
    this.config = {
      max_history: 100,
      min_runs_for_slope: 5,
      slope_drift_threshold: -1e-6,
      zscore_drift_threshold: 2.5,
      ...config,
    };
    fs.mkdirSync(state_dir, { recursive: true });
  }

  // ── Path helpers ──────────────────────────────────────────────────────────

  private _slug(target_function: string): string {
    // filesystem-safe: replace non-alphanumeric runs with _; truncate to 80 chars
    return target_function.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_|_$/g, '').slice(0, 80);
  }

  private _statePath(slug: string): string {
    return path.join(this.state_dir, `${slug}.json`);
  }

  // ── State I/O ─────────────────────────────────────────────────────────────

  private _load(target_function: string): DriftState {
    const slug = this._slug(target_function);
    const p = this._statePath(slug);
    if (!fs.existsSync(p)) {
      return {
        schema_version: 'drift/0.1',
        target_function,
        slug,
        max_history: this.config.max_history,
        runs: [],
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };
    }
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as DriftState;
    } catch {
      // Corrupted state → reset (data recovered at next record())
      return {
        schema_version: 'drift/0.1',
        target_function,
        slug,
        max_history: this.config.max_history,
        runs: [],
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };
    }
  }

  private _save(state: DriftState): void {
    const p = this._statePath(state.slug);
    fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
  }

  // ── Public: record ────────────────────────────────────────────────────────

  /**
   * Append a new run entry to the drift state.
   * MUST be called only when measurement_env_valid = true.
   * Trims the history to config.max_history (oldest entries removed).
   */
  record(target_function: string, entry: DriftRunEntry): void {
    const state = this._load(target_function);
    state.runs.push(entry);

    // Keep newest max_history entries
    if (state.runs.length > this.config.max_history) {
      state.runs = state.runs.slice(-this.config.max_history);
    }

    state.last_updated = new Date().toISOString();
    this._save(state);
  }

  // ── Public: compute ───────────────────────────────────────────────────────

  /**
   * Pure computation: reads state from disk and derives DriftMetrics.
   * Does NOT modify any state file.
   */
  compute(target_function: string): DriftMetrics {
    const state = this._load(target_function);
    const runs = state.runs;
    const n = runs.length;
    const now = new Date().toISOString();

    // --- Benchmark signature analysis ---
    const signatures = new Set(runs.map((r) => r.benchmark_signature));
    const latest_sig = runs[n - 1]?.benchmark_signature ?? null;
    const mixed_signatures = signatures.size > 1;

    if (n === 0) {
      return {
        target_function,
        n_total_runs: 0,
        window_5: null,
        window_20: null,
        slope_20: null,
        trend: 'insufficient_data',
        drift_detected: false,
        drift_failure_code: null,
        drift_reason: null,
        computed_at: now,
        latest_benchmark_signature: latest_sig,
        mixed_benchmark_signatures: false,
      };
    }

    // --- Window stats ---
    const window_5 = n >= 1 ? this._windowStats(runs.slice(-5)) : null;
    const window_20 = n >= this.config.min_runs_for_slope
      ? this._windowStats(runs.slice(-20))
      : null;

    // --- OLS slope (over last min(20, n) runs) ---
    const slope_window = runs.slice(-20);
    const slope_20 = slope_window.length >= this.config.min_runs_for_slope
      ? this._olsSlope(slope_window.map((r) => r.saved_time_minutes_actual))
      : null;

    // --- Trend and drift detection ---
    let trend: DriftMetrics['trend'] = 'insufficient_data';
    let drift_detected = false;
    let drift_reason: string | null = null;
    const thresh = this.config.slope_drift_threshold; // negative number

    if (slope_20 !== null) {
      if (slope_20 < thresh) {
        trend = 'degrading';
        drift_detected = true;
        drift_reason =
          `slope_20=${slope_20.toExponential(3)} < threshold=${thresh.toExponential(3)} (min/run)`;
      } else if (slope_20 > Math.abs(thresh)) {
        trend = 'improving';
      } else {
        trend = 'stable';
      }
    }

    // --- Secondary: z-score sudden-drop check (window_5, needs ≥ 3 valid runs) ---
    if (!drift_detected && window_5 !== null && window_5.n >= 3 && window_5.stddev > 0) {
      const latest_val = runs[n - 1]?.saved_time_minutes_actual;
      if (latest_val !== undefined) {
        const z = (latest_val - window_5.mean) / window_5.stddev;
        if (z < -this.config.zscore_drift_threshold) {
          drift_detected = true;
          trend = 'degrading';
          drift_reason =
            `sudden_drop: z=${z.toFixed(2)} < -${this.config.zscore_drift_threshold} ` +
            `(window5.mean=${window_5.mean.toExponential(3)}, latest=${latest_val.toExponential(3)})`;
        }
      }
    }

    return {
      target_function,
      n_total_runs: n,
      window_5,
      window_20,
      slope_20,
      trend,
      drift_detected,
      drift_failure_code: drift_detected ? 'F-010_SILENT_DRIFT' : null,
      drift_reason,
      computed_at: now,
      latest_benchmark_signature: latest_sig,
      mixed_benchmark_signatures: mixed_signatures,
    };
  }

  /**
   * Read the persisted DriftState for a target function.
   * Returns null when no state file exists yet.
   * Callers use this to inspect raw run history (e.g., for rollback suggestions).
   */
  getState(target_function: string): DriftState | null {
    const slug = this._slug(target_function);
    const p = this._statePath(slug);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as DriftState;
    } catch {
      return null;
    }
  }

  /**
   * Compute drift metrics for every target_function that has a state file.
   * Useful for live_fire observation summary.
   */
  computeAll(): DriftMetrics[] {
    let entries: string[];
    try {
      entries = fs.readdirSync(this.state_dir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    return entries.flatMap((filename) => {
      try {
        const state = JSON.parse(
          fs.readFileSync(path.join(this.state_dir, filename), 'utf8')
        ) as DriftState;
        return [this.compute(state.target_function)];
      } catch {
        return [];
      }
    });
  }

  // ── Private: statistics ───────────────────────────────────────────────────

  private _windowStats(runs: DriftRunEntry[]): WindowStats {
    const vals = runs.map((r) => r.saved_time_minutes_actual);
    const n = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);
    const sorted = [...vals].sort((a, b) => a - b);
    // Median: even → average of two middle; odd → middle
    const p50 =
      n % 2 === 0
        ? ((sorted[n / 2 - 1] ?? 0) + (sorted[n / 2] ?? 0)) / 2
        : (sorted[Math.floor(n / 2)] ?? mean);
    return {
      n,
      mean,
      stddev,
      min: sorted[0] ?? mean,
      max: sorted[n - 1] ?? mean,
      p50,
    };
  }

  /**
   * Ordinary Least Squares slope.
   * y_i = values[i], x_i = i (0-indexed)
   * slope = (n * Σ(i * y_i) - Σ(i) * Σ(y_i)) / (n * Σ(i²) - (Σ(i))²)
   */
  private _olsSlope(values: number[]): number | null {
    const n = values.length;
    if (n < 2) return null;
    let sum_i = 0, sum_y = 0, sum_iy = 0, sum_i2 = 0;
    for (let i = 0; i < n; i++) {
      const y = values[i] ?? 0;
      sum_i += i;
      sum_y += y;
      sum_iy += i * y;
      sum_i2 += i * i;
    }
    const denom = n * sum_i2 - sum_i * sum_i;
    if (denom === 0) return 0;
    return (n * sum_iy - sum_i * sum_y) / denom;
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers (used by live_fire observation summary)
// ---------------------------------------------------------------------------

/**
 * Format a DriftMetrics record as a human-readable multi-line string
 * for inclusion in observation_summary.md.
 */
export function formatDriftReport(metrics: DriftMetrics): string {
  const lines: string[] = [];
  const trendEmoji = {
    improving: '↑',
    stable: '→',
    degrading: '↓',
    insufficient_data: '?',
  }[metrics.trend];

  lines.push(`### Drift Report: ${metrics.target_function}`);
  lines.push(`trend: ${trendEmoji} ${metrics.trend}  |  n_runs: ${metrics.n_total_runs}`);

  if (metrics.window_5) {
    const w = metrics.window_5;
    lines.push(
      `window_5 (n=${w.n}): mean=${w.mean.toExponential(3)} p50=${w.p50.toExponential(3)} ` +
      `stddev=${w.stddev.toExponential(2)} [${w.min.toExponential(2)}, ${w.max.toExponential(2)}]`
    );
  }
  if (metrics.window_20) {
    const w = metrics.window_20;
    lines.push(
      `window_20 (n=${w.n}): mean=${w.mean.toExponential(3)} p50=${w.p50.toExponential(3)} ` +
      `stddev=${w.stddev.toExponential(2)} [${w.min.toExponential(2)}, ${w.max.toExponential(2)}]`
    );
  }
  if (metrics.slope_20 !== null) {
    lines.push(`slope_20: ${metrics.slope_20.toExponential(3)} min/run`);
  }

  if (metrics.drift_detected) {
    lines.push(`[DRIFT DETECTED] ${metrics.drift_failure_code}: ${metrics.drift_reason}`);
  }

  if (metrics.mixed_benchmark_signatures) {
    lines.push(
      `[WARN] mixed benchmark_signatures detected — cross-version comparison may be unreliable.`
    );
  }
  if (metrics.latest_benchmark_signature) {
    lines.push(`latest_sig: ${metrics.latest_benchmark_signature.slice(0, 16)}...`);
  }

  return lines.join('\n');
}
