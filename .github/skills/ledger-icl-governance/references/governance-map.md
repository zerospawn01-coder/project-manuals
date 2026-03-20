# Governance Map

Primary rejection classes:

- `MISSING_APPROVAL`
- `INSUFFICIENT_EVIDENCE`
- `SCOPE_OVERREACH`
- `INTENT_AMBIGUOUS`

Primary constraint types:

- `REQUIRE_APPROVAL`
- `REQUIRE_EVIDENCE`
- `DENY_IF_SCOPE_UNCLEAR`
- `ESCALATE_IF_AMBIGUITY_GT`
- `DENY_OPERATION`
- `SET_RESOURCE_LIMIT`
- `SET_TIMEOUT`
- `ENFORCE_AUDIT_LOG`
- `WARN_ONLY`

Rule patterns:

- Missing approval on first `SELF` occurrence: `WARN_ONLY` plus `ENFORCE_AUDIT_LOG`
- Missing approval on first `TENANT` or `GLOBAL` occurrence: `REQUIRE_APPROVAL`
- Missing approval at recurrence >= 5 with high or critical risk: `DENY_OPERATION`, HLG review required
- Insufficient evidence at low-risk first occurrence: `WARN_ONLY`
- Insufficient evidence at medium or higher first occurrence: `REQUIRE_EVIDENCE`
- Scope overreach on first occurrence: `DENY_IF_SCOPE_UNCLEAR` plus audit logging
- Intent ambiguity on first occurrence: `ESCALATE_IF_AMBIGUITY_GT`

Output template:

```yaml
rejection_class: MISSING_APPROVAL
constraint_types:
  - REQUIRE_APPROVAL
requires_hlg_review: false
rationale: Tenant-scope approval was missing, so the next attempt must require explicit approval.
```
