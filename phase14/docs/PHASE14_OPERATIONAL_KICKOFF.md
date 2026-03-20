# Phase14 Operational Kickoff 

## 概要

Week2 運用開始前の事前説明会（30分）  
全レビュアー・運用チームの alignment を確保

---

## 実施時期

**Week2 Monday, 09:00–09:30 JST**

---

## 参加者

- Governance Owner（司会）
- Tech Lead
- Operations Manager
- Review Team (2–3 reviewers)

---

## Agenda

| Time | Item | Owner |
|------|------|-------|
| 0:00–0:05 | Clustering acceptance recap | Tech Lead |
| 0:05–0:15 | Framework walkthrough (binary review, 30-sec SLA) | Ops Manager |
| 0:15–0:25 | Examples: 2–3 sample decisions | Reviewers |
| 0:25–0:30 | Q&A + week1 plan confirmation | Governance Owner |

---

## Key Points to Confirm

### 1. Clustering Acceptance Status

```
✓ clustering_output.csv: 100 samples
✓ candidate_snapshot.csv: 100 candidates
✓ priority_score: descending order
✓ Smoke test: PASS
```

**Message:** Clustering run is valid. Candidates ready for review.

---

### 2. Review Framework

#### Binary Review Model

- **Task**: Approve or Reject candidate for operational deployment
- **SLA**: 30 seconds per candidate
- **Batch**: 20–50 candidates per session
- **Sessions**: 2 sessions per week (TUE, WED)

#### Decision Criteria

```
APPROVE if:
  • Cluster quality: Good (size >5, coherence >0.7)
  • Candidate score: >0.10 (priority_score)
  • No safety concerns

REJECT if:
  • Cluster quality: Poor
  • Candidate score: <0.05
  • Behavioral anomaly detected
```

---

### 3. Example Decisions

**Example 1: APPROVE**
```
candidate_id: CUST_0086
priority_score: 0.14
cluster_id: 0
status: HIGH PRIORITY

Decision: APPROVE
Reason: Highest priority, clean cluster
```

**Example 2: REJECT**
```
candidate_id: CUST_0045
priority_score: 0.02
cluster_id: 3
status: LOW PRIORITY

Decision: REJECT
Reason: Below quality threshold
```

---

## Week2 Operational Loop

**Monday:** Clustering run (extract → normalize → cluster)  
**Tuesday–Wednesday:** Human review (binary approve/reject)  
**Thursday:** Promotion gate (2+ reviewers, apply to matrix)  
**Friday:** A/B eval + weekly report  

---

## Escalation Path

If review team encounters:

- **Ambiguous candidate**: Escalate to Tech Lead (same day)
- **Cluster quality concern**: Escalate to Governance Owner (EOD)
- **Safety flag**: Halt review, escalate to HLG immediately

---

## Next Steps

- Confirm all reviewers can access review_queue.csv
- Confirm Tuesday morning review session setup
- Confirm Friday report submission deadline (EOD)

**Please confirm by Sunday EOD.**

---

**Prepared by:** Tech Lead  
**Date:** 2026-03-10  
**Kickoff Date:** 2026-03-11 (Mon, Week2)
