/**
 * renderer-react/src/components/ReviewDecisionPanel.tsx
 *
 * Human Review Authority — Decision Panel
 *
 * The operator issues APPROVE or REJECT from this panel.
 *
 * Asymmetry-elimination invariant:
 *   REJECT must be at least as easy as APPROVE.
 *   Implementation contract:
 *     - Both buttons are the same physical size.
 *     - REJECT appears first (left / top) in DOM order.
 *     - Comment textarea is pre-focused when a patch is loaded; it serves
 *       both the rejection reason AND an optional approval note, so it
 *       creates zero extra friction for REJECT.
 *     - Both buttons are enabled as soon as a patch is selected.
 *     - The only asymmetry: APPROVE requires comment.length >= 0 (no requirement);
 *       REJECT requires comment.length > 0. This is surfaced via a visible
 *       inline counter, not a blocking modal.
 *
 * State:
 *   - comment: string         — shared for both verdicts
 *   - submitting: boolean      — disables both buttons while in-flight
 *   - lastOutcome: record|null — confirmation display after success
 *
 * The panel calls onDecide(ReviewDecision) and does NOT persist anything
 * itself — persistence is the caller's responsibility via HumanReviewStore.
 * This keeps the component pure and testable.
 */

import React, { useState, useEffect, useRef } from 'react';
import type { ReviewDecision, PendingHumanReviewEntry } from '../../../contract/human_review';
import { makeReviewDecision } from '../../../tools/human_review_writer';

interface Props {
  /** The patch being reviewed. null when nothing is selected. */
  entry: PendingHumanReviewEntry | null;
  /** Reviewer ID supplied by the outer session/auth layer. */
  reviewerId: string;
  /**
   * Called when the operator submits a verdict.
   * The caller is responsible for calling applyReviewDecision() and
   * updating the ReviewQueueSnapshot.
   */
  onDecide: (decision: ReviewDecision) => Promise<void>;
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

const MIN_REJECT_COMMENT_LENGTH = 1;

const ReviewDecisionPanel: React.FC<Props> = ({ entry, reviewerId, onDecide }) => {
  const [comment, setComment] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [lastVerdict, setLastVerdict] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  // Pre-focus the comment field whenever a new patch is selected.
  // Serves both reject (reason) and approve (optional note) — zero asymmetry.
  useEffect(() => {
    if (entry) {
      setComment('');
      setSubmitState('idle');
      setLastVerdict(null);
      setErrorMessage(null);
      commentRef.current?.focus();
    }
  }, [entry?.patch_id]);

  const rejectCommentSatisfied = comment.trim().length >= MIN_REJECT_COMMENT_LENGTH;
  const isSubmitting = submitState === 'submitting';

  async function handleVerdict(verdict: 'APPROVE' | 'REJECT') {
    if (!entry) return;
    setSubmitState('submitting');
    setErrorMessage(null);

    const decision = makeReviewDecision({
      patch_id: entry.patch_id,
      source_cycle_id: entry.source_cycle_id,
      verdict,
      reviewer_id: reviewerId,
      comment: comment.trim() || null,
    });

    try {
      await onDecide(decision);
      setLastVerdict(verdict);
      setSubmitState('success');
      setComment('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setSubmitState('error');
    }
  }

  // No-entry state: aria-hidden panel with placeholder
  const hasEntry = entry !== null;
  const showSuccess = submitState === 'success';

  return (
    <section
      className="review-decision-panel glass-panel"
      aria-label="Review decision"
      data-state={submitState}
      data-has-entry={hasEntry}
    >
      {/* ── Empty placeholder (CSS shows/hides via data-has-entry) ── */}
      <div className="review-decision-panel__placeholder" data-visible={!hasEntry} aria-hidden={hasEntry}>
        <span>Select a patch to review</span>
      </div>

      {/* ── Active panel ─────────────────────────────────────── */}
      <div className="review-decision-panel__body" data-visible={hasEntry} aria-hidden={!hasEntry}>

        {/* Success confirmation */}
        <div
          className="review-decision-panel__success"
          data-visible={showSuccess}
          data-verdict={lastVerdict}
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="review-decision-panel__success-icon" data-verdict={lastVerdict}>
            {lastVerdict === 'APPROVE' ? '✓' : '✕'}
          </span>
          <span className="review-decision-panel__success-msg">
            {lastVerdict === 'APPROVE' ? 'Approved — queued for next cycle' : 'Rejected and logged'}
          </span>
        </div>

        {/* Decision form (hidden after success) */}
        <div className="review-decision-panel__form" data-visible={!showSuccess}>
          <h2 className="review-decision-panel__patch-title">
            {entry?.title ?? ''}
          </h2>

          {/* Comment field — pre-focused, serves both verdicts */}
          <label
            className="review-decision-panel__comment-label"
            htmlFor="review-comment"
          >
            Comment
            <span className="review-decision-panel__comment-hint">
              {' '}(required for REJECT — optional for APPROVE)
            </span>
          </label>
          <textarea
            ref={commentRef}
            id="review-comment"
            className="review-decision-panel__comment"
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={isSubmitting}
            placeholder="Explain your decision — this is the permanent audit record."
            aria-required="false"
            aria-describedby="review-comment-counter"
          />
          <span
            id="review-comment-counter"
            className="review-decision-panel__char-counter"
            data-warn={comment.trim().length === 0}
          >
            {comment.trim().length} chars
            {comment.trim().length === 0 && (
              <span className="review-decision-panel__reject-warn">
                {' '}— required to reject
              </span>
            )}
          </span>

          {/* Error message */}
          <div
            className="review-decision-panel__error"
            data-visible={submitState === 'error'}
            role="alert"
            aria-live="assertive"
          >
            {errorMessage}
          </div>

          {/* ── Decision buttons ─────────────────────────────────
              REJECT is first in DOM order (keyboard/screen-reader priority).
              Both buttons identical in size and visual weight.
              The ONLY asymmetry: REJECT is disabled when comment is empty. */}
          <div className="review-decision-panel__buttons" role="group" aria-label="Verdict">

            {/* REJECT — first, requires comment */}
            <button
              type="button"
              className="review-decision-panel__btn review-decision-panel__btn--reject"
              onClick={() => handleVerdict('REJECT')}
              disabled={isSubmitting || !rejectCommentSatisfied}
              aria-disabled={isSubmitting || !rejectCommentSatisfied}
              title={rejectCommentSatisfied ? 'Reject this patch' : 'Add a comment before rejecting'}
            >
              {isSubmitting && lastVerdict === 'REJECT' ? 'Rejecting…' : 'REJECT'}
            </button>

            {/* APPROVE — second, no comment requirement */}
            <button
              type="button"
              className="review-decision-panel__btn review-decision-panel__btn--approve"
              onClick={() => handleVerdict('APPROVE')}
              disabled={isSubmitting}
              aria-disabled={isSubmitting}
              title="Approve and queue for next cycle"
            >
              {isSubmitting && lastVerdict === 'APPROVE' ? 'Approving…' : 'APPROVE'}
            </button>
          </div>

          {/* REJECT gating notice — visible when comment is empty */}
          <p
            className="review-decision-panel__reject-gate-notice"
            data-visible={!rejectCommentSatisfied}
            aria-live="polite"
          >
            Enter a comment above to enable REJECT.
          </p>
        </div>
      </div>
    </section>
  );
};

export default ReviewDecisionPanel;
