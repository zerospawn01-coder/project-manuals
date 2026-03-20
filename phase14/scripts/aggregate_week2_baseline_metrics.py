#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path

import pandas as pd


DEFAULT_WINDOW_START = "2026-03-10T00:00:00"
DEFAULT_WINDOW_END = "2026-03-12T23:59:59"


@dataclass
class AggregationResult:
    baseline_input_state: str
    reason: str
    measurement_window: str
    sample_size: int
    queue_sample_size: int
    data_completeness: float
    median_cycle_time: float | None
    queue_age_p50: float | None
    queue_age_p90: float | None
    cycle_time_basis: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--candidate-file",
        default=str(Path(__file__).parent.parent / "data" / "candidate_snapshot.csv"),
    )
    parser.add_argument(
        "--queue-file",
        default=str(Path(__file__).parent.parent / "data" / "review_queue.csv"),
    )
    parser.add_argument("--window-start", default=DEFAULT_WINDOW_START)
    parser.add_argument("--window-end", default=DEFAULT_WINDOW_END)
    parser.add_argument("--as-of")
    parser.add_argument("--output")
    return parser.parse_args()


def load_frame(path: str) -> pd.DataFrame:
    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"file not found: {file_path}")
    return pd.read_csv(file_path)


def aggregate_metrics(
    candidate_file: str,
    queue_file: str,
    window_start: str,
    window_end: str,
    as_of: str | None = None,
) -> AggregationResult:
    candidates = load_frame(candidate_file)
    queue = load_frame(queue_file)

    candidates["created_at"] = pd.to_datetime(candidates["created_at"], errors="coerce")
    queue["queued_at"] = pd.to_datetime(queue["queued_at"], errors="coerce")
    queue["review_completion_time"] = pd.to_datetime(
        queue["review_completion_time"], errors="coerce"
    )

    window_start_ts = pd.Timestamp(window_start)
    window_end_ts = pd.Timestamp(window_end)
    as_of_ts = pd.Timestamp(as_of) if as_of else window_end_ts

    merged = queue.merge(
        candidates[["candidate_id", "created_at"]],
        on="candidate_id",
        how="left",
    )

    completed = merged[
        merged["review_completion_time"].notna()
        & (merged["review_completion_time"] >= window_start_ts)
        & (merged["review_completion_time"] <= window_end_ts)
        & merged["created_at"].notna()
    ].copy()

    median_cycle_time = None
    if not completed.empty:
        cycle_hours = (
            completed["review_completion_time"] - completed["created_at"]
        ).dt.total_seconds() / 3600.0
        median_cycle_time = float(cycle_hours.median())

    in_queue = merged[
        merged["queued_at"].notna()
        & (merged["queued_at"] <= as_of_ts)
        & (
            merged["review_completion_time"].isna()
            | (merged["review_completion_time"] > as_of_ts)
        )
    ].copy()

    queue_age_p50 = None
    queue_age_p90 = None
    if not in_queue.empty:
        queue_age_hours = (as_of_ts - in_queue["queued_at"]).dt.total_seconds() / 3600.0
        queue_age_p50 = float(queue_age_hours.quantile(0.50))
        queue_age_p90 = float(queue_age_hours.quantile(0.90))

    metrics = [median_cycle_time, queue_age_p50, queue_age_p90]
    completeness = sum(value is not None for value in metrics) / len(metrics)

    if median_cycle_time is None:
        state = "INCOMPLETE"
        reason = "review_completion_time missing for the observation window"
    else:
        state = "COMPLETE"
        reason = "all baseline metrics produced"

    return AggregationResult(
        baseline_input_state=state,
        reason=reason,
        measurement_window=f"{window_start_ts.isoformat()} -> {window_end_ts.isoformat()}",
        sample_size=int(len(completed)),
        queue_sample_size=int(len(in_queue)),
        data_completeness=float(completeness),
        median_cycle_time=median_cycle_time,
        queue_age_p50=queue_age_p50,
        queue_age_p90=queue_age_p90,
        cycle_time_basis="created_at -> review_completion_time",
    )


def main() -> None:
    args = parse_args()
    result = aggregate_metrics(
        candidate_file=args.candidate_file,
        queue_file=args.queue_file,
        window_start=args.window_start,
        window_end=args.window_end,
        as_of=args.as_of,
    )
    payload = asdict(result)
    output_text = json.dumps(payload, ensure_ascii=True, indent=2)
    print(output_text)

    if args.output:
        Path(args.output).write_text(output_text + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()