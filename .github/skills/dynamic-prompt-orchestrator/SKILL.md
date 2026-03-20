---
name: dynamic-prompt-orchestrator
description: 'Use when building a governance-aware dynamic prompt from current intent, action signature, and prior rejection traces. Keywords: dynamic prompt orchestration, hard filter, causal similarity, constraint injection, context compression, normalized request, ICL injection.'
argument-hint: 'Describe the raw request, operation, blast radius, and whether you need normalization, filtering, or prompt construction.'
user-invocable: true
---

# Dynamic Prompt Orchestrator

Use this skill to compose a minimal, governance-aware prompt from normalized requests and prior traces.

## Purpose
- Convert a raw operational request into a normalized prompt-building workflow.
- Decide what constraints and precedents should be injected.
- Keep prompt context compact, auditable, and risk-aware.

## Preconditions
- A raw request or action description exists.
- The target operation or resource can be identified.
- Risk, blast radius, or similar governance context is available.
- The caller needs structured prompt construction rather than freeform ideation.

## When To Use
- Normalize a raw action request into a structured intent record.
- Decide what prior traces should be injected into the prompt.
- Explain hard-filtering and causal-similarity steps.
- Build a compressed prompt for a risky operational decision.

## Inputs To Collect
- Raw intent string and parameters.
- Resource path or operation signature.
- Blast radius and risk level.
- Any prior rejection traces or known constitution rules.

## Outputs
- normalized request summary
- selected rules or precedent traces
- injected governance constraints
- compressed prompt or decision context

## Procedure
1. Normalize the request using the six-step flow in [orchestrator-flow](./references/orchestrator-flow.md).
2. Apply hard filters before scoring similarity.
3. Select the highest-value traces or rules for injection.
4. Force-inject governance constraints for high-risk cases.
5. Build a compressed output that preserves only the minimum necessary context.

## Output Rules
- Prefer structured intermediate output over vague summaries.
- Distinguish normalization, filtering, similarity, and prompt construction as separate steps.
- Keep the final injected context minimal and auditable.

## Stop Conditions
- The request cannot be normalized into a stable action signature.
- Required governance context is missing for a high-risk operation.
- Candidate precedents are contradictory and no clear filter result exists.

## Escalation
- Escalate when hard filters remove all safe precedents for a risky action.
- Escalate when injected constraints would materially change the requested operation.
- Escalate when the caller needs a policy decision instead of prompt assembly.

## Example Invocation
"Normalize this delete request, filter prior traces, inject governance constraints, and produce the compressed operator prompt."

## References
- [orchestrator-flow](./references/orchestrator-flow.md)
