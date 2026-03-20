---
name: repo-split-operator
description: 'Use when planning or executing the scratch repository split on Windows PowerShell. Keywords: repo split, scratch split, filter-repo, copy phase, archive phase, cognitive-lab, lab-experiments, project-manuals, split runbook, day-of execution.'
argument-hint: 'Describe the split task, target layout, and whether you need planning, execution commands, or verification.'
user-invocable: true
---

# Repo Split Operator

Use this skill for the Windows PowerShell workflow that splits `scratch` into the optimized successor repositories.

## Purpose
- Convert a split request into an executable PowerShell run sequence.
- Keep the operator aligned with the current approved repository mapping.
- Make stop points and verification gates explicit before destructive steps.

## Preconditions
- The source `scratch` checkout exists locally and is clean enough to inspect.
- The operator knows whether the request is `recommended` or `minimal` layout.
- Required split scripts and runbooks are available in the workspace.
- Any destination repositories needed for push steps are known or explicitly deferred.

## When To Use
- Generate or review the day-of split command sequence.
- Check whether a requested split plan matches the current recommended or minimal layout.
- Verify the correct order for `plan`, `copy`, `filter-repo`, and `archive`.
- Explain which repositories are in scope for the current first-pass migration.

## Inputs To Collect
- Root path of the full `scratch` checkout.
- Target layout: `recommended` or `minimal`.
- Whether the user wants a dry-run, real execution, or final verification.
- Whether GitHub destination repositories already exist.

## Outputs
- Ordered execution steps.
- Ready-to-run PowerShell commands.
- Stop conditions before copy, filter, push, or archive.
- Verification checklist for remotes, branch state, and extracted directories.

## Procedure
1. Confirm whether the user wants the optimized 5-repo layout or the minimal fallback.
2. Anchor all guidance to the current mapping and deferred-directory policy in [split-reference](./references/split-reference.md).
3. If the user needs execution help, produce commands in this order: `repo_split_plan.ps1`, `repo_split_copy.ps1`, `repo_split_filter_repo.ps1`, manual push, `repo_split_archive.ps1`.
4. Keep deferred directories out of the first-pass execution unless the user explicitly changes the plan.
5. Add preflight and post-run verification commands when producing an operator command list.

## Output Rules
- Prefer PowerShell commands that can be run as-is.
- Call out which repositories are created now versus deferred.
- Separate dry-run commands from write commands.
- Include remote and branch checks before history-preserving push steps.

## Stop Conditions
- The requested directory mapping differs from the approved split plan and has not been confirmed.
- The source repo is in a conflicting state for history-preserving operations.
- Destination repository names or remotes are unknown when a push sequence is requested.
- A deferred directory is being moved into scope without an explicit plan update.

## Escalation
- Escalate when the user wants to change the canonical 5-repo mapping.
- Escalate when filtered history output conflicts with the documented extraction boundaries.
- Escalate when archive actions would affect paths outside the approved exclusion set.

## Example Invocation
"Plan the recommended scratch split from C:\\work\\scratch and give me the exact dry-run and real PowerShell commands with stop checks."

## References
- [split-reference](./references/split-reference.md)
