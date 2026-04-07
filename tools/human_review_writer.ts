/**
 * tools/human_review_writer.ts
 *
 * Human Review Authority — Decision Writer
 * schema_version: human_review/0.1
 *
 * This module is the seam between the Human Review Authority UI and the
 * ledger.  It is the ONLY place that mutates the review queue and writes
 * approval/rejection outcomes.
 *
 * Responsibilities:
 *   1. Validate a ReviewDecision before any ledger mutation takes place.
 *   2. Apply APPROVE: move patch to ApprovedPendingPromotion; remove from queue.
 *   3. Apply REJECT:  write ReviewRejectionAudit; remove from queue.
 *   4. Write the immutable ReviewDecisionRecord for audit traceability.
 *   5. Update ReviewQueueSnapshot.last_updated_at.
 *
 * Fail-closed guarantee:
 *   Any validation error aborts the operation with NO partial writes.
 *   The ledger is never left in a half-updated state.
 *   applyReviewDecision() throws ReviewDecisionError on any failure.
 *
 * This is a SEAM module — it depends only on:
 *   - The HumanReviewStore interface (injected; no direct file I/O in business logic)
 *   - The contract types from contract/human_review.d.ts
 *
 * Reference implementation:
 *   FilesystemHumanReviewStore — JSON-file backed store (below).
 *
 * Not covered here:
 *   - Authentication / authorisation of reviewer_id  (UI layer concern)
 *   - Scheduling of next-cycle promotion for ApprovedPendingEntries  (nightly_loop_runner concern)
 *   - Notifying the nightly runner that new approvals are ready  (operator workflow concern)
 *
 * Directory layout produced by FilesystemHumanReviewStore under <review_dir>:
 *   review_queue.json           — ReviewQueueSnapshot (mutable)
 *   approved_pending.json       — ApprovedPendingEntry[] (consumed by next cycle)
 *   rejection_audit.json        — ReviewRejectionAudit[] (append-only)
 *   decisions/
 *     decision_<id>.json        — ReviewDecisionRecord (one per decision, immutable)
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  ReviewDecision,
  ReviewDecisionRecord,
  ReviewDecisionValidationErrors,
  ReviewQueueSnapshot,
  PendingHumanReviewEntry,
  ApprovedPendingEntry,
  ReviewRejectionAudit,
} from '../contract/human_review';

// ---------------------------------------------------------------------------
// SECTION 1 — HumanReviewStore seam
// ---------------------------------------------------------------------------

/**
 * All persistence for the human review workflow goes through this interface.
 * The business logic in this module never calls fs.* directly.
 *
 * Implementors:
 *   - FilesystemHumanReviewStore (reference implementation, below)
 *   - Any future database-backed store
 */
export interface HumanReviewStore {
  /** Read the current review queue. Returns an empty snapshot if none exists. */
  readReviewQueue(): Promise<ReviewQueueSnapshot>;

  /** Overwrite the review queue. Called atomically by applyReviewDecision. */
  writeReviewQueue(snapshot: ReviewQueueSnapshot): Promise<void>;

  /**
   * Append one entry to the approved-pending-promotion list.
   * The nightly runner reads this list at the start of Phase C each cycle.
   */
  appendApprovedPendingEntry(entry: ApprovedPendingEntry): Promise<void>;

  /** Read all approved patches not yet promoted. */
  readApprovedPendingEntries(): Promise<ApprovedPendingEntry[]>;

  /**
   * Remove an entry from the approved-pending list after it has been promoted.
   * Called by the nightly runner post-promotion (not by this module).
   */
  removeApprovedPendingEntry(patch_id: string): Promise<void>;

  /** Append one rejection audit record. Append-only; never modified. */
  appendRejectionAudit(audit: ReviewRejectionAudit): Promise<void>;

  /**
   * Persist one ReviewDecisionRecord.
   * File named decisions/decision_<decision_id>.json — never overwritten.
   * Throws if a record with the same decision_id already exists.
   */
  saveDecisionRecord(record: ReviewDecisionRecord): Promise<void>;
}

// ---------------------------------------------------------------------------
// SECTION 2 — Validation
// ---------------------------------------------------------------------------

/**
 * Validate a ReviewDecision before applying it.
 *
 * Returns an empty array when the decision is structurally valid and
 * referentially compatible with the queue snapshot.
 *
 * All checks are pure / synchronous to keep the validator easy to test.
 */
export function validateReviewDecision(
  decision: ReviewDecision,
  queue: ReviewQueueSnapshot
): ReviewDecisionValidationErrors {
  const errors: string[] = [];

  // --- Schema version ---
  if (decision.schema_version !== 'human_review/0.1') {
    errors.push(
      `schema_version must be 'human_review/0.1', got '${decision.schema_version}'`
    );
  }

  // --- Required string fields ---
  if (!decision.decision_id || decision.decision_id.trim() === '') {
    errors.push('decision_id is required and must be a non-empty string');
  }
  if (!decision.patch_id || decision.patch_id.trim() === '') {
    errors.push('patch_id is required and must be a non-empty string');
  }
  if (!decision.source_cycle_id || decision.source_cycle_id.trim() === '') {
    errors.push('source_cycle_id is required and must be a non-empty string');
  }
  if (!decision.reviewer_id || decision.reviewer_id.trim() === '') {
    errors.push('reviewer_id is required and must be a non-empty string');
  }
  if (!decision.decided_at || decision.decided_at.trim() === '') {
    errors.push('decided_at is required and must be an ISO-8601 UTC string');
  }

  // --- Verdict ---
  if (decision.verdict !== 'APPROVE' && decision.verdict !== 'REJECT') {
    errors.push(`verdict must be 'APPROVE' or 'REJECT', got '${decision.verdict}'`);
  }

  // --- Comment required on rejection ---
  if (decision.verdict === 'REJECT' && !decision.comment) {
    errors.push("comment is required when verdict = 'REJECT'");
  }

  // --- Reference check: patch must be in the pending queue ---
  const queue_entry = queue.pending.find((p) => p.patch_id === decision.patch_id);
  if (!queue_entry) {
    errors.push(
      `patch_id '${decision.patch_id}' is not in the pending review queue`
    );
  } else if (queue_entry.source_cycle_id !== decision.source_cycle_id) {
    errors.push(
      `source_cycle_id mismatch: decision has '${decision.source_cycle_id}', ` +
      `queue has '${queue_entry.source_cycle_id}' for patch '${decision.patch_id}'`
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// SECTION 3 — ReviewDecisionError
// ---------------------------------------------------------------------------

/**
 * Thrown by applyReviewDecision when validation or storage fails.
 * Always safe to retry after fixing the underlying issue — no partial writes
 * are made before this error is thrown.
 */
export class ReviewDecisionError extends Error {
  readonly validation_errors: ReviewDecisionValidationErrors;

  constructor(message: string, validation_errors: ReviewDecisionValidationErrors = []) {
    super(message);
    this.name = 'ReviewDecisionError';
    this.validation_errors = validation_errors;
  }
}

// ---------------------------------------------------------------------------
// SECTION 4 — Core writer
// ---------------------------------------------------------------------------

/**
 * Apply a human review decision to the ledger.
 *
 * Steps (all-or-nothing; throws ReviewDecisionError if any step fails):
 *   1. Read the current review queue.
 *   2. Validate the decision (structure + queue reference).
 *   3. Remove the patch from the pending queue.
 *   4a. APPROVE: append to ApprovedPendingPromotion.
 *   4b. REJECT:  append to RejectionAudit.
 *   5. Write the updated queue snapshot.
 *   6. Save the immutable ReviewDecisionRecord.
 *
 * @returns  The ReviewDecisionRecord written to the ledger.
 * @throws   ReviewDecisionError — validation failed or patch not found.
 */
export async function applyReviewDecision(
  decision: ReviewDecision,
  store: HumanReviewStore
): Promise<ReviewDecisionRecord> {
  // ── Step 1: Read the queue ────────────────────────────────────────────────
  const queue = await store.readReviewQueue();

  // ── Step 2: Validate ──────────────────────────────────────────────────────
  const validation_errors = validateReviewDecision(decision, queue);
  if (validation_errors.length > 0) {
    throw new ReviewDecisionError(
      `ReviewDecision validation failed: ${validation_errors.join('; ')}`,
      validation_errors
    );
  }

  // ── Step 3: Remove patch from pending queue ───────────────────────────────
  const updated_pending = queue.pending.filter((p) => p.patch_id !== decision.patch_id);
  const updated_queue: ReviewQueueSnapshot = {
    ...queue,
    pending: updated_pending,
    last_updated_at: new Date().toISOString(),
  };

  // ── Step 4: Apply verdict ─────────────────────────────────────────────────
  const processed_at = new Date().toISOString();

  if (decision.verdict === 'APPROVE') {
    const approved_entry: ApprovedPendingEntry = {
      patch_id: decision.patch_id,
      source_cycle_id: decision.source_cycle_id,
      approved_by_decision_id: decision.decision_id,
      approved_at: processed_at,
    };
    await store.appendApprovedPendingEntry(approved_entry);
  } else {
    // verdict === 'REJECT'
    const rejection_audit: ReviewRejectionAudit = {
      decision_id: decision.decision_id,
      patch_id: decision.patch_id,
      source_cycle_id: decision.source_cycle_id,
      reviewer_id: decision.reviewer_id,
      rejected_at: processed_at,
      comment: decision.comment,
    };
    await store.appendRejectionAudit(rejection_audit);
  }

  // ── Step 5: Write updated queue ───────────────────────────────────────────
  await store.writeReviewQueue(updated_queue);

  // ── Step 6: Save immutable decision record ────────────────────────────────
  const record: ReviewDecisionRecord = {
    ...decision,
    outcome: decision.verdict === 'APPROVE' ? 'QUEUED_FOR_PROMOTION' : 'REJECTED_AND_LOGGED',
    processed_at,
  };
  await store.saveDecisionRecord(record);

  return record;
}

// ---------------------------------------------------------------------------
// SECTION 5 — Queue builder helper
// ---------------------------------------------------------------------------

/**
 * Build a ReviewQueueSnapshot from a list of DEFERRED_HUMAN gate results.
 *
 * Called by the nightly runner after Phase C, passing the subset of
 * VerifiedPatchGateResult entries where disposition = 'DEFERRED_HUMAN'.
 *
 * If the gate result does not contain a human_review_event, the entry is
 * skipped with a logged warning — this represents a malformed Phase C output.
 */
export function buildReviewQueueEntries(
  deferred_results: ReadonlyArray<{
    candidate_id: string;
    human_review_event: {
      patch_id: string;
      reason: string;
      ts: string;
    } | null;
  }>,
  patch_metadata: ReadonlyArray<{
    candidate_id: string;
    title: string;
    description: string;
    affected_targets: string[];
    confidence_score: number;
    source_cycle_id: string;
  }>
): PendingHumanReviewEntry[] {
  const meta_map = new Map(patch_metadata.map((m) => [m.candidate_id, m]));
  const entries: PendingHumanReviewEntry[] = [];

  for (const result of deferred_results) {
    if (!result.human_review_event) continue;

    const meta = meta_map.get(result.candidate_id);
    if (!meta) continue;

    entries.push({
      patch_id: result.candidate_id,
      source_cycle_id: meta.source_cycle_id,
      title: meta.title,
      description: meta.description,
      affected_targets: meta.affected_targets,
      blast_radius: 'GLOBAL',
      confidence_score: meta.confidence_score,
      deferred_at: result.human_review_event.ts,
      deferral_reason: result.human_review_event.reason,
    });
  }

  return entries;
}

/**
 * Merge new deferred entries into an existing ReviewQueueSnapshot.
 *
 * Entries whose patch_id already exists in the current queue are skipped
 * (idempotent — safe to call on every cycle, even on resume).
 */
export function mergeIntoReviewQueue(
  current: ReviewQueueSnapshot,
  new_entries: PendingHumanReviewEntry[]
): ReviewQueueSnapshot {
  const existing_ids = new Set(current.pending.map((p) => p.patch_id));
  const to_add = new_entries.filter((e) => !existing_ids.has(e.patch_id));

  if (to_add.length === 0) return current;

  return {
    ...current,
    pending: [...current.pending, ...to_add].sort(
      (a, b) => a.deferred_at.localeCompare(b.deferred_at)
    ),
    last_updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// SECTION 6 — FilesystemHumanReviewStore (reference implementation)
// ---------------------------------------------------------------------------

/**
 * A HumanReviewStore backed by plain JSON files.
 *
 * Directory layout under <review_dir>:
 *   review_queue.json           — ReviewQueueSnapshot
 *   approved_pending.json       — ApprovedPendingEntry[]
 *   rejection_audit.json        — ReviewRejectionAudit[] (append-only)
 *   decisions/
 *     decision_<id>.json        — ReviewDecisionRecord (immutable per decision)
 */
export class FilesystemHumanReviewStore implements HumanReviewStore {
  private readonly dir: string;

  constructor(review_dir: string) {
    this.dir = review_dir;
    fs.mkdirSync(path.join(review_dir, 'decisions'), { recursive: true });
  }

  private p(filename: string): string {
    return path.join(this.dir, filename);
  }

  private readJson<T>(filename: string, default_val: T): T {
    const full = this.p(filename);
    if (!fs.existsSync(full)) return default_val;
    return JSON.parse(fs.readFileSync(full, 'utf8')) as T;
  }

  private writeJson(filename: string, data: unknown): void {
    fs.writeFileSync(this.p(filename), JSON.stringify(data, null, 2), 'utf8');
  }

  async readReviewQueue(): Promise<ReviewQueueSnapshot> {
    return this.readJson<ReviewQueueSnapshot>('review_queue.json', {
      schema_version: 'review_queue/0.1',
      pending: [],
      last_updated_at: new Date().toISOString(),
    });
  }

  async writeReviewQueue(snapshot: ReviewQueueSnapshot): Promise<void> {
    this.writeJson('review_queue.json', snapshot);
  }

  async appendApprovedPendingEntry(entry: ApprovedPendingEntry): Promise<void> {
    const current = this.readJson<ApprovedPendingEntry[]>('approved_pending.json', []);
    current.push(entry);
    this.writeJson('approved_pending.json', current);
  }

  async readApprovedPendingEntries(): Promise<ApprovedPendingEntry[]> {
    return this.readJson<ApprovedPendingEntry[]>('approved_pending.json', []);
  }

  async removeApprovedPendingEntry(patch_id: string): Promise<void> {
    const current = this.readJson<ApprovedPendingEntry[]>('approved_pending.json', []);
    this.writeJson(
      'approved_pending.json',
      current.filter((e) => e.patch_id !== patch_id)
    );
  }

  async appendRejectionAudit(audit: ReviewRejectionAudit): Promise<void> {
    const current = this.readJson<ReviewRejectionAudit[]>('rejection_audit.json', []);
    current.push(audit);
    this.writeJson('rejection_audit.json', current);
  }

  async saveDecisionRecord(record: ReviewDecisionRecord): Promise<void> {
    const filename = path.join('decisions', `decision_${record.decision_id}.json`);
    const full = this.p(filename);
    if (fs.existsSync(full)) {
      throw new ReviewDecisionError(
        `Decision record already exists for decision_id '${record.decision_id}'. ` +
        `ReviewDecisionRecords are immutable and may not be overwritten.`
      );
    }
    this.writeJson(filename, record);
  }
}

// ---------------------------------------------------------------------------
// SECTION 7 — Convenience factory
// ---------------------------------------------------------------------------

/**
 * Build a ReviewDecision with a generated decision_id and decided_at timestamp.
 * Convenience for the UI layer — avoids the caller needing to call randomUUID().
 */
export function makeReviewDecision(
  params: Omit<ReviewDecision, 'schema_version' | 'decision_id' | 'decided_at'>
): ReviewDecision {
  return {
    schema_version: 'human_review/0.1',
    decision_id: randomUUID(),
    decided_at: new Date().toISOString(),
    ...params,
  };
}
