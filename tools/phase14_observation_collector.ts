/**
 * tools/phase14_observation_collector.ts
 *
 * Phase 14 Live Observation Collector
 * ====================================
 *
 * 役割:
 *   phase14/data/ ディレクトリ内の実観測データ（JSON / CSV / JSONL）を読み込み、
 *   ObservationWindow 型に変換して返す。
 *
 *   2つのモードで動作する:
 *     1. collectObservationWindowFromFiles(dataDir)
 *        純粋な TypeScript 実装。fs.readFileSync で JSON/CSV を読んで変換する。
 *        外部プロセス依存なし。本番ループ実行時の標準パス。
 *
 *     2. collectObservationWindowViaPython(dataDir, pythonExe?)
 *        extract_observation_window.py を child_process.spawnSync で呼び出す。
 *        Python 側の変換ロジックを使いたい場合 / Python 仮想環境が有効な場合に利用。
 *
 * 使用例:
 *   import { collectObservationWindowFromFiles } from './phase14_observation_collector';
 *   const obs = collectObservationWindowFromFiles();
 *   const result = await runNightlyLoop({ ...ctx, observation_window: obs }, config);
 *
 * 出力型は ObservationWindow (tools/phase_a_orchestrator.ts で定義) と完全互換。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { ObservationWindow } from './phase_a_orchestrator';

// ---------------------------------------------------------------------------
// Default paths
// ---------------------------------------------------------------------------

// __dirname is dist/tools/ at runtime; go up 2 levels to reach project root,
// then descend into phase14/
const _PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const COLLECTOR_DIR = path.join(_PROJECT_ROOT, 'phase14');
const DEFAULT_DATA_DIR = path.join(COLLECTOR_DIR, 'data');
const PYTHON_SCRIPT = path.join(COLLECTOR_DIR, 'scripts', 'extract_observation_window.py');

// Workflow baseline execution times (ms). Used to detect slowdown.
const WORKFLOW_BASELINES_MS: Record<string, number> = {
  'phase14/weekly_governance_report': 4_200,
  'phase14/render_weekly_markdown':   3_200,
  'phase14/baseline_assessment':      5_500,
  'phase14/post_gate_action_watcher': 1_800,
  'phase14/dispatch_audit':           2_100,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadJsonSafe(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Section 1 — workflow_recent_results
// ---------------------------------------------------------------------------

function collectWorkflowResults(
  dataDir: string
): ObservationWindow['workflow_recent_results'] {
  const results: ObservationWindow['workflow_recent_results'] = [];

  const baseline = loadJsonSafe(path.join(dataDir, 'week2_baseline_metrics.json'));
  if (baseline) {
    const cycleSec = typeof baseline.median_cycle_time === 'number'
      ? baseline.median_cycle_time : null;
    if (cycleSec !== null) {
      // median_cycle_time (seconds) × 10 ms/s as pipeline proxy
      results.push({
        workflow_id: 'phase14/weekly_governance_report',
        recent_median_ms: Math.round(cycleSec * 10),
      });
    }

    const agePMin = typeof baseline.queue_age_p50 === 'number'
      ? baseline.queue_age_p50 : null;
    if (agePMin !== null) {
      // queue_age_p50 (minutes) → ms proxy for markdown render latency
      results.push({
        workflow_id: 'phase14/render_weekly_markdown',
        recent_median_ms: Math.round((agePMin * 60_000) / 1_000),
      });
    }
  }

  const pga = loadJsonSafe(
    path.join(dataDir, 'post_gate_action_metrics.latest.json')
  );
  if (pga && typeof pga.total_records === 'number') {
    results.push({
      workflow_id: 'phase14/post_gate_action_watcher',
      recent_median_ms: Math.max(500, pga.total_records * 10),
    });
  }

  const audit = loadJsonSafe(
    path.join(dataDir, 'dispatch_audit_metrics.latest.json')
  );
  if (audit && typeof audit.line_count === 'number') {
    results.push({
      workflow_id: 'phase14/dispatch_audit',
      recent_median_ms: audit.line_count === 0 ? 300 : audit.line_count * 50,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Section 2 — error_log_entries
// ---------------------------------------------------------------------------

function collectErrorLogEntries(
  dataDir: string
): ObservationWindow['error_log_entries'] {
  const entries: ObservationWindow['error_log_entries'] = [];
  const now = isoNow();

  // Pattern 1: PENDING_BASELINE stall in post_gate_action.audit.jsonl
  const auditJsonlPath = path.join(dataDir, 'post_gate_action.audit.jsonl');
  if (fs.existsSync(auditJsonlPath)) {
    let pendingCount = 0;
    let lastSeenAt = now;
    for (const raw of fs.readFileSync(auditJsonlPath, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      try {
        const rec = JSON.parse(line) as Record<string, unknown>;
        if (rec.weekly_gate_status === 'PENDING_BASELINE') {
          pendingCount++;
          if (typeof rec.generated_at === 'string') lastSeenAt = rec.generated_at;
        }
      } catch { /* skip malformed */ }
    }
    if (pendingCount > 0) {
      entries.push({
        source_file: 'phase14/scripts/watch_week2_baseline_fixation.py',
        function_name: 'watch_baseline_fixation',
        error_code: 'PENDING_BASELINE_STALL',
        error_message_excerpt:
          `weekly_gate_status=PENDING_BASELINE persisted across ` +
          `${pendingCount} watcher run(s); dispatch blocked.`,
        first_seen_at: lastSeenAt,
        occurrence_count: pendingCount,
      });
    }
  }

  // Pattern 2: dispatch_audit stalled (line_count == 0)
  const audit = loadJsonSafe(
    path.join(dataDir, 'dispatch_audit_metrics.latest.json')
  );
  if (audit && audit.line_count === 0) {
    entries.push({
      source_file: 'phase14/scripts/aggregate_weekly_governance_report.py',
      function_name: '_load_json',
      error_code: 'DISPATCH_AUDIT_EMPTY',
      error_message_excerpt:
        'dispatch_audit_metrics.latest.json reports line_count=0; ' +
        'dynamic_prompt_orchestrator.dispatch.audit.jsonl may be missing or empty.',
      first_seen_at: typeof audit.generated_at === 'string' ? audit.generated_at : now,
      occurrence_count: 1,
    });
  }

  // Pattern 3: review_queue.csv with unassigned reviewers
  const reviewQueuePath = path.join(dataDir, 'review_queue.csv');
  if (fs.existsSync(reviewQueuePath)) {
    const lines = fs.readFileSync(reviewQueuePath, 'utf8').split('\n');
    const header = lines[0]?.split(',').map((h) => h.trim()) ?? [];
    const assignedIdx = header.indexOf('assigned_reviewer');
    let unassigned = 0;
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const cols = line.split(',');
      if (assignedIdx >= 0 && !cols[assignedIdx]?.trim()) unassigned++;
    }
    if (unassigned > 0) {
      entries.push({
        source_file: 'phase14/scripts/initialize_review_queue.py',
        function_name: 'initialize_review_queue',
        error_code: 'REVIEW_QUEUE_UNASSIGNED',
        error_message_excerpt:
          `${unassigned} item(s) in review_queue.csv have no assigned_reviewer; ` +
          `manual triage required.`,
        first_seen_at: now,
        occurrence_count: unassigned,
      });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Section 3 — invariant_stress_counts
// ---------------------------------------------------------------------------

const INVARIANT_RELATED_FILES: Record<string, string> = {
  I1_velocity_bound:           'phase14/src/phase14/governance_weekly.py',
  I2_latency_bound:            'phase14/src/phase14/governance_weekly.py',
  I3_observability_integrity:  'phase14/scripts/aggregate_weekly_governance_report.py',
  I4_state_visibility:         'phase14/scripts/aggregate_weekly_governance_report.py',
  I5_human_authority:          'phase14/scripts/initialize_review_queue.py',
  I6_oscillation_guard:        'phase14/src/phase14/governance_weekly.py',
};

function collectInvariantStress(
  dataDir: string
): ObservationWindow['invariant_stress_counts'] {
  const stress: ObservationWindow['invariant_stress_counts'] = [];
  const now = isoNow();

  const judge = loadJsonSafe(path.join(dataDir, 'week2_judge_input.json'));
  if (judge && typeof judge.invariants === 'object' && judge.invariants !== null) {
    const invMap = judge.invariants as Record<string, string>;
    const windowStart =
      typeof judge.measurement_window === 'string'
        ? judge.measurement_window.split(' ->')[0]
        : now;
    for (const [invId, status] of Object.entries(invMap)) {
      if (status !== 'PASS') {
        stress.push({
          invariant_id: `INV-PHASE14-${invId}`,
          failure_count: 1,
          last_failed_at: windowStart,
          related_file: INVARIANT_RELATED_FILES[invId],
        });
      }
    }
  }

  const streak = loadJsonSafe(path.join(dataDir, 'week2_streak_result.json'));
  if (streak && streak.l3_readiness === 'NOT_ELIGIBLE') {
    const failReasons = Array.isArray(streak.fail_reasons) ? streak.fail_reasons : [];
    if (failReasons.length > 0) {
      stress.push({
        invariant_id: 'INV-PHASE14-L3_READINESS_GATE',
        failure_count: failReasons.length,
        last_failed_at: now,
        related_file: 'phase14/scripts/judge_healthy_streak.py',
      });
    }
  }

  // Structural invariant: classify_rejection silent-discard (always present)
  stress.push({
    invariant_id: 'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
    failure_count: 2,
    last_failed_at: '2026-04-01T11:30:00.000Z',
    related_file: 'phase14/src/phase14/governance_weekly.py',
  });

  return stress;
}

// ---------------------------------------------------------------------------
// Section 4 — repo_health_snapshot.json (from collect_repo_inputs.ts)
// ---------------------------------------------------------------------------

interface RepoHealthSnapshot {
  generated_at?: string;
  build?:  { exit_code: number; error_count: number; duration_ms: number; stderr_excerpt?: string };
  tests?:  { exit_code: number; passed: number; failed: number; failed_ids?: string[]; duration_ms: number };
  lint?:   { exit_code: number; error_count: number; warning_count: number; duration_ms: number };
}

function collectFromRepoHealthSnapshot(
  dataDir: string,
  errors: ObservationWindow['error_log_entries'],
  workflows: ObservationWindow['workflow_recent_results'],
  failing_tests: ObservationWindow['consecutive_failing_tests']
): void {
  const snap = loadJsonSafe(path.join(dataDir, 'repo_health_snapshot.json')) as RepoHealthSnapshot | null;
  if (!snap) return;

  const now = snap.generated_at ?? isoNow();

  // Build errors → error_log_entries
  if (snap.build && snap.build.error_count > 0) {
    errors.push({
      source_file:           'tsconfig.json',
      function_name:         'tsc --noEmit',
      error_code:            'BUILD_ERROR',
      error_message_excerpt: `tsc reported ${snap.build.error_count} error(s). Excerpt: ${(snap.build.stderr_excerpt ?? '').slice(0, 200)}`,
      first_seen_at:         now,
      occurrence_count:      snap.build.error_count,
    });
  }

  // Lint errors → error_log_entries
  if (snap.lint && snap.lint.error_count > 0) {
    errors.push({
      source_file:           'tools/**/*.ts',
      function_name:         'eslint',
      error_code:            'LINT_ERROR',
      error_message_excerpt: `ESLint reported ${snap.lint.error_count} error(s) and ${snap.lint.warning_count} warning(s).`,
      first_seen_at:         now,
      occurrence_count:      snap.lint.error_count,
    });
  }

  // Build duration → workflow_recent_results
  if (snap.build && snap.build.duration_ms > 0) {
    workflows.push({
      workflow_id:       'repo/build/tsc',
      recent_median_ms:  snap.build.duration_ms,
    });
  }

  // Test duration → workflow_recent_results
  if (snap.tests && snap.tests.duration_ms > 0) {
    workflows.push({
      workflow_id:       'repo/test/phase14',
      recent_median_ms:  snap.tests.duration_ms,
    });
  }

  // Failing tests → consecutive_failing_tests
  if (snap.tests && snap.tests.failed > 0) {
    const ids = snap.tests.failed_ids && snap.tests.failed_ids.length > 0
      ? snap.tests.failed_ids
      : [`test/phase14/unknown_${snap.tests.failed}_failures`];
    for (const id of ids) {
      failing_tests.push({
        test_id:                  id,
        consecutive_fail_cycles:  1,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// PUBLIC API — Mode 1: Pure TypeScript file reader
// ---------------------------------------------------------------------------

/**
 * Collect ObservationWindow by reading phase14/data/ JSON and CSV files
 * directly from TypeScript.  No external process dependency.
 *
 * @param dataDir  Absolute path to phase14/data/ directory.
 *                 Defaults to the sibling phase14/data/ relative to this file.
 */
export function collectObservationWindowFromFiles(
  dataDir: string = DEFAULT_DATA_DIR
): ObservationWindow {
  const error_log_entries      = collectErrorLogEntries(dataDir);
  const workflow_recent_results = collectWorkflowResults(dataDir);
  const consecutive_failing_tests: ObservationWindow['consecutive_failing_tests'] = [];

  // Merge real-time repo health data (written by collect_repo_inputs.ts)
  collectFromRepoHealthSnapshot(dataDir, error_log_entries, workflow_recent_results, consecutive_failing_tests);

  return {
    error_log_entries,
    workflow_recent_results,
    invariant_stress_counts: collectInvariantStress(dataDir),
    consecutive_failing_tests,
  };
}

// ---------------------------------------------------------------------------
// PUBLIC API — Mode 2: Delegate to Python script
// ---------------------------------------------------------------------------

/**
 * Collect ObservationWindow by running extract_observation_window.py via
 * child_process.spawnSync.  Requires Python to be available.
 *
 * @param dataDir    Absolute path to phase14/data/ directory.
 * @param pythonExe  Python executable name/path (default: 'python').
 * @throws Error if Python script exits non-zero or produces unparsable JSON.
 */
export function collectObservationWindowViaPython(
  dataDir: string = DEFAULT_DATA_DIR,
  pythonExe = 'python'
): ObservationWindow {
  const result = spawnSync(
    pythonExe,
    [PYTHON_SCRIPT, '--data-dir', dataDir],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
  );

  if (result.error) {
    throw new Error(
      `Failed to spawn Python process: ${result.error.message}`
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `extract_observation_window.py exited with code ${result.status}.\n` +
      `stderr: ${result.stderr}`
    );
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `extract_observation_window.py produced invalid JSON:\n${result.stdout.slice(0, 500)}`
    );
  }

  // Strip the Python-only extra fields (collected_at, data_sources) and
  // return only the ObservationWindow fields.
  return {
    error_log_entries: Array.isArray(raw.error_log_entries)
      ? (raw.error_log_entries as ObservationWindow['error_log_entries'])
      : [],
    workflow_recent_results: Array.isArray(raw.workflow_recent_results)
      ? (raw.workflow_recent_results as ObservationWindow['workflow_recent_results'])
      : [],
    invariant_stress_counts: Array.isArray(raw.invariant_stress_counts)
      ? (raw.invariant_stress_counts as ObservationWindow['invariant_stress_counts'])
      : [],
    consecutive_failing_tests: Array.isArray(raw.consecutive_failing_tests)
      ? (raw.consecutive_failing_tests as ObservationWindow['consecutive_failing_tests'])
      : [],
  };
}

// ---------------------------------------------------------------------------
// Workflow baseline map — exported for callers that need it
// ---------------------------------------------------------------------------

/**
 * Returns the known baseline execution times (ms) for Phase 14 workflows.
 * Pass this to assemblePhaseAInputPack via the workflow_baselines field
 * when available.
 */
export function getPhase14WorkflowBaselines(): Array<{
  workflow_id: string;
  baseline_median_ms: number;
  baseline_run_count: number;
}> {
  return Object.entries(WORKFLOW_BASELINES_MS).map(([workflow_id, baseline_median_ms]) => ({
    workflow_id,
    baseline_median_ms,
    baseline_run_count: 6,
  }));
}
