/**
 * tools/openclaw_cli.ts
 *
 * OpenClaw CLI Adapter — External Request Entry Point
 * ====================================================
 *
 * Usage:
 *   npm run openclaw -- --action <action> --target <target> --risk <LOW|MEDIUM|HIGH> [--params <json>] [--justification <text>]
 *   npm run openclaw -- --file <request.json>
 *
 * Actions (LOW risk):
 *   query_morning_result    — 最新サイクルの MorningResult を取得
 *   query_state             — TaskStateMachineRecord の現在ステータスを取得
 *   query_environment       — 最新 EnvironmentProfile / WorldShiftReport を取得
 *   list_pending_review     — 人間レビュー待ちの patch_id 一覧を取得
 *   query_hints             — AdaptationMemory から高スコア色 hint ブロックを取得
 *
 * Actions (MEDIUM risk):
 *   enqueue_candidate        — Phase A 評価キューにパッチ候補を登録
 *   approve_human_review     — 人間レビュー承認
 *   reject_human_review      — 人間レビュー棄却
 *
 * Exit codes:
 *   0  — PASS
 *   1  — REJECT (soft; caller may retry with corrected request)
 *   2  — HARD_REJECT (permanent; invariant violation or forbidden target)
 *   3  — CLI usage error (bad arguments)
 *
 * Output: JSON-serialised GatewayDecision to stdout.
 * Errors: plaintext to stderr.
 *
 * Audit log: phase14/data/openclaw_gateway_audit.jsonl (append-only JSONL)
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  OpenClawGateway,
  DEFAULT_FORBIDDEN_TARGETS,
  DEFAULT_BENCHMARK_PROTECTED_PATHS,
} from './openclaw_gateway';
import type { OpenClawRequest, OpenClawRiskLevel, OpenClawAction } from '../contract/openclaw_gateway';

// ---------------------------------------------------------------------------
// .env loader (same pattern as phase14_live_fire.ts)
// ---------------------------------------------------------------------------
(function loadDotenv(): void {
  const env_paths = [
    path.join(__dirname, '..', '..', '.env'),
    path.join(__dirname, '..', '..', '..', '.env'),
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
    break;
  }
})();

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PHASE14_DATA_DIR = path.join(PROJECT_ROOT, 'phase14', 'data');

// ---------------------------------------------------------------------------
// Argument parser
// ---------------------------------------------------------------------------
interface ParsedArgs {
  file?: string;
  action?: string;
  target?: string;
  risk?: string;
  params?: string;
  justification?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--file'         && argv[i + 1]) { args.file = argv[++i]!; continue; }
    if (a === '--action'       && argv[i + 1]) { args.action = argv[++i]!; continue; }
    // --target allows empty string values (READ ops pass --target "")
    if (a === '--target'       && i + 1 < argv.length) { args.target = argv[++i]!; continue; }
    if (a === '--risk'         && argv[i + 1]) { args.risk = argv[++i]!; continue; }
    if (a === '--params'       && argv[i + 1]) { args.params = argv[++i]!; continue; }
    if (a === '--justification' && argv[i + 1]) { args.justification = argv[++i]!; continue; }
  }
  return args;
}

function printUsage(): void {
  const lines = [
    '',
    'OpenClaw CLI Adapter — Usage:',
    '',
    '  # From command-line flags:',
    '  npm run openclaw -- --action query_state --target "" --risk LOW',
    '  npm run openclaw -- --action enqueue_candidate --target "aggregate_weekly" \\',
    '                       --risk MEDIUM --justification "add existence check" \\',
    '                       --params \'{"patch_diff":"--- a/...","rationale":"...","estimated_blast_radius":"SELF"}\'',
    '',
    '  # From a request JSON file:',
    '  npm run openclaw -- --file path/to/request.json',
    '',
    'Options:',
    '  --action        OpenClaw action (query_morning_result|query_state|query_environment|',
    '                  list_pending_review|query_hints|enqueue_candidate|approve_human_review|reject_human_review)',
    '  --target        Target component (empty string for READ ops)',
    '  --risk          Risk level: LOW (READ ops) | MEDIUM (WRITE ops) | HIGH (always blocked)',
    '  --params        JSON string of action-specific parameters (optional for READ ops)',
    '  --justification Free-text justification (optional; recommended for WRITE ops)',
    '  --file          Path to a pre-built OpenClawRequest JSON file',
    '',
    'Exit codes:  0=PASS  1=REJECT  2=HARD_REJECT  3=CLI usage error',
    '',
  ];
  lines.forEach((l) => console.error(l));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    process.exit(3);
  }

  const args = parseArgs(argv);

  // ── Build OpenClawRequest ─────────────────────────────────────────────────
  let req: OpenClawRequest;

  if (args.file) {
    // Load from file
    const file_path = path.resolve(args.file);
    if (!fs.existsSync(file_path)) {
      console.error(`[ERROR] File not found: ${file_path}`);
      process.exit(3);
    }
    try {
      req = JSON.parse(fs.readFileSync(file_path, 'utf8')) as OpenClawRequest;
      // Ensure request_id and submitted_at are present
      if (!req.request_id) req.request_id = randomUUID();
      if (!req.submitted_at) req.submitted_at = new Date().toISOString();
    } catch (e) {
      console.error(`[ERROR] Failed to parse request file: ${String(e)}`);
      process.exit(3);
    }
  } else {
    // Build from flags
    if (!args.action) {
      console.error('[ERROR] --action is required');
      printUsage();
      process.exit(3);
    }
    if (args.target === undefined) {
      console.error('[ERROR] --target is required (use "" for READ ops)');
      printUsage();
      process.exit(3);
    }
    if (!args.risk) {
      console.error('[ERROR] --risk is required (LOW | MEDIUM | HIGH)');
      printUsage();
      process.exit(3);
    }

    const risk = args.risk.toUpperCase() as OpenClawRiskLevel;
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(risk)) {
      console.error(`[ERROR] Invalid --risk value: '${args.risk}'. Must be LOW, MEDIUM, or HIGH.`);
      process.exit(3);
    }

    let parameters: Record<string, unknown> = {};
    if (args.params) {
      try {
        parameters = JSON.parse(args.params) as Record<string, unknown>;
      } catch (e) {
        console.error(`[ERROR] --params is not valid JSON: ${String(e)}`);
        process.exit(3);
      }
    }

    req = {
      request_id: randomUUID(),
      submitted_at: new Date().toISOString(),
      action: args.action as OpenClawAction,
      target: args.target,
      risk_level: risk,
      parameters,
      ...(args.justification ? { justification: args.justification } : {}),
    };
  }

  // ── Instantiate Gateway ───────────────────────────────────────────────────
  const gateway = new OpenClawGateway({
    max_enqueue_per_day: 10,
    forbidden_target_substrings: DEFAULT_FORBIDDEN_TARGETS,
    benchmark_protected_paths: DEFAULT_BENCHMARK_PROTECTED_PATHS,
    audit_log_path: path.join(PHASE14_DATA_DIR, 'openclaw_gateway_audit.jsonl'),
    adaptation_memory_path: path.join(PHASE14_DATA_DIR, 'adaptation_memory.jsonl'),
  });

  // beginCycle with a synthetic CLI cycle id so audit entries correlate
  const cli_cycle_id = `cli-${new Date().toISOString().slice(0, 10)}`;
  gateway.beginCycle(cli_cycle_id);

  // ── Evaluate ──────────────────────────────────────────────────────────────
  const decision = gateway.process(req);

  // ── Output ────────────────────────────────────────────────────────────────
  const output = JSON.stringify({
    verdict: decision.verdict,
    request_id: decision.request_id,
    approved_action: decision.approved_action,
    reject_code: decision.reject_code,
    reason: decision.reason,
    evaluated_at: decision.evaluated_at,
  }, null, 2);

  console.log(output);

  // ── If PASS (READ op): resolve and print the data ─────────────────────────
  if (decision.verdict === 'PASS') {    // query_hints: print payload hint_text directly if available
    if (req.action === 'query_hints' && decision.payload) {
      const p = decision.payload as {
        hint_text: string;
        total_entries: number;
        top_n: number;
        expired_hints_excluded: number;
      };
      const expiry_info = p.expired_hints_excluded > 0
        ? `, expired_excluded=${p.expired_hints_excluded}`
        : '';
      console.log(`\n[HINTS] total_entries=${p.total_entries}, top_n=${p.top_n}${expiry_info}`);
      console.log(p.hint_text);
      process.exit(0);
    }    await handlePassedRequest(req);
    process.exit(0);
  } else if (decision.verdict === 'REJECT') {
    process.exit(1);
  } else {
    // HARD_REJECT
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// READ resolver — fetch actual data for passed READ ops
// ---------------------------------------------------------------------------
async function handlePassedRequest(req: OpenClawRequest): Promise<void> {
  const action = req.action;

  if (action === 'query_state') {
    // Read the latest TSM record from the shared ledger
    const ledger_dir = path.join(PROJECT_ROOT, 'phase14', 'data', 'ledger');
    const tsm_path = path.join(ledger_dir, 'task_state_machine.json');
    if (!fs.existsSync(tsm_path)) {
      console.error('[INFO] No TSM record found (no cycle has run yet)');
      return;
    }
    const tsm = JSON.parse(fs.readFileSync(tsm_path, 'utf8'));
    console.log('\n[DATA] TaskStateMachine:');
    console.log(JSON.stringify(tsm, null, 2));
    return;
  }

  if (action === 'query_morning_result') {
    // Find the most recent morning_result JSON in live_fire_runs
    const runs_dir = path.join(PROJECT_ROOT, 'phase14', 'data', 'live_fire_runs');
    if (!fs.existsSync(runs_dir)) {
      console.error('[INFO] No live_fire_runs directory found');
      return;
    }
    const runs = fs.readdirSync(runs_dir).sort();
    if (runs.length === 0) {
      console.error('[INFO] No runs found in live_fire_runs/');
      return;
    }
    const latest_run = runs.at(-1)!;
    const audit_dir = path.join(runs_dir, latest_run, 'audit');
    if (!fs.existsSync(audit_dir)) {
      console.error(`[INFO] No audit dir for run ${latest_run}`);
      return;
    }
    const mr_file = fs.readdirSync(audit_dir).find((f) => f.startsWith('morning_result_'));
    if (!mr_file) {
      console.error('[INFO] No morning_result JSON found');
      return;
    }
    const mr = JSON.parse(fs.readFileSync(path.join(audit_dir, mr_file), 'utf8'));
    console.log('\n[DATA] MorningResult (latest run: ' + latest_run + '):')
    // Print key fields only (avoid flooding terminal)
    console.log(JSON.stringify({
      cycle_id: mr.cycle_id,
      generated_at: mr.generated_at,
      tier: mr.evolution?.tier,
      tier_delta: mr.evolution?.tier_delta,
      security_posture: mr.guardian?.security_posture,
      environment_status: mr.display?.environment_status,
      show_world_shift: mr.display?.show_world_shift,
      gateway_summary: mr.gateway_summary,
    }, null, 2));
    return;
  }

  if (action === 'query_environment') {
    // Read EnvironmentProfile
    const env_path = path.join(PHASE14_DATA_DIR, 'environment_profile.json');
    if (!fs.existsSync(env_path)) {
      console.error('[INFO] No environment_profile.json found');
      return;
    }
    const env = JSON.parse(fs.readFileSync(env_path, 'utf8'));
    console.log('\n[DATA] EnvironmentProfile:');
    console.log(JSON.stringify(env, null, 2));
    return;
  }

  if (action === 'list_pending_review') {
    // Read human review queue from ledger
    const review_path = path.join(PROJECT_ROOT, 'phase14', 'data', 'ledger', 'human_review_queue.json');
    if (!fs.existsSync(review_path)) {
      console.log('\n[DATA] Pending Human Review: (none)');
      return;
    }
    const queue = JSON.parse(fs.readFileSync(review_path, 'utf8'));
    console.log('\n[DATA] Pending Human Review:');
    console.log(JSON.stringify(queue, null, 2));
    return;
  }

  // WRITE ops (enqueue_candidate, approve/reject_human_review):
  // These are structural stubs — they log intent and acknowledge.
  // Actual Phase A queue injection happens via the nightly loop runner.
  if (action === 'enqueue_candidate') {
    console.log('\n[ENQUEUED] Candidate logged for next Phase A cycle.');
    console.log('  Note: Phase A will evaluate this in the next nightly run.');
    // Persist the enqueue request to a queue file for nightly runner pickup
    const queue_path = path.join(PHASE14_DATA_DIR, 'openclaw_enqueue_queue.jsonl');
    const entry = {
      queued_at: new Date().toISOString(),
      request_id: req.request_id,
      target: req.target,
      patch_diff: req.parameters['patch_diff'],
      rationale: req.parameters['rationale'],
      estimated_blast_radius: req.parameters['estimated_blast_radius'],
      justification: req.justification ?? null,
    };
    fs.appendFileSync(queue_path, JSON.stringify(entry) + '\n', 'utf8');
    console.log(`  Persisted to: ${queue_path}`);
    return;
  }

  if (action === 'approve_human_review' || action === 'reject_human_review') {
    const verdict_label = action === 'approve_human_review' ? 'APPROVE' : 'REJECT';
    console.log(`\n[${verdict_label}] Review decision logged.`);
    console.log('  Note: Decision will take effect in next Phase C cycle.');
    return;
  }
}

main().catch((err) => {
  console.error('[FATAL] ' + String(err));
  process.exit(3);
});
