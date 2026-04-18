import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

import {
  ComparisonDiffAudit,
  ComparisonGateResult,
  ComparisonPolicy,
  ComparisonRow,
  DEFAULT_POLICY,
  GateDecision,
  auditComparisonDiff,
  enforceComparisonPolicy,
  normalizePolicy,
  validateComparisonRowsWithSchema,
} from '../renderer-react/src/app/comparison_loader';

type PolicySetFile = {
  active_profile?: string;
  profiles?: Record<string, unknown>;
};

function getArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function resolveProjectRoot(): string {
  return process.cwd().replace(/^\\\\\?\\/, '');
}

function loadRows(root: string): ComparisonRow[] {
  const appDir = path.join(root, 'renderer-react', 'src', 'app');
  const schema = readJson(path.join(appDir, 'comparison_schema.json'));
  const data = readJson(path.join(appDir, 'comparison_data.json'));

  return validateComparisonRowsWithSchema(data, schema);
}

function loadPolicy(root: string, profileArg: string | null): { policy: ComparisonPolicy; profile: string } {
  const appDir = path.join(root, 'renderer-react', 'src', 'app');
  const policySetPath = path.join(appDir, 'policy_set.json');
  const policyPath = path.join(appDir, 'policy.json');

  if (fs.existsSync(policySetPath)) {
    const setFile = readJson(policySetPath) as PolicySetFile;
    const profiles = setFile.profiles ?? {};
    const selectedProfile = profileArg ?? setFile.active_profile ?? 'strict';

    if (profiles[selectedProfile]) {
      return { policy: normalizePolicy(profiles[selectedProfile]), profile: selectedProfile };
    }
  }

  if (fs.existsSync(policyPath)) {
    return { policy: normalizePolicy(readJson(policyPath)), profile: 'single' };
  }

  return { policy: DEFAULT_POLICY, profile: 'default' };
}

function loadPreviousRows(previousPath: string | null): ComparisonRow[] | null {
  if (!previousPath || !fs.existsSync(previousPath)) {
    return null;
  }

  return readJson(previousPath) as ComparisonRow[];
}

function buildGateResult(rows: ComparisonRow[], policy: ComparisonPolicy): ComparisonGateResult {
  const policyDecision = enforceComparisonPolicy(rows, policy);
  return {
    decision: policyDecision.decision,
    policy,
    conflicts: policyDecision.conflicts,
    accepted: policyDecision.accepted,
  };
}

function resolveHumanOverride(decision: GateDecision, policy: ComparisonPolicy): { requires_human: boolean; reason: string } {
  const required = policy.requires_human_on_decisions.includes(decision);
  return {
    requires_human: required,
    reason: required ? `CB-1 human override required for decision ${decision}` : 'No mandatory human override for this decision',
  };
}

function triggerSystemFreeze(root: string, freezeRequired: boolean, policy: ComparisonPolicy): { triggered: boolean; mode: string } {
  if (!freezeRequired) {
    return { triggered: false, mode: 'not-required' };
  }

  const command = policy.freeze_command && policy.freeze_command.trim().length > 0 ? policy.freeze_command : null;
  if (command) {
    execSync(command, { cwd: root, stdio: 'ignore' });
    return { triggered: true, mode: 'command' };
  }

  const freezeMarker = path.join(root, 'phase14', 'data', 'ledger', 'system_freeze.requested');
  ensureDir(freezeMarker);
  fs.writeFileSync(freezeMarker, `${new Date().toISOString()} freeze requested by comparison gate\n`);
  return { triggered: true, mode: 'marker' };
}

function readLastLedgerHash(ledgerPath: string): string {
  if (!fs.existsSync(ledgerPath)) {
    return '';
  }

  const raw = fs.readFileSync(ledgerPath, 'utf8').trim();
  if (raw.length === 0) {
    return '';
  }

  const lines = raw.split('\n');
  const last = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  return typeof last.hash === 'string' ? last.hash : '';
}

function appendDecisionLedger(ledgerPath: string, payload: Record<string, unknown>): void {
  ensureDir(ledgerPath);
  const prevHash = readLastLedgerHash(ledgerPath);
  const serializedPayload = JSON.stringify(payload);
  const hash = crypto.createHash('sha256').update(`${prevHash}|${serializedPayload}`).digest('hex');

  const entry = {
    ts: new Date().toISOString(),
    prev_hash: prevHash,
    hash,
    payload,
  };

  fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`);
}

function buildOutput(
  rows: ComparisonRow[],
  policy: ComparisonPolicy,
  profile: string,
  gate: ComparisonGateResult,
  diffAudit: ComparisonDiffAudit | null,
  freezeHook: { triggered: boolean; mode: string },
  humanOverride: { requires_human: boolean; reason: string }
): Record<string, unknown> {
  const freezeRequiredFromDecision = gate.decision === 'REJECT';
  const freezeRequiredFromRisk = diffAudit ? policy.freeze_on_risk_levels.includes(diffAudit.highestRiskLevel) : false;

  return {
    generated_at: new Date().toISOString(),
    decision: gate.decision,
    accepted: gate.accepted,
    policy_profile: profile,
    freeze_required: freezeRequiredFromDecision || freezeRequiredFromRisk,
    freeze_triggered: freezeHook.triggered,
    freeze_mode: freezeHook.mode,
    requires_human: humanOverride.requires_human,
    human_override_reason: humanOverride.reason,
    policy,
    conflict_summary: {
      total: gate.conflicts.length,
      errors: gate.conflicts.filter((conflict) => conflict.severity === 'error').length,
      warnings: gate.conflicts.filter((conflict) => conflict.severity === 'warn').length,
    },
    row_count: rows.length,
    diff_audit: diffAudit,
  };
}

function run(): void {
  const root = resolveProjectRoot();
  const outArg = getArg('--out');
  const previousArg = getArg('--previous');
  const profileArg = getArg('--policy-profile');
  const ledgerArg = getArg('--ledger-out');
  const dryFreeze = hasFlag('--dry-freeze');

  const outputPath = outArg ? path.resolve(outArg) : path.join(root, 'phase14', 'data', 'comparison_gate_result.latest.json');
  const ledgerPath = ledgerArg
    ? path.resolve(ledgerArg)
    : path.join(root, 'phase14', 'data', 'ledger', 'decision_log.jsonl');

  const rows = loadRows(root);
  const policyLoaded = loadPolicy(root, profileArg);
  const gate = buildGateResult(rows, policyLoaded.policy);

  const previousRows = loadPreviousRows(previousArg ? path.resolve(previousArg) : null);
  const diffAudit = previousRows ? auditComparisonDiff(previousRows, rows, policyLoaded.policy) : null;

  const freezeRequiredFromDecision = gate.decision === 'REJECT';
  const freezeRequiredFromRisk = diffAudit ? policyLoaded.policy.freeze_on_risk_levels.includes(diffAudit.highestRiskLevel) : false;
  const freezeRequired = freezeRequiredFromDecision || freezeRequiredFromRisk;

  const freezeHook = dryFreeze
    ? { triggered: false, mode: 'dry-run' }
    : triggerSystemFreeze(root, freezeRequired, policyLoaded.policy);
  const humanOverride = resolveHumanOverride(gate.decision, policyLoaded.policy);

  const payload = buildOutput(rows, policyLoaded.policy, policyLoaded.profile, gate, diffAudit, freezeHook, humanOverride);

  ensureDir(outputPath);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  appendDecisionLedger(ledgerPath, payload);

  console.log(JSON.stringify(payload, null, 2));
}

run();
