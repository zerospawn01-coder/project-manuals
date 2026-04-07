/**
 * renderer-react/src/components/HumanReviewAuthorityPage.tsx
 *
 * Human Review Authority — Hosting Page
 *
 * Wires PatchReviewQueue + PatchReviewDetail + ReviewDecisionPanel
 * into a three-panel layout.
 *
 * Responsibilities:
 *   - Own the `selectedEntry` selection state
 *   - Provide VerifiedPatch evidence via the evidenceMap prop (caller loads from ledger)
 *   - Call onDecide (caller persists via applyReviewDecision + HumanReviewStore)
 *   - Refresh the queue snapshot after each decision (via onQueueRefresh, if provided)
 *
 * Layout:
 *   ┌──────────────────┬────────────────────────────┬──────────────────────┐
 *   │  PatchReviewQueue│   PatchReviewDetail        │  ReviewDecisionPanel │
 *   │  (queue sidebar) │   (evidence main panel)    │  (verdict form)      │
 *   └──────────────────┴────────────────────────────┴──────────────────────┘
 *
 * Design invariants:
 *   - No conditional display logic in JSX.
 *   - Visibility controlled by data-* attributes (CSS handles show/hide).
 *   - Both PatchReviewDetail and the placeholder are always rendered;
 *     data-visible toggles them.
 */

import React, { useState, useCallback } from 'react';
import type { ReviewDecision, ReviewQueueSnapshot, PendingHumanReviewEntry } from '../../../contract/human_review';
import type { VerifiedPatch } from '../../../contract/phase_b_verify';

import PatchReviewQueue from './PatchReviewQueue';
import PatchReviewDetail from './PatchReviewDetail';
import ReviewDecisionPanel from './ReviewDecisionPanel';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /**
   * Current state of the review queue.
   * The caller is responsible for loading this from the ledger.
   * After each decision, the page calls onQueueRefresh (if provided) and
   * updates this value via React state.
   */
  initialSnapshot: ReviewQueueSnapshot;

  /**
   * Map from patch_id → VerifiedPatch (Phase B evidence).
   * The caller pre-loads this by reading the PhaseBBatchResult for
   * each entry's source_cycle_id from the ledger before rendering.
   *
   * A missing patch_id means evidence is unavailable; the detail panel
   * shows a placeholder via data-visible.
   */
  evidenceMap: Readonly<Record<string, VerifiedPatch>>;

  /**
   * The reviewer's identity token, obtained from the outer session layer.
   * Passed verbatim to ReviewDecisionPanel and ReviewDecision.reviewer_id.
   */
  reviewerId: string;

  /**
   * Called when the operator submits a verdict (APPROVE or REJECT).
   * The caller is responsible for:
   *   1. Calling applyReviewDecision(decision, store)
   *   2. Handling any errors (ReviewDecisionError)
   *   3. Resolving the promise when the decision is persisted
   *
   * This page does NOT call applyReviewDecision directly (no FS dependency).
   */
  onDecide: (decision: ReviewDecision) => Promise<void>;

  /**
   * Optional: called after each successful decision to reload the queue
   * snapshot.  If not provided, the page removes the reviewed entry from
   * local state immediately.
   */
  onQueueRefresh?: () => Promise<ReviewQueueSnapshot>;
}

// ---------------------------------------------------------------------------
// HumanReviewAuthorityPage
// ---------------------------------------------------------------------------

const HumanReviewAuthorityPage: React.FC<Props> = ({
  initialSnapshot,
  evidenceMap,
  reviewerId,
  onDecide,
  onQueueRefresh,
}) => {
  const [snapshot, setSnapshot] = useState<ReviewQueueSnapshot>(initialSnapshot);
  const [selectedEntry, setSelectedEntry] = useState<PendingHumanReviewEntry | null>(null);

  // Derive the evidence for the selected entry (null when not available).
  const selectedEvidence: VerifiedPatch | null =
    selectedEntry ? (evidenceMap[selectedEntry.patch_id] ?? null) : null;

  // Whether both entry AND evidence are present — controls detail visibility.
  const detailReady = selectedEntry !== null && selectedEvidence !== null;
  const evidenceMissing = selectedEntry !== null && selectedEvidence === null;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSelect = useCallback((entry: PendingHumanReviewEntry) => {
    setSelectedEntry(entry);
  }, []);

  const handleDecide = useCallback(async (decision: ReviewDecision) => {
    await onDecide(decision);

    // Refresh queue after successful decision
    if (onQueueRefresh) {
      const fresh = await onQueueRefresh();
      setSnapshot(fresh);
    } else {
      // Optimistic update: remove the reviewed entry from pending
      setSnapshot((prev) => ({
        ...prev,
        pending: prev.pending.filter((e) => e.patch_id !== decision.patch_id),
        last_updated_at: new Date().toISOString(),
      }));
    }

    // Clear selection when the decided entry leaves the queue
    setSelectedEntry((prev) =>
      prev?.patch_id === decision.patch_id ? null : prev
    );
  }, [onDecide, onQueueRefresh]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="hra-page" aria-label="Human Review Authority">
      {/* ── Header ── */}
      <header className="hra-page__header glass-panel">
        <span className="hra-page__title">HUMAN REVIEW AUTHORITY</span>
        <span className="hra-page__subtitle">
          GLOBAL blast-radius patches awaiting operator approval
        </span>
        <time className="hra-page__updated" dateTime={snapshot.last_updated_at}>
          Queue updated: {new Date(snapshot.last_updated_at).toLocaleString()}
        </time>
      </header>

      {/* ── Three-panel workspace ── */}
      <div className="hra-page__workspace">

        {/* Panel 1: Queue sidebar */}
        <aside className="hra-page__queue-col">
          <PatchReviewQueue
            snapshot={snapshot}
            selectedPatchId={selectedEntry?.patch_id ?? null}
            onSelect={handleSelect}
          />
        </aside>

        {/* Panel 2: Evidence / Detail */}
        <section className="hra-page__detail-col" aria-label="Patch evidence">
          {/* No-selection placeholder */}
          <div
            className="hra-page__detail-placeholder glass-panel"
            data-visible={selectedEntry === null}
            aria-hidden={selectedEntry !== null}
          >
            <span className="hra-page__placeholder-icon" aria-hidden="true">⊙</span>
            <p>Select a patch from the queue to view evidence.</p>
          </div>

          {/* Evidence missing placeholder (entry selected but no VerifiedPatch loaded) */}
          <div
            className="hra-page__detail-placeholder hra-page__detail-placeholder--warn glass-panel"
            data-visible={evidenceMissing}
            aria-hidden={!evidenceMissing}
            role="alert"
          >
            <span className="hra-page__placeholder-icon" aria-hidden="true">⚠</span>
            <p>
              Evidence for{' '}
              <code>{selectedEntry?.patch_id}</code> could not be loaded.
              The Phase B checkpoint for cycle{' '}
              <code>{selectedEntry?.source_cycle_id}</code> may be missing.
            </p>
          </div>

          {/* Full evidence panel — rendered only when both entry + evidence present */}
          <div
            className="hra-page__detail-content"
            data-visible={detailReady}
            aria-hidden={!detailReady}
          >
            {/* TypeScript narrowing: data-visible controls visibility;
                we use a trivial guard so the compiler knows they're non-null here. */}
            {selectedEntry !== null && selectedEvidence !== null && (
              <PatchReviewDetail
                entry={selectedEntry}
                evidence={selectedEvidence}
              />
            )}
          </div>
        </section>

        {/* Panel 3: Decision form */}
        <aside className="hra-page__decision-col">
          <ReviewDecisionPanel
            entry={selectedEntry}
            reviewerId={reviewerId}
            onDecide={handleDecide}
          />
        </aside>

      </div>
    </main>
  );
};

export default HumanReviewAuthorityPage;
