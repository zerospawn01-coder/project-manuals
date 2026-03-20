#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--audit-file",
        default=str(Path(__file__).parent.parent / "data" / "post_gate_action.audit.jsonl"),
    )
    parser.add_argument(
        "--out",
        default=str(Path(__file__).parent.parent / "data" / "post_gate_action_metrics.latest.json"),
    )
    return parser.parse_args()


def _sort_counts(counts: dict[str, int]) -> dict[str, int]:
    return {key: counts[key] for key in sorted(counts)}


def _increment(counter: dict[str, int], key: Any) -> None:
    normalized = str(key).strip() if key is not None else ""
    if not normalized:
        normalized = "unknown"
    counter[normalized] += 1


def build_metrics(audit_file: str) -> dict[str, object]:
    file_path = Path(audit_file)
    if not file_path.exists():
        raise FileNotFoundError(f"audit file not found: {file_path}")

    runbook_counts: dict[str, int] = defaultdict(int)
    owner_counts: dict[str, int] = defaultdict(int)
    action_counts: dict[str, int] = defaultdict(int)
    weekly_gate_status_counts: dict[str, int] = defaultdict(int)
    dispatch_governance_signal_counts: dict[str, int] = defaultdict(int)

    total_records = 0
    parse_error_count = 0
    latest_watcher_run_id: str | None = None
    latest_record_generated_at: str | None = None

    lines = file_path.read_text(encoding="utf-8").splitlines()
    for line in lines:
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            parse_error_count += 1
            continue

        total_records += 1
        _increment(runbook_counts, record.get("runbook_step_id"))
        _increment(owner_counts, record.get("owner_canonical"))
        _increment(action_counts, record.get("required_action"))
        _increment(weekly_gate_status_counts, record.get("weekly_gate_status"))
        _increment(
            dispatch_governance_signal_counts,
            record.get("dispatch_governance_signal"),
        )
        run_id = record.get("watcher_run_id")
        if run_id:
            latest_watcher_run_id = str(run_id)
        rec_ts = record.get("generated_at")
        if rec_ts:
            latest_record_generated_at = str(rec_ts)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "latest_watcher_run_id": latest_watcher_run_id,
        "latest_record_generated_at": latest_record_generated_at,
        "source_audit_path": str(file_path.resolve()),
        "total_records": total_records,
        "parse_error_count": parse_error_count,
        "counts_by_runbook_step_id": _sort_counts(runbook_counts),
        "counts_by_owner_canonical": _sort_counts(owner_counts),
        "counts_by_required_action": _sort_counts(action_counts),
        "counts_by_weekly_gate_status": _sort_counts(weekly_gate_status_counts),
        "counts_by_dispatch_governance_signal": _sort_counts(
            dispatch_governance_signal_counts
        ),
    }


def main() -> None:
    args = parse_args()
    metrics = build_metrics(args.audit_file)

    output_path = Path(args.out)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(metrics, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(metrics, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
