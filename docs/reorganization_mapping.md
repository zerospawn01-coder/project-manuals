# Reorganization Mapping (scratch -> purpose-specific repos)

## Scope

This mapping operationalizes the current split strategy for `scratch` into purpose-specific repositories.

Primary target set:

- `cognitive-lab`
- `ea-aol`
- `mtp-weaver`
- `lab-experiments`
- `project-manuals`

## Canonical Source -> Destination Mapping

### Main successor

- `post_alignment_lab/` -> `cognitive-lab/post_alignment_lab/`
- `intuition-layer/` -> `cognitive-lab/intuition-layer/`
- `analyze_leap.py` -> `cognitive-lab/leap_analysis/analyze_leap.py`
- `run_leap_analysis.py` -> `cognitive-lab/leap_analysis/run_leap_analysis.py`
- `leap_analysis_core.py` -> `cognitive-lab/leap_analysis/leap_analysis_core.py`
- `test_leap_analysis.py` -> `cognitive-lab/leap_analysis/test_leap_analysis.py`
- `LEAP_ANALYSIS_README.md` -> `cognitive-lab/leap_analysis/README.md`
- `CI_CD_SETUP.md` -> `cognitive-lab/CI_CD_SETUP.md`

### Independent repos

- `ea-aol/` -> `ea-aol/` (history-preserving split)
- `mtp_weaver/` -> `mtp-weaver/` (history-preserving split)

### Shared experiments

- `jepa_intuition_poc/` -> `lab-experiments/jepa_intuition_poc/`
- `geodesic_descent/` -> `lab-experiments/geodesic_descent/`
- `personal_ai/` -> `lab-experiments/personal_ai/`

### Documentation/support repo

- `project_manuals/` -> `project-manuals/`

### Reports to keep in active docs

- `CODE_QUALITY_REVIEW.md` -> `cognitive-lab/docs/reports/CODE_QUALITY_REVIEW.md`
- `CRITICAL_EVALUATION_REPORT.md` -> `cognitive-lab/docs/reports/CRITICAL_EVALUATION_REPORT.md`
- `FINAL_UNIT_TEST_REPORT.md` -> `cognitive-lab/docs/reports/FINAL_UNIT_TEST_REPORT.md`
- `UNIT_TEST_IMPLEMENTATION_REPORT.md` -> `cognitive-lab/docs/reports/UNIT_TEST_IMPLEMENTATION_REPORT.md`
- `PUBLICATION_READINESS_REPORT.md` -> `cognitive-lab/docs/reports/PUBLICATION_READINESS_REPORT.md`

### Reports likely archival

- `FINAL_WORK_SUMMARY.md` -> `cognitive-lab/docs/archive/FINAL_WORK_SUMMARY.md` or archive repo
- `TODAY_WORK_SUMMARY.md` -> `cognitive-lab/docs/archive/TODAY_WORK_SUMMARY.md` or archive repo

## Deferred / Second-pass Review

Keep in `scratch` for second-pass classification unless explicitly promoted:

- `AI-Browser-Core/`
- `aesthetic-resonator/`
- `Antigravity-Forge/`
- `autonomous-task-gen/`
- `cognitive-substrate/`
- `sovereign-arena-chaos/`
- `live_agents/`
- `mvp_halt/`
- `clean-room-v1.0.0/`

Archive/exclude candidates:

- `antigravity_dashboard/`
- `system_sentinel/`
- `tts_narrator/`

## Execution Notes (Current local state)

- Source tree already includes `ea-aol/` as a directory under `scratch`.
- Do not clone destination repositories directly as `scratch/ea-aol`, `scratch/mtp-weaver`, etc. because those names collide with source paths.
- Use a separate destination root for clone targets.

Recommended destination root:

- `c:\Users\zeros\.gemini\antigravity\split-targets`

## Step Order

1. Create destination clone root and clone empty GitHub repos there.
2. Run non-destructive planning and `-WhatIf` checks.
3. Execute copy phase for `cognitive-lab`, `lab-experiments`, `project-manuals`.
4. Execute filter-repo phase for `ea-aol`, `mtp-weaver`.
5. Validate outputs, then push destination repos.
6. Run archive phase in `scratch` only after destination verification.

## Ready-to-run Preflight Commands

```powershell
Set-Location c:\Users\zeros\.gemini\antigravity\scratch\project_manuals

# Read-only plan check
pwsh -File .\tools\repo_split_plan.ps1 -Layout recommended -AsJson

# Non-destructive phase previews
pwsh -File .\tools\repo_split_copy.ps1 -Layout recommended -WhatIf
pwsh -File .\tools\repo_split_filter_repo.ps1 -Layout recommended -WhatIf
pwsh -File .\tools\repo_split_archive.ps1 -Layout recommended -ExcludedAction archive -WhatIf
```

## Current readiness snapshot

- Plan generation: OK (`Layout=recommended`, `Entries=27`, `Repos=6`, `Preconditions=5`)
- Destination clones: not prepared yet in separate target root
- Safe next action: create destination clone root and start with `cognitive-lab` copy phase under `-WhatIf`
