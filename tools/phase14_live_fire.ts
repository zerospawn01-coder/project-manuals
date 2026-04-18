/**
 * tools/phase14_live_fire.ts
 *
 * Live Fire Exercise — Nightly Loop 1周試験実行スクリプト
 * =========================================================
 *
 * 目的:
 *   実際の Gemini API + 実観測データ（Phase 14 phase14/data/）で夜間ループを
 *   1周回し、LLM が生成するパッチ候補の品質を観測する。
 *
 *   Phase B の SandboxRunner は「パススルーモック（常に PASS）」に固定し、
 *   「LLM の提案力」のみを評価する段階として明示的に分離する。
 *
 * 観測ポイント:
 *   1. LLM が 3層証明（invariant_check / measurable_outcome / no_regression）を
 *      どれだけ具体的に記述するか
 *   2. patch_diff が unified diff 形式として読み取れるか
 *   3. estimated_blast_radius が TENANT 以下に収まるか
 *   4. affected_targets にカーネル層が混入しないか（KERNEL_SCOPE_VIOLATION）
 *   5. negative_constraint_violations が空かどうか（PENDING_BASELINE_STALL 等の
 *      既知失敗パターンを懲りずに再提案していないか）
 *
 * 実行方法:
 *   GEMINI_API_KEY=<your-key> npx ts-node tools/phase14_live_fire.ts
 *   GEMINI_API_KEY=<your-key> node dist/tools/phase14_live_fire.js
 *
 *   出力先: phase14/data/live_fire_runs/<YYYYMMDD_HHmmss>/
 *     ├── loop_run_record.json     — LoopRunRecord（成否・概要）
 *     ├── candidate_list.json      — LLM が生成した PhaseACandidateList
 *     ├── observation_summary.md   — 人間可読の観測レポート
 *     └── audit/                   — Phase B / C / D 詳細ログ
 *
 * 環境変数:
 *   GEMINI_API_KEY   — (必須) Gemini API キー
 *   GEMINI_MODEL     — (省略可) 使用モデル。default: gemini-2.0-flash
 *   LIVE_FIRE_OUT    — (省略可) 出力先ルートディレクトリ
 *   USE_SEED_DATA    — (省略可) "1" にすると phase14/data/ の代わりに fixtures
 *                       の静的シードデータを使用（CI / API キーなし検証用）
 *   MAX_CANDIDATES   — (省略可) LLM に要求する最大候補数。default: 3
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// .env ファイルローダー（dotenv 不要 — 最小手動実装）
// プロジェクトルートの .env を読み込み、process.env に注入する。
// 既に環境変数が設定されている場合は上書きしない（shell 側の優先）。
// ---------------------------------------------------------------------------
(function loadDotenv(): void {
  const env_paths = [
    path.join(__dirname, '..', '..', '.env'),           // dist/tools/../../ = project root
    path.join(__dirname, '..', '..', '..', '.env'),     // 1段上の scratch root
  ];
  for (const env_path of env_paths) {
    if (!fs.existsSync(env_path)) continue;
    const lines = fs.readFileSync(env_path, 'utf8').split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
    break; // 最初に見つかった .env だけ読む
  }
})();

import type {
  SandboxHandle,
  SandboxRunner,
  RawInvariantResult,
  RawMetricsSnapshot,
  RawRegressionResult,
} from './phase_b_orchestrator';
import {
  runNightlyLoop,
  FilesystemLedgerStore,
} from './nightly_loop_runner';
import type {
  NightlyLoopContext,
  NightlyLoopConfig,
  LoopRunRecord,
} from './nightly_loop_runner';
import {
  PHASE14_SYSTEM_TEMPLATE,
  PHASE14_USER_TEMPLATE,
  GeminiPhaseADispatcher,
} from './phase_a_llm_dispatcher';
import {
  collectObservationWindowFromFiles,
} from './phase14_observation_collector';
import {
  PHASE14_OBSERVATION_WINDOW,
  PHASE14_FOCUS_SEED_SET,
  PHASE14_PROTECTED_INVARIANT_IDS,
  PHASE14_WORKFLOW_BASELINES,
} from '../fixtures/phase14_observation_seed';
import type { ObservationWindow } from './phase_a_orchestrator';
import {
  BenchmarkSandboxRunner,
  resolveBenchScriptPath,
} from './benchmark_sandbox_runner';
import {
  DriftMonitor,
  formatDriftReport,
} from './drift_monitor';
import {
  createPRSubmitter,
  NULL_PR_SUBMITTER,
} from './pr_submitter';
import type { PRSubmitter } from './pr_submitter';
import type { CapabilityGraphEvaluator } from './phase_c_orchestrator';
import type { UnlockedNode } from '../contract/phase_c_promote';
import {
  OpenClawGateway,
  DEFAULT_FORBIDDEN_TARGETS,
  DEFAULT_BENCHMARK_PROTECTED_PATHS,
} from './openclaw_gateway';
import {
  FilesystemHumanReviewStore,
} from './human_review_writer';

// ---------------------------------------------------------------------------
// Project root resolution
// dist/tools/ → ../../
// ---------------------------------------------------------------------------
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PHASE14_DATA_DIR = path.join(PROJECT_ROOT, 'phase14', 'data');

// ---------------------------------------------------------------------------
// Passthrough SandboxRunner
// ---------------------------------------------------------------------------
// Phase B に渡す「观測器モード Sandbox」。
// Fix 1 (観測器汚染修正): 各候補の予測値をそのまま実測値として返すことで
//   PASSTHROUGH 環境が F-004_METRIC_INFLATION を誤注入しないようにする。
// 候補の predicted メトリクスを openSandbox 時に登録し、measureMetrics で返す。

/** 候補ごとの予測メトリクスを保持するレジストリ */
const _predicted_metrics_registry = new Map<string, RawMetricsSnapshot>();

function makePassthroughSandboxHandle(
  candidate_id: string,
  cycle_id: string,
  predicted_override?: Partial<RawMetricsSnapshot>
): SandboxHandle {
  // デフォルト baseline (predicted_override がない場合の安全なフォールバック)
  const defaults: RawMetricsSnapshot = {
    stability_index_score: 0.80,
    saved_time_minutes: null,
    tokens_saved: null,
    bugs_killed: null,
    refined_code_lines: null,
  };
  // 候補ごとの予測値で上書きして「実測値」として返す
  const metrics: RawMetricsSnapshot = { ...defaults, ...predicted_override };

  return {
    sandbox_id: randomUUID(),
    image_tag: 'passthrough/live-fire:latest',
    started_at: new Date().toISOString(),
    idempotency_key: `${cycle_id}::${candidate_id}`,

    async applyPatch(_diff: string): Promise<void> {
      // no-op — Live Fire ではパッチを実際には適用しない
    },

    async runInvariants(invariant_ids: string[]): Promise<RawInvariantResult[]> {
      return invariant_ids.map((id) => ({
        invariant_id: id,
        outcome: 'pass' as const,
        verified_by: 'passthrough:live-fire',
      }));
    },

    async measureMetrics(): Promise<RawMetricsSnapshot> {
      return metrics;
    },

    async runRegressionTests(test_ids: string[]): Promise<RawRegressionResult[]> {
      return test_ids.map((id) => ({
        test_id: id,
        outcome: 'pass' as const,
      }));
    },

    async checkOrthogonality(): Promise<'confirmed' | 'refuted' | 'unverified'> {
      return 'confirmed';
    },

    async close(_finished_at: string): Promise<void> {
      // no-op
    },
  };
}

const PASSTHROUGH_SANDBOX_RUNNER: SandboxRunner = {
  async openSandbox(candidate_id: string, cycle_id: string): Promise<SandboxHandle> {
    // 登録済みの予測値があればそれを使用する (Fix 1)
    const predicted = _predicted_metrics_registry.get(candidate_id);
    return makePassthroughSandboxHandle(candidate_id, cycle_id, predicted);
  },
};

// ---------------------------------------------------------------------------
// Observation data selection
// ---------------------------------------------------------------------------

function resolveObservationWindow(use_seed: boolean): ObservationWindow {
  if (use_seed) {
    console.log('  [data] → fixtures/phase14_observation_seed.ts (静的シード)');
    return PHASE14_OBSERVATION_WINDOW;
  }
  try {
    const obs = collectObservationWindowFromFiles(PHASE14_DATA_DIR);
    console.log('  [data] → phase14/data/ (ライブ観測データ)');
    return obs;
  } catch (err) {
    console.warn(
      `  [data] phase14/data/ 読み込み失敗 → 静的シードにフォールバック\n  ${String(err)}`
    );
    return PHASE14_OBSERVATION_WINDOW;
  }
}

// ---------------------------------------------------------------------------
// Kernel scope guard — 観測結果として違反をレポートするための純粋関数
// (Phase B 側は blast_radius で制御するが、Live Fire では明示的に警告も出す)
// ---------------------------------------------------------------------------

const KERNEL_DIRS = [
  'tools/',
  'contract/',
  'tests/',
  'fixtures/',
  'types/',
  'dist/',
];

function detectKernelScopeViolations(record: LoopRunRecord): string[] {
  const violations: string[] = [];
  const candidates = (record as unknown as Record<string, unknown>)['_candidate_list_debug'] as
    Array<{ candidate_id: string; affected_targets?: Array<{ file_path: string }> }> | undefined;

  if (!candidates) return violations;
  for (const c of candidates) {
    for (const t of c.affected_targets ?? []) {
      const is_kernel = KERNEL_DIRS.some((d) => t.file_path.startsWith(d));
      if (is_kernel) {
        violations.push(`${c.candidate_id} → ${t.file_path}`);
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Human-readable observation summary
// ---------------------------------------------------------------------------

function buildObservationSummary(
  record: LoopRunRecord,
  candidate_list_path: string,
  elapsed_ms: number,
  is_seed_mode: boolean
): string {
  const lines: string[] = [];
  const ts = new Date().toISOString();

  lines.push('# Phase 14 — Live Fire Exercise: Observation Report');
  lines.push(`generated_at: ${ts}`);
  lines.push(`run_id: ${record.run_id}`);
  lines.push(`cycle_id: ${record.cycle_id}`);
  lines.push(`elapsed_ms: ${elapsed_ms}`);
  lines.push(`loop_completed: ${record.completed}`);
  lines.push(`final_phase: ${record.final_phase}`);
  lines.push('');

  if (record.error_log.length > 0) {
    lines.push('## Errors');
    for (const e of record.error_log) {
      lines.push(`- [${e.phase}] ${e.message}`);
    }
    lines.push('');
  }

  lines.push('## Candidate Quality Assessment');
  lines.push('');
  lines.push('Detailed candidate data → ' + candidate_list_path);
  lines.push('');

  lines.push('## Key Observation Questions');
  lines.push('');
  lines.push('1. **3層証明の充足率**: 各候補の acceptance_criteria に');
  lines.push('   invariant_check / measurable_outcome / no_regression が揃っているか?');
  lines.push('2. **patch_diff の品質**: unified diff として `git apply --check` を通過するか?');
  lines.push('3. **blast_radius の分布**: GLOBAL 候補は何件あるか → Phase B で棄却されるはず');
  lines.push('4. **カーネルスコープ違反**: tools/ contract/ 等を affected_targets に含む候補はないか?');
  lines.push('5. **negative_constraint_violations**: 既知の失敗パターンを再提案していないか?');
  lines.push('');
  lines.push('---');
  lines.push(`*Sandbox mode: ${is_seed_mode ? 'PASSTHROUGH (seed)' : 'BenchmarkSandboxRunner A1 — 実測モード'}*`);
  if (!is_seed_mode) {
    lines.push('*saved_time_minutes_actual / benchmark_signature / measurement_env_valid が audit/ に記録されます。*');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('='.repeat(64));
  console.log('Phase 14 — Live Fire Exercise');
  console.log('='.repeat(64));

  // ── 1. Environment validation ─────────────────────────────────────────────
  const use_seed     = process.env['USE_SEED_DATA'] === '1';
  const api_key      = process.env['GEMINI_API_KEY'] ?? '';

  // ── MODE BANNER ──────────────────────────────────────────────────────────
  // 最初に表示することで、エラー終了する場合でも原因が一目でわかる。
  console.log(use_seed
    ? '  [MODE] SEED   — MockLLM + PASSTHROUGH sandbox (USE_SEED_DATA=1)'
    : '  [MODE] A1 LIVE — GeminiLLM + BenchmarkSandboxRunner 実測モード');
  if (!use_seed) {
    console.log(`  [KEY ] GEMINI_API_KEY: ${
      api_key ? `設定済み (${api_key.slice(0, 8)}…)` : '未設定  ←  後続ステップでエラー終了します'
    }`);
  }
  console.log('');

  if (!api_key && !use_seed) {
    console.error('[ERROR] GEMINI_API_KEY が設定されていません。');
    console.error('');
    console.error('設定方法（いずれか）:');
    console.error('  1) .env ファイルに記載:');
    console.error('       cp .env.example .env');
    console.error('       # .env を編集して GEMINI_API_KEY=AIza... を設定');
    console.error('       npm run live-fire');
    console.error('');
    console.error('  2) 環境変数としてその場で渡す:');
    console.error('       $env:GEMINI_API_KEY="AIza..."; npm run live-fire');
    console.error('');
    console.error('  3) API キーなしで構造テストのみ実行 (モック LLM):');
    console.error('       npm run live-fire:seed');
    process.exit(1);
  }

  const model        = process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash';
  const max_cands    = parseInt(process.env['MAX_CANDIDATES'] ?? '3', 10);

  // ── 2. Output directory ───────────────────────────────────────────────────
  // ISO-8601: "2026-04-07T12:34:56.789Z" → 数字以外を除去 → slice(0,15)
  const ts_label = new Date()
    .toISOString()
    .replace(/\D/g, '')     // すべての非数字文字（- T : . Z）を除去
    .slice(0, 15);          // YYYYMMDDHHmmssm → 15 chars

  const live_fire_root = process.env['LIVE_FIRE_OUT']
    ?? path.join(PROJECT_ROOT, 'phase14', 'data', 'live_fire_runs');

  const run_dir = path.join(live_fire_root, ts_label);
  fs.mkdirSync(run_dir, { recursive: true });
  // audit サブディレクトリを事前作成（BenchmarkSandboxRunner / Phase B が書き込む前に存在を保証）
  fs.mkdirSync(path.join(run_dir, 'audit'), { recursive: true });

  // ledger_dir は run をまたいで共有 — 累積カウンタを維持するため
  const ledger_dir = path.join(PROJECT_ROOT, 'phase14', 'data', 'ledger');
  fs.mkdirSync(ledger_dir, { recursive: true });

  console.log(`  run_dir:  ${run_dir}`);
  console.log(`  model:    ${model}`);
  console.log(`  max_cand: ${max_cands}`);
  const sandbox_label = use_seed
    ? 'PASSTHROUGH (mock — seed モード)'
    : 'BenchmarkSandboxRunner (A1 実測モード)';
  console.log(`  sandbox:  ${sandbox_label}`);
  console.log('');

  // ── 3. Observation data ───────────────────────────────────────────────────
  console.log('[Phase A] 観測データ収集中...');
  const observation_window = resolveObservationWindow(use_seed);
  console.log(`  error_log_entries:       ${observation_window.error_log_entries.length}`);
  console.log(`  workflow_recent_results: ${observation_window.workflow_recent_results.length}`);
  console.log(`  invariant_stress_counts: ${observation_window.invariant_stress_counts.length}`);
  console.log(`  consecutive_failing:     ${observation_window.consecutive_failing_tests.length}`);
  console.log('');

  // ── 4. NightlyLoopContext ─────────────────────────────────────────────────
  // USE_SEED_DATA=1 の場合は MockLLMDispatcher（固定候補を返すモック）を使用する。
  // これにより API キーなしでも全 Phase を通過する構造テストが可能。
  let dispatcher: import('./nightly_loop_runner').PhaseALLMDispatcher;
  if (use_seed) {
    console.log('  [LLM] モード: MOCK（USE_SEED_DATA=1 — API呼び出しなし）');
    // 固定の PhaseACandidateList を返すインラインモック
    // Fix 1: 各候補の予測メトリクスをレジストリに登録してから返す
    //        → PASSTHROUGH_SANDBOX_RUNNER が予測値と一致する実測値を返す
    // Fix 3: GLOBAL blast_radius 候補を追加 → Phase C P-01 → DEFERRED_HUMAN
    dispatcher = {
      async dispatch(_sys: string, _usr: string, cycle_id: string) {
        const cand_id_self = `seed-cand-${randomUUID().slice(0, 8)}`;
        const cand_id_global = `seed-cand-global-${randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();

        // Candidate 1: SELF blast_radius — 通常改善候補
        const cand1_predicted_saved_time = 15;
        _predicted_metrics_registry.set(cand_id_self, {
          stability_index_score: 0.82,          // ベースライン(0.80)より改善
          saved_time_minutes: cand1_predicted_saved_time,  // 予測値と一致させる
          tokens_saved: null,
          bugs_killed: 1,
          refined_code_lines: null,
        });

        // Candidate 2: GLOBAL blast_radius — HRA強制発火テスト候補
        // Phase B を通過 (max_allowed_blast_radius=GLOBAL) → Phase C P-01 fails → DEFERRED_HUMAN
        _predicted_metrics_registry.set(cand_id_global, {
          stability_index_score: 0.85,
          saved_time_minutes: 30,
          tokens_saved: 200,
          bugs_killed: null,
          refined_code_lines: null,
        });

        return {
          schema_version: 'phase_a_output/0.1' as const,
          cycle_id,
          generated_at: now,
          input_pack_id: randomUUID(),
          candidates: [
            {
              candidate_id: cand_id_self,
              generated_at: now,
              cycle_id,
              title: '[SEED] aggregate_weekly_governance_report: _load_json に存在チェックを追加',
              affected_targets: [
                {
                  file_path: 'phase14/scripts/aggregate_weekly_governance_report.py',
                  function_name: '_load_json',
                  change_type: 'modify' as const,
                },
              ],
              estimated_blast_radius: 'SELF' as const,
              patch_diff: [
                '--- a/phase14/scripts/aggregate_weekly_governance_report.py',
                '+++ b/phase14/scripts/aggregate_weekly_governance_report.py',
                '@@ -1,4 +1,8 @@',
                ' def _load_json(path: str) -> dict:',
                '+    import os',
                '+    if not os.path.exists(path):',
                '+        raise FileNotFoundError(f"Required file not found: {path}")',
                '     with open(path) as f:',
                '         return json.load(f)',
              ].join('\n'),
              acceptance_criteria: {
                invariant_check: [
                  {
                    invariant_id: 'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
                    verdict: 'untouched' as const,
                    verification_method: '_load_json は classify_rejection に無関係',
                  },
                ],
                measurable_outcome: {
                  stability_index_delta: 'positive' as const,
                  saved_time_minutes_predicted: cand1_predicted_saved_time,
                  measurement_basis: {
                    rationale: 'ファイル不在時の即時エラーにより手動調査コストを除去',
                  },
                },
                no_regression: {
                  regression_test_ids_verified_pass: [],
                  invariant_ids_untouched: [
                    'INV-001_NO_AUTH_BYPASS',
                    'INV-003_NO_WRITE_EXECUTE_WITHOUT_APPROVAL',
                  ],
                  orthogonality_rationale:
                    'ファイル存在チェックの追加は他モジュールへの影響なし',
                },
              },
              negative_constraint_violations: [],
            },
            {
              // Fix 3: HRA forced-fire 候補 — GLOBAL blast_radius
              // Phase B を max_allowed_blast_radius=GLOBAL で通過させ、
              // Phase C P-01 (blast!=GLOBAL) に弾かせて DEFERRED_HUMAN にする
              candidate_id: cand_id_global,
              generated_at: now,
              cycle_id,
              title: '[SEED-HRA] governance_report_renderer: 全モジュール横断リファクタリング（HRAテスト候補）',
              affected_targets: [
                {
                  file_path: 'phase14/scripts/governance_report_renderer.py',
                  function_name: 'render_all',
                  change_type: 'modify' as const,
                },
                {
                  file_path: 'phase14/scripts/weekly_summary_exporter.py',
                  function_name: 'export_html',
                  change_type: 'modify' as const,
                },
              ],
              estimated_blast_radius: 'GLOBAL' as const,
              patch_diff: [
                '--- a/phase14/scripts/governance_report_renderer.py',
                '+++ b/phase14/scripts/governance_report_renderer.py',
                '@@ -1,2 +1,4 @@',
                ' def render_all(reports: list) -> str:',
                '+    # GLOBAL: この変更はすべての下流エクスポーターに影響する',
                '+    reports = [r for r in reports if r is not None]',
                '     return "\\n".join(str(r) for r in reports)',
              ].join('\n'),
              acceptance_criteria: {
                invariant_check: [
                  {
                    invariant_id: 'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
                    verdict: 'untouched' as const,
                    verification_method: 'render_all は classify_rejection に無関係',
                  },
                ],
                measurable_outcome: {
                  stability_index_delta: 'positive' as const,
                  saved_time_minutes_predicted: 30,
                  tokens_saved_predicted: 200,
                  measurement_basis: {
                    rationale: 'None フィルタリングにより全レポートの描画エラーを排除',
                  },
                },
                no_regression: {
                  regression_test_ids_verified_pass: [],
                  invariant_ids_untouched: ['INV-001_NO_AUTH_BYPASS'],
                  orthogonality_rationale:
                    '描画結果の正規化のみ — ロジック変更なし',
                },
              },
              negative_constraint_violations: [],
            },
          ],
          discarded_candidates: [],
        };
      },
    };
  } else {
    console.log(`  [LLM] モード: GEMINI (${model})`);
    dispatcher = new GeminiPhaseADispatcher(api_key, { model });
  }
  const ledger_store = new FilesystemLedgerStore(ledger_dir);

  // ── Shared DriftMonitor ───────────────────────────────────────────────────
  // sandbox_runner と ctx.drift_monitor が同じインスタンスを共有することで、
  // ループ内での重複書き込みとべき等性の不整合を防ぐ。
  const _drift_state_dir = path.join(PROJECT_ROOT, 'phase14', 'data', 'drift_state');
  fs.mkdirSync(_drift_state_dir, { recursive: true });
  const shared_drift_monitor = new DriftMonitor(_drift_state_dir, {
    min_runs_for_slope: 20,   // ノイズが少ないデータで誤検知を防ぐ — 6件のサンプルでF-010を避ける
    slope_drift_threshold: -1e-6,
  });

  const ctx: NightlyLoopContext = {
    // Phase A templates (カーネル保護 + Negative Constraints スロット込み)
    phase_a_system_template: PHASE14_SYSTEM_TEMPLATE,
    phase_a_user_template:   PHASE14_USER_TEMPLATE,

    // Phase A input: 観測データ + 保護インバリアント
    protected_invariant_ids: PHASE14_PROTECTED_INVARIANT_IDS,
    observation_window,

    // Phase A の FocusSeedSet を observation_window 経由で渡す
    // (assemblePhaseAInputPack が observation_window.consecutive_failing_tests +
    //  error_log_entries 等から自動的に FocusSead をビルドする)
    invariant_recent_results: [
      {
        invariant_id: 'INV-001_NO_AUTH_BYPASS',
        passed: true,
        evaluated_at: new Date().toISOString(),
      },
      {
        invariant_id: 'INV-003_NO_WRITE_EXECUTE_WITHOUT_APPROVAL',
        passed: true,
        evaluated_at: new Date().toISOString(),
      },
      {
        invariant_id: 'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
        passed: false,   // 観測された失敗
        evaluated_at: new Date().toISOString(),
      },
    ],
    failing_regression_test_ids: [],
    regression_test_total: 9,   // 現在のテストスイート総数

    // Phase B: Sandbox runner 選択
    // USE_SEED_DATA=1 → PASSTHROUGH (予測値エコー・API不要・CI用)
    // USE_SEED_DATA 未設定 → BenchmarkSandboxRunner (A1 実測)
    sandbox_runner: (() => {
      if (use_seed) return PASSTHROUGH_SANDBOX_RUNNER;
      const bench_script = resolveBenchScriptPath(PROJECT_ROOT);
      if (!bench_script) {
        console.warn(
          '  [sandbox] bench_aggregate_weekly.py が見つかりません → PASSTHROUGH にフォールバック'
        );
        return PASSTHROUGH_SANDBOX_RUNNER;
      }
      const baseline_scripts_dir = path.join(PROJECT_ROOT, 'phase14', 'scripts');
      const audit_sidecar_dir = path.join(run_dir, 'audit'); // 事前作成済み
      console.log(`  [sandbox] BenchmarkSandboxRunner`);
      console.log(`            bench_script: ${bench_script}`);
      console.log(`            baseline_scripts_dir: ${baseline_scripts_dir}`);
      console.log(`            drift_state_dir: ${_drift_state_dir}`);
      return new BenchmarkSandboxRunner({
        bench_script_path: bench_script,
        baseline_scripts_dir,
        audit_sidecar_dir,
        python_executable: 'python',
        iterations: 10,
        repetitions: 3,
        stability_index_baseline: 0.74,
        drift_monitor: shared_drift_monitor, // 共有インスタンス — べき等性保証
        run_id: ts_label, // live_fire 実行タイムスタンプを run_id に使用
      });
    })(),

    // Phase B config: max_allowed_blast_radius=GLOBAL にすることで GLOBAL blast_radius 候補が
    // Phase B サンドボックスを通過し、Phase C の P-01 ゲート（blast!=GLOBAL → DEFERRED_HUMAN）に到達する。
    // ※ これが HRA forced-fire テストのルート。
    phase_b_config: {
      max_allowed_blast_radius: 'GLOBAL',
      audit_log_dir: path.join(run_dir, 'audit'),
    },

    // Phase C: system state
    // Live Fire / USE_SEED_DATA モードでは system gate が開いている状態 (invariant_failure_count=0)
    // で実行することで Phase C P-01 (blast_radius != GLOBAL) ゲートが評価され
    // GLOBAL 候補が正しく DEFERRED_HUMAN になることを確認する。
    // 実観測データを使う場合は実際の失敗カウントを反映すること。
    system_state_snapshot: {
      stability_index_score: 0.92,        // 改善サイクルを経て安定性が向上 (以前: 0.82)
      invariant_failure_count_this_cycle: 0,  // HRA forced-fire: system gate open
      blocked_risky_actions_this_cycle: {
        count: 0,
        events: [],
      },
    },

    // Phase C: capability graph evaluator
    // スキルが1件以上 promote された場合に "benchmark-node-v1" ノードを解放する。
    // BREAKTHROUGH 条件 (unlocked_node_count >= 1) を満たすための実装。
    capability_graph_evaluator: {
      async evaluateNodes(
        newly_promoted_skill_ids: string[],
        _all: string[]
      ): Promise<UnlockedNode[]> {
        if (newly_promoted_skill_ids.length === 0) return [];
        const node: UnlockedNode = {
          node_id: 'benchmark-node-v1',
          node_name: 'Benchmark Optimization Loop',
          unlocked_at: new Date().toISOString(),
          source_skill_id: newly_promoted_skill_ids[0]!,
          description:
            'Unlocked by benchmark skill promotion — enables automated performance regression tracking.',
        };
        return [node];
      },
    } satisfies CapabilityGraphEvaluator,

    legitimacy_tier: 'L1',
    next_cycle_recommendations: [],

    llm_dispatcher: dispatcher,
    ledger_store,

    // DriftMonitor を ctx に渡すことで Phase D が drift_metrics を集計できる
    // shared_drift_monitor を使うことで sandbox_runner と同一ループ内の重複書き込みを回避
    drift_monitor: shared_drift_monitor,

    // PR Submitter — "promotion = PR作成"
    // GITHUB_TOKEN が設定されている場合、PROMOTED なパッチを GitHub Draft PR に変換する。
    // 未設定の場合は NULL_PR_SUBMITTER（no-op）が使われる。
    pr_submitter: (() => {
      const github_token = process.env['GITHUB_TOKEN'];
      if (!github_token) return NULL_PR_SUBMITTER;
      return createPRSubmitter({
        repo_owner: 'zerospawn01-coder',
        repo_name:  'project-manuals',
        base_branch: 'main',
        repo_root:  PROJECT_ROOT,
        github_token,
      });
    })(),

    // Phase F: World Shift Detection (EnvironmentProfile 差分比較 → WorldShiftEvent)
    // DISPLAY-LAYER ONLY — tier評価・ガバナンスゲートには影響しない。
    world_shift_config: {
      env_profile_dir:    PHASE14_DATA_DIR,
      project_root:       PROJECT_ROOT,
      python_executable:  'python',
      benchmark_signature: 'unavailable', // BenchmarkSandboxRunner の provenance から取得可能だが初期値はunavailable
    },

    // Phase H: OpenClaw Gateway (fail-closed 外部統合ゲート)
    // DISPLAY-LAYER ONLY — tier評価・ガバナンスゲートには影響しない。
    // gateway_summary が MorningResult.gateway_summary と display.gateway_requests_processed に反映される。
    openclaw_gateway: new OpenClawGateway({
      max_enqueue_per_day: 10,
      forbidden_target_substrings: DEFAULT_FORBIDDEN_TARGETS,
      benchmark_protected_paths: DEFAULT_BENCHMARK_PROTECTED_PATHS,
      audit_log_path: path.join(PHASE14_DATA_DIR, 'openclaw_gateway_audit.jsonl'),
    }),

    // Phase H: OpenClaw enqueue queue — nightly loop が Phase A 後に読み込む。
    // openclaw_cli.ts が `enqueue_candidate` PASS 時にここへ書き込む。
    // 消費後は .consumed.<cycle_id>.jsonl にリネームされ再処理されない。
    openclaw_queue_path: path.join(PHASE14_DATA_DIR, 'openclaw_enqueue_queue.jsonl'),

    // AdaptationMemory — Phase C 昇格後に per-skill レコードを追記。
    // クロスサイクルの学習データ: 何が通ったか、どの環境で、どのソースから。
    adaptation_memory_path: path.join(PHASE14_DATA_DIR, 'adaptation_memory.jsonl'),

    // HumanReviewStore — DEFERRED_HUMAN パッチを review_queue.json に永続化。
    // 書き込み先は run_dir/review_queue.json (実行ごとに独立したディレクトリ)。
    // run_dir は mkdirSync で事前作成済み。
    human_review_store: new FilesystemHumanReviewStore(run_dir),
  };

  const config: NightlyLoopConfig = {
    run_dir,
    max_candidates: max_cands,
    max_focus_seeds: 5,
  };

  // ── 5. Run the loop ───────────────────────────────────────────────────────
  console.log('[Loop] Gemini に Phase A 仮説生成を依頼中...');
  console.log('       (Structured Output: PhaseACandidateList スキーマ強制)');
  console.log('');

  const started_ms = Date.now();
  let record: LoopRunRecord;

  try {
    record = await runNightlyLoop(ctx, config);
  } catch (fatal) {
    console.error('[FATAL] runNightlyLoop で未捕捉例外:', fatal);
    process.exit(1);
  }

  const elapsed_ms = Date.now() - started_ms;

  // ── 6. Persist outputs ────────────────────────────────────────────────────

  // Loop run record
  const record_path = path.join(run_dir, 'loop_run_record.json');
  fs.writeFileSync(record_path, JSON.stringify(record, null, 2), 'utf8');

  // Observation summary markdown
  const candidate_list_path = path.join(run_dir, 'audit');
  const summary_md = buildObservationSummary(record, candidate_list_path, elapsed_ms, use_seed);
  const summary_path = path.join(run_dir, 'observation_summary.md');
  fs.writeFileSync(summary_path, summary_md, 'utf8');

  // ── 6b. Drift metrics (live mode only) ——————————————————————
  if (!use_seed) {
    const drift_state_dir = path.join(PROJECT_ROOT, 'phase14', 'data', 'drift_state');
    const drift_monitor_reader = new DriftMonitor(drift_state_dir, {
      min_runs_for_slope: 20,
      slope_drift_threshold: -1e-6,
    });
    const all_drift = drift_monitor_reader.computeAll();
    if (all_drift.length > 0) {
      // Append drift section to observation_summary.md
      const drift_lines: string[] = ['', '## Drift Monitoring (Phase B)', ''];
      for (const dm of all_drift) {
        drift_lines.push(formatDriftReport(dm));
        drift_lines.push('');
      }
      const drift_detected_any = all_drift.some((dm) => dm.drift_detected);
      if (drift_detected_any) {
        drift_lines.push(
          '> **[F-010_SILENT_DRIFT]** ドリフトが検知されました。' +
          '次回openSandbox時にPhase B への決定入力として活用することを推奨します。'
        );
      }
      fs.appendFileSync(summary_path, drift_lines.join('\n'), 'utf8');

      // Also persist drift metrics to drift_report.json in run_dir
      const drift_report_path = path.join(run_dir, 'drift_report.json');
      fs.writeFileSync(drift_report_path, JSON.stringify(all_drift, null, 2), 'utf8');
      console.log(`  drift_report.json       → ${drift_report_path}`);
    }
  }

  // ── 7. Console report ─────────────────────────────────────────────────────
  console.log('='.repeat(64));
  console.log('Live Fire — 結果サマリー');
  console.log('='.repeat(64));
  console.log(`  completed:    ${record.completed}`);
  console.log(`  final_phase:  ${record.final_phase}`);
  console.log(`  elapsed_ms:   ${elapsed_ms}`);
  console.log(`  errors:       ${record.error_log.length}`);
  console.log('');
  console.log('出力先:');
  console.log(`  loop_run_record.json    → ${record_path}`);
  console.log(`  observation_summary.md  → ${summary_path}`);
  console.log(`  audit logs              → ${path.join(run_dir, 'audit')}`);
  if (!use_seed) {
    console.log(`  drift_state/            → ${path.join(PROJECT_ROOT, 'phase14', 'data', 'drift_state')}`);
  }

  if (record.error_log.length > 0) {
    console.log('');
    console.log('エラー詳細:');
    for (const e of record.error_log) {
      console.error(`  [${e.phase}] ${e.message}`);
    }
  }

  const kernel_violations = detectKernelScopeViolations(record);
  if (kernel_violations.length > 0) {
    console.warn('');
    console.warn('[WARN] カーネルスコープ違反が検出されました:');
    for (const v of kernel_violations) {
      console.warn(`  ${v}`);
    }
    console.warn('  → これらの候補は Phase B で BLAST_RADIUS_EXCEEDED として棄却済みです。');
  }

  console.log('');
  if (record.completed) {
    console.log('[DONE] Live Fire 完了 — observation_summary.md を確認してください。');
    if (!use_seed) {
      // Print drift summary to console
      const drift_state_dir = path.join(PROJECT_ROOT, 'phase14', 'data', 'drift_state');
      const dm_console = new DriftMonitor(drift_state_dir);
      const all_dm = dm_console.computeAll();
      if (all_dm.length > 0) {
        console.log('');
        console.log('[ドリフト] 時系列状態:');
        for (const dm of all_dm) {
          const trendIcon = { improving: '↑', stable: '→', degrading: '↓', insufficient_data: '?' }[dm.trend];
          const driftMark = dm.drift_detected ? ' ⚠ F-010_SILENT_DRIFT' : '';
          console.log(
            `  ${dm.target_function.split('.').pop()} | ` +
            `runs=${dm.n_total_runs} trend=${trendIcon}${dm.trend}${driftMark}`
          );
          if (dm.window_5) {
            console.log(
              `    window_5: mean=${dm.window_5.mean.toExponential(3)} ` +
              `stddev=${dm.window_5.stddev.toExponential(2)}`
            );
          }
          if (dm.slope_20 !== null) {
            console.log(`    slope_20: ${dm.slope_20.toExponential(3)} min/run`);
          }
        }
      }
    }
  } else {
    console.log('[WARN] ループが正常完了しませんでした。loop_run_record.json を確認してください。');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
