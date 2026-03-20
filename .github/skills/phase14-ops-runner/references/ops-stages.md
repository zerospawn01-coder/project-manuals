# Phase14 Ops Stages

Weekly loop:

- Monday: discovery run
- Tuesday-Wednesday: human review sessions
- Thursday: promotion gate
- Friday: A/B evaluation and weekly report

Discovery run outputs:

- `clustering_output.csv`
- `candidate_snapshot.csv`
- `review_queue.csv`

Reviewer model:

- Binary decision: `APPROVE` or `REJECT`
- SLA: 30 seconds per candidate
- Batch size: 20-50 candidates per session

Promotion gate rules:

- 2 or more approvals: `PASS`
- Mixed decision: `ESCALATE`
- 2 or more rejections: `DENY`

Reporting metrics:

- `review_throughput = reviewed_candidates / day`
- `rule_adoption_rate = approved_rules / reviewed_candidates`
- `false_positive_rejection_rate = rejected_rules / reviewed_candidates`

System state:

- `HEALTHY`: all metrics green
- `AT_RISK`: any yellow
- `DEGRADED`: any red

Escalation triggers:

- candidate explosion
- reviewer fatigue
- governance stall
- promotion bottleneck
