# Repository Split Runbook for PowerShell

This runbook is for splitting `scratch` on Windows with PowerShell.

For day-of execution, use `SPLIT_EXECUTION_PLAYBOOK.md` as the short operator guide and this runbook as the full reference.

It supports two target layouts:

- Recommended split: `cognitive-lab`, `ea-aol`, `mtp-weaver`, `lab-experiments`, `project-manuals`
- Minimal split: `cognitive-lab`, `ea-aol`, `mtp-weaver`, `lab-experiments`

Policy:

- `cognitive-lab` is the primary successor repository and is created first.
- `ea-aol` and `mtp-weaver` are split out with history preserved.
- Experimental and POC projects should be grouped into `lab-experiments` unless they become active enough to justify a later split.
- Manuals, reports, and operator-facing material should not remain mixed into the primary research repository unless there is an explicit reason.
- Additional reviewed top-level directories that are not on the active CI-backed critical path are deferred rather than split in phase 1.

## 1. Recommended Repository Names

### Primary Successor

- `zerospawn01-coder/cognitive-lab`

### Independent Project Repositories

- `zerospawn01-coder/ea-aol`
- `zerospawn01-coder/mtp-weaver`

### Experiment Repository

- `zerospawn01-coder/lab-experiments`

### Support Repository

- `zerospawn01-coder/project-manuals`

### Optional Archive Repository

- `zerospawn01-coder/scratch-archive`

## 2. Migration Mapping

Use this as the canonical source-to-target mapping before executing any split commands.

| Source path in `scratch` | Target repository | Target path | Notes |
| --- | --- | --- | --- |
| `.github/` | `cognitive-lab` | `.github/` | Keep active CI with the core repository |
| `post_alignment_lab/` | `cognitive-lab` | `post_alignment_lab/` | Active core component |
| `intuition-layer/` | `cognitive-lab` | `intuition-layer/` | Active core component |
| `analyze_leap.py` | `cognitive-lab` | `leap_analysis/analyze_leap.py` | Rehome under a dedicated LEAP directory |
| `run_leap_analysis.py` | `cognitive-lab` | `leap_analysis/run_leap_analysis.py` | Rehome under a dedicated LEAP directory |
| `leap_analysis_core.py` | `cognitive-lab` | `leap_analysis/leap_analysis_core.py` | Rehome under a dedicated LEAP directory |
| `test_leap_analysis.py` | `cognitive-lab` | `leap_analysis/test_leap_analysis.py` | Keep test with LEAP code |
| `LEAP_ANALYSIS_README.md` | `cognitive-lab` | `leap_analysis/README.md` | Normalize name after move |
| `CI_CD_SETUP.md` | `cognitive-lab` | `CI_CD_SETUP.md` | Keep CI guidance with the active core repo |
| `ea-aol/` | `ea-aol` | `/` | Preserve history with `git filter-repo` |
| `mtp_weaver/` | `mtp-weaver` | `/` | Preserve history with `git filter-repo` |
| `jepa_intuition_poc/` | `lab-experiments` | `jepa_intuition_poc/` | POC work grouped to avoid repo sprawl |
| `geodesic_descent/` | `lab-experiments` | `geodesic_descent/` | Experiment grouped into the shared lab repo |
| `personal_ai/` | `lab-experiments` | `personal_ai/` | Personal exploratory work grouped with experiments for now |
| `project_manuals/` | `project-manuals` | `/` | Separate docs/support repo in the 5-repo layout |
| `CODE_QUALITY_REVIEW.md` | `cognitive-lab` or `scratch-archive` | `docs/reports/` | Prefer `cognitive-lab/docs/reports/` if still relevant |
| `CRITICAL_EVALUATION_REPORT.md` | `cognitive-lab` or `scratch-archive` | `docs/reports/` | Prefer `cognitive-lab/docs/reports/` if still relevant |
| `FINAL_UNIT_TEST_REPORT.md` | `cognitive-lab` or `scratch-archive` | `docs/reports/` | Move only if it documents active systems |
| `FINAL_WORK_SUMMARY.md` | `scratch-archive` or `cognitive-lab` | `docs/archive/` | Usually archival rather than production docs |
| `TODAY_WORK_SUMMARY.md` | `scratch-archive` or `cognitive-lab` | `docs/archive/` | Usually archival rather than production docs |
| `UNIT_TEST_IMPLEMENTATION_REPORT.md` | `cognitive-lab` or `scratch-archive` | `docs/reports/` | Keep only if it supports current CI work |
| `PUBLICATION_READINESS_REPORT.md` | `cognitive-lab` or `scratch-archive` | `docs/reports/` | Keep near active publication work |

## 3. Minimal 4-Repository Fallback

If the dedicated-repository layout is too heavy to operate right now, use this reduced target map.

| Source path in `scratch` | Target repository | Target path |
| --- | --- | --- |
| `post_alignment_lab/` | `cognitive-lab` | `post_alignment_lab/` |
| `intuition-layer/` | `cognitive-lab` | `intuition-layer/` |
| LEAP-related root files | `cognitive-lab` | `leap_analysis/` |
| `ea-aol/` | `ea-aol` | `/` |
| `mtp_weaver/` | `mtp-weaver` | `/` |
| `jepa_intuition_poc/` | `lab-experiments` | `jepa_intuition_poc/` |
| `geodesic_descent/` | `lab-experiments` | `geodesic_descent/` |
| `personal_ai/` | `lab-experiments` | `personal_ai/` |
| `project_manuals/` | `cognitive-lab` | `docs/manuals/` |

Minimal-layout note: `project_manuals/` is the only confirmed compression relative to the 5-repo recommended layout. Additional non-core reviewed directories are deferred rather than squeezed into `lab-experiments` during phase 1.

## 4. Recommended Creation Order

1. `cognitive-lab`
2. `ea-aol`
3. `mtp-weaver`
4. `lab-experiments`
5. `project-manuals`

## 5. Current Workspace Note

The current workspace already resembles `project-manuals` more than a full `scratch` checkout.

- Operator documentation is concentrated here.
- UI, contracts, and phase runbooks are present.
- The directories named in the broader split plan such as `post_alignment_lab/`, `ea-aol/`, and `mtp_weaver/` are not present in this workspace snapshot.

Treat this runbook's mapping table as the planning source of truth, then validate against the full `scratch` tree before executing the split.

## 6. Verified `scratch` Inventory Snapshot

The parent `scratch` checkout was inspected at top level on 2026-03-14.

### Confirmed Present and Covered by Current Mapping

The following planned split inputs are confirmed to exist in the real `scratch` tree:

- `post_alignment_lab/`
- `intuition-layer/`
- `ea-aol/`
- `mtp_weaver/`
- `jepa_intuition_poc/`
- `geodesic_descent/`
- `personal_ai/`
- `project_manuals/`
- `analyze_leap.py`
- `run_leap_analysis.py`
- `leap_analysis_core.py`
- `test_leap_analysis.py`
- `LEAP_ANALYSIS_README.md`
- `CI_CD_SETUP.md`
- `CODE_QUALITY_REVIEW.md`
- `CRITICAL_EVALUATION_REPORT.md`
- `FINAL_UNIT_TEST_REPORT.md`
- `FINAL_WORK_SUMMARY.md`
- `TODAY_WORK_SUMMARY.md`
- `UNIT_TEST_IMPLEMENTATION_REPORT.md`
- `PUBLICATION_READINESS_REPORT.md`

### Present but Deferred from the Optimized 5-Repo Phase

These top-level directories exist in `scratch` but are intentionally deferred from the optimized 5-repo migration so the first move stays centered on CI-backed core work and a small number of repositories:

- `aesthetic-resonator/`
- `AI-Browser-Core/`
- `antigravity_dashboard/`
- `Antigravity-Forge/`
- `autonomous-task-gen/`
- `clean-room-v1.0.0/`
- `cognitive-substrate/`
- `live_agents/`
- `mvp_halt/`
- `sovereign-arena-chaos/`
- `system_sentinel/`
- `tts_narrator/`

### Interpretation

- The current mapping is now partially confirmed rather than purely conceptual.
- The remaining migration risk is concentrated in the deferred and placeholder directories listed above.
- Do not treat the split as final until those directories are either revisited in a later split pass, archived, or intentionally excluded.

## 7. Deferred Directories Outside the Optimized 5-Repo Phase

The table below captures directories that were inspected but are not part of the optimized 5-repo move. They remain candidates for a later second-pass split or archive cleanup.

- `README` presence
- manifest presence such as `Cargo.toml`, `package.json`, `pyproject.toml`, or `requirements.txt`
- `tests` presence
- whether the directory already looks like a self-contained product or only an experiment snapshot

An extra `archive/exclude` bucket is used here because some paths are effectively placeholders rather than live projects.

| Directory | README | Manifest / Tests | First-pass destination | Rationale |
| --- | --- | --- | --- | --- |
| `aesthetic-resonator/` | No | No manifest, no tests | deferred | Leave in `scratch` for a later pass; it is not on the active CI-backed path |
| `AI-Browser-Core/` | No root README, nested `.git` present | Cohesive `api/`, `core/`, `tests/` tree | deferred | Viable later split candidate, but not needed for the optimized 5-repo first move |
| `antigravity_dashboard/` | No | No manifest, no tests | `archive/exclude` | Only `__pycache__/` is present at root, so there is no meaningful project payload to split right now |
| `Antigravity-Forge/` | Yes | `Cargo.toml` present | deferred | Viable later split candidate, deferred to avoid repo sprawl in phase 1 |
| `autonomous-task-gen/` | No | Nested TS package and Python pipeline, no root tests | deferred | Leave in `scratch` until there is a reason to split or archive it |
| `clean-room-v1.0.0/` | No | No root manifest, no tests | deferred | Packaged snapshot left for later cleanup |
| `cognitive-substrate/` | Yes | Standalone Python files and `test_integration.py` | deferred | Viable later split candidate, but not needed for the optimized first move |
| `live_agents/` | No | No root manifest, no tests | deferred | Mostly generated/logging payload, so leave for later cleanup |
| `mvp_halt/` | No | No root manifest, no tests | deferred | Leave in `scratch` for a second-pass review |
| `sovereign-arena-chaos/` | No | Large self-contained Python codebase, config, models, telemetry | deferred | Viable later split candidate, deferred to keep the first move small |
| `system_sentinel/` | No | No manifest, no tests | `archive/exclude` | Directory is currently empty |
| `tts_narrator/` | No | No manifest, no tests | `archive/exclude` | Only `__pycache__/` is present at root |

### Classification Summary

- Deferred for a later split or cleanup pass: `aesthetic-resonator/`, `AI-Browser-Core/`, `Antigravity-Forge/`, `autonomous-task-gen/`, `clean-room-v1.0.0/`, `cognitive-substrate/`, `live_agents/`, `mvp_halt/`, `sovereign-arena-chaos/`
- Likely archive or exclude: `antigravity_dashboard/`, `system_sentinel/`, `tts_narrator/`

### Immediate Implication

- The optimized 5-repo split keeps the first move centered on the active CI-backed core plus two clearly independent projects, one shared experiments repo, and one docs repo.
- The 4-repo fallback still works by folding `project_manuals/` into `cognitive-lab/docs/manuals/`.
- Additional reviewed directories remain in `scratch` for a later split or cleanup pass rather than forcing more repositories now.

### Current Optimized Repository Set

The optimized first-pass repository set is:

- `zerospawn01-coder/cognitive-lab`
- `zerospawn01-coder/ea-aol`
- `zerospawn01-coder/mtp-weaver`
- `zerospawn01-coder/lab-experiments`
- `zerospawn01-coder/project-manuals`

## 8. Preconditions

- Existing repository: `scratch`
- New GitHub repositories already created as empty repositories
- `git` available in PowerShell
- Python available in PowerShell
- `git-filter-repo` installable via `python -m pip`
- Repo split helper scripts are present in this repository under `tools/`
  (not `.tools/`):
  - `tools/repo_split_plan.ps1`
  - `tools/repo_split_copy.ps1`
  - `tools/repo_split_filter_repo.ps1`
  - `tools/repo_split_archive.ps1`

Validate helper scripts before executing any runbook command that writes,
archives, filters, or pushes:

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

## 9. Set Variables

```powershell
$env:ROOT = "$HOME\work"
$env:SCRATCH = Join-Path $env:ROOT "scratch"

$env:COG = Join-Path $env:ROOT "cognitive-lab"
$env:EAAOL = Join-Path $env:ROOT "ea-aol"
$env:MTP = Join-Path $env:ROOT "mtp-weaver"
$env:LABEXP = Join-Path $env:ROOT "lab-experiments"
```

## 10. Preflight Checks

```powershell
Set-Location $env:SCRATCH
git status
git branch --show-current
git remote -v
```

If there are uncommitted changes, checkpoint them first:

```powershell
git add -A
git commit -m "Checkpoint before repo split"
```

Optional safety tag:

```powershell
git tag pre-split-scratch
```

### 10.1 Mandatory Operator Gate for Writes, Archive, and Push

Any command that writes files, archives files, creates filtered clones, or pushes
to a remote must be preceded by reviewed `-WhatIf` output when the script
supports it.

Use this confirmation gate before the first non-`-WhatIf` command in each phase:

```powershell
$approval = Read-Host "Type SPLIT-APPROVED after reviewing dry-run output and rollback plan"
if ($approval -ne "SPLIT-APPROVED") {
  throw "Operator confirmation missing; aborting split operation."
}
```

Use this stricter gate immediately before any remote push:

```powershell
$approval = Read-Host "Type PUSH-APPROVED after inspecting target branch, remote, and rollback plan"
if ($approval -ne "PUSH-APPROVED") {
  throw "Push not approved; aborting."
}
```

Rollback policy:

- Before copy or archive operations, create a checkpoint commit or tag in
  `scratch`.
- Before `-Push`, inspect the filtered temporary clone and confirm that its root
  payload, branch, and remote are correct.
- If a pushed split is wrong, stop and use the target repository's revert or
  protected-branch workflow. Do not force-push over published history.
- `-ExcludedAction delete` is not part of the normal execution path. Use
  `archive`; use `delete` only in a separate manually reviewed cleanup pass.

## 11. Clone Empty Destination Repositories

```powershell
git clone https://github.com/zerospawn01-coder/cognitive-lab.git $env:COG
git clone https://github.com/zerospawn01-coder/ea-aol.git $env:EAAOL
git clone https://github.com/zerospawn01-coder/mtp-weaver.git $env:MTP
git clone https://github.com/zerospawn01-coder/lab-experiments.git $env:LABEXP
```

HTTPS is the recommended transport for this workspace. Keep SSH as an optional fallback only after host keys and credentials are configured.

## 12. Create `cognitive-lab`

For a concise operator checklist focused only on this first move, use `COGNITIVE_LAB_PHASE1_CHECKLIST.md` alongside this section.

### 12.1 Create Directory Layout

```powershell
Set-Location $env:COG

New-Item -ItemType Directory -Force -Path "leap_analysis" | Out-Null
New-Item -ItemType Directory -Force -Path "docs\manuals" | Out-Null
New-Item -ItemType Directory -Force -Path "docs\reports" | Out-Null
New-Item -ItemType Directory -Force -Path ".github\workflows" | Out-Null
```

### 12.2 Copy Active Components from `scratch`

```powershell
Copy-Item -Recurse -Force (Join-Path $env:SCRATCH "post_alignment_lab") .
Copy-Item -Recurse -Force (Join-Path $env:SCRATCH "intuition-layer") .

Copy-Item -Force (Join-Path $env:SCRATCH "analyze_leap.py") "leap_analysis\"
Copy-Item -Force (Join-Path $env:SCRATCH "run_leap_analysis.py") "leap_analysis\"
Copy-Item -Force (Join-Path $env:SCRATCH "leap_analysis_core.py") "leap_analysis\"
Copy-Item -Force (Join-Path $env:SCRATCH "test_leap_analysis.py") "leap_analysis\"
Copy-Item -Force (Join-Path $env:SCRATCH "LEAP_ANALYSIS_README.md") "leap_analysis\README.md"

Copy-Item -Force (Join-Path $env:SCRATCH "CI_CD_SETUP.md") "docs\CI_CD_SETUP.md"
Copy-Item -Force (Join-Path $env:SCRATCH ".github\workflows\test.yml") ".github\workflows\test.yml"
```

### 12.3 Create `README.md`

```powershell
@'
# cognitive-lab

Core research repository for active cognitive and post-alignment components.

## Included components

- LEAP analysis
- post_alignment_lab
- intuition-layer

## Repository purpose

This repository is the primary successor to the previous `scratch` structure
for actively maintained cognition / intuition / post-alignment work.

## Layout

- `leap_analysis/` - LEAP analysis scripts and tests
- `post_alignment_lab/` - post-alignment experiments and tooling
- `intuition-layer/` - intuition-layer implementation
- `docs/` - manuals, CI notes, and reports

## CI

- leap-analysis
- post-alignment-lab
- intuition-layer
'@ | Set-Content -Path "README.md"
```

### 12.4 Replace CI with Minimal Working Version

```powershell
@'
name: test

on:
  push:
    branches: [ main ]
  pull_request:

jobs:
  leap-analysis:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: [ "3.10" ]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install pytest numpy
      - name: Run LEAP analysis tests
        run: |
          pytest leap_analysis/test_leap_analysis.py

  post-alignment-lab:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: [ "3.10" ]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          if [ -f post_alignment_lab/requirements.txt ]; then pip install -r post_alignment_lab/requirements.txt; fi
          pip install pytest
      - name: Run post-alignment-lab tests
        run: |
          pytest post_alignment_lab

  intuition-layer:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: [ "3.10" ]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          if [ -f intuition-layer/requirements.txt ]; then pip install -r intuition-layer/requirements.txt; fi
          pip install pytest
      - name: Run intuition-layer tests
        run: |
          pytest intuition-layer
'@ | Set-Content -Path ".github\workflows\test.yml"
```

### 12.5 Local Smoke Test

Run these from the `cognitive-lab` root:

```powershell
Set-Location $env:COG

python -m pytest leap_analysis/test_leap_analysis.py
python -m pytest .\intuition-layer
python -m pytest .\post_alignment_lab
```

If either project depends on repo-root config from `scratch`, fix imports or config before push.

### 12.6 Commit and Push

```powershell
git add .
git commit -m "Initialize cognitive-lab from scratch and restore active CI"

$approval = Read-Host "Type PUSH-APPROVED after verifying cognitive-lab CI and remote"
if ($approval -ne "PUSH-APPROVED") { throw "Push not approved." }

git push origin main
```

## 13. Split `ea-aol` with History

### 13.1 Create Temporary Clone

```powershell
Set-Location $env:ROOT
git clone $env:SCRATCH "scratch-ea-aol-split"
Set-Location (Join-Path $env:ROOT "scratch-ea-aol-split")
```

### 13.2 Install `git-filter-repo` if Needed

```powershell
python -m pip install git-filter-repo
```

### 13.3 Filter to `ea-aol`

```powershell
git filter-repo --path ea-aol/ --path-rename ea-aol/: --force
```

### 13.4 Push to New Repository

```powershell
git remote remove origin
git remote add origin https://github.com/zerospawn01-coder/ea-aol.git
git branch -M main

$approval = Read-Host "Type PUSH-APPROVED after inspecting filtered ea-aol root and remote"
if ($approval -ne "PUSH-APPROVED") { throw "Push not approved." }

git push -u origin main
```

## 14. Split `mtp-weaver` with History

### 14.1 Create Temporary Clone

```powershell
Set-Location $env:ROOT
git clone $env:SCRATCH "scratch-mtp-weaver-split"
Set-Location (Join-Path $env:ROOT "scratch-mtp-weaver-split")
```

### 14.2 Filter to `mtp_weaver`

```powershell
git filter-repo --path mtp_weaver/ --path-rename mtp_weaver/: --force
```

### 14.3 Push to New Repository

```powershell
git remote remove origin
git remote add origin https://github.com/zerospawn01-coder/mtp-weaver.git
git branch -M main

$approval = Read-Host "Type PUSH-APPROVED after inspecting filtered mtp-weaver root and remote"
if ($approval -ne "PUSH-APPROVED") { throw "Push not approved." }

git push -u origin main
```

## 15. Create `lab-experiments` by Copy

For a concise operator checklist focused only on this move, use `LAB_EXPERIMENTS_CHECKLIST.md` alongside this section.

Use the generated split plan as the source of truth. In the optimized 5-repo layout, `lab-experiments` is the shared home for the three non-core experiment and personal directories that are worth preserving now without creating more repositories.

For minimal layout specifically, `project_manuals/` folds into `cognitive-lab/docs/manuals/`. Additional reviewed directories such as `AI-Browser-Core/`, `Antigravity-Forge/`, `cognitive-substrate/`, and `sovereign-arena-chaos/` stay deferred in `scratch` rather than being forced into `lab-experiments` during phase 1.

### 15.1 Copy Directories

```powershell
Set-Location $env:LABEXP

New-Item -ItemType Directory -Force -Path "docs" | Out-Null

Copy-Item -Recurse -Force (Join-Path $env:SCRATCH "jepa_intuition_poc") .
Copy-Item -Recurse -Force (Join-Path $env:SCRATCH "geodesic_descent") .
Copy-Item -Recurse -Force (Join-Path $env:SCRATCH "personal_ai") .
```

### 15.2 Create `README.md`

```powershell
@'
# lab-experiments

Experimental and proof-of-concept repository.

## Included projects

- jepa_intuition_poc
- geodesic_descent
- personal_ai

## Deferred after phase 1

- AI-Browser-Core
- Antigravity-Forge
- cognitive-substrate
- sovereign-arena-chaos
- aesthetic-resonator
- autonomous-task-gen
- clean-room-v1.0.0
- live_agents
- mvp_halt
'@ | Set-Content -Path "README.md"
```

### 15.3 Commit and Push

```powershell
git add .
git commit -m "Initialize lab-experiments from scratch"

$approval = Read-Host "Type PUSH-APPROVED after verifying lab-experiments content and remote"
if ($approval -ne "PUSH-APPROVED") { throw "Push not approved." }

git push origin main
```

## 16. Archive `scratch`

Only do this after the new repositories are verified.

### 16.1 Preferred Scripted Archive Flow

Use the archive helper after validating copy and filter-repo dry-runs.

```powershell
pwsh -File .\tools\repo_split_archive.ps1 -Layout recommended -WhatIf
pwsh -File .\tools\repo_split_archive.ps1 -Layout minimal -WhatIf
pwsh -File .\tools\repo_split_archive.ps1 -Layout recommended -ExcludedAction archive -WhatIf

$approval = Read-Host "Type ARCHIVE-APPROVED after reviewing archive dry-run output"
if ($approval -ne "ARCHIVE-APPROVED") { throw "Archive phase not approved." }

pwsh -File .\tools\repo_split_archive.ps1 -Layout recommended -ExcludedAction archive
```

Behavior:

- `ReportFiles` from the plan are moved into `docs/reports/` or `docs/archive/` inside `scratch`
- `ExcludedAction keep` leaves `antigravity_dashboard/`, `system_sentinel/`, and `tts_narrator/` untouched and only reports them
- `ExcludedAction archive` moves those placeholder directories into `docs/excluded/`

Final split execution should normally use `-ExcludedAction archive`; `delete` is only for a later cleanup pass after manual review.

If you use the manual fallback steps below instead of the archive helper, apply
the same `ARCHIVE-APPROVED` gate before creating directories or moving files.

### 16.2 Create Archive Directories

```powershell
Set-Location $env:SCRATCH

New-Item -ItemType Directory -Force -Path "docs\archive" | Out-Null
New-Item -ItemType Directory -Force -Path "docs\reports" | Out-Null
```

### 16.3 Move Report Files if They Exist

```powershell
$reportFiles = @(
  "CODE_QUALITY_REVIEW.md",
  "CRITICAL_EVALUATION_REPORT.md",
  "FINAL_UNIT_TEST_REPORT.md",
  "UNIT_TEST_IMPLEMENTATION_REPORT.md",
  "PUBLICATION_READINESS_REPORT.md"
)

foreach ($file in $reportFiles) {
  if (Test-Path $file) {
    Move-Item -Force $file "docs\reports\"
  }
}

$archiveFiles = @(
  "FINAL_WORK_SUMMARY.md",
  "TODAY_WORK_SUMMARY.md"
)

foreach ($file in $archiveFiles) {
  if (Test-Path $file) {
    Move-Item -Force $file "docs\archive\"
  }
}
```

### 16.4 Replace `README.md`

```powershell
@'
# scratch

Archive / staging repository after split.

Active work has moved to:
- cognitive-lab
- ea-aol
- mtp-weaver
- lab-experiments
'@ | Set-Content -Path "README.md"
```

### 16.5 Commit and Push

```powershell
git add .
git commit -m "Archive scratch after repository split"

$approval = Read-Host "Type PUSH-APPROVED after verifying scratch archive state and remote"
if ($approval -ne "PUSH-APPROVED") { throw "Push not approved." }

git push origin main
```

## 17. Final Verification

### 17.1 Check Local Repository State

```powershell
$repos = @($env:COG, $env:EAAOL, $env:MTP, $env:LABEXP)

foreach ($repo in $repos) {
  Write-Host "== $repo =="
  Set-Location $repo
  git remote -v
  git status
}
```

### 17.2 Check on GitHub

Verify these manually:

- `cognitive-lab` Actions are green
- `ea-aol` default branch is `main`
- `mtp-weaver` default branch is `main`
- `lab-experiments` contains the confirmed grouped experiment directories for the layout you executed
- `project-manuals` exists if you are using the 5-repo layout
- `scratch` README shows archive status

## 18. Recommended Execution Order

1. Checkpoint `scratch`
2. Create `cognitive-lab`
3. Make `cognitive-lab` CI green
4. Split `ea-aol` with `git filter-repo`
5. Split `mtp-weaver` with `git filter-repo`
6. Create `lab-experiments` by copy
7. Create `project-manuals` by copy if using the 5-repo layout
8. Archive `scratch`

## 19. Notes

- This runbook documents commands only. It does not perform the split by itself.
- If `post_alignment_lab` or `intuition-layer` depend on top-level files from `scratch`, fix those dependencies before enabling CI.
- Use temporary clones for `git filter-repo`. Do not run it against your main working copy unless that is intentional.

## 20. Next Step Decision Rule

Choose A before B when the full `scratch` tree is available and you need a final migration contract.

- A: Produce a confirmed inventory from the real `scratch` checkout and replace planning assumptions with exact paths.
- B: Script the execution flow only after the inventory is stable enough that copy targets and `git filter-repo` paths are unlikely to change.

In practice, the safest order is:

1. Confirm A against the real tree.
2. Freeze the mapping table.
3. Use B to automate the now-stable plan.

## 21. Non-Destructive Planning Script

This repository now includes a planning script at `tools/repo_split_plan.ps1`.

It does not execute copy, clone, or filter operations. It emits the currently documented split plan so that the migration can be reviewed before writing or running execution scripts.

The emitted plan now carries these fields per mapping row:

- `SourcePath`
- `Category`
- `TargetRepo`
- `TargetPath`
- `MigrationMode`
- `Confidence`
- `Disposition`

Example usage:

```powershell
pwsh -File .\tools\repo_split_plan.ps1
pwsh -File .\tools\repo_split_plan.ps1 -Layout minimal
pwsh -File .\tools\repo_split_plan.ps1 -AsJson
```

Use this script as the bridge between the current runbook and a later fully automated split script.

## 22. Dry-Run Execution Scripts

The following scripts now exist for execution-phase rehearsal:

- `tools/repo_split_copy.ps1`
- `tools/repo_split_filter_repo.ps1`
- `tools/repo_split_archive.ps1`

All three scripts are built around PowerShell `ShouldProcess`, so they support `-WhatIf` and are intended to be reviewed in dry-run mode first.

The execution scripts honor `Disposition = exclude`, so excluded paths are surfaced in preview output and handled according to the script's mode.

### 22.1 Copy-Based Repositories

Use the copy script for repositories created by file copy rather than history-preserving extraction.

```powershell
pwsh -File .\tools\repo_split_copy.ps1 -Layout recommended -WhatIf
pwsh -File .\tools\repo_split_copy.ps1 -Layout minimal -WhatIf
```

This covers repositories such as:

- `cognitive-lab`
- `lab-experiments`
- `project-manuals`

### 22.2 History-Preserving Repositories

Use the filter-repo script for repositories that should keep their Git history.

```powershell
pwsh -File .\tools\repo_split_filter_repo.ps1 -Layout recommended -WhatIf
pwsh -File .\tools\repo_split_filter_repo.ps1 -Layout recommended -WhatIf -Push
pwsh -File .\tools\repo_split_filter_repo.ps1 -Layout recommended -RemoteScheme ssh -WhatIf
```

The script now defaults to HTTPS remotes. Use `-RemoteScheme ssh` only after SSH host keys and credentials are configured, or supply `-RemoteBaseUrl` if you need a different Git host.

This covers repositories such as:

- `ea-aol`
- `mtp-weaver`

Keep `-Push` disabled until the temporary filtered clones are inspected.

### 22.3 Archive / Report Cleanup

Use the archive script to normalize report files under `docs/reports/` and `docs/archive/` inside `scratch`, and to preview how excluded placeholders should be handled.

```powershell
pwsh -File .\tools\repo_split_archive.ps1 -Layout recommended -ExcludedAction archive -WhatIf
pwsh -File .\tools\repo_split_archive.ps1 -Layout recommended -WhatIf
```

Default behavior keeps excluded placeholders untouched and only reports them, but the standard execution policy is to rerun with `-ExcludedAction archive` once the split is ready. `-ExcludedAction delete` is intentionally omitted from this quick reference; use it only in a separate cleanup review with its own rollback plan.
