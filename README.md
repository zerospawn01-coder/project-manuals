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

## Promotion Path

- Inbound: reusable procedures and workflow contracts extracted from active repositories.
- Outbound: code-heavy implementations should move back into the repository that owns the runtime.
- Repository role: workflow and operational knowledge repository with ongoing maintenance biased toward repeatable procedure.
