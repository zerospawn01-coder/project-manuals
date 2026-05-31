# Project Manuals

`project-manuals` is the operational knowledge repository for reusable workflows, governance notes, runbooks, checklists, and split or migration procedures across the Antigravity ecosystem. Its purpose is not just to store documents, but to preserve executable operational knowledge that can be reused as playbooks, validation flows, and coordination assets.

## Scope

- Primary: runbooks, workflow specs, governance notes, checklists, and operator-facing tooling.
- Includes: reusable manual assets, workflow validators, repo split procedures, and phase-specific operations guidance.
- Excludes: mainline research code, standalone product implementation, and prototype-heavy experiment work.

## Non-goals

- Acting as a generic archive for documentation with no operational reuse value.
- Becoming the default home for core product or research implementation.
- Hiding repo-specific behavior that should live closer to the code it governs.

## Inputs

- Reusable runbooks, checklists, and workflow specifications.
- Governance notes and migration procedures that coordinate multiple repositories.
- Validation tooling whose main purpose is to support repeatable operations.

## Outputs

- Operator-facing procedures that can be executed without rediscovering hidden context.
- Validation paths that enforce workflow and governance assumptions.
- Shared knowledge assets that other repositories can reference instead of re-explaining locally.

## Validation

- `npm run build`
- `npm test`
- `npm run test:gate`
- `npm run workflow:validate`
- `npm run workflow:event:validate`
- `npm run workflow:event:validate:orchestrator`
- `npm run workflow:event:validate:orchestrator:invalid`
- `npm run mcp:repo-split:smoke`

## Tools Responsibility Inventory (Phase 1)

Phase 1 keeps the current `tools/` layout stable and documents responsibility boundaries before any future moves.

| Responsibility | Current tools/examples |
|---|---|
| Caretaker + recurring operations | `tools/repo_caretaker.ts`, `tools/nightly_loop_runner.ts`, `tools/collect_repo_inputs.ts` |
| Governance + gate decisions | `tools/merge_gate.ts`, `tools/comparison_gate_cli.ts`, `tools/verify_constitution.ts` |
| Ledger + audit artifacts | `tools/initialize_failure_ledger.ts`, `tools/openclaw_action_log_writer.ts`, `tools/human_review_writer.ts` |
| Workflow runtime validation | `tools/workflow_runtime/*` |
| Repo split operations + MCP surface | `tools/repo_split_*.ps1`, `tools/repo_split_mcp/*` |
| Orchestration + Phase 14 flow | `tools/phase*_orchestrator.ts`, `tools/phase14_live_fire.ts`, `tools/phase14_observation_collector.ts` |
| External adapter / runtime bridge | `tools/openclaw_cli.ts`, `tools/openclaw_gateway.ts` |

## Operational Command Matrix

| Situation | Command | Required? | Output | Failure action |
|---|---|---:|---|---|
| Compile all TypeScript | `npm run build` | Yes | `dist/` build output | Stop and fix compile errors before any gate/test command. |
| Core validation before merge | `npm run check` | Yes | Build + tamper + transaction gate results | Treat as merge blocker until passing. |
| Governance and constitution checks | `npm run check:governance` | Yes | Constitution verification + governance tests | Fail closed; update governance/test data, then re-run. |
| Workflow schema/event validation | `npm run check:workflow` | Yes (workflow changes) | Runtime validator output for valid workflow events | Fix schema/event payload mismatch, then re-run full workflow checks. |
| Expected invalid orchestrator sample | `npm run workflow:event:validate:orchestrator:invalid` | Optional | `ok: false` + required-field error | If it unexpectedly passes, treat validator behavior as regressed. |
| Repo split MCP smoke | `npm run mcp:repo-split:smoke` | Optional (repo-split changes) | MCP smoke report | Inspect tool/runtime output and fix repo-split surface before promotion. |
| Caretaker observation run | `npm run caretaker:observe` | Optional | Caretaker summary JSON + stdout summary | Review generated report, then decide execute/defer actions. |
| Phase14 live-fire cycle | `npm run live-fire` | Controlled | Live-fire and observation artifacts | Escalate to human review before acting on generated recommendations. |

## Promotion Path

- Inbound: reusable procedures and workflow contracts extracted from active repositories.
- Outbound: code-heavy implementations should move back into the repository that owns the runtime.
- Repository role: workflow and operational knowledge repository with ongoing maintenance biased toward repeatable procedure.

## Explicitly Deferred in Phase 1

- TypeScript strict mode enablement remains deferred in this phase.
- Broad `tools/` physical moves/renames are intentionally deferred until a dedicated follow-up phase.
