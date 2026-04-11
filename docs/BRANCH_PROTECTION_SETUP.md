# Branch Protection Setup

## Purpose

This document defines the GitHub-side enforcement settings required to turn fail-closed CI into actual merge control. Repository-local workflows are not enough by themselves. The merge gate becomes mechanical only when GitHub branch protection, required checks, code owner review, and auto-merge behavior are configured to match the repository contracts.

The target repositories are:

- `ea-aol`
- `mtp-weaver`
- `cognitive-lab`

## Shared Policy

Apply the following settings to the `main` branch in every target repository.

### Pull Request Rules

- Require a pull request before merging: `ON`
- Require approvals: `ON`
- Require review from Code Owners: `ON`
- Dismiss stale pull request approvals when new commits are pushed: `ON`
- Require conversation resolution before merging: `ON`

### Status Check Rules

- Require status checks to pass before merging: `ON`
- Require branches to be up to date before merging: `ON`

### History Rules

- Require linear history: `ON`

### Auto-Merge Rules

- Allow auto-merge: `ON`
- Only use auto-merge for pull requests explicitly labeled `automerge`

### Safety Rules

- Do not allow bypassing the above settings: `ON`

## Required Checks by Repository

### `ea-aol`

Branch:

- `main`

Required checks:

- `validate-schema`
- `validate-completeness`
- `validate-response-contract`
- `validate-governance`
- `unit-tests`

Protected surfaces already owned by `CODEOWNERS`:

- `contracts/**`
- `.agent.md`
- `.github/workflows/**`

### `mtp-weaver`

Branch:

- `main`

Required checks:

- `validate-kernel-contract`
- `validate-mission-regression`
- `validate-governance`
- `unit-tests`

Protected surfaces already owned by `CODEOWNERS`:

- `KERNEL_CONTRACT.md`
- `.agent.md`
- `.github/workflows/**`

### `cognitive-lab`

Branch:

- `main`

Required checks:

- `validate-leap-analysis`
- `validate-post-alignment-lab`
- `validate-intuition-layer`
- `validate-governance`
- `unit-tests`

Protected surfaces already owned by `CODEOWNERS`:

- `.agent.md`
- `.github/workflows/**`
- `README.md`

## Auto-Merge Operating Rule

The repository-local `auto-merge.yml` workflow only enables native GitHub auto-merge when:

- the pull request is not a draft
- the pull request carries the `automerge` label

It does not bypass required checks. If required checks fail, GitHub will keep the pull request blocked.

## Manual Setup Sequence

For each target repository:

1. Open repository settings
2. Open branch protection or rulesets for `main`
3. Enable the shared policy toggles
4. Paste the repository-specific required check names exactly as listed above
5. Confirm `Allow auto-merge` is enabled in repository settings
6. Verify `CODEOWNERS` review is required

## Verification Checklist

After setup, confirm all of these are true:

- A failing required check blocks merge
- A passing pull request without `automerge` does not merge automatically
- A passing pull request with `automerge` is eligible for native auto-merge
- A change touching a code-owned file requests human review
- No path exists that allows merge after a failed required check

## Non-Goals

This setup does not:

- change repository code quality by itself
- create required checks automatically
- replace the need to keep workflow job names stable

It only binds GitHub merge behavior to the fail-closed validation already present in the repository.
