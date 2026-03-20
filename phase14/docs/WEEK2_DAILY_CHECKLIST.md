# Phase14 Week2 Daily Operations Checklist

## 🎯 Daily 5-Minute Pre-Flight Check

Use this every morning to keep operations on track.

### EWI Morning Scan (all weekdays)

- [ ] review_throughput trend normal (3-day moving average stable)
- [ ] false_positive_rejection_rate stable (no abrupt increase)
- [ ] deferred ratio <10% of reviewed volume
- [ ] queue_age_p50 not rising (check if today's queue is older than yesterday)

Record:
```text
EWI triggers today: 0 / 1 / 2+
```

Action rule:
```text
0   -> continue normal operation
1   -> AT_RISK_PRECHECK (same-day triage)
2+  -> 4h review + tuning/rollback readiness
```

---

## **MONDAY Morning (09:00)**

- [ ] **Discovery Run Start**
  ```bash
  .venv\Scripts\python.exe phase14/scripts/run_phase14_pipeline.py
  ```
  
- [ ] **Validate Outputs**
  ```
  ✓ clustering_output.csv exists
  ✓ candidate_snapshot.csv exists (row count: expect >50)
  ✓ review_queue.csv exists
  ```
  
- [ ] **Check Priority Score**
  ```bash
  .venv\Scripts\python.exe phase14/scripts/verify_priority_score.py
  ```
  Expected: `Is descending order: True`

- [ ] **Notify Review Team**
  - Message: "Review queue ready. Priority order confirmed. Start sessions TUE 09:00"

**Time Estimate:** 5 minutes

---

## **TUESDAY–WEDNESDAY Morning (before 09:00)**

- [ ] **Welcome Reviewers**
  - Review_queue.csv is ready on shared drive
  - Batch size: 20–50 candidates per session
  - SLA reminder: 30 seconds per decision

- [ ] **Monitor First Hour**
  - Throughput check at 10:00 (should be ~60+ candidates/hour)
  - Any issues? Contact Tech Lead immediately

- [ ] **Session Tracking**
  - Review session name & date in folder
  - Record count of reviewed candidates

**Time Estimate:** 3 minutes per session start

---

## **WEDNESDAY Evening (EOD)**

- [ ] **Review Progress Check**
  - Total reviewed so far: _____ candidates
  - If <100 reviewed by EOD WED: extend review to THU morning

**Time Estimate:** 2 minutes

---

## **THURSDAY Morning (09:00)**

- [ ] **Pre-Gate Checklist**
  - review_queue.csv complete (all decisions recorded)
  - No pending candidates should remain

- [ ] **Gate Process**
  - Gather 2+ reviewers
  - Multi-reviewer validation on borderline cases
  - Apply high-confidence decisions to matrix

- [ ] **Risk Check**
  ```
  approved_count / total_reviewed = approval_rate
  
  • If >90%: Check for quality drift
  • If <50%: Check clustering parameters
  • If 60–80%: ✓ On track
  ```

**Time Estimate:** 5 minutes (gate meeting separate)

---

## **FRIDAY Morning (09:00)**

- [ ] **Metrics Compilation for Weekly Report**
  
  **Governance Core Metrics to gather:**
  
  ```
  reviewed_candidates = approved + rejected + deferred

  1. review_throughput = reviewed_candidates / day
  2. rule_adoption_rate = approved_rules / reviewed_candidates
  3. false_positive_rejection_rate = rejected_rules / reviewed_candidates
  ```

  **Thresholds:**
  ```
  review_throughput
    GREEN  >=30/day
    YELLOW 15-29/day
    RED    <15/day

  rule_adoption_rate
    GREEN  0.15-0.40
    YELLOW <0.15 or >0.40
    RED    <0.05

  false_positive_rejection_rate
    GREEN  0.40-0.70
    YELLOW 0.70-0.85
    RED    >0.85
  ```

- [ ] **Risk Dashboard Check**
  
  ```
  review_throughput:             [N/day]   [GREEN/YELLOW/RED]
  rule_adoption_rate:            [0.00]    [GREEN/YELLOW/RED]
  false_positive_rejection_rate: [0.00]    [GREEN/YELLOW/RED]

  system_state:
    HEALTHY  all GREEN
    AT_RISK  any YELLOW
    DEGRADED any RED
  ```

- [ ] **Dispatch Audit Telemetry Check**

  ```bash
  npm run workflow:dispatch:audit:telemetry
  ```

  ```text
  validation_failure_count > 0         -> review note
  missing_required_context_count > 0   -> hard attention
  dispatch_ready_rate < 1.0            -> investigation
  ```

  Record:
  ```text
  dispatch_governance_signal: [ok / review_required / hard_attention]
  failures_by_week: [summary]
  ```

- [ ] **Governance Trend Panel (Friday only)**

  ```text
  GOVERNANCE METRICS TREND
  ─────────────────────────────────────────────
  review_throughput
    3d_avg:   [N]/day
    7d_avg:   [N]/day
    trend:    ↑ / ↓ / →

  rule_adoption_rate
    3d_avg:   [0.00]
    7d_avg:   [0.00]
    trend:    ↑ / ↓ / →

  false_positive_rejection_rate
    3d_avg:   [0.00]
    7d_avg:   [0.00]
    trend:    ↑ / ↓ / →
  ─────────────────────────────────────────────
  trend_warning: [true / false]
  ```

  Trend rule:
  ```text
  |3d_avg - 7d_avg| < 5%   ->  → stable
  else sign(3d - 7d)        ->  ↑ or ↓

  trend_warning = true  if:
    throughput ↓  OR  adoption ↓  OR  fp_rejection ↑
  ```

  Action:
  ```text
  trend_warning = false  ->  note in report, no action
  trend_warning = true   ->  flag in GOVERNANCE TREND ANALYSIS section of report
                             + elevate to AT_RISK_PRECHECK if 2+ metrics drifting
  ```

- [ ] **Governance Velocity Check (Friday only)**

  ```text
  rule_cycle_time
    median:            [N]h
    p90:               [N]h

    queue_wait_time:   [N]h
    review_time:       [N]h
    gate_time:         [N]h
  ```

  Thresholds:
  ```text
  < 24h   ideal
  < 48h   GREEN  (L3 candidate)
  48-72h  YELLOW (watch)
  > 72h   RED    (governance stall → escalate)
  ```

  Action:
  ```text
  GREEN   ->  record in GOVERNANCE VELOCITY section of report
  YELLOW  ->  identify bottleneck (queue_wait / review / gate)
  RED     ->  AT_RISK + escalate to Tech Lead same day
  ```

- [ ] **Week2 Baseline Fixation (Day1-Day3 window only)**

  ```bash
  python phase14/scripts/aggregate_week2_baseline_metrics.py --output phase14/data/week2_baseline_metrics.json
  python phase14/scripts/assess_week2_baseline.py --input-file phase14/data/week2_baseline_metrics.json
  ```

  If baseline input is still incomplete, start the watcher:

  ```bash
  python phase14/scripts/watch_week2_baseline_fixation.py
  ```

  The watcher waits for the first completed reviews, re-runs aggregation, executes baseline assessment, and updates WEEK2_REPORT_TEMPLATE.md automatically.

- [ ] **Weekly Report Template**
  - Open: `WEEK2_REPORT_TEMPLATE.md`
  - Fill in all sections
  - Get sign-offs (Tech Lead, Ops Manager, Governance Owner)

**Time Estimate:** 10 minutes (report writing separate)

---

## **FRIDAY EOD (17:00)**

- [ ] **Report Sign-Off**
  - [ ] Tech Lead signed
  - [ ] Operations Manager signed
  - [ ] Governance Owner signed
  
- [ ] **Archive Report**
  ```bash
  mv WEEK2_REPORT.md phase14/reports/WEEK2_REPORT_[YYYY-MM-DD].md
  ```

- [ ] **Next Week Prep**
  - Confirm reviewers available for Week 3
  - Note any tuning needed for next clustering run

**Time Estimate:** 5 minutes

---

## **Weekly Risk Response Matrix**

If any of these signals appear, take immediate action:

### 🔴 CRITICAL (Halt & Escalate)

| Signal | Response | Owner |
|--------|----------|-------|
| candidates >300/week | Stop review, escalate to HLG | Tech Lead + Gov Owner |
| approval_rate >95% | Audit clustering quality | Tech Lead |
| review_throughput <15/day | Add capacity immediately, recover backlog | Ops Manager |
| priority_score not descending | Re-run pipeline, debug rule mining | Tech Lead |
| false_positive_rejection_rate >0.85 | Tighten mining thresholds, run audit | Tech Lead |

### 🟠 HIGH (Fix Next Day)

| Signal | Response | Owner |
|--------|----------|-------|
| candidates 100–150/week | Raise support_min/confidence_min | Tech Lead |
| approval_rate <40% | Audit gate thresholds | Gov Owner |
| review_throughput 15–29/day | Optimize session flow, reduce blockers | Ops Manager |
| rule_adoption_rate <0.15 or >0.40 | Audit mining quality/reviewer strictness | Gov Owner |

### 🟡 MEDIUM (Monitor Daily)

| Signal | Response | Owner |
|--------|----------|-------|
| candidates 80–100/week | Monitor trend | Tech Lead |
| rule_adoption_rate near thresholds | Log trend for weekly report | Ops Manager |
| 2+ ambiguous decisions | Escalate to Tech Lead | Reviewer |

---

## **Daily Standup Talking Points (30 sec)**

**Monday 09:30:**
> "Discovery run complete. 100 candidates generated. Quality check passed. Review queue ready for TUE sessions. Priority order verified."

**Tuesday–Wednesday 17:00:**
> "Review progress: [N] candidates reviewed so far. [N] approved, [N] rejected. Throughput: [X] cand/hr. On track? Yes/No/Caution"

**Thursday 17:00:**
> "Promotion gate complete. [N] candidates approved and applied to matrix. All sign-offs documented. Next: Friday metrics compilation."

**Friday 17:00:**
> "Weekly report signed off. Status: ON TRACK / CAUTION / INTERVENTION. Week 3 preview: [plan]. No blockers."

---

## **Key Contacts**

| Role | Name | Contact | Response Time |
|------|------|---------|----------------|
| Tech Lead | _____ | _____ | <1h |
| Ops Manager | _____ | _____ | <1h |
| Governance Owner | _____ | _____ | <4h |
| HLG Escalation | _____ | _____ | On-demand |

---

## **Quick Command Reference**

```bash
# Run weekly pipeline
.venv\Scripts\python.exe phase14/scripts/run_phase14_pipeline.py

# Verify priority order
.venv\Scripts\python.exe phase14/scripts/verify_priority_score.py

# View candidate snapshot
cat phase14/data/candidate_snapshot.csv | head -20

# View review queue status
cat phase14/data/review_queue.csv | grep "pending" | wc -l

# Check for missing files
ls -lh phase14/data/*.csv
```

---

## **Approval Checkpoints**

**Monday (Discovery):** Tech Lead approval required  
**Wednesday (Review):** Operations Manager check-in  
**Thursday (Gate):** Governance Owner decision required  
**Friday (Report):** All 3 sign-offs required  

---

## **Operational Incident Prevention (Week2)**

This section defines prevention and recovery for the three most frequent Week2 incidents.

### 1) Review Queue Saturation

**Signal (early detection):**
- Pending queue growth for 2 consecutive sessions
- `review_throughput` in YELLOW (15-29/day)

**Immediate action (same day):**
- Add one reviewer for next session
- Reduce batch from 50 to 30
- Prioritize top-score segment only for current session

**Automatic recovery target:**
- Return to GREEN throughput (`>=30/day`) within 24h

### 2) Mining Noise Spike

**Signal (early detection):**
- `false_positive_rejection_rate` enters YELLOW/RED
- Sudden increase of low-quality candidates in top queue

**Immediate action (same day):**
- Tighten mining thresholds (support/confidence/lift)
- Run focused audit on top 20 rejected candidates
- Pause promotion for flagged clusters until recheck

**Automatic recovery target:**
- `false_positive_rejection_rate < 0.75` by next Friday report

### 3) Review Bottleneck

**Signal (early detection):**
- High deferred count in two consecutive sessions
- Promotion gate cannot start on Thursday 09:00

**Immediate action (same day):**
- Trigger overflow session (Thursday AM)
- Escalate ambiguous cases to Tech Lead in batch
- Freeze new low-priority intake until backlog clears

**Automatic recovery target:**
- Gate starts within 4h of planned time
- Deferred queue reduced below 10% of reviewed volume

### Incident Escalation Rule

```
If any incident remains unresolved for >24h:
  system_state = AT_RISK
If unresolved for >48h or any metric is RED:
  system_state = DEGRADED
  escalate to Governance Owner + HLG
```

---

**Prepared by:** Operations Team  
**Effective:** Week 2 (2026-03-11 onwards)  
**Review Date:** Every Friday EOD  
**Next Update:** Post-Week 2 retrospective
