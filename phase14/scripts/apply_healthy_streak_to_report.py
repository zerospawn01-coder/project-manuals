#!/usr/bin/env python3
"""
apply_healthy_streak_to_report.py

Reads the weekly judge_healthy_streak.py JSON output and injects results
into WEEK2_REPORT_TEMPLATE.md, then saves a dated report file.

Injection targets (by exact marker text):
  1. Overall Status line (L16)
  2. Invariant Continuity Summary fenced block
  3. L2 to L3 Readiness Tracker fenced block

Usage:
  python phase14/scripts/apply_healthy_streak_to_report.py \\
      --streak-file phase14/data/week3_streak_result.json \\
      --output-dir phase14/reports

Dry-run (no file write):
  python ... --dry-run
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
from datetime import datetime
from pathlib import Path

# Ensure UTF-8 output on Windows terminals that default to cp932/cp1252
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

TEMPLATE_DEFAULT = (
    Path(__file__).parent.parent / "docs" / "WEEK2_REPORT_TEMPLATE.md"
)
REPORTS_DIR_DEFAULT = Path(__file__).parent.parent / "reports"


# ─── markers ──────────────────────────────────────────────────────────────────

_OVERALL_STATUS_RE = re.compile(
    r"(\*\*Overall Status:\*\*)\s+.+",
    re.MULTILINE,
)

_INV_SUMMARY_BLOCK_RE = re.compile(
    r"(### Invariant Continuity Summary\n\n```text\n)"
    r"(.*?)"
    r"(```)",
    re.DOTALL,
)

_L3_TRACKER_BLOCK_RE = re.compile(
    r"(### L2 to L3 Readiness Tracker\n\n```\n)"
    r"(.*?)"
    r"(```)",
    re.DOTALL,
)


# ─── helpers ──────────────────────────────────────────────────────────────────

def _status_icon(week_status: str) -> str:
    return {
        "HEALTHY": "⭐ ON TRACK",
        "AT_RISK": "⚠️ CAUTION",
        "DEGRADED": "🔴 INTERVENTION",
        "PRECHECK": "⚠️ PRECHECK",
    }.get(week_status, f"⚠️ {week_status}")


def _inv_continuity_text(streak: dict) -> str:
    """Build the fenced-block body for Invariant Continuity Summary."""
    week_status = streak.get("week_status", "UNKNOWN")
    fail_reasons = streak.get("fail_reasons", [])
    streak_count = streak.get("healthy_streak_count", 0)

    weekly_result = (
        "PASS" if week_status == "HEALTHY"
        else "WATCH" if week_status == "AT_RISK"
        else "FAIL"
    )
    gate_freeze = "yes" if any("gate_freeze" in r for r in fail_reasons) else "no"
    same_week_recovery = "no" if weekly_result == "FAIL" else ("yes" if weekly_result == "WATCH" else "n/a")
    streak_continues = "yes" if week_status == "HEALTHY" else "no"

    lines = [
        "INVARIANT CONTINUITY SUMMARY",
        "",
        f"weekly_result: {weekly_result}",
        "",
        "PASS  = no invariant violation, HEALTHY maintained",
        "WATCH = temporary YELLOW, recovered within same week",
        "FAIL  = invariant violation or gate freeze triggered",
        "",
        f"gate_freeze_occurred: {gate_freeze}",
        f"same_week_recovery: {same_week_recovery}",
        f"healthy_streak_continues: {streak_continues}",
    ]
    if fail_reasons:
        lines += ["", "fail_reasons:"] + [f"  - {r}" for r in fail_reasons]
    lines += [
        "",
        f"current_healthy_streak: {streak_count}/4",
    ]
    return "\n".join(lines) + "\n"


def _l3_tracker_text(streak: dict) -> str:
    """Build the fenced-block body for L2 to L3 Readiness Tracker."""
    streak_count = streak.get("healthy_streak_count", 0)
    l3_readiness = streak.get("l3_readiness", "NOT_ELIGIBLE")
    l3_status = "READY" if l3_readiness == "ELIGIBLE" else "NOT READY"

    evaluated = streak.get("evaluated_weeks", [])
    history_rows = []
    for w in evaluated[-4:]:
        icon = "✅" if w.get("week_status") == "HEALTHY" else "⬜"
        history_rows.append(f"  {icon} {w.get('week_id', '?')} ({w.get('week_status', '?')})")

    history_section = "\n".join(history_rows) if history_rows else "  (no weeks recorded)"

    return "\n".join([
        "Condition A: review_throughput >= 25/day",
        "Condition B: rule_adoption_rate in 0.15-0.40",
        "Condition C: false_positive_rejection_rate < 0.75",
        "Condition D: weekly system_state = HEALTHY",
        "",
        f"Consecutive HEALTHY weeks: [{streak_count}/4]",
        f"L3 Promotion Status: [{l3_status}]",
        "",
        "Rolling 4-week window:",
        history_section,
    ]) + "\n"


# ─── core ─────────────────────────────────────────────────────────────────────

def inject(template_text: str, streak: dict) -> str:
    week_status = streak.get("week_status", "UNKNOWN")

    # 1. Overall Status
    replacement = rf"\1 {_status_icon(week_status)}"
    text = _OVERALL_STATUS_RE.sub(replacement, template_text, count=1)

    # 2. Invariant Continuity Summary block
    inv_body = _inv_continuity_text(streak)
    text = _INV_SUMMARY_BLOCK_RE.sub(
        lambda m: m.group(1) + inv_body + m.group(3),
        text,
        count=1,
    )

    # 3. L3 Tracker block
    l3_body = _l3_tracker_text(streak)
    text = _L3_TRACKER_BLOCK_RE.sub(
        lambda m: m.group(1) + l3_body + m.group(3),
        text,
        count=1,
    )

    return text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--streak-file", required=True, help="Path to judge_healthy_streak.py JSON output")
    parser.add_argument("--template-file", default=str(TEMPLATE_DEFAULT))
    parser.add_argument("--output-dir", default=str(REPORTS_DIR_DEFAULT))
    parser.add_argument("--dry-run", action="store_true", help="Print result; do not write files")
    parser.add_argument("--json-summary", action="store_true", help="Print JSON injection summary only")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    streak = json.loads(Path(args.streak_file).read_text(encoding="utf-8"))
    template_text = Path(args.template_file).read_text(encoding="utf-8")

    result_text = inject(template_text, streak)

    week_id: str = streak.get("week_id", "UNKNOWN").replace(":", "-")
    date_str = datetime.now().strftime("%Y-%m-%d")
    report_name = f"{week_id}_REPORT_{date_str}.md"

    summary = {
        "week_id": streak.get("week_id"),
        "week_status": streak.get("week_status"),
        "healthy_streak_count": streak.get("healthy_streak_count"),
        "l3_readiness": streak.get("l3_readiness"),
        "report_file": report_name,
        "dry_run": args.dry_run,
    }

    if args.json_summary:
        print(json.dumps(summary, ensure_ascii=True, indent=2))
        return

    if args.dry_run:
        print("=== DRY RUN — report NOT written ===")
        print(json.dumps(summary, ensure_ascii=True, indent=2))
        print("\n--- injected report (first 80 lines) ---")
        for line in result_text.splitlines()[:80]:
            print(line)
        return

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / report_name
    out_path.write_text(result_text, encoding="utf-8")
    print(json.dumps({**summary, "written_to": str(out_path)}, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
