# Workflow Catalog v0.1

## Purpose

This catalog is the human-readable index for the operational governance workflow family.

Source of truth:

- [operational_governance_stack.v0.1.yaml](operational_governance_stack.v0.1.yaml)

## Executable Validation Index

This catalog is also the execution index for fail-closed governance checks.

| Layer | Source Artifact | Validator / Runtime | Command | Pass Condition | Fail-Closed Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Workflow topology and stage transitions | [operational_governance_stack.v0.1.yaml](operational_governance_stack.v0.1.yaml) | [stateMachineValidatorCli.ts](../tools/workflow_runtime/stateMachineValidatorCli.ts) + [state_machine_validator.v0.1.yaml](state_machine_validator.v0.1.yaml) | `npm run workflow:validate` | JSON report contains `"ok": true` and empty `errors` | Non-zero exit code blocks CI merge path |
| Workflow event contract | [event_schema.v0.1.json](event_schema.v0.1.json) + [samples/valid_workflow_event.v0.1.json](samples/valid_workflow_event.v0.1.json) | [validateEventCli.ts](../tools/workflow_runtime/validateEventCli.ts) | `npm run workflow:event:validate` | JSON report contains `"ok": true` and empty `errors` | Non-zero exit code blocks CI merge path |
| Orchestrator dispatch contract (valid sample) | [event_schema.v0.1.json](event_schema.v0.1.json) + [samples/valid_dynamic_prompt_dispatch_event.v0.1.json](samples/valid_dynamic_prompt_dispatch_event.v0.1.json) | [validateEventCli.ts](../tools/workflow_runtime/validateEventCli.ts) | `npm run workflow:event:validate:orchestrator` | JSON report contains `"ok": true` and empty `errors` | Non-zero exit code blocks CI merge path |
| Orchestrator dispatch contract (invalid sample) | [event_schema.v0.1.json](event_schema.v0.1.json) + [samples/invalid_dynamic_prompt_dispatch_event_missing_correlation.v0.1.json](samples/invalid_dynamic_prompt_dispatch_event_missing_correlation.v0.1.json) | [validateEventCli.ts](../tools/workflow_runtime/validateEventCli.ts) | `npm run workflow:event:validate:orchestrator:invalid` (must fail) | CLI exits non-zero due to missing required field | CI step fails if invalid sample unexpectedly passes |

## CI Wiring (Fail-Closed)

- Workflow file: [../.github/workflows/workflow-governance-validation.yml](../.github/workflows/workflow-governance-validation.yml)
- Triggered on:
  - Pull requests touching `workflows/**`, `tools/workflow_runtime/**`, `contract/**`, `package.json`, `package-lock.json`, or workflow file itself
  - Pushes to `main` and `phase14-readiness-gate` with the same paths
  - Manual dispatch (`workflow_dispatch`)
- Required outcome:
  - Both validators must pass, otherwise merge path is blocked by job failure

## Audit Outputs

- State machine validation output: JSON report emitted by [stateMachineValidatorCli.ts](../tools/workflow_runtime/stateMachineValidatorCli.ts)
- Event schema validation output: JSON report emitted by [validateEventCli.ts](../tools/workflow_runtime/validateEventCli.ts)
- Dispatch audit telemetry output: JSON report emitted by [dispatchAuditTelemetryCli.ts](../tools/workflow_runtime/dispatchAuditTelemetryCli.ts) via `npm run workflow:dispatch:audit:telemetry`
- Runtime and operational artifacts: repository [../logs/](../logs/) and Phase14 datasets under [../phase14/data/](../phase14/data/)

Telemetry keys tracked from dispatch audit logs:

- `validation_failure_count`
- `missing_required_context_count`
- `dispatch_ready_rate`
- `failures_by_week`
- `failures_by_run`

## Family

- Family ID: `operational_governance_stack`
- Version: `0.1`
- Parent workflow: `phase14_weekly_ops`
- Middleware workflow: `dynamic_prompt_orchestrator`
- Service workflow: `hub_monitoring_recovery`
- Canonical dispatch route: `orchestrateAndDispatch()` (treat direct `orchestrate()` use as low-level/internal).

## Topology

- `dynamic_prompt_orchestrator -> phase14_weekly_ops`
  - Relation: normalizes and routes inputs
- `dynamic_prompt_orchestrator -> hub_monitoring_recovery`
  - Relation: normalizes and routes service actions
- `hub_monitoring_recovery -> phase14_weekly_ops`
  - Relation: supplies service health and incident context

## Common Controls

### Shared states

- `PENDING`
- `RUNNING`
- `PASS`
- `FAIL`
- `INCOMPLETE`
- `DEGRADED`
- `BLOCKED`
- `ESCALATED`

### Shared idempotency key

- Template: `{week_id}:{stage_id}:{run_id}`
- Duplicate policy: reject duplicate execution or return existing result

### Shared event keys

- `trace_id`
- `correlation_id`
- `run_id`
- `workflow_id`
- `stage_id`
- `week_id`

## Workflow Index

## 1) phase14_weekly_ops

- Type: `parent_operational_workflow`
- Purpose: execute weekly Phase14 operations and prove baseline continuity and HEALTHY streak progression.
- Stage count: 6

Stages:

- `weekly_context_initialization`
- `discovery`
- `review`
- `gate`
- `report`
- `baseline_monitoring`

Primary outputs:

- `weekly_assessment`
- `weekly_report`
- `gate_decision`
- `baseline_monitoring_snapshot`
- `healthy_streak_transition`
- `next_actions`

## 2) dynamic_prompt_orchestrator

- Type: `policy_middleware_workflow`
- Purpose: normalize, classify, route, and govern requests before execution.
- Stage count: 6

Stages:

- `intake_normalization`
- `policy_classification`
- `routing`
- `prompt_shaping`
- `approval_escalation`
- `dispatch`

Primary outputs:

- `normalized_task_payload`
- `policy_class`
- `routing_decision`
- `approval_status`
- `dispatch_record`

## 3) hub_monitoring_recovery

- Type: `service_workflow`
- Purpose: monitor hub service health, classify faults, recover safely, and verify recovery.
- Stage count: 6

Stages:

- `baseline_health_capture`
- `monitoring`
- `detection`
- `diagnosis`
- `recovery_action`
- `verification`

Primary outputs:

- `health_snapshot`
- `incident_classification`
- `diagnosis_result`
- `recovery_action_record`
- `recovery_status`

## Ownership Map

- Operator: starts workflows and requests escalation
- Reviewer: review-stage approvals and evidence annotations
- Approver: high-risk approvals and gate override approvals
- Incident commander: incident declaration and manual recovery authority
- Admin: policy/baseline changes and force reset with audit

## Build Order

1. Maintain this catalog as the first human-facing index.
2. Validate stage transitions with `state_machine_validator.v0.1.yaml`.
3. Enforce role decisions using `approval_matrix.v0.1.yaml`.
4. Emit and validate event payloads with `event_schema.v0.1.json`.

## Status

- Asset status: fixed as v0.1 specification.
- External YAML parser verification: not yet confirmed in this repository environment.
