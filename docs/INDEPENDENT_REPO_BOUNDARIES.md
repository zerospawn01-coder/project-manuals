# Independent Repo Boundaries

## Purpose

This document fixes the ownership boundary after the split so contributors do
not mistake `scratch` for the canonical home of active projects.

## Authoritative Sources

For the split repositories, the authoritative source is the `main` branch of
the owning repository:

- `cognitive-lab/main`
- `ea-aol/main`
- `mtp-weaver/main`
- `lab-experiments/main`
- `project-manuals/main`

`scratch` is a legacy root and temporary work area. It is not the canonical
integration point for these repositories anymore.

## What Must Not Be Reabsorbed Into `scratch`

Do not pull these lines back into a single `scratch` context:

- `ea-aol`
  - contract-first runtime, schemas, entrypoint logic, and tests
- `mtp-weaver`
  - kernel/core, governance, audit, and mission execution logic
- `project-manuals`
  - runbooks, split docs, operational assets, `phase14`, and reference/demo UI

## Where Changes Should Start

If work belongs to one of the split repos, start there directly.

- Change the research mainline in `cognitive-lab`
- Change contract/runtime work in `ea-aol`
- Change kernel/governance/audit work in `mtp-weaver`
- Change incubation/prototype work in `lab-experiments`
- Change runbooks and operational knowledge in `project-manuals`

Do not stage those changes in `scratch` first unless you are handling a local,
temporary migration task.

## Promotion and Delegation Direction

- `lab-experiments` promotes mature work into:
  - `cognitive-lab`, if it becomes part of the main research line
  - a dedicated independent repo, if it deserves its own lifecycle
- `project-manuals` receives:
  - handoff notes
  - runbooks
  - governance/process docs
  - reference/demo UI and operational assets
- `ea-aol` and `mtp-weaver` remain independent unless a deliberate future merge
  decision is recorded explicitly

## Review Standard

A contributor reading this document should be able to answer two questions
without ambiguity:

1. Which repo owns this change?
2. Why is `scratch` not the place to merge it back?
