import argparse
import json
from dataclasses import dataclass
from pathlib import Path


@dataclass
class BaselineInput:
    measurement_window: str
    sample_size: int
    data_completeness: float
    median_cycle_time: float
    queue_age_p50: float
    queue_age_p90: float


def classify_upper_bound(value: float, limit: float) -> str:
    """
    Smaller is better.
    within_bound: comfortably below limit
    near_bound: within 10% of limit
    out_of_bound: exceeds limit
    """
    near_floor = 0.9 * limit
    if value > limit:
        return "out_of_bound"
    if value >= near_floor:
        return "near_bound"
    return "within_bound"


def overall_assessment(*bands: str) -> str:
    if "out_of_bound" in bands:
        return "out_of_bound"
    if "near_bound" in bands:
        return "near_bound"
    return "within_bound"


def audit_conclusion(assessment: str) -> str:
    return (
        "Week2 baseline established from the first operational observation window. "
        f"Initial latency/velocity state: {assessment}."
    )


def build_assessment(data: BaselineInput) -> dict[str, object]:
    cycle_band = classify_upper_bound(data.median_cycle_time, 48.0)
    p50_band = classify_upper_bound(data.queue_age_p50, 18.0)
    p90_band = classify_upper_bound(data.queue_age_p90, 36.0)

    assessment = overall_assessment(cycle_band, p50_band, p90_band)
    return {
        "measurement_window": data.measurement_window,
        "sample_size": data.sample_size,
        "data_completeness": data.data_completeness,
        "median_cycle_time": data.median_cycle_time,
        "median_cycle_time_band": cycle_band,
        "queue_age_p50": data.queue_age_p50,
        "queue_age_p50_band": p50_band,
        "queue_age_p90": data.queue_age_p90,
        "queue_age_p90_band": p90_band,
        "baseline_assessment": assessment,
        "audit_conclusion": audit_conclusion(assessment),
    }


def manual_input() -> BaselineInput:
    return BaselineInput(
        measurement_window="Week2 Day1-Day3",
        sample_size=0,
        data_completeness=1.0,
        median_cycle_time=0.0,
        queue_age_p50=0.0,
        queue_age_p90=0.0,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-file")
    parser.add_argument("--json", action="store_true")
    return parser.parse_args()


def load_input(input_file: str | None) -> "BaselineInput | None":
    if not input_file:
        return manual_input()

    payload = json.loads(Path(input_file).read_text(encoding="utf-8"))

    # INCOMPLETE state emitted by aggregate_week2_baseline_metrics.py
    state = payload.get("baseline_input_state")
    if state and state != "COMPLETE":
        reason = payload.get("reason", "unknown")
        print(f"baseline_input_state: {state}")
        print(f"reason              : {reason}")
        print("action              : wait and retry")
        print("template_update     : skipped")
        return None

    missing = [
        key
        for key in ("median_cycle_time", "queue_age_p50", "queue_age_p90")
        if payload.get(key) is None
    ]
    if missing:
        missing_text = ", ".join(missing)
        print("baseline_input_state: INCOMPLETE")
        print(f"reason              : missing values for {missing_text}")
        print("action              : wait and retry")
        print("template_update     : skipped")
        return None

    return BaselineInput(
        measurement_window=str(payload.get("measurement_window", "Week2 Day1-Day3")),
        sample_size=int(payload.get("sample_size", 0)),
        data_completeness=float(payload.get("data_completeness", 1.0)),
        median_cycle_time=float(payload["median_cycle_time"]),
        queue_age_p50=float(payload["queue_age_p50"]),
        queue_age_p90=float(payload["queue_age_p90"]),
    )


def main() -> None:
    args = parse_args()
    data = load_input(args.input_file)
    if data is None:
        raise SystemExit(0)  # pending state – not an error
    result = build_assessment(data)

    if args.json:
        print(json.dumps(result, ensure_ascii=True, indent=2))
        return

    print("=== WEEK2 BASELINE ASSESSMENT ===")
    print(f"measurement_window : {result['measurement_window']}")
    print(f"sample_size        : {result['sample_size']}")
    print(f"data_completeness  : {result['data_completeness']:.2%}")
    print()
    print(
        f"median_cycle_time  : {result['median_cycle_time']:.2f}h -> {result['median_cycle_time_band']}"
    )
    print(
        f"queue_age_p50      : {result['queue_age_p50']:.2f}h -> {result['queue_age_p50_band']}"
    )
    print(
        f"queue_age_p90      : {result['queue_age_p90']:.2f}h -> {result['queue_age_p90_band']}"
    )
    print()
    print(f"baseline_assessment: {result['baseline_assessment']}")
    print(result["audit_conclusion"])

    if result["data_completeness"] < 0.95:
        print("warning            : data_completeness below 95%; review measurement coverage.")


if __name__ == "__main__":
    main()
