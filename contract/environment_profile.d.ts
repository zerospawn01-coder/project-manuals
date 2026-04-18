/**
 * contract/environment_profile.d.ts
 *
 * EnvironmentProfile — Snapshot of the execution environment.
 * schema_version: env_profile/0.1
 *
 * Captured once per nightly cycle BEFORE Phase A begins.
 * Persisted to phase14/data/environment_profile.json (overwritten each cycle).
 * Previous profile is read at the start of the next cycle for diff computation.
 *
 * Used by WorldShiftDetector to identify environmental changes that may
 * invalidate historical benchmark baselines or accumulated knowledge.
 */

export interface EnvironmentProfile {
  schema_version: 'env_profile/0.1';

  /** ISO-8601 UTC timestamp when this profile was captured. */
  captured_at: string;

  /** LLM model identifier (from GEMINI_MODEL env var). */
  model_id: string;

  /** OS platform string (os.platform()). */
  runtime_os: string;

  /** Node.js version (process.version). */
  node_version: string;

  /** Python version string ("3.x.y" or "unavailable"). */
  python_version: string;

  /**
   * SHA-256 hex digest of package-lock.json content.
   * "unavailable" if file not found or read fails.
   */
  dependency_fingerprint: string;

  /**
   * SHA-256 hex digest of the sorted file-path list under tools/ + contract/.
   * Changes when files are added, removed, or renamed.
   * "unavailable" if directory listing fails.
   */
  repo_shape_hash: string;

  /**
   * benchmark_signature from the most recent BenchmarkProvenance sidecar.
   * "unavailable" if no benchmark has been run yet or measurement_env_valid=false.
   */
  benchmark_signature: string;
}
