# lab-experiments Migration Checklist

Use this checklist for the `lab-experiments` move in the optimized 5-repo split.

## Scope

Move only these directories in the recommended layout:

- `jepa_intuition_poc/`
- `geodesic_descent/`
- `personal_ai/`

Do not move deferred directories such as `AI-Browser-Core/`, `Antigravity-Forge/`, `cognitive-substrate/`, `sovereign-arena-chaos/`, `aesthetic-resonator/`, `autonomous-task-gen/`, `clean-room-v1.0.0/`, `live_agents/`, or `mvp_halt/` during this phase.

## Preconditions

- `zerospawn01-coder/lab-experiments` exists
- local destination clone exists
- `repo_split_copy.ps1 -Layout recommended -WhatIf` has been reviewed
- `cognitive-lab` Phase 1 is already complete or at least not blocked

## Destination Layout

Create or confirm this layout in `lab-experiments`:

```text
lab-experiments/
├─ README.md
├─ jepa_intuition_poc/
├─ geodesic_descent/
└─ personal_ai/
```

## Copy Map

| Source in `scratch` | Target in `lab-experiments` |
| --- | --- |
| `jepa_intuition_poc/` | `jepa_intuition_poc/` |
| `geodesic_descent/` | `geodesic_descent/` |
| `personal_ai/` | `personal_ai/` |

## Execution Checklist

1. Clone or open the empty `lab-experiments` repository.
2. Copy `jepa_intuition_poc/` into the destination root.
3. Copy `geodesic_descent/` into the destination root.
4. Copy `personal_ai/` into the destination root.
5. Create or update `README.md` so it explains that this repository is a shared holding area for experiments and POCs.
6. Commit to `lab-experiments`.
7. Push `main`.

## Verification

Confirm all of the following:

- the three directories exist at the repository root
- no deferred directories were copied by mistake
- branch is `main`
- remote points to the expected GitHub repository

## Leave In `scratch`

Keep these out of this move:

- `project_manuals/`
- all report and summary files
- all deferred directories

## Exit Criteria

The `lab-experiments` move is complete when:

- `lab-experiments` contains exactly the three planned directories
- `README.md` reflects the shared-experiments role
- `scratch` still retains all deferred directories for later review
