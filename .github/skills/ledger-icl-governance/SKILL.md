---
name: ledger-icl-governance
description: 'Use when classifying failures into rejection classes and deriving governance constraints from ledger-based ICL rules. Keywords: ledger ICL, rejection class, constraint type, governance rule, HLG review, approval missing, insufficient evidence, scope overreach, intent ambiguous.'
argument-hint: 'Describe the failed action, blast radius, recurrence count, and risk level.'
user-invocable: true
---

# Ledger ICL Governance

Use this skill to turn failures, denials, or risky actions into structured governance outputs.

## Purpose
- Classify incidents into the repo's governance vocabulary.
- Derive repeatable constraint outputs from recurrence, scope, and risk.
- Make approval and HLG review requirements explicit.

## Preconditions
- The incident or rejection can be described in concrete terms.
- Scope, risk, and recurrence are known or can be estimated.
- The caller wants a governance decision, not a general narrative summary.

## When To Use
- Classify a failed or rejected action.
- Determine which constraint should be generated next.
- Decide whether HLG review is needed.
- Explain how recurrence and blast radius harden a rule.

## Inputs To Collect
- Failure or rejection summary.
- Blast radius.
- Risk level.
- Recurrence count.
- Any approval or evidence context.

## Outputs
- `rejection_class`
- `constraint_types`
- `requires_hlg_review`
- concise `rationale`

## Procedure
1. Map the incident to a `RejectionClass` using [governance-map](./references/governance-map.md).
2. Apply recurrence and scope conditions before selecting a `ConstraintType`.
3. State whether the result is warning, approval requirement, evidence requirement, escalation, or deny.
4. Mark whether HLG review is required.
5. If useful, summarize the rationale in one sentence tied to the rule set.

## Output Rules
- Always emit a structured result with `rejection_class`, `constraint_types`, `requires_hlg_review`, and `rationale`.
- Distinguish first occurrence behavior from recurrence behavior.
- Treat `TENANT` and `GLOBAL` scopes as higher-governance paths.

## Stop Conditions
- Risk, scope, or recurrence is too ambiguous to map responsibly.
- The request mixes multiple unrelated incidents that need separate classification.
- The caller wants policy invention beyond the ledger-backed rule vocabulary.

## Escalation
- Escalate when `TENANT` or `GLOBAL` impact combines with high or critical risk.
- Escalate when recurrence suggests a deny path but the evidence record is incomplete.
- Escalate when a proposed outcome falls outside the existing rejection or constraint taxonomy.

## Example Invocation
"Classify this failed tenant-scope action with missing approval, medium risk, and three prior occurrences into rejection class and constraint types."

## References
- [governance-map](./references/governance-map.md)
