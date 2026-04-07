/**
 * fixtures/phase14_observation_seed.ts
 *
 * Phase 14 Application Layer — Self-Improvement Seed Fixtures
 * ===========================================================
 *
 * This module supplies the first concrete ObservationWindow and FocusSeedSet
 * derived from actual Phase 14 operational pain-points, ready to be fed into
 * the Phase A LLM prompt.
 *
 * Rationale for starting with Phase 14 (Application Layer):
 *   - Blast radius: scripts operate on JSON/JSONL/YAML files only.
 *     Worst case is a bad weekly report file — fully reversible.
 *   - Reward signal is immediate: human-readable Markdown output changes
 *     are visible on the next report run.
 *   - Three distinct improvement targets with clear metrics:
 *
 *   TARGET 1 — aggregate_weekly_governance_report.py  (slow_workflow)
 *     Pain: The --drift-date / --promotion-date defaulting logic is implicit.
 *     If either JSON source file is absent for the exact date, the script
 *     raises RuntimeError instead of a structured error with recovery guidance.
 *     saved_time_minutes: ~8 per failed run (manual investigation + rerun).
 *
 *   TARGET 2 — governance_weekly.py :: render_weekly_governance_markdown()  (error_log)
 *     Pain: The Markdown renderer is a long hand-coded f-string list.
 *     Adding a new section (e.g., promotion class distribution table) requires
 *     editing the renderer; there is no section registry or templating.
 *     refined_code_lines: Each new section is ~12 lines; the current renderer
 *     is ~60 lines and growing.
 *
 *   TARGET 3 — governance_weekly.py :: classify_rejection()  (invariant_stress)
 *     Pain: Unknown rejection reasons fall through to "NOVEL_CASE_REQUIRES_HLG"
 *     silently.  There is no logging or counter for novel_case accumulation,
 *     making taxonomy_revision_required triggering a surprise.
 *     bugs_killed: 1 (silent novel-case accumulation = latent governance bug).
 *
 * How to use:
 *   import { PHASE14_OBSERVATION_WINDOW, PHASE14_FOCUS_SEED_SET } from './fixtures/phase14_observation_seed';
 *   // Pass to assemblePhaseAInputPack / runNightlyLoop ctx.observation_window
 */

import type { FocusSeedSet } from '../contract/phase_a_prompt';
import type { ObservationWindow } from '../tools/phase_a_orchestrator';

// ---------------------------------------------------------------------------
// Observation timestamp — pinned to a concrete review date (2026-04-07)
// ---------------------------------------------------------------------------

const OBSERVED_AT = '2026-04-07T09:00:00.000Z';

// ---------------------------------------------------------------------------
// PHASE14_OBSERVATION_WINDOW
//
// Error log entries and slow-workflow observations collected from Phase 14
// manual runs. All values are derived from the actual codebase behaviour.
// ---------------------------------------------------------------------------

export const PHASE14_OBSERVATION_WINDOW: ObservationWindow = {
  // ── Error log ─────────────────────────────────────────────────────────────
  // RuntimeError thrown when JSON input files are absent on the target date.
  error_log_entries: [
    {
      source_file: 'phase14/scripts/aggregate_weekly_governance_report.py',
      function_name: '_load_json',
      error_code: 'RUNTIME_ERROR_MISSING_FILE',
      error_message_excerpt:
        'Required file not found: .../outputs/reports/rule_drift_summary_2026-03-31.json',
      first_seen_at: '2026-03-31T08:14:22.000Z',
      occurrence_count: 3,
    },
    {
      source_file: 'phase14/scripts/aggregate_weekly_governance_report.py',
      function_name: '_load_json',
      error_code: 'RUNTIME_ERROR_MISSING_FILE',
      error_message_excerpt:
        'Required file not found: .../outputs/reports/apply_summary_2026-03-31.json',
      first_seen_at: '2026-03-31T08:14:23.000Z',
      occurrence_count: 3,
    },
  ],

  // ── Slow workflows ─────────────────────────────────────────────────────────
  // The weekly governance report script is treated as a "workflow".
  // baseline_median_ms is the expected run time; recent_median_ms is observed.
  // A missing file causes a crash at ~800 ms instead of completing at ~4000 ms
  // (→ appears "faster" in wall-clock but produces zero output + manual rerun cost).
  // We model the rerun cost as a slow-workflow seed.
  workflow_recent_results: [
    {
      workflow_id: 'phase14/weekly_governance_report',
      recent_median_ms: 12400, // includes manual investigation + rerun
    },
    {
      workflow_id: 'phase14/render_weekly_markdown',
      recent_median_ms: 5800,  // render step is slow because of sequential f-string appends
    },
  ],

  // ── Invariant stress ──────────────────────────────────────────────────────
  // INV-PHASE14-01: classify_rejection() must never silently discard an
  // unknown rejection code without logging it.
  // Violation: unknown codes fall through to NOVEL_CASE_REQUIRES_HLG silently.
  invariant_stress_counts: [
    {
      invariant_id: 'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
      failure_count: 2,
      last_failed_at: '2026-04-01T11:30:00.000Z',
      related_file: 'phase14/src/phase14/governance_weekly.py',
    },
  ],

  // ── Consecutive failing regression tests ──────────────────────────────────
  // No regression tests are currently failing for Phase 14 layer.
  consecutive_failing_tests: [],
};

// ---------------------------------------------------------------------------
// PHASE14_FOCUS_SEED_SET
//
// Pre-assembled FocusSeedSet for the first Phase A call.
// Seeds are ordered HIGH → MEDIUM → LOW by estimated_impact.
//
// The three targets map directly to the four improvement categories:
//   saved_time_minutes   ← Target 1 (missing-file error recovery)
//   refined_code_lines   ← Target 2 (Markdown renderer refactor)
//   bugs_killed          ← Target 3 (silent novel-case accumulation fix)
// ---------------------------------------------------------------------------

export const PHASE14_FOCUS_SEED_SET: FocusSeedSet = {
  assembled_at: OBSERVED_AT,
  max_seeds: 5,
  excluded_seed_count: 0,
  seeds: [
    // ── HIGH: Target 1 — Missing-file structured error recovery ───────────
    // saved_time_minutes estimate: ~8 min/incident × 3 occurrences = 24 min total.
    // Blast radius: SELF (changes only aggregate_weekly_governance_report.py).
    {
      seed_type: 'error_log',
      source_file: 'phase14/scripts/aggregate_weekly_governance_report.py',
      function_name: '_load_json',
      error_code: 'RUNTIME_ERROR_MISSING_FILE',
      error_message_excerpt:
        'Required file not found: .../outputs/reports/rule_drift_summary_2026-03-31.json',
      first_seen_at: '2026-03-31T08:14:22.000Z',
      occurrence_count_in_window: 3,
      estimated_impact: 'HIGH',
    },

    // ── MEDIUM: Target 2 — Markdown renderer section registry ────────────
    // refined_code_lines estimate: replaces ~60 hard-coded lines with a
    // section-registry pattern; each future section adds 5 lines instead of 12.
    // Blast radius: SELF (changes only governance_weekly.py).
    {
      seed_type: 'slow_workflow',
      workflow_id: 'phase14/render_weekly_markdown',
      recent_median_ms: 5800,
      baseline_median_ms: 3200,
      slowdown_ratio: 0.81,          // 81% slower than baseline
      baseline_run_count: 7,
      estimated_impact: 'MEDIUM',
    },

    // ── MEDIUM: Target 3 — classify_rejection silent novel-case fix ───────
    // bugs_killed: 1 (latent governance invariant violation).
    // Blast radius: SELF (changes only governance_weekly.py).
    {
      seed_type: 'invariant_stress',
      invariant_id: 'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
      failure_count_in_window: 2,
      last_failed_at: '2026-04-01T11:30:00.000Z',
      related_file: 'phase14/src/phase14/governance_weekly.py',
      estimated_impact: 'MEDIUM',
    },
  ],
};

// ---------------------------------------------------------------------------
// PHASE14_WORKFLOW_BASELINES
//
// WorldStateSnapshot.workflow_baselines entries for the two Phase 14 workflows.
// Used by assemblePhaseAInputPack to compute slowdown seeds from the
// ObservationWindow.workflow_recent_results.
// ---------------------------------------------------------------------------

export const PHASE14_WORKFLOW_BASELINES: Array<{
  workflow_id: string;
  baseline_median_ms: number;
  baseline_run_count: number;
}> = [
  {
    workflow_id: 'phase14/weekly_governance_report',
    baseline_median_ms: 4200,
    baseline_run_count: 6,
  },
  {
    workflow_id: 'phase14/render_weekly_markdown',
    baseline_median_ms: 3200,
    baseline_run_count: 7,
  },
];

// ---------------------------------------------------------------------------
// PHASE14_PROTECTED_INVARIANT_IDS
//
// Invariant IDs that must never be weakened by any Phase 14 patch.
// INV-001..010 are the global kernel invariants.
// INV-PHASE14-01 is the application-layer invariant added above.
// ---------------------------------------------------------------------------

export const PHASE14_PROTECTED_INVARIANT_IDS: string[] = [
  'INV-001_NO_AUTH_BYPASS',
  'INV-003_NO_WRITE_EXECUTE_WITHOUT_APPROVAL',
  'INV-PHASE14-01_CLASSIFY_REJECTION_NO_SILENT_DISCARD',
];
