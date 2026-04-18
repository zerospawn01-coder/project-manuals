/**
 * contract/adaptation_memory.d.ts
 *
 * AdaptationMemory — Per-promoted-skill knowledge records.
 * schema_version: adaptation_memory/0.1
 *
 * One AdaptationMemoryEntry is written per PromotedSkill immediately after
 * Phase C confirms promotion (before Phase D aggregation).
 *
 * Records the WHAT, WHY, WHERE, HOW, and reuse hints for each promoted skill:
 *   WHAT  — skill_id, title, affected_targets, blast_radius
 *   WHY   — confirmed_improvements, quality_signals
 *   WHERE — environment_snapshot at promotion time
 *   HOW   — patch_source ('llm' | 'openclaw')
 *   REUSE — dedup_key for fast duplicate detection
 *
 * Persisted to phase14/data/adaptation_memory.jsonl as an append-only JSONL.
 * Each line is one serialised AdaptationMemoryEntry.
 *
 * GOVERNANCE BOUNDARY: AdaptationMemory is DISPLAY + ANALYTICS LAYER ONLY.
 * It MUST NOT directly modify governance weights, tier thresholds, or
 * invariant definitions. It is a record for human review and future
 * OpenClaw quality control — not an automated feedback loop into governance.
 *
 * HINT DECAY MODEL (Phase G1):
 *   hint_score is written at promotion time and never mutated in JSONL.
 *   At read time, buildAdaptationHintBlock() computes:
 *     effective_score = hint_score × exp(-age_days / HINT_HALF_LIFE_DAYS)
 *   Default HINT_HALF_LIFE_DAYS = 14 (score halves every 14 days).
 *   Entries with effective_score < HINT_MIN_EFFECTIVE_SCORE (0.05) are
 *   excluded from the hint block entirely — they are "expired".
 *   expired_hints_excluded is reported in AdaptationMemorySummary.
 */

/** Who generated the candidate that became this promoted skill. */
export type PatchSource = 'llm' | 'openclaw';

export type BlastRadiusLabel = 'SELF' | 'TENANT' | 'GLOBAL';

export type TierLabel = 'STABLE' | 'GROWING' | 'BREAKTHROUGH';

export interface AdaptationMemoryEntry {
  schema_version: 'adaptation_memory/0.1';

  /** UUID for this entry. */
  entry_id: string;

  /** ISO-8601 UTC timestamp when this entry was written. */
  recorded_at: string;

  /** The nightly cycle in which this skill was promoted. */
  cycle_id: string;

  // -- Identity -------------------------------------------------------------

  /** Stable UUID for this promotion event (mirrors PromotedSkill.skill_id). */
  skill_id: string;

  /** From PatchCandidate.title (verbatim). */
  title: string;

  /** File paths affected by this patch (derived from PatchCandidate.affected_targets). */
  affected_targets: string[];

  /** Phase B blast radius classification from the original PatchCandidate. */
  estimated_blast_radius: BlastRadiusLabel;

  /** Who produced the candidate: LLM generation or external OpenClaw submission. */
  patch_source: PatchSource;

  // -- Why it passed Phase C ------------------------------------------------

  /**
   * Confirmed improvements verified in sandbox (Phase B).
   * null means the metric was not applicable or not measured for this patch.
   */
  confirmed_improvements: {
    saved_time_minutes: number | null;
    tokens_saved: number | null;
    bugs_killed: number | null;
    refined_code_lines: number | null;
    /** Actual post_patch minus pre_patch stability_index.score. Always >= 0. */
    stability_index_delta: number;
  };

  quality_signals: {
    /** Number of +/- diff lines (excluding +++ / --- unified diff headers). */
    patch_change_lines: number;
    /** True iff patch_change_lines >= QUALITY_NOISE_FLOOR (currently 1). */
    above_noise_floor: boolean;
    /** True iff Phase B sandbox ran a benchmark comparison for this patch. */
    benchmark_verified: boolean;
  };

  // -- Where (environment at promotion time) --------------------------------

  /**
   * Snapshot of the environment at the time of promotion.
   * null when world_shift_config was not enabled for this cycle.
   */
  environment_snapshot: {
    /** 'STABLE' | 'SHIFTING' | 'ADAPTING' | 'HOSTILE' | 'MASTERED' */
    environment_status: string;
    /** Display-layer biome name (e.g. 'Dependency Storm', 'Stable Plains'). */
    biome: string;
    any_shift_detected: boolean;
  } | null;

  /**
   * System legitimacy tier at the time of promotion.
   * null when the tier is not yet available (Phase D computes it after this write).
   */
  tier_at_promotion: TierLabel | null;

  /**
   * Whether the drift monitor was in a non-blocking state at promotion time.
   * true  = drift_monitor.promotion_blocked was false (or no drift_monitor present).
   * false = promotion was drift-blocked (human review override applied).
   */
  drift_stable_at_promotion: boolean;

  // -- Attribution snapshot (PMI/GD&T 対応層) --------------------------------

  /**
   * Verbatim copy of PatchCandidate.attribution at the time of promotion.
   *
   * null は attribution なしで promote された旧データとの後方互換用。
   * 非 null の場合、次サイクルの buildAdaptationHintBlock() が
   * current_stressed_invariant_ids との積集合でスコアブーストに使用する。
   *
   * GOVERNANCE BOUNDARY: これは DISPLAY + ANALYTICS LAYER。
   * invariant 定義や tier 閾値への直接フィードバックは禁止。
   */
  attribution_snapshot: import('./phase_a_prompt').PatchAttribution | null;

  // -- Reuse hints ----------------------------------------------------------

  /**
   * Fast deduplication key: "<first_affected_target>::<normalised_title_words>"
   * Computed by computeDedupKey() in adaptation_memory_writer.ts.
   * Used by loadOpenClawCandidates() to skip redundant re-submissions.
   * Example: "src/auth/service.ts::openclaw fix auth bug in service"
   */
  dedup_key: string;

  /**
   * Quality score 0.0–1.0 computed at write time by computeHintScore().
   * Components (weights sum to 1.0):
   *   stability_norm  = min(1, stability_index_delta / 0.01) × 0.40
   *   noise_floor     = above_noise_floor ? 0.20 : 0.00
   *   benchmark       = benchmark_verified ? 0.20 : 0.00
   *   reuse_bonus     = (reused_count / (reused_count + 1)) × 0.20
   * Used by buildAdaptationHintBlock() to surface high-value hints first.
   */
  hint_score: number;
}

// ---------------------------------------------------------------------------
// Summary -- displayed in MorningResult (display-layer only)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reuse stats — mutable sidecar (adaptation_memory_reuse_stats.json)
// ---------------------------------------------------------------------------

/**
 * Tracks how many times each dedup_key has been re-promoted in subsequent cycles.
 * Persisted to adaptation_memory_reuse_stats.json (mutable JSON, NOT part of JSONL).
 * Keys are dedup_key values from AdaptationMemoryEntry.
 */
export interface AdaptationMemoryReuseStats {
  [dedup_key: string]: {
    /** How many additional cycles successfully promoted this same pattern. */
    reused_count: number;
    /** ISO-8601 UTC of the most recent re-promotion event. */
    last_reused_at: string;
  };
}

// ---------------------------------------------------------------------------
// Environment scores — mutable sidecar (adaptation_memory_env_scores.json)
// ---------------------------------------------------------------------------

/**
 * Per-environment hint score accumulator.
 * Tracks the sum and count of hint_scores per dedup_key per environment_status,
 * enabling environment-specific average score queries at read time.
 *
 * Persisted to adaptation_memory_env_scores.json (mutable JSON, NOT part of JSONL).
 * Updated after every appendAdaptationMemoryEntries() call.
 *
 * Usage:
 *   avg_env_score = total_hint_score / count
 *   env_effective = avg_env_score × decay_multiplier(recorded_at)
 *   If dedup_key × environment_status has no entry → fall back to global hint_score.
 */
export interface AdaptationMemoryEnvScores {
  [dedup_key: string]: {
    [environment_status: string]: {
      /** Accumulated sum of hint_scores for this (dedup_key, environment) pair. */
      total_hint_score: number;
      /** Number of promotions in this environment with this dedup_key. */
      count: number;
      /** ISO-8601 UTC of the most recent promotion in this environment. */
      last_promoted_at: string;
    };
  };
}

// ---------------------------------------------------------------------------
// Meta-strategy — aggregated patterns for Phase G3 advisory injection
// ---------------------------------------------------------------------------

/**
 * Aggregated statistics for a single primary target across all active entries.
 * Used to surface hot-spot files that have been repeatedly improved.
 */
export interface AdaptationTargetMeta {
  /** Primary target path (affected_targets[0]). */
  target: string;
  /** Number of active (non-expired) entries for this target. */
  count: number;
  /** Average hint_score across all active entries for this target. */
  avg_hint_score: number;
  /** Best (highest) hint_score seen for this target. */
  best_hint_score: number;
}

/**
 * High-level summary of accumulated adaptation memory patterns.
 * Computed by buildMetaStrategyBlock() from the full history.
 */
export interface AdaptationMetaStrategySummary {
  /** Total entries in the JSONL file at time of computation. */
  total_entries: number;
  /** Entries with effective_score >= HINT_MIN_EFFECTIVE_SCORE (non-expired). */
  active_entries: number;
  /** Top targets sorted by count DESC then avg_hint_score DESC. */
  top_targets: AdaptationTargetMeta[];
  /** Count of active entries per blast_radius label. */
  blast_radius_distribution: { [radius: string]: number };
}

// ---------------------------------------------------------------------------
// Summary — displayed in MorningResult (display-layer only)
// ---------------------------------------------------------------------------

export interface AdaptationMemorySummary {
  /** Total entries across all cycles in the JSONL file. */
  total_entries: number;
  /** Entries written during the current cycle. */
  entries_this_cycle: number;
  /** How many this-cycle entries originated from OpenClaw submissions. */
  openclaw_entries_this_cycle: number;
  /** Distinct environment_status values seen in this-cycle entries. */
  distinct_environment_statuses: string[];
  /** Per-blast-radius count for this-cycle entries. */
  blast_radii_this_cycle: Partial<Record<BlastRadiusLabel, number>>;
  /**
   * Number of historical entries excluded from the hint block at last
   * buildAdaptationHintBlock() call due to decay (effective_score < threshold).
   * null when buildAdaptationHintBlock() has not been called this cycle.
   */
  expired_hints_excluded: number | null;
}
