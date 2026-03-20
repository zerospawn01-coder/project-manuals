# Split Execution Playbook

Use this as the short operator guide for the optimized `scratch` split.

This playbook assumes the optimized repository contract:

- `cognitive-lab`
- `ea-aol`
- `mtp-weaver`
- `lab-experiments`
- `project-manuals`

## 1. Preconditions

Confirm all of the following before doing any write:

- `scratch` is checkpointed or tagged
- destination repositories exist for the target layout
- `repo_split_plan.ps1` dry-run output has been reviewed
- `repo_split_copy.ps1 -WhatIf` has been reviewed
- `repo_split_filter_repo.ps1 -WhatIf` has been reviewed
- `repo_split_archive.ps1 -ExcludedAction archive -WhatIf` has been reviewed
- HTTPS remotes are being used unless SSH is intentionally configured

## 2. Copy Phase

Run copy-based repository creation first.

Recommended layout:

```powershell
pwsh -File .\tools\repo_split_copy.ps1 -Layout recommended -WhatIf
pwsh -File .\tools\repo_split_copy.ps1 -Layout recommended
```

The copy script now auto-detects the enclosing `scratch` checkout from `project_manuals\tools`. If the required source paths are missing, it aborts before writing instead of partially copying.

Minimal layout:

```powershell
pwsh -File .\tools\repo_split_copy.ps1 -Layout minimal -WhatIf
pwsh -File .\tools\repo_split_copy.ps1 -Layout minimal
```

After copy phase, verify:

- `cognitive-lab` contains `.github/`, `post_alignment_lab/`, `intuition-layer/`, `leap_analysis/`, and `CI_CD_SETUP.md`
- `lab-experiments` contains `jepa_intuition_poc/`, `geodesic_descent/`, and `personal_ai/`
- `project-manuals` contains `project_manuals/` if using the 5-repo layout

## 3. Filter-Repo Phase

Run history-preserving splits only after copy targets look correct.

```powershell
pwsh -File .\tools\repo_split_filter_repo.ps1 -Layout recommended -WhatIf
pwsh -File .\tools\repo_split_filter_repo.ps1 -Layout recommended
```

If pushing immediately after inspection:

```powershell
pwsh -File .\tools\repo_split_filter_repo.ps1 -Layout recommended -Push
```

Verify after filter phase:

- `ea-aol` root contains only the filtered `ea-aol/` payload
- `mtp-weaver` root contains only the filtered `mtp_weaver/` payload
- both repositories are on branch `main`
- remotes point to HTTPS unless intentionally overridden

## 4. Archive Phase

Run archive cleanup after the destination repositories are validated.

```powershell
pwsh -File .\tools\repo_split_archive.ps1 -Layout recommended -ExcludedAction archive -WhatIf
pwsh -File .\tools\repo_split_archive.ps1 -Layout recommended -ExcludedAction archive
```

Archive policy:

- standard execution uses `-ExcludedAction archive`
- `delete` is only for a later cleanup pass after manual review

Verify after archive phase:

- report files are under `docs/reports/`
- summary files are under `docs/archive/`
- excluded placeholders moved under `docs/excluded/`
- `scratch` root is visibly reduced

## 5. Final Checks

Confirm all of the following:

- `cognitive-lab` CI is green on `main`
- `ea-aol` and `mtp-weaver` are pushed and readable
- `lab-experiments` and `project-manuals` contain the expected directories
- `scratch` README reflects archive or staging status
- deferred directories still remain in `scratch` until a later review pass

## 6. Escalation Rule

Stop and re-review before continuing if any of these happen:

- copy output does not match the planned destination paths
- filtered temporary clones contain unexpected top-level files
- a destination repository is missing or points at the wrong remote
- archive phase would move or delete files outside the documented set
