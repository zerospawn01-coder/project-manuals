/**
 * renderer-react/src/components/PatchReviewQueue.tsx
 *
 * Human Review Authority — Queue List View
 *
 * Renders the list of patches currently awaiting human review.
 * Receives ReviewQueueSnapshot and calls onSelect when an entry is clicked.
 *
 * Design invariants:
 *   - Zero conditional display logic: pre-computed values map to CSS only.
 *   - Empty queue state is rendered via the same path (no early-return branch).
 *   - Selected entry highlighted via data-selected attribute (CSS controls style).
 */

import React from 'react';
import type { ReviewQueueSnapshot, PendingHumanReviewEntry } from '../../../contract/human_review';

interface Props {
  snapshot: ReviewQueueSnapshot;
  selectedPatchId: string | null;
  onSelect: (entry: PendingHumanReviewEntry) => void;
}

const PatchReviewQueue: React.FC<Props> = ({ snapshot, selectedPatchId, onSelect }) => {
  return (
    <section className="patch-review-queue glass-panel" aria-label="Pending review queue">
      <header className="patch-review-queue__header">
        <span className="patch-review-queue__title">REVIEW QUEUE</span>
        <span className="patch-review-queue__count" data-empty={snapshot.pending.length === 0}>
          {snapshot.pending.length} pending
        </span>
      </header>

      {/* Empty state uses the same element; CSS [data-empty=true] shows the placeholder */}
      <div
        className="patch-review-queue__empty-notice"
        data-visible={snapshot.pending.length === 0}
        aria-hidden={snapshot.pending.length > 0}
      >
        No patches pending review.
      </div>

      <ol className="patch-review-queue__list" aria-label="Patches awaiting review">
        {snapshot.pending.map((entry) => (
          <li
            key={entry.patch_id}
            className="patch-review-queue__item"
            data-selected={entry.patch_id === selectedPatchId}
            data-blast={entry.blast_radius}
            onClick={() => onSelect(entry)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(entry); }}
            aria-pressed={entry.patch_id === selectedPatchId}
          >
            <div className="patch-review-queue__item-top">
              <span className="patch-review-queue__blast-badge" data-blast={entry.blast_radius}>
                {entry.blast_radius}
              </span>
              <span className="patch-review-queue__confidence">
                {(entry.confidence_score * 100).toFixed(0)}% confidence
              </span>
            </div>
            <p className="patch-review-queue__item-title">{entry.title}</p>
            <p className="patch-review-queue__item-cycle">
              Cycle: {entry.source_cycle_id.slice(0, 8)}…
              <time className="patch-review-queue__deferred-at" dateTime={entry.deferred_at}>
                {' '}· Deferred {new Date(entry.deferred_at).toLocaleDateString()}
              </time>
            </p>
            <p className="patch-review-queue__targets">
              {entry.affected_targets.slice(0, 3).join(', ')}
              {entry.affected_targets.length > 3 && ` +${entry.affected_targets.length - 3} more`}
            </p>
          </li>
        ))}
      </ol>

      <footer className="patch-review-queue__footer">
        <span className="patch-review-queue__updated">
          Updated: {new Date(snapshot.last_updated_at).toLocaleTimeString()}
        </span>
      </footer>
    </section>
  );
};

export default PatchReviewQueue;
