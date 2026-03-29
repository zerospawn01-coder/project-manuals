# Scratch Repo Migration Map

## Purpose

This document fixes the destination for the remaining `zerospawn01-coder/scratch`
assets after the split. It is not a new split plan; it is the handoff map for
where each top-level directory or report belongs now that the destination repos
already exist.

## Current Destination Repos

- `cognitive-lab`
- `ea-aol`
- `mtp-weaver`
- `lab-experiments`
- `project-manuals`

## Mapping Rules

- Move active research logic into the repo that owns the runtime or experiment.
- Move runbooks, split procedures, governance notes, and reference UI into `project-manuals`.
- Do not keep active code in `scratch` once a destination repo exists.
- Treat cache folders, generated artifacts, and local machine residue as non-migrating.

## Top-Level Directory Map

| Scratch path | Destination | Action | Status | Notes |
| --- | --- | --- | --- | --- |
| `post_alignment_lab/` | `cognitive-lab` | Move as-is | Completed | Main post-alignment line belongs in the primary research repo. |
| `intuition-layer/` | `cognitive-lab` | Move as-is | Completed | Core intuition routing and memory-bank logic belongs with cognitive research. |
| `ea-aol/` | `ea-aol` | Move as-is | Completed | Independent contract-first runtime/project. |
| `mtp_weaver/` | `mtp-weaver` | Move as-is | Completed | Independent kernel/core/governance line. |
| `jepa_intuition_poc/` | `lab-experiments` | Move as-is | Completed | Experimental incubation asset. |
| `geodesic_descent/` | `lab-experiments` | Move as-is | Completed | Experimental incubation asset. |
| `personal_ai/` | `lab-experiments` | Move as-is | Completed | Personal/prototype work stays in the experiment repo, not the main line. |
| `project_manuals/` | `project-manuals` | Move as-is | Completed | Operational knowledge and handoff material. |
| `autonomous-task-gen/` | Future dedicated repo | Split out as independent project | Decided | `hackathon-package` is large enough to justify its own lifecycle instead of remaining a scratch leftover. |
| `data/` | Local-only until provenance is fixed | Keep out of GitHub by default | Decided | `theoretical_predictions.npz` looks like generated numeric output and should not move until a generating workflow and owner repo are explicit. |
| `.github/` | Per destination repo | Recreate selectively | Completed/Selective | CI and templates were recreated in destination repos rather than copied wholesale. |
| `.pytest_cache/` | None | Do not move | N/A | Local test residue. |
| `.git/` | None | Do not move | N/A | Repository metadata, not content. |

## Root File Map

| Scratch file | Destination | Action | Status | Notes |
| --- | --- | --- | --- | --- |
| `analyze_leap.py` | `cognitive-lab/leap_analysis/` | Move and regroup | Completed | LEAP analysis belongs with the main research repo. |
| `run_leap_analysis.py` | `cognitive-lab/leap_analysis/` | Move and regroup | Completed | Same LEAP analysis surface. |
| `leap_analysis_core.py` | `cognitive-lab/leap_analysis/` | Move and regroup | Completed | Same LEAP analysis surface. |
| `test_leap_analysis.py` | `cognitive-lab/leap_analysis/` | Move and regroup | Completed | Regression coverage for LEAP analysis. |
| `LEAP_ANALYSIS_README.md` | `cognitive-lab/leap_analysis/README.md` | Move and rename | Completed | README normalized inside the subdirectory. |
| `CI_CD_SETUP.md` | `cognitive-lab` | Move or absorb | Completed | Became part of the main repo setup/documentation. |
| `CODE_QUALITY_REVIEW.md` | `cognitive-lab/docs/reports/` | Move | Completed | Report belongs with the LEAP analysis workstream but follows the existing split automation path. |
| `CRITICAL_EVALUATION_REPORT.md` | `cognitive-lab/docs/reports/` | Move | Completed | Report belongs with the LEAP analysis workstream but follows the existing split automation path. |
| `FINAL_UNIT_TEST_REPORT.md` | `cognitive-lab/docs/reports/` | Move | Completed | Report belongs with the LEAP analysis workstream but follows the existing split automation path. |
| `PUBLICATION_READINESS_REPORT.md` | `cognitive-lab/docs/reports/` | Move | Completed | Report belongs with the LEAP analysis workstream but follows the existing split automation path. |
| `UNIT_TEST_IMPLEMENTATION_REPORT.md` | `cognitive-lab/docs/reports/` | Move | Completed | Report belongs with the LEAP analysis workstream but follows the existing split automation path. |
| `FINAL_WORK_SUMMARY.md` | `cognitive-lab/docs/archive/` | Move | Completed | Historical summary, retained as archive rather than active docs. |
| `TODAY_WORK_SUMMARY.md` | `cognitive-lab/docs/archive/` | Move | Completed | Historical summary, retained as archive rather than active docs. |
| `README.md` | None | Replace with split guidance if needed | Deferred | The old root README should not be treated as a source-of-truth repo after the split. |
| `duplicates_画像.csv` | `project-manuals/docs/` or local-only | Evaluate | Deferred | Move only if it is a reusable split artifact; otherwise keep out of Git. |
| `empty_dirs_画像.txt` | `project-manuals/docs/` or local-only | Evaluate | Deferred | Same rule as other local housekeeping outputs. |
| `note_ai_output.txt` | None or local-only | Do not move by default | Deferred | Appears to be ad hoc output, not a maintained repo asset. |
| `.gitattributes` | Per destination repo | Recreate selectively | Completed/Selective | Destination repos now own their own root settings. |
| `.gitignore` | Per destination repo | Recreate selectively | Completed/Selective | Destination repos now own their own ignore policy. |

## Project-Manuals-Specific Assets

These are the assets that should continue to be treated as `project-manuals`
material rather than pulled back into code repos:

- `phase14/`
- `renderer-react/` reference/demo UI
- repo split checklists, runbooks, mappings, and handoff notes

## Non-Migrating Material

Do not treat these as pending split work:

- cache folders
- `node_modules/`
- `dist/`
- `__pycache__/`
- one-off logs
- local screenshots or exports that are not part of a maintained workflow

## Remaining Decisions

These items still require follow-through, but they should no longer be treated
as unresolved ownership questions:

- `autonomous-task-gen/`
  - create a dedicated repository when ready
- `data/`
  - keep local-only unless a reproducible generating workflow and owning repo are defined
- any new top-level directory added to `scratch` after the split
  - evaluate immediately instead of letting it become a silent leftover

## Working Rule Going Forward

If a new asset can be explained as one of the following, it does **not** belong
in `scratch` anymore:

- main research logic
- independent runtime/project code
- experiment incubation
- operational knowledge or reference UI

It should be added directly to the owning destination repo instead.

