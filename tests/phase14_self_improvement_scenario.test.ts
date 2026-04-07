/**
 * tests/phase14_self_improvement_scenario.test.ts
 *
 * Phase 14 Application Layer — First Self-Improvement Scenario Test
 * =================================================================
 *
 * 目的:
 *   Phase 14 アプリケーション層（週次ガバナンスレポートスクリプト群）を
 *   最初の自己改善ターゲットとした際に、Phase A→B→C→D が正しく動作し
 *   「改善提案が採用される体験」を End-to-End で検証する。
 *
 * シナリオ:
 *   観測データ (PHASE14_OBSERVATION_WINDOW) には以下の3つの痛点が含まれる:
 *     1. aggregate_weekly_governance_report.py :: _load_json()
 *        → RuntimeError (ファイル欠如時に非構造化エラーを投げる)
 *        → expected_impact: HIGH (saved_time_minutes)
 *
 *     2. governance_weekly.py :: render_weekly_governance_markdown()
 *        → Markdown レンダラーが肥大化スロー
 *        → expected_impact: MEDIUM (refined_code_lines)
 *
 *     3. governance_weekly.py :: classify_rejection()
 *        → 未知の却下理由をサイレントに NOVEL_CASE_REQUIRES_HLG に分類
 *        → expected_impact: MEDIUM (bugs_killed)
 *
 * テスト検証内容:
 *   TEST 1 — Phase A プロンプト組立
 *     PHASE14_FOCUS_SEED_SET が PhaseAInputPack.world_state.focus_seeds に
 *     正しく組み込まれることを検証する。
 *
 *   TEST 2 — Phase 14 ターゲット候補の完走（SELF blast_radius）
 *     Phase 14 ターゲット（blast_radius=SELF）のパッチ候補が
 *     Phase A→B→C→D を完走し、MorningResult に promoted_skill が
 *     1件以上含まれることを検証する。
 *
 *   TEST 3 — blast_radius=GLOBAL 候補はレビューキューに入る
 *     Phase 14 の Markdown レンダラーリファクタリングを "GLOBAL" とした場合、
 *     DEFERRED_HUMAN となり、PromotingGateResult.deferred_human_review_count = 1
 *     になることを検証する。
 *
 *   TEST 4 — FocusSeedSet の内容が Phase A で参照できること
 *     assemblePhaseAInputPack が PHASE14_OBSERVATION_WINDOW を受け取ったとき、
 *     生成される focus_seeds.seeds が >= 1 件であることを検証する。
 *
 * 実行方法:
 *   cd github_project_manuals_review
 *   npm run build && node dist/tests/phase14_self_improvement_scenario.test.js
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  runNightlyLoop,
  FilesystemLedgerStore,
} from '../tools/nightly_loop_runner';
import type {
  NightlyLoopContext,
  NightlyLoopConfig,
  PhaseALLMDispatcher,
} from '../tools/nightly_loop_runner';
import type { SandboxRunner, SandboxHandle, PhaseBConfig } from '../tools/phase_b_orchestrator';
import type { SystemStateSnapshot } from '../tools/phase_c_orchestrator';
import type { PhaseACandidateList, PatchCandidate } from '../contract/phase_a_prompt';
import type { PromotingGateResult } from '../contract/phase_c_promote';

import {
  assemblePhaseAInputPack,
} from '../tools/phase_a_orchestrator';
import type { LedgerStoreSnapshot } from '../tools/phase_a_orchestrator';

import {
  PHASE14_OBSERVATION_WINDOW,
  PHASE14_FOCUS_SEED_SET,
  PHASE14_PROTECTED_INVARIANT_IDS,
} from '../fixtures/phase14_observation_seed';

// ============================================================================
// SHARED FIXTURES
// ============================================================================

const STABLE_SYSTEM_SNAPSHOT: SystemStateSnapshot = {
  stability_index_score: 0.80,
  invariant_failure_count_this_cycle: 0,
  blocked_risky_actions_this_cycle: { count: 0, events: [] },
};

// ---------------------------------------------------------------------------
// Patch candidate factories for Phase 14 targets
// ---------------------------------------------------------------------------

/**
 * TARGET 1: _load_json structured error recovery
 * blast_radius=SELF (single script, output-only change)
 * expected_improvement: saved_time_minutes_predicted=8
 */
function makePhase14Target1Candidate(cycle_id: string): PatchCandidate {
  return {
    candidate_id: `ph14-t1-${randomUUID()}`,
    generated_at: new Date().toISOString(),
    cycle_id,
    title: 'Add structured MissingReportFileError to _load_json in aggregate_weekly_governance_report.py',
    affected_targets: [
      {
        file_path: 'phase14/scripts/aggregate_weekly_governance_report.py',
        function_name: '_load_json',
        change_type: 'modify',
      },
    ],
    estimated_blast_radius: 'SELF',
    patch_diff: [
      '--- a/phase14/scripts/aggregate_weekly_governance_report.py',
      '+++ b/phase14/scripts/aggregate_weekly_governance_report.py',
      '@@ -1,5 +1,14 @@',
      '+class MissingReportFileError(RuntimeError):',
      '+    """Raised when a required report JSON file is absent.',
      '+',
      '+    Attributes:',
      '+        path: The missing file path.',
      '+        recovery: A human-readable recovery instruction.',
      '+    """',
      '+    def __init__(self, path: Path) -> None:',
      '+        self.path = path',
      '+        self.recovery = f"Run the upstream pipeline for {path.name} first."',
      '+        super().__init__(f"Required file not found: {path}\\n  Recovery: {self.recovery}")',
      '+',
      ' def _load_json(path: Path) -> dict:',
      '-    if not path.exists():',
      '-        raise RuntimeError(f"Required file not found: {path}")',
      '+    if not path.exists():',
      '+        raise MissingReportFileError(path)',
      '     return json.loads(path.read_text(encoding="utf-8-sig"))',
    ].join('\n'),
    acceptance_criteria: {
      invariant_check: [
        {
          invariant_id: 'INV-001_NO_AUTH_BYPASS',
          verdict: 'untouched',
        },
        {
          invariant_id: 'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
          verdict: 'untouched',
        },
      ],
      measurable_outcome: {
        stability_index_delta: 'positive',
        saved_time_minutes_predicted: 8,
        measurement_basis: {
          observation_window: '2026-03-28..2026-04-07',
          occurrences: 3,
          minutes_per_incident: 8,
          source: 'PHASE14_OBSERVATION_WINDOW error_log_entries occurrence_count_in_window',
        },
      },
      no_regression: {
        regression_test_ids_verified_pass: [],
        invariant_ids_untouched: [
          'INV-001_NO_AUTH_BYPASS',
          'INV-003_NO_WRITE_EXECUTE_WITHOUT_APPROVAL',
          'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
        ],
        orthogonality_rationale:
          'The change is confined to a private helper function that only raises an exception. ' +
          'No control flow, data schema, or output format is altered. ' +
          'All existing regression tests for the script remain fully applicable.',
      },
    },
    negative_constraint_violations: [],
  };
}

/**
 * TARGET 2: render_weekly_governance_markdown refactor
 * blast_radius=SELF (internal module, no public API changes)
 * expected_improvement: refined_code_lines_predicted=18
 */
function makePhase14Target2Candidate(cycle_id: string): PatchCandidate {
  return {
    candidate_id: `ph14-t2-${randomUUID()}`,
    generated_at: new Date().toISOString(),
    cycle_id,
    title: 'Introduce section registry in render_weekly_governance_markdown to eliminate hard-coded f-string list',
    affected_targets: [
      {
        file_path: 'phase14/src/phase14/governance_weekly.py',
        function_name: 'render_weekly_governance_markdown',
        change_type: 'modify',
      },
    ],
    estimated_blast_radius: 'SELF',
    patch_diff: [
      '--- a/phase14/src/phase14/governance_weekly.py',
      '+++ b/phase14/src/phase14/governance_weekly.py',
      '@@ -148,4 +148,22 @@',
      '+_SECTION_RENDERERS: list[tuple[str, Callable[[dict], list[str]]]] = [',
      '+    ("Bias",       _render_bias_section),',
      '+    ("Drift",      _render_drift_section),',
      '+    ("Promotion",  _render_promotion_section),',
      '+]',
      '+',
      '+def render_weekly_governance_markdown(summary: dict) -> str:',
      '+    lines = [f"# Weekly Governance Report ({summary[\'week_label\']})", ""]',
      '+    lines += [f"- overall_status: {summary[\'overall_status\']}"]',
      '+    for title, renderer in _SECTION_RENDERERS:',
      '+        lines += ["", f"## {title}", ""]',
      '+        lines += renderer(summary)',
      '+    return "\\n".join(lines) + "\\n"',
    ].join('\n'),
    acceptance_criteria: {
      invariant_check: [
        {
          invariant_id: 'INV-001_NO_AUTH_BYPASS',
          verdict: 'untouched',
        },
        {
          invariant_id: 'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
          verdict: 'untouched',
        },
      ],
      measurable_outcome: {
        stability_index_delta: 'neutral',
        refined_code_lines_predicted: 18,
        measurement_basis: {
          baseline_line_count: 60,
          section_count: 3,
          lines_saved_per_section: 6,
          source: 'PHASE14_OBSERVATION_WINDOW slow_workflow render_weekly_markdown',
        },
      },
      no_regression: {
        regression_test_ids_verified_pass: [],
        invariant_ids_untouched: [
          'INV-001_NO_AUTH_BYPASS',
          'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
        ],
        orthogonality_rationale:
          'The change is a pure refactor of render_weekly_governance_markdown. ' +
          'Input and output types are identical. No schema, no data flow, no side effects change.',
      },
    },
    negative_constraint_violations: [],
  };
}

/**
 * TARGET 2 variant: blast_radius=GLOBAL (cross-module report output change)
 * Used in TEST 3 to verify DEFERRED_HUMAN path.
 */
function makePhase14Target2GlobalCandidate(cycle_id: string): PatchCandidate {
  return {
    ...makePhase14Target2Candidate(cycle_id),
    candidate_id: `ph14-t2g-${randomUUID()}`,
    estimated_blast_radius: 'GLOBAL',
  };
}

/**
 * TARGET 3: classify_rejection silent novel-case fix
 * blast_radius=SELF
 * expected_improvement: bugs_killed_predicted=1
 */
function makePhase14Target3Candidate(cycle_id: string): PatchCandidate {
  return {
    candidate_id: `ph14-t3-${randomUUID()}`,
    generated_at: new Date().toISOString(),
    cycle_id,
    title: 'Log and count unrecognised rejection reasons in classify_rejection before fallback to NOVEL_CASE_REQUIRES_HLG',
    affected_targets: [
      {
        file_path: 'phase14/src/phase14/governance_weekly.py',
        function_name: 'classify_rejection',
        change_type: 'modify',
      },
    ],
    estimated_blast_radius: 'SELF',
    patch_diff: [
      '--- a/phase14/src/phase14/governance_weekly.py',
      '+++ b/phase14/src/phase14/governance_weekly.py',
      '@@ -14,2 +14,9 @@',
      '+import logging',
      '+_log = logging.getLogger(__name__)',
      '+_novel_case_counter: int = 0',
      '+',
      ' def classify_rejection(reason: str) -> str:',
      '     key = str(reason or "").strip().lower()',
      '-    return KNOWN_REJECTION_CLASSES.get(key, "NOVEL_CASE_REQUIRES_HLG")',
      '+    result = KNOWN_REJECTION_CLASSES.get(key)',
      '+    if result is None:',
      '+        global _novel_case_counter',
      '+        _novel_case_counter += 1',
      '+        _log.warning("classify_rejection: unknown reason %r → NOVEL_CASE_REQUIRES_HLG (count=%d)", reason, _novel_case_counter)',
      '+        return "NOVEL_CASE_REQUIRES_HLG"',
      '+    return result',
    ].join('\n'),
    acceptance_criteria: {
      invariant_check: [
        {
          invariant_id: 'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
          verdict: 'pass',
          verification_method:
            'The patch adds _log.warning() before returning NOVEL_CASE_REQUIRES_HLG; ' +
            'verified by unit test that captures log output and checks warning is emitted.',
        },
        {
          invariant_id: 'INV-001_NO_AUTH_BYPASS',
          verdict: 'untouched',
        },
      ],
      measurable_outcome: {
        stability_index_delta: 'positive',
        bugs_killed_predicted: 1,
        measurement_basis: {
          invariant_id: 'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
          failure_count_in_window: 2,
          source: 'PHASE14_OBSERVATION_WINDOW invariant_stress_counts',
        },
      },
      no_regression: {
        regression_test_ids_verified_pass: [],
        invariant_ids_untouched: ['INV-001_NO_AUTH_BYPASS'],
        orthogonality_rationale:
          'The change adds logging and a counter to classify_rejection. ' +
          'Return values for all known keys are unchanged. ' +
          'The function signature is unchanged. ' +
          'Side effects (logging) are observability-only.',
      },
    },
    negative_constraint_violations: [],
  };
}

// ---------------------------------------------------------------------------
// SandboxHandle / SandboxRunner helpers
// ---------------------------------------------------------------------------

function makePassingSandboxHandle(
  candidate_id: string,
  cycle_id: string,
  attempt = 1
): SandboxHandle {
  return {
    sandbox_id: randomUUID(),
    image_tag: 'mock-sandbox:phase14',
    started_at: new Date().toISOString(),
    idempotency_key: `${cycle_id}:${candidate_id}:${attempt}`,
    async applyPatch() { /* no-op */ },
    async runInvariants(invariant_ids) {
      return invariant_ids.map((id) => ({
        invariant_id: id,
        outcome: 'pass' as const,
        verified_by: `mock-assertion-${id}`,
      }));
    },
    async measureMetrics() {
      return {
        stability_index_score: 0.84,
        saved_time_minutes: 8,
        tokens_saved: 0,
        bugs_killed: 1,
        refined_code_lines: 18,
      };
    },
    async runRegressionTests(test_ids) {
      return test_ids.map((id) => ({ test_id: id, outcome: 'pass' as const }));
    },
    async close() { /* no-op */ },
  };
}

function makeSandboxRunner(
  handleFactory: (candidate_id: string, cycle_id: string, attempt: number) => SandboxHandle
): SandboxRunner {
  return {
    async openSandbox(candidate_id, cycle_id, attempt = 1) {
      return handleFactory(candidate_id, cycle_id, attempt);
    },
  };
}

// ---------------------------------------------------------------------------
// LLM Dispatcher mock
// ---------------------------------------------------------------------------

class Phase14LLMDispatcher implements PhaseALLMDispatcher {
  constructor(private readonly candidates: PatchCandidate[]) {}

  async dispatch(_sys: string, _user: string, cycle_id: string): Promise<PhaseACandidateList> {
    return {
      schema_version: 'phase_a_output/0.1',
      cycle_id,
      generated_at: new Date().toISOString(),
      input_pack_id: randomUUID(),
      candidates: this.candidates.map((c) => ({ ...c, cycle_id })),
      discarded_candidates: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

function makeTmpDir(label: string): string {
  const d = path.join(os.tmpdir(), `ph14_scenario_${label}_${Date.now()}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function makeContext(
  candidates: PatchCandidate[],
  overrides: Partial<NightlyLoopContext> & { run_dir: string; ledger_dir: string }
): { ctx: NightlyLoopContext; config: NightlyLoopConfig } {
  const store = new FilesystemLedgerStore(overrides.ledger_dir);

  const system_template = [
    'Antigravity OS self-evolution agent.',
    'Constitution: {{NEGATIVE_CONSTRAINTS_BLOCK}}',
    'Objective: {{OBJECTIVE_BLOCK}}',
  ].join('\n');

  const user_template = [
    'cycle_id: {{CYCLE_ID}}',
    'assembled_at: {{ASSEMBLED_AT}}',
    'previous_tier: {{PREVIOUS_TIER}}',
    'invariants: {{INVARIANT_RECENT_RESULTS_BLOCK}}',
    'failing_tests: {{FAILING_REGRESSION_TESTS_BLOCK}}',
    'workflow_baselines: {{WORKFLOW_BASELINES_BLOCK}}',
    'active_failure_codes: {{ACTIVE_FAILURE_CODES_BLOCK}}',
    'focus_seeds: {{FOCUS_SEEDS_BLOCK}}',
    'max_candidates: {{MAX_CANDIDATES}}',
  ].join('\n');

  const ctx: NightlyLoopContext = {
    phase_a_system_template: system_template,
    phase_a_user_template: user_template,
    protected_invariant_ids: PHASE14_PROTECTED_INVARIANT_IDS,
    observation_window: PHASE14_OBSERVATION_WINDOW,
    invariant_recent_results: [
      {
        invariant_id: 'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
        passed: false,
        evaluated_at: '2026-04-01T11:30:00.000Z',
      },
      {
        invariant_id: 'INV-001_NO_AUTH_BYPASS',
        passed: true,
        evaluated_at: '2026-04-07T00:00:00.000Z',
      },
    ],
    failing_regression_test_ids: [],
    regression_test_total: 12,
    sandbox_runner: makeSandboxRunner(makePassingSandboxHandle),
    system_state_snapshot: STABLE_SYSTEM_SNAPSHOT,
    legitimacy_tier: 'L1',
    next_cycle_recommendations: [],
    llm_dispatcher: new Phase14LLMDispatcher(candidates),
    ledger_store: store,
    ...overrides,
  };

  const config: NightlyLoopConfig = {
    run_dir: overrides.run_dir,
    max_candidates: 3,
    max_focus_seeds: 5,
  };

  return { ctx, config };
}

// ============================================================================
// TEST RUNNER
// ============================================================================

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      const lines = err.stack.split('\n').slice(1, 4);
      for (const l of lines) console.error(`           ${l.trim()}`);
    }
    failed++;
  }
}

// ============================================================================
// TEST 1 — FocusSeedSet は assemblePhaseAInputPack に正しく組み込まれる
// ============================================================================

async function test1_focusSeedsInjected(): Promise<void> {
  const ledger_snapshot: LedgerStoreSnapshot = {
    failure_ledger_all: [],
    recent_cycle_ids_ordered: [],
    current_stability_index: {
      score: 0.80,
      invariant_pass_ratio: 0.80,
      no_regression_pass_ratio: 1.0,
      replay_success_ratio: 1.0,
      quarantine_adjusted_safety_factor: 1.0,
    },
    previous_tier: null,
  };

  const cycle_id = `cycle-ph14-seed-${randomUUID()}`;

  const input_pack = assemblePhaseAInputPack({
    cycle_id,
    ledger: ledger_snapshot,
    observation: PHASE14_OBSERVATION_WINDOW,
    protected_invariant_ids: PHASE14_PROTECTED_INVARIANT_IDS,
    invariant_recent_results: [
      {
        invariant_id: 'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
        passed: false,
        evaluated_at: '2026-04-01T11:30:00.000Z',
      },
    ],
    failing_regression_test_ids: [],
    regression_test_total: 12,
    max_seeds: 5,
    max_candidates: 3,
  });

  // ── 1a. cycle_id が正しく伝播されている ─────────────────────────────────
  assert.equal(input_pack.cycle_id, cycle_id, 'cycle_id should match');

  // ── 1b. focus_seeds が組み込まれている ───────────────────────────────────
  const seeds = input_pack.world_state.focus_seeds.seeds;
  assert.ok(seeds.length >= 1,
    `focus_seeds.seeds should have at least 1 entry from Phase 14 observation; got ${seeds.length}`);

  // ── 1c. Phase 14 の invariant_stress seed が含まれている ─────────────────
  const inv_seed = seeds.find(
    (s) => s.seed_type === 'invariant_stress' &&
      s.invariant_id === 'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD'
  );
  assert.ok(inv_seed,
    'FocusSeedSet must include an invariant_stress seed for INV-PHASE14-01');

  // ── 1d. Phase 14 の error_log seed が含まれている ────────────────────────
  const err_seed = seeds.find(
    (s) => s.seed_type === 'error_log' &&
      (s as { source_file: string }).source_file ===
        'phase14/scripts/aggregate_weekly_governance_report.py'
  );
  assert.ok(err_seed,
    'FocusSeedSet must include an error_log seed for aggregate_weekly_governance_report.py');

  // ── 1e. 保護インバリアントが正しく渡されている ────────────────────────────
  assert.ok(
    input_pack.constitution_layer.protected_invariant_ids.includes(
      'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD'
    ),
    'Constitution layer must protect INV-PHASE14-01'
  );
}

// ============================================================================
// TEST 2 — Phase 14 ターゲット候補が Phase A→B→C→D を完走して promoted になる
// ============================================================================

async function test2_phase14TargetsPromoted(): Promise<void> {
  const run_dir = makeTmpDir('t2');
  const ledger_dir = makeTmpDir('t2_ledger');

  const cycle_id = `cycle-ph14-t2-${randomUUID()}`;
  const t1 = makePhase14Target1Candidate(cycle_id);
  const t3 = makePhase14Target3Candidate(cycle_id);

  const { ctx, config } = makeContext([t1, t3], {
    run_dir,
    ledger_dir,
  });

  const record = await runNightlyLoop(ctx, config);

  // ── 2a. 完了している ──────────────────────────────────────────────────
  assert.equal(record.completed, true,
    `Phase 14 scenario should complete. errors: ${JSON.stringify(record.error_log)}`);

  // ── 2b. MorningResult が書き出されている ──────────────────────────────
  assert.ok(record.morning_result_path, 'morning_result_path should be non-null');
  assert.ok(fs.existsSync(record.morning_result_path!),
    'MorningResult file must exist on disk');

  // ── 2c. 少なくとも 1 件の promoted_skill がある ─────────────────────
  const raw = JSON.parse(
    fs.readFileSync(record.morning_result_path!, 'utf8')
  );
  assert.ok(raw.evolution.promoted_skill_count >= 1,
    `At least 1 Phase 14 patch should be promoted; got promoted_skill_count=${raw.evolution.promoted_skill_count}`);

  // ── 2d. 保護インバリアントが constitution に含まれる cycle ───────────
  const tsm_store = new FilesystemLedgerStore(ledger_dir);
  const tsm = await tsm_store.readTaskStateMachine();
  assert.ok(tsm, 'TSM should exist after run');
  assert.equal(tsm!.status, 'OBSERVING', 'TSM should return to OBSERVING');
}

// ============================================================================
// TEST 3 — blast_radius=GLOBAL 候補は DEFERRED_HUMAN になる
// ============================================================================

async function test3_globalBlastDeferredToHuman(): Promise<void> {
  const run_dir = makeTmpDir('t3');
  const ledger_dir = makeTmpDir('t3_ledger');

  const cycle_id = `cycle-ph14-t3-${randomUUID()}`;
  // GLOBAL blast_radius → Phase Bの max_allowed_blast_radius を GLOBAL に上げる
  // → Phase B を通過 → Phase C P-01 fails (blast=GLOBAL) → DEFERRED_HUMAN
  const t2_global = makePhase14Target2GlobalCandidate(cycle_id);

  const { ctx, config } = makeContext([t2_global], {
    run_dir,
    ledger_dir,
    phase_b_config: { max_allowed_blast_radius: 'GLOBAL' } as Partial<PhaseBConfig>,
  });

  const record = await runNightlyLoop(ctx, config);

  assert.equal(record.completed, true,
    `Deferred scenario should still complete. errors: ${JSON.stringify(record.error_log)}`);

  assert.ok(record.morning_result_path, 'morning_result_path must be set');
  const raw = JSON.parse(fs.readFileSync(record.morning_result_path!, 'utf8'));

  // ── 3a. guardian.pending_human_review_patch_ids == 1 ──────────────────
  // DEFERRED_HUMAN patches are surfaced here in MorningResult.
  const pending_ids: string[] = raw.guardian?.pending_human_review_patch_ids ?? [];
  assert.ok(
    pending_ids.length >= 1,
    `Expected at least 1 pending_human_review_patch_id for GLOBAL blast_radius candidate; got [${pending_ids.join(', ')}]`
  );

  // ── 3b. promoted_skill_count == 0 ────────────────────────────────────
  assert.equal(raw.evolution.promoted_skill_count, 0,
    `GLOBAL blast_radius candidate must NOT be promoted; got promoted_skill_count=${raw.evolution.promoted_skill_count}`);
}

// ============================================================================
// TEST 4 — PHASE14_FOCUS_SEED_SET が正しい構造を持つ (静的検証)
// ============================================================================

async function test4_focusSeedSetStructure(): Promise<void> {
  // ── 4a. seeds フィールドが存在し最低 3 件 ─────────────────────────────
  assert.ok(
    Array.isArray(PHASE14_FOCUS_SEED_SET.seeds),
    'PHASE14_FOCUS_SEED_SET.seeds must be an array'
  );
  assert.ok(
    PHASE14_FOCUS_SEED_SET.seeds.length >= 3,
    `PHASE14_FOCUS_SEED_SET.seeds should have at least 3 entries; got ${PHASE14_FOCUS_SEED_SET.seeds.length}`
  );

  // ── 4b. HIGH impact が先頭 ────────────────────────────────────────────
  assert.equal(
    PHASE14_FOCUS_SEED_SET.seeds[0]?.estimated_impact,
    'HIGH',
    'First seed should have estimated_impact = HIGH'
  );

  // ── 4c. seed_types が正しい ───────────────────────────────────────────
  const types = PHASE14_FOCUS_SEED_SET.seeds.map((s) => s.seed_type);
  assert.ok(types.includes('error_log'),      'Seeds must include an error_log seed');
  assert.ok(types.includes('slow_workflow'),  'Seeds must include a slow_workflow seed');
  assert.ok(types.includes('invariant_stress'), 'Seeds must include an invariant_stress seed');

  // ── 4d. excluded_seed_count が 0 ─────────────────────────────────────
  assert.equal(
    PHASE14_FOCUS_SEED_SET.excluded_seed_count,
    0,
    'All Phase 14 seeds should be within the max_seeds cap'
  );
}

// ============================================================================
// MAIN
// ============================================================================

(async () => {
  console.log('\n=== Phase 14 Self-Improvement Scenario Tests ===');
  console.log('Target: Phase 14 Application Layer (週次ガバナンスレポート最適化)\n');

  await runTest('TEST 1 — FocusSeedSet が assemblePhaseAInputPack に正しく注入される', test1_focusSeedsInjected);
  await runTest('TEST 2 — Phase 14 ターゲット候補が Phase A→B→C→D を完走して promoted になる', test2_phase14TargetsPromoted);
  await runTest('TEST 3 — blast_radius=GLOBAL 候補は DEFERRED_HUMAN になる', test3_globalBlastDeferredToHuman);
  await runTest('TEST 4 — PHASE14_FOCUS_SEED_SET 静的構造検証', test4_focusSeedSetStructure);

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);

  if (failed > 0) {
    console.error('\nFailed tests indicate the Phase 14 self-improvement seed is not correctly wired.');
    process.exit(1);
  } else {
    console.log('\nPhase 14 self-improvement scenario is correctly wired and ready for first LLM dispatch.');
  }
})();
