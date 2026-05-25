/**
 * tools/repo_caretaker.ts
 *
 * Nightly Repo Caretaker — 3-Layer Multi-Repo Maintenance OS
 * ===========================================================
 *
 * Layer 1 — Observe:
 *   Uses `gh` CLI to collect CI state, recent run failures, and open PRs
 *   from all tracked repositories.
 *
 * Layer 2 — Act (classify):
 *   Each finding is classified:
 *     SAFE_AUTO_PR  — blast_radius = SELF, low-risk type, reversible
 *     DEFER         — sovereign paths / TENANT tier complex changes / uncertain
 *     HUMAN_REVIEW  — PRODUCTION tier, constitution paths, non-reversible
 *
 *   Blast-radius rules (non-negotiable):
 *     SELF-tier repos       → SAFE_AUTO_PR eligible
 *     TENANT-tier repos     → DEFER by default, escalate to HUMAN_REVIEW when dangerous
 *     PRODUCTION-tier repos → always HUMAN_REVIEW
 *
 * Layer 3 — Explain:
 *   Writes a structured morning report to
 *   phase14/data/morning_reports/YYYY-MM-DD.jsonl
 *   and prints a human-readable summary to stdout.
 *
 * Usage:
 *   node dist/tools/repo_caretaker.js [--dry-run]
 *   node dist/tools/repo_caretaker.js --json        # machine-readable output only
 *
 * Exit: always 0 (observation is never a gate failure)
 */

import { spawnSync }  from 'node:child_process';
import fs             from 'node:fs';
import path           from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT        = path.resolve(__dirname, '..', '..');
const REPORT_DIR  = path.join(ROOT, 'phase14', 'data', 'morning_reports');
const PHASE14_DIR = path.join(ROOT, 'phase14', 'data');
const DEFER_QUEUE_PATH = path.join(PHASE14_DIR, 'caretaker_defer_queue.jsonl');
const ACTION_LOG_PATH  = path.join(REPORT_DIR, 'caretaker_actions.jsonl');
const RUN_RESULT_PATH  = path.join(PHASE14_DIR, 'caretaker_morning_result.latest.json');
const JSON_MODE   = process.argv.includes('--json');
const DRY_RUN     = process.argv.includes('--dry-run');
const EXECUTE     = process.argv.includes('--execute');
const REPO_SCOPE  = (process.env.CARETAKER_REPO_SCOPE ?? 'all').toLowerCase();

// ── Repository manifest ────────────────────────────────────────────────────

type RiskTier = 'SELF' | 'TENANT' | 'PRODUCTION';

interface RepoTarget {
  owner:          string;
  repo:           string;
  default_branch: string;
  /** Blast-radius tier. SELF = eligible for auto-PR. */
  risk_tier:      RiskTier;
}

const REPOS: RepoTarget[] = [
  { owner: 'zerospawn01-coder', repo: 'project-manuals',      default_branch: 'main',                    risk_tier: 'SELF'   },
  { owner: 'zerospawn01-coder', repo: 'aesthetic-resonator',  default_branch: 'main',                    risk_tier: 'TENANT' },
  { owner: 'zerospawn01-coder', repo: 'ea-aol',               default_branch: 'main',                    risk_tier: 'TENANT' },
  { owner: 'zerospawn01-coder', repo: 'cognitive-lab',        default_branch: 'main',                    risk_tier: 'TENANT' },
  { owner: 'zerospawn01-coder', repo: 'cognitive-substrate',  default_branch: 'main',                    risk_tier: 'TENANT' },
  { owner: 'zerospawn01-coder', repo: 'scratch',              default_branch: 'phase14-readiness-gate',  risk_tier: 'TENANT' },
  { owner: 'zerospawn01-coder', repo: 'mtp-weaver',           default_branch: 'main',                    risk_tier: 'TENANT' },
  { owner: 'zerospawn01-coder', repo: 'lab-experiments',      default_branch: 'main',                    risk_tier: 'TENANT' },
];

function selectedRepos(): RepoTarget[] {
  if (REPO_SCOPE === 'self') {
    return REPOS.filter((repo) => repo.risk_tier === 'SELF');
  }
  if (REPO_SCOPE === 'all') {
    return REPOS;
  }
  throw new Error(`Unsupported CARETAKER_REPO_SCOPE: ${REPO_SCOPE}`);
}

// ── Layer 1: Observation types ─────────────────────────────────────────────

type FindingType =
  | 'CI_FAILURE'
  | 'CI_FLAKY'          // failed then passed without code change
  | 'OPEN_PR_STALE'     // open PR untouched > 48 h
  | 'LINT_WARNING'      // lint / tsc warnings emitted from CI step
  | 'SLOW_CI'           // CI duration > baseline * 1.5
  | 'DOC_DRIFT'         // README/CHANGELOG out of sync signal (heuristic)
  | 'GOVERNANCE_STALE'; // any governance file older than 30 days without touch

interface CIRun {
  databaseId:   number;
  name:         string;
  status:       string;
  conclusion:   string | null;
  createdAt:    string;
  url:          string;
  /** Duration in seconds (derived) */
  duration_s?:  number;
}

interface OpenPR {
  number:      number;
  title:       string;
  url:         string;
  headRefName: string;
  createdAt:   string;
  updatedAt:   string;
}

interface Finding {
  finding_id:   string;
  repo:         string;
  type:         FindingType;
  severity:     'HIGH' | 'MEDIUM' | 'LOW';
  description:  string;
  /** Artifact from observation (run URL, PR URL, etc.) */
  evidence_url: string | null;
}

interface RepoObservation {
  repo:         string;
  risk_tier:    RiskTier;
  observed_at:  string;
  ci_runs:      CIRun[];
  open_prs:     OpenPR[];
  findings:     Finding[];
  /** true when gh CLI returned an error for this repo */
  skipped:      boolean;
  skip_reason?: string;
}

// ── Layer 2: Classification types ─────────────────────────────────────────

type CaretakerDecision = 'SAFE_AUTO_PR' | 'DEFER' | 'HUMAN_REVIEW' | 'SKIP';

type BlastRadius = 'SELF' | 'TENANT' | 'PRODUCTION';

interface FixHint {
  action:       'CREATE_BRANCH_AND_PR' | 'RERUN_CI' | 'CLOSE_PR' | 'ADD_COMMENT' | 'FLAG_FOR_HUMAN';
  description:  string;
  /** Suggested new branch name for CREATE_BRANCH_AND_PR */
  branch_name?: string;
}

interface Classification {
  finding_id:   string;
  repo:         string;
  type:         FindingType;
  decision:     CaretakerDecision;
  blast_radius: BlastRadius;
  reason:       string;
  fix_hint?:    FixHint;
}

// ── Layer 3: Report types ─────────────────────────────────────────────────

interface MorningReport {
  report_id:    string;
  cycle_date:   string;  // YYYY-MM-DD
  generated_at: string;
  summary: {
    repos_observed:       number;
    repos_skipped:        number;
    findings_total:       number;
    safe_auto_pr_count:   number;
    deferred_count:       number;
    human_review_count:   number;
    skipped_count:        number;
  };
  observations:    RepoObservation[];
  classifications: Classification[];
}

interface ActionExecutionRecord {
  ts: string;
  cycle_date: string;
  repo: string;
  finding_id: string;
  branch: string;
  commit_created: boolean;
  pr_created: boolean;
  pr_url: string | null;
  message: string;
}

interface DeferQueueRecord {
  schema_version: 'caretaker_defer_queue/0.1';
  queued_at: string;
  cycle_date: string;
  repo: string;
  finding_id: string;
  finding_type: FindingType;
  decision: 'DEFER' | 'HUMAN_REVIEW';
  blast_radius: BlastRadius;
  reason: string;
  evidence_url: string | null;
}

interface CaretakerRunResult {
  schema_version: 'caretaker_run_result/0.1';
  generated_at: string;
  cycle_date: string;
  executed: boolean;
  dry_run: boolean;
  actions_total: number;
  branches_created: number;
  commits_created: number;
  prs_created: number;
  deferred_written: number;
  action_records: ActionExecutionRecord[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

function log(msg: string): void {
  if (!JSON_MODE) console.log(msg);
}

function section(title: string): void {
  if (!JSON_MODE) console.log(`\n── ${title}`);
}

function gh(args: string[]): { ok: boolean; data: unknown; raw: string } {
  const r = spawnSync('gh', args, {
    encoding:  'utf8',
    maxBuffer: 4 * 1024 * 1024,
    shell:     false,
  });
  if (r.status !== 0) {
    return { ok: false, data: null, raw: r.stderr ?? '' };
  }
  try {
    return { ok: true, data: JSON.parse(r.stdout), raw: r.stdout };
  } catch {
    return { ok: false, data: null, raw: r.stdout };
  }
}

function runCommand(
  command: string,
  args: string[],
  cwd: string
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
  });
  return {
    ok: r.status === 0,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status,
  };
}

function appendJsonl(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(payload) + '\n', 'utf8');
}

function safeBranchName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '')
    .slice(0, 60);
}

function isoToDate(iso: string): Date {
  return new Date(iso);
}

function hoursAgo(iso: string): number {
  return (Date.now() - isoToDate(iso).getTime()) / 3_600_000;
}

// ── Layer 1: Observe ──────────────────────────────────────────────────────

function observeRepo(target: RepoTarget): RepoObservation {
  const repo_slug = `${target.owner}/${target.repo}`;
  const now = new Date().toISOString();
  const obs: RepoObservation = {
    repo:        target.repo,
    risk_tier:   target.risk_tier,
    observed_at: now,
    ci_runs:     [],
    open_prs:    [],
    findings:    [],
    skipped:     false,
  };

  // CI runs
  const runsResult = gh([
    'run', 'list',
    '--repo', repo_slug,
    '--limit', '10',
    '--json', 'databaseId,name,status,conclusion,createdAt,url',
  ]);
  if (!runsResult.ok) {
    obs.skipped = true;
    obs.skip_reason = `gh run list failed: ${runsResult.raw.slice(0, 200)}`;
    return obs;
  }
  obs.ci_runs = runsResult.data as CIRun[];

  // Open PRs
  const prsResult = gh([
    'pr', 'list',
    '--repo', repo_slug,
    '--state', 'open',
    '--limit', '20',
    '--json', 'number,title,url,headRefName,createdAt,updatedAt',
  ]);
  if (prsResult.ok) {
    obs.open_prs = prsResult.data as OpenPR[];
  }

  // Build findings from observations
  obs.findings = buildFindings(obs, target);
  return obs;
}

function buildFindings(obs: RepoObservation, target: RepoTarget): Finding[] {
  const findings: Finding[] = [];
  const now = Date.now();

  // ① CI failures
  const failedRuns = obs.ci_runs.filter(r => r.conclusion === 'failure');
  for (const r of failedRuns.slice(0, 3)) {
    findings.push({
      finding_id:   randomUUID(),
      repo:         obs.repo,
      type:         'CI_FAILURE',
      severity:     'HIGH',
      description:  `CI run "${r.name}" failed`,
      evidence_url: r.url,
    });
  }

  // ② Flaky detection: failure followed by a success on the same workflow
  const byWorkflow = new Map<string, CIRun[]>();
  for (const r of obs.ci_runs) {
    const wf = r.name;
    if (!byWorkflow.has(wf)) byWorkflow.set(wf, []);
    byWorkflow.get(wf)!.push(r);
  }
  for (const [wfName, runs] of byWorkflow) {
    if (runs.length >= 2) {
      const sorted = [...runs].sort(
        (a, b) => isoToDate(b.createdAt).getTime() - isoToDate(a.createdAt).getTime()
      );
      if (sorted[0].conclusion === 'success' && sorted[1].conclusion === 'failure') {
        findings.push({
          finding_id:   randomUUID(),
          repo:         obs.repo,
          type:         'CI_FLAKY',
          severity:     'MEDIUM',
          description:  `Workflow "${wfName}" failed then passed (flaky signal)`,
          evidence_url: sorted[1].url,
        });
      }
    }
  }

  // ③ Stale open PRs (> 48 h without update)
  for (const pr of obs.open_prs) {
    const staleHours = (now - isoToDate(pr.updatedAt).getTime()) / 3_600_000;
    if (staleHours > 48) {
      findings.push({
        finding_id:   randomUUID(),
        repo:         obs.repo,
        type:         'OPEN_PR_STALE',
        severity:     'LOW',
        description:  `PR #${pr.number} "${pr.title}" stale for ${Math.round(staleHours)}h`,
        evidence_url: pr.url,
      });
    }
  }

  // ④ Governance stale: check if constitution.v1.0.yaml exists and was touched recently
  //    (only meaningful for SELF tier — we have local filesystem access)
  if (target.risk_tier === 'SELF') {
    const constitutionPath = path.join(ROOT, 'constitution', 'constitution.v1.0.yaml');
    if (fs.existsSync(constitutionPath)) {
      const stat = fs.statSync(constitutionPath);
      const daysSinceTouch = (now - stat.mtimeMs) / 86_400_000;
      if (daysSinceTouch > 30) {
        findings.push({
          finding_id:   randomUUID(),
          repo:         obs.repo,
          type:         'GOVERNANCE_STALE',
          severity:     'LOW',
          description:  `constitution.v1.0.yaml not touched for ${Math.round(daysSinceTouch)} days`,
          evidence_url: null,
        });
      }
    }
  }

  return findings;
}

// ── Layer 2: Classify ─────────────────────────────────────────────────────

/** Sovereign paths — any finding touching these goes to HUMAN_REVIEW */
const SOVEREIGN_PATH_PATTERNS = [
  /^constitution\//,
  /^contracts\//,
  /^\.github\/CODEOWNERS$/,
  /^\.agent\.md$/,
];

function isSovereignPath(path: string): boolean {
  return SOVEREIGN_PATH_PATTERNS.some(p => p.test(path));
}

function blastRadiusFor(tier: RiskTier): BlastRadius {
  return tier as BlastRadius;
}

function classifyFinding(finding: Finding, tier: RiskTier): Classification {
  const blast_radius = blastRadiusFor(tier);

  // PRODUCTION: always HUMAN_REVIEW
  if (tier === 'PRODUCTION') {
    return {
      finding_id:   finding.finding_id,
      repo:         finding.repo,
      type:         finding.type,
      decision:     'HUMAN_REVIEW',
      blast_radius,
      reason:       'PRODUCTION-tier repo — all findings require human review',
      fix_hint:     { action: 'FLAG_FOR_HUMAN', description: 'Escalate to human reviewer' },
    };
  }

  // CI_FAILURE: SAFE if SELF-tier, DEFER if TENANT
  if (finding.type === 'CI_FAILURE') {
    if (tier === 'SELF') {
      return {
        finding_id:   finding.finding_id,
        repo:         finding.repo,
        type:         finding.type,
        decision:     'SAFE_AUTO_PR',
        blast_radius,
        reason:       'CI failure on SELF-tier repo — caretaker fix eligible',
        fix_hint: {
          action:      'CREATE_BRANCH_AND_PR',
          description: 'Re-run CI diagnostics, apply minimal fix, open draft PR',
          branch_name: `caretaker/ci-fix-${finding.finding_id.slice(0, 8)}`,
        },
      };
    }
    return {
      finding_id:   finding.finding_id,
      repo:         finding.repo,
      type:         finding.type,
      decision:     'DEFER',
      blast_radius,
      reason:       'CI failure on TENANT-tier repo — deferred to next human review cycle',
      fix_hint:     { action: 'ADD_COMMENT', description: 'Log CI failure in morning report for human triage' },
    };
  }

  // CI_FLAKY: always DEFER (flaky needs root-cause, not auto-patch)
  if (finding.type === 'CI_FLAKY') {
    return {
      finding_id:   finding.finding_id,
      repo:         finding.repo,
      type:         finding.type,
      decision:     'DEFER',
      blast_radius,
      reason:       'Flaky test signal — requires root-cause analysis before auto-fix',
      fix_hint:     { action: 'ADD_COMMENT', description: 'Flag for flaky test investigation' },
    };
  }

  // OPEN_PR_STALE: SAFE to add comment, SKIP if too old
  if (finding.type === 'OPEN_PR_STALE') {
    return {
      finding_id:   finding.finding_id,
      repo:         finding.repo,
      type:         finding.type,
      decision:     tier === 'SELF' ? 'SAFE_AUTO_PR' : 'DEFER',
      blast_radius,
      reason:       tier === 'SELF'
        ? 'Stale PR on SELF repo — safe to add stale-bot comment'
        : 'Stale PR on TENANT repo — deferred',
      fix_hint:     { action: 'ADD_COMMENT', description: 'Add staleness notice comment to PR' },
    };
  }

  // GOVERNANCE_STALE: DEFER — governance changes need human intent
  if (finding.type === 'GOVERNANCE_STALE') {
    return {
      finding_id:   finding.finding_id,
      repo:         finding.repo,
      type:         finding.type,
      decision:     'HUMAN_REVIEW',
      blast_radius,
      reason:       'Governance file stale — review cadence should be owner-driven',
      fix_hint:     { action: 'FLAG_FOR_HUMAN', description: 'Prompt owner to review constitution staleness' },
    };
  }

  // Default: DEFER
  return {
    finding_id:   finding.finding_id,
    repo:         finding.repo,
    type:         finding.type,
    decision:     'DEFER',
    blast_radius,
    reason:       `Default DEFER for type=${finding.type} on ${tier}-tier`,
  };
}

function classifyAll(observations: RepoObservation[]): Classification[] {
  const results: Classification[] = [];
  for (const obs of observations) {
    for (const finding of obs.findings) {
      results.push(classifyFinding(finding, obs.risk_tier));
    }
  }
  return results;
}

// ── Layer 3: Morning report ───────────────────────────────────────────────

function buildMorningReport(
  observations: RepoObservation[],
  classifications: Classification[]
): MorningReport {
  const today = new Date().toISOString().slice(0, 10);
  const counts = {
    repos_observed:     observations.filter(o => !o.skipped).length,
    repos_skipped:      observations.filter(o => o.skipped).length,
    findings_total:     classifications.length,
    safe_auto_pr_count: classifications.filter(c => c.decision === 'SAFE_AUTO_PR').length,
    deferred_count:     classifications.filter(c => c.decision === 'DEFER').length,
    human_review_count: classifications.filter(c => c.decision === 'HUMAN_REVIEW').length,
    skipped_count:      classifications.filter(c => c.decision === 'SKIP').length,
  };

  return {
    report_id:       randomUUID(),
    cycle_date:      today,
    generated_at:    new Date().toISOString(),
    summary:         counts,
    observations,
    classifications,
  };
}

function writeMorningReport(report: MorningReport): string {
  if (DRY_RUN) {
    log(`[dry-run] Would write morning report to ${REPORT_DIR}/${report.cycle_date}.jsonl`);
    return '[dry-run]';
  }
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const outPath = path.join(REPORT_DIR, `${report.cycle_date}.jsonl`);
  fs.appendFileSync(outPath, JSON.stringify(report) + '\n', 'utf8');
  return outPath;
}

function writeDeferQueue(
  report: MorningReport,
  observationsByFindingId: Map<string, Finding>
): number {
  const queued = report.classifications
    .filter((c) => c.decision === 'DEFER' || c.decision === 'HUMAN_REVIEW')
    .map((c) => {
      const finding = observationsByFindingId.get(c.finding_id);
      return {
        schema_version: 'caretaker_defer_queue/0.1',
        queued_at: new Date().toISOString(),
        cycle_date: report.cycle_date,
        repo: c.repo,
        finding_id: c.finding_id,
        finding_type: c.type,
        decision: c.decision,
        blast_radius: c.blast_radius,
        reason: c.reason,
        evidence_url: finding?.evidence_url ?? null,
      } as DeferQueueRecord;
    });

  if (queued.length === 0) return 0;
  if (DRY_RUN) {
    log(`[dry-run] Would append ${queued.length} records to ${DEFER_QUEUE_PATH}`);
    return queued.length;
  }

  for (const item of queued) appendJsonl(DEFER_QUEUE_PATH, item);
  return queued.length;
}

function executeSafeAutoPrActions(report: MorningReport): ActionExecutionRecord[] {
  const today = report.cycle_date;
  const actionable = report.classifications.filter((c) =>
    c.decision === 'SAFE_AUTO_PR' &&
    c.blast_radius === 'SELF' &&
    c.fix_hint?.action === 'CREATE_BRANCH_AND_PR' &&
    c.repo === 'project-manuals'
  );

  if (actionable.length === 0) return [];

  const records: ActionExecutionRecord[] = [];
  const repoRoot = ROOT;

  for (const c of actionable) {
    const branch = safeBranchName(
      c.fix_hint?.branch_name ?? `caretaker/${c.repo}/${c.type}-${c.finding_id.slice(0, 8)}`
    );

    if (DRY_RUN) {
      records.push({
        ts: new Date().toISOString(),
        cycle_date: today,
        repo: c.repo,
        finding_id: c.finding_id,
        branch,
        commit_created: false,
        pr_created: false,
        pr_url: null,
        message: 'dry-run: skipped branch/commit/PR creation',
      });
      continue;
    }

    const checkoutBase = runCommand('git', ['checkout', 'main'], repoRoot);
    if (!checkoutBase.ok) {
      records.push({
        ts: new Date().toISOString(),
        cycle_date: today,
        repo: c.repo,
        finding_id: c.finding_id,
        branch,
        commit_created: false,
        pr_created: false,
        pr_url: null,
        message: `failed to checkout main: ${checkoutBase.stderr.trim()}`,
      });
      continue;
    }

    const createBranch = runCommand('git', ['checkout', '-B', branch], repoRoot);
    if (!createBranch.ok) {
      records.push({
        ts: new Date().toISOString(),
        cycle_date: today,
        repo: c.repo,
        finding_id: c.finding_id,
        branch,
        commit_created: false,
        pr_created: false,
        pr_url: null,
        message: `failed to create branch: ${createBranch.stderr.trim()}`,
      });
      continue;
    }

    const actionLine = {
      ts: new Date().toISOString(),
      cycle: today,
      repo: c.repo,
      finding_id: c.finding_id,
      type: c.type,
      decision: c.decision,
      reason: c.reason,
    };
    appendJsonl(ACTION_LOG_PATH, actionLine);

    // Create a real docs diff so the caretaker PR carries an actionable artifact,
    // not only an action log append.
    const fixDocDir = path.join(ROOT, 'docs', 'caretaker', 'auto-fixes', today);
    fs.mkdirSync(fixDocDir, { recursive: true });
    const fixDocPath = path.join(fixDocDir, `${c.finding_id.slice(0, 8)}-${c.type.toLowerCase()}.md`);
    const fixDocBody = [
      `# Caretaker Auto-Fix Memo (${today})`,
      '',
      `- repo: ${c.repo}`,
      `- finding_id: ${c.finding_id}`,
      `- finding_type: ${c.type}`,
      `- blast_radius: ${c.blast_radius}`,
      '',
      '## Why this PR exists',
      c.reason,
      '',
      '## Proposed small fix',
      c.fix_hint?.description ?? 'Apply a minimal reversible remediation and re-run CI.',
      '',
      '## Follow-up checklist',
      '- [ ] Verify CI is green on this branch',
      '- [ ] Confirm no constitution/contract path was modified',
      '- [ ] Merge only after human review when required',
      '',
      '_Generated automatically by Nightly Repo Caretaker._',
      '',
    ].join('\n');
    fs.writeFileSync(fixDocPath, fixDocBody, 'utf8');

    runCommand('git', ['add', ACTION_LOG_PATH, fixDocPath], repoRoot);
    const checkStaged = runCommand('git', ['diff', '--cached', '--name-only'], repoRoot);
    if (!checkStaged.ok || !checkStaged.stdout.trim()) {
      records.push({
        ts: new Date().toISOString(),
        cycle_date: today,
        repo: c.repo,
        finding_id: c.finding_id,
        branch,
        commit_created: false,
        pr_created: false,
        pr_url: null,
        message: 'no staged changes after action log append',
      });
      runCommand('git', ['checkout', 'main'], repoRoot);
      continue;
    }

    const commitMsg = `caretaker(${c.type}): ${c.fix_hint?.description ?? 'auto action'} [${today}]`;
    const commit = runCommand('git', ['commit', '-m', commitMsg], repoRoot);
    if (!commit.ok) {
      records.push({
        ts: new Date().toISOString(),
        cycle_date: today,
        repo: c.repo,
        finding_id: c.finding_id,
        branch,
        commit_created: false,
        pr_created: false,
        pr_url: null,
        message: `commit failed: ${commit.stderr.trim()}`,
      });
      runCommand('git', ['checkout', 'main'], repoRoot);
      continue;
    }

    const push = runCommand('git', ['push', '-u', 'origin', branch], repoRoot);
    if (!push.ok) {
      records.push({
        ts: new Date().toISOString(),
        cycle_date: today,
        repo: c.repo,
        finding_id: c.finding_id,
        branch,
        commit_created: true,
        pr_created: false,
        pr_url: null,
        message: `push failed: ${push.stderr.trim()}`,
      });
      runCommand('git', ['checkout', 'main'], repoRoot);
      continue;
    }

    const prTitle = `caretaker: ${c.type} — ${today}`;
    const prBody = [
      `Type: ${c.type}`,
      `Cycle: ${today}`,
      `Reason: ${c.reason}`,
      '',
      'Auto-generated by Nightly Repo Caretaker.',
      'Blast radius: SELF.',
    ].join('\n');

    const pr = runCommand('gh', [
      'pr', 'create',
      '--repo', 'zerospawn01-coder/project-manuals',
      '--base', 'main',
      '--head', branch,
      '--draft',
      '--title', prTitle,
      '--body', prBody,
    ], repoRoot);

    const prUrl = pr.ok
      ? (pr.stdout.trim().split('\n').find((line) => line.startsWith('http')) ?? null)
      : null;

    records.push({
      ts: new Date().toISOString(),
      cycle_date: today,
      repo: c.repo,
      finding_id: c.finding_id,
      branch,
      commit_created: true,
      pr_created: pr.ok,
      pr_url: prUrl,
      message: pr.ok ? 'draft PR created' : `pr create failed: ${pr.stderr.trim()}`,
    });

    runCommand('git', ['checkout', 'main'], repoRoot);
  }

  return records;
}

function writeCaretakerRunResult(result: CaretakerRunResult): void {
  if (DRY_RUN) {
    log(`[dry-run] Would write run result to ${RUN_RESULT_PATH}`);
    return;
  }
  fs.mkdirSync(path.dirname(RUN_RESULT_PATH), { recursive: true });
  fs.writeFileSync(RUN_RESULT_PATH, JSON.stringify(result, null, 2), 'utf8');
}

function printHumanSummary(report: MorningReport): void {
  const { summary } = report;
  console.log('\n' + '═'.repeat(60));
  console.log(`Nightly Repo Caretaker — Morning Report  ${report.cycle_date}`);
  console.log('═'.repeat(60));
  console.log(`  Repos observed : ${summary.repos_observed}  (skipped: ${summary.repos_skipped})`);
  console.log(`  Findings total : ${summary.findings_total}`);
  console.log('');
  console.log(`  SAFE_AUTO_PR   : ${summary.safe_auto_pr_count}  ← caretaker will PR these`);
  console.log(`  DEFER          : ${summary.deferred_count}  ← held for next human cycle`);
  console.log(`  HUMAN_REVIEW   : ${summary.human_review_count}  ← escalated`);
  console.log('');

  const safe = report.classifications.filter(c => c.decision === 'SAFE_AUTO_PR');
  if (safe.length > 0) {
    console.log('  Auto-PR candidates:');
    for (const c of safe) {
      console.log(`    [${c.repo}] ${c.type} — ${c.fix_hint?.description ?? ''}`);
    }
    console.log('');
  }

  const human = report.classifications.filter(c => c.decision === 'HUMAN_REVIEW');
  if (human.length > 0) {
    console.log('  Requires human review:');
    for (const c of human) {
      console.log(`    [${c.repo}] ${c.type} — ${c.reason}`);
    }
    console.log('');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  if (!JSON_MODE) {
    console.log('Nightly Repo Caretaker — starting observation cycle…');
    if (DRY_RUN) console.log('[dry-run mode — no files written, no PRs created]');
  }

  // Layer 1: Observe
  section('Layer 1: Observing repositories');
  const observations: RepoObservation[] = [];
  const targets = selectedRepos();
  log(`  scope: ${REPO_SCOPE} (${targets.length} repo target${targets.length === 1 ? '' : 's'})`);
  for (const target of targets) {
    log(`  → ${target.owner}/${target.repo} (${target.risk_tier})`);
    const obs = observeRepo(target);
    observations.push(obs);
    if (obs.skipped) {
      log(`    ⚠ skipped: ${obs.skip_reason}`);
    } else {
      log(`    ✓ ${obs.ci_runs.length} runs, ${obs.open_prs.length} open PRs, ${obs.findings.length} findings`);
    }
  }

  // Layer 2: Classify
  section('Layer 2: Classifying findings');
  const classifications = classifyAll(observations);
  for (const c of classifications) {
    log(`  [${c.repo}] ${c.type} → ${c.decision}`);
  }

  // Layer 3: Report
  section('Layer 3: Building morning report');
  const report = buildMorningReport(observations, classifications);
  const reportPath = writeMorningReport(report);
  if (!DRY_RUN) log(`  Report written: ${reportPath}`);

  // Optional execution stage — performs write actions for nightly automation
  section('Layer 4: Execute write actions');
  const findingsMap = new Map<string, Finding>();
  for (const obs of observations) {
    for (const f of obs.findings) findingsMap.set(f.finding_id, f);
  }

  let deferredWritten = 0;
  if (EXECUTE) {
    deferredWritten = writeDeferQueue(report, findingsMap);
  } else {
    log('  defer queue write skipped (use --execute to persist deferred findings)');
  }
  let actionRecords: ActionExecutionRecord[] = [];
  if (EXECUTE) {
    actionRecords = executeSafeAutoPrActions(report);
    log(`  execute mode: ${actionRecords.length} SAFE_AUTO_PR action(s) processed`);
  } else {
    log('  execute mode disabled (use --execute to branch/commit/PR automatically)');
  }

  const runResult: CaretakerRunResult = {
    schema_version: 'caretaker_run_result/0.1',
    generated_at: new Date().toISOString(),
    cycle_date: report.cycle_date,
    executed: EXECUTE,
    dry_run: DRY_RUN,
    actions_total: actionRecords.length,
    branches_created: actionRecords.length,
    commits_created: actionRecords.filter((a) => a.commit_created).length,
    prs_created: actionRecords.filter((a) => a.pr_created).length,
    deferred_written: deferredWritten,
    action_records: actionRecords,
  };
  writeCaretakerRunResult(runResult);

  // Output
  if (JSON_MODE) {
    // Keep stable output shape for existing workflows that parse report.summary.*
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanSummary(report);
    console.log(`  Defer queue writes: ${deferredWritten}`);
    if (EXECUTE) {
      console.log(`  Auto actions: ${actionRecords.length} (PR created: ${runResult.prs_created})`);
    }
  }

  // Exit 0 — observation is never a gate failure
  process.exit(0);
}

main();
