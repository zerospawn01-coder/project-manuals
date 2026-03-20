# Phase14 Operational Runbook

## Overview

Week2–4 operational procedures for clustering discovery, candidate review, promotion gate, and weekly reporting.

---

## Weekly Loop Structure

```
MON     → Discovery run (clustering)
TUE-WED → Human review sessions
THU     → Promotion gate
FRI     → A/B evaluation + reporting
```

---

## Monday: Discovery Run

### Execution

```bash
cd phase14/scripts
.venv\Scripts\python.exe run_phase14_pipeline.py
```

### Steps

1. **Extract**: Pull raw data from source
2. **Normalize**: Standardize formats and missing values
3. **Embed**: Generate feature vectors
4. **Cluster**: Run HDBSCAN (min_cluster_size=10, min_samples=5)
5. **Mine Rules**: Extract scoring rules
6. **Generate Candidates**: Apply priority_score, sort descending
7. **Initialize Queue**: Prepare review_queue.csv

### Output

- `clustering_output.csv` (raw clustering result)
- `candidate_snapshot.csv` (prioritized candidates)
- `review_queue.csv` (review work order)

### Validation

```python
import pandas as pd
df = pd.read_csv("phase14/data/candidate_snapshot.csv")
assert len(df) > 0, "No candidates generated"
assert (df["priority_score"].iloc[:-1].values >= df["priority_score"].iloc[1:].values).all(), "Not sorted descending"
print(f"✓ {len(df)} candidates ready for review")
```

### Failure Mode

If pipeline fails:
1. Check error log in console output
2. Verify clustering_output.csv exists
3. If <50 candidates: re-run pipeline
4. If >3 failures: escalate to Tech Lead

---

## Tuesday–Wednesday: Human Review Sessions

### Session Setup

**Time:** 2 sessions per day (09:00–12:00, 14:00–17:00)  
**Duration:** 3 hours per session  
**Batch:** 20–50 candidates  
**SLA:** 30 seconds per candidate  

### Reviewer Workflow

1. Open `review_queue.csv`
2. Take next "pending" candidate (sorted by priority_score)
3. Review decision criteria (see Kickoff doc)
4. Mark as "approved" or "rejected"
5. Record decision in review_queue.csv

### Decision Record Format

```csv
queue_position, candidate_id, priority_score, status, assigned_reviewer, reviewer_decision, review_completion_time
1, CUST_0086, 0.14, reviewed, alice@example.com, approved, 2026-03-11T09:05:00Z
2, CUST_0027, 0.13, reviewed, alice@example.com, rejected, 2026-03-11T09:36:00Z
```

### Escalation During Review

- **Ambiguous**: Pause > consult Tech Lead > resume
- **Safety concern**: Stop > escalate to Governance Owner immediately
- **Cluster quality issue**: Note issue > continue > flag for Thursday gate

---

## Thursday: Promotion Gate

### Entry Criteria

Review sessions complete, decisions recorded in review_queue.csv

### Gate Process

1. **Gather Decisions**: Compile approved candidates
2. **Multi-reviewer Check**: 2+ reviewers validate borderline cases
3. **Apply Confidence Threshold**: 
   - High confidence (2+ approve): PASS
   - Borderline (1 approve, 1 reject): escalate
   - Low confidence (2+ reject): DENY
4. **Update Promotion Matrix**: Apply passed candidates to operational matrix

### Output

- `promotion_decisions.csv` (approved candidates)
- `promotion_log.md` (gate audit trail)

### Failure Mode

If >30% candidates rejected:
- Escalate to HLG
- Review clustering parameters (support_min, confidence_min)
- Consider rule re-mining for next week

---

## Friday: A/B Evaluation + Weekly Report

### Metrics Compilation

Gather during week:
- `review_throughput`: reviewed_candidates/day
- `rule_adoption_rate`: approved_rules/reviewed_candidates
- `false_positive_rejection_rate`: rejected_rules/reviewed_candidates

Post-gate metrics freshness SLA:
- `SLA threshold`: 5 minutes
- `fresh`: latest metrics artifact is within 5 minutes of generation and has a `latest_watcher_run_id`
- `stale`: latest metrics artifact exists but exceeds the 5-minute SLA
- `missing`: no `latest_watcher_run_id` is present, so artifact freshness cannot be trusted

Definitions:
```
reviewed_candidates = approved + rejected + deferred
weekly_review_throughput = sum(reviewed_candidates) / 7
weekly_rule_adoption_rate = sum(approved_rules) / sum(reviewed_candidates)
weekly_fp_rejection_rate = sum(rejected_rules) / sum(reviewed_candidates)
```

Thresholds:
```
review_throughput
   GREEN  >= 30/day
   YELLOW 15-29/day
   RED    < 15/day

rule_adoption_rate
   GREEN  0.15-0.40
   YELLOW <0.15 or >0.40
   RED    <0.05

false_positive_rejection_rate
   GREEN  0.40-0.70
   YELLOW 0.70-0.85
   RED    >0.85
```

### Report Generation

Use `WEEK2_REPORT_TEMPLATE.md`

**Critical 3 metrics:**
```
review_throughput            = reviewed_candidates / day
rule_adoption_rate           = approved_rules / reviewed_candidates
false_positive_rejection_rate = rejected_rules / reviewed_candidates
```

System state rule:
```
HEALTHY  = all metrics GREEN
AT_RISK  = any YELLOW
DEGRADED = any RED
```

### Dispatch Audit Telemetry (Runtime Hardening Signal)

Run:

```bash
npm run workflow:dispatch:audit:telemetry
```

Evaluate:

```
validation_failure_count > 0         -> review note
missing_required_context_count > 0   -> hard attention
dispatch_ready_rate < 1.0            -> investigation
```

Operational action:

```
ok              -> continue weekly loop
review_required -> annotate weekly report + schedule triage
hard_attention  -> escalate to Governance Owner same day
```

Weekly gate propagation rule:

```
hard_attention    -> weekly_gate_status = ATTENTION_REQUIRED
review_required   -> keep baseline gate status + add review note
ok/insufficient_data -> keep baseline gate status
```

### Report Submission

- Generate report EOD Friday
- Review matrix changes
- Confirm all 3 sign-offs (Tech Lead, Ops Manager, Governance Owner)
- Archive in `phase14/reports/` 

---

## Risk Mitigation

### Candidate Explosion (>100/week)

**Signal:** Daily candidate_count spike  
**Fix:**
```yaml
# rule_mining.yaml
support_min: 10 → 20
confidence_min: 0.85 → 0.90
lift_min: 1.2 → 1.5
```

### Review Fatigue (<60 cand/hr)

**Signal:** Throughput drops  
**Fix:**
- Reduce batch_size (50 → 30)
- Rotate reviewers
- Extend review window (3h → 4h)

### Governance Stall (<15 reviews/day)

**Signal:** `review_throughput` in RED band  
**Fix:**
- Add reviewer capacity for Tue-Wed sessions
- Reduce per-session context switching
- Escalate to Ops Manager for backlog recovery plan

### Promotion Bottleneck (>30% reject)

**Signal:** Gate rejection spike  
**Fix:**
- Audit gate thresholds
- Review clustering parameters
- Escalate to HLG for governance decision

### Mining Noise (rejection rate >0.85)

**Signal:** `false_positive_rejection_rate` in RED band  
**Fix:**
- Increase support/confidence thresholds
- Re-check mining input quality
- Run focused audit on top rejected candidates

---

## L2 to L3 Promotion Gate

Promote maturity from L2 (Operational) to L3 (Governance Scale) only when all conditions hold for 4 consecutive weeks:

```
review_throughput >= 25/day
rule_adoption_rate in 0.15-0.40
false_positive_rejection_rate < 0.75
weekly system_state = HEALTHY
median_cycle_time < 48h          ← Governance Velocity gate
```

Note: `median_cycle_time` is the decisive L3 criterion.
Fast governance (cycle_time < 48h) = adaptive system = L3 capable.
If cycle_time grows, the system cannot scale to L3 regardless of other metrics.

---

## Weekly Cadence Checklist

- [ ] **Monday 09:00**: Discovery run starts
- [ ] **Monday 17:00**: Validation complete, review_queue.csv ready
- [ ] **Tuesday 09:00**: Session 1 starts
- [ ] **Wednesday 17:00**: Review sessions complete
- [ ] **Thursday 09:00**: Promotion gate starts
- [ ] **Thursday 14:00**: Gate decisions applied
- [ ] **Friday 09:00**: A/B metrics compilation
- [ ] **Friday 17:00**: Weekly report signed off

---

## Emergency Contacts

| Role | Contact | Availability |
|------|---------|--------------|
| Tech Lead | tech-lead@example.com | Daily 09:00–18:00 |
| Ops Manager | ops-mgr@example.com | Daily 09:00–18:00 |
| Governance Owner | gov-owner@example.com | On-demand |
| HLG Escalation | hlg-team@example.com | On-demand |

---

**Last Updated:** 2026-03-10  
**Effective:** Week2 (2026-03-11 onwards)
