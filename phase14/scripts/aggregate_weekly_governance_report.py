# pyright: reportMissingImports=false
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import sys

sys.path.append(str(Path(__file__).resolve().parents[1] / "src"))

from phase14.golden_aggregate import aggregate_weekly_golden_bias
from phase14.governance_weekly import (
    build_weekly_governance_summary,
    render_weekly_governance_markdown,
    summarize_drift,
    summarize_promotion,
)
from phase14.io_paths import phase14_root
from phase14.jsonl_io import read_jsonl


def _load_yaml(path: Path) -> dict:
    import yaml  # type: ignore

    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _load_json(path: Path) -> dict:
    if not path.exists():
        raise RuntimeError(f"Required file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _load_golden_rows(start_date: str, end_date: str) -> list[dict]:
    rows: list[dict] = []
    base = phase14_root() / "data" / "monitoring"
    for path in sorted(base.glob("golden_results_*.jsonl")):
        date_key = path.stem.replace("golden_results_", "")
        if start_date <= date_key <= end_date:
            rows.extend(read_jsonl(path))
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--week-label", required=True)
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--drift-date", default=None, help="Defaults to --end-date")
    parser.add_argument("--promotion-date", default=None, help="Defaults to --end-date")
    args = parser.parse_args()

    cfg = _load_yaml(phase14_root() / "config" / "phase14b.yaml")
    golden_rows = _load_golden_rows(args.start_date, args.end_date)
    if not golden_rows:
        raise RuntimeError("No golden results found in the selected date range.")

    golden_cfg = cfg.get("golden_check", {})
    golden_summary = aggregate_weekly_golden_bias(
        golden_rows,
        accuracy_min=float(golden_cfg.get("accuracy_min", 0.80)),
        false_approve_rate_max=float(golden_cfg.get("false_approve_rate_max", 0.15)),
        false_reject_rate_max=float(golden_cfg.get("false_reject_rate_max", 0.15)),
    )

    drift_date = args.drift_date or args.end_date
    promotion_date = args.promotion_date or args.end_date

    drift_raw = _load_json(phase14_root() / "outputs" / "reports" / f"rule_drift_summary_{drift_date}.json")
    drift_cfg = cfg.get("phase14b_readiness", {})
    drift_summary = summarize_drift(
        drift_raw,
        drift_rate_max=float(drift_cfg.get("rule_drift_rate_max", 0.05)),
    )

    apply_summary = _load_json(phase14_root() / "outputs" / "reports" / f"apply_summary_{promotion_date}.json")
    rejected_rows = read_jsonl(phase14_root() / "outputs" / "reports" / f"rejected_changes_{promotion_date}.jsonl")
    promotion_cfg = cfg.get("promotion_governance", {})
    promotion_summary = summarize_promotion(
        apply_summary,
        rejected_rows,
        rejection_rate_max=float(promotion_cfg.get("rejection_rate_max", 0.30)),
        novel_case_ratio_max=float(promotion_cfg.get("novel_case_ratio_max", 0.15)),
    )

    report = build_weekly_governance_summary(
        week_label=args.week_label,
        golden_summary=golden_summary,
        drift_summary=drift_summary,
        promotion_summary=promotion_summary,
    )
    report["generated_at"] = datetime.now(timezone.utc).isoformat()
    report["sources"] = {
        "golden_start_date": args.start_date,
        "golden_end_date": args.end_date,
        "drift_date": drift_date,
        "promotion_date": promotion_date,
    }

    out_json = phase14_root() / "outputs" / "reports" / f"weekly_governance_report_{args.week_label}.json"
    out_md = phase14_root() / "outputs" / "reports" / f"weekly_governance_report_{args.week_label}.md"
    out_json.parent.mkdir(parents=True, exist_ok=True)

    out_json.write_text(json.dumps(report, ensure_ascii=True, indent=2), encoding="utf-8")
    out_md.write_text(render_weekly_governance_markdown(report), encoding="utf-8")

    print(
        json.dumps(
            {
                "week_label": args.week_label,
                "overall_status": report["overall_status"],
                "required_actions": report["required_actions"],
                "high_risk_reviewers_count": report["bias"]["high_risk_reviewers_count"],
                "drift_triggered": report["drift"]["drift_triggered"],
                "promotion_bottleneck_triggered": report["promotion"]["promotion_bottleneck_triggered"],
                "novel_case_ratio": report["promotion"]["novel_case_ratio"],
                "taxonomy_revision_required": report["promotion"]["taxonomy_revision_required"],
                "json_output": str(out_json),
                "md_output": str(out_md),
            },
            ensure_ascii=True,
        )
    )


if __name__ == "__main__":
    main()
