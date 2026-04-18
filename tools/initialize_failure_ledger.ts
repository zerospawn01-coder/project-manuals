/**
 * tools/initialize_failure_ledger.ts
 *
 * Failure Ledger Seed Initializer
 * Schema: failure_ledger_seed/0.1
 *
 * Seeds a FilesystemLedgerStore directory with the canonical F-001..F-019
 * negative constraints derived from the 15 raw issues and the Acceptance
 * Criteria defined in contract/nightly_state_machine.yaml.
 *
 * Seeded entries have occurrence_count = 0 (pre-loaded, not yet observed
 * in a real cycle).  They function as day-1 "known mines" that are injected
 * into the Phase A prompt as NEGATIVE CONSTRAINTS from the very first cycle,
 * preventing repeated mistakes before any actual violation occurs.
 *
 * Usage (CLI):
 *   node dist/tools/initialize_failure_ledger.js <ledger_dir> [--force]
 *
 *   <ledger_dir>  Path to a FilesystemLedgerStore directory.
 *                 failure_ledger.json will be created/overwritten there.
 *   --force       Overwrite existing entries (default: skip if file exists).
 *
 * Usage (programmatic):
 *   import { seedFailureLedger } from './initialize_failure_ledger';
 *   seedFailureLedger('/path/to/ledger_dir');  // safe-skip if already seeded
 *   seedFailureLedger('/path/to/ledger_dir', { force: true });  // overwrite
 */

import fs from 'node:fs';
import path from 'node:path';

import type { FailureLedgerEntry, FailureLedgerCode } from '../contract/self_evolution_metrics';

// ---------------------------------------------------------------------------
// Seed data — one entry per F-code, occurrence_count = 0 (pre-loaded)
// ---------------------------------------------------------------------------

const SEED_CYCLE_ID = 'SEED_2026-04-11';

interface SeedRecord {
  code: FailureLedgerCode;
  negative_constraint: string;
}

const SEED_RECORDS: SeedRecord[] = [
  // ── Constitutional ────────────────────────────────────────────────────────
  {
    code: 'F-001_SECURITY_DOWNGRADE',
    negative_constraint:
      'Do NOT propose patches that modify any file under gate/, ledger/, constitution/, ' +
      'or any path matching forbidden_target_substrings. These components are immutable ' +
      'from the candidate\'s perspective — modifying them constitutes a constitutional breach.',
  },
  {
    code: 'F-002_DEPENDENCY_IGNORE_DELETE',
    negative_constraint:
      'Do NOT delete or ignore declared package dependencies without explicit rationale ' +
      'reviewed by a human operator. Undeclared dependency removal is a silent contract violation.',
  },
  {
    code: 'F-003_CONTEXT_REGRESSION',
    negative_constraint:
      'Do NOT proceed with a candidate if the world_state_snapshot was produced more than ' +
      '24 hours before cycle start. Stale context produces false confidence intervals.',
  },
  {
    code: 'F-014_SANDBOX_EGRESS_VIOLATION',
    negative_constraint:
      'BenchmarkSandboxRunner MUST always run with deny_external_network=true. ' +
      'Any candidate that requires external network access during benchmarking is ' +
      'automatically quarantined as a measurement-integrity violation.',
  },
  {
    code: 'F-018_CONSTITUTIONAL_BYPASS',
    negative_constraint:
      'No action may reach Phase A without a matching GatewayDecision(verdict=PASS). ' +
      'Any candidate that cannot be correlated to a gateway audit record is treated as ' +
      'a constitutional bypass and hard-rejected.',
  },

  // ── Evaluation ────────────────────────────────────────────────────────────
  {
    code: 'F-004_METRIC_INFLATION',
    negative_constraint:
      'Do NOT populate saved_time_minutes or stability_index from free-text estimates. ' +
      'All metrics MUST be sourced from benchmark subprocess output (measurement_env_valid=true). ' +
      'Self-reported performance claims are not evidence.',
  },
  {
    code: 'F-005_BENCHMARK_PATH_WRITE',
    negative_constraint:
      'Do NOT include changes to benchmark scripts (phase14/benchmarks/) in any patch_diff. ' +
      'Measurement infrastructure is immutable from the candidate\'s perspective — modifying ' +
      'it is classified as a metrics-contamination attack regardless of intent.',
  },
  {
    code: 'F-006_SELF_REPORTED_METRIC',
    negative_constraint:
      'Do NOT include self-assessed performance claims in rationale as evidence. ' +
      'All improvement claims must be backed by RawBenchResult from the sandbox runner ' +
      'with measurement_env_valid=true.',
  },
  {
    code: 'F-007_SINGLE_SAMPLE_PROMOTION',
    negative_constraint:
      'Do NOT propose candidates whose expected improvement confidence is low. ' +
      'The evaluation gate enforces repetitions >= 3 and confidence_weight >= 0.70. ' +
      'Candidates that cannot satisfy these thresholds will be deferred.',
  },
  {
    code: 'F-008_HASH_MISMATCH_REPLAY',
    negative_constraint:
      'Any patch whose replay produces a different benchmark_signature than the original run ' +
      'will be quarantined. Ensure exclusively deterministic code paths — no wall-clock time, ' +
      'random seeds, or external state in the measured path.',
  },
  {
    code: 'F-009_MEASUREMENT_ENV_INVALID',
    negative_constraint:
      'Do NOT rely on a measurement whose measurement_env_valid=false. Such runs indicate ' +
      'infrastructure failures and must not influence promotion decisions.',
  },
  {
    code: 'F-010_SILENT_DRIFT',
    negative_constraint:
      'When DriftMonitor reports any_drift_detected=true, promotion is blocked for this cycle. ' +
      'Do not re-propose the same candidate until the underlying drift trend resolves ' +
      '(slope_20 returns to >= -1e-6 min/run).',
  },

  // ── State ─────────────────────────────────────────────────────────────────
  {
    code: 'F-011_STATE_LOSS_ON_RESTART',
    negative_constraint:
      'All in-progress state MUST be persisted to task_state.json before any non-trivial ' +
      'computation. If the record is unreadable on restart, emit F-011 and alert the operator ' +
      'before proceeding. Never silently re-initialize and discard cycle progress.',
  },
  {
    code: 'F-012_PARTIAL_APPLY_SPLIT',
    negative_constraint:
      'If git apply (or patch equivalent) fails on any hunk, roll back ALL hunks. ' +
      'Never leave the working directory in a partial-apply state. A split state is ' +
      'harder to diagnose than a clean failure.',
  },
  {
    code: 'F-013_MISSING_RESTORE_POINT',
    negative_constraint:
      'PROMOTING MUST NOT begin without a confirmed restore-point snapshot. ' +
      'If the snapshot is missing or unreadable, abort TESTING and return to OBSERVING. ' +
      'Promotion without rollback capability is irreversible.',
  },

  // ── Integrity ─────────────────────────────────────────────────────────────
  {
    code: 'F-015_NONDETERMINISTIC_PATCH',
    negative_constraint:
      'Do NOT propose patches whose outcome depends on wall-clock time, random seeds, ' +
      'external APIs, or any non-deterministic input. Ledger replay MUST reproduce the ' +
      'same benchmark_signature as the original evaluation run.',
  },

  // ── Observability ─────────────────────────────────────────────────────────
  {
    code: 'F-016_AUDIT_LOG_DEGRADATION',
    negative_constraint:
      'All GatewayAuditEntry records MUST include schema_version, request_id, submitted_at, ' +
      'evaluated_at, and reject_code. Missing fields are a governance violation, not a minor ' +
      'omission — each gap is a vector for undetected constitutional bypass.',
  },
  {
    code: 'F-017_REJECTION_REASON_INVISIBLE',
    negative_constraint:
      'When a HARD_REJECT fires with FORBIDDEN_TARGET or INVARIANT_VIOLATION, ' +
      'violated_invariant_ids MUST be populated. A rejection with no specific IDs is ' +
      'treated as an audit-log failure (F-016) and compounds the observability degradation.',
  },

  // ── Boundary ─────────────────────────────────────────────────────────────
  {
    code: 'F-019_NEGATIVE_CONSTRAINT_IGNORED',
    negative_constraint:
      'Before generating a candidate, review ALL active FailureLedgerEntry records. ' +
      'Do NOT propose any patch that would re-trigger an active negative_constraint. ' +
      'Each failure in the ledger is a permanent mine — stepping on it a second time ' +
      'indicates the constraint injection mechanism itself has failed.',
  },
];

// ---------------------------------------------------------------------------
// Core seeder function
// ---------------------------------------------------------------------------

export interface SeedOptions {
  /** When true, overwrite failure_ledger.json even if it already exists. Default: false. */
  force?: boolean;
}

/**
 * Seed `<ledger_dir>/failure_ledger.json` with all canonical F-codes.
 *
 * - occurrence_count = 0 for all seed entries (pre-loaded, not yet observed).
 * - Existing entries that already have a matching code are preserved as-is
 *   when force=false (detected = don't overwrite real violations).
 * - With force=true, the entire file is replaced.
 *
 * Returns the number of entries written.
 */
export function seedFailureLedger(
  ledger_dir: string,
  options: SeedOptions = {}
): number {
  const { force = false } = options;

  fs.mkdirSync(ledger_dir, { recursive: true });

  const ledger_path = path.join(ledger_dir, 'failure_ledger.json');

  const now_cycle = SEED_CYCLE_ID;

  // Build seed entries
  const seed_entries: FailureLedgerEntry[] = SEED_RECORDS.map((r) => ({
    code: r.code,
    first_observed_cycle_id: now_cycle,
    last_observed_cycle_id: now_cycle,
    occurrence_count: 0,
    negative_constraint: r.negative_constraint,
  }));

  if (!force && fs.existsSync(ledger_path)) {
    // Merge: add any seed code that is not yet in the live file
    let existing: FailureLedgerEntry[] = [];
    try {
      existing = JSON.parse(fs.readFileSync(ledger_path, 'utf8')) as FailureLedgerEntry[];
    } catch {
      // Unreadable file — treat as empty, write fresh
    }
    const existing_codes = new Set(existing.map((e) => e.code));
    const missing_seeds = seed_entries.filter((s) => !existing_codes.has(s.code));

    if (missing_seeds.length === 0) {
      console.log(
        `[initialize_failure_ledger] ${ledger_path}: all ${seed_entries.length} F-codes already present — skipping.`
      );
      return 0;
    }

    const merged = [...existing, ...missing_seeds];
    fs.writeFileSync(ledger_path, JSON.stringify(merged, null, 2), 'utf8');
    console.log(
      `[initialize_failure_ledger] ${ledger_path}: merged ${missing_seeds.length} missing F-code(s). ` +
      `Total entries: ${merged.length}.`
    );
    return missing_seeds.length;
  }

  // Force overwrite or fresh write
  fs.writeFileSync(ledger_path, JSON.stringify(seed_entries, null, 2), 'utf8');
  console.log(
    `[initialize_failure_ledger] ${ledger_path}: wrote ${seed_entries.length} seed entries` +
    (force ? ' (--force)' : ' (fresh)') + '.'
  );
  return seed_entries.length;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const ledger_dir_arg = args.find((a) => !a.startsWith('--'));

  if (!ledger_dir_arg) {
    console.error(
      'Usage: node dist/tools/initialize_failure_ledger.js <ledger_dir> [--force]\n' +
      '\n' +
      '  <ledger_dir>  Directory containing (or to contain) failure_ledger.json\n' +
      '                (typically the same dir used by FilesystemLedgerStore).\n' +
      '  --force       Overwrite existing file entirely.\n'
    );
    process.exit(1);
  }

  const written = seedFailureLedger(path.resolve(ledger_dir_arg), { force });
  process.exit(written >= 0 ? 0 : 1);
}
