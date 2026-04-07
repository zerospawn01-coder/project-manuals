/**
 * tools/rollback_executor.ts
 *
 * Phase E ① — Rollback Executor
 * ==============================
 *
 * 目的:
 *   DriftAdaptationDecision.rollback_suggestions を「実際に実行」する。
 *
 *   このガバナンスOSはライブコードを直接書き換えない。
 *   「実行」とは:
 *     1. RollbackExecutionRecord をレジャーに書き込む（監査証跡）
 *     2. 次サイクルの Phase A が active_rollback_targets を受け取る
 *        → LLM が "回復候補" を重点生成する
 *     3. drift が解消されたら自動的に RECOVERED に遷移してクリア
 *
 * 設計方針:
 *   - 純粋関数 buildRollbackExecutionRecord() でレコードを組み立て
 *   - 本ファイルはI/Oを行わない。書き込みは LedgerStore が担う
 *   - status: 'PENDING_RECOVERY' → clearRollbackRecord() により削除
 */

import { randomUUID } from 'crypto';
import type { DriftAdaptationDecision } from './drift_adaptation.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const ROLLBACK_SCHEMA_VERSION = 'rollback_exec/0.1' as const;

export interface ExecutedRollbackTarget {
  /** Degrading function name (from DriftMetrics.target_function). */
  target_function: string;

  /** run_id at "last good" state — null if no stable history. */
  last_good_run_id: string | null;

  /** benchmark_signature at "last good" state — null if unavailable. */
  last_good_benchmark_signature: string | null;

  /** ISO-8601 UTC timestamp of last good run — null if unavailable. */
  last_good_measured_at: string | null;

  /** Lifecycle status of this rollback target. */
  status: 'PENDING_RECOVERY' | 'RECOVERED';

  /** ISO-8601 UTC when status transitioned to RECOVERED. null while PENDING. */
  recovered_at: string | null;
}

export interface RollbackExecutionRecord {
  schema_version: typeof ROLLBACK_SCHEMA_VERSION;

  /** UUID for this execution record. */
  execution_id: string;

  /** Cycle ID that triggered these rollbacks. */
  source_cycle_id: string;

  /** ISO-8601 UTC of execution. */
  executed_at: string;

  /** One entry per actionable rollback suggestion. */
  targets: ExecutedRollbackTarget[];
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build a RollbackExecutionRecord from a DriftAdaptationDecision.
 *
 * Only includes suggestions where last_good_run_id is non-null — those
 * are the ones with a concrete revert target. Returns null if nothing to
 * execute (all suggestions have no stable history, or list is empty).
 */
export function buildRollbackExecutionRecord(
  adaptation: DriftAdaptationDecision,
  source_cycle_id: string
): RollbackExecutionRecord | null {
  const actionable = adaptation.rollback_suggestions.filter(
    (s) => s.last_good_run_id !== null
  );

  if (actionable.length === 0) return null;

  return {
    schema_version: ROLLBACK_SCHEMA_VERSION,
    execution_id: randomUUID(),
    source_cycle_id,
    executed_at: new Date().toISOString(),
    targets: actionable.map((s) => ({
      target_function: s.target_function,
      last_good_run_id: s.last_good_run_id,
      last_good_benchmark_signature: s.last_good_benchmark_signature,
      last_good_measured_at: s.last_good_measured_at,
      status: 'PENDING_RECOVERY',
      recovered_at: null,
    })),
  };
}

/**
 * Mark any targets in an existing record as RECOVERED when the current cycle's
 * drift_detected is false for them (i.e. drift has resolved).
 *
 * Returns a new record with updated statuses, or null if ALL targets are now
 * RECOVERED (the caller should then call clearRollbackRecord()).
 */
export function applyDriftResolutionToRecord(
  record: RollbackExecutionRecord,
  still_degrading_functions: Set<string>
): RollbackExecutionRecord | null {
  const now = new Date().toISOString();
  const updated_targets: ExecutedRollbackTarget[] = record.targets.map((t) => {
    if (t.status === 'RECOVERED') return t;
    if (!still_degrading_functions.has(t.target_function)) {
      return { ...t, status: 'RECOVERED', recovered_at: now };
    }
    return t;
  });

  const any_pending = updated_targets.some((t) => t.status === 'PENDING_RECOVERY');
  if (!any_pending) return null; // signal: clear the record entirely

  return { ...record, targets: updated_targets };
}
