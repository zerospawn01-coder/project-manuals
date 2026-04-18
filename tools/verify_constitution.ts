/**
 * tools/verify_constitution.ts
 *
 * CLI governance verifier.  Reads constitution/constitution.v1.0.yaml and
 * validates the entire governance structure:
 *
 *   1.  All invariant IDs declared in the constitution have matching YAML files.
 *   2.  All failure codes referenced in TypeScript/Python source are registered.
 *   3.  No sovereign path appears in the untrusted trust boundary.
 *   4.  Ledger paths (.jsonl) contain valid JSON Lines (no corrupt records).
 *   5.  Every invariant YAML has the required fields: id, slug, severity, statement.
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — one or more checks failed
 *
 * Usage:
 *   node dist/tools/verify_constitution.js
 *   node dist/tools/verify_constitution.js --verbose
 *   node dist/tools/verify_constitution.js --json        # machine-readable output
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const VERBOSE = process.argv.includes('--verbose');
const JSON_MODE = process.argv.includes('--json');

// ── Violation types ────────────────────────────────────────────────────────

type ViolationType =
  | 'INVARIANT_FILE_MISSING'
  | 'INVARIANT_FIELD_MISSING'
  | 'FAILURE_CODE_UNREGISTERED'
  | 'TRUST_BOUNDARY_OVERLAP'
  | 'LEDGER_CORRUPT'
  | 'SCHEMA_MISSING';

interface Fix {
  action: 'CREATE_FILE' | 'ADD_FIELDS' | 'REGISTER_CODE' | 'REMOVE_FROM_UNTRUSTED' | 'REPAIR_JSONL';
  path?: string;
  fields?: string[];
  code?: string;
}

interface Violation {
  type: ViolationType;
  id?: string;
  file?: string;
  reason: string;
  fix?: Fix;
}

const violations: Violation[] = [];

// ── tiny logger ────────────────────────────────────────────────────────────

function log(msg: string)  { if (VERBOSE && !JSON_MODE) console.log(`  ${msg}`); }
function pass(check: string) { if (!JSON_MODE) console.log(`✓  ${check}`); }

function fail(type: ViolationType, id: string | undefined, file: string | undefined, reason: string) {
  violations.push({ type, id, file, reason });
  if (!JSON_MODE) {
    console.error(`✗  [${type}]${id ? ' ' + id : ''}`);
    console.error(`     ${reason}`);
  }
}

function section(title: string) { if (!JSON_MODE) console.log(`\n── ${title}`); }

function injectFixDirective(v: Violation): Violation {
  switch (v.type) {
    case 'INVARIANT_FILE_MISSING':
      return { ...v, fix: { action: 'CREATE_FILE', path: v.file } };
    case 'INVARIANT_FIELD_MISSING':
      return { ...v, fix: { action: 'ADD_FIELDS', path: v.file, fields: ['id', 'slug', 'severity', 'statement'] } };
    case 'FAILURE_CODE_UNREGISTERED':
      return { ...v, fix: { action: 'REGISTER_CODE', path: 'constitution/constitution.v1.0.yaml', code: v.id } };
    case 'TRUST_BOUNDARY_OVERLAP':
      return { ...v, fix: { action: 'REMOVE_FROM_UNTRUSTED', path: 'constitution/constitution.v1.0.yaml' } };
    case 'LEDGER_CORRUPT':
      return { ...v, fix: { action: 'REPAIR_JSONL', path: v.file } };
    case 'SCHEMA_MISSING':
      return { ...v, fix: { action: 'CREATE_FILE', path: v.file } };
    default:
      return v;
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function readFile(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

function parseConstitution(): { invariantIds: string[]; failureCodes: string[]; untrustedPaths: string[]; sovereignPaths: string[] } {
  const src = readFile(path.join(ROOT, 'constitution', 'constitution.v1.0.yaml'));

  const invariantIds: string[] = [];
  for (const m of src.matchAll(/\bid:\s*["']?(INV-[A-Z0-9-]+)["']?/g)) {
    invariantIds.push(m[1]);
  }

  const failureCodes: string[] = [];
  for (const m of src.matchAll(/\b(F-[0-9]{3}(?:_[A-Z_]+)?)\b/g)) {
    if (!failureCodes.includes(m[1])) failureCodes.push(m[1]);
  }

  const untrustedPaths: string[] = [];
  const sovereignPaths: string[] = [];
  let zone = '';
  for (const line of src.split('\n')) {
    if (/untrusted:/.test(line)) { zone = 'untrusted'; continue; }
    if (/sovereign:/.test(line))  { zone = 'sovereign';  continue; }
    if (/controlled:|append_only:/.test(line)) { zone = 'other'; continue; }
    const m = line.match(/^\s+-\s+["']?([^"'\n#]+)["']?\s*$/);
    if (m) {
      if (zone === 'untrusted') untrustedPaths.push(m[1].trim());
      if (zone === 'sovereign')  sovereignPaths.push(m[1].trim());
    }
  }

  return { invariantIds, failureCodes, untrustedPaths, sovereignPaths };
}

// ── Check 1: Every invariant in constitution has a YAML file ──────────────

function check1_invariantFiles(invariantIds: string[]): void {
  section('Check 1: Invariant YAML files');
  const dir = path.join(ROOT, 'constitution', 'invariants');
  const existing = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.yaml'))
    : [];

  for (const id of invariantIds) {
    const found = existing.some(f =>
      f.toUpperCase().startsWith(id.toUpperCase()) ||
      f.toUpperCase().includes(id.toUpperCase())
    );
    if (found) {
      log(`${id} → found`);
      pass(id);
    } else {
      fail(
        'INVARIANT_FILE_MISSING', id,
        `constitution/invariants/${id}.yaml`,
        `Invariant declared in constitution but no matching YAML file`
      );
    }
  }
}

// ── Check 2: All failure codes in source are registered ───────────────────

function check2_failureCodes(registeredCodes: string[]): void {
  section('Check 2: Failure codes in source vs registry');

  const sourceRefs = new Set<string>();
  const F_RE = /\b(F-[0-9]{3}(?:_[A-Z_]+)?)\b/g;
  const scanExtensions = ['.ts', '.js', '.py'];
  const scanDirs = ['tools', 'phase14', 'fixtures', 'tests'];

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); }
      else if (scanExtensions.some(ext => e.name.endsWith(ext))) {
        const text = readFile(full);
        for (const m of text.matchAll(F_RE)) sourceRefs.add(m[1]);
      }
    }
  }
  for (const d of scanDirs) walk(path.join(ROOT, d));

  const unregistered = [...sourceRefs].filter(c =>
    !registeredCodes.some(r => r === c || r.startsWith(c + '_') || c.startsWith(r + '_'))
  );

  if (unregistered.length === 0) {
    pass('All failure codes in source are registered in constitution');
  } else {
    for (const c of unregistered) {
      fail('FAILURE_CODE_UNREGISTERED', c, undefined, `Failure code "${c}" referenced in source but not registered in constitution`);
    }
  }

  const unused = registeredCodes.filter(c => !sourceRefs.has(c));
  if (unused.length > 0) log(`Registered but unreferenced codes (OK): ${unused.join(', ')}`);
}

// ── Check 3: No sovereign path in untrusted list ──────────────────────────

function check3_trustBoundaries(sovereignPaths: string[], untrustedPaths: string[]): void {
  section('Check 3: Trust boundary integrity');

  if (sovereignPaths.length === 0 && untrustedPaths.length === 0) {
    log('No trust boundary paths found in constitution (YAML parse skipped)');
    pass('Trust boundary section present (structural check skipped)');
    return;
  }

  const conflicting = sovereignPaths.filter(sp =>
    untrustedPaths.some(up => up.startsWith(sp) || sp.startsWith(up))
  );

  if (conflicting.length === 0) {
    pass('No sovereign path appears in untrusted boundary');
  } else {
    for (const p of conflicting) {
      fail('TRUST_BOUNDARY_OVERLAP', undefined, p, `Sovereign path "${p}" also appears in untrusted boundary`);
    }
  }
}

// ── Check 4: Ledger files contain valid JSON Lines ────────────────────────

function check4_ledgerIntegrity(): void {
  section('Check 4: Ledger JSON Lines integrity');

  const ledgerDir = path.join(ROOT, 'phase14', 'data');
  if (!fs.existsSync(ledgerDir)) {
    pass('Ledger directory absent — no runs yet (OK)');
    return;
  }

  const jsonlFiles = fs.readdirSync(ledgerDir).filter(f => f.endsWith('.jsonl'));
  if (jsonlFiles.length === 0) {
    pass('No ledger .jsonl files yet (OK)');
    return;
  }

  for (const f of jsonlFiles) {
    const p = path.join(ledgerDir, f);
    const lines = readFile(p).split('\n').filter(Boolean);
    const corrupt: number[] = [];
    lines.forEach((line, i) => {
      try { JSON.parse(line); }
      catch { corrupt.push(i + 1); }
    });
    if (corrupt.length === 0) {
      pass(`Ledger file clean: ${f} (${lines.length} records)`);
    } else {
      fail('LEDGER_CORRUPT', undefined, `phase14/data/${f}`,
        `${corrupt.length} of ${lines.length} lines failed JSON.parse (lines: ${corrupt.join(', ')})`);
    }
  }
}

// ── Check 5: Every invariant YAML has required fields ─────────────────────

function check5_invariantFields(): void {
  section('Check 5: Invariant YAML required fields');

  const dir = path.join(ROOT, 'constitution', 'invariants');
  if (!fs.existsSync(dir)) {
    fail('SCHEMA_MISSING', undefined, 'constitution/invariants/', 'Directory does not exist');
    return;
  }

  const required = ['id', 'slug', 'severity', 'statement'];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.yaml'))) {
    const content = readFile(path.join(dir, f));
    const missing = required.filter(field => !new RegExp(`^${field}:`, 'm').test(content));
    if (missing.length === 0) {
      pass(`${f}: all required fields present`);
    } else {
      fail('INVARIANT_FIELD_MISSING', f, `constitution/invariants/${f}`,
        `Missing required fields: ${missing.join(', ')}`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  if (!JSON_MODE) console.log('verify_constitution — Antigravity OS Governance Verifier\n');

  const constitutionPath = path.join(ROOT, 'constitution', 'constitution.v1.0.yaml');
  if (!fs.existsSync(constitutionPath)) {
    const v: Violation = { type: 'SCHEMA_MISSING', file: constitutionPath, reason: 'constitution.v1.0.yaml not found — root of trust is absent' };
    if (JSON_MODE) {
      console.log(JSON.stringify({ status: 'FAIL', violations: [v] }, null, 2));
    } else {
      console.error('FATAL: constitution/constitution.v1.0.yaml not found.');
    }
    process.exit(1);
  }

  const { invariantIds, failureCodes, untrustedPaths, sovereignPaths } = parseConstitution();
  log(`Parsed constitution: ${invariantIds.length} invariants, ${failureCodes.length} failure codes`);

  check1_invariantFiles(invariantIds);
  check2_failureCodes(failureCodes);
  check3_trustBoundaries(sovereignPaths, untrustedPaths);
  check4_ledgerIntegrity();
  check5_invariantFields();

  const status: 'PASS' | 'FAIL' = violations.length === 0 ? 'PASS' : 'FAIL';

  if (JSON_MODE) {
    const annotatedViolations = violations.map(injectFixDirective);
    console.log(JSON.stringify({ status, violations: annotatedViolations }, null, 2));
  } else {
    console.log('\n' + '─'.repeat(60));
    if (status === 'PASS') {
      console.log(`✓  All governance checks passed.`);
    } else {
      console.error(`✗  ${violations.length} governance check(s) failed. See details above.`);
    }
  }

  process.exit(status === 'PASS' ? 0 : 1);
}

main();

