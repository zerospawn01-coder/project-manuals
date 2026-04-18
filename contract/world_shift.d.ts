/**
 * contract/world_shift.d.ts
 *
 * World Shift — Environmental Change Detection Contracts.
 * schema_version: world_shift/0.1
 *
 * A WorldShiftEvent is emitted when the EnvironmentProfile changes
 * significantly between two consecutive nightly cycles.
 *
 * GOVERNANCE BOUNDARY (mandatory):
 *   WorldShiftEvents, EnvironmentStatus, and BiomeName are DISPLAY-LAYER concepts.
 *   They MUST NOT influence tier evaluation, promotion gates, invariant checks,
 *   or any governance decision. They may only:
 *     1. Inject context into the Phase A system prompt (advisory only).
 *     2. Appear in MorningResult.display and MorningResult.world_shift.
 *     3. Feed AdaptationMemory for retrospective analysis.
 */

/** What changed in the environment. */
export type WorldShiftType =
  | 'model_change'               // GEMINI_MODEL env var changed
  | 'dependency_change'          // package-lock.json fingerprint changed
  | 'benchmark_signature_change' // benchmark_signature from provenance changed
  | 'runtime_change'             // OS platform or Node.js version changed
  | 'repo_shape_change';         // tools/ or contract/ file list changed

/**
 * The system's current adaptation state.
 * DISPLAY-LAYER ONLY — must not affect governance decisions.
 */
export type EnvironmentStatus =
  | 'STABLE'     // No shifts detected this cycle.
  | 'SHIFTING'   // LOW or MEDIUM severity change detected.
  | 'HOSTILE'    // HIGH severity change detected.
  | 'ADAPTING'   // HIGH severity was present last cycle; recovering this cycle.
  | 'MASTERED';  // Multiple hostile biomes cleared without tier downgrade.

/**
 * Named "terrain" representing the dominant environmental challenge.
 * DISPLAY-LAYER ONLY — drives morning screen artwork / labeling.
 */
export type BiomeName =
  | 'Stable Plains'         // No shift (default stable state).
  | 'Drift Swamp'           // benchmark_signature_change — baselines drifted.
  | 'API Rift'              // model_change — LLM API surface changed.
  | 'Dependency Storm'      // dependency_change — npm graph shifted.
  | 'Governance Faultline'  // repo_shape_change — governance files added/removed.
  | 'Unstable Terrain';     // runtime_change or multiple concurrent shifts.

/** A single detected environmental change event. */
export interface WorldShiftEvent {
  /** UUID for this event. */
  shift_id: string;

  /** ISO-8601 UTC timestamp when detection occurred. */
  detected_at: string;

  /** The nightly cycle that detected this shift. */
  cycle_id: string;

  /** Which dimensions of the environment changed. */
  shift_types: WorldShiftType[];

  /** Derived aggregate severity across all shift_types. */
  severity: 'LOW' | 'MEDIUM' | 'HIGH';

  /** DISPLAY-LAYER adaptation state implied by this shift. */
  environment_status: EnvironmentStatus;

  /** DISPLAY-LAYER biome name for the primary shift type. */
  biome: BiomeName;

  /** captured_at of the previous EnvironmentProfile used for comparison. */
  previous_profile_captured_at: string | null;

  /** Human-readable summary for the morning screen (≤ 160 chars). */
  description: string;
}

/**
 * Aggregated world shift summary for one nightly cycle.
 * Included in MorningResult when world_shift_config is active.
 */
export interface WorldShiftReport {
  schema_version: 'world_shift/0.1';

  /** ISO-8601 UTC timestamp when this report was assembled. */
  generated_at: string;

  /** captured_at of the current EnvironmentProfile. */
  current_profile_captured_at: string;

  /** captured_at of the previous EnvironmentProfile. null on first cycle. */
  previous_profile_captured_at: string | null;

  /** All shift events detected this cycle (typically 0 or 1). */
  shift_events: WorldShiftEvent[];

  /** true when at least one shift was detected. */
  any_shift_detected: boolean;

  /** Highest environment_status across all events; 'STABLE' when none. */
  environment_status: EnvironmentStatus;

  /** Dominant biome for this cycle's shift; 'Stable Plains' when none. */
  biome: BiomeName;
}
