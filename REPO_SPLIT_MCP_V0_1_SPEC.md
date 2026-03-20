# Repo Split MCP v0.1 Spec

## Purpose

This document defines the first MCP application to build from this repository.

The goal is not to replace the existing PowerShell scripts. The MCP layer acts as a safe orchestration surface over the documented split workflow.

The design priorities are:

- low-risk startup
- explicit `dry-run -> confirm -> execute` transitions
- reusable abstractions that can later be lifted into Phase14 Ops

## Scope

Repo Split MCP v0.1 provides four operator-facing capabilities:

1. plan
2. preview
3. execute with confirmation
4. artifact lookup

This server is intentionally thin. It wraps the existing split runbook and scripts and adds state control, confirmation gating, and artifact tracking.

## Non-Goals

- It does not replace `tools/repo_split_plan.ps1` or the execution scripts.
- It does not introduce new split mapping logic.
- It does not expose Hub control flows.
- It does not expose `dynamic_prompt_orchestrator.ts` as a public MCP tool.
- It does not require `ledger_icl.ts` in v0.1.

## Existing Repo Anchors

Authoritative repo assets already available:

- [REPO_SPLIT_POWERSHELL_RUNBOOK.md](REPO_SPLIT_POWERSHELL_RUNBOOK.md)
- [SPLIT_EXECUTION_PLAYBOOK.md](SPLIT_EXECUTION_PLAYBOOK.md)
- [tools/repo_split_plan.ps1](tools/repo_split_plan.ps1)
- [tools/repo_split_copy.ps1](tools/repo_split_copy.ps1)
- [tools/repo_split_filter_repo.ps1](tools/repo_split_filter_repo.ps1)
- [tools/repo_split_archive.ps1](tools/repo_split_archive.ps1)

These assets remain the implementation backend.

## Responsibilities

The MCP surface is responsible for:

- exposing the split plan in structured form
- previewing split phases without making changes
- requiring explicit confirmation before destructive execution
- publishing runbooks, checklists, plans, previews, and execution logs as retrievable artifacts

## Surface Design

### Tools

#### `repo_split.plan`

Inputs:

- `layout`: `recommended | minimal`
- `includeDeferred`: `boolean`
- `format`: `json | summary`

Outputs:

- plan entries
- confirmed count
- deferred count
- excluded count
- required repositories
- warnings
- `planHash`

Notes:

- This is read-only.
- This wraps `tools/repo_split_plan.ps1`.
- This should normalize script output into a stable tool contract.

#### `repo_split.preview`

Inputs:

- `layout`
- `phase`: `copy | filter-repo | archive`
- `excludedAction`: `keep | archive | delete`
- `remoteScheme`: `https | ssh`
- `destinationRoot`
- `tempRoot`

Outputs:

- preview operations
- target repositories
- source paths
- migration modes
- estimated changes
- blockers
- warnings
- `artifactId`

Notes:

- This is strictly non-destructive.
- All previews must run in dry-run mode.
- This tool may call one of the existing PowerShell scripts with `-WhatIf`.

#### `repo_split.create_confirmation`

Inputs:

- `layout`
- `phase`
- `planHash`
- `reason`

Outputs:

- `confirmationId`
- `expiresAt`
- `scope`
- `planHash`

Notes:

- This exists to prevent accidental destructive execution.
- A confirmation must be phase-scoped.
- A confirmation must expire.

#### `repo_split.execute_confirmed`

Inputs:

- `layout`
- `phase`
- `confirmationId`
- `excludedAction`
- `remoteScheme`
- `destinationRoot`
- `tempRoot`

Outputs:

- `executionId`
- `status`
- changed targets
- follow-up actions
- `logArtifactId`
- `executionArtifactId`

Notes:

- This is the only destructive tool in v0.1.
- `confirmationId` is mandatory.
- `previewed` state alone must never be sufficient to execute.

#### `repo_split.lookup_artifact`

Inputs:

- `artifactId` or `kind`

Allowed `kind` values:

- `runbook`
- `cognitive-lab-checklist`
- `lab-experiments-checklist`
- `latest-plan`
- `latest-preview`
- `execution-log`

Outputs:

- artifact path
- title
- mime type
- short summary
- metadata

### Resources

Resources should be defined before expanding tool behavior.

#### Static Resources

- `repo-split://runbook/main`
- `repo-split://checklist/cognitive-lab-phase1`
- `repo-split://checklist/lab-experiments`
- `repo-split://schema/plan-entry`
- `repo-split://schema/preview-operation`
- `repo-split://schema/confirmation`
- `repo-split://schema/execution-state`

#### Dynamic Resources

- `repo-split://plan/recommended`
- `repo-split://plan/minimal`
- `repo-split://preview/{phase}`
- `repo-split://executions/{executionId}`
- `repo-split://logs/{executionId}`

The static versus dynamic split is intentional and should be preserved for later Phase14 reuse.

### Prompts

Only a small prompt surface is needed.

#### `repo_split.review_plan`

Use this to compress a plan into a human review view.

Expected output:

- confirmed items
- deferred items
- excluded items
- notable warnings
- affected repositories

#### `repo_split.operator_brief`

Use this to generate a short operator brief before execution.

Expected output:

- today’s action
- blockers
- follow-up actions
- confirmation status

## State Model

Repo Split MCP should behave as a small state machine.

### States

- `idle`
- `planned`
- `previewed`
- `confirmed`
- `executing`
- `executed`
- `failed`
- `archived`

### Valid Transitions

- `idle -> planned`
- `planned -> previewed`
- `previewed -> confirmed`
- `confirmed -> executing`
- `executing -> executed`
- `executing -> failed`
- `executed -> archived`

### Invariants

- `previewed` must not transition directly to execution.
- `execute_confirmed` must reject missing or expired confirmations.
- confirmations must be scoped to a specific phase.
- execution artifacts must retain `planHash` linkage.

## JSON Schema Core

### PlanEntry

```json
{
  "type": "object",
  "required": [
    "sourcePath",
    "category",
    "targetRepo",
    "targetPath",
    "migrationMode",
    "confidence",
    "disposition"
  ],
  "properties": {
    "sourcePath": { "type": "string" },
    "category": { "type": "string" },
    "targetRepo": { "type": "string" },
    "targetPath": { "type": "string" },
    "migrationMode": {
      "type": "string",
      "enum": ["copy", "filter-repo", "archive", "exclude"]
    },
    "confidence": {
      "type": "string",
      "enum": ["confirmed", "provisional"]
    },
    "disposition": {
      "type": "string",
      "enum": ["migrate", "deferred", "exclude", "archive"]
    },
    "notes": { "type": "string" }
  }
}
```

### PreviewOperation

```json
{
  "type": "object",
  "required": [
    "phase",
    "action",
    "sourcePath",
    "targetRepo",
    "targetPath",
    "destructive"
  ],
  "properties": {
    "phase": {
      "type": "string",
      "enum": ["copy", "filter-repo", "archive"]
    },
    "action": { "type": "string" },
    "sourcePath": { "type": "string" },
    "targetRepo": { "type": "string" },
    "targetPath": { "type": "string" },
    "destructive": { "type": "boolean" },
    "requiresConfirmation": { "type": "boolean" },
    "warnings": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
```

### Confirmation

```json
{
  "type": "object",
  "required": ["confirmationId", "planHash", "phase", "expiresAt"],
  "properties": {
    "confirmationId": { "type": "string" },
    "planHash": { "type": "string" },
    "phase": { "type": "string" },
    "expiresAt": { "type": "string", "format": "date-time" },
    "scope": {
      "type": "string",
      "enum": ["copy", "filter-repo", "archive", "full-run"]
    }
  }
}
```

## Artifact Model

Artifacts exist for human review and auditability.

### Artifact ID Format

```text
repo-split/<kind>/<timestamp>-<short-hash>
```

Examples:

- `repo-split/plan/2026-03-14T13-22-11Z-a91b2f`
- `repo-split/preview/filter-repo-2026-03-14T13-31-09Z-c1d88a`
- `repo-split/execution/archive-2026-03-14T13-44-02Z-91de43`

### Artifact Metadata

- `kind`
- `layout`
- `phase`
- `planHash`
- `createdAt`
- `operator`
- `destructive`

## Error Model

The v0.1 tool layer should normalize backend failures into stable error categories.

Recommended categories:

- `INVALID_INPUT`
- `PLAN_NOT_FOUND`
- `PREVIEW_FAILED`
- `CONFIRMATION_REQUIRED`
- `CONFIRMATION_EXPIRED`
- `CONFIRMATION_SCOPE_MISMATCH`
- `EXECUTION_BLOCKED`
- `SCRIPT_FAILURE`
- `ARTIFACT_NOT_FOUND`

## Implementation Notes

- Start with read-only plan and preview functionality.
- Route all destructive operations through explicit confirmation state.
- Do not place `hub/server.ts` at the center of this first MCP.
- Keep `dynamic_prompt_orchestrator.ts` internal as a future policy engine.
- Keep `ledger_icl.ts` out of the first implementation and add it later as a gate backend if needed.

## Ticket Breakdown

### Ticket 1

Define Repo Split MCP schemas and state model.

Deliverables:

- PlanEntry schema
- PreviewOperation schema
- Confirmation schema
- execution state transitions

### Ticket 2

Expose repo split runbook and checklists as MCP resources.

Deliverables:

- runbook resource
- cognitive-lab checklist resource
- lab-experiments checklist resource

### Ticket 3

Implement `repo_split.plan`.

Deliverables:

- invoke underlying plan script
- normalize structured output
- compute `planHash`

### Ticket 4

Implement `repo_split.preview`.

Deliverables:

- support `copy`, `filter-repo`, `archive`
- enforce no-write preview path
- produce preview artifact

### Ticket 5

Implement confirmation gating.

Deliverables:

- `repo_split.create_confirmation`
- TTL enforcement
- phase scope binding

### Ticket 6

Implement `repo_split.execute_confirmed`.

Deliverables:

- validate confirmation token
- invoke underlying PowerShell script
- capture execution logs
- publish execution artifacts

### Ticket 7

Implement artifact lookup and execution log resources.

Deliverables:

- latest plan lookup
- latest preview lookup
- execution log lookup

## Reuse Path For Phase14

The main reason to build Repo Split MCP first is that its abstractions lift directly into Phase14.

Shared abstractions:

- plan resource
- preview tool
- confirmation gate
- execution log artifact
- state machine

Likely naming shift in Phase14:

- `repo_split.plan` -> `phase14.plan_week`
- `repo_split.preview` -> `phase14.preview_assessment`
- `repo_split.create_confirmation` -> `phase14.create_gate_approval`
- `repo_split.execute_confirmed` -> `phase14.execute_baseline_fixation`
- artifact lookup -> weekly metrics and health log lookup

This is why Repo Split is the correct first implementation.
