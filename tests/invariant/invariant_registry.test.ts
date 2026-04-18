/**
 * tests/invariant/invariant_registry.test.ts
 *
 * Governance test: verifies that every invariant declared in
 * constitution/constitution.v1.0.yaml has a corresponding YAML file
 * under constitution/invariants/ and that the invariant IDs referenced
 * in TypeScript source code are all registered.
 *
 * This is NOT a unit test — it is a structural governance gate.
 * Failure means the governance registry is out of sync with the codebase.
 *
 * Run standalone:  node dist/tests/invariant/invariant_registry.js
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');

// ── helpers ────────────────────────────────────────────────────────────────

function readYamlField(filePath: string, field: string): string | undefined {
  const content = fs.readFileSync(filePath, 'utf8');
  const m = content.match(new RegExp(`^${field}:\\s*["']?([^\\n"']+)["']?`, 'm'));
  return m ? m[1].trim() : undefined;
}

function parseConstitutionInvariantIds(): string[] {
  const constitutionPath = path.join(ROOT, 'constitution', 'constitution.v1.0.yaml');
  const content = fs.readFileSync(constitutionPath, 'utf8');
  const hits: string[] = [];
  // Match lines like:   - id: "INV-001"
  for (const m of content.matchAll(/\bid:\s*["']?(INV-[A-Z0-9-]+)["']?/g)) {
    hits.push(m[1]);
  }
  return hits;
}

function getInvariantFileIds(): string[] {
  const dir = path.join(ROOT, 'constitution', 'invariants');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.yaml'))
    .map(f => readYamlField(path.join(dir, f), 'id'))
    .filter((id): id is string => !!id);
}

function findInvariantRefsInSource(): Set<string> {
  const refs = new Set<string>();
  const searchDirs = ['tools', 'fixtures', 'contract', 'tests'];
  const INV_RE = /['"`](INV-[A-Z0-9]+-[A-Z0-9_]+)['"`]/g;

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        for (const m of text.matchAll(INV_RE)) {
          refs.add(m[1]);
        }
      }
    }
  }

  for (const d of searchDirs) walk(path.join(ROOT, d));
  return refs;
}

// ── tests ──────────────────────────────────────────────────────────────────

function runTests() {
  const constitutionIds = parseConstitutionInvariantIds();
  const fileIds = getInvariantFileIds();
  const sourceRefs = findInvariantRefsInSource();

  // 1. constitution is readable and has invariants
  assert.ok(constitutionIds.length > 0, 'constitution.v1.0.yaml must declare at least one invariant');
  console.log(`✓ constitution declares ${constitutionIds.length} invariants`);

  // 2. every invariant in constitution has a YAML file
  const missing = constitutionIds.filter(id => !fileIds.includes(id));
  assert.deepEqual(
    missing,
    [],
    `Invariants declared in constitution but missing YAML files:\n  ${missing.join('\n  ')}`
  );
  console.log('✓ every invariant in constitution has a YAML file');

  // 3. no stray YAML files that aren't registered
  const extras = fileIds.filter(id => !constitutionIds.includes(id));
  assert.deepEqual(
    extras,
    [],
    `Invariant YAML files exist but NOT registered in constitution:\n  ${extras.join('\n  ')}`
  );
  console.log('✓ all invariant YAML files are registered in constitution');

  // 4. every invariant ID in source is known to constitution
  const unregistered: string[] = [];
  for (const ref of sourceRefs) {
    const baseRef = ref.replace(/_.*$/, '');
    const known = constitutionIds.some(id => id.replace(/_.*$/, '') === baseRef);
    if (!known) unregistered.push(ref);
  }
  assert.deepEqual(
    unregistered,
    [],
    `Invariant IDs in source not registered in constitution:\n  ${unregistered.join('\n  ')}`
  );
  console.log(`✓ all source invariant refs registered (${sourceRefs.size} refs checked)`);

  console.log('\n✓ invariant_registry: all governance checks passed');
}

runTests();
