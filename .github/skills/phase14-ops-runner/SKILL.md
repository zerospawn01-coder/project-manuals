---
name: phase14-ops-runner
description: 'Use when running or supporting the weekly Phase14 operating loop. Keywords: Phase14, weekly ops, discovery run, review queue, promotion gate, Monday clustering, Tuesday review, Thursday gate, Friday report, Week2 report.'
argument-hint: 'Describe the Phase14 task, current weekday or stage, and whether you need execution, review support, or reporting.'
user-invocable: true
---

# Phase14 Ops Runner

Use this skill to guide weekly Phase14 operations from discovery through reporting.

## Purpose
- Turn a Phase14 calendar stage into a concrete operating checklist.
- Keep review, gate, and reporting behavior aligned with the current runbook.
- Surface risk triggers and escalation points before the weekly loop drifts.

## Preconditions
- The current stage or weekday is known.
- Relevant files in `phase14/data/` are present or their absence is explicitly called out.
- The operator can provide review metrics, queue state, or gate outcomes when needed.
- Week2+ operations are being run under the current governance model.

## When To Use
- Run the Monday discovery pipeline.
- Guide reviewer operations for Tuesday and Wednesday sessions.
- Prepare or evaluate the Thursday promotion gate.
- Fill or summarize the Friday weekly report.

## Inputs To Collect
- Current operational stage: kickoff, discovery, review, gate, or report.
- Relevant data files in `phase14/data/`.
- Review throughput, approval/rejection counts, and any escalations.

## Outputs
- Stage-specific task list.
- Required checks and metrics for the current stage.
- Named escalation triggers and owner handoff points.
- A concise daily or weekly status summary when requested.

## Procedure
1. Map the request to the correct stage using [ops-stages](./references/ops-stages.md).
2. For discovery, verify outputs in `clustering_output.csv`, `candidate_snapshot.csv`, and `review_queue.csv`.
3. For review, keep guidance binary and SLA-oriented.
4. For promotion gate, separate `PASS`, `DENY`, and `ESCALATE` outcomes.
5. For reporting, use the fixed metrics and threshold bands before writing any summary.

## Output Rules
- Prefer stage-specific checklists over long prose.
- Include failure-mode and escalation rules when the stage has them.
- Keep metrics definitions explicit when discussing weekly status.

## Stop Conditions
- Discovery outputs needed for the next stage are missing or invalid.
- Review guidance is requested without queue state or throughput context.
- Promotion guidance is requested before reviewer decisions are available.
- Reporting is requested without the core weekly metrics.

## Escalation
- Escalate to governance when promotion outcomes are mixed or conflict frequency rises.
- Escalate to operations when throughput drops below target or fatigue signals appear.
- Escalate to technical owners when discovery artifacts are missing or pipeline stages fail.

## Example Invocation
"Run Phase14 Thursday gate support: summarize PASS, DENY, and ESCALATE criteria and tell me what to verify before promotion."

## References
- [ops-stages](./references/ops-stages.md)
