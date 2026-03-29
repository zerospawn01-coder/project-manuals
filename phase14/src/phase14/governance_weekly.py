from __future__ import annotations

from typing import Any


KNOWN_REJECTION_CLASSES = {
    "conflict_deny_policy": "POLICY_CONFLICT_DENY_DEFAULT",
    "manual_override_required": "MANUAL_OVERRIDE_REQUIRED",
    "unknown_conflict_policy": "NOVEL_CASE_REQUIRES_HLG",
}


def classify_rejection(reason: str) -> str:
    key = str(reason or "").strip().lower()
    return KNOWN_REJECTION_CLASSES.get(key, "NOVEL_CASE_REQUIRES_HLG")


def summarize_promotion(
    apply_summary: dict[str, Any],
    rejected_rows: list[dict[str, Any]],
    rejection_rate_max: float = 0.30,
    novel_case_ratio_max: float = 0.15,
) -> dict[str, Any]:
    applied = int(apply_summary.get("applied_count", 0))
    rejected = int(apply_summary.get("rejected_count", len(rejected_rows)))
    total = max(applied + rejected, 1)
    rejection_rate = round(rejected / total, 4)

    rejection_class_counts: dict[str, int] = {}
    rejection_reason_distribution: dict[str, int] = {}
    for row in rejected_rows:
        reason = str(row.get("reason", "unknown") or "unknown")
        rejection_reason_distribution[reason] = rejection_reason_distribution.get(reason, 0) + 1
        rclass = classify_rejection(str(row.get("reason", "")))
        rejection_class_counts[rclass] = rejection_class_counts.get(rclass, 0) + 1

    novel_cases = rejection_class_counts.get("NOVEL_CASE_REQUIRES_HLG", 0)
    total_rejections = max(rejected, 1)
    novel_case_ratio = round(novel_cases / total_rejections, 4)

    return {
        "applied_count": applied,
        "rejected_count": rejected,
        "rejection_rate": rejection_rate,
        "rejection_rate_max": rejection_rate_max,
        "promotion_bottleneck_triggered": rejection_rate > rejection_rate_max,
        "rejection_reason_distribution": rejection_reason_distribution,
        "rejection_class_counts": rejection_class_counts,
        "novel_case_ratio": novel_case_ratio,
        "novel_case_ratio_max": novel_case_ratio_max,
        "taxonomy_revision_required": novel_case_ratio > novel_case_ratio_max,
    }


def summarize_drift(
    drift_summary: dict[str, Any],
    drift_rate_max: float = 0.05,
) -> dict[str, Any]:
    drift_events = int(drift_summary.get("drift_events", 0))
    total_rules = int(drift_summary.get("total_rules", 0))
    rule_drift_rate = float(drift_summary.get("rule_drift_rate", 0.0))

    return {
        "drift_events": drift_events,
        "total_rules": total_rules,
        "rule_drift_rate": round(rule_drift_rate, 4),
        "rule_drift_rate_max": drift_rate_max,
        "drift_triggered": rule_drift_rate > drift_rate_max,
        "status_updates": list(drift_summary.get("status_updates", [])),
    }


def build_weekly_governance_summary(
    week_label: str,
    golden_summary: dict[str, Any],
    drift_summary: dict[str, Any],
    promotion_summary: dict[str, Any],
) -> dict[str, Any]:
    high_risk_reviewers = [r["reviewer_id"] for r in golden_summary.get("reviewers", []) if r.get("needs_recalibration")]

    actions: list[str] = []
    if high_risk_reviewers:
        actions.append("reviewer_recalibration_required")
    if bool(drift_summary.get("drift_triggered")):
        actions.append("rule_drift_mitigation_required")
    if bool(promotion_summary.get("promotion_bottleneck_triggered")):
        actions.append("promotion_threshold_audit_required")
    if bool(promotion_summary.get("taxonomy_revision_required")):
        actions.append("taxonomy_revision_required")

    overall_status = "stable" if not actions else "attention_required"

    return {
        "week_label": week_label,
        "overall_status": overall_status,
        "required_actions": actions,
        "bias": {
            "team_mean_accuracy": golden_summary.get("team_mean_accuracy", 0.0),
            "team_mean_agreement": golden_summary.get("team_mean_agreement", 0.0),
            "high_risk_reviewers_count": golden_summary.get("high_risk_reviewers_count", 0),
            "high_risk_reviewers": high_risk_reviewers,
            "reviewers": golden_summary.get("reviewers", []),
            "thresholds": golden_summary.get("thresholds", {}),
        },
        "drift": drift_summary,
        "promotion": promotion_summary,
    }


def render_weekly_governance_markdown(summary: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append(f"# Weekly Governance Report ({summary['week_label']})")
    lines.append("")
    lines.append(f"- overall_status: {summary['overall_status']}")
    lines.append(f"- required_actions: {', '.join(summary['required_actions']) if summary['required_actions'] else 'none'}")
    lines.append("")
    lines.append("## Bias")
    lines.append("")
    lines.append(f"- team_mean_accuracy: {summary['bias']['team_mean_accuracy']}")
    lines.append(f"- team_mean_agreement: {summary['bias']['team_mean_agreement']}")
    lines.append(f"- high_risk_reviewers_count: {summary['bias']['high_risk_reviewers_count']}")
    lines.append("")
    lines.append("| reviewer_id | total_golden_reviewed | accuracy | false_approve_rate | false_reject_rate | needs_recalibration |")
    lines.append("|-------------|------------------------|----------|--------------------|-------------------|---------------------|")
    for reviewer in summary["bias"]["reviewers"]:
        lines.append(
            f"| {reviewer['reviewer_id']} | {reviewer['total_golden_reviewed']} | {reviewer['accuracy']} | {reviewer['false_approve_rate']} | {reviewer['false_reject_rate']} | {reviewer['needs_recalibration']} |"
        )
    lines.append("")
    lines.append("## Drift")
    lines.append("")
    lines.append(f"- drift_events: {summary['drift']['drift_events']}")
    lines.append(f"- total_rules: {summary['drift']['total_rules']}")
    lines.append(f"- rule_drift_rate: {summary['drift']['rule_drift_rate']}")
    lines.append(f"- drift_triggered: {summary['drift']['drift_triggered']}")
    lines.append("")
    lines.append("## Promotion")
    lines.append("")
    lines.append(f"- applied_count: {summary['promotion']['applied_count']}")
    lines.append(f"- rejected_count: {summary['promotion']['rejected_count']}")
    lines.append(f"- rejection_rate: {summary['promotion']['rejection_rate']}")
    lines.append(f"- promotion_bottleneck_triggered: {summary['promotion']['promotion_bottleneck_triggered']}")
    lines.append(f"- novel_case_ratio: {summary['promotion']['novel_case_ratio']}")
    lines.append(f"- taxonomy_revision_required: {summary['promotion']['taxonomy_revision_required']}")
    lines.append("")
    lines.append("### Rejection Reasons")
    lines.append("")
    if summary["promotion"]["rejection_reason_distribution"]:
        for key, value in summary["promotion"]["rejection_reason_distribution"].items():
            lines.append(f"- {key}: {value}")
    else:
        lines.append("- none")
    lines.append("")
    lines.append("### Rejection Classes")
    lines.append("")
    if summary["promotion"]["rejection_class_counts"]:
        for key, value in summary["promotion"]["rejection_class_counts"].items():
            lines.append(f"- {key}: {value}")
    else:
        lines.append("- none")
    return "\n".join(lines) + "\n"
