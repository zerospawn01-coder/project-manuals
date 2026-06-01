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
- required helper scripts exist under `tools/` in this repository
- `repo_split_plan.ps1` output has been reviewed
- `repo_split_copy.ps1 -WhatIf` has been reviewed
- `repo_split_filter_repo.ps1 -WhatIf` has been reviewed
- `repo_split_archive.ps1 -ExcludedAction archive -WhatIf` has been reviewed
- HTTPS remotes are being used unless SSH is intentionally configured

Validate helper scripts before using this playbook:

```powershell
$requiredScripts = @(
  ".\tools\repo_split_plan.ps1",
  ".\tools\repo_split_copy.ps1",
  ".\tools\repo_split_filter_repo.ps1",
  ".\tools\repo_split_archive.ps1"
)

foreach ($script in $requiredScripts) {
  if (-not (Test-Path $script)) {
    throw "Missing required repo split helper script: $script"
  }
}
```

## 2. Mandatory Safety Gate

Do not run write, archive, or push commands directly from the fast path.
Every non-`-WhatIf` command must be preceded by reviewed dry-run output and this
explicit operator confirmation:

```powershell
$approval = Read-Host "Type SPLIT-APPROVED after reviewing dry-run output and rollback plan"
if ($approval -ne "SPLIT-APPROVED") {
  throw "Operator confirmation missing; aborting split operation."
}
```

Rollback/checkpoint requirement:

- Before copy or archive operations, create a checkpoint commit or tag in `scratch`.
- Before `-Push`, inspect the filtered temporary clone and confirm the destination remote.
- If a pushed split is wrong, stop immediately and use the destination repository's branch protection / revert workflow. Do not force-push over published history.
- `-ExcludedAction delete` is not allowed in this fast path. Use only `archive`; delete requires a separate manual review.

## 3. Copy Phase

Run copy-based repository creation first.

Recommended layout:

```powershell
pwsh -File .\tools\repo_split_copy.ps1 -Layout recommended -WhatIf

$approval = Read-Host "Type SPLIT-APPROVED to execute recommended copy phase"
if ($approval -ne "SPLIT-APPROVED") { throw "Copy phase not approved." }

pwsh -File .\tools\repo_split_copy.ps1 -Layout recommended
```

The copy script now auto-detects the enclosing `scratch` checkout from `project_manuals\tools`. If the required source paths are missing, it aborts before writing instead of partially copying.

Minimal layout:

```powershell
pwsh -File .\tools\repo_split_copy.ps1 -Layout minimal -WhatIf

$approval = Read-Host "Type SPLIT-APPROVED to execute minimal copy phase"
if ($approval -ne "SPLIT-APPROVED") { throw "Copy phase not approved." }

pwsh -File .\tools\repo_split_copy.ps1 -Layout minimal
```

After copy phase, verify:

- `cognitive-lab` contains `.github/`, `post_alignment_lab/`, `intuition-layer/`, `leap_analysis/`, and `CI_CD_SETUP.md`
- `lab-experiments` contains `jepa_intuition_poc/`, `geodesic_descent/`, and `personal_ai/`
- `project-manuals` contains `project_manuals/` if using the 5-repo layout

## 4. Filter-Repo Phase

Run history-preserving splits only after copy targets look correct.

```powershell
pwsh -File .\tools\repo_split_filter_repo.ps1 -Layout recommended -WhatIf

$approval = Read-Host "Type SPLIT-APPROVED to create filtered temporary clones"
if ($approval -ne "SPLIT-APPROVED") { throw "Filter phase not approved." }

pwsh -File .\tools\repo_split_filter_repo.ps1 -Layout recommended
```

Do not run `-Push` until the filtered temporary clones have been inspected. The
operator must confirm that each clone has the expected root payload, branch, and
remote before executing the push command:

```powershell
$approval = Read-Host "Type PUSH-APPROVED after inspecting filtered clones and remotes"
if ($approval -ne "PUSH-APPROVED") { throw "Push not approved." }

pwsh -File .\tools\repo_split_filter_repo.ps1 -Layout recommended -Push
```

Verify after filter phase:

- `ea-aol` root contains only the filtered `ea-aol/` payload
- `mtp-weaver` root contains only the filtered `mtp_weaver/` payload
- both repositories are on branch `main`
- remotes point to HTTPS unless intentionally overridden

## 5. Archive Phase

Run archive cleanup after the destination repositories are validated.

```powershell
pwsh -File .\tools\repo_split_archive.ps1 -Layout recommended -ExcludedAction archive -WhatIf

$approval = Read-Host "Type ARCHIVE-APPROVED after reviewing archive dry-run output"
if ($approval -ne "ARCHIVE-APPROVED") { throw "Archive phase not approved." }

pwsh -File .\tools\repo_split_archive.ps1 -Layout recommended -ExcludedAction archive
```

Archive policy:

- standard execution uses `-ExcludedAction archive`
- `delete` is only for a later cleanup pass after manual review
- if archive output diverges from the dry-run, stop and restore from the
  pre-archive checkpoint rather than continuing with additional cleanup

Verify after archive phase:

- report files are under `docs/reports/`
- summary files are under `docs/archive/`
- excluded placeholders moved under `docs/excluded/`
- `scratch` root is visibly reduced

## 6. Final Checks

Confirm all of the following:

- `cognitive-lab` CI is green on `main`
- `ea-aol` and `mtp-weaver` are pushed and readable
- `lab-experiments` and `project-manuals` contain the expected directories
- `scratch` README reflects archive or staging status
- deferred directories still remain in `scratch` until a later review pass

## 7. Audit Baseline for Next Review

After each execution block, append the following record to the verification log
in `REPO_SPLIT_POWERSHELL_RUNBOOK.md` or to a dated file under `docs/reports/`:

```text
Date:
Scope:
Command(s):
Dry-run reviewed: yes/no
Confirmation token used: SPLIT-APPROVED | PUSH-APPROVED | ARCHIVE-APPROVED
Rollback checkpoint:
Result:
Evidence path(s):
Operator:
```

## 8. Escalation Rule

Stop and re-review before continuing if any of these happen:

- copy output does not match the planned destination paths
- filtered temporary clones contain unexpected top-level files
- a destination repository is missing or points at the wrong remote
- archive phase would move or delete files outside the documented set
- a required helper script is missing from `tools/`
- an operator confirmation token is missing or mistyped
