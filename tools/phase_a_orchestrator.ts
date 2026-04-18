/**
 * tools/phase_a_orchestrator.ts
 *
 * Phase A — Input Pack Assembler
 * schema_version: phase_a/0.1
 *
 * Responsibilities (Phase A path only):
 *   1. buildConstitutionLayer()        — filter failure_ledger to NEGATIVE_CONSTRAINTS_BLOCK
 *   2. collectFocusSeedsFromObservation() — build FocusSeedSet from last cycle's observations
 *   3. assemblePhaseAInputPack()       — compose complete PhaseAInputPack ready for LLM call
 *   4. renderPhaseAPromptPair()        — fill YAML template slots → { system, user } strings
 *
 * Does NOT call the LLM. Caller (orchestrateAndDispatch extension) owns the LLM invocation.
 *
 * Imports:
 *   - DynamicPromptOrchestrator, ValidatedDispatchRecord from this file's sibling
 *   - PhaseAInputPack, FocusSeedSet, LedgerInjectionFilterConfig from contract/phase_a_prompt
 *   - FailureLedgerEntry, FailureLedgerCode, WorldStateSnapshot-adjacent types from contract/self_evolution_metrics
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  PhaseAConstitutionLayer,
  PhaseAObjectiveLayer,
  PhaseAInputPack,
  LedgerInjectionFilterConfig,
  LedgerEntrySeverity,
  FocusSeedSet,
  FocusSeed,
  ErrorLogSeed,
  SlowWorkflowSeed,
  InvariantStressSeed,
  FlakyRegressionSeed,
  WorldStateSnapshot,
} from '../contract/phase_a_prompt';
import type {
  FailureLedgerEntry,
  FailureLedgerCode,
  EvolutionTier,
  StabilityIndex,
} from '../contract/self_evolution_metrics';

// ---------------------------------------------------------------------------
// Types consumed by assemblers but sourced from the ledger store.
// The caller must provide these from their runtime ledger accessors.
// ---------------------------------------------------------------------------

export interface LedgerStoreSnapshot {
  /** All failure_ledger entries, unfiltered. */
  failure_ledger_all: FailureLedgerEntry[];
  /**
   * Ordered list of recent cycle IDs, most recent first.
   * Used by the recency window check without requiring timestamp parsing.
   * e.g. ["c-2026-04-07", "c-2026-04-06", "c-2026-04-05"]
   */
  recent_cycle_ids_ordered: string[];
  /** Current cycle's stability_index (from ledger, not from estimate). */
  current_stability_index: StabilityIndex;
  /** Previous cycle's tier. */
  previous_tier: EvolutionTier;
  /**
   * Functions currently under active rollback (Phase E ①).
   * Set when drift was detected and promotion was blocked in the previous cycle.
   * Phase A uses this to generate recovery-focused candidates.
   */
  active_rollback_targets?: string[];
}

export interface ObservationWindow {
  /** Error log entries observed in the last cycle (structured). */
  error_log_entries: Array<{
    source_file: string;
    function_name?: string;
    error_code: string;
    error_message_excerpt: string;
    first_seen_at: string;
    occurrence_count: number;
  }>;
  /** Workflow execution results in the last observation window. */
  workflow_recent_results: Array<{
    workflow_id: string;
    recent_median_ms: number;
  }>;
  /** Invariant check results in the last recent_cycles_window cycles. */
  invariant_stress_counts: Array<{
    invariant_id: string;
    failure_count: number;
    last_failed_at: string;
    related_file?: string;
  }>;
  /** Regression tests currently in consecutive-FAIL state. */
  consecutive_failing_tests: Array<{
    test_id: string;
    consecutive_fail_cycles: number;
    linked_incident_id?: string;
  }>;
}

// ---------------------------------------------------------------------------
// DEFAULT FILTER CONFIG
// Used when the caller does not supply an override.
// ---------------------------------------------------------------------------

export const DEFAULT_LEDGER_INJECTION_FILTER: LedgerInjectionFilterConfig = {
  always_inject_min_severity: 'CRITICAL',
  recent_cycles_window: 3,
  max_injected_constraints: 10,
};

export const DEFAULT_MAX_FOCUS_SEEDS = 5;
export const DEFAULT_MAX_CANDIDATES = 5;

// Slowdown ratio threshold above which a workflow becomes a FocusSeed.
const SLOW_WORKFLOW_MIN_SLOWDOWN_RATIO = 0.05; // 5 % slower than baseline

// ---------------------------------------------------------------------------
// SECTION 1 — buildConstitutionLayer
// Applies LedgerInjectionFilter and produces PhaseAConstitutionLayer.
// ---------------------------------------------------------------------------

/**
 * Compute a severity label for a FailureLedgerEntry.
 *
 * Rules (deterministic, no heuristics):
 *   CRITICAL: occurrence_count >= 3  ||  code === F-001 (security) || code === F-003 (regression)
 *   WARN:     occurrence_count >= 2
 *   INFO:     all others
 */
export function computeLedgerEntrySeverity(entry: FailureLedgerEntry): LedgerEntrySeverity {
  if (
    entry.occurrence_count >= 3 ||
    entry.code === 'F-001_SECURITY_DOWNGRADE' ||
    entry.code === 'F-003_CONTEXT_REGRESSION'
  ) {
    return 'CRITICAL';
  }
  if (entry.occurrence_count >= 2) {
    return 'WARN';
  }
  return 'INFO';
}

/**
 * Determine whether a cycle ID falls within the recency window.
 * Uses index position in recent_cycle_ids_ordered (index 0 = most recent).
 * If the cycle ID is not in the list, it is treated as outside the window.
 */
function isWithinRecentWindow(
  cycle_id: string,
  recent_cycle_ids_ordered: string[],
  window_size: number
): boolean {
  const idx = recent_cycle_ids_ordered.indexOf(cycle_id);
  return idx !== -1 && idx < window_size;
}

/**
 * Filter failure_ledger entries and produce the constitution layer.
 *
 * A ledger entry is included if:
 *   severity >= always_inject_min_severity  (regardless of age), OR
 *   last_observed_cycle_id is within recent_cycles_window of the current cycle.
 *
 * If the filtered set exceeds max_injected_constraints, trim by:
 *   1. Keep all CRITICAL entries.
 *   2. Fill remaining slots with most recent WARN / INFO entries.
 */
export function buildConstitutionLayer(
  all_entries: FailureLedgerEntry[],
  recent_cycle_ids_ordered: string[],
  filter: LedgerInjectionFilterConfig,
  protected_invariant_ids: string[]
): PhaseAConstitutionLayer {
  const severity_rank: Record<LedgerEntrySeverity, number> = {
    CRITICAL: 2,
    WARN: 1,
    INFO: 0,
  };
  const min_rank = severity_rank[filter.always_inject_min_severity];

  // Step 1: evaluate each entry
  const evaluated = all_entries.map((entry) => {
    const severity = computeLedgerEntrySeverity(entry);
    const is_high_severity = severity_rank[severity] >= min_rank;
    const is_recent = isWithinRecentWindow(
      entry.last_observed_cycle_id,
      recent_cycle_ids_ordered,
      filter.recent_cycles_window
    );
    return { entry, severity, include: is_high_severity || is_recent };
  });

  // Step 2: select candidates
  let selected = evaluated.filter((e) => e.include);

  // Step 3: trim to cap — CRITICAL first, then most-recent by index
  if (selected.length > filter.max_injected_constraints) {
    const critical = selected.filter((e) => e.severity === 'CRITICAL');
    const remaining_cap = filter.max_injected_constraints - critical.length;
    const non_critical = selected
      .filter((e) => e.severity !== 'CRITICAL')
      // sort by recency: lower index in recent_cycle_ids_ordered = more recent
      .sort((a, b) => {
        const ia = recent_cycle_ids_ordered.indexOf(a.entry.last_observed_cycle_id);
        const ib = recent_cycle_ids_ordered.indexOf(b.entry.last_observed_cycle_id);
        // Not found (-1) sorts last
        const sa = ia === -1 ? Number.MAX_SAFE_INTEGER : ia;
        const sb = ib === -1 ? Number.MAX_SAFE_INTEGER : ib;
        return sa - sb;
      })
      .slice(0, Math.max(0, remaining_cap));
    selected = [...critical, ...non_critical];
  }

  const active_negative_constraints = selected.map((e) => ({
    code: e.entry.code,
    prohibition_text: e.entry.negative_constraint,
    first_observed_at: e.entry.first_observed_cycle_id,
    occurrence_count: e.entry.occurrence_count,
  }));

  return {
    schema_version: 'phase_a_constitution/0.1',
    active_negative_constraints,
    protected_invariant_ids,
  };
}

// ---------------------------------------------------------------------------
// SECTION 2 — collectFocusSeedsFromObservation
// Builds FocusSeedSet from last cycle's observation window.
// ---------------------------------------------------------------------------

function estimateSeedImpact(seed: FocusSeed): 'HIGH' | 'MEDIUM' | 'LOW' {
  switch (seed.seed_type) {
    case 'invariant_stress':
      // Repeated invariant failure is always HIGH — it's a safety signal
      return seed.failure_count_in_window >= 2 ? 'HIGH' : 'MEDIUM';
    case 'flaky_regression':
      return seed.consecutive_fail_cycles >= 3 ? 'HIGH' : 'MEDIUM';
    case 'slow_workflow':
      if (seed.slowdown_ratio >= 0.20) return 'HIGH';
      if (seed.slowdown_ratio >= 0.10) return 'MEDIUM';
      return 'LOW';
    case 'error_log':
      if (seed.occurrence_count_in_window >= 5) return 'HIGH';
      if (seed.occurrence_count_in_window >= 2) return 'MEDIUM';
      return 'LOW';
  }
}

const IMPACT_RANK: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = {
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
};

/**
 * Collect focus seeds from the current observation window and workflow baselines.
 *
 * Seed collection order (priority):
 *   1. InvariantStressSeed — any invariant with failure_count > 0 in window
 *   2. FlakyRegressionSeed — any test in consecutive-FAIL state
 *   3. SlowWorkflowSeed — any workflow slower than baseline by >= 5%
 *   4. ErrorLogSeed — any error_log_entry with occurrence_count >= 1
 *
 * Final set is ranked by estimated_impact DESC and capped at max_seeds.
 */
export function collectFocusSeedsFromObservation(
  obs: ObservationWindow,
  workflow_baselines: WorldStateSnapshot['workflow_baselines'],
  max_seeds: number = DEFAULT_MAX_FOCUS_SEEDS
): FocusSeedSet {
  const raw_seeds: FocusSeed[] = [];

  // InvariantStressSeed
  for (const s of obs.invariant_stress_counts) {
    if (s.failure_count > 0) {
      const seed: InvariantStressSeed = {
        seed_type: 'invariant_stress',
        invariant_id: s.invariant_id,
        failure_count_in_window: s.failure_count,
        last_failed_at: s.last_failed_at,
        related_file: s.related_file,
      };
      raw_seeds.push(seed);
    }
  }

  // FlakyRegressionSeed
  for (const t of obs.consecutive_failing_tests) {
    const seed: FlakyRegressionSeed = {
      seed_type: 'flaky_regression',
      test_id: t.test_id,
      consecutive_fail_cycles: t.consecutive_fail_cycles,
      linked_incident_id: t.linked_incident_id,
    };
    raw_seeds.push(seed);
  }

  // SlowWorkflowSeed — join observation results with stored baselines
  const baseline_map = new Map(
    workflow_baselines.map((b) => [b.workflow_id, b])
  );
  for (const r of obs.workflow_recent_results) {
    const baseline = baseline_map.get(r.workflow_id);
    if (!baseline) continue; // no baseline → not eligible
    const slowdown_ratio =
      (r.recent_median_ms - baseline.baseline_median_ms) / baseline.baseline_median_ms;
    if (slowdown_ratio >= SLOW_WORKFLOW_MIN_SLOWDOWN_RATIO) {
      const seed: SlowWorkflowSeed = {
        seed_type: 'slow_workflow',
        workflow_id: r.workflow_id,
        recent_median_ms: r.recent_median_ms,
        baseline_median_ms: baseline.baseline_median_ms,
        slowdown_ratio,
        baseline_run_count: baseline.baseline_run_count,
      };
      raw_seeds.push(seed);
    }
  }

  // ErrorLogSeed
  for (const e of obs.error_log_entries) {
    const seed: ErrorLogSeed = {
      seed_type: 'error_log',
      source_file: e.source_file,
      function_name: e.function_name,
      error_code: e.error_code,
      error_message_excerpt: e.error_message_excerpt,
      first_seen_at: e.first_seen_at,
      occurrence_count_in_window: e.occurrence_count,
    };
    raw_seeds.push(seed);
  }

  // Rank by impact
  const ranked = raw_seeds
    .map((s) => ({ ...s, estimated_impact: estimateSeedImpact(s) } as FocusSeed & { estimated_impact: 'HIGH' | 'MEDIUM' | 'LOW' }))
    .sort((a, b) => IMPACT_RANK[b.estimated_impact] - IMPACT_RANK[a.estimated_impact]);

  const included = ranked.slice(0, max_seeds);
  const excluded_count = ranked.length - included.length;

  return {
    assembled_at: new Date().toISOString(),
    seeds: included,
    max_seeds,
    excluded_seed_count: excluded_count,
  };
}

// ---------------------------------------------------------------------------
// SECTION 3 — assemblePhaseAInputPack
// Composes the complete PhaseAInputPack from ledger + observation data.
// ---------------------------------------------------------------------------

export interface AssemblePhaseAInputPackOptions {
  cycle_id: string;
  ledger: LedgerStoreSnapshot;
  observation: ObservationWindow;
  /**
   * The full list of invariant IDs that are constitutionally protected.
   * Default: all INV-001..INV-010 from invariantRegistry.
   */
  protected_invariant_ids: string[];
  /**
   * Invariant check results from the last nightly cycle.
   * Sourced from the ledger or operational health artifact.
   */
  invariant_recent_results: WorldStateSnapshot['invariant_recent_results'];
  /** Failing @regression test IDs at time of observation. */
  failing_regression_test_ids: string[];
  /** Total regression test count in suite. */
  regression_test_total: number;
  filter?: Partial<LedgerInjectionFilterConfig>;
  max_seeds?: number;
  max_candidates?: number;
  /**
   * When F-010_SILENT_DRIFT is active, cap blast_radius in the LLM prompt.
   * Passed through to PhaseAInputPack so renderSystemPrompt() can enforce it.
   */
  blast_radius_ceiling?: 'SELF' | 'TENANT' | 'GLOBAL' | null;
}

export function assemblePhaseAInputPack(opts: AssemblePhaseAInputPackOptions): PhaseAInputPack {
  const filter: LedgerInjectionFilterConfig = {
    ...DEFAULT_LEDGER_INJECTION_FILTER,
    ...opts.filter,
  };
  const max_seeds = opts.max_seeds ?? DEFAULT_MAX_FOCUS_SEEDS;
  const max_candidates = opts.max_candidates ?? DEFAULT_MAX_CANDIDATES;

  // Section 1: Constitution layer
  const constitution_layer = buildConstitutionLayer(
    opts.ledger.failure_ledger_all,
    opts.ledger.recent_cycle_ids_ordered,
    filter,
    opts.protected_invariant_ids
  );

  // Section 2: Objective layer (frozen constants from GOVERNANCE_METRICS_DEFINITION.md)
  const objective_layer: PhaseAObjectiveLayer = {
    schema_version: 'phase_a_objective/0.1',
    current_stability_index: opts.ledger.current_stability_index.score,
    value_priority_order: [
      'stability_index',
      'saved_time_minutes',
      'bugs_killed',
      'tokens_saved',
      'refined_code_lines',
    ],
    noise_floors: {
      saved_time_minutes_min_delta_ratio: 0.01,
      tokens_saved_min_delta_ratio: 0.02,
      bugs_killed_min: 1,
      refined_code_lines_min: 1,
    },
  };

  // Section 3: World state snapshot
  const workflow_baselines = opts.observation.workflow_recent_results
    .map((r) => opts.ledger) // placeholder — actual extraction below
    .filter(Boolean);

  // Build workflow_baselines from ledger's observation data (baseline_run_count >= 5)
  // The ObservationWindow provides recent results; baselines come from a separate source.
  // Here we synthesise from what ObservationWindow provides for workflows that had results.
  // In production, the caller should supply pre-computed baselines from the ledger.
  const derived_baselines: WorldStateSnapshot['workflow_baselines'] = [];
  // (Baselines are supplied by the caller via opts.ledger — this array is populated
  //  when the caller opts into the full ledger accessor. For now it starts empty;
  //  collectFocusSeedsFromObservation handles the join internally.)

  const focus_seeds = collectFocusSeedsFromObservation(
    opts.observation,
    derived_baselines,
    max_seeds
  );

  const active_failure_codes: FailureLedgerCode[] = [
    ...new Set(
      constitution_layer.active_negative_constraints.map((c) => c.code)
    ),
  ];

  const world_state: WorldStateSnapshot = {
    snapshot_id: randomUUID(),
    observed_at: new Date().toISOString(),
    cycle_id: opts.cycle_id,
    invariant_recent_results: opts.invariant_recent_results,
    regression_test_summary: {
      total: opts.regression_test_total,
      failing: opts.failing_regression_test_ids.length,
      failing_test_ids: opts.failing_regression_test_ids,
    },
    workflow_baselines: derived_baselines,
    active_failure_codes,
    previous_tier: opts.ledger.previous_tier,
    focus_seeds,
    ...(opts.ledger.active_rollback_targets?.length
      ? { active_rollback_targets: opts.ledger.active_rollback_targets }
      : {}),
  };

  const pack: PhaseAInputPack = {
    schema_version: 'phase_a_input/0.1',
    cycle_id: opts.cycle_id,
    assembled_at: new Date().toISOString(),
    constitution_layer,
    objective_layer,
    world_state,
    ledger_injection_filter: filter,
    max_candidates,
    ...(opts.blast_radius_ceiling != null && { blast_radius_ceiling: opts.blast_radius_ceiling }),
  };

  return pack;
}

// ---------------------------------------------------------------------------
// SECTION 4 — renderPhaseAPromptPair
// Fills {{SLOT}} placeholders in the YAML template strings.
// Returns { system: string, user: string } ready for the LLM call.
// ---------------------------------------------------------------------------

export interface PhaseAPromptPair {
  system: string;
  user: string;
}

/**
 * Render the system prompt from a filled PhaseAInputPack.
 * Slot values derive exclusively from `pack`; no external strings accepted.
 */
export function renderSystemPrompt(
  system_template: string,
  pack: PhaseAInputPack
): string {
  const nc_block = pack.constitution_layer.active_negative_constraints.length > 0
    ? pack.constitution_layer.active_negative_constraints
        .map((nc) =>
          `  - [${nc.code}] ${nc.prohibition_text}\n    (first observed: ${nc.first_observed_at}, occurrences: ${nc.occurrence_count})`
        )
        .join('\n')
    : '  (none — no failures recorded yet)';

  const inv_block = pack.constitution_layer.protected_invariant_ids.length > 0
    ? pack.constitution_layer.protected_invariant_ids
        .map((id) => `  - ${id}`)
        .join('\n')
    : '  (all invariants from INV-001 to INV-010)';

  const blast_ceiling_line = pack.blast_radius_ceiling === 'SELF'
    ? `'TENANT' または 'GLOBAL' に設定してはならない（SELF のみ許可 — F-010_SILENT_DRIFT 適応中）。\n     cross-module 変更が必要な場合は当該候補を discarded_candidates に移動せよ。`
    : `'GLOBAL' に設定してはならない（TENANT以下のみ許可）。\n     cross-module 変更が必要な場合は当該候補を discarded_candidates に移動せよ。`;

  return system_template
    .replace('{{NEGATIVE_CONSTRAINTS_BLOCK}}', nc_block)
    .replace('{{PROTECTED_INVARIANTS_BLOCK}}', inv_block)
    .replace('{{CURRENT_STABILITY_INDEX}}', pack.objective_layer.current_stability_index.toFixed(4))
    .replace(/\{\{CURRENT_STABILITY_INDEX\}\}/g, pack.objective_layer.current_stability_index.toFixed(4))
    .replace('{{MAX_CANDIDATES}}', String(pack.max_candidates))
    .replace('{{BLAST_RADIUS_CEILING_LINE}}', blast_ceiling_line);
}

/**
 * Render the user turn from a filled PhaseAInputPack.
 */
export function renderUserPrompt(
  user_template: string,
  pack: PhaseAInputPack
): string {
  const ws = pack.world_state;

  const inv_block = ws.invariant_recent_results.length > 0
    ? [...ws.invariant_recent_results]
        .sort((a, b) => Number(a.passed) - Number(b.passed)) // FAIL first
        .map((r) => `  ${r.invariant_id}: ${r.passed ? 'PASS' : 'FAIL'}  (evaluated ${r.evaluated_at})`)
        .join('\n')
    : '  (no invariant results in observation window)';

  const failing_tests_block = ws.regression_test_summary.failing_test_ids.length > 0
    ? ws.regression_test_summary.failing_test_ids.map((id) => `  - ${id}`).join('\n')
    : '  (none — all regression tests currently passing)';

  const baselines_block = ws.workflow_baselines.length > 0
    ? ws.workflow_baselines
        .map((b) =>
          `  - ${b.workflow_id}\n      baseline_median_ms: ${b.baseline_median_ms}\n      baseline_run_count: ${b.baseline_run_count}`
        )
        .join('\n')
    : '  (none — no workflows have accumulated 5+ baseline runs yet)';

  const failure_codes_block = ws.active_failure_codes.length > 0
    ? ws.active_failure_codes.map((c) => `  - ${c}`).join('\n')
    : '  (none)';

  // Focus seeds block (additional slot not in original YAML — appended to user turn)
  const seeds_block = ws.focus_seeds.seeds.length > 0
    ? ws.focus_seeds.seeds
        .map((s, i) => {
          const impact = s.estimated_impact;
          switch (s.seed_type) {
            case 'invariant_stress':
              return `  ${i + 1}. [${impact}] invariant_stress — ${s.invariant_id} failed ${s.failure_count_in_window}× (last: ${s.last_failed_at})${s.related_file ? ` → ${s.related_file}` : ''}`;
            case 'flaky_regression':
              return `  ${i + 1}. [${impact}] flaky_regression — ${s.test_id} (${s.consecutive_fail_cycles} consecutive fail cycles)`;
            case 'slow_workflow':
              return `  ${i + 1}. [${impact}] slow_workflow — ${s.workflow_id}: ${s.recent_median_ms}ms vs baseline ${s.baseline_median_ms}ms (+${(s.slowdown_ratio * 100).toFixed(1)}%)`;
            case 'error_log':
              return `  ${i + 1}. [${impact}] error_log — ${s.source_file}${s.function_name ? `:${s.function_name}` : ''} [${s.error_code}] ×${s.occurrence_count_in_window}`;
          }
        })
        .join('\n')
    : '  (none — no high-impact targets identified in observation window)';

  // Active rollback block (Phase E ①) — functions under mandatory recovery focus
  const rollback_block = ws.active_rollback_targets?.length
    ? ws.active_rollback_targets.map((fn) => `  - ${fn} [ROLLBACK_PENDING — generate recovery candidates]`).join('\n')
    : '  (none)';

  return user_template
    .replace('{{CYCLE_ID}}', pack.cycle_id)
    .replace('{{ASSEMBLED_AT}}', pack.assembled_at)
    .replace('{{PREVIOUS_TIER}}', pack.world_state.previous_tier ?? 'none (first cycle or prior was CRITICAL)')
    .replace('{{INVARIANT_RECENT_RESULTS_BLOCK}}', inv_block)
    .replace('{{FAILING_REGRESSION_TESTS_BLOCK}}', failing_tests_block)
    .replace('{{WORKFLOW_BASELINES_BLOCK}}', baselines_block)
    .replace('{{ACTIVE_FAILURE_CODES_BLOCK}}', failure_codes_block)
    .replace('{{FOCUS_SEEDS_BLOCK}}', seeds_block)
    .replace('{{ACTIVE_ROLLBACK_BLOCK}}', rollback_block)
    .replace('{{MAX_CANDIDATES}}', String(pack.max_candidates));
}

/**
 * Assemble and render the complete { system, user } prompt pair for one Phase A call.
 * Writes the pack to an audit log before returning so every LLM call is traceable.
 */
export function renderPhaseAPromptPair(
  system_template: string,
  user_template: string,
  pack: PhaseAInputPack,
  audit_log_dir: string
): PhaseAPromptPair {
  // Persist the pack for audit before any LLM call
  if (!fs.existsSync(audit_log_dir)) {
    fs.mkdirSync(audit_log_dir, { recursive: true });
  }
  const log_path = path.join(audit_log_dir, `phase_a_input_pack.${pack.cycle_id}.json`);
  fs.writeFileSync(log_path, JSON.stringify(pack, null, 2), 'utf8');

  return {
    system: renderSystemPrompt(system_template, pack),
    user: renderUserPrompt(user_template, pack),
  };
}

// ---------------------------------------------------------------------------
// SECTION 5 — validatePhaseAOutputShell
// Lightweight structural check before full schema validation.
// Returns [] on pass, string[] of errors on fail.
// ---------------------------------------------------------------------------

export function validatePhaseAOutputShell(raw: unknown): string[] {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return ['output is not an object'];
  }
  const obj = raw as Record<string, unknown>;

  if (obj['schema_version'] !== 'phase_a_output/0.1') {
    errors.push(`schema_version must be "phase_a_output/0.1", got "${String(obj['schema_version'])}"`);
  }
  if (typeof obj['cycle_id'] !== 'string' || !obj['cycle_id']) {
    errors.push('cycle_id must be a non-empty string');
  }
  if (!Array.isArray(obj['candidates'])) {
    errors.push('candidates must be an array');
  }
  if (!Array.isArray(obj['discarded_candidates'])) {
    errors.push('discarded_candidates must be present (can be empty [])');
  }

  if (Array.isArray(obj['candidates'])) {
    for (let i = 0; i < (obj['candidates'] as unknown[]).length; i++) {
      const c = (obj['candidates'] as Record<string, unknown>[])[i];
      if (!c || typeof c !== 'object') {
        errors.push(`candidates[${i}] is not an object`);
        continue;
      }
      if (!c['acceptance_criteria'] || typeof c['acceptance_criteria'] !== 'object') {
        errors.push(`candidates[${i}].acceptance_criteria is missing`);
      }
      if (
        !Array.isArray((c['negative_constraint_violations'] as unknown[] | undefined)) ||
        ((c['negative_constraint_violations'] as unknown[]).length > 0)
      ) {
        errors.push(
          `candidates[${i}].negative_constraint_violations must be [] (empty); candidate is invalid`
        );
      }
      const ac = c['acceptance_criteria'] as Record<string, unknown> | undefined;
      if (ac) {
        if (!Array.isArray(ac['invariant_check'])) {
          errors.push(`candidates[${i}].acceptance_criteria.invariant_check is missing`);
        }
        if (!ac['measurable_outcome'] || typeof ac['measurable_outcome'] !== 'object') {
          errors.push(`candidates[${i}].acceptance_criteria.measurable_outcome is missing`);
        }
        if (!ac['no_regression'] || typeof ac['no_regression'] !== 'object') {
          errors.push(`candidates[${i}].acceptance_criteria.no_regression is missing`);
        }
        const mo = ac['measurable_outcome'] as Record<string, unknown> | undefined;
        if (mo) {
          const has_value =
            (typeof mo['saved_time_minutes_predicted'] === 'number' && mo['saved_time_minutes_predicted'] !== 0) ||
            (typeof mo['tokens_saved_predicted'] === 'number' && mo['tokens_saved_predicted'] !== 0) ||
            (typeof mo['bugs_killed_predicted'] === 'number' && mo['bugs_killed_predicted'] !== 0) ||
            (typeof mo['refined_code_lines_predicted'] === 'number' && mo['refined_code_lines_predicted'] !== 0);
          if (!has_value) {
            errors.push(
              `candidates[${i}].acceptance_criteria.measurable_outcome has no non-zero predicted improvement`
            );
          }
        }
      }
    }
  }

  return errors;
}
