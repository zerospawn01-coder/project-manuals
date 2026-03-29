from __future__ import annotations

from typing import Any


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "y", "pass", "approved", "approve"}


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_reviewer_id(row: dict[str, Any]) -> str:
    for key in ("reviewer_id", "reviewerId", "reviewer", "operator_id", "user_id"):
        value = str(row.get(key, "") or "").strip()
        if value:
            return value
    return "unknown"


def _extract_decisions(row: dict[str, Any]) -> tuple[bool, bool]:
    actual = row.get("actual_approved")
    expected = row.get("expected_approved")

    if actual is None:
        actual = row.get("review_decision")
    if expected is None:
        expected = row.get("golden_decision")

    return _coerce_bool(actual), _coerce_bool(expected)


def aggregate_weekly_golden_bias(
    rows: list[dict[str, Any]],
    accuracy_min: float = 0.80,
    false_approve_rate_max: float = 0.15,
    false_reject_rate_max: float = 0.15,
    agreement_rate_min: float = 0.80,
) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        reviewer_id = _normalize_reviewer_id(row)
        grouped.setdefault(reviewer_id, []).append(row)

    reviewers: list[dict[str, Any]] = []
    accuracies: list[float] = []

    for reviewer_id, reviewer_rows in sorted(grouped.items()):
        total = len(reviewer_rows)
        correct = 0
        false_approves = 0
        false_rejects = 0

        for row in reviewer_rows:
            actual_approved, expected_approved = _extract_decisions(row)
            if actual_approved == expected_approved:
                correct += 1
            elif actual_approved and not expected_approved:
                false_approves += 1
            elif not actual_approved and expected_approved:
                false_rejects += 1

        accuracy = round(correct / total, 4) if total else 0.0
        false_approve_rate = round(false_approves / total, 4) if total else 0.0
        false_reject_rate = round(false_rejects / total, 4) if total else 0.0
        needs_recalibration = (
            accuracy < accuracy_min
            or false_approve_rate > false_approve_rate_max
            or false_reject_rate > false_reject_rate_max
        )

        reviewers.append(
            {
                "reviewer_id": reviewer_id,
                "total_golden_reviewed": total,
                "accuracy": accuracy,
                "false_approve_rate": false_approve_rate,
                "false_reject_rate": false_reject_rate,
                "needs_recalibration": needs_recalibration,
            }
        )
        accuracies.append(accuracy)

    team_mean_accuracy = round(sum(accuracies) / len(accuracies), 4) if accuracies else 0.0
    team_mean_agreement = team_mean_accuracy
    high_risk_reviewers_count = sum(1 for reviewer in reviewers if reviewer["needs_recalibration"])

    return {
        "team_mean_accuracy": team_mean_accuracy,
        "team_mean_agreement": team_mean_agreement,
        "high_risk_reviewers_count": high_risk_reviewers_count,
        "reviewers": reviewers,
        "thresholds": {
            "accuracy_min": _coerce_float(accuracy_min),
            "false_approve_rate_max": _coerce_float(false_approve_rate_max),
            "false_reject_rate_max": _coerce_float(false_reject_rate_max),
            "agreement_rate_min": _coerce_float(agreement_rate_min),
        },
    }
