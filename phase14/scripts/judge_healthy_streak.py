#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


INVARIANT_KEYS = (
    "I1_velocity_bound",
    "I2_latency_bound",
    "I3_observability_integrity",
    "I4_state_visibility",
    "I5_human_authority",
    "I6_oscillation_guard",
)
VALID_INVARIANT_VALUES = {"PASS", "WATCH", "FAIL"}


@dataclass
class WeekEvaluation:
    week_id: str
    week_status: str
    bands: dict[str, str]
    invariant_continuity: str
    healthy_streak_count: int
    l3_readiness: str
    fail_reasons: list[str]
    next_action: str
    gate_freeze_occurred: bool | None
    median_cycle_time: float | None
    queue_age_p50: float | None
    queue_age_p90: float | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Judge HEALTHY streak and L3 readiness.")
    parser.add_argument("--input-file", required=True, help="Path to weekly input JSON")
    parser.add_argument("--history-file", help="Path to history JSON (to maintain streaks across runs)")
    parser.add_argument("--output", help="Optional path to write result JSON")
    parser.add_argument("--json", action="store_true", help="Print JSON only")
    return parser.parse_args()


def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def classify_cycle_band(value: float | None) -> str:
    if value is None:
        return "invalid"
    if value <= 43.2:
        return "stable"
    if value < 48.0:
        return "watch"
    return "breach"


def classify_p50_band(value: float | None) -> str:
    if value is None:
        return "invalid"
    if value <= 16.2:
        return "stable"
    if value <= 18.0:
        return "watch"
    return "breach"


def classify_p90_band(value: float | None) -> str:
    if value is None:
        return "invalid"
    if value <= 32.4:
        return "stable"
    if value <= 36.0:
        return "watch"
    return "breach"


def evaluate_invariants(payload: dict[str, Any], fail_reasons: list[str]) -> tuple[str, dict[str, str], bool, bool]:
    invariants = payload.get("invariants")
    if not isinstance(invariants, dict):
        fail_reasons.append("missing_invariants")
        return "INVALID", {}, False, False

    normalized: dict[str, str] = {}
    has_invalid = False

    for key in INVARIANT_KEYS:
        value = invariants.get(key)
        if value not in VALID_INVARIANT_VALUES:
            has_invalid = True
            fail_reasons.append(f"invalid_invariant_value:{key}")
            normalized[key] = "INVALID"
        else:
            normalized[key] = str(value)

    i3_fail = normalized.get("I3_observability_integrity") == "FAIL"
    i4_fail = normalized.get("I4_state_visibility") == "FAIL"
    i5_fail = normalized.get("I5_human_authority") == "FAIL"

    if i3_fail or i4_fail:
        fail_reasons.append("observability_or_state_visibility_broken")
    if i5_fail:
        fail_reasons.append("human_authority_violation")

    if has_invalid:
        continuity = "INVALID"
    elif "FAIL" in normalized.values():
        continuity = "FAIL"
    elif "WATCH" in normalized.values():
        continuity = "WATCH"
    else:
        continuity = "PASS"

    return continuity, normalized, (i3_fail or i4_fail), i5_fail


def evaluate_week(payload: dict[str, Any], previous_status: str | None, previous_streak: int) -> WeekEvaluation:
    fail_reasons: list[str] = []

    week_id = str(payload.get("week_id", "UNKNOWN"))
    data_completeness = _as_float(payload.get("data_completeness"))
    if data_completeness is None:
        fail_reasons.append("missing_data_completeness")
    elif data_completeness < 0.95:
        fail_reasons.append("insufficient_data_completeness")

    if "gate_freeze_occurred" not in payload:
        fail_reasons.append("missing_gate_freeze_occurred")
    gate_freeze = payload.get("gate_freeze_occurred")
    if gate_freeze is not None and not isinstance(gate_freeze, bool):
        fail_reasons.append("invalid_gate_freeze_occurred")

    median_cycle_time = _as_float(payload.get("median_cycle_time"))
    queue_age_p50 = _as_float(payload.get("queue_age_p50"))
    queue_age_p90 = _as_float(payload.get("queue_age_p90"))

    bands = {
        "median_cycle_time_band": classify_cycle_band(median_cycle_time),
        "queue_age_p50_band": classify_p50_band(queue_age_p50),
        "queue_age_p90_band": classify_p90_band(queue_age_p90),
    }

    if "invalid" in bands.values():
        fail_reasons.append("invalid_metric_value")

    invariant_continuity, _, i3_i4_fail, i5_fail = evaluate_invariants(payload, fail_reasons)

    breach_exists = "breach" in bands.values()
    watch_exists = "watch" in bands.values()

    if i3_i4_fail:
        week_status = "PRECHECK"
    elif any(reason in fail_reasons for reason in (
        "missing_data_completeness",
        "insufficient_data_completeness",
        "missing_gate_freeze_occurred",
        "invalid_gate_freeze_occurred",
        "invalid_metric_value",
        "missing_invariants",
    )):
        week_status = "PRECHECK"
    elif i5_fail or breach_exists or invariant_continuity == "FAIL":
        week_status = "DEGRADED"
    elif watch_exists or invariant_continuity == "WATCH":
        week_status = "AT_RISK"
    else:
        week_status = "HEALTHY"

    if previous_status == "AT_RISK" and week_status == "AT_RISK":
        fail_reasons.append("two_consecutive_at_risk_weeks")
        week_status = "DEGRADED"

    healthy_streak_count = previous_streak + 1 if week_status == "HEALTHY" else 0

    if i5_fail:
        next_action = "escalate_human_authority_incident"
    elif i3_i4_fail:
        next_action = "repair_observability_and_rejudge"
    elif week_status == "HEALTHY":
        next_action = "continue_weekly_tracking"
    elif week_status == "AT_RISK":
        next_action = "monitor_watch_conditions"
    elif week_status == "DEGRADED":
        next_action = "execute_recovery_plan"
    else:
        next_action = "repair_observability_and_rejudge"

    return WeekEvaluation(
        week_id=week_id,
        week_status=week_status,
        bands=bands,
        invariant_continuity=invariant_continuity,
        healthy_streak_count=healthy_streak_count,
        l3_readiness="NOT_ELIGIBLE",
        fail_reasons=sorted(set(fail_reasons)),
        next_action=next_action,
        gate_freeze_occurred=gate_freeze if isinstance(gate_freeze, bool) else None,
        median_cycle_time=median_cycle_time,
        queue_age_p50=queue_age_p50,
        queue_age_p90=queue_age_p90,
    )


def ensure_week_list(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if "weekly_inputs" in payload and isinstance(payload["weekly_inputs"], list):
        return [item for item in payload["weekly_inputs"] if isinstance(item, dict)]
    return [payload]


def evaluate_l3_readiness(last_four: list[WeekEvaluation], current: WeekEvaluation) -> tuple[str, list[str]]:
    reasons: list[str] = []

    if any("human_authority_violation" in week.fail_reasons for week in last_four):
        reasons.append("human_authority_violation")
    if any("observability_or_state_visibility_broken" in week.fail_reasons for week in last_four):
        reasons.append("judgement_invalid_observability_state_visibility")

    if current.healthy_streak_count < 4:
        reasons.append("healthy_streak_below_4")

    if len(last_four) < 4:
        reasons.append("insufficient_weeks_for_l3_window")
        return "NOT_ELIGIBLE", sorted(set(reasons))

    if any(week.invariant_continuity != "PASS" for week in last_four):
        reasons.append("invariant_continuity_not_all_pass")

    if any(week.median_cycle_time is None or week.median_cycle_time >= 48.0 for week in last_four):
        reasons.append("median_cycle_time_bound_not_held")

    if any(
        week.queue_age_p50 is None
        or week.queue_age_p90 is None
        or week.queue_age_p50 > 18.0
        or week.queue_age_p90 > 36.0
        for week in last_four
    ):
        reasons.append("queue_age_bound_not_held")

    if any(week.gate_freeze_occurred is not False for week in last_four):
        reasons.append("gate_freeze_occurred_in_window")

    if reasons:
        return "NOT_ELIGIBLE", sorted(set(reasons))
    return "ELIGIBLE", []


def run(payload: dict[str, Any], history_evals: list[WeekEvaluation] | None = None) -> dict[str, Any]:
    weeks = ensure_week_list(payload)

    evaluations: list[WeekEvaluation] = []
    if history_evals:
        evaluations.extend(history_evals)

    previous_status: str | None = evaluations[-1].week_status if evaluations else None
    previous_streak = evaluations[-1].healthy_streak_count if evaluations else 0

    for week in weeks:
        evaluated = evaluate_week(week, previous_status, previous_streak)
        evaluations.append(evaluated)
        previous_status = evaluated.week_status
        previous_streak = evaluated.healthy_streak_count

    current = evaluations[-1]
    last_four = evaluations[-4:]
    l3_readiness, l3_fail_reasons = evaluate_l3_readiness(last_four, current)
    current.l3_readiness = l3_readiness

    current_fail_reasons = sorted(set(current.fail_reasons + l3_fail_reasons))

    return {
        "week_id": current.week_id,
        "week_status": current.week_status,
        "bands": current.bands,
        "invariant_continuity": current.invariant_continuity,
        "healthy_streak_count": current.healthy_streak_count,
        "streak_window": (
            f"{last_four[0].week_id}-{last_four[-1].week_id}" if len(last_four) >= 2 else current.week_id
        ),
        "l3_readiness": l3_readiness,
        "fail_reasons": current_fail_reasons,
        "next_action": current.next_action,
        "evaluated_weeks": [
            {
                "week_id": week.week_id,
                "week_status": week.week_status,
                "invariant_continuity": week.invariant_continuity,
                "healthy_streak_count": week.healthy_streak_count,
                "gate_freeze_occurred": week.gate_freeze_occurred,
            }
            for week in evaluations
        ],
    }


def main() -> None:
    args = parse_args()
    payload = json.loads(Path(args.input_file).read_text(encoding="utf-8"))

    history_evals: list[WeekEvaluation] = []
    if args.history_file and Path(args.history_file).exists():
        h_data = json.loads(Path(args.history_file).read_text(encoding="utf-8"))
        # Load from 'evaluated_weeks' array in history result
        if "evaluated_weeks" in h_data:
            for hw in h_data["evaluated_weeks"]:
                history_evals.append(WeekEvaluation(
                    week_id=hw["week_id"],
                    week_status=hw["week_status"],
                    bands={}, # Minimal for history
                    invariant_continuity=hw["invariant_continuity"],
                    healthy_streak_count=hw["healthy_streak_count"],
                    l3_readiness="UNKNOWN",
                    fail_reasons=[],
                    next_action="UNKNOWN",
                    gate_freeze_occurred=hw["gate_freeze_occurred"],
                    median_cycle_time=None, # Minimal for history
                    queue_age_p50=None,
                    queue_age_p90=None
                ))

    result = run(payload, history_evals=history_evals)

    result_text = json.dumps(result, ensure_ascii=True, indent=2)
    if args.output:
        Path(args.output).write_text(result_text + "\n", encoding="utf-8")

    if args.json:
        print(result_text)
        return

    print("=== HEALTHY STREAK JUDGEMENT ===")
    print(f"week_id             : {result['week_id']}")
    print(f"week_status         : {result['week_status']}")
    print(f"healthy_streak_count: {result['healthy_streak_count']}")
    print(f"l3_readiness        : {result['l3_readiness']}")
    print(f"next_action         : {result['next_action']}")
    if result["fail_reasons"]:
        print("fail_reasons        :")
        for reason in result["fail_reasons"]:
            print(f"  - {reason}")


if __name__ == "__main__":
    main()
