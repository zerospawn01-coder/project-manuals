# Scratch Next Actions

## Purpose

This is the short action list extracted from the full scratch migration map and
reorganization checklist.

Use this when you need the next concrete steps without rereading the full split
history.

## Immediate 3 Tasks

### 1. Freeze `scratch` as a legacy root

- Replace the old `scratch/README.md` with a short notice that the repo is no
  longer the active home of the split projects.
- Link directly to:
  - `cognitive-lab`
  - `ea-aol`
  - `mtp-weaver`
  - `lab-experiments`
  - `project-manuals`
- State that new work should be added to the owning repo, not to `scratch`.

### 2. Verify `cognitive-lab` is the only active research home

- Confirm that the active research surface is:
  - `post_alignment_lab`
  - `intuition-layer`
  - `leap_analysis`
- Confirm LEAP analysis stays under `cognitive-lab/leap_analysis/`.
- Confirm `cognitive-lab` CI still covers the three active test surfaces.

### 3. Execute the remaining split decisions explicitly

- Treat `autonomous-task-gen/` as the next dedicated repo candidate rather than a permanent scratch subdirectory.
- Keep `data/` local-only unless a reproducible generating workflow and owning repo are defined.
- Record follow-through work in `project-manuals` so neither item remains a silent leftover.

## Working Rule

If an asset is active code, experiment incubation, or operational knowledge, it
belongs in its destination repo now. It should not be added back into `scratch`.
