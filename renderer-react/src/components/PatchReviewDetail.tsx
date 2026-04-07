/**
 * renderer-react/src/components/PatchReviewDetail.tsx
 *
 * Human Review Authority — Evidence Display View
 *
 * Shows the full "審査エビデンス" for a selected pending patch:
 *   1. Affected targets list
 *   2. Sub-proof 1: invariant_check results (per invariant: pass / untouched)
 *   3. Sub-proof 2: measurable_outcome predictions vs actuals
 *   4. Sub-proof 3: no-regression coverage
 *   5. Patch diff (syntax-highlighted via CSS class, no JS parser needed)
 *   6. Deferral reason
 *
 * All evidence is sourced from VerifiedPatch (Phase B output), which is
 * attached to PendingHumanReviewEntry as `phase_b_evidence` by the page
 * that hosts this component.
 *
 * Design invariants:
 *   - Zero conditional display logic. outcome values map to data-* attributes.
 *   - All visual state (pass/fail/skipped colors) handled by CSS [data-*] selectors.
 *   - "met / missed / not_predicted" prediction accuracy maps to data-accuracy.
 */

import React from 'react';
import type { PendingHumanReviewEntry } from '../../../contract/human_review';
import type { VerifiedPatch } from '../../../contract/phase_b_verify';

interface Props {
  entry: PendingHumanReviewEntry;
  /**
   * Phase B verification result for this patch.
   * The hosting page is responsible for loading the VerifiedPatch that
   * corresponds to entry.patch_id from the cycle's PhaseBBatchResult.
   */
  evidence: VerifiedPatch;
}

// ---------------------------------------------------------------------------
// Sub-components (no conditional logic — data-* drives visual state)
// ---------------------------------------------------------------------------

const InvariantCheckTable: React.FC<{ results: VerifiedPatch['invariant_check_results'] }> = ({ results }) => (
  <div className="review-detail__subproof">
    <h3 className="review-detail__subproof-label">
      <span className="review-detail__subproof-index">1</span>
      Invariant Check
    </h3>
    <table className="review-detail__evidence-table" aria-label="Invariant check results">
      <thead>
        <tr>
          <th>Invariant</th>
          <th>Outcome</th>
          <th>Verified by</th>
          <th>Failure</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r) => (
          <tr key={r.invariant_id} data-outcome={r.outcome}>
            <td className="review-detail__invariant-id">{r.invariant_id}</td>
            <td>
              <span className="review-detail__outcome-badge" data-outcome={r.outcome}>
                {r.outcome}
              </span>
            </td>
            <td className="review-detail__dim">{r.verified_by ?? '—'}</td>
            <td className="review-detail__failure-msg">{r.failure_message ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const MeasurableOutcomeTable: React.FC<{
  measured: VerifiedPatch['measured_outcome'];
  predicted: VerifiedPatch['source_candidate']['acceptance_criteria']['measurable_outcome'];
}> = ({ measured, predicted }) => (
  <div className="review-detail__subproof">
    <h3 className="review-detail__subproof-label">
      <span className="review-detail__subproof-index">2</span>
      Measurable Outcome
    </h3>

    {/* Stability index row — always present */}
    <div className="review-detail__stability-row">
      <span className="review-detail__metric-name">Stability Index</span>
      <span className="review-detail__metric-before">{measured.pre_patch_stability_index.toFixed(4)}</span>
      <span className="review-detail__arrow">→</span>
      <span className="review-detail__metric-after"
        data-improved={measured.post_patch_stability_index >= measured.pre_patch_stability_index}
      >
        {measured.post_patch_stability_index.toFixed(4)}
      </span>
      <span className="review-detail__delta"
        data-sign={Math.sign(measured.post_patch_stability_index - measured.pre_patch_stability_index)}
      >
        {(measured.post_patch_stability_index - measured.pre_patch_stability_index >= 0 ? '+' : '')}
        {(measured.post_patch_stability_index - measured.pre_patch_stability_index).toFixed(4)}
      </span>
    </div>

    <table className="review-detail__evidence-table" aria-label="Metric predictions vs actuals">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Predicted</th>
          <th>Actual</th>
          <th>Accuracy</th>
        </tr>
      </thead>
      <tbody>
        <tr data-accuracy={measured.prediction_accuracy.saved_time_minutes}>
          <td>Saved Time (min)</td>
          <td className="review-detail__dim">{predicted.saved_time_minutes_predicted?.toLocaleString() ?? '—'}</td>
          <td>{measured.saved_time_minutes_actual?.toLocaleString() ?? '—'}</td>
          <td>
            <span className="review-detail__accuracy-badge"
              data-accuracy={measured.prediction_accuracy.saved_time_minutes}>
              {measured.prediction_accuracy.saved_time_minutes}
            </span>
          </td>
        </tr>
        <tr data-accuracy={measured.prediction_accuracy.tokens_saved}>
          <td>Tokens Saved</td>
          <td className="review-detail__dim">{predicted.tokens_saved_predicted?.toLocaleString() ?? '—'}</td>
          <td>{measured.tokens_saved_actual?.toLocaleString() ?? '—'}</td>
          <td>
            <span className="review-detail__accuracy-badge"
              data-accuracy={measured.prediction_accuracy.tokens_saved}>
              {measured.prediction_accuracy.tokens_saved}
            </span>
          </td>
        </tr>
        <tr data-accuracy={measured.prediction_accuracy.bugs_killed}>
          <td>Bugs Killed</td>
          <td className="review-detail__dim">{predicted.bugs_killed_predicted?.toLocaleString() ?? '—'}</td>
          <td>{measured.bugs_killed_actual?.toLocaleString() ?? '—'}</td>
          <td>
            <span className="review-detail__accuracy-badge"
              data-accuracy={measured.prediction_accuracy.bugs_killed}>
              {measured.prediction_accuracy.bugs_killed}
            </span>
          </td>
        </tr>
        <tr data-accuracy={measured.prediction_accuracy.refined_code_lines}>
          <td>Refined Lines</td>
          <td className="review-detail__dim">{predicted.refined_code_lines_predicted?.toLocaleString() ?? '—'}</td>
          <td>{measured.refined_code_lines_actual?.toLocaleString() ?? '—'}</td>
          <td>
            <span className="review-detail__accuracy-badge"
              data-accuracy={measured.prediction_accuracy.refined_code_lines}>
              {measured.prediction_accuracy.refined_code_lines}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
);

const NoRegressionPanel: React.FC<{ result: VerifiedPatch['no_regression_result'] }> = ({ result }) => (
  <div className="review-detail__subproof">
    <h3 className="review-detail__subproof-label">
      <span className="review-detail__subproof-index">3</span>
      No-Regression Coverage
    </h3>
    <div className="review-detail__regression-grid">
      <div className="review-detail__regression-col" data-status="pass">
        <span className="review-detail__col-label">PASSED ({result.tests_passed.length})</span>
        {result.tests_passed.map((id) => (
          <code key={id} className="review-detail__test-id">{id}</code>
        ))}
      </div>
      <div className="review-detail__regression-col" data-status="fail">
        <span className="review-detail__col-label">FAILED ({result.tests_failed.length})</span>
        {result.tests_failed.map((id) => (
          <code key={id} className="review-detail__test-id review-detail__test-id--fail">{id}</code>
        ))}
      </div>
      <div className="review-detail__regression-col" data-status="notfound">
        <span className="review-detail__col-label">NOT FOUND ({result.tests_not_found.length})</span>
        {result.tests_not_found.map((id) => (
          <code key={id} className="review-detail__test-id review-detail__test-id--warn">{id}</code>
        ))}
      </div>
    </div>
    {/* Orthogonality claim — shown via data-visible, CSS controls display */}
    <div
      className="review-detail__orthogonality"
      data-visible={result.orthogonality_claimed}
      data-verified={result.orthogonality_verification}
    >
      <span className="review-detail__orth-label">Orthogonality claimed</span>
      <span className="review-detail__orth-badge" data-verified={result.orthogonality_verification}>
        {result.orthogonality_verification}
      </span>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// PatchReviewDetail — main component
// ---------------------------------------------------------------------------

const PatchReviewDetail: React.FC<Props> = ({ entry, evidence }) => {
  return (
    <article className="review-detail glass-panel" aria-label={`Review detail: ${entry.title}`}>

      {/* ── Header ──────────────────────────────────────────── */}
      <header className="review-detail__header">
        <div className="review-detail__header-top">
          <span className="review-detail__blast-badge" data-blast={entry.blast_radius}>
            {entry.blast_radius}
          </span>
          <span className="review-detail__confidence">
            Confidence: {(entry.confidence_score * 100).toFixed(0)}%
          </span>
          <span className="review-detail__cycle-ref">
            Cycle {entry.source_cycle_id.slice(0, 8)}…
          </span>
        </div>
        <h2 className="review-detail__title">{entry.title}</h2>
        <p className="review-detail__description">{entry.description}</p>
      </header>

      {/* ── Affected targets ────────────────────────────────── */}
      <section className="review-detail__targets" aria-label="Affected files">
        <h3 className="review-detail__section-label">AFFECTED TARGETS</h3>
        <ul className="review-detail__target-list">
          {evidence.source_candidate.affected_targets.map((t) => (
            <li key={t.file_path} className="review-detail__target-item">
              <code className="review-detail__file-path">{t.file_path}</code>
              <span className="review-detail__change-type" data-change={t.change_type}>
                {t.change_type}
              </span>
              {t.function_name && (
                <span className="review-detail__fn-name">{t.function_name}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ── 3 Sub-proof evidence panels ─────────────────────── */}
      <section className="review-detail__evidence" aria-label="Acceptance criteria evidence">
        <h3 className="review-detail__section-label">PHASE B EVIDENCE</h3>

        <InvariantCheckTable results={evidence.invariant_check_results} />

        <MeasurableOutcomeTable
          measured={evidence.measured_outcome}
          predicted={evidence.source_candidate.acceptance_criteria.measurable_outcome}
        />

        <NoRegressionPanel result={evidence.no_regression_result} />
      </section>

      {/* ── Deferral reason ─────────────────────────────────── */}
      <section className="review-detail__deferral" aria-label="Deferral reason">
        <h3 className="review-detail__section-label">DEFERRAL REASON</h3>
        <p className="review-detail__deferral-text">{entry.deferral_reason}</p>
        <p className="review-detail__dim">
          Deferred: {new Date(entry.deferred_at).toISOString()}
        </p>
      </section>

      {/* ── Patch diff ─────────────────────────────────────── */}
      <section className="review-detail__diff-section" aria-label="Patch diff">
        <h3 className="review-detail__section-label">PATCH DIFF</h3>
        <pre className="review-detail__diff">
          <code>{evidence.source_candidate.patch_diff}</code>
        </pre>
      </section>
    </article>
  );
};

export default PatchReviewDetail;
