# Copilot Instructions for project-manuals

This repository is an operational knowledge and governance asset repository.
Prefer small, reviewable changes that preserve executable runbooks, workflow
validators, caretaker automation, and phase14 governance contracts.

## Repository Role

- Treat `project-manuals` as the source of reusable operational procedures,
  workflow contracts, runbooks, checklists, and validation tooling.
- Do not move product runtime, research implementation, or experiment-heavy code
  into this repository unless it is explicitly an operator-facing reference or
  validation asset.
- Keep repo-specific runtime behavior in the repository that owns that runtime.

## Governance Boundaries

- Read `.agent.md` before changing governance-sensitive paths. It is the
  authoritative AI boundary contract for this repository.
- Do not edit sovereign paths directly unless the task explicitly targets them
  and the pull request calls out the governance impact:
  - `constitution/`
  - `constitution/invariants/`
  - `.github/CODEOWNERS`
  - `.agent.md`
- Treat ledger data as append-only. Never truncate, rewrite, delete, or
  normalize existing `.jsonl` ledger history.
- Do not invent new invariant IDs or failure codes without registering them in
  the constitution and adding tests that prove the new contract.
- Schema changes under `contracts/schemas/` must remain fail-closed. Do not
  loosen `required`, `additionalProperties`, enum, `$id`, or `$schema` rules
  without explaining the compatibility impact.

## Caretaker and Workflow Rules

- `.github/workflows/nightly.yml` and `tools/repo_caretaker.ts` implement the
  Nightly Repo Caretaker path. Preserve these invariants:
  - The workflow never pushes directly to `main`.
  - SAFE auto-actions are limited to SELF blast radius.
  - TENANT findings are logged or deferred, not auto-mutated.
  - If `CARETAKER_GH_TOKEN` is configured, cross-repo observation must fail
    closed when external repo reads fail.
  - If `CARETAKER_GH_TOKEN` is absent, fallback to SELF scope with
    `github.token` and observe only `project-manuals`.
- Do not replace fail-closed checks with warnings, `continue-on-error`, `|| true`,
  broad retries, or silent skips unless the task explicitly changes that contract.
- Keep GitHub Actions token use explicit. Never commit secrets, API keys, PATs,
  or token values. Use GitHub Secrets or the built-in `github.token`.

## Build and Validation Commands

Run the narrowest relevant validation first, then the broader gate before PRs
that affect contracts, workflows, or governance code.

Common commands:

```bash
npm ci
npm run build
npm test
npm run test:gate
npm run test:governance
npm run verify:constitution
```

Workflow and repo-split commands:

```bash
npm run workflow:validate
npm run workflow:event:validate
npm run workflow:event:validate:orchestrator
npm run workflow:event:validate:orchestrator:invalid
npm run mcp:repo-split:smoke
```

Caretaker checks:

```bash
npm run caretaker:observe
npm run caretaker:observe:json
npm run caretaker:dry-run
CARETAKER_REPO_SCOPE=self node dist/tools/repo_caretaker.js --dry-run --execute --json
```

If local `gh` is unauthenticated, caretaker observation may skip GitHub data.
Do not treat that as proof that the workflow is broken. GitHub Actions should
use `github.token` for SELF scope and `CARETAKER_GH_TOKEN` for cross-repo scope.

## Change Discipline

- Keep PRs small. Prefer one behavioral fix, one contract update, or one
  documentation migration per PR.
- Do not mix unrelated dirty worktree changes into a fix.
- For generated files, caches, `node_modules`, `dist`, `__pycache__`, local logs,
  and temporary clone directories, avoid committing them unless the repository
  already tracks the file intentionally.
- For Copilot cloud-agent issue triage, prefer one tool call per turn until the
  first external result is available; only parallelize after that. This keeps
  the audit trail deterministic and avoids duplicate function-call collisions.
- When changing workflow YAML, also validate that it parses with the local `yaml`
  package or equivalent.
- When changing TypeScript, run `npm run build` before proposing the PR.
- When changing governance or constitution-adjacent code, include the specific
  invariant/failure-code behavior in the PR summary.

## PR Summary Expectations

Every Copilot-authored PR should state:

- What changed.
- Why the change is safe.
- Which validation commands were run.
- What remains unverified.
- Whether any sovereign, schema, ledger, or workflow boundary was touched.

If a request conflicts with these instructions or `.agent.md`, stop and explain
the blocked boundary instead of silently bypassing it.
