/**
 * tools/nightly_loop_runner.ts
 *
 * Nightly Loop Controller — Task State Machine Driver
 * schema_version: nightly_loop/0.1
 *
 * This is the top-level controller that drives the four orchestrators in
 * order and keeps the Task State Machine (TSM) persistent so that a crash
 * at any point can be resumed on the next invocation.
 *
 * State Transition Diagram:
 *
 *   ┌─────────────┐
 *   │  OBSERVING  │  ← entry point; assemble PhaseAInputPack + render prompt
 *   └──────┬──────┘
 *          │ LLM call (external — injected via PhaseALLMDispatcher)
 *          ▼
 *   ┌───────────────┐
 *   │ HYPOTHESIZING │  ← hold PhaseACandidateList, transition to TESTING
 *   └──────┬────────┘
 *          │ Phase B — sandbox verification
 *          ▼
 *   ┌─────────┐
 *   │ TESTING │  ← runs phase_b_orchestrator; produces PhaseBBatchResult
 *   └────┬────┘
 *        │ Phase C — promoting gate
 *        ▼
 *   ┌──────────┐
 *   │ PROMOTING│  ← runs phase_c_orchestrator; produces PromotingGateResult
 *   └────┬─────┘
 *        │ Phase D — aggregate MorningResult
 *        ▼
 *   ┌─────────────┐
 *   │  OBSERVING  │  ← next cycle starts here (morning_result written to disk)
 *   └─────────────┘
 *
 * Resumability contract:
 *   - Before EVERY state transition, the TSM record is written to disk.
 *   - On startup, the runner reads the existing TSM record.
 *     - If status = TESTING  → reload saved PhaseBBatchResult and skip Phase B.
 *     - If status = PROMOTING → reload saved PromotingGateResult and skip B+C.
 *     - If status = OBSERVING → start fresh cycle.
 *     - If status = HYPOTHESIZING → re-render prompt and wait for LLM again.
 *       (LLM call is never retried automatically — operator must re-submit.)
 *
 * LLM dispatch is an INJECTED SEAM:
 *   The controller renders the prompt pair (system + user) and hands it to
 *   PhaseALLMDispatcher.dispatch(). The dispatcher returns PhaseACandidateList.
 *   This keeps the controller free of any LLM SDK dependency.
 *
 * Failure handling:
 *   Any thrown error is caught, logged to LoopRunRecord.error_log, and the
 *   cycle is aborted. State is NOT advanced on error (safe to re-run).
 *   SANDBOX_EXECUTION_ERROR in Phase B is already handled inside
 *   phase_b_orchestrator and does NOT throw — it produces a RejectedPatch.
 *
 * Imports:
 *   - phase_a_orchestrator: assemblePhaseAInputPack, renderPhaseAPromptPair,
 *                           validatePhaseAOutputShell
 *   - phase_b_orchestrator: runPhaseBBatch, SandboxRunner
 *   - phase_c_orchestrator: runPhaseCPromotion, SystemStateSnapshot,
 *                           CapabilityGraphEvaluator, NULL_CAPABILITY_GRAPH_EVALUATOR
 *   - phase_d_aggregator:   aggregateMorningResult, PhaseDInputPack
 *   - contracts:            PhaseACandidateList, PhaseBBatchResult,
 *                           PromotingGateResult, MorningResult,
 *                           TaskStateMachineRecord, TaskStateMachineStatus
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Phase A
import {
  assemblePhaseAInputPack,
  renderPhaseAPromptPair,
  validatePhaseAOutputShell,
  DEFAULT_MAX_FOCUS_SEEDS,
  DEFAULT_MAX_CANDIDATES,
} from './phase_a_orchestrator';
import type {
  LedgerStoreSnapshot,
  ObservationWindow,
} from './phase_a_orchestrator';

// Phase B
import {
  runPhaseBBatch,
  validatePhaseBBatchResultShell,
} from './phase_b_orchestrator';
import type { SandboxRunner, PhaseBConfig } from './phase_b_orchestrator';

// Phase C
import {
  runPhaseCPromotion,
  validatePromotingGateResultShell,
  NULL_CAPABILITY_GRAPH_EVALUATOR,
  buildPromotedSkill,
} from './phase_c_orchestrator';
import type {
  SystemStateSnapshot,
  CapabilityGraphEvaluator,
} from './phase_c_orchestrator';

// Human Review Authority
import type { HumanReviewStore } from './human_review_writer';

// Phase D
import {
  aggregateMorningResult,
  validateMorningResultShell,
} from './phase_d_aggregator';
import type { PhaseDInputPack } from './phase_d_aggregator';

// Drift monitoring
import type { DriftMonitor, DriftMetrics } from './drift_monitor';
import { computeDriftAdaptation } from './drift_adaptation';
import type { DriftAdaptationDecision } from './drift_adaptation';

// Phase E ①②: Rollback executor
import {
  buildRollbackExecutionRecord,
  applyDriftResolutionToRecord,
} from './rollback_executor';
import type { RollbackExecutionRecord } from './rollback_executor';

// Contracts
import type { PhaseACandidateList, WorldStateSnapshot } from '../contract/phase_a_prompt';
import type { PhaseBBatchResult } from '../contract/phase_b_verify';
import type { PromotingGateResult } from '../contract/phase_c_promote';
import type { MorningResult } from '../contract/morning_result';
import type {
  TaskStateMachineRecord,
  TaskStateMachineStatus,
  FailureLedgerEntry,
  StabilityIndex,
  SavedTimeMinutes,
  EvolutionTier,
  NextCycleRecommendation,
} from '../contract/self_evolution_metrics';
import type { CycleLineageSummary } from '../contract/morning_result';

// ---------------------------------------------------------------------------
// LLM DISPATCHER SEAM
// ---------------------------------------------------------------------------

/**
 * Pluggable LLM dispatcher interface.
 *
 * The controller does NOT know which LLM to call — it just renders a prompt
 * pair and passes it here. The dispatcher owns API keys, retry logic, and
 * output parsing.
 *
 * Contract:
 *   - MUST return a PhaseACandidateList (not raw text)
 *   - MUST validate schema_version = 'phase_a_output/0.1'
 *   - MUST throw on unrecoverable LLM error (the controller will abort the cycle)
 */
export interface PhaseALLMDispatcher {
  dispatch(
    system_prompt: string,
    user_prompt: string,
    cycle_id: string
  ): Promise<PhaseACandidateList>;
}

// ---------------------------------------------------------------------------
// LEDGER STORE SEAM
// ---------------------------------------------------------------------------

/**
 * Pluggable ledger store interface.
 *
 * The controller reads from and writes to the ledger exclusively through
 * this interface — no direct file I/O for business data.
 *
 * Implementations may use: JSON files, SQLite, a remote key-value store.
 */
export interface LedgerStore {
  /** Read the current TSM record. Returns null if no record exists (first run). */
  readTaskStateMachine(): Promise<TaskStateMachineRecord | null>;

  /** Persist the TSM record. Called before every state transition. */
  writeTaskStateMachine(record: TaskStateMachineRecord): Promise<void>;

  /** Read all active failure ledger entries. */
  readFailureLedger(): Promise<FailureLedgerEntry[]>;

  /**
   * Apply failure ledger writes from a PhaseBBatchResult.
   * For each RejectedPatch.failure_ledger_write that is non-null:
   *   - If code already exists: increment occurrence_count, update last_observed.
   *   - If code is new: create entry with occurrence_count = 1.
   */
  applyFailureLedgerWrites(b_result: PhaseBBatchResult, cycle_id: string): Promise<void>;

  /** Read the metrics snapshot for the immediately preceding cycle. */
  readPreviousCycleMetrics(): Promise<PhaseDInputPack['previous_cycle_metrics']>;

  /** Read the cumulative promoted skill count across all prior cycles. */
  readCumulativePromotedSkillCount(): Promise<number>;

  /** Read the count of consecutive prior cycles with stability_index >= 0.85. */
  readPriorConsecutiveStableCycles(): Promise<number>;

  /** Read ordered list of prior cycle IDs (newest first, max 20). */
  readRecentCycleIds(): Promise<string[]>;

  /** Read prior cycle lineage for trend display (max 7, newest first). */
  readPriorCycleLineage(): Promise<CycleLineageSummary[]>;

  /**
   * Persist a MorningResult as the canonical record for this cycle.
   * Also updates cumulative promoted skill count and consecutive stable cycles.
   */
  writeMorningResult(result: MorningResult): Promise<void>;

  /**
   * Save an intermediate Phase B batch result so the cycle can be resumed
   * if the controller crashes between Phase B and Phase C.
   */
  savePhaseBCheckpoint(b_result: PhaseBBatchResult): Promise<void>;

  /** Load a previously saved Phase B checkpoint. null if not found. */
  loadPhaseBCheckpoint(cycle_id: string): Promise<PhaseBBatchResult | null>;

  /**
   * Save an intermediate Phase C result for crash recovery.
   */
  savePhaseCCheckpoint(c_result: PromotingGateResult): Promise<void>;

  /** Load a previously saved Phase C checkpoint. null if not found. */
  loadPhaseCCheckpoint(cycle_id: string): Promise<PromotingGateResult | null>;

  // ── Phase E ①②: drift adaptation persistence + rollback execution ────────

  /**
   * Read the drift adaptation decision written by the previous completed cycle.
   * Returns null on first run or if no adaptation was recorded.
   * Used by Phase E ② to apply max_candidates_override to the current cycle.
   */
  readLastDriftAdaptation(): Promise<DriftAdaptationDecision | null>;

  /**
   * Read the active rollback record — set when drift was detected and promotion
   * was blocked in the most recent cycle.
   * Returns null if no rollback is currently active.
   * Used by Phase E ① to inject active_rollback_targets into Phase A.
   */
  readActiveRollbackRecord(): Promise<RollbackExecutionRecord | null>;

  /**
   * Persist (overwrite) the active rollback record.
   * Called in the AGGREGATING phase when adaptation.promotion_blocked = true.
   */
  writeRollbackRecord(record: RollbackExecutionRecord): Promise<void>;

  /**
   * Remove the active rollback record.
   * Called when drift resolves (promotion no longer blocked) so Phase A reverts
   * to normal exploration.
   */
  clearRollbackRecord(): Promise<void>;
}

// ---------------------------------------------------------------------------
// RUNTIME CONTEXT (supplied by the caller once per nightly invocation)
// ---------------------------------------------------------------------------

/**
 * Everything the loop runner needs from the runtime environment.
 * Injected once; the runner keeps a reference for the duration of the cycle.
 */
export interface NightlyLoopContext {
  /** Phase A: the prompt template files (system + user YAML content). */
  phase_a_system_template: string;
  phase_a_user_template: string;

  /** Phase A: list of invariant IDs the constitution should always protect. */
  protected_invariant_ids: string[];

  /** Phase A: observation window for this cycle. */
  observation_window: ObservationWindow;

  /** Phase A: recent invariant check results (pass/fail per invariant). */
  invariant_recent_results: WorldStateSnapshot['invariant_recent_results'];

  /** Phase A: failing @regression test IDs at time of observation. */
  failing_regression_test_ids: string[];

  /** Phase A: total @regression test count in the suite. */
  regression_test_total: number;

  /** Phase B: sandbox runner implementation. */
  sandbox_runner: SandboxRunner;

  /** Phase C: system state snapshot at cycle start. */
  system_state_snapshot: SystemStateSnapshot;

  /** Phase C: capability graph evaluator (defaults to null evaluator). */
  capability_graph_evaluator?: CapabilityGraphEvaluator;

  /** Phase D: legitimacy tier from the AntigravityEvent layer. */
  legitimacy_tier: 'L0' | 'L1' | 'L2';

  /** Phase D: next-cycle recommendations from Phase A (pass-through). */
  next_cycle_recommendations: NextCycleRecommendation[];

  /** LLM dispatcher. */
  llm_dispatcher: PhaseALLMDispatcher;

  /** Ledger store. */
  ledger_store: LedgerStore;

  /**
   * Human Review Authority store.
   * Optional — when provided, the runner reads ApprovedPendingEntry records
   * at the start of each PROMOTING phase and promotes those patches directly
   * (bypassing the blast-radius gate — human approval already granted).
   * After promotion, each entry is removed from the store.
   */
  human_review_store?: HumanReviewStore;

  /**
   * Optional Phase B configuration overrides.
   * Merged with DEFAULT_PHASE_B_CONFIG at runtime.
   * Use this to adjust max_allowed_blast_radius in tests or special deployments.
   */
  phase_b_config?: Partial<PhaseBConfig>;

  /**
   * Optional DriftMonitor instance.
   * When present, computeAll() is called before Phase D and the results are
   * included in PhaseDInputPack.drift_metrics → MorningResult.drift.
   */
  drift_monitor?: DriftMonitor;
}

// ---------------------------------------------------------------------------
// LOOP RUN RECORD — output manifest for the nightly run
// ---------------------------------------------------------------------------

export type LoopPhase = 'OBSERVING' | 'HYPOTHESIZING' | 'TESTING' | 'PROMOTING' | 'AGGREGATING';

export interface LoopRunError {
  phase: LoopPhase;
  message: string;
  stack?: string;
  ts: string; // ISO-8601 UTC
}

/**
 * Written to disk at the end of every nightly run (success or failure).
 * Provides an operator-readable summary of what happened.
 */
export interface LoopRunRecord {
  schema_version: 'nightly_loop_run/0.1';
  run_id: string;
  cycle_id: string;
  started_at: string;    // ISO-8601 UTC
  finished_at: string;   // ISO-8601 UTC
  completed: boolean;    // true iff MorningResult was produced
  final_phase: LoopPhase;
  error_log: LoopRunError[];
  /** Populated when completed = true. */
  morning_result_path: string | null;
}

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

export interface NightlyLoopConfig {
  /**
   * Directory where run record JSON and checkpoint files are written.
   * Sub-directories are created automatically:
   *   <run_dir>/checkpoints/   — Phase B / C checkpoints
   *   <run_dir>/morning/       — MorningResult JSON files
   *   <run_dir>/audit/         — Phase B / C / D audit logs
   */
  run_dir: string;

  /** Maximum candidates to request from Phase A. Default: 5. */
  max_candidates?: number;

  /** Maximum focus seeds to inject. Default: 5. */
  max_focus_seeds?: number;
}

// ---------------------------------------------------------------------------
// SECTION 1 — TSM helpers
// ---------------------------------------------------------------------------

function makeTsmRecord(
  cycle_id: string,
  status: TaskStateMachineStatus,
  active_candidate_id: string | null = null
): TaskStateMachineRecord {
  return {
    schema_version: 'task_state/0.1',
    cycle_id,
    status,
    updated_at: new Date().toISOString(),
    active_candidate_id,
  };
}

async function transitionTo(
  store: LedgerStore,
  cycle_id: string,
  status: TaskStateMachineStatus,
  active_candidate_id: string | null = null
): Promise<void> {
  const record = makeTsmRecord(cycle_id, status, active_candidate_id);
  await store.writeTaskStateMachine(record);
}

// ---------------------------------------------------------------------------
// SECTION 2 — Phase A: Observe + Hypothesize
// ---------------------------------------------------------------------------

async function runPhaseAObserving(
  ctx: NightlyLoopContext,
  cycle_id: string,
  ledger_snapshot: LedgerStoreSnapshot,
  config: NightlyLoopConfig,
  max_candidates_override?: number  // Phase E ②: cap from previous cycle's drift adaptation
): Promise<{ system_prompt: string; user_prompt: string }> {
  const input_pack = assemblePhaseAInputPack({
    cycle_id,
    ledger: ledger_snapshot,
    observation: ctx.observation_window,
    protected_invariant_ids: ctx.protected_invariant_ids,
    invariant_recent_results: ctx.invariant_recent_results,
    failing_regression_test_ids: ctx.failing_regression_test_ids,
    regression_test_total: ctx.regression_test_total,
    max_seeds: config.max_focus_seeds ?? DEFAULT_MAX_FOCUS_SEEDS,
    max_candidates: max_candidates_override ?? config.max_candidates ?? DEFAULT_MAX_CANDIDATES,
  });

  const audit_dir = path.join(config.run_dir, 'audit');
  const { system, user } = await renderPhaseAPromptPair(
    ctx.phase_a_system_template,
    ctx.phase_a_user_template,
    input_pack,
    audit_dir
  );

  return { system_prompt: system, user_prompt: user };
}

async function runPhaseAHypothesizing(
  ctx: NightlyLoopContext,
  cycle_id: string,
  system_prompt: string,
  user_prompt: string
): Promise<PhaseACandidateList> {
  const raw_list = await ctx.llm_dispatcher.dispatch(system_prompt, user_prompt, cycle_id);

  // Structural pre-check
  const errors = validatePhaseAOutputShell(raw_list);
  if (errors.length > 0) {
    throw new Error(`Phase A output validation failed: ${errors.join('; ')}`);
  }

  return raw_list;
}

// ---------------------------------------------------------------------------
// SECTION 3 — Assemble LedgerStoreSnapshot for Phase A
// ---------------------------------------------------------------------------

async function buildLedgerStoreSnapshot(
  store: LedgerStore,
  stability_index: StabilityIndex,
  previous_tier: EvolutionTier
): Promise<LedgerStoreSnapshot> {
  const [failure_ledger_all, recent_cycle_ids_ordered, active_rollback] = await Promise.all([
    store.readFailureLedger(),
    store.readRecentCycleIds(),
    store.readActiveRollbackRecord(),
  ]);

  const active_rollback_targets = active_rollback?.targets
    .filter((t) => t.status === 'PENDING_RECOVERY')
    .map((t) => t.target_function);

  return {
    failure_ledger_all,
    recent_cycle_ids_ordered,
    current_stability_index: stability_index,
    previous_tier,
    ...(active_rollback_targets?.length ? { active_rollback_targets } : {}),
  };
}

// ---------------------------------------------------------------------------
// SECTION 4 — Main runner
// ---------------------------------------------------------------------------

/**
 * Run one complete nightly cycle (or resume a partial one).
 *
 * Returns the LoopRunRecord. On success, MorningResult is written to disk
 * via the LedgerStore and to `<run_dir>/morning/morning_result_<cycle_id>.json`.
 *
 * NEVER throws — all errors are caught and recorded in LoopRunRecord.error_log.
 * The caller can check `result.completed` to determine success.
 */
export async function runNightlyLoop(
  ctx: NightlyLoopContext,
  config: NightlyLoopConfig
): Promise<LoopRunRecord> {
  const run_id = randomUUID();
  const started_at = new Date().toISOString();
  const error_log: LoopRunError[] = [];
  let completed = false;
  let final_phase: LoopPhase = 'OBSERVING';
  let morning_result_path: string | null = null;

  // Ensure run directories exist
  const audit_dir = path.join(config.run_dir, 'audit');
  const checkpoint_dir = path.join(config.run_dir, 'checkpoints');
  const morning_dir = path.join(config.run_dir, 'morning');
  for (const d of [audit_dir, checkpoint_dir, morning_dir]) {
    fs.mkdirSync(d, { recursive: true });
  }

  // ── Read existing TSM to determine resume point ───────────────────────────
  let tsm = await ctx.ledger_store.readTaskStateMachine();
  const is_resuming = tsm !== null && tsm.status !== 'OBSERVING';
  const cycle_id: string = (tsm && is_resuming) ? tsm.cycle_id : randomUUID();

  // ── Build ledger snapshot (needed for Phase A) ────────────────────────────
  const stability_index = ctx.system_state_snapshot.stability_index_score;
  const previous_tier = ctx.system_state_snapshot.blocked_risky_actions_this_cycle
    ? null  // derive from ledger
    : null;

  // Synthesise the StabilityIndex object from the flat score in system_state_snapshot
  const stability_index_obj: StabilityIndex = {
    score: ctx.system_state_snapshot.stability_index_score,
    invariant_pass_ratio: ctx.system_state_snapshot.stability_index_score,  // approximation until ledger provides components
    no_regression_pass_ratio: ctx.system_state_snapshot.stability_index_score,
    replay_success_ratio: 1.0,
    quarantine_adjusted_safety_factor: 1.0,
  };

  const prev_tier_from_ledger: EvolutionTier = (() => {
    const lineage_promise = ctx.ledger_store.readPriorCycleLineage();
    // We need this synchronously — we'll read it as part of building the snapshot later.
    // For now, use null as default and overwrite in the async block below.
    return null;
  })();

  // ─────────────────────────────────────────────────────────────────────────
  // STATE MACHINE: OBSERVING phase
  // ─────────────────────────────────────────────────────────────────────────
  let candidate_list: PhaseACandidateList | null = null;
  let b_result: PhaseBBatchResult | null = null;
  let c_result: PromotingGateResult | null = null;
  // Phase D drift adaptation — computed before PROMOTING so it can gate Phase C
  let drift_metrics_pre_c: DriftMetrics[] | undefined = undefined;
  let adaptation: DriftAdaptationDecision | undefined = undefined;

  // Helper: record an error and return early
  function recordError(phase: LoopPhase, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    error_log.push({ phase, message: msg, stack, ts: new Date().toISOString() });
    final_phase = phase;
  }

  try {
    // ── Determine resume strategy ──────────────────────────────────────────
    let resume_from: TaskStateMachineStatus = 'OBSERVING';
    if (is_resuming && tsm) {
      resume_from = tsm.status;
    }

    // ── Phase E ②: Read previous cycle's drift adaptation ─────────────────
    // Provides max_candidates_override for Phase A (exploration rate cap)
    // and blast_radius_ceiling for Phase B — both from the previous cycle's
    // DriftAdaptationDecision written to latest_drift_adaptation.json.
    const prev_adaptation: DriftAdaptationDecision | null = ctx.drift_monitor
      ? await ctx.ledger_store.readLastDriftAdaptation()
      : null;
    const effective_max_candidates: number | undefined =
      prev_adaptation?.max_candidates_override != null
        ? prev_adaptation.max_candidates_override
        : undefined;

    // ── OBSERVING → HYPOTHESIZING ─────────────────────────────────────────
    if (resume_from === 'OBSERVING' || resume_from === 'HYPOTHESIZING') {
      final_phase = 'OBSERVING';

      // Build ledger snapshot
      const prior_lineage = await ctx.ledger_store.readPriorCycleLineage();
      const prev_cycle_tier: EvolutionTier = prior_lineage.length > 0
        ? prior_lineage[0]!.tier
        : null;
      const ledger_snapshot = await buildLedgerStoreSnapshot(
        ctx.ledger_store,
        stability_index_obj,
        prev_cycle_tier
      );

      // Transition to HYPOTHESIZING before calling LLM
      await transitionTo(ctx.ledger_store, cycle_id, 'HYPOTHESIZING');
      final_phase = 'HYPOTHESIZING';

      // Render Phase A prompts
      const { system_prompt, user_prompt } = await runPhaseAObserving(
        ctx, cycle_id, ledger_snapshot, config, effective_max_candidates
      );

      // Call LLM dispatcher
      candidate_list = await runPhaseAHypothesizing(ctx, cycle_id, system_prompt, user_prompt);

      // Transition to TESTING now that we have candidates
      await transitionTo(
        ctx.ledger_store,
        cycle_id,
        'TESTING',
        candidate_list.candidates[0]?.candidate_id ?? null
      );
    }

    // ── TESTING ──────────────────────────────────────────────────────────
    final_phase = 'TESTING';

    if (resume_from === 'TESTING') {
      // Try to load Phase B checkpoint first
      b_result = await ctx.ledger_store.loadPhaseBCheckpoint(cycle_id);
      if (b_result) {
        // Resume: skip Phase B, we already have the result
      } else {
        // Re-run Phase B — candidate_list was not loaded above; abort safely.
        // Operator must re-run from OBSERVING.
        throw new Error(
          `Cannot resume from TESTING: Phase B checkpoint not found for cycle ${cycle_id}. ` +
          `Re-run from OBSERVING or restore the checkpoint file.`
        );
      }
    }

    if (resume_from === 'PROMOTING') {
      // Must have Phase B checkpoint to proceed
      b_result = await ctx.ledger_store.loadPhaseBCheckpoint(cycle_id);
      if (!b_result) {
        throw new Error(
          `Cannot resume from PROMOTING: Phase B checkpoint not found for cycle ${cycle_id}. ` +
          `Re-run from OBSERVING or restore the checkpoint file.`
        );
      }
    }

    if (!b_result) {
      // Fresh run or HYPOTHESIZING resume → candidate_list must exist
      if (!candidate_list) {
        throw new Error('candidate_list is null at TESTING phase — internal controller error');
      }

      const active_failure_ledger = await ctx.ledger_store.readFailureLedger();
      b_result = await runPhaseBBatch(
        candidate_list,
        ctx.sandbox_runner,
        active_failure_ledger,
        {
          audit_log_dir: audit_dir,
          ...ctx.phase_b_config,
          // Phase E ②: apply blast_radius_ceiling from previous cycle's drift adaptation
          ...(prev_adaptation?.blast_radius_ceiling != null && {
            max_allowed_blast_radius: prev_adaptation.blast_radius_ceiling,
          }),
        }
      );

      const b_errors = validatePhaseBBatchResultShell(b_result);
      if (b_errors.length > 0) {
        throw new Error(`Phase B output validation failed: ${b_errors.join('; ')}`);
      }

      // Write failure ledger entries from Phase B rejections
      await ctx.ledger_store.applyFailureLedgerWrites(b_result, cycle_id);

      // Checkpoint before advancing
      await ctx.ledger_store.savePhaseBCheckpoint(b_result);
    }

    // Transition to PROMOTING
    await transitionTo(ctx.ledger_store, cycle_id, 'PROMOTING');

    // ── PROMOTING ─────────────────────────────────────────────────────────
    final_phase = 'PROMOTING';

    if (resume_from === 'PROMOTING') {
      c_result = await ctx.ledger_store.loadPhaseCCheckpoint(cycle_id);
      if (!c_result) {
        // b_result was loaded from checkpoint; re-run Phase C is safe
        // (Phase C is idempotent with the same input)
      }
    }

    // ── Drift Adaptation gate (Phase D) ──────────────────────────────────
    // Compute drift BEFORE Phase C so we can block promotion when degrading.
    drift_metrics_pre_c = ctx.drift_monitor
      ? ctx.drift_monitor.computeAll()
      : undefined;

    if (ctx.drift_monitor && drift_metrics_pre_c && drift_metrics_pre_c.length > 0) {
      adaptation = computeDriftAdaptation(drift_metrics_pre_c, ctx.drift_monitor);
    }

    // If drift is actively degrading (n_runs >= 5) and Phase C hasn't already
    // run (e.g. we resumed with a saved checkpoint), bypass runPhaseCPromotion
    // and synthesise a "system gate closed" PromotingGateResult.
    if (!c_result && adaptation?.promotion_blocked === true) {
      if (!b_result) {
        throw new Error('b_result is null at PROMOTING phase (drift bypass) — internal controller error');
      }

      const blocked_at = new Date().toISOString();
      const block_reason =
        adaptation.promotion_blocked_reason ?? 'F-010_SILENT_DRIFT detected';

      c_result = {
        schema_version: 'phase_c_promote/0.1',
        cycle_id,
        evaluated_at: blocked_at,
        verified_patch_count: b_result.summary.verified_count,
        system_gate_passed: false,
        system_gate_conditions: [
          {
            condition_id: 'DRIFT-01',
            required: 'No significant performance drift detected (n_runs >= 5)',
            actual: block_reason,
            passed: false,
          },
        ],
        promoted_skills: [],
        promoted_count: 0,
        deferred_human_review_count: 0,
        deferred_stability_count: b_result.summary.verified_count,
        gate_results: b_result.verified.map((vp) => ({
          candidate_id: vp.candidate_id,
          disposition: 'DEFERRED_STABILITY' as const,
          patch_conditions_evaluated: [],
          promoted_skill_id: null,
          human_review_event: null,
          defer_reason: block_reason,
        })),
        unlocked_nodes: [],
      };

      await ctx.ledger_store.savePhaseCCheckpoint(c_result);
    }

    if (!c_result) {
      if (!b_result) {
        throw new Error('b_result is null at PROMOTING phase — internal controller error');
      }

      c_result = await runPhaseCPromotion(
        b_result,
        ctx.system_state_snapshot,
        ctx.capability_graph_evaluator ?? NULL_CAPABILITY_GRAPH_EVALUATOR,
        { audit_log_dir: audit_dir }
      );

      const c_errors = validatePromotingGateResultShell(c_result);
      if (c_errors.length > 0) {
        throw new Error(`Phase C output validation failed: ${c_errors.join('; ')}`);
      }

      // Checkpoint Phase C
      await ctx.ledger_store.savePhaseCCheckpoint(c_result);
    }

    // ── Inject Human-Review-Approved patches ─────────────────────────────
    // Patches that were DEFERRED_HUMAN in a previous cycle and subsequently
    // APPROVED by a human operator are promoted here, bypassing the
    // blast-radius gate (the operator's approval is the gate).
    if (ctx.human_review_store && c_result) {
      const approved_entries = await ctx.human_review_store.readApprovedPendingEntries();

      if (approved_entries.length > 0) {
        const promoted_at = new Date().toISOString();
        const extra_skills = [];
        const to_remove: string[] = [];

        for (const entry of approved_entries) {
          // Load the Phase B checkpoint from the cycle when the patch was originally verified.
          const source_b = await ctx.ledger_store.loadPhaseBCheckpoint(entry.source_cycle_id);
          const verified_patch = source_b?.verified.find(
            (p) => p.candidate_id === entry.patch_id
          ) ?? null;

          if (verified_patch !== null) {
            extra_skills.push(buildPromotedSkill(verified_patch, promoted_at));
          }
          // Always remove from the approved-pending list — stale or promoted.
          to_remove.push(entry.patch_id);
        }

        if (extra_skills.length > 0) {
          c_result = {
            ...c_result,
            promoted_skills: [...c_result.promoted_skills, ...extra_skills],
            promoted_count: c_result.promoted_count + extra_skills.length,
          };
        }

        for (const patch_id of to_remove) {
          await ctx.human_review_store.removeApprovedPendingEntry(patch_id);
        }
      }
    }

    // ── AGGREGATING (Phase D) ─────────────────────────────────────────────
    final_phase = 'AGGREGATING';

    if (!b_result || !c_result) {
      throw new Error('b_result or c_result is null at AGGREGATING phase — internal controller error');
    }

    const [
      active_failure_ledger_d,
      previous_cycle_metrics,
      cumulative_promoted_before,
      prior_consecutive_stable,
      prior_cycle_lineage,
    ] = await Promise.all([
      ctx.ledger_store.readFailureLedger(),
      ctx.ledger_store.readPreviousCycleMetrics(),
      ctx.ledger_store.readCumulativePromotedSkillCount(),
      ctx.ledger_store.readPriorConsecutiveStableCycles(),
      ctx.ledger_store.readPriorCycleLineage(),
    ]);

    const prior_tier: EvolutionTier = prior_cycle_lineage.length > 0
      ? prior_cycle_lineage[0]!.tier
      : null;

    const saved_time = buildSavedTimeMinutesFromBResult(b_result, c_result);

    // ── Drift metrics (if DriftMonitor is wired) ──────────────────────────
    // drift_metrics_pre_c was already computed before PROMOTING.
    // Re-use it here so Phase D sees the same snapshot that gated Phase C.

    const phase_d_pack: PhaseDInputPack = {
      b_result,
      c_result,
      active_failure_ledger: active_failure_ledger_d,
      stability_index: stability_index_obj,
      saved_time_minutes: saved_time,
      tokens_saved: sumConfirmedMetric(c_result, 'tokens_saved'),
      bugs_killed: sumConfirmedMetric(c_result, 'bugs_killed'),
      refined_code_lines: sumConfirmedMetric(c_result, 'refined_code_lines'),
      previous_tier: prior_tier,
      prior_consecutive_stable_cycles: prior_consecutive_stable,
      cumulative_promoted_skill_count_before: cumulative_promoted_before,
      previous_cycle_metrics,
      next_cycle_recommendations: ctx.next_cycle_recommendations,
      prior_cycle_lineage,
      legitimacy_tier: ctx.legitimacy_tier,
      drift_metrics: drift_metrics_pre_c,
      drift_adaptation: adaptation,
    };

    const morning_result = await aggregateMorningResult(phase_d_pack, {
      audit_log_dir: audit_dir,
    });

    const m_errors = validateMorningResultShell(morning_result);
    if (m_errors.length > 0) {
      throw new Error(`Phase D (MorningResult) validation failed: ${m_errors.join('; ')}`);
    }

    // Persist MorningResult
    await ctx.ledger_store.writeMorningResult(morning_result);

    // ── Phase E ①: Rollback executor ─────────────────────────────────────
    // When drift is actively degrading and promotion is blocked, write a
    // RollbackExecutionRecord so Phase A next cycle receives
    // active_rollback_targets and focuses on recovery candidates.
    // When drift resolves (or drift_monitor is nil), clear any stale record.
    if (ctx.drift_monitor) {
      const do_rollback =
        adaptation?.promotion_blocked === true &&
        (adaptation.rollback_suggestions.length ?? 0) > 0;

      if (do_rollback) {
        const rollback_record = buildRollbackExecutionRecord(adaptation!, cycle_id);
        if (rollback_record) {
          await ctx.ledger_store.writeRollbackRecord(rollback_record);
        }
      } else {
        // Drift resolved or no actionable suggestions — clear stale record so
        // Phase A reverts to normal exploration next cycle.
        await ctx.ledger_store.clearRollbackRecord();
      }
    }

    // Write MorningResult JSON to morning_dir
    const out_path = path.join(morning_dir, `morning_result_${cycle_id}.json`);
    fs.writeFileSync(out_path, JSON.stringify(morning_result, null, 2), 'utf8');
    morning_result_path = out_path;

    // TSM back to OBSERVING (ready for next cycle)
    await transitionTo(ctx.ledger_store, cycle_id, 'OBSERVING');

    completed = true;
    final_phase = 'AGGREGATING';

  } catch (err) {
    recordError(final_phase, err);
    // Do NOT advance TSM on error — preserves resume point
  }

  // ── Write LoopRunRecord ───────────────────────────────────────────────────
  const finished_at = new Date().toISOString();
  const run_record: LoopRunRecord = {
    schema_version: 'nightly_loop_run/0.1',
    run_id,
    cycle_id,
    started_at,
    finished_at,
    completed,
    final_phase,
    error_log,
    morning_result_path,
  };

  try {
    const run_record_path = path.join(config.run_dir, `loop_run_${run_id}.json`);
    fs.writeFileSync(run_record_path, JSON.stringify(run_record, null, 2), 'utf8');
  } catch (_) {
    // Run record write failure is non-fatal
  }

  return run_record;
}

// ---------------------------------------------------------------------------
// SECTION 5 — Metric aggregation helpers
// ---------------------------------------------------------------------------

/**
 * Build a SavedTimeMinutes aggregate from the confirmed improvements of
 * all promoted skills in Phase C.
 */
function buildSavedTimeMinutesFromBResult(
  _b_result: PhaseBBatchResult,
  c_result: PromotingGateResult
): SavedTimeMinutes {
  const top_workf = c_result.promoted_skills
    .filter((s) => s.confirmed_improvements.saved_time_minutes !== null)
    .map((s) => ({
      workflow_id: s.source_verified_patch_id,  // proxy — real workflow IDs come from verified patch metadata
      saved_minutes: s.confirmed_improvements.saved_time_minutes!,
      confidence_weight: 1.0 as number,
    }));

  const total = top_workf.reduce((acc, w) => acc + w.saved_minutes, 0);

  return {
    total,
    top_workflows: top_workf,
    regression_alerts: [],  // Phase B already catches regressions; none here
  };
}

/**
 * Sum a scalar confirmed improvement metric across all promoted skills.
 */
function sumConfirmedMetric(
  c_result: PromotingGateResult,
  field: 'tokens_saved' | 'bugs_killed' | 'refined_code_lines'
): number {
  return c_result.promoted_skills.reduce((acc, s) => {
    const v = s.confirmed_improvements[field];
    return acc + (v !== null ? v : 0);
  }, 0);
}

// ---------------------------------------------------------------------------
// SECTION 6 — Convenience: FilesystemLedgerStore (JSON-file reference impl)
// ---------------------------------------------------------------------------

/**
 * A reference LedgerStore implementation backed by plain JSON files.
 *
 * Directory layout under <ledger_dir>:
 *   task_state.json            — TaskStateMachineRecord
 *   failure_ledger.json        — FailureLedgerEntry[]
 *   morning_results/           — one JSON per cycle
 *   checkpoints/phase_b_<id>.json
 *   checkpoints/phase_c_<id>.json
 *   cumulative_stats.json      — promoted_skill_count, consecutive_stable_cycles
 *   cycle_lineage.json         — CycleLineageSummary[] (max 7, newest first)
 *   previous_cycle_metrics.json
 */
export class FilesystemLedgerStore implements LedgerStore {
  private readonly dir: string;

  constructor(ledger_dir: string) {
    this.dir = ledger_dir;
    fs.mkdirSync(path.join(ledger_dir, 'morning_results'), { recursive: true });
    fs.mkdirSync(path.join(ledger_dir, 'checkpoints'), { recursive: true });
  }

  private read<T>(filename: string, default_val: T): T {
    const p = path.join(this.dir, filename);
    if (!fs.existsSync(p)) return default_val;
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  }

  private write(filename: string, data: unknown): void {
    fs.writeFileSync(path.join(this.dir, filename), JSON.stringify(data, null, 2), 'utf8');
  }

  async readTaskStateMachine(): Promise<TaskStateMachineRecord | null> {
    return this.read<TaskStateMachineRecord | null>('task_state.json', null);
  }

  async writeTaskStateMachine(record: TaskStateMachineRecord): Promise<void> {
    this.write('task_state.json', record);
  }

  async readFailureLedger(): Promise<FailureLedgerEntry[]> {
    return this.read<FailureLedgerEntry[]>('failure_ledger.json', []);
  }

  async applyFailureLedgerWrites(b_result: PhaseBBatchResult, cycle_id: string): Promise<void> {
    const ledger = await this.readFailureLedger();
    const index = new Map(ledger.map((e, i) => [e.code, i]));

    for (const rejected of b_result.rejected) {
      const write = rejected.failure_ledger_write;
      if (!write) continue;

      const existing_idx = index.get(write.code);
      if (existing_idx !== undefined) {
        ledger[existing_idx]!.occurrence_count += 1;
        ledger[existing_idx]!.last_observed_cycle_id = cycle_id;
      } else {
        ledger.push({
          code: write.code,
          first_observed_cycle_id: cycle_id,
          last_observed_cycle_id: cycle_id,
          occurrence_count: 1,
          negative_constraint: write.negative_constraint,
        });
        index.set(write.code, ledger.length - 1);
      }
    }

    this.write('failure_ledger.json', ledger);
  }

  async readPreviousCycleMetrics(): Promise<PhaseDInputPack['previous_cycle_metrics']> {
    return this.read<PhaseDInputPack['previous_cycle_metrics']>('previous_cycle_metrics.json', null);
  }

  async readCumulativePromotedSkillCount(): Promise<number> {
    const stats = this.read<{ promoted_skill_count: number; consecutive_stable_cycles: number }>(
      'cumulative_stats.json',
      { promoted_skill_count: 0, consecutive_stable_cycles: 0 }
    );
    return stats.promoted_skill_count;
  }

  async readPriorConsecutiveStableCycles(): Promise<number> {
    const stats = this.read<{ promoted_skill_count: number; consecutive_stable_cycles: number }>(
      'cumulative_stats.json',
      { promoted_skill_count: 0, consecutive_stable_cycles: 0 }
    );
    return stats.consecutive_stable_cycles;
  }

  async readRecentCycleIds(): Promise<string[]> {
    const lineage = await this.readPriorCycleLineage();
    return lineage.map((l) => l.cycle_id);
  }

  async readPriorCycleLineage(): Promise<CycleLineageSummary[]> {
    return this.read<CycleLineageSummary[]>('cycle_lineage.json', []);
  }

  async writeMorningResult(result: MorningResult): Promise<void> {
    // Write indexed file
    this.write(
      path.join('morning_results', `morning_result_${result.cycle_id}.json`),
      result
    );

    // Update previous_cycle_metrics
    this.write('previous_cycle_metrics.json', {
      stability_index_score: result.metrics.stability_index.score,
      saved_time_minutes_total: result.metrics.saved_time_minutes.total,
      tokens_saved: result.metrics.tokens_saved,
      bugs_killed: result.metrics.bugs_killed,
      refined_code_lines: result.metrics.refined_code_lines,
    });

    // Update cumulative stats
    this.write('cumulative_stats.json', {
      promoted_skill_count: result.evolution.cumulative_promoted_skill_count,
      consecutive_stable_cycles: result.evolution.consecutive_stable_cycles,
    });

    // Prepend to cycle lineage, keep max 7
    const lineage = await this.readPriorCycleLineage();
    const new_entry = result.proof.cycle_lineage[0]!;
    const updated = [new_entry, ...lineage].slice(0, 7);
    this.write('cycle_lineage.json', updated);

    // Phase E ②: persist drift adaptation so next cycle can apply rate cap
    if (result.drift?.adaptation) {
      this.write('latest_drift_adaptation.json', result.drift.adaptation);
    }
  }

  async savePhaseBCheckpoint(b_result: PhaseBBatchResult): Promise<void> {
    this.write(path.join('checkpoints', `phase_b_${b_result.cycle_id}.json`), b_result);
  }

  async loadPhaseBCheckpoint(cycle_id: string): Promise<PhaseBBatchResult | null> {
    return this.read<PhaseBBatchResult | null>(
      path.join('checkpoints', `phase_b_${cycle_id}.json`),
      null
    );
  }

  async savePhaseCCheckpoint(c_result: PromotingGateResult): Promise<void> {
    this.write(path.join('checkpoints', `phase_c_${c_result.cycle_id}.json`), c_result);
  }

  async loadPhaseCCheckpoint(cycle_id: string): Promise<PromotingGateResult | null> {
    return this.read<PromotingGateResult | null>(
      path.join('checkpoints', `phase_c_${cycle_id}.json`),
      null
    );
  }

  // ── Phase E ①②: drift adaptation persistence + rollback execution ────────

  async readLastDriftAdaptation(): Promise<DriftAdaptationDecision | null> {
    return this.read<DriftAdaptationDecision | null>('latest_drift_adaptation.json', null);
  }

  async readActiveRollbackRecord(): Promise<RollbackExecutionRecord | null> {
    return this.read<RollbackExecutionRecord | null>('active_rollback.json', null);
  }

  async writeRollbackRecord(record: RollbackExecutionRecord): Promise<void> {
    this.write('active_rollback.json', record);
  }

  async clearRollbackRecord(): Promise<void> {
    const p = path.join(this.dir, 'active_rollback.json');
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
