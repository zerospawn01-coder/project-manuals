# Project Manuals

`project-manuals` is the operational knowledge repository for reusable workflows, governance notes, runbooks, checklists, and split or migration procedures across the Antigravity ecosystem. Its purpose is not just to store documents, but to preserve executable operational knowledge that can be reused as playbooks, validation flows, and coordination assets.

## Scope

- Primary: runbooks, workflow specs, governance notes, checklists, and operator-facing tooling.
- Includes: reusable manual assets, workflow validators, repo split procedures, and phase-specific operations guidance.
- Excludes: mainline research code, standalone product implementation, and prototype-heavy experiment work.

## What Belongs Here

- Documents that are meant to be reused operationally.
- Workflow contracts and validation tooling.
- Governance and migration procedures that coordinate other repositories.

## What Does Not Belong Here

- Core cognitive research implementation.
- Independent project code that needs its own delivery boundary.
- Early experiments whose main value is exploration rather than repeatable procedure.

## Validation

- `npm run build`
- `npm test`
- `npm run test:gate`
- `npm run workflow:validate`
- `npm run workflow:event:validate`
- `npm run workflow:event:validate:orchestrator`
- `npm run workflow:event:validate:orchestrator:invalid`
- `npm run mcp:repo-split:smoke`

## Positioning

- Role: workflow and operational knowledge repository
- Maintenance level: ongoing, but biased toward reusable procedure rather than feature growth
- Success condition: a future operator can run the documented process without reconstructing hidden context
