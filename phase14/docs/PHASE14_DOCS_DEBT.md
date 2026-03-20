# Phase14 Docs Debt

## Scope
Track markdown/documentation cleanup debt separately from runtime/governance gate work.

## Current State
- Runtime/governance implementation is merge-ready.
- Markdown diagnostics include many style/format warnings that are non-blocking for gate logic.

## Debt Backlog
- Normalize heading hierarchy in Phase14 docs.
- Normalize list spacing and fenced code block language tags.
- Normalize table alignment and trailing whitespace.
- Add cross-links between runbook, checklist, and report template sections.

## Triage Policy
- Priority: `low` unless a docs issue causes operator misread or gate mis-execution.
- Bundle mechanical markdown fixes in dedicated docs-only PRs.
- Do not block Phase14 runtime/governance merges on markdown style debt.

## Exit Criteria
- `phase14/docs/*.md` warnings reduced to agreed baseline.
- Operator-facing sections keep parity with script output fields.
- Week2 report template sections remain runnable and current.
