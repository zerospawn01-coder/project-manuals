# cognitive-lab Phase 1 Migration Checklist

Use this checklist for the first real move out of `scratch` into `cognitive-lab`.

## Scope

Phase 1 moves only the active CI-backed core:

- `.github/`
- `post_alignment_lab/`
- `intuition-layer/`
- `analyze_leap.py`
- `run_leap_analysis.py`
- `leap_analysis_core.py`
- `test_leap_analysis.py`
- `LEAP_ANALYSIS_README.md`
- `CI_CD_SETUP.md`

Do not move `ea-aol/`, `mtp_weaver/`, `jepa_intuition_poc/`, `geodesic_descent/`, `personal_ai/`, or any deferred directories during this phase.

## Preconditions

- `zerospawn01-coder/cognitive-lab` exists
- local destination clone exists
- `scratch` is clean enough to checkpoint or tag
- active branch and remotes have been reviewed
- current split plan has been reviewed with `-WhatIf`

## Destination Layout

Create or confirm this layout in `cognitive-lab`:

```text
cognitive-lab/
├─ .github/
├─ README.md
├─ CI_CD_SETUP.md
├─ leap_analysis/
│  ├─ analyze_leap.py
│  ├─ run_leap_analysis.py
│  ├─ leap_analysis_core.py
│  ├─ test_leap_analysis.py
│  └─ README.md
├─ post_alignment_lab/
└─ intuition-layer/
```

## Copy Map

Copy these paths exactly:

| Source in `scratch` | Target in `cognitive-lab` |
| --- | --- |
| `.github/` | `.github/` |
| `post_alignment_lab/` | `post_alignment_lab/` |
| `intuition-layer/` | `intuition-layer/` |
| `analyze_leap.py` | `leap_analysis/analyze_leap.py` |
| `run_leap_analysis.py` | `leap_analysis/run_leap_analysis.py` |
| `leap_analysis_core.py` | `leap_analysis/leap_analysis_core.py` |
| `test_leap_analysis.py` | `leap_analysis/test_leap_analysis.py` |
| `LEAP_ANALYSIS_README.md` | `leap_analysis/README.md` |
| `CI_CD_SETUP.md` | `CI_CD_SETUP.md` |

## Execution Checklist

1. Checkpoint `scratch`.
2. Clone or open the empty `cognitive-lab` repository.
3. Create `leap_analysis/` in the destination.
4. Copy `.github/` into the destination root.
5. Copy `post_alignment_lab/` into the destination root.
6. Copy `intuition-layer/` into the destination root.
7. Copy the four LEAP Python files into `leap_analysis/`.
8. Rename `LEAP_ANALYSIS_README.md` to `leap_analysis/README.md`.
9. Copy `CI_CD_SETUP.md` into the destination root.
10. Review the copied `.github/workflows` files and remove anything not needed for `cognitive-lab`.
11. Update `README.md` so the repo describes only the active core domains.
12. Run local smoke tests before any push.
13. Commit to `cognitive-lab`.
14. Push `main`.

## Local Verification

Run these from the `cognitive-lab` root:

```powershell
python -m pytest leap_analysis/test_leap_analysis.py
python -m pytest .\post_alignment_lab
python -m pytest .\intuition-layer
```

Also check:

- imports still resolve after moving LEAP files under `leap_analysis/`
- workflow paths in `.github/workflows` match the new layout
- no CI jobs still reference `scratch`-only paths

## CI Verification

Confirm these after push:

- GitHub Actions triggers on `main`
- LEAP analysis job passes
- `post_alignment_lab` job passes
- `intuition-layer` job passes
- branch is `main`

## Leave In `scratch`

Keep these out of Phase 1:

- `ea-aol/`
- `mtp_weaver/`
- `jepa_intuition_poc/`
- `geodesic_descent/`
- `personal_ai/`
- `project_manuals/`
- report and summary files
- deferred directories such as `AI-Browser-Core/`, `Antigravity-Forge/`, `cognitive-substrate/`, `sovereign-arena-chaos/`

## Exit Criteria

Phase 1 is complete when:

- `cognitive-lab` contains the copied core assets
- local smoke tests pass
- CI is green on `main`
- `scratch` still retains everything not yet migrated
