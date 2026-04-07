/**
 * renderer-react/src/components/MorningDisplay.tsx
 *
 * Phase E — Morning Screen Renderer
 *
 * Design contract: ZERO conditional logic.
 * All display decisions (badge color, animation class, which sections
 * show/hide, guardian posture color, delta signs) are pre-computed by
 * Phase D (tools/phase_d_aggregator.ts) and stored in MorningResult.display.
 *
 * This component only maps pre-computed values to DOM elements.
 * show_* booleans → data-show attribute (CSS controls visibility)
 * *_color / animation / security_posture → CSS modifier class suffix
 */

import React from 'react';
import type { MorningResult } from '../../../contract/morning_result';

// ---------------------------------------------------------------------------
// MetricCell — renders one metric column with a delta indicator
// No conditional logic: Math.sign + optional-chaining handle nulls purely.
// ---------------------------------------------------------------------------

interface MetricCellProps {
  label: string;
  value: string;
  delta: number | null;
}

const MetricCell: React.FC<MetricCellProps> = ({ label, value, delta }) => (
  <div className="morning-display__metric-cell">
    <span className="morning-display__metric-label">{label}</span>
    <span className="morning-display__metric-value">{value}</span>
    {/* data-sign: -1 | 0 | 1  →  CSS [data-sign="-1"] / [data-sign="1"] */}
    <span
      className="morning-display__metric-delta"
      data-sign={Math.sign(delta ?? 0)}
    >
      {delta?.toLocaleString(undefined, { signDisplay: 'exceptZero' }) ?? '—'}
    </span>
  </div>
);

// ---------------------------------------------------------------------------
// MorningDisplay — top-level Phase E renderer
// ---------------------------------------------------------------------------

interface Props {
  result: MorningResult;
}

const MorningDisplay: React.FC<Props> = ({ result }) => {
  const { display, evolution, guardian, metrics, proof } = result;

  return (
    <article
      className={[
        'morning-display',
        'glass-panel',
        `morning-display--${display.animation}`,
        `morning-display--badge-${display.tier_badge_color}`,
      ].join(' ')}
      aria-label="Morning briefing"
    >

      {/* ── Tier badge + headline ──────────────────────────── */}
      <header className="morning-display__header">
        <div
          className={`morning-display__tier-badge morning-display__tier-badge--${display.tier_badge_color}`}
        >
          {evolution.tier}
        </div>
        <h1 className="morning-display__headline">{display.headline}</h1>
        <p className="morning-display__subheadline">{display.subheadline}</p>
      </header>

      {/* ── Five metrics row ───────────────────────────────── */}
      <section className="morning-display__metrics" aria-label="Cycle metrics">
        <MetricCell
          label="STABILITY"
          value={metrics.stability_index.score.toFixed(3)}
          delta={metrics.deltas.stability_index}
        />
        <MetricCell
          label="TIME SAVED"
          value={`${metrics.saved_time_minutes.total}m`}
          delta={metrics.deltas.saved_time_minutes}
        />
        <MetricCell
          label="TOKENS"
          value={metrics.tokens_saved.toLocaleString()}
          delta={metrics.deltas.tokens_saved}
        />
        <MetricCell
          label="BUGS KILLED"
          value={String(metrics.bugs_killed)}
          delta={metrics.deltas.bugs_killed}
        />
        <MetricCell
          label="REFINED"
          value={String(metrics.refined_code_lines)}
          delta={metrics.deltas.refined_code_lines}
        />
      </section>

      {/* ── Guardian alert banner ─────────────────────────────
          data-show=false → CSS hides; data-show=true → CSS shows.
          No JS branching; guardian.security_posture drives BEM modifier. */}
      <section
        className="morning-display__guardian-zone"
        data-show={display.show_guardian_alert}
        aria-live="assertive"
      >
        <div
          className={`morning-display__guardian-banner morning-display__guardian-banner--${guardian.security_posture}`}
        >
          <span className="morning-display__guardian-label">GUARDIAN</span>
          <span
            className={`morning-display__guardian-posture morning-display__guardian-posture--${guardian.security_posture}`}
          >
            {guardian.security_posture}
          </span>
          <span className="morning-display__guardian-stat">
            {guardian.blocked_risky_actions.count} blocked
          </span>
          <span className="morning-display__guardian-stat">
            {guardian.invariant_failure_count} invariant failures
          </span>
          <span className="morning-display__failure-codes">
            {guardian.active_failure_codes.map((code) => (
              <code key={code} className="morning-display__failure-code">
                {code}
              </code>
            ))}
          </span>
        </div>
      </section>

      {/* ── Skill parade ─────────────────────────────────────
          Shown only when display.show_skill_parade === true.
          Visibility managed by CSS [data-show="false"]. */}
      <section
        className="morning-display__skill-parade"
        data-show={display.show_skill_parade}
        aria-label="Promoted skills"
      >
        <h2 className="morning-display__section-heading">
          PROMOTED SKILLS ({evolution.promoted_skill_count})
        </h2>
        <div className="morning-display__skill-list">
          {evolution.promoted_skills.map((skill, idx) => (
            <div
              key={skill.skill_id}
              className="morning-display__skill-card"
              style={{ '--skill-index': idx } as React.CSSProperties}
            >
              <span className="morning-display__skill-title">{skill.title}</span>
              <span className="morning-display__skill-time">
                +{skill.confirmed_improvements.saved_time_minutes?.toLocaleString() ?? '—'}m
              </span>
              <span className="morning-display__skill-tokens">
                +{skill.confirmed_improvements.tokens_saved?.toLocaleString() ?? '—'} tok
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Node unlock burst ────────────────────────────────
          Shown only when display.show_node_unlock === true. */}
      <section
        className="morning-display__node-unlock"
        data-show={display.show_node_unlock}
        aria-label="Capability nodes unlocked"
      >
        <h2 className="morning-display__section-heading">
          NODES UNLOCKED ({evolution.unlocked_node_count})
        </h2>
        <div className="morning-display__node-list">
          {evolution.unlocked_nodes.map((node, idx) => (
            <div
              key={node.node_id}
              className="morning-display__node-card"
              style={{ '--node-index': idx } as React.CSSProperties}
            >
              <span className="morning-display__node-name">{node.node_name}</span>
              <span className="morning-display__node-desc">{node.description}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Drift inline section ─────────────────────────────────────
          show_drift pre-computed; drift_status drives badge modifier. */}
      <section
        className="morning-display__drift-section"
        data-show={display.show_drift}
        data-drift-status={display.drift_status ?? 'none'}
        aria-label="Drift monitoring"
      >
        <h2 className="morning-display__section-heading">
          DRIFT MONITOR
          <span
            className={`morning-display__drift-badge morning-display__drift-badge--${display.drift_status ?? 'none'}`}
          >
            {display.drift_status}
          </span>
        </h2>
        {/* drift_banner: empty string renders nothing visible; CSS min-height keeps layout stable */}
        <p className="morning-display__drift-banner">{display.drift_banner ?? ''}</p>
        {/* Promotion-blocked banner — present only when adaptation decided to block */}
        <div
          className="morning-display__drift-promo-block"
          data-show={result.drift?.adaptation?.promotion_blocked === true}
        >
          PROMOTION BLOCKED
          <span className="morning-display__drift-promo-reason">
            {result.drift?.adaptation?.promotion_blocked_reason ?? 'F-010_SILENT_DRIFT'}
          </span>
        </div>
        {/* Rollback target pills */}
        <div className="morning-display__drift-rollbacks">
          {(result.drift?.adaptation?.rollback_suggestions ?? []).map((r) => (
            <span
              key={r.target_function}
              className="morning-display__drift-rollback-fn"
              title={`Last good: ${r.last_good_measured_at ?? '—'}`}
            >
              {r.target_function.split('.').pop() ?? r.target_function}
            </span>
          ))}
        </div>
      </section>

      {/* ── Stability sparkline (last ≤7 cycles) ───────────────────────
          c.tier may be null → String(null) = "null" → --null CSS modifier. */}
      <section className="morning-display__sparkline" aria-label="Stability history">
        {proof.cycle_lineage.map((c, idx) => (
          <div
            key={c.cycle_id}
            className={`morning-display__spark-bar morning-display__spark-bar--${c.tier}`}
            style={
              {
                '--spark-height': `${(c.stability_index_score * 100).toFixed(1)}%`,
                '--spark-index': idx,
              } as React.CSSProperties
            }
            title={`${c.cycle_id}: stability ${c.stability_index_score.toFixed(3)}`}
          />
        ))}
      </section>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer className="morning-display__footer">
        <span className="morning-display__cycle-id">{result.cycle_id}</span>
        <span className="morning-display__generated-at">{result.generated_at}</span>
        <span className="morning-display__cumulative">
          {evolution.cumulative_promoted_skill_count} skills all-time
        </span>
      </footer>
    </article>
  );
};

export default MorningDisplay;
