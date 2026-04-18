/**
 * tools/environment_profiler.ts
 *
 * EnvironmentProfiler — Capture and persist the execution environment snapshot.
 * schema_version: env_profile/0.1
 *
 * Runs synchronously using Node.js built-ins. Python version detection uses
 * spawnSync and degrades gracefully to "unavailable" on failure.
 *
 * This module has NO side effects by default — callers must explicitly call
 * writeEnvironmentProfile() to persist the snapshot.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { EnvironmentProfile } from '../contract/environment_profile';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sha256hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function detectPythonVersion(python_executable: string): string {
  // Try the supplied executable first, then 'python3' as fallback.
  for (const exe of [python_executable, 'python3']) {
    try {
      const result = spawnSync(exe, ['--version'], {
        encoding: 'utf8',
        timeout: 5_000,
        shell: false,
      });
      if (result.error || (result.status !== 0 && result.status !== null)) continue;
      const combined = (result.stdout ?? '') + (result.stderr ?? '');
      const m = combined.match(/Python\s+([\d.]+)/i);
      if (m) return m[1]!;
    } catch {
      // continue to next candidate
    }
  }
  return 'unavailable';
}

function hashPackageLock(project_root: string): string {
  const lock_path = path.join(project_root, 'package-lock.json');
  try {
    const content = fs.readFileSync(lock_path, 'utf8');
    return sha256hex(content);
  } catch {
    return 'unavailable';
  }
}

function hashRepoShape(project_root: string): string {
  const dirs_to_scan = [
    path.join(project_root, 'tools'),
    path.join(project_root, 'contract'),
  ];
  const file_paths: string[] = [];
  for (const dir of dirs_to_scan) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          file_paths.push(path.relative(project_root, path.join(dir, entry.name)));
        }
      }
    } catch {
      // directory may not exist — skip
    }
  }
  if (file_paths.length === 0) return 'unavailable';
  file_paths.sort();
  return sha256hex(file_paths.join('\n'));
}

// ---------------------------------------------------------------------------
// Public configuration
// ---------------------------------------------------------------------------

export interface EnvironmentProfilerConfig {
  /** Absolute path to the project root (where package-lock.json lives). */
  project_root: string;

  /** Python executable to use for version detection. Default: 'python'. */
  python_executable?: string;

  /**
   * LLM model ID.
   * Default: process.env['GEMINI_MODEL'] ?? 'gemini-2.0-flash'.
   */
  model_id?: string;

  /**
   * Benchmark signature from the most recent BenchmarkProvenance sidecar.
   * Default: 'unavailable'.
   */
  benchmark_signature?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture the current EnvironmentProfile synchronously.
 * Safe to call from within the nightly loop runner at OBSERVING start.
 * Never throws — returns "unavailable" strings for any failed sub-capture.
 */
export function captureEnvironmentProfile(config: EnvironmentProfilerConfig): EnvironmentProfile {
  const {
    project_root,
    python_executable = 'python',
    model_id = process.env['GEMINI_MODEL'] ?? 'gemini-2.0-flash',
    benchmark_signature = 'unavailable',
  } = config;

  return {
    schema_version: 'env_profile/0.1',
    captured_at: new Date().toISOString(),
    model_id,
    runtime_os: os.platform(),
    node_version: (process as NodeJS.Process).version ?? process.execPath,
    python_version: detectPythonVersion(python_executable),
    dependency_fingerprint: hashPackageLock(project_root),
    repo_shape_hash: hashRepoShape(project_root),
    benchmark_signature,
  };
}

/**
 * Write an EnvironmentProfile JSON to the given file path.
 * Creates parent directories as needed.
 * Overwrites any existing file (profiles are replaced each cycle).
 */
export function writeEnvironmentProfile(
  profile: EnvironmentProfile,
  file_path: string
): void {
  const dir = path.dirname(file_path);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file_path, JSON.stringify(profile, null, 2), 'utf8');
}

/**
 * Read an EnvironmentProfile JSON from the given file path.
 * Returns null if the file doesn't exist, can't be read, or fails schema check.
 */
export function readEnvironmentProfile(file_path: string): EnvironmentProfile | null {
  try {
    const content = fs.readFileSync(file_path, 'utf8');
    const parsed = JSON.parse(content) as EnvironmentProfile;
    if (parsed.schema_version !== 'env_profile/0.1') return null;
    return parsed;
  } catch {
    return null;
  }
}
