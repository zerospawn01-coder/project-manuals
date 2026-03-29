# Scratch Reorganization Checklist

## Goal

Finish the post-split cleanup of `zerospawn01-coder/scratch` without turning it
back into an active monorepo.

Use this checklist together with `SCRATCH_REPO_MIGRATION_MAP.md`.

## Rule of Operation

- Do not move active code back into `scratch`.
- Treat `cognitive-lab` as the main research repo.
- Treat `ea-aol`, `mtp-weaver`, and `project-manuals` as independent repos.
- Treat `lab-experiments` as the incubation repo.

## Phase 1: Freeze the Root

- [ ] Replace the old `scratch/README.md` with a short legacy-root notice.
- [ ] Add links from the legacy root to:
  - `cognitive-lab`
  - `ea-aol`
  - `mtp-weaver`
  - `lab-experiments`
  - `project-manuals`
- [ ] State clearly that new work should not be added to `scratch`.

## Phase 2: Confirm the Main Research Surface

- [ ] Verify `cognitive-lab` remains the only active home for:
  - `post_alignment_lab`
  - `intuition-layer`
  - `leap_analysis`
- [ ] Verify LEAP analysis lives under `cognitive-lab/leap_analysis/`.
- [ ] Verify the `cognitive-lab` README exposes those three areas as the main entry points.
- [ ] Verify CI for `cognitive-lab` still covers:
  - LEAP analysis tests
  - post-alignment tests
  - intuition-layer tests

## Phase 3: Confirm Independent Repos Stay Independent

- [ ] State explicitly that the authoritative source for each split repo is its `main` branch, not `scratch`.
- [ ] Verify `ea-aol` is not referenced as a subproject to be reabsorbed into `scratch`.
- [ ] Verify `mtp-weaver` is not referenced as a subproject to be reabsorbed into `scratch`.
- [ ] Verify `project-manuals` remains the destination for:
  - phase14 operational assets
  - split/handoff docs
  - reference/demo UI

## Phase 4: Confirm Experiment Ownership

- [ ] Verify `lab-experiments` remains the destination for:
  - `jepa_intuition_poc`
  - `geodesic_descent`
  - `personal_ai`
- [ ] Verify `lab-experiments` README still describes promotion criteria.
- [ ] Verify no experiment directory is being treated as part of the `cognitive-lab` CI surface unless intentionally promoted.

## Phase 5: Resolve Deferred Items Explicitly

- [ ] Treat `autonomous-task-gen/` as a future dedicated repo, not as a permanent `scratch` resident.
- [ ] Keep `data/` local-only unless a reproducible generator and owner repo are recorded.
- [ ] Record both follow-through actions in `project-manuals`.

## Phase 6: Clean the Legacy Root

- [ ] Remove or archive root-level reports that already live in destination repos.
- [ ] Remove or archive root-level LEAP analysis files once the destination is confirmed.
- [ ] Keep only legacy-root guidance and truly unresolved items in `scratch`.

## Merge/Close Criteria

- [ ] `scratch` is no longer described as the active home of any split project.
- [ ] Each active project has exactly one owning repo.
- [ ] Deferred items are explicit, not accidental leftovers.
- [ ] Future contributors can tell where new work belongs without reading split history.
