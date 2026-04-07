# Governance Metrics Definition
**Schema Version:** `metrics_def/0.1`  
**Status:** FROZEN — Phase A candidate generation depends on this document  
**Frozen at:** 2026-04-06  
**Prerequisite for:** Phase A (`candidate_patch_list` generation), Tier/Guardian display aggregation rules

---

## Purpose

This document is the **single source of truth** for every measurable quantity that the Antigravity OS governance kernel observes, accumulates, and reports. All downstream components — Phase A candidate generator, nightly evolution loop, Guardian/Proof morning report, and `tier_policy` transitions — MUST read their value definitions exclusively from here. No component may silently redefine a metric.

> **Why freeze this first?** Phase A's candidate generator must know *what counts as improvement* and *what counts as danger* before selecting hypotheses. If definitions drift inside prompts, the observation layer and the reporting layer will diverge, producing the "単発実行体への逆戻り" failure.

---

## 1. `stability_index` — 安全成功率

### Definition

A scalar in **[0.0, 1.0]** representing the fraction of the nightly loop that was completed *safely* — not merely successfully.

```
stability_index =
    0.40 × invariant_pass_ratio
  + 0.30 × no_regression_pass_ratio
  + 0.20 × replay_success_ratio
  + 0.10 × quarantine_adjusted_safety_factor
```

### Component Definitions

| Component | Formula | Edge case |
|---|---|---|
| `invariant_pass_ratio` | `invariants_passed / invariants_evaluated` (INV-001..INV-010) | 0 evaluated → 0.0 (counts as unsafe) |
| `no_regression_pass_ratio` | `regression_tests_passed / regression_tests_run` | Suite must contain ≥1 `@regression` tag; 0 tests → 0.0 |
| `replay_success_ratio` | `successful_ledger_replays / attempted_ledger_replays` | 0 attempts (no patches in cycle) → 1.0 |
| `quarantine_adjusted_safety_factor` | `1 - (quarantined_patch_count / max(1, patches_evaluated_count))` | No patches → 1.0 |

### Precision & Storage
- Round to 4 decimal places before storage.
- Stored per cycle in the state ledger under key `metrics.stability_index`.

### Tier Thresholds (informative — normative definition in §7)
| Range | Interpretation |
|---|---|
| ≥ 0.90 | Eligible for STABLE / BREAKTHROUGH evaluation |
| ≥ 0.80 | Eligible for GROWING evaluation |
| < 0.80 | CRITICAL — cycle fails Guardian gate |

---

## 2. `saved_time_minutes` — 節約時間（分）

### Definition

Total human-equivalent minutes saved by promoted patches across all eligible workflows in the current cycle. This is a **measurement-condition-attached difference**, not an estimate.

```
saved_time_minutes =
    Σ_w [  (baseline_median_ms[w] - post_patch_median_ms[w])
          / 60 000
          × confidence_weight[w]
       ]
```

### Eligibility Gate (per workflow `w`)
A workflow is **eligible** only if ALL of the following hold:
- `baseline_run_count[w] >= 5` (sufficient pre-patch baseline)
- `post_patch_run_count[w] >= 3` (sufficient post-promotion observations)
- `|improvement_ratio[w]| >= 0.01` (noise floor: ignore < 1% delta)

### Component Definitions

| Symbol | Meaning |
|---|---|
| `baseline_median_ms[w]` | Median wall-clock ms over the 5 most recent runs **before** patch application |
| `post_patch_median_ms[w]` | Median wall-clock ms over the first `post_patch_run_count[w]` runs **after** patch promotion |
| `confidence_weight[w]` | `min(baseline_run_count[w], post_patch_run_count[w]) / 5`, capped at 1.0 |

### Sign Convention
- Positive → time saved (improvement)
- Negative → regression; allowed but triggers a `REGRESSION_ALERT` in Proof summary
- Minimum value: `-9999.0` (prevents unbounded negative from dominating other metrics)

---

## 3. `tokens_saved` — トークン節約数

### Definition

Total LLM tokens (prompt + completion) saved per cycle relative to baseline across eligible workflows.

```
tokens_saved =
    Σ_w [  (baseline_mean_tokens[w] - post_patch_mean_tokens[w])
          × eligible_weight[w]
       ]
```

### Component Definitions

| Symbol | Meaning |
|---|---|
| `baseline_mean_tokens[w]` | `mean(input_tokens + output_tokens)` over N≥5 baseline runs |
| `post_patch_mean_tokens[w]` | `mean(input_tokens + output_tokens)` over N≥3 post-patch runs |
| `eligible_weight[w]` | `1.0` if `(baseline - post_patch) / baseline >= 0.02`; otherwise `0` (2% noise floor) |

### Token Source
- Count `prompt_tokens + completion_tokens` as reported by the API response object.
- Do NOT include cached tokens unless the cache miss rate is also tracked.

---

## 4. `bugs_killed` — バグ駆逐数

### Definition

Count of regression tests that transitioned from FAIL → PASS after patch promotion and remained stable.

```
bugs_killed = |{
    t : t in regression_test_set
      AND status_before(t) = FAIL
      AND status_after(t)  = PASS
      AND NOT reverted(patch_of(t), within=72h)
}|
```

### What Qualifies as `regression_test_set`
A test `t` is in the regression test set if:
- It carries the `@regression` decorator/tag, OR
- It has a `linked_incident` field pointing to a non-null entry in `incident_registry`

### What `reverted` Means
`reverted(patch, within=72h)` is `true` if the patch was rolled back within 72 hours of promotion timestamp.

### What Does NOT Count
- Tests that were already PASS before the patch (no transition)
- Tests that pass then fail then pass (flaky; excluded)
- New tests added by the patch itself (no pre-patch FAIL record)

---

## 5. `refined_code_lines` — コード精製行数

### Definition

Count of source lines eliminated through genuine simplification — not through feature removal or auto-deletion.

```
refined_code_lines =
    Σ_f [ max(0, lines_before(f) - lines_after(f)) ]
    for each function f where:
        (a) f exists both before and after the patch
        (b) cyclomatic_complexity_delta(f) <= 0
```

### Exclusions (do NOT count these lines)
- Blank lines
- Comment-only lines (`//`, `#`, `*`, etc.)
- Auto-generated sections marked `// @generated` or `# auto-generated`
- Lines in deleted functions (feature removal, not simplification)

### Precision Note
- Count at the **function granularity** only. File-level diffs are not used.
- A function that grows in lines but decreases in complexity contributes `0` (not negative).

---

## 6. `blocked_risky_actions` — ブロックされた危険行動

### Definition

Count of **explicit block events** — actions that were prevented from executing by a governance gate. This is the OS's primary safety visibility metric.

### Countable Events (exhaustive list)

| Event Code | Trigger Condition | When Counted |
|---|---|---|
| `INV_VIOLATION_REJECT` | Any INV-001..INV-010 check returns `false` **before** execution | At the moment of rejecting the candidate |
| `PROMOTION_GATE_FAIL` | Patch fails promotion gate criteria (e.g., `stability_index` below threshold) | At promotion gate evaluation |
| `BLAST_RADIUS_QUARANTINE` | `blast_radius > allowed_level` for the current `risk_level` → quarantine | At quarantine placement |
| `HUMAN_REVIEW_DEFER` | `risk_level = 'critical'` → action deferred to mandatory human review | At deferral decision, NOT at resolution |

### NOT Counted (critical negative list)
- `HOLD` states pending review (not a block; a pause)
- Normal test failures without an explicit governance block decision
- Informational `WARN`-severity health alerts
- Review queue items awaiting approval
- Phase14 pipeline operational incidents (tracked separately in `WeeklyGovernanceMetrics`)

### Storage
Per-cycle, store as:
```json
{
  "count": 2,
  "events": [
    { "event_code": "INV_VIOLATION_REJECT", "invariant_id": "INV-003_NO_WRITE_EXECUTE_WITHOUT_APPROVAL", "ts": "..." },
    { "event_code": "PROMOTION_GATE_FAIL", "patch_id": "...", "reason": "stability_index=0.78", "ts": "..." }
  ]
}
```

---

## 7. `tier_policy` — ティア判定規則

### Tier Definitions

All conditions within a tier MUST be satisfied simultaneously. Tier is determined once per cycle during the Guardian/Proof morning report generation.

#### STABLE
```
stability_index >= 0.90
AND invariant_failure_count = 0
AND blocked_risky_actions.count_in_cycle = 0
AND saved_time_minutes >= 0.0
```

#### GROWING
```
stability_index >= 0.80
AND verified_patch_count >= 1  (this cycle)
AND promoted_skill_count >= 1  (cumulative total, all cycles)
AND (bugs_killed > 0 OR saved_time_minutes > 0.0)
```

#### BREAKTHROUGH
```
stability_index >= 0.85  (sustained over >= 2 consecutive cycles)
AND unlocked_node_count >= 1  (new capability node activated this cycle)
AND saved_time_minutes >= 5.0  (this cycle)
AND verified_patch_count >= 3  (this cycle)
AND blocked_risky_actions.count_in_cycle = 0
```

### Tier Transition Rules
- `BREAKTHROUGH` can only be reached FROM `GROWING` or `STABLE`. Not from a tier-less or failed prior cycle.
- A cycle with `stability_index < 0.80` results in tier `null` (CRITICAL — no tier awarded).
- No tier downgrades skip levels: `BREAKTHROUGH → STABLE` is legal; `BREAKTHROUGH → null` requires explicit CRITICAL signal.

### Reference Metrics Set (complete list used by `tier_policy`)
```
verified_patch_count
promoted_skill_count
unlocked_node_count
saved_time_minutes
blocked_risky_actions.count_in_cycle
invariant_failure_count
stability_index
bugs_killed
```

---

## 8. Proof Summary Format — 朝の安全証明サマリー形式

### Schema Version: `proof_summary/0.1`

The Guardian/Proof morning report MUST include all fields in the following structure. Fields MUST be populated from the metrics defined in §1–§7 above. No field may be populated from free-text estimates.

```json
{
  "schema_version": "proof_summary/0.1",
  "cycle_id": "<uuid>",
  "generated_at": "<ISO-8601 UTC>",
  "legitimacy_tier": "L0 | L1 | L2",
  "tier": "STABLE | GROWING | BREAKTHROUGH | null",
  "tier_delta": "+1 | -1 | 0",
  "stability_index": {
    "score": 0.9312,
    "invariant_pass_ratio": 1.0,
    "no_regression_pass_ratio": 0.95,
    "replay_success_ratio": 1.0,
    "quarantine_adjusted_safety_factor": 0.85
  },
  "saved_time_minutes": {
    "total": 7.4,
    "top_workflows": [
      { "workflow_id": "<id>", "saved_minutes": 3.2, "confidence_weight": 1.0 }
    ],
    "regression_alerts": []
  },
  "tokens_saved": 1420,
  "bugs_killed": 2,
  "refined_code_lines": 84,
  "blocked_risky_actions": {
    "count": 1,
    "events": [
      {
        "event_code": "INV_VIOLATION_REJECT",
        "invariant_id": "INV-003_NO_WRITE_EXECUTE_WITHOUT_APPROVAL",
        "ts": "<ISO-8601 UTC>"
      }
    ]
  },
  "invariant_failure_count": 0,
  "verified_patch_count": 2,
  "promoted_skill_count": 3,
  "unlocked_node_count": 0,
  "next_cycle_recommendations": [
    { "priority": 1, "description": "<actionable recommendation from Phase A>" }
  ]
}
```

### Validation Gate
The Proof summary MUST pass schema validation against `contract/self_evolution_metrics.d.ts` before being accepted into the ledger. A Proof that fails schema validation is treated as `tier = null`.

---

## Appendix A: Task State Machine — タスク状態機械

Agent state is stored in the ledger (NOT in memory/context) and loaded first on restart.

| Status Code | Meaning | Legal Next States |
|---|---|---|
| `OBSERVING` | Reading codebase, logs, and current metrics; building world-state snapshot | `HYPOTHESIZING` |
| `HYPOTHESIZING` | Generating candidate patch list (Phase A output) | `TESTING`, `OBSERVING` (if no candidates) |
| `TESTING` | Running candidate in sandbox; evaluating against invariants and metrics | `PROMOTING`, `OBSERVING` (if all candidates fail) |
| `PROMOTING` | Patch passed testing; pending promotion gate and Guardian approval | `OBSERVING` (after promote or reject) |

**Restart behavior:** On any restart, agent reads `task_state_machine.status` from the ledger FIRST. It resumes from the recovered status — it does NOT ask "何からやろうかな".

---

## Appendix B: Failure Constitution — 失敗憲法

Patterns confirmed in a cycle are appended to `failure_ledger` as **Negative Constraints** — injected into Phase A prompt at the highest-priority layer in the next cycle.

| Pattern Code | Detection Signal | Ledger Entry |
|---|---|---|
| `F-001_SECURITY_DOWNGRADE` | `INV_VIOLATION_REJECT` with INV-003 or INV-005 | "Never remove or weaken approval checks" |
| `F-002_DEPENDENCY_IGNORE_DELETE` | `bugs_killed` newly negative + `refined_code_lines` > 0 | "Never delete a function whose callers were not updated" |
| `F-003_CONTEXT_REGRESSION` | Same invariant violation repeats within 3 consecutive cycles | "Pattern X was violated N cycles ago — do not repeat this change" |
| `F-004_METRIC_INFLATION` | `saved_time_minutes` > 3× previous cycle without proportional `eligible_workflow_count` increase | "Do not claim time savings without measurement conditions" |

**Usage in Phase A:** Any candidate that would trigger a listed Negative Constraint is INVALID regardless of its other scores.

---

*This document is FROZEN for Phase A entry. Amendments require bumping schema version to `metrics_def/0.2` and updating the frozen-at timestamp.*
