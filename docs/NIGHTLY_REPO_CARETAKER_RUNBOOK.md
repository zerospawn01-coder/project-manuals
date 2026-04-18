# Nightly Repo Caretaker Runbook

## Purpose

`Nightly Repo Caretaker` is the nightly operating loop for repositories that already have stable boundaries and fail-closed CI. Its job is not to invent work. Its job is to inspect a fixed set of signals, produce only small safe pull requests, defer anything risky, and emit a morning summary that explains what changed and what was intentionally stopped.

This runbook assumes the current split repository topology is already in place:

- `ea-aol`
- `mtp-weaver`
- `cognitive-lab`
- `project-manuals`
- `lab-experiments`

## Operating Model

The caretaker has three layers.

### Observe

Collect only bounded nightly inputs:

- CI failures
- test regressions
- lint or typecheck failures
- flaky or slow test signals
- README or runbook drift
- warnings and TODO hotspots
- logging or observability gaps

### Act

Only produce a pull request when all of these are true:

- the change is small
- the blast radius is `SELF` or `TENANT`
- the change is reversible
- the repository already has a validation path for the touched area
- the change does not require policy, infra, or production approval

### Explain

Emit a `Morning Result` that answers only these questions:

- what changed
- what was intentionally deferred
- why it was deferred
- what needs human review next

## Repository Menu

### `ea-aol`

Nightly inputs:

- contract drift
- manifest and schema mismatches
- response envelope drift
- README and CI command mismatch

Safe PR candidates:

- contract doc and schema sync
- manifest and handler alignment
- missing or stale tests for existing operations
- README validation command repair

Do not auto-PR:

- new operation design
- policy or constitution changes
- broad runtime refactors

### `mtp-weaver`

Nightly inputs:

- kernel contract regression
- mission regression drift
- governance document mismatch
- fail-closed test breakage

Safe PR candidates:

- regression test repairs for existing kernel guarantees
- README and validation command sync
- missing gate coverage for documented kernel behavior
- small audit-path hardening changes

Do not auto-PR:

- broad `core/` redesign
- semantic changes to kernel policy
- new governance semantics without explicit review

### `cognitive-lab`

Nightly inputs:

- `leap_analysis` test drift
- `post_alignment_lab` regression drift
- `intuition-layer` regression drift
- README and workflow mismatch

Safe PR candidates:

- minor test fixes
- null and edge-condition hardening
- stale README or workflow repair
- logging and observability additions with local scope

Do not auto-PR:

- architecture reshaping across multiple pillars
- new research direction or semantic model changes
- experiment promotion decisions

### `project-manuals`

Nightly inputs:

- runbook drift
- contract and workflow documentation mismatch
- stale operational references
- broken validation command references

Safe PR candidates:

- runbook corrections
- workflow and docs sync
- broken internal links
- outdated validation command updates

Do not auto-PR:

- runtime code changes that belong in owner repos
- broad repo boundary changes

### `lab-experiments`

Nightly inputs:

- README drift
- missing experiment metadata
- stale promotion criteria

Safe PR candidates:

- README cleanup
- validation command repair
- promotion-path clarifications

Do not auto-PR:

- automatic promotion into another repository
- broad experiment refactors

## Decision Table

| Signal | Action | Output |
| --- | --- | --- |
| Existing test fails, fix is local and small | Fix | PR |
| README differs from actual validation path | Fix | PR |
| Logging gap is local and low risk | Fix | PR |
| Flaky or slow test cause is unclear | Stop | Deferred item |
| Blast radius exceeds `TENANT` | Stop | Deferred item |
| Infra, policy, or non-reversible change required | Stop | Deferred item |
| New feature or design work required | Stop | Deferred item |

## Blast Radius Policy

The caretaker may only auto-PR changes when blast radius is within these classes:

- `SELF`
  - one file or one tightly bounded subsystem
- `TENANT`
  - one maintained pillar or one repository-local contract path

The caretaker must defer when blast radius reaches:

- `SYSTEM`
- `FLEET`
- production or policy boundaries

## Deferred Queue Rules

A deferred item must include:

- repository
- area
- blocking reason
- required human decision
- whether the issue is safety, design, or ambiguity

Never silently skip work. If the caretaker refuses to act, the refusal must be visible in the morning report.

## Morning Result Format

`Morning Result` should contain four sections only.

1. `Completed`
   - PRs opened overnight
2. `Blocked`
   - changes intentionally not made
3. `Risk`
   - anything close to the boundary that still needs review
4. `Next`
   - the smallest human decision that would unblock the next cycle

## Minimum Nightly Schedule

1. Collect repo status and validation outputs
2. Compute candidate repair set
3. Filter by blast radius and reversibility
4. Open PRs for safe items only
5. Write deferred queue
6. Emit `Morning Result`

## Non-Goals

The caretaker is not allowed to:

- push directly to `main`
- widen repository boundaries
- update policy automatically
- make infra changes
- merge its own risky work
- conceal uncertainty behind warnings

## Success Criteria

The operating loop is healthy when:

- each night produces either a small PR or an explicit defer
- morning review is shorter, not longer
- low-risk maintenance work leaves the human queue
- repository boundaries remain stable
