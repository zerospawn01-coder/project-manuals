/**
 * contract/human_review.d.ts
 *
 * Human Review Authority — Contract Layer
 * Schema version: human_review/0.1
 *
 * Defines the data structures for the human-in-the-loop approval gate.
 *
 * Context:
 *   Phase C produces VerifiedPatchGateResult entries with
 *   disposition = 'DEFERRED_HUMAN' when blast_radius = 'GLOBAL'.
 *   These patches are placed in a review queue and blocked from automatic
 *   promotion until a human operator issues an explicit APPROVE or REJECT.
 *
 * Data flow:
 *   Phase C (PROMOTING)
 *     ↓  disposition = 'DEFERRED_HUMAN'
 *   PendingHumanReviewEntry  ← written by nightly_loop_runner after Phase C
 *     ↓
 *   ReviewQueueSnapshot       ← persisted in ledger; read by UI
 *     ↓  operator decision
 *   ReviewDecision            ← submitted by Human Review Authority UI
 *     ↓  processed by human_review_writer
 *   ReviewDecisionRecord      ← immutable audit entry
 *     + APPROVE → ApprovedPendingEntry  queued for next Phase C
 *     + REJECT  → ReviewRejectionAudit  audit only (no promotion)
 *
 * Invariants:
 *   - A patch_id may appear in ReviewQueueSnapshot.pending at most ONCE.
 *   - Once a ReviewDecision is recorded, the patch_id is removed from the
 *     pending queue and may never re-enter it.
 *   - APPROVE promotions are applied in the NEXT nightly cycle's Phase C,
 *     not the current one. (This preserves the daily approval cadence.)
 *
 * Schema freeze: human_review/0.1
 * To change: bump minor version, add migration note here.
 *
 * Imports:
 *   - VerifiedPatchGateResult  from ./phase_c_promote  (see 'deferred_at' / 'reason')
 */

// ---------------------------------------------------------------------------
// Verdict — the operator's binary decision
// ---------------------------------------------------------------------------

/**
 * APPROVE: Operator confirms this GLOBAL-blast patch is safe to promote.
 *          The patch enters ApprovedPendingPromotion and is promoted in the
 *          next nightly cycle's Phase C.
 *
 * REJECT:  Operator vetoes this patch. It is permanently removed from the
 *          queue. A ReviewRejectionAudit record is written for traceability.
 *          No failure ledger entry is created (rejection is a policy decision,
 *          not a code defect).
 */
export type ReviewVerdict = 'APPROVE' | 'REJECT';

// ---------------------------------------------------------------------------
// PendingHumanReviewEntry — one patch awaiting operator review
// ---------------------------------------------------------------------------

/**
 * A pre-verified patch that passed Phase B sandbox testing but was blocked
 * by Phase C's blast-radius gate and requires human approval before promotion.
 *
 * All fields are derived from Phase C outputs — no additional queries needed.
 * This structure is the single source of truth for the review queue UI.
 */
export interface PendingHumanReviewEntry {
  /** The candidate_id from Phase A / B / C (stable UUID). */
  patch_id: string;

  /** The cycle in which this patch was evaluated and deferred. */
  source_cycle_id: string;

  /** Verbatim from PatchCandidate.title. */
  title: string;

  /** Verbatim from PatchCandidate.description. */
  description: string;

  /** Verbatim from PromotedSkill.affected_targets (file paths). */
  affected_targets: string[];

  /**
   * Always 'GLOBAL' — that is the only blast_radius that triggers DEFERRED_HUMAN.
   * Stored explicitly so the UI can render it without re-deriving.
   */
  blast_radius: 'GLOBAL';

  /**
   * Phase B sandbox confidence score for this patch.
   * Range [0.0, 1.0]. Included to help the reviewer assess risk.
   */
  confidence_score: number;

  /**
   * ISO-8601 UTC timestamp from VerifiedPatchGateResult.human_review_event.ts.
   * Represents when Phase C deferred this patch.
   */
  deferred_at: string;

  /**
   * Human-readable deferral reason from
   * VerifiedPatchGateResult.human_review_event.reason.
   * e.g. "blast_radius='GLOBAL' exceeds max_allowed_blast_radius='TENANT'"
   */
  deferral_reason: string;
}

// ---------------------------------------------------------------------------
// ReviewQueueSnapshot — full queue state at a point in time
// ---------------------------------------------------------------------------

/**
 * The complete review queue as persisted in the ledger.
 * Written once per cycle (after Phase C) and updated after each ReviewDecision.
 *
 * Consumers:
 *   - PatchReviewQueue.tsx reads this to render the list of pending patches.
 *   - human_review_writer reads this before processing each decision.
 */
export interface ReviewQueueSnapshot {
  schema_version: 'review_queue/0.1';

  /** All patches currently awaiting review, ordered by deferred_at ascending. */
  pending: PendingHumanReviewEntry[];

  /** ISO-8601 UTC timestamp when this snapshot was last written. */
  last_updated_at: string;
}

// ---------------------------------------------------------------------------
// ReviewDecision — the operator's verdict (input to human_review_writer)
// ---------------------------------------------------------------------------

/**
 * Submitted by the Human Review Authority UI when an operator issues a
 * verdict on a pending patch.
 *
 * The writer validates this structure before any ledger mutation occurs.
 *
 * Security note: reviewer_id is an opaque string supplied by the UI layer.
 * Authentication and authorization are the UI layer's responsibility.
 * The writer only records what it receives — it does not verify identity.
 */
export interface ReviewDecision {
  schema_version: 'human_review/0.1';

  /** Stable UUID for this decision event. Generated by the UI. */
  decision_id: string;

  /** Must match a patch_id in ReviewQueueSnapshot.pending. */
  patch_id: string;

  /** Must match PendingHumanReviewEntry.source_cycle_id. */
  source_cycle_id: string;

  /** The operator's binary decision. */
  verdict: ReviewVerdict;

  /**
   * Identifier for the human reviewer.
   * Convention: use the authenticated user's handle or email.
   * Opaque to the writer — stored verbatim for audit.
   */
  reviewer_id: string;

  /** ISO-8601 UTC timestamp when the decision was submitted. */
  decided_at: string;

  /**
   * Free-text rationale from the reviewer.
   * Required when verdict = 'REJECT' (enforced by validator).
   * Optional (null) when verdict = 'APPROVE'.
   */
  comment: string | null;
}

// ---------------------------------------------------------------------------
// ReviewDecisionRecord — immutable audit record (stored after processing)
// ---------------------------------------------------------------------------

/**
 * The ReviewDecision extended with the processing outcome.
 * Written once and never modified — forms the permanent audit trail.
 *
 * All ReviewDecisionRecords are persisted in the ledger under
 * `human_review/decisions/decision_<decision_id>.json`.
 */
export interface ReviewDecisionRecord extends ReviewDecision {
  /**
   * QUEUED_FOR_PROMOTION: APPROVE was accepted; patch is in
   *   ApprovedPendingPromotion and will be promoted next cycle.
   *
   * REJECTED_AND_LOGGED: REJECT was accepted; patch permanently excluded.
   *   ReviewRejectionAudit written.
   */
  outcome: 'QUEUED_FOR_PROMOTION' | 'REJECTED_AND_LOGGED';

  /** ISO-8601 UTC timestamp when the writer processed this decision. */
  processed_at: string;
}

// ---------------------------------------------------------------------------
// ApprovedPendingEntry — approved patch queued for next-cycle promotion
// ---------------------------------------------------------------------------

/**
 * An APPROVE decision places the patch here.
 * Next nightly cycle's Phase C reads this list and promotes the patches
 * directly (bypassing the blast-radius gate — human already approved it).
 *
 * This list is maintained in the ledger and consumed by nightly_loop_runner.
 * After promotion, entries are removed.
 */
export interface ApprovedPendingEntry {
  /** Matches PendingHumanReviewEntry.patch_id. */
  patch_id: string;

  source_cycle_id: string;

  /** The decision that approved this entry. */
  approved_by_decision_id: string;

  /** ISO-8601 UTC. */
  approved_at: string;
}

// ---------------------------------------------------------------------------
// ReviewRejectionAudit — logged when verdict = 'REJECT'
// ---------------------------------------------------------------------------

/**
 * Appended to the rejection audit log when an operator explicitly rejects
 * a patch. Stored separately from ReviewDecisionRecord for easy querying
 * by monitoring tools.
 *
 * Does NOT write a FailureLedger entry — rejection is a human policy
 * decision, not a code defect pattern.
 */
export interface ReviewRejectionAudit {
  /** Matches ReviewDecisionRecord.decision_id. */
  decision_id: string;

  patch_id: string;
  source_cycle_id: string;
  reviewer_id: string;
  rejected_at: string;     // ISO-8601 UTC
  comment: string | null;
}

// ---------------------------------------------------------------------------
// Validation helpers (value types for validateReviewDecision return)
// ---------------------------------------------------------------------------

/**
 * Returned by human_review_writer's validateReviewDecision().
 * Empty array = decision is valid.
 * Each string is a human-readable error describing what is invalid.
 */
export type ReviewDecisionValidationErrors = string[];
