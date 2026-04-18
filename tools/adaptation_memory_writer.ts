/**
 * tools/adaptation_memory_writer.ts
 *
 * Pure functions for writing and reading AdaptationMemory JSONL.
 *
 * Design:
 *   - Append-only JSONL (one AdaptationMemoryEntry per line).
 *   - No in-memory cache; all I/O goes straight to disk.
 *   - countPatchChangeLines()       — counts actual diff content lines
 *   - computeDedupKey()             — "<first_target>::<normalised_7_words>"
 *   - computeHintScore()            — 0.0–1.0 quality score (stability×0.4 + noise×0.2 + bench×0.2 + reuse×0.2)
 *   - computeDecayMultiplier()      — 0.0–1.0 age-based decay (exp half-life 14 days)
 *   - buildAdaptationMemoryEntry()  — build from PromotedSkill + options
 *   - appendAdaptationMemoryEntries() — append to JSONL
 *   - loadRecentAdaptationMemory()   — read last N entries
 *   - buildAdaptationMemorySummary() — per-cycle display summary
 *   - loadReuseStats()              — load reuse stats sidecar JSON
 *   - saveReuseStats()              — persist reuse stats sidecar JSON
 *   - updateReuseStats()            — increment counts for re-promoted dedup_keys
 *   - loadEnvScores()               — load environment-specific score sidecar JSON
 *   - saveEnvScores()               — persist environment-specific score sidecar JSON
 *   - updateEnvScores()             — accumulate hint_scores per (dedup_key, environment)
 *   - buildMetaStrategyBlock()       — aggregate hot-spot/blast_radius patterns for {{ADAPTATION_META_STRATEGY_BLOCK}}
 *
 * Called by nightly_loop_runner.ts after Phase C promotes skills.
 * loadRecentAdaptationMemory() is also used by loadOpenClawCandidates()
 * for dedup checks.
 * buildAdaptationHintBlock() is used by OpenClawGateway.process(query_hints).
 *
 * HINT DECAY MODEL (Phase G1):
 *   hint_score is written at promotion time and never mutated in JSONL.
 *   effective_score = hint_score × exp(-age_days / HINT_HALF_LIFE_DAYS)
 *   Entries with effective_score < HINT_MIN_EFFECTIVE_SCORE are excluded.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type {
  AdaptationMemoryEntry,
  AdaptationMemoryEnvScores,
  AdaptationMemoryReuseStats,
  AdaptationMemorySummary,
  AdaptationTargetMeta,
  AdaptationMetaStrategySummary,
  BlastRadiusLabel,
  PatchSource,
  TierLabel,
} from '../contract/adaptation_memory';
import type { SkillTreeNode, SkillTreeReport, MetaSkill, ExpiredSkillEntry, BiomeMastery, CivSummary, TechBranch, CultureCluster, CollapseRisk, CivIntervention, InterventionAction, CivFork, CivForkBranch, MultiCivReport, MultiCivRun, MultiCivStatus, CivGeneration, CollapseEvent } from '../contract/morning_result';
import type { PromotedSkill } from '../contract/phase_c_promote';
import type { WorldShiftReport } from '../contract/world_shift';

// ---------------------------------------------------------------------------
// SECTION 1 — dedup key
// ---------------------------------------------------------------------------

/**
 * Compute a fast deduplication key from a title and affected_targets list.
 * Format: "<first_target>::<normalised_7_title_words>"
 *
 * Rules:
 *   - first_target: first entry in affected_targets, or 'no-target'
 *   - title normalisation: lowercase, strip non-alphanumeric except spaces,
 *     collapse whitespace, take first 7 words
 *
 * The key is stable across cycles for the same logical patch, enabling
 * duplicate detection across sessions.
 */
export function computeDedupKey(title: string, affected_targets: string[]): string {
  const first_target = affected_targets.length > 0 ? affected_targets[0] : 'no-target';
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 7)
    .join(' ');
  return `${first_target}::${words}`;
}

// ---------------------------------------------------------------------------
// SECTION 2 — patch change line count
// ---------------------------------------------------------------------------

/**
 * Count non-header diff lines starting with '+' or '-'.
 * Excludes '+++' / '---' file path marker lines from unified diff format.
 * Returns 0 for an empty or header-only patch_diff.
 */
export function countPatchChangeLines(patch_diff: string): number {
  return patch_diff
    .split('\n')
    .filter((line) => {
      if (line.startsWith('+++') || line.startsWith('---')) return false;
      return line.startsWith('+') || line.startsWith('-');
    }).length;
}

// ---------------------------------------------------------------------------
// SECTION 2.5 — hint quality score
// ---------------------------------------------------------------------------

/**
 * Compute a 0.0–1.0 quality score for a potential hint entry.
 *
 * Components (v0.1 正規化方式: 各コンポーネントを加算後、合計重みで除算 → 0.0–1.0):
 *   stability_norm     = min(1, stability_index_delta / 0.01) × 0.40
 *   noise_floor        = above_noise_floor ? 0.20 : 0.00
 *   benchmark          = benchmark_verified ? 0.20 : 0.00
 *   reuse_bonus        = (reused_count / (reused_count + 1)) × 0.20  (現行維持)
 *   invariant_fulfills = attribution_snapshot 非 null かつ fulfills_invariant_ids 非空 → 0.10, else 0.00
 *
 *   raw_sum  = sum of above (max 1.10 when all components maxed)
 *   score    = raw_sum / sum_of_max_weights  (= raw_sum / 1.10)
 *
 * 正規化理由: reuse_bonus の実績評価 (0.20) を外さず、attribution の効果を段階的に計測できる。
 *
 * @param quality_signals        from AdaptationMemoryEntry.quality_signals
 * @param improvements           from AdaptationMemoryEntry.confirmed_improvements
 * @param reused_count           from AdaptationMemoryReuseStats[dedup_key].reused_count (0 when new)
 * @param has_attribution        true 時に invariant_fulfills ボーナスを加算
 */
export function computeHintScore(
  quality_signals: AdaptationMemoryEntry['quality_signals'],
  improvements: AdaptationMemoryEntry['confirmed_improvements'],
  reused_count = 0,
  has_attribution = false
): number {
  const stability_norm     = Math.min(1, improvements.stability_index_delta / 0.01) * 0.40;
  const noise_floor        = quality_signals.above_noise_floor ? 0.20 : 0.00;
  const benchmark          = quality_signals.benchmark_verified ? 0.20 : 0.00;
  const reuse_bonus        = (reused_count / (reused_count + 1)) * 0.20;
  const invariant_fulfills = has_attribution ? 0.10 : 0.00;
  const raw_sum            = stability_norm + noise_floor + benchmark + reuse_bonus + invariant_fulfills;
  // Normalise: divide by maximum possible sum (1.10) so result stays in [0, 1]
  const MAX_WEIGHT_SUM     = 1.10;
  return parseFloat((raw_sum / MAX_WEIGHT_SUM).toFixed(4));
}

// ---------------------------------------------------------------------------
// SECTION 2.7 — hint decay (Phase G1)
// ---------------------------------------------------------------------------

/**
 * Half-life of a hint in days.
 * At age = HINT_HALF_LIFE_DAYS the decay multiplier is 0.5.
 * At age = 28 days it is 0.25, at 42 days it is 0.125, etc.
 * Configurable here; changing this value affects read-time filtering only
 * (no JSONL data is mutated).
 */
export const HINT_HALF_LIFE_DAYS = 14;

/**
 * Minimum effective_score threshold.
 * Entries whose effective_score falls below this value are excluded from
 * the hint block entirely ("expired").
 * 0.05 keeps an entry with initial hint_score 0.40 active for ~∼58 days.
 */
export const HINT_MIN_EFFECTIVE_SCORE = 0.05;

/**
 * Compute the exponential decay multiplier for an entry based on its age.
 *
 * Formula: multiplier = exp(-age_days / HINT_HALF_LIFE_DAYS)
 * Range: 1.0 (age=0) → 0.5 (age=HALF_LIFE) → 0.0 (age=∞)
 *
 * @param recorded_at  ISO-8601 UTC string when the entry was written
 * @param now          Reference time for age calculation (default: Date.now())
 */
export function computeDecayMultiplier(recorded_at: string, now: Date = new Date()): number {
  const age_ms   = now.getTime() - new Date(recorded_at).getTime();
  const age_days = Math.max(0, age_ms / (1000 * 60 * 60 * 24));
  return Math.exp(-age_days / HINT_HALF_LIFE_DAYS);
}

/**
 * Compute the effective hint score after applying temporal decay.
 * This is a read-time calculation only; the stored hint_score is never mutated.
 *
 * @param hint_score   Stored hint_score from AdaptationMemoryEntry
 * @param recorded_at  ISO-8601 UTC string (used to derive age)
 * @param now          Reference time (default: Date.now())
 */
export function computeEffectiveScore(
  hint_score: number,
  recorded_at: string,
  now: Date = new Date()
): number {
  return parseFloat((hint_score * computeDecayMultiplier(recorded_at, now)).toFixed(4));
}

// ---------------------------------------------------------------------------
// SECTION 3 — build entry
// ---------------------------------------------------------------------------

export interface BuildAdaptationMemoryEntryOptions {
  /** LLM-generated or externally submitted via OpenClaw. */
  patch_source: PatchSource;
  /** World state at the time of promotion; null if Phase F is not enabled. */
  world_shift_report?: WorldShiftReport | null;
  /** Legitimacy/evolution tier at promotion time; null if not yet computed. */
  tier_at_promotion?: TierLabel | null;
  /**
   * Was the drift monitor in a non-blocking state?
   * true  = no promotion block (default).
   * false = drift-blocked but a human override was applied.
   */
  drift_stable_at_promotion?: boolean;
  /**
   * The raw patch diff from the original PatchCandidate.
   * Used to compute patch_change_lines.  When absent, patch_change_lines = 0.
   */
  patch_diff?: string;
  /** blast_radius from source PatchCandidate. Defaults to 'SELF'. */
  estimated_blast_radius?: BlastRadiusLabel;
  /**
   * Number of previous re-promotions of this dedup_key (from reuse stats sidecar).
   * Used to compute hint_score's reuse_bonus component.
   * Defaults to 0 (first time this pattern is seen).
   */
  reused_count?: number;
  /**
   * Attribution snapshot — verbatim copy of PatchCandidate.attribution.
   * null / undefined → attribution_snapshot: null (後方互換用)。
   * 存在する場合: computeHintScore の has_attribution=true を有効化。
   */
  attribution_snapshot?: import('../contract/phase_a_prompt').PatchAttribution | null;
}

/**
 * Build a single AdaptationMemoryEntry from a PromotedSkill and context.
 */
export function buildAdaptationMemoryEntry(
  skill: PromotedSkill,
  cycle_id: string,
  opts: BuildAdaptationMemoryEntryOptions
): AdaptationMemoryEntry {
  const patch_change_lines =
    opts.patch_diff !== undefined ? countPatchChangeLines(opts.patch_diff) : 0;

  const quality_signals_obj = {
    patch_change_lines,
    above_noise_floor: patch_change_lines >= 1,
    benchmark_verified: patch_change_lines > 0,
  };

  const env_snap =
    opts.world_shift_report != null
      ? {
          environment_status: opts.world_shift_report.environment_status as string,
          biome: opts.world_shift_report.biome as string,
          any_shift_detected: opts.world_shift_report.any_shift_detected,
        }
      : null;

  const dedup_key = computeDedupKey(skill.title, skill.affected_targets);
  const attribution_snap = opts.attribution_snapshot ?? null;
  const hint_score = computeHintScore(
    quality_signals_obj,
    skill.confirmed_improvements,
    opts.reused_count ?? 0,
    attribution_snap !== null && attribution_snap.fulfills_invariant_ids.length > 0
  );

  return {
    schema_version: 'adaptation_memory/0.1',
    entry_id: randomUUID(),
    recorded_at: new Date().toISOString(),
    cycle_id,
    skill_id: skill.skill_id,
    title: skill.title,
    affected_targets: skill.affected_targets,
    estimated_blast_radius: opts.estimated_blast_radius ?? 'SELF',
    patch_source: opts.patch_source,
    confirmed_improvements: skill.confirmed_improvements,
    quality_signals: quality_signals_obj,
    environment_snapshot: env_snap,
    tier_at_promotion: opts.tier_at_promotion ?? null,
    drift_stable_at_promotion: opts.drift_stable_at_promotion ?? true,
    attribution_snapshot: attribution_snap,
    dedup_key,
    hint_score,
  };
}

// ---------------------------------------------------------------------------
// SECTION 4 — JSONL I/O
// ---------------------------------------------------------------------------

/**
 * Append entries to the JSONL file at file_path.
 * Creates the file (and parent directories) if they do not exist.
 * Each entry becomes exactly one JSON line followed by a newline.
 */
export function appendAdaptationMemoryEntries(
  entries: AdaptationMemoryEntry[],
  file_path: string
): void {
  if (entries.length === 0) return;

  const dir = path.dirname(file_path);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.appendFileSync(file_path, lines, 'utf8');
}

/**
 * Read up to max_entries recent entries from the JSONL file.
 * Returns entries in file order (oldest first).
 * Returns an empty array when the file does not exist.
 * Silently skips malformed lines.
 */
export function loadRecentAdaptationMemory(
  file_path: string,
  max_entries = 200
): AdaptationMemoryEntry[] {
  if (!fs.existsSync(file_path)) {
    return [];
  }

  const raw_lines = fs.readFileSync(file_path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Take the last max_entries lines (most recent entries)
  const relevant = max_entries === Infinity ? raw_lines : raw_lines.slice(-max_entries);

  const entries: AdaptationMemoryEntry[] = [];
  for (const line of relevant) {
    try {
      entries.push(JSON.parse(line) as AdaptationMemoryEntry);
    } catch {
      // Skip malformed lines silently
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// SECTION 4.5 — reuse stats sidecar (adaptation_memory_reuse_stats.json)
// ---------------------------------------------------------------------------

/**
 * Load the reuse stats sidecar file.
 * Returns an empty object when the file does not exist or is malformed.
 */
export function loadReuseStats(stats_path: string): AdaptationMemoryReuseStats {
  if (!fs.existsSync(stats_path)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(stats_path, 'utf8')) as AdaptationMemoryReuseStats;
  } catch {
    return {};
  }
}

/**
 * Persist the reuse stats sidecar file (overwrites if exists).
 * Creates parent directories if they do not exist.
 */
export function saveReuseStats(stats: AdaptationMemoryReuseStats, stats_path: string): void {
  const dir = path.dirname(stats_path);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(stats_path, JSON.stringify(stats, null, 2) + '\n', 'utf8');
}

/**
 * After appending new AdaptationMemoryEntry records, scan the full JSONL for
 * dedup_key collisions and increment reused_count for each matched prior entry.
 *
 * Logic:
 *   For each new entry, if any *prior* entry in the JSONL shares the same
 *   dedup_key → the same pattern was re-promoted. Increment its stats entry.
 *
 * Must be called immediately after appendAdaptationMemoryEntries().
 */
export function updateReuseStats(
  new_entries: AdaptationMemoryEntry[],
  memory_path: string,
  stats_path: string
): void {
  if (new_entries.length === 0) return;

  const new_keys = new Set(new_entries.map((e) => e.dedup_key));
  const all_existing = loadRecentAdaptationMemory(memory_path, Infinity);

  // Exclude the just-appended entries from the collision check
  const new_entry_ids = new Set(new_entries.map((e) => e.entry_id));
  const prior = all_existing.filter((e) => !new_entry_ids.has(e.entry_id));

  const stats = loadReuseStats(stats_path);
  const now = new Date().toISOString();

  for (const prior_entry of prior) {
    if (new_keys.has(prior_entry.dedup_key)) {
      const key = prior_entry.dedup_key;
      const existing = stats[key];
      if (existing) {
        existing.reused_count += 1;
        existing.last_reused_at = now;
      } else {
        stats[key] = { reused_count: 1, last_reused_at: now };
      }
    }
  }

  saveReuseStats(stats, stats_path);
}

// ---------------------------------------------------------------------------
// SECTION 4.7 — environment-specific score sidecar (Phase G2)
// ---------------------------------------------------------------------------

/**
 * Load the environment scores sidecar file.
 * Returns an empty object when the file does not exist or is malformed.
 */
export function loadEnvScores(env_scores_path: string): AdaptationMemoryEnvScores {
  if (!fs.existsSync(env_scores_path)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(env_scores_path, 'utf8')) as AdaptationMemoryEnvScores;
  } catch {
    return {};
  }
}

/**
 * Persist the environment scores sidecar file (overwrites if exists).
 * Creates parent directories if they do not exist.
 */
export function saveEnvScores(
  scores: AdaptationMemoryEnvScores,
  env_scores_path: string
): void {
  const dir = path.dirname(env_scores_path);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(env_scores_path, JSON.stringify(scores, null, 2) + '\n', 'utf8');
}

/**
 * After appending new AdaptationMemoryEntry records, accumulate their hint_scores
 * into the per-(dedup_key, environment_status) score sidecar.
 *
 * Only entries with a non-null environment_snapshot are recorded.
 * Call this immediately after appendAdaptationMemoryEntries().
 *
 * @param new_entries       Newly appended entries
 * @param env_scores_path   Path to adaptation_memory_env_scores.json
 */
export function updateEnvScores(
  new_entries: AdaptationMemoryEntry[],
  env_scores_path: string
): void {
  if (new_entries.length === 0) return;

  const scores = loadEnvScores(env_scores_path);
  const now = new Date().toISOString();

  for (const entry of new_entries) {
    const env_status = entry.environment_snapshot?.environment_status;
    if (!env_status) continue;  // skip entries without environment data

    const key = entry.dedup_key;
    if (!scores[key]) {
      scores[key] = {};
    }
    const env_bucket = scores[key]![env_status];
    if (env_bucket) {
      env_bucket.total_hint_score += entry.hint_score;
      env_bucket.count            += 1;
      env_bucket.last_promoted_at  = now;
    } else {
      scores[key]![env_status] = {
        total_hint_score: entry.hint_score,
        count:            1,
        last_promoted_at: now,
      };
    }
  }

  saveEnvScores(scores, env_scores_path);
}

// ---------------------------------------------------------------------------
// SECTION 5 — summary
// ---------------------------------------------------------------------------

/**
 * Build a display-layer summary of the adaptation memory file.
 * Reads the entire file; should only be called once per cycle (in Phase D).
 */
export function buildAdaptationMemorySummary(
  file_path: string,
  cycle_id: string
): AdaptationMemorySummary {
  const all_entries = loadRecentAdaptationMemory(file_path, Infinity);
  const this_cycle  = all_entries.filter((e) => e.cycle_id === cycle_id);

  const blast_radii_this_cycle: Partial<Record<BlastRadiusLabel, number>> = {};
  for (const e of this_cycle) {
    const key = e.estimated_blast_radius;
    blast_radii_this_cycle[key] = (blast_radii_this_cycle[key] ?? 0) + 1;
  }

  return {
    total_entries:                 all_entries.length,
    entries_this_cycle:            this_cycle.length,
    openclaw_entries_this_cycle:   this_cycle.filter((e) => e.patch_source === 'openclaw').length,
    distinct_environment_statuses: [
      ...new Set(
        this_cycle
          .map((e) => e.environment_snapshot?.environment_status)
          .filter((s): s is string => s != null)
      ),
    ],
    blast_radii_this_cycle,
    // Populated by the Phase A hint block builder; null here since summary
    // is built in Phase D (after Phase A hint injection has already occurred).
    expired_hints_excluded: null,
  };
}

// ---------------------------------------------------------------------------
// SECTION 6 — Phase A hint block (advisory injection)
// ---------------------------------------------------------------------------

/**
 * Maximum number of entries used to build the hint block.
 * Caps the context length injected into the Phase A system prompt.
 */
const HINT_BLOCK_MAX_ENTRIES = 5;

/**
 * Compute the sort score for a single entry, applying Phase G2 environment-specific
 * avg score when data is available, then temporal decay.
 *
 * Priority:
 *   1. If current_environment_status is set AND the (dedup_key, env) pair has
 *      accumulated data → use avg_env_hint_score × decay.
 *   2. Otherwise fall back to global hint_score × decay.
 */
function computeSortScore(
  entry: AdaptationMemoryEntry,
  env_scores: AdaptationMemoryEnvScores,
  current_environment_status: string | undefined,
  now: Date
): { sort_score: number; is_env_specific: boolean; avg_env_score: number | null } {
  const decay     = computeDecayMultiplier(entry.recorded_at, now);
  const global_eff = parseFloat(((entry.hint_score ?? 0) * decay).toFixed(4));

  if (!current_environment_status) {
    return { sort_score: global_eff, is_env_specific: false, avg_env_score: null };
  }

  const env_bucket = env_scores[entry.dedup_key]?.[current_environment_status];
  if (!env_bucket || env_bucket.count === 0) {
    return { sort_score: global_eff, is_env_specific: false, avg_env_score: null };
  }

  const avg_env_score = env_bucket.total_hint_score / env_bucket.count;
  const env_eff       = parseFloat((avg_env_score * decay).toFixed(4));
  return { sort_score: env_eff, is_env_specific: true, avg_env_score };
}

/**
 * Build the advisory hint block text that is injected into
 * {{ADAPTATION_HINT_BLOCK}} in PHASE14_SYSTEM_TEMPLATE.
 *
 * Design constraints (GOVERNANCE BOUNDARY):
 *   - ADVISORY ONLY.  The LLM may take inspiration from these hints but
 *     must not reproduce them verbatim.
 *   - Must NOT instruct the LLM to adopt, copy, or favour any specific entry.
 *   - Must NOT change blast_radius ceilings, invariant rules, or governance.
 *
 * Phase G2 addition:
 *   When current_environment_status is set, sorts by environment-specific
 *   average hint_score × decay.  Falls back to global score for entries with
 *   no environment data.
 *
 * Returns a non-empty string always (falls back to "（なし）" when no entries).
 */
export function buildAdaptationHintBlock(
  file_path: string,
  options: {
    /**
     * Current cycle ID — excluded from hints so we do not feed forward
     * the same cycle's own results before they are consolidated.
     */
    exclude_cycle_id?: string;
    /**
     * Current environment_status (e.g. 'HOSTILE').
     * When present, environment-specific average scores are used for sorting.
     */
    current_environment_status?: string;
    /**
     * InvariantStressSeed から収集した、現サイクルでストレス状態にある不変条件 ID。
     * attribution_snapshot.fulfills_invariant_ids との積集合が非空のエントリに +0.15 スコアブース。
     * 注意: sort_score は 1.0 で上限 clampされる。
     */
    current_stressed_invariant_ids?: string[];
    /**
     * Reference time for decay calculation.
     * Defaults to new Date() (now).  Inject in tests to simulate age.
     */
    now?: Date;
  } = {}
): string {
  const now = options.now ?? new Date();
  const recent = loadRecentAdaptationMemory(file_path, 50);

  // Load environment scores sidecar (Phase G2)
  const env_scores_path = file_path.replace(/\.jsonl$/, '_env_scores.json');
  const env_scores = loadEnvScores(env_scores_path);

  // Filter: exclude current cycle to avoid leaking in-flight results
  const pre_decay = options.exclude_cycle_id
    ? recent.filter((e) => e.cycle_id !== options.exclude_cycle_id)
    : recent;

  // Apply temporal decay and Phase G2 env-specific score; exclude expired entries
  const with_scores = pre_decay.map((e) => {
    const { sort_score: base_sort_score, is_env_specific, avg_env_score } = computeSortScore(
      e, env_scores, options.current_environment_status, now
    );
    const global_effective = computeEffectiveScore(e.hint_score ?? 0, e.recorded_at, now);

    // Phase G3 attribution boost: +0.15 when this entry fulfills a currently stressed invariant
    let invariant_boost = 0;
    if (
      options.current_stressed_invariant_ids &&
      options.current_stressed_invariant_ids.length > 0 &&
      e.attribution_snapshot?.fulfills_invariant_ids
    ) {
      const fulfills = e.attribution_snapshot.fulfills_invariant_ids as string[];
      const has_overlap = fulfills.some(
        (id) => options.current_stressed_invariant_ids!.includes(id)
      );
      if (has_overlap) invariant_boost = 0.15;
    }
    const sort_score = Math.min(1.0, base_sort_score + invariant_boost);

    return { entry: e, sort_score, global_effective, is_env_specific, avg_env_score, invariant_boost };
  });

  const eligible = with_scores.filter((x) => x.sort_score >= HINT_MIN_EFFECTIVE_SCORE
    || x.global_effective >= HINT_MIN_EFFECTIVE_SCORE);

  // Recompute expired count based on global decay (TTL is global, not env-specific)
  const expired_count = with_scores.filter(
    (x) => x.global_effective < HINT_MIN_EFFECTIVE_SCORE
  ).length;

  if (eligible.length === 0) {
    const reason = pre_decay.length === 0
      ? '（なし — 過去の記録はまだありません）'
      : `（なし — 全${pre_decay.length}件が期限切れです）`;
    return reason;
  }

  // Sort: sort_score DESC (env-specific when available, else global), then recency
  const sorted = [...eligible].sort((a, b) => {
    const diff = b.sort_score - a.sort_score;
    if (Math.abs(diff) > 0.0001) return diff;
    return b.entry.recorded_at.localeCompare(a.entry.recorded_at);
  });

  const top = sorted.slice(0, HINT_BLOCK_MAX_ENTRIES);

  const env_header = options.current_environment_status
    ? ` (現在の環境: ${options.current_environment_status})`
    : '';
  const lines: string[] = [
    `以下は過去のサイクルで Phase C を通過した改善パッチの参考情報です。${env_header}`,
    '⚠ これらは参考情報のみです。そのまま再提案するのではなく、FocusSeed に基づいた',
    '  独自の候補を生成してください。patch_source が openclaw の項目は外部提案です。',
    '',
  ];

  if (expired_count > 0) {
    lines.push(`  (期限切れにより ${expired_count} 件除外済み)`);
    lines.push('');
  }

  for (const { entry: e, sort_score, global_effective, is_env_specific, avg_env_score, invariant_boost } of top) {
    const age_days = Math.floor(
      (now.getTime() - new Date(e.recorded_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    const env_tag = e.environment_snapshot ? ` [env:${e.environment_snapshot.environment_status}]` : '';
    const src_tag = e.patch_source === 'openclaw' ? ' [OpenClaw submitted]' : '';
    // Score tag: show env-specific score when used, else global; append invariant boost when active
    const boost_tag = invariant_boost > 0 ? ` +inv_boost:${invariant_boost.toFixed(2)}` : '';
    let score_tag: string;
    if (is_env_specific && avg_env_score !== null) {
      score_tag = ` [env_score:${avg_env_score.toFixed(2)}→${sort_score.toFixed(2)}${boost_tag} base:${(e.hint_score ?? 0).toFixed(2)} age:${age_days}d]`;
    } else {
      score_tag = ` [score:${(e.hint_score ?? 0).toFixed(2)}→${global_effective.toFixed(2)}${boost_tag} age:${age_days}d]`;
    }
    const imp = e.confirmed_improvements;
    const imp_parts: string[] = [];
    if (imp.saved_time_minutes != null)  imp_parts.push(`saved_time=${imp.saved_time_minutes.toFixed(6)}min`);
    if (imp.bugs_killed != null)         imp_parts.push(`bugs_killed=${imp.bugs_killed}`);
    if (imp.refined_code_lines != null)  imp_parts.push(`refined_lines=${imp.refined_code_lines}`);
    if (imp.tokens_saved != null)        imp_parts.push(`tokens_saved=${imp.tokens_saved}`);
    imp_parts.push(`stability_delta=${imp.stability_index_delta.toFixed(4)}`);
    const imp_str = imp_parts.join(', ');

    lines.push(`  - "${e.title}"${env_tag}${src_tag}${score_tag}`);
    lines.push(`    targets: ${e.affected_targets.slice(0, 2).join(', ')}`);
    lines.push(`    verified: ${imp_str}`);
    lines.push(`    blast_radius: ${e.estimated_blast_radius}`);
    // Show fulfills hint when attribution exists (advisory only)
    if (e.attribution_snapshot?.fulfills_invariant_ids) {
      lines.push(`    fulfills_invariants: ${(e.attribution_snapshot.fulfills_invariant_ids as string[]).join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// SECTION 7 — Phase G3: Meta-strategy extraction
// ---------------------------------------------------------------------------

/**
 * Maximum entries to read when computing meta-strategy patterns.
 * Higher than HINT_BLOCK_MAX_ENTRIES to capture longer-term patterns.
 */
const META_STRATEGY_ENTRY_LIMIT = 200;

/**
 * Minimum number of active entries required for a useful meta-strategy block.
 * Avoids showing a near-empty analysis on day-1 runs.
 */
const META_STRATEGY_MIN_ACTIVE = 3;

/**
 * Build a meta-strategy advisory block that summarises recurring patterns
 * across ALL accumulated history (up to META_STRATEGY_ENTRY_LIMIT entries).
 *
 * Injected into {{ADAPTATION_META_STRATEGY_BLOCK}} in PHASE14_SYSTEM_TEMPLATE.
 *
 * Design constraints (GOVERNANCE BOUNDARY):
 *   - ADVISORY ONLY.  Does not alter blast_radius ceilings or governance.
 *   - Pattern data is aggregated; no individual entry is surfaced here.
 *     (Individual entries appear in {{ADAPTATION_HINT_BLOCK}} instead.)
 *
 * Two signals produced:
 *   1. Hot-spot targets: files most frequently improved → worth re-visiting.
 *   2. Blast radius distribution: what scope level has historically succeeded.
 */
export function buildMetaStrategyBlock(
  file_path: string,
  options: { now?: Date } = {}
): string {
  const now = options.now ?? new Date();
  const all_entries = loadRecentAdaptationMemory(file_path, META_STRATEGY_ENTRY_LIMIT);

  // Only include non-expired entries in pattern analysis
  const active = all_entries.filter(
    (e) => computeEffectiveScore(e.hint_score ?? 0, e.recorded_at, now) >= HINT_MIN_EFFECTIVE_SCORE
  );

  if (active.length < META_STRATEGY_MIN_ACTIVE) {
    return `（なし — 有効なメタ戦略データが不足しています。全${all_entries.length}件のうち${active.length}件のみ有効）`;
  }

  // ── 1. Group by primary target ─────────────────────────────────────────
  const target_map = new Map<string, { count: number; total_score: number; best_score: number }>();
  for (const e of active) {
    const t = e.affected_targets[0] ?? '(unknown)';
    const existing = target_map.get(t) ?? { count: 0, total_score: 0, best_score: 0 };
    target_map.set(t, {
      count:       existing.count + 1,
      total_score: existing.total_score + (e.hint_score ?? 0),
      best_score:  Math.max(existing.best_score, e.hint_score ?? 0),
    });
  }

  const top_targets: AdaptationTargetMeta[] = [...target_map.entries()]
    .map(([target, s]) => ({
      target,
      count:          s.count,
      avg_hint_score: parseFloat((s.total_score / s.count).toFixed(4)),
      best_hint_score: s.best_score,
    }))
    .sort((a, b) => b.count - a.count || b.avg_hint_score - a.avg_hint_score)
    .slice(0, 3);

  // ── 2. Blast radius distribution ───────────────────────────────────────
  const radius_map = new Map<string, number>();
  for (const e of active) {
    const r = e.estimated_blast_radius as string;
    radius_map.set(r, (radius_map.get(r) ?? 0) + 1);
  }
  const radius_sorted = [...radius_map.entries()].sort((a, b) => b[1] - a[1]);

  // ── Format ─────────────────────────────────────────────────────────────
  const lines: string[] = [
    `履歴分析 (全${all_entries.length}件のうち${active.length}件有効):`,
    '',
    '  頻出ターゲット (改善が繰り返し成功したファイル):',
  ];

  for (let i = 0; i < top_targets.length; i++) {
    const { target, count, avg_hint_score } = top_targets[i];
    lines.push(`    ${i + 1}. ${target}: ${count}件 (avg_score=${avg_hint_score.toFixed(2)})`);
  }

  lines.push('');
  const radius_str = radius_sorted
    .map(([r, c]) => `${r}: ${c}件 (${Math.round((c / active.length) * 100)}%)`)
    .join(', ');
  lines.push(`  blast_radius分布: ${radius_str}`);

  // Advisory footnote when SELF is overwhelmingly dominant
  if (
    radius_sorted.length > 0 &&
    radius_sorted[0][0] === 'SELF' &&
    radius_sorted[0][1] / active.length >= 0.8
  ) {
    lines.push('  (過去の成功パターンはSELFスコープに集中しています)');
  }

  return lines.join('\n');
}

/**
 * Compute the meta-strategy summary object (without formatting).
 * Useful for tests and display-layer consumers.
 */
export function computeAdaptationMetaStrategySummary(
  file_path: string,
  options: { now?: Date } = {}
): AdaptationMetaStrategySummary {
  const now = options.now ?? new Date();
  const all_entries = loadRecentAdaptationMemory(file_path, META_STRATEGY_ENTRY_LIMIT);
  const active = all_entries.filter(
    (e) => computeEffectiveScore(e.hint_score ?? 0, e.recorded_at, now) >= HINT_MIN_EFFECTIVE_SCORE
  );

  const target_map = new Map<string, { count: number; total_score: number; best_score: number }>();
  for (const e of active) {
    const t = e.affected_targets[0] ?? '(unknown)';
    const existing = target_map.get(t) ?? { count: 0, total_score: 0, best_score: 0 };
    target_map.set(t, {
      count:       existing.count + 1,
      total_score: existing.total_score + (e.hint_score ?? 0),
      best_score:  Math.max(existing.best_score, e.hint_score ?? 0),
    });
  }

  const top_targets: AdaptationTargetMeta[] = [...target_map.entries()]
    .map(([target, s]) => ({
      target,
      count:          s.count,
      avg_hint_score: parseFloat((s.total_score / s.count).toFixed(4)),
      best_hint_score: s.best_score,
    }))
    .sort((a, b) => b.count - a.count || b.avg_hint_score - a.avg_hint_score)
    .slice(0, 3);

  const radius_distribution: { [radius: string]: number } = {};
  for (const e of active) {
    const r = e.estimated_blast_radius as string;
    radius_distribution[r] = (radius_distribution[r] ?? 0) + 1;
  }

  return {
    total_entries:              all_entries.length,
    active_entries:             active.length,
    top_targets,
    blast_radius_distribution:  radius_distribution,
  };
}

// SECTION 8 — Skill Tree: Phase H1–H3 + Phase I1–I4
// ---------------------------------------------------------------------------

/** Maximum simultaneous active nodes surfaced in the skill tree. */
const SKILL_TREE_MAX_NODES = 20;

/** Biome mismatch penalty multiplier (70% reduction in foreign biome). */
export const BIOME_MISMATCH_MULTIPLIER = 0.3;

/** Minimum effective_score to qualify for synthesis. */
const SKILL_SYNTHESIS_MIN_SCORE = 0.3;
/** Max synthesized MetaSkills to emit across all levels. */
const SKILL_SYNTHESIS_MAX_COUNT_L1 = 3;
/** Max level-2 (超合成) MetaSkills to emit. */
const SKILL_SYNTHESIS_MAX_COUNT_L2 = 1;
/** Synergy bonus per synthesis level. */
const SKILL_SYNERGY_BONUS = 1.1;
/** Max recently-expired entries in death log. */
const RECENTLY_EXPIRED_MAX = 5;

/** Phase I3: selection pressure thresholds. */
const PERSIST_SCORE_THRESHOLD = 0.5;
const PRUNE_SCORE_THRESHOLD   = 0.2;
const PRUNE_BIOME_THRESHOLD   = 0.1;

/** Phase I2: mastery rank thresholds (by total_promotions). */
const MASTERY_APPRENTICE_MIN = 3;
const MASTERY_MASTER_MIN     = 10;

/** Phase J3: civilization collapse risk thresholds. */
const COLLAPSE_RISK_WARNING_THRESHOLD  = 0.4;
const COLLAPSE_RISK_CRITICAL_THRESHOLD = 0.2;

/** Phase J1: culture cluster label map (blast_radius → Japanese faction name). */
const CLUSTER_LABELS: Record<string, string> = {
  SELF:   '個体主義',
  MODULE: 'モジュール派',
  SYSTEM: 'システム派',
  CROSS:  '汎用派',
};

/** Phase J2: minimum effective_score for SPEED/STABILITY branch classification. */
const TECH_BRANCH_SCORE_MIN = 0.4;

/** Phase K1: fraction of SPEED nodes that triggers REDUCE_SPEED_BIAS on WARNING. */
const SPEED_DOMINANCE_THRESHOLD = 0.4;
/** Phase K2: minimum branch count difference to consider fork viable. */
const FORK_VIABLE_MIN_BRANCHES = 2;

/** Phase K4: maximum collapse events to retain in history. */
const MAX_COLLAPSE_HISTORY = 5;

// ── TTL helpers ──────────────────────────────────────────────────────────────

function computeTtlDaysRemaining(hint_score: number, recorded_at: string, now: Date): number | null {
  if (hint_score <= HINT_MIN_EFFECTIVE_SCORE) return null;
  const total_days = HINT_HALF_LIFE_DAYS * Math.log(hint_score / HINT_MIN_EFFECTIVE_SCORE);
  const elapsed_days = (now.getTime() - new Date(recorded_at).getTime()) / (1000 * 60 * 60 * 24);
  const remaining = total_days - elapsed_days;
  return remaining > 0 ? Math.floor(remaining) : null;
}

function computeBiomeTtlDaysRemaining(
  hint_score: number,
  biome_penalty: number,
  recorded_at: string,
  now: Date,
): number | null {
  const adjusted = hint_score * biome_penalty;
  if (adjusted <= HINT_MIN_EFFECTIVE_SCORE) return null;
  const total_days = HINT_HALF_LIFE_DAYS * Math.log(adjusted / HINT_MIN_EFFECTIVE_SCORE);
  const elapsed_days = (now.getTime() - new Date(recorded_at).getTime()) / (1000 * 60 * 60 * 24);
  const remaining = total_days - elapsed_days;
  return remaining > 0 ? Math.floor(remaining) : null;
}

// ── Biome helpers ────────────────────────────────────────────────────────────

function getPrimaryEnv(env_scores: AdaptationMemoryEnvScores, dedup_key: string): string | null {
  const bucket = env_scores[dedup_key];
  if (!bucket) return null;
  let best_env: string | null = null;
  let best_count = 0;
  for (const [env, data] of Object.entries(bucket)) {
    if (data.count > best_count) { best_count = data.count; best_env = env; }
  }
  return best_env;
}

function computeBiomePenalty(primary_env: string | null, current_env: string | undefined): number {
  if (!primary_env || !current_env) return 1.0;
  return primary_env === current_env ? 1.0 : BIOME_MISMATCH_MULTIPLIER;
}

// ── Phase I2: Biome mastery ───────────────────────────────────────────────────

/**
 * Compute per-environment mastery from the env_scores sidecar.
 * For each env: total_promotions = sum(count), avg = sum(total_hint_score)/total_promotions,
 * win_count = entries with avg_hint_score ≥ 0.5.
 */
function computeBiomeMastery(env_scores: AdaptationMemoryEnvScores): { [env: string]: BiomeMastery } {
  // Aggregate across all dedup_keys
  const agg = new Map<string, { total_score: number; total_count: number; win_count: number }>();
  for (const per_key of Object.values(env_scores)) {
    for (const [env, bucket] of Object.entries(per_key)) {
      const cur = agg.get(env) ?? { total_score: 0, total_count: 0, win_count: 0 };
      cur.total_count += bucket.count;
      cur.total_score += bucket.total_hint_score;
      // "win" = this dedup_key's average in this env ≥ 0.5
      if (bucket.count > 0 && bucket.total_hint_score / bucket.count >= 0.5) {
        cur.win_count += 1;
      }
      agg.set(env, cur);
    }
  }

  const result: { [env: string]: BiomeMastery } = {};
  for (const [env, data] of agg) {
    const avg_hint_score = data.total_count > 0
      ? parseFloat((data.total_score / data.total_count).toFixed(4))
      : 0;
    const win_rate = data.total_count > 0
      ? parseFloat((data.win_count / data.total_count).toFixed(4))
      : 0;
    let mastery_rank: BiomeMastery['mastery_rank'];
    if (data.total_count >= MASTERY_MASTER_MIN)     mastery_rank = 'MASTER';
    else if (data.total_count >= MASTERY_APPRENTICE_MIN) mastery_rank = 'APPRENTICE';
    else                                             mastery_rank = 'NOVICE';
    result[env] = {
      total_promotions: data.total_count,
      avg_hint_score,
      win_count:        data.win_count,
      win_rate,
      mastery_rank,
    };
  }
  return result;
}

// ── Phase I3: Selection pressure ─────────────────────────────────────────────

function computeSelectionPressure(
  effective_score: number,
  reuse_count: number,
  biome_penalty: number | null,
  biome_effective_score: number | null,
): SkillTreeNode['selection_pressure'] {
  // Prune: globally weak, or dead in current biome
  if (effective_score < PRUNE_SCORE_THRESHOLD) return 'PRUNE';
  if (biome_effective_score !== null && biome_effective_score < PRUNE_BIOME_THRESHOLD) return 'PRUNE';
  // Persist: strong score AND (reuse evidence OR native to current biome)
  if (effective_score >= PERSIST_SCORE_THRESHOLD && (reuse_count >= 1 || biome_penalty === 1.0)) {
    return 'PERSIST';
  }
  return 'NEUTRAL';
}

// ── Phase J2: Tech branch classification ──────────────────────────────────────

/**
 * Classify a partial node into an evolutionary technology branch.
 * Rules (checked in order, first match wins):
 *   RESILIENCE — environment_affinity spans 2+ distinct environments
 *   SPEED      — blast_radius is SELF  AND effective_score ≥ threshold
 *   STABILITY  — reuse_count ≥ 1      AND effective_score ≥ threshold
 *   GENERAL    — fallback
 */
function computeTechBranch(node: {
  blast_radius: string;
  reuse_count: number;
  effective_score: number;
  environment_affinity: Record<string, number>;
}): TechBranch {
  const env_count = Object.keys(node.environment_affinity).length;
  if (env_count >= 2) return 'RESILIENCE';
  if (node.blast_radius === 'SELF' && node.effective_score >= TECH_BRANCH_SCORE_MIN) return 'SPEED';
  if (node.reuse_count >= 1 && node.effective_score >= TECH_BRANCH_SCORE_MIN) return 'STABILITY';
  return 'GENERAL';
}

// ── Phase J1: Culture clustering ──────────────────────────────────────────────

/**
 * Group nodes into culture clusters by blast_radius faction.
 * Every blast_radius value with at least one member forms a cluster.
 */
function clusterCultures(nodes: SkillTreeNode[]): CultureCluster[] {
  const groups = new Map<string, SkillTreeNode[]>();
  for (const n of nodes) {
    const key = n.blast_radius;
    const arr = groups.get(key);
    if (arr) arr.push(n);
    else groups.set(key, [n]);
  }

  const clusters: CultureCluster[] = [];
  for (const [blast_radius, members] of groups) {
    const avg_effective_score =
      members.reduce((s, n) => s + n.effective_score, 0) / members.length;

    // Find dominant TechBranch within this cluster
    const branch_counts: Partial<Record<TechBranch, number>> = {};
    for (const n of members) {
      branch_counts[n.tech_branch] = (branch_counts[n.tech_branch] ?? 0) + 1;
    }
    let dominant_tech_branch: TechBranch = 'GENERAL';
    let max_count = 0;
    for (const [branch, count] of Object.entries(branch_counts) as [TechBranch, number][]) {
      if (count > max_count) { max_count = count; dominant_tech_branch = branch; }
    }

    clusters.push({
      cluster_id:           blast_radius,
      label:                CLUSTER_LABELS[blast_radius] ?? blast_radius,
      member_count:         members.length,
      avg_effective_score:  Math.round(avg_effective_score * 1000) / 1000,
      dominant_tech_branch,
    });
  }

  // Sort: largest cluster first
  clusters.sort((a, b) => b.member_count - a.member_count);
  return clusters;
}

// ── Phase J3 + J4: Civilization summary ──────────────────────────────────────

/**
 * Compute civilization-level health and collapse risk.
 *
 * civilization_health_score = avg(effective_score) × (1 − prune_fraction)
 *   CRITICAL < 0.20,  WARNING < 0.40,  SAFE ≥ 0.40
 */
function computeCivSummary(nodes: SkillTreeNode[]): CivSummary {
  if (nodes.length === 0) {
    return {
      civilization_health_score: 0,
      collapse_risk:             'CRITICAL',
      dominant_strategy:         null,
      culture_clusters:          [],
      tech_branch_distribution:  {},
      tech_branch_counts:        {},
    };
  }

  const avg_score      = nodes.reduce((s, n) => s + n.effective_score, 0) / nodes.length;
  const prune_count    = nodes.filter((n) => n.selection_pressure === 'PRUNE').length;
  const prune_fraction = prune_count / nodes.length;
  const health         = Math.round(avg_score * (1 - prune_fraction) * 1000) / 1000;

  let collapse_risk: CollapseRisk;
  if (health < COLLAPSE_RISK_CRITICAL_THRESHOLD)      collapse_risk = 'CRITICAL';
  else if (health < COLLAPSE_RISK_WARNING_THRESHOLD)  collapse_risk = 'WARNING';
  else                                                collapse_risk = 'SAFE';

  // Dominant strategy: node with is_dominant=true and highest effective_score
  const dominant_node = nodes
    .filter((n) => n.is_dominant)
    .sort((a, b) => b.effective_score - a.effective_score)[0] ?? null;
  const dominant_strategy = dominant_node
    ? {
        dedup_key:      dominant_node.dedup_key,
        title:          dominant_node.title,
        target:         dominant_node.target,
        effective_score: dominant_node.effective_score,
      }
    : null;

  // Tech branch distribution (fraction) + counts
  const branch_counts: Partial<Record<TechBranch, number>> = {};
  for (const n of nodes) {
    branch_counts[n.tech_branch] = (branch_counts[n.tech_branch] ?? 0) + 1;
  }
  const tech_branch_distribution: Partial<Record<TechBranch, number>> = {};
  for (const [branch, count] of Object.entries(branch_counts) as [TechBranch, number][]) {
    tech_branch_distribution[branch] = Math.round((count / nodes.length) * 1000) / 1000;
  }

  const culture_clusters = clusterCultures(nodes);

  return {
    civilization_health_score: health,
    collapse_risk,
    dominant_strategy,
    culture_clusters,
    tech_branch_distribution,
    tech_branch_counts: branch_counts,
  };
}

// ── Phase K1: Governed Intervention ──────────────────────────────────────────

/**
 * Determine whether the OS should intervene and what actions to recommend.
 *
 * Rules:
 *   SAFE     → no intervention
 *   WARNING  → check SPEED dominance; push toward RESILIENCE
 *   CRITICAL → emergency actions (PRUNE_UNSTABLE + EMERGENCY_REBUILD)
 */
function computeCivIntervention(
  nodes: SkillTreeNode[],
  civ_summary: CivSummary,
  computed_at: string,
): CivIntervention {
  const { collapse_risk, tech_branch_counts } = civ_summary;

  if (collapse_risk === 'SAFE') {
    return {
      triggered:            false,
      trigger_reason:       null,
      actions:              [],
      target_branch_shift:  null,
      affected_node_count:  0,
      computed_at,
    };
  }

  if (collapse_risk === 'CRITICAL') {
    const prune_count = nodes.filter((n) => n.selection_pressure === 'PRUNE').length;
    return {
      triggered:            true,
      trigger_reason:       'CRITICAL_THRESHOLD',
      actions:              ['PRUNE_UNSTABLE', 'EMERGENCY_REBUILD'],
      target_branch_shift:  { from: 'SPEED', to: 'RESILIENCE' },
      affected_node_count:  prune_count,
      computed_at,
    };
  }

  // WARNING path
  const total       = nodes.length;
  const speed_count = tech_branch_counts['SPEED'] ?? 0;
  const speed_ratio = total > 0 ? speed_count / total : 0;

  const actions: InterventionAction[] = ['BOOST_RESILIENCE'];
  let target_branch_shift: CivIntervention['target_branch_shift'] = null;
  let affected = 0;

  if (speed_ratio >= SPEED_DOMINANCE_THRESHOLD) {
    actions.push('REDUCE_SPEED_BIAS');
    target_branch_shift = { from: 'SPEED', to: 'RESILIENCE' };
    affected = speed_count;
  }

  return {
    triggered:            true,
    trigger_reason:       'WARNING_THRESHOLD',
    actions,
    target_branch_shift,
    affected_node_count:  affected,
    computed_at,
  };
}

// ── Phase K2: Civilization Fork Projection ────────────────────────────────────

/**
 * For each TechBranch with ≥ 1 supporting node, project what the civilization
 * health would be if only that branch's nodes were retained.
 *
 * projected_health = avg(branch_effective_scores) × (1 − branch_prune_fraction)
 */
function computeCivFork(nodes: SkillTreeNode[]): CivFork {
  const all_branches: TechBranch[] = ['SPEED', 'STABILITY', 'RESILIENCE', 'GENERAL'];
  const branches: CivForkBranch[] = [];

  for (const branch of all_branches) {
    const members = nodes.filter((n) => n.tech_branch === branch);
    if (members.length === 0) continue;

    const avg_score   = members.reduce((s, n) => s + n.effective_score, 0) / members.length;
    const prune_frac  = members.filter((n) => n.selection_pressure === 'PRUNE').length / members.length;
    const proj_health = Math.round(avg_score * (1 - prune_frac) * 1000) / 1000;

    let projected_collapse_risk: CollapseRisk;
    if (proj_health < 0.20)      projected_collapse_risk = 'CRITICAL';
    else if (proj_health < 0.40) projected_collapse_risk = 'WARNING';
    else                         projected_collapse_risk = 'SAFE';

    branches.push({
      target_tech_branch:      branch,
      projected_health:        proj_health,
      projected_collapse_risk,
      supporting_node_count:   members.length,
    });
  }

  // Sort by projected_health DESC
  branches.sort((a, b) => b.projected_health - a.projected_health);

  // Fork is viable when ≥2 branches exist with distinct projected_collapse_risk values
  const distinct_risks = new Set(branches.map((b) => b.projected_collapse_risk)).size;
  const fork_viable    = branches.length >= FORK_VIABLE_MIN_BRANCHES && distinct_risks >= 2;

  const recommended_branch = branches.length > 0 ? branches[0].target_tech_branch : null;

  return { fork_viable, branches, recommended_branch };
}

// ── Phase K3: Multi-Civilization Competition ──────────────────────────────────

/**
 * Run all TechBranch civilizations head-to-head using fork projections.
 * Ranks them by projected_health and assigns competitive status.
 */
function computeMultiCiv(fork: CivFork, computed_at: string): MultiCivReport {
  if (fork.branches.length === 0) {
    return {
      runs:               [],
      dominant_branch:    null,
      eliminated:         [],
      competition_active: false,
      computed_at,
    };
  }

  const runs: MultiCivRun[] = fork.branches.map((b, idx) => {
    let status: MultiCivStatus;
    if (b.projected_collapse_risk === 'CRITICAL') {
      status = 'ELIMINATED';
    } else if (idx === 0 && b.projected_collapse_risk === 'SAFE') {
      status = 'DOMINANT';
    } else {
      status = 'COMPETING';
    }
    return {
      branch:                  b.target_tech_branch,
      projected_health:        b.projected_health,
      projected_collapse_risk: b.projected_collapse_risk,
      node_count:              b.supporting_node_count,
      rank:                    idx + 1,
      status,
    };
  });

  const dominant_branch = runs[0]?.status === 'DOMINANT' ? runs[0].branch : null;
  const eliminated      = runs.filter((r) => r.status === 'ELIMINATED').map((r) => r.branch);
  const safe_count      = runs.filter((r) => r.projected_collapse_risk === 'SAFE').length;
  const competition_active = safe_count >= 2;

  return { runs, dominant_branch, eliminated, competition_active, computed_at };
}

// ── Phase K4: Civilization Generation (collapse & rebuild) ────────────────────

/** Serialized shape written to civ_generation.json sidecar. */
interface CivGenerationSidecar {
  current_generation: number;
  total_collapses:    number;
  collapse_history:   CollapseEvent[];
}

function loadCivGeneration(gen_path: string): CivGenerationSidecar {
  if (!fs.existsSync(gen_path)) {
    return { current_generation: 1, total_collapses: 0, collapse_history: [] };
  }
  return JSON.parse(fs.readFileSync(gen_path, 'utf8')) as CivGenerationSidecar;
}

function saveCivGeneration(sidecar: CivGenerationSidecar, gen_path: string): void {
  const dir = path.dirname(gen_path);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(gen_path, JSON.stringify(sidecar, null, 2) + '\n', 'utf8');
}

/**
 * Detect whether a collapse occurs this cycle.
 * If collapse_risk === 'CRITICAL': increment generation, record event, persist.
 * Memory entries (JSONL) are never deleted — only the structural restart is noted.
 */
function computeCivGeneration(
  nodes: SkillTreeNode[],
  civ_summary: CivSummary,
  gen_path: string,
  computed_at: string,
): CivGeneration {
  const sidecar = loadCivGeneration(gen_path);
  const is_collapsing = civ_summary.collapse_risk === 'CRITICAL';

  if (is_collapsing) {
    const prune_count = nodes.filter((n) => n.selection_pressure === 'PRUNE').length;
    const event: CollapseEvent = {
      generation:        sidecar.current_generation,
      collapsed_at:      computed_at,
      reason:            'CRITICAL_HEALTH',
      nodes_pruned:      prune_count,
      health_at_collapse: civ_summary.civilization_health_score,
    };
    sidecar.current_generation += 1;
    sidecar.total_collapses    += 1;
    sidecar.collapse_history.push(event);
    // Keep last MAX_COLLAPSE_HISTORY events
    if (sidecar.collapse_history.length > MAX_COLLAPSE_HISTORY) {
      sidecar.collapse_history = sidecar.collapse_history.slice(-MAX_COLLAPSE_HISTORY);
    }
    saveCivGeneration(sidecar, gen_path);
  }

  return {
    current_generation:     sidecar.current_generation,
    total_collapses:        sidecar.total_collapses,
    is_collapsing_this_cycle: is_collapsing,
    collapse_history:       sidecar.collapse_history,
  };
}

// ── Phase I4: Dominance map ───────────────────────────────────────────────────

/**
 * For each target file, determine which node is dominant:
 * highest biome_effective_score (when available) or effective_score.
 * Returns a Set of dominant dedup_keys.
 */
function computeDominantKeys(
  nodes: Array<{
    dedup_key: string;
    target: string;
    effective_score: number;
    biome_effective_score: number | null;
  }>,
): Set<string> {
  const by_target = new Map<string, { dedup_key: string; score: number }>();
  for (const n of nodes) {
    const score = n.biome_effective_score ?? n.effective_score;
    const cur = by_target.get(n.target);
    if (!cur || score > cur.score) {
      by_target.set(n.target, { dedup_key: n.dedup_key, score });
    }
  }
  const dominant = new Set<string>();
  for (const { dedup_key } of by_target.values()) dominant.add(dedup_key);
  return dominant;
}

// ── Phase H2 + I1: Skill synthesis ───────────────────────────────────────────

/**
 * Synthesize MetaSkills:
 * Level-1: pairs of active nodes on the same target (Phase H2).
 * Level-2: pairs of level-1 MetaSkills (Phase I1 — meta-of-meta).
 */
function synthesizeSkills(nodes: SkillTreeNode[]): MetaSkill[] {
  // --- Level 1 ---
  const by_target = new Map<string, SkillTreeNode[]>();
  for (const node of nodes) {
    if (node.effective_score < SKILL_SYNTHESIS_MIN_SCORE) continue;
    const list = by_target.get(node.target) ?? [];
    list.push(node);
    by_target.set(node.target, list);
  }

  const l1_candidates: MetaSkill[] = [];
  for (const [target, group] of by_target) {
    if (group.length < 2) continue;
    const g = [...group].sort((a, b) => b.effective_score - a.effective_score);
    const a = g[0]; const b = g[1];
    const synergy_score = parseFloat(
      ((a.effective_score + b.effective_score) / 2 * SKILL_SYNERGY_BONUS).toFixed(4),
    );
    const file = target.split('/').pop() ?? target;
    l1_candidates.push({
      synthesis_key: [a.dedup_key, b.dedup_key].sort().join('||'),
      title:         `[合成] ${file}: ${a.title.slice(0, 22)} × ${b.title.slice(0, 22)}`,
      target,
      synergy_score,
      component_a:   { dedup_key: a.dedup_key, title: a.title, hint_score: a.hint_score },
      component_b:   { dedup_key: b.dedup_key, title: b.title, hint_score: b.hint_score },
      level:         1,
    });
  }

  const top_l1 = l1_candidates
    .sort((a, b) => b.synergy_score - a.synergy_score)
    .slice(0, SKILL_SYNTHESIS_MAX_COUNT_L1);

  // --- Level 2: requires ≥ 2 level-1 MetaSkills ---
  const l2_candidates: MetaSkill[] = [];
  if (top_l1.length >= 2) {
    // Try top pairs of l1 MetaSkills
    for (let i = 0; i < top_l1.length - 1; i++) {
      for (let j = i + 1; j < top_l1.length; j++) {
        const m1 = top_l1[i]; const m2 = top_l1[j];
        const synergy_score = parseFloat(
          ((m1.synergy_score + m2.synergy_score) / 2 * SKILL_SYNERGY_BONUS).toFixed(4),
        );
        // dominant target = whichever MetaSkill has higher synergy
        const dom = m1.synergy_score >= m2.synergy_score ? m1 : m2;
        l2_candidates.push({
          synthesis_key: [m1.synthesis_key, m2.synthesis_key].sort().join('||'),
          title:         `[超合成]: ${m1.title.slice(5, 27)} × ${m2.title.slice(5, 27)}`,
          target:        dom.target,
          synergy_score,
          component_a:   { dedup_key: m1.synthesis_key, title: m1.title, hint_score: m1.synergy_score },
          component_b:   { dedup_key: m2.synthesis_key, title: m2.title, hint_score: m2.synergy_score },
          level:         2,
        });
      }
    }
  }

  const top_l2 = l2_candidates
    .sort((a, b) => b.synergy_score - a.synergy_score)
    .slice(0, SKILL_SYNTHESIS_MAX_COUNT_L2);

  return [...top_l1, ...top_l2];
}

// ── Phase H3: Death log ───────────────────────────────────────────────────────

function buildExpiredLog(
  expired_entries: Array<{ entry: AdaptationMemoryEntry; effective_score: number }>,
  active_nodes: SkillTreeNode[],
  now: Date,
): ExpiredSkillEntry[] {
  const biome_dead: ExpiredSkillEntry[] = active_nodes
    .filter((n) => n.biome_effective_score !== null && n.biome_effective_score < HINT_MIN_EFFECTIVE_SCORE)
    .map((n): ExpiredSkillEntry => ({
      dedup_key:       n.dedup_key,
      title:           n.title,
      target:          n.target,
      last_hint_score: n.hint_score,
      expired_reason:  'biome_mismatch',
      detected_at:     now.toISOString(),
    }));

  const ttl_dead: ExpiredSkillEntry[] = [...expired_entries]
    .sort((a, b) => b.entry.recorded_at.localeCompare(a.entry.recorded_at))
    .slice(0, RECENTLY_EXPIRED_MAX)
    .map(({ entry: e }): ExpiredSkillEntry => ({
      dedup_key:       e.dedup_key,
      title:           e.title.slice(0, 60),
      target:          e.affected_targets[0] ?? '(unknown)',
      last_hint_score: e.hint_score ?? 0,
      expired_reason:  'ttl_decay',
      detected_at:     now.toISOString(),
    }));

  return [...biome_dead, ...ttl_dead].slice(0, RECENTLY_EXPIRED_MAX);
}

// ── Main builder ──────────────────────────────────────────────────────────────

/**
 * Build the full Skill Tree report (Phase G + H + I).
 *
 * Reads:
 *   - adaptation_memory.jsonl
 *   - adaptation_memory_env_scores.json
 *   - adaptation_memory_reuse_stats.json
 */
export function buildSkillTree(
  file_path: string,
  options: { now?: Date; current_environment_status?: string } = {},
): SkillTreeReport {
  const now = options.now ?? new Date();
  const computed_at = now.toISOString();
  const current_env = options.current_environment_status;

  const all_entries = loadRecentAdaptationMemory(file_path, 200);

  const env_scores_path  = file_path.replace(/\.jsonl$/, '_env_scores.json');
  const reuse_stats_path = file_path.replace(/\.jsonl$/, '_reuse_stats.json');
  const gen_path         = file_path.replace(/\.jsonl$/, '_civ_generation.json');
  const env_scores  = loadEnvScores(env_scores_path);
  const reuse_stats = loadReuseStats(reuse_stats_path);

  const with_eff = all_entries.map((e) => ({
    entry: e,
    effective_score: computeEffectiveScore(e.hint_score ?? 0, e.recorded_at, now),
  }));

  const active      = with_eff.filter((x) => x.effective_score >= HINT_MIN_EFFECTIVE_SCORE);
  const expired_raw = with_eff.filter((x) => x.effective_score < HINT_MIN_EFFECTIVE_SCORE);

  const sorted = [...active].sort((a, b) => {
    const diff = b.effective_score - a.effective_score;
    if (Math.abs(diff) > 0.0001) return diff;
    return b.entry.recorded_at.localeCompare(a.entry.recorded_at);
  });

  // First pass: build partial nodes (without selection_pressure + is_dominant)
  type PartialNode = Omit<SkillTreeNode, 'selection_pressure' | 'is_dominant' | 'tech_branch'>;
  const partial_nodes: PartialNode[] = sorted.slice(0, SKILL_TREE_MAX_NODES).map(({ entry: e, effective_score }) => {
    const hint_score = e.hint_score ?? 0;
    const ttl_days_remaining = computeTtlDaysRemaining(hint_score, e.recorded_at, now);

    const env_bucket_map = env_scores[e.dedup_key] ?? {};
    const environment_affinity: { [env: string]: number } = {};
    for (const [env, bucket] of Object.entries(env_bucket_map)) {
      if (bucket.count > 0) {
        environment_affinity[env] = parseFloat((bucket.total_hint_score / bucket.count).toFixed(4));
      }
    }

    const primary_env   = getPrimaryEnv(env_scores, e.dedup_key);
    const biome_penalty = current_env !== undefined
      ? computeBiomePenalty(primary_env, current_env)
      : null;
    const biome_effective_score = biome_penalty !== null
      ? parseFloat((effective_score * biome_penalty).toFixed(4))
      : null;
    const biome_ttl_days_remaining: number | null = biome_penalty !== null
      ? (biome_penalty < 1.0
        ? computeBiomeTtlDaysRemaining(hint_score, biome_penalty, e.recorded_at, now)
        : ttl_days_remaining)
      : null;

    const reuse_count = reuse_stats[e.dedup_key]?.reused_count ?? 0;

    return {
      dedup_key:               e.dedup_key,
      title:                   e.title.slice(0, 60),
      target:                  e.affected_targets[0] ?? '(unknown)',
      hint_score:              parseFloat(hint_score.toFixed(4)),
      effective_score:         parseFloat(effective_score.toFixed(4)),
      ttl_days_remaining,
      environment_affinity,
      reuse_count,
      blast_radius:            e.estimated_blast_radius as string,
      recorded_at:             e.recorded_at,
      patch_source:            e.patch_source as string,
      biome_penalty,
      biome_effective_score,
      biome_ttl_days_remaining,
    };
  });

  // Phase I4: compute dominance (needs biome_effective_score from first pass)
  const dominant_keys = computeDominantKeys(partial_nodes);

  // Second pass: add selection_pressure + is_dominant + tech_branch (Phase J2)
  const nodes: SkillTreeNode[] = partial_nodes.map((n) => ({
    ...n,
    selection_pressure: computeSelectionPressure(
      n.effective_score, n.reuse_count, n.biome_penalty, n.biome_effective_score,
    ),
    is_dominant: dominant_keys.has(n.dedup_key),
    tech_branch: computeTechBranch(n),
  }));

  // Phase H2+I1: synthesis
  const synthesized_skills = synthesizeSkills(nodes);

  // Phase H3: death log
  const recently_expired = buildExpiredLog(expired_raw, nodes, now);

  // Phase I2: biome mastery
  const biome_mastery = computeBiomeMastery(env_scores);

  // Phase J4: civilization summary
  const civ_summary = computeCivSummary(nodes);

  // Phase K1: governed intervention
  const civ_intervention = computeCivIntervention(nodes, civ_summary, computed_at);

  // Phase K2: fork projection
  const civ_fork = computeCivFork(nodes);

  // Phase K3: multi-civilization competition
  const multi_civ = computeMultiCiv(civ_fork, computed_at);

  // Phase K4: civilization generation
  const civ_generation = computeCivGeneration(nodes, civ_summary, gen_path, computed_at);

  return {
    active_count:        active.length,
    expired_count:       expired_raw.length,
    nodes,
    synthesized_skills,
    recently_expired,
    current_environment: current_env ?? null,
    biome_mastery,
    civ_summary,
    civ_intervention,
    civ_fork,
    multi_civ,
    civ_generation,
    computed_at,
  };
}