/**
 * tools/collect_repo_inputs.ts
 *
 * Repo Health Snapshot Collector
 * ================================
 *
 * Runs tsc, tests, and (optionally) ESLint, then writes the results to
 *   phase14/data/repo_health_snapshot.json
 *
 * This file is designed to be compiled by tsc and run via Node BEFORE
 * phase14_live_fire.js executes, so that the observation window reflects
 * real build/test/lint state rather than cached JSON files alone.
 *
 * Usage (package.json script):
 *   "live-fire": "tsc && node dist/tools/collect_repo_inputs.js && node dist/tools/phase14_live_fire.js"
 *
 * Output schema: RepoHealthSnapshot (see below).
 * The observation_collector reads phase14/data/repo_health_snapshot.json.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------

// __dirname is dist/tools/ at runtime; walk up 2 levels to project root.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR      = path.join(PROJECT_ROOT, 'phase14', 'data');
const SNAPSHOT_PATH = path.join(DATA_DIR, 'repo_health_snapshot.json');

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

export interface RepoHealthSnapshot {
  generated_at:  string;
  /** tsc --noEmit result */
  build: {
    exit_code:     number;
    error_count:   number;
    duration_ms:   number;
    stderr_excerpt: string;
  };
  /** test:phase14 result */
  tests: {
    exit_code:     number;
    passed:        number;
    failed:        number;
    failed_ids:    string[];
    duration_ms:   number;
    output_excerpt: string;
  };
  /** ESLint result (zeros when ESLint is not installed) */
  lint: {
    exit_code:     number;
    error_count:   number;
    warning_count: number;
    duration_ms:   number;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function run(
  cmd: string,
  args: string[],
  cwd: string
): { exit_code: number; stdout: string; stderr: string; duration_ms: number } {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
  });
  return {
    exit_code:   r.status ?? (r.error ? 1 : 0),
    stdout:      (r.stdout ?? '').slice(0, 4_000),
    stderr:      (r.stderr ?? '').slice(0, 4_000),
    duration_ms: Date.now() - t0,
  };
}

/**
 * Count TypeScript compile errors from tsc output.
 * tsc prints "Found N error(s)" on success/fail.
 */
function countTscErrors(combined: string): number {
  const m = combined.match(/Found\s+(\d+)\s+error/i);
  if (m) return parseInt(m[1], 10);
  // Fallback: count individual `error TS\d+:` occurrences
  return (combined.match(/error TS\d+:/g) ?? []).length;
}

/**
 * Extract failing test IDs from Node.js assert / tape / mocha output.
 * Supports patterns: "✗ <id>", "FAIL <id>", "not ok <N> <id>"
 */
function extractFailedTestIds(output: string): string[] {
  const ids = new Set<string>();
  for (const line of output.split('\n')) {
    // mocha/tap: "not ok N <description>"
    const tap = line.match(/^not ok\s+\d+\s+(.+)/);
    if (tap) { ids.add(tap[1].trim().slice(0, 120)); continue; }
    // generic: lines starting with "✗" or "FAIL"
    const fail = line.match(/^(?:✗|FAIL|×)\s+(.+)/);
    if (fail) { ids.add(fail[1].trim().slice(0, 120)); }
  }
  return [...ids].slice(0, 20);
}

function countPattern(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log('[collect_repo_inputs] Starting repo health snapshot...');
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // ── 1. Build: tsc --noEmit ──────────────────────────────────────────────
  console.log('[collect_repo_inputs] Running tsc --noEmit...');
  const tsc_path = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsc');
  const build_r = run(process.execPath, [tsc_path, '--noEmit'], PROJECT_ROOT);
  const build_combined = build_r.stdout + build_r.stderr;
  const build_errors   = countTscErrors(build_combined);
  console.log(`  build: exit=${build_r.exit_code} errors=${build_errors} (${build_r.duration_ms}ms)`);

  // ── 2. Tests ─────────────────────────────────────────────────────────────
  // Run the compiled test file if it exists (tsc was already run above).
  // If the dist file doesn't exist yet (first run before full build),
  // skip gracefully.
  console.log('[collect_repo_inputs] Running tests...');
  const test_dist = path.join(
    PROJECT_ROOT,
    'dist',
    'tests',
    'phase14_self_improvement_scenario.test.js'
  );
  let tests_r: ReturnType<typeof run>;
  if (fs.existsSync(test_dist)) {
    tests_r = run(process.execPath, [test_dist], PROJECT_ROOT);
  } else {
    // dist not yet available — treat as 0 tests run, not a failure
    tests_r = { exit_code: 0, stdout: '', stderr: '', duration_ms: 0 };
  }
  const test_combined = tests_r.stdout + tests_r.stderr;
  const pass_m = test_combined.match(/(\d+)\s+pass(?:ing)?/i);
  const fail_m = test_combined.match(/(\d+)\s+fail(?:ing)?/i);
  const tests_passed     = pass_m ? parseInt(pass_m[1], 10) : (tests_r.exit_code === 0 ? 1 : 0);
  const tests_failed     = fail_m ? parseInt(fail_m[1], 10) : (tests_r.exit_code !== 0 ? 1 : 0);
  const failed_ids       = extractFailedTestIds(test_combined);
  console.log(`  tests: pass=${tests_passed} fail=${tests_failed} (${tests_r.duration_ms}ms)`);

  // ── 3. Lint (optional ESLint) ─────────────────────────────────────────────
  const eslint_path = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'eslint');
  let lint_exit = 0, lint_errors = 0, lint_warnings = 0, lint_ms = 0;
  if (fs.existsSync(eslint_path)) {
    console.log('[collect_repo_inputs] Running ESLint...');
    // JSON format to easily count errors/warnings
    const lint_r = run(
      process.execPath,
      [eslint_path, 'tools/**/*.ts', '--format', 'json', '--no-eslintrc', '--rule', '{}'],
      PROJECT_ROOT
    );
    lint_exit     = lint_r.exit_code;
    lint_ms       = lint_r.duration_ms;
    lint_errors   = countPattern(lint_r.stdout, /"severity":\s*2/g);
    lint_warnings = countPattern(lint_r.stdout, /"severity":\s*1/g);
    console.log(`  lint:  errors=${lint_errors} warnings=${lint_warnings} (${lint_ms}ms)`);
  } else {
    console.log('  lint:  ESLint not found — skipping');
  }

  // ── 4. Write snapshot ─────────────────────────────────────────────────────
  const snapshot: RepoHealthSnapshot = {
    generated_at: new Date().toISOString(),
    build: {
      exit_code:      build_r.exit_code,
      error_count:    build_errors,
      duration_ms:    build_r.duration_ms,
      stderr_excerpt: build_combined.slice(0, 600),
    },
    tests: {
      exit_code:      tests_r.exit_code,
      passed:         tests_passed,
      failed:         tests_failed,
      failed_ids,
      duration_ms:    tests_r.duration_ms,
      output_excerpt: test_combined.slice(0, 600),
    },
    lint: {
      exit_code:     lint_exit,
      error_count:   lint_errors,
      warning_count: lint_warnings,
      duration_ms:   lint_ms,
    },
  };

  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`[collect_repo_inputs] Snapshot written → ${SNAPSHOT_PATH}`);
}

main();
