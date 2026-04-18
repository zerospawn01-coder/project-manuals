/**
 * tools/world_shift_detector.ts
 *
 * WorldShiftDetector — Detect environmental changes between nightly cycles.
 *
 * Compares a previous and current EnvironmentProfile, emitting WorldShiftEvents
 * for each detected change dimension.
 *
 * DESIGN PRINCIPLES:
 *   - Pure function: no I/O, no side effects, fully deterministic.
 *   - Returns [] on first cycle (prev === null) — no false positives.
 *   - "unavailable" fields are never compared → no spurious alerts.
 *
 * GOVERNANCE BOUNDARY:
 *   WorldShiftEvents are DISPLAY-LAYER ONLY and advisory for Phase A prompts.
 *   detectWorldShift() output MUST NOT be used to modify tier thresholds,
 *   promotion gates, or invariant definitions.
 */

import { randomUUID } from 'node:crypto';

import type { EnvironmentProfile } from '../contract/environment_profile';
import type {
  WorldShiftType,
  WorldShiftEvent,
  WorldShiftReport,
  EnvironmentStatus,
  BiomeName,
} from '../contract/world_shift';

// ---------------------------------------------------------------------------
// Severity matrix
// ---------------------------------------------------------------------------

function computeSeverity(shift_types: WorldShiftType[]): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (shift_types.includes('model_change')) return 'HIGH';
  if (
    shift_types.includes('dependency_change') &&
    shift_types.includes('benchmark_signature_change')
  ) {
    return 'HIGH';
  }
  if (
    shift_types.includes('dependency_change') ||
    shift_types.includes('benchmark_signature_change') ||
    shift_types.includes('repo_shape_change')
  ) {
    return 'MEDIUM';
  }
  return 'LOW';
}

function computeBiome(
  shift_types: WorldShiftType[],
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
): BiomeName {
  if (shift_types.length === 0) return 'Stable Plains';
  if (shift_types.length >= 3 || severity === 'HIGH') return 'Unstable Terrain';
  if (shift_types.includes('model_change')) return 'API Rift';
  if (shift_types.includes('dependency_change')) return 'Dependency Storm';
  if (shift_types.includes('benchmark_signature_change')) return 'Drift Swamp';
  if (shift_types.includes('repo_shape_change')) return 'Governance Faultline';
  // runtime_change alone or any other composite
  return 'Unstable Terrain';
}

function computeEnvironmentStatus(
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
): EnvironmentStatus {
  if (severity === 'HIGH') return 'HOSTILE';
  if (severity === 'MEDIUM') return 'SHIFTING';
  return 'SHIFTING'; // LOW is still a shift
}

function buildDescription(shift_types: WorldShiftType[], severity: string): string {
  const labels: Record<WorldShiftType, string> = {
    model_change:               'LLMモデル変更',
    dependency_change:          'npm依存関係変更',
    benchmark_signature_change: 'ベンチマーク署名変更',
    runtime_change:             'Node.js/OSバージョン変更',
    repo_shape_change:          'リポジトリ構造変更',
  };
  const descs = shift_types.map((t) => labels[t]);
  return `[${severity}] ${descs.join(', ')}.`.slice(0, 160);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare previous and current EnvironmentProfiles.
 *
 * Returns an array of WorldShiftEvents (one per cycle — all changes bundled).
 * Returns [] when prev is null (first cycle) or when no differences are found.
 * Fields whose value is "unavailable" in either profile are skipped.
 */
export function detectWorldShift(
  prev: EnvironmentProfile | null,
  curr: EnvironmentProfile,
  cycle_id: string
): WorldShiftEvent[] {
  if (prev === null) return [];

  const shift_types: WorldShiftType[] = [];

  if (prev.model_id !== curr.model_id) {
    shift_types.push('model_change');
  }

  if (
    prev.dependency_fingerprint !== 'unavailable' &&
    curr.dependency_fingerprint !== 'unavailable' &&
    prev.dependency_fingerprint !== curr.dependency_fingerprint
  ) {
    shift_types.push('dependency_change');
  }

  if (
    prev.benchmark_signature !== 'unavailable' &&
    curr.benchmark_signature !== 'unavailable' &&
    prev.benchmark_signature !== curr.benchmark_signature
  ) {
    shift_types.push('benchmark_signature_change');
  }

  if (
    prev.runtime_os !== curr.runtime_os ||
    prev.node_version !== curr.node_version
  ) {
    shift_types.push('runtime_change');
  }

  if (
    prev.repo_shape_hash !== 'unavailable' &&
    curr.repo_shape_hash !== 'unavailable' &&
    prev.repo_shape_hash !== curr.repo_shape_hash
  ) {
    shift_types.push('repo_shape_change');
  }

  if (shift_types.length === 0) return [];

  const severity = computeSeverity(shift_types);
  const biome = computeBiome(shift_types, severity);
  const environment_status = computeEnvironmentStatus(severity);

  const event: WorldShiftEvent = {
    shift_id: randomUUID(),
    detected_at: new Date().toISOString(),
    cycle_id,
    shift_types,
    severity,
    environment_status,
    biome,
    previous_profile_captured_at: prev.captured_at,
    description: buildDescription(shift_types, severity),
  };

  return [event];
}

/**
 * Build a WorldShiftReport from detected events and the current profile.
 * Always returns a valid WorldShiftReport (STABLE / Stable Plains when no shifts).
 */
export function buildWorldShiftReport(
  events: WorldShiftEvent[],
  curr: EnvironmentProfile,
  prev: EnvironmentProfile | null
): WorldShiftReport {
  const any_shift = events.length > 0;

  let environment_status: EnvironmentStatus = 'STABLE';
  let biome: BiomeName = 'Stable Plains';

  if (any_shift) {
    // Pick event with highest severity
    const severity_order: Array<'LOW' | 'MEDIUM' | 'HIGH'> = ['LOW', 'MEDIUM', 'HIGH'];
    const top_event = events.reduce<WorldShiftEvent>((best, e) =>
      severity_order.indexOf(e.severity) >= severity_order.indexOf(best.severity) ? e : best
    , events[0]!);
    environment_status = top_event.environment_status;
    biome = top_event.biome;
  }

  return {
    schema_version: 'world_shift/0.1',
    generated_at: new Date().toISOString(),
    current_profile_captured_at: curr.captured_at,
    previous_profile_captured_at: prev?.captured_at ?? null,
    shift_events: events,
    any_shift_detected: any_shift,
    environment_status,
    biome,
  };
}
