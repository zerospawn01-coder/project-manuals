# Split Reference

Canonical first-pass repository set:

- `cognitive-lab`
- `ea-aol`
- `mtp-weaver`
- `lab-experiments`
- `project-manuals`

Current first-pass policy:

- `cognitive-lab` is created first and receives `.github/`, core paths, LEAP files, and `CI_CD_SETUP.md`.
- `ea-aol` and `mtp-weaver` are extracted with `git filter-repo` and preserve history.
- `lab-experiments` receives `jepa_intuition_poc/`, `geodesic_descent/`, and `personal_ai/`.
- `project-manuals` receives `project_manuals/` in the recommended layout.
- Deferred directories stay out of the first pass, including `AI-Browser-Core/` and `sovereign-arena-chaos/`.

Execution order:

1. `repo_split_plan.ps1`
2. `repo_split_copy.ps1 -WhatIf`
3. `repo_split_copy.ps1`
4. `repo_split_filter_repo.ps1 -WhatIf`
5. `repo_split_filter_repo.ps1`
6. Manual `git push -u origin main` for filtered temporary clones
7. `repo_split_archive.ps1 -WhatIf`
8. `repo_split_archive.ps1 -ExcludedAction archive`

Recommended safety checks:

- `git -C "$root\$scratch" status --short`
- `git -C "$root\cognitive-lab" remote -v`
- `git -C "$root\lab-experiments" remote -v`
- `git -C "$root\cognitive-lab" status`
- `git -C "$root\lab-experiments" status`
- `git -C "$root\$scratch" status`
