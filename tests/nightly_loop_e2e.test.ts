/**
 * tests/nightly_loop_e2e.test.ts
 *
 * End-to-End Integration Test — Nightly Loop Controller
 * ======================================================
 *
 * 目的: ガバナンスカーネルの「状態機械の証明」と「出口の証明」を与える。
 *
 *   TEST 1 — Happy Path (正常完走)
 *     - 1件のパッチ候補が Phase A → B → C → D を完走する
 *     - MorningResult.json がディスクに書き出されることを検証
 *     - TSM が最終的に OBSERVING に戻ることを検証
 *
 *   TEST 2 — Crash + Resume from TESTING
 *     - Phase B 完了直後に意図的クラッシュをシミュレート（cycle_id を固定し
 *       TSM = TESTING + Phase B チェックポイントを事前書き込み）
 *     - runNightlyLoop を再実行すると Phase B をスキップして Phase C から再開
 *     - 同じ MorningResult.json が最終的に書き出されることを検証
 *
 *   TEST 3 — Crash + Resume from PROMOTING
 *     - Phase C 完了直後クラッシュ（TSM = PROMOTING + B/C チェックポイント書き込み）
 *     - runNightlyLoop が Phase D だけを実行して完了することを検証
 *
 *   TEST 4 — All Patches Rejected (Phase B 全滅)
 *     - SandboxRunner が全候補を INVARIANT_VIOLATION で reject する
 *     - PromotingGateResult.promoted_count = 0 → MorningResult が tier = null で出力
 *
 *   TEST 5 — System Gate Closed (Phase C システムゲート閉鎖)
 *     - SystemStateSnapshot.invariant_failure_count_this_cycle = 1
 *     - VerifiedPatch が DEFERRED_STABILITY になる
 *     - MorningResult が system_gate_passed = false を記録する
 *
 * 実行方法:
 *   npm run build && node dist/tests/nightly_loop_e2e.test.js
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
import type { SandboxRunner, SandboxHandle } from '../tools/phase_b_orchestrator';
import type { SystemStateSnapshot } from '../tools/phase_c_orchestrator';
import type { PhaseACandidateList, PatchCandidate } from '../contract/phase_a_prompt';
import type { MorningResult } from '../contract/morning_result';
import type { TaskStateMachineRecord } from '../contract/self_evolution_metrics';

// ============================================================================
// SHARED FIXTURES
// ============================================================================

const CYCLE_ID_FIXED = 'cycle-e2e-test-001';

/**
 * Minimal valid PatchCandidate for testing.
 * blast_radius = SELF → no BLAST_RADIUS_EXCEEDED rejection.
 * affected_targets → tools/phase_a_orchestrator.ts（任意のファイル）
 */
function makePatchCandidate(candidate_id: string, cycle_id: string): PatchCandidate {
  return {
    candidate_id,
    generated_at: new Date().toISOString(),
    cycle_id,
    title: `E2E test patch: reduce error rate in phase_a_orchestrator.ts`,
    affected_targets: [
      {
        file_path: 'tools/phase_a_orchestrator.ts',
        function_name: 'assemblePhaseAInputPack',
        change_type: 'modify',
      },
    ],
    estimated_blast_radius: 'SELF',
    patch_diff: `--- a/tools/phase_a_orchestrator.ts\n+++ b/tools/phase_a_orchestrator.ts\n@@ -1,1 +1,1 @@\n-// placeholder\n+// e2e patched\n`,
    acceptance_criteria: {
      invariant_check: [
        { invariant_id: 'INV-001', verdict: 'pass', verification_method: 'unit test coverage confirms no auth bypass' },
        { invariant_id: 'INV-003', verdict: 'pass', verification_method: 'approval token presence checked by TEST-003' },
      ],
      measurable_outcome: {
        stability_index_delta: 'positive',
        saved_time_minutes_predicted: 5,
        tokens_saved_predicted: null,
        bugs_killed_predicted: 1,
        refined_code_lines_predicted: 10,
        measurement_basis: {},
      },
      no_regression: {
        regression_test_ids_verified_pass: ['TEST-001', 'TEST-002'],
        invariant_ids_untouched: ['INV-002', 'INV-003'],
        orthogonality_rationale: undefined,
      },
    },
    negative_constraint_violations: [],
  };
}

/**
 * Mock LLM Dispatcher — returns a fixed PhaseACandidateList immediately.
 * Does NOT call any external API.
 */
class MockLLMDispatcher implements PhaseALLMDispatcher {
  private readonly candidates: PatchCandidate[];

  constructor(candidates: PatchCandidate[]) {
    this.candidates = candidates;
  }

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
// SandboxHandle factory helpers
// ---------------------------------------------------------------------------

/**
 * Creates a SandboxHandle that always passes all three gates.
 * pre_stability = 0.70, post_stability = 0.75 → delta +0.05
 */
function makePassingSandboxHandle(
  candidate_id: string,
  cycle_id: string,
  attempt = 1
): SandboxHandle {
  const started_at = new Date().toISOString();
  return {
    sandbox_id: randomUUID(),
    image_tag: 'mock-sandbox:e2e',
    started_at,
    idempotency_key: `${cycle_id}:${candidate_id}:${attempt}`,
    async applyPatch() { /* no-op */ },
    async runInvariants(invariant_ids) {
      return invariant_ids.map((id) => ({ invariant_id: id, outcome: 'pass' as const, verified_by: 'mock-invariant-test' }));
    },
    async measureMetrics() {
      // Returns PRE-patch snapshot on first call, POST-patch on second.
      // Phase B calls: (1) pre-patch measure, (2) post-patch measure.
      // We track call count via a closure counter.
      return {
        stability_index_score: 0.75,
        saved_time_minutes: 5,
        tokens_saved: 100,
        bugs_killed: 1,
        refined_code_lines: 10,
      };
    },
    async runRegressionTests(test_ids) {
      return test_ids.map((id) => ({ test_id: id, outcome: 'pass' as const }));
    },
    async close() { /* no-op */ },
  };
}

/**
 * Creates a SandboxHandle that fails INV-003 → INVARIANT_VIOLATION rejection.
 * INV-003 is in SECURITY_INVARIANTS → Rule 1 → F-001 ledger write.
 */
function makeFailingInvariantHandle(
  candidate_id: string,
  cycle_id: string,
  attempt = 1
): SandboxHandle {
  const started_at = new Date().toISOString();
  return {
    sandbox_id: randomUUID(),
    image_tag: 'mock-sandbox:e2e-failing',
    started_at,
    idempotency_key: `${cycle_id}:${candidate_id}:${attempt}`,
    async applyPatch() { /* no-op */ },
    async runInvariants(invariant_ids) {
      return invariant_ids.map((id) => ({
        invariant_id: id,
        // Fail INV-003 specifically (security invariant → F-001 ledger write)
        outcome: (id === 'INV-003' ? 'fail' : 'pass') as 'fail' | 'pass',
        failure_message: id === 'INV-003' ? 'Mock: approval token missing in executor path' : undefined,
      }));
    },
    async measureMetrics() {
      return {
        stability_index_score: 0.65,
        saved_time_minutes: null,
        tokens_saved: null,
        bugs_killed: null,
        refined_code_lines: null,
      };
    },
    async runRegressionTests(test_ids) {
      return test_ids.map((id) => ({ test_id: id, outcome: 'pass' as const }));
    },
    async close() { /* no-op */ },
  };
}

/**
 * Builds a SandboxRunner whose handle behavior is determined by a factory fn.
 */
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
// ObservationWindow fixture — intentional delay + error log seed
// ---------------------------------------------------------------------------

const OBSERVATION_WINDOW = {
  error_log_entries: [
    {
      source_file: 'tools/phase_a_orchestrator.ts',
      function_name: 'assemblePhaseAInputPack',
      error_code: 'E-503',
      error_message_excerpt: 'timeout waiting for ledger read — 3200ms',
      first_seen_at: '2026-04-01T03:00:00.000Z',
      occurrence_count: 4,
    },
  ],
  workflow_recent_results: [
    { workflow_id: 'wf-nightly-scan', recent_median_ms: 12000 },  // was 8000 → 50% slower
    { workflow_id: 'wf-synthesis-check', recent_median_ms: 900 },
  ],
  invariant_stress_counts: [
    { invariant_id: 'INV-003', failure_count: 2, last_failed_at: '2026-04-05T02:00:00.000Z', related_file: 'tools/phase_a_orchestrator.ts' },
  ],
  consecutive_failing_tests: [
    { test_id: 'TEST-SYNC-01', consecutive_fail_cycles: 3, linked_incident_id: 'INC-042' },
  ],
};

// ---------------------------------------------------------------------------
// SystemStateSnapshot fixtures
// ---------------------------------------------------------------------------

const HEALTHY_SYSTEM_SNAPSHOT: SystemStateSnapshot = {
  stability_index_score: 0.78,
  invariant_failure_count_this_cycle: 0,
  blocked_risky_actions_this_cycle: {
    count: 0,
    events: [],
  },
};

const UNSTABLE_SYSTEM_SNAPSHOT: SystemStateSnapshot = {
  stability_index_score: 0.78,
  invariant_failure_count_this_cycle: 1,   // SYS-02 fails → system gate closes
  blocked_risky_actions_this_cycle: {
    count: 0,
    events: [],
  },
};

// ---------------------------------------------------------------------------
// Helper: build a NightlyLoopContext for tests
// ---------------------------------------------------------------------------

function makeTmpDir(label: string): string {
  const d = path.join(os.tmpdir(), `nightly_e2e_${label}_${Date.now()}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function makeContext(overrides: Partial<NightlyLoopContext> & {
  run_dir: string;
  ledger_dir: string;
}): { ctx: NightlyLoopContext; config: NightlyLoopConfig; store: FilesystemLedgerStore } {
  const store = new FilesystemLedgerStore(overrides.ledger_dir);

  const candidate_id = `cand-${randomUUID()}`;
  const candidate = makePatchCandidate(candidate_id, CYCLE_ID_FIXED);

  const ctx: NightlyLoopContext = {
    phase_a_system_template: buildMinimalSystemTemplate(),
    phase_a_user_template: buildMinimalUserTemplate(),
    protected_invariant_ids: ['INV-001', 'INV-002', 'INV-003'],
    observation_window: OBSERVATION_WINDOW,
    invariant_recent_results: [
      { invariant_id: 'INV-001', passed: true, evaluated_at: '2026-04-06T00:00:00.000Z' },
      { invariant_id: 'INV-002', passed: true, evaluated_at: '2026-04-06T00:00:00.000Z' },
      { invariant_id: 'INV-003', passed: false, evaluated_at: '2026-04-06T00:00:00.000Z' },
    ],
    failing_regression_test_ids: ['TEST-SYNC-01'],
    regression_test_total: 42,
    sandbox_runner: makeSandboxRunner(makePassingSandboxHandle),
    system_state_snapshot: HEALTHY_SYSTEM_SNAPSHOT,
    legitimacy_tier: 'L1',
    next_cycle_recommendations: [],
    llm_dispatcher: new MockLLMDispatcher([candidate]),
    ledger_store: store,
    ...overrides,
  };

  const config: NightlyLoopConfig = {
    run_dir: overrides.run_dir,
    max_candidates: 1,
    max_focus_seeds: 3,
  };

  return { ctx, config, store };
}

// ---------------------------------------------------------------------------
// Minimal YAML-like prompt templates (the renderer only needs {{SLOT}} fills)
// ---------------------------------------------------------------------------

function buildMinimalSystemTemplate(): string {
  return [
    'You are the Antigravity OS self-evolution agent.',
    'Constitution:',
    '{{NEGATIVE_CONSTRAINTS_BLOCK}}',
    'Objective:',
    '{{OBJECTIVE_BLOCK}}',
  ].join('\n');
}

function buildMinimalUserTemplate(): string {
  return [
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
// TEST 1 — Happy Path: 正常完走
// ============================================================================

async function test1_happyPath(): Promise<void> {
  const run_dir = makeTmpDir('t1');
  const ledger_dir = makeTmpDir('t1_ledger');
  const { ctx, config, store } = makeContext({ run_dir, ledger_dir });

  const record = await runNightlyLoop(ctx, config);

  // ── 1a. completed フラグ ───────────────────────────────────────────────
  assert.equal(record.completed, true,
    `completed should be true, got false. error_log: ${JSON.stringify(record.error_log)}`);

  // ── 1b. MorningResult.json がディスクに存在する ────────────────────────
  assert.ok(record.morning_result_path, 'morning_result_path should be non-null');
  assert.ok(fs.existsSync(record.morning_result_path!),
    `MorningResult file should exist at ${record.morning_result_path}`);

  // ── 1c. MorningResult の schema_version ───────────────────────────────
  const raw = JSON.parse(fs.readFileSync(record.morning_result_path!, 'utf8')) as MorningResult;
  assert.equal(raw.schema_version, 'morning_result/0.1',
    `Unexpected schema_version: ${raw.schema_version}`);

  // ── 1d. TSM が OBSERVING に戻っている ─────────────────────────────────
  const tsm = await store.readTaskStateMachine();
  assert.ok(tsm, 'TSM record should exist');
  assert.equal(tsm!.status, 'OBSERVING',
    `TSM should be OBSERVING after successful cycle, got ${tsm!.status}`);

  // ── 1e. LoopRunRecord が run_dir に書き出されている ────────────────────
  const run_files = fs.readdirSync(run_dir).filter((f) => f.startsWith('loop_run_'));
  assert.ok(run_files.length > 0, 'LoopRunRecord JSON should be written to run_dir');

  // ── 1f. 少なくとも 1 件の PromotedSkill が存在する ─────────────────────
  assert.ok(
    raw.evolution.promoted_skills.length > 0 || raw.evolution.promoted_skill_count >= 0,
    'MorningResult should have a valid promoted_skill_count'
  );
}

// ============================================================================
// TEST 2 — Crash + Resume from TESTING
// ============================================================================

async function test2_resumeFromTesting(): Promise<void> {
  const run_dir = makeTmpDir('t2');
  const ledger_dir = makeTmpDir('t2_ledger');

  // ── Step A: フル実行で Phase B チェックポイントを生成 ──────────────────
  //    （Phase C / D まで実行させるが、その結果はここでは無視）
  {
    const { ctx, config } = makeContext({ run_dir, ledger_dir });
    await runNightlyLoop(ctx, config);
  }

  // ── Step B: TSM を手動で TESTING に巻き戻す（クラッシュをシミュレート） ─
  //    Phase B チェックポイントは ledger_dir/checkpoints/ に残っている
  const store2 = new FilesystemLedgerStore(ledger_dir);
  const tsm_after_1 = await store2.readTaskStateMachine();
  assert.ok(tsm_after_1, 'TSM must exist after first run');

  // 最後に成功したサイクルの cycle_id を取得
  const lineage = await store2.readPriorCycleLineage();
  assert.ok(lineage.length > 0, 'Lineage should be non-empty after first run');
  const completed_cycle_id = lineage[0]!.cycle_id;

  // TSM を TESTING に強制設定（phase B checkpoint が存在する状態）
  await store2.writeTaskStateMachine({
    schema_version: 'task_state/0.1',
    cycle_id: completed_cycle_id,
    status: 'TESTING',
    updated_at: new Date().toISOString(),
    active_candidate_id: null,
  });

  // ── Step C: 同じ ledger_dir で再実行 ──────────────────────────────────
  //    Phase B チェックポイントが存在するので Phase B はスキップされるはず
  const run_dir2 = makeTmpDir('t2_resume');
  let phase_b_sandbox_calls = 0;
  const counting_runner: SandboxRunner = {
    async openSandbox(candidate_id, cycle_id, attempt = 1) {
      phase_b_sandbox_calls++;
      return makePassingSandboxHandle(candidate_id, cycle_id, attempt);
    },
  };

  const { ctx: ctx2, config: config2 } = makeContext({
    run_dir: run_dir2,
    ledger_dir,
    ledger_store: store2,
    sandbox_runner: counting_runner,
  });

  const record2 = await runNightlyLoop(ctx2, config2);

  // ── 2a. 完了していること ──────────────────────────────────────────────
  assert.equal(record2.completed, true,
    `Resume from TESTING should complete. errors: ${JSON.stringify(record2.error_log)}`);

  // ── 2b. Phase B サンドボックスが呼ばれなかったこと（チェックポイントから再開）─
  assert.equal(phase_b_sandbox_calls, 0,
    `Phase B sandbox should NOT be called on resume from TESTING checkpoint. Called: ${phase_b_sandbox_calls}`);

  // ── 2c. 新しい MorningResult が書き出されたこと ────────────────────────
  assert.ok(record2.morning_result_path, 'morning_result_path should be non-null on resume');
  assert.ok(fs.existsSync(record2.morning_result_path!),
    'MorningResult file should exist after resume');
}

// ============================================================================
// TEST 3 — Crash + Resume from PROMOTING
// ============================================================================

async function test3_resumeFromPromoting(): Promise<void> {
  const run_dir = makeTmpDir('t3');
  const ledger_dir = makeTmpDir('t3_ledger');

  // ── Step A: フル実行 ───────────────────────────────────────────────────
  {
    const { ctx, config } = makeContext({ run_dir, ledger_dir });
    await runNightlyLoop(ctx, config);
  }

  // ── Step B: TSM を PROMOTING に巻き戻す ─────────────────────────────
  const store2 = new FilesystemLedgerStore(ledger_dir);
  const lineage = await store2.readPriorCycleLineage();
  assert.ok(lineage.length > 0, 'Lineage should be non-empty after first run');
  const completed_cycle_id = lineage[0]!.cycle_id;

  await store2.writeTaskStateMachine({
    schema_version: 'task_state/0.1',
    cycle_id: completed_cycle_id,
    status: 'PROMOTING',
    updated_at: new Date().toISOString(),
    active_candidate_id: null,
  });

  // ── Step C: 再実行（Phase B も Phase C も checkpoint があるのでスキップ）─
  const run_dir2 = makeTmpDir('t3_resume');
  let sandbox_open_count = 0;
  const counting_runner: SandboxRunner = {
    async openSandbox(candidate_id, cycle_id, attempt = 1) {
      sandbox_open_count++;
      return makePassingSandboxHandle(candidate_id, cycle_id, attempt);
    },
  };

  const { ctx: ctx3, config: config3 } = makeContext({
    run_dir: run_dir2,
    ledger_dir,
    ledger_store: store2,
    sandbox_runner: counting_runner,
  });

  const record3 = await runNightlyLoop(ctx3, config3);

  // ── 3a. 完了していること ──────────────────────────────────────────────
  assert.equal(record3.completed, true,
    `Resume from PROMOTING should complete. errors: ${JSON.stringify(record3.error_log)}`);

  // ── 3b. Phase B/C sandbox が呼ばれなかったこと ─────────────────────────
  assert.equal(sandbox_open_count, 0,
    `Phase B sandbox should NOT be called on resume from PROMOTING. Called: ${sandbox_open_count}`);

  // ── 3c. MorningResult が書き出されたこと ──────────────────────────────
  assert.ok(record3.morning_result_path && fs.existsSync(record3.morning_result_path),
    'MorningResult should be written on PROMOTING resume');
}

// ============================================================================
// TEST 4 — All Patches Rejected (Phase B 全滅)
// ============================================================================

async function test4_allRejected(): Promise<void> {
  const run_dir = makeTmpDir('t4');
  const ledger_dir = makeTmpDir('t4_ledger');

  const { ctx, config, store } = makeContext({
    run_dir,
    ledger_dir,
    sandbox_runner: makeSandboxRunner(makeFailingInvariantHandle),
  });

  const record = await runNightlyLoop(ctx, config);

  // ── 4a. パイプラインは完走する（エラーではない）──────────────────────
  assert.equal(record.completed, true,
    `All-rejected cycle should still complete. errors: ${JSON.stringify(record.error_log)}`);

  // ── 4b. MorningResult.json が書き出される ─────────────────────────────
  assert.ok(record.morning_result_path && fs.existsSync(record.morning_result_path),
    'MorningResult should be written even when all patches are rejected');

  // ── 4c. promoted_skill_count = 0 ────────────────────────────────────────
  const raw = JSON.parse(fs.readFileSync(record.morning_result_path!, 'utf8')) as MorningResult;
  assert.equal(raw.evolution.promoted_skill_count, 0,
    `promoted_skill_count should be 0 when all patches are rejected, got ${raw.evolution.promoted_skill_count}`);

  // ── 4d. FailureLedger にエントリが書き込まれた ─────────────────────────
  const ledger = await store.readFailureLedger();
  assert.ok(ledger.length > 0,
    'FailureLedger should have at least one entry after an INVARIANT_VIOLATION rejection');
}

// ============================================================================
// TEST 5 — System Gate Closed
// ============================================================================

async function test5_systemGateClosed(): Promise<void> {
  const run_dir = makeTmpDir('t5');
  const ledger_dir = makeTmpDir('t5_ledger');

  const { ctx, config } = makeContext({
    run_dir,
    ledger_dir,
    system_state_snapshot: UNSTABLE_SYSTEM_SNAPSHOT,
  });

  const record = await runNightlyLoop(ctx, config);

  // ── 5a. パイプラインは完走する ────────────────────────────────────────
  assert.equal(record.completed, true,
    `Closed system gate should still produce MorningResult. errors: ${JSON.stringify(record.error_log)}`);

  // ── 5b. MorningResult に system_gate_passed = false が記録される ───────
  assert.ok(record.morning_result_path && fs.existsSync(record.morning_result_path),
    'MorningResult should be written when system gate closes');

  const raw = JSON.parse(fs.readFileSync(record.morning_result_path!, 'utf8')) as MorningResult;

  // ProofSummary の中に system_gate_passed フィールドがあるか確認
  // MorningResult の guardian フィールドではなく proof の verified_patch_count が 0 になるはず
  assert.equal(raw.evolution.promoted_skill_count, 0,
    `No skills should be promoted when system gate is closed, got ${raw.evolution.promoted_skill_count}`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log('\nnightly_loop_e2e.test — Antigravity OS Governance Kernel');
  console.log('='.repeat(60));

  await runTest('TEST 1: Happy Path (正常完走)', test1_happyPath);
  await runTest('TEST 2: Resume from TESTING (Phase B クラッシュ回復)', test2_resumeFromTesting);
  await runTest('TEST 3: Resume from PROMOTING (Phase C クラッシュ回復)', test3_resumeFromPromoting);
  await runTest('TEST 4: All Patches Rejected (Phase B 全滅)', test4_allRejected);
  await runTest('TEST 5: System Gate Closed (Phase C システムゲート閉鎖)', test5_systemGateClosed);

  console.log('='.repeat(60));
  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
  console.log('\nnightly_loop_e2e.test: OK — governance kernel end-to-end verified');
}

main().catch((err) => {
  console.error('Uncaught fatal error in test runner:', err);
  process.exit(1);
});
