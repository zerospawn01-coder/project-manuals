#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from aggregate_week2_baseline_metrics import aggregate_metrics
from aggregate_post_gate_action_metrics import build_metrics as build_post_gate_metrics
from assess_week2_baseline import BaselineInput, build_assessment


DEFAULT_WINDOW_START = "2026-03-10T00:00:00"
DEFAULT_WINDOW_END = "2026-03-12T23:59:59"
POST_GATE_METRICS_FRESHNESS_SLA_MINUTES = 5


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
    parser.add_argument(
        "--template-file",
        default=str(Path(__file__).parent.parent / "docs" / "WEEK2_REPORT_TEMPLATE.md"),
    )
    parser.add_argument(
        "--dispatch-audit-file",
        default=str(Path(__file__).parent.parent / "data" / "dispatch_audit_metrics.latest.json"),
    )
    parser.add_argument("--window-start", default=DEFAULT_WINDOW_START)
    parser.add_argument("--window-end", default=DEFAULT_WINDOW_END)
    parser.add_argument("--as-of")
    parser.add_argument("--poll-seconds", type=int, default=60)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--no-template-update", action="store_true")
    return parser.parse_args()


def _safe_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _normalize_distribution(raw: Any) -> dict[str, int]:
    if not isinstance(raw, dict):
        return {}

    normalized: dict[str, int] = {}
    for key, value in raw.items():
        normalized[str(key)] = _safe_int(value, 0)
    return normalized


def load_dispatch_metrics(dispatch_audit_file: str) -> dict[str, object]:
    path = Path(dispatch_audit_file)
    if not path.exists():
        return {
            "dispatch_metrics_state": "MISSING",
            "dispatch_metrics_reason": f"dispatch audit metrics file not found: {path}",
            "parsed_line_count": 0,
            "validation_failure_count": 0,
            "missing_required_context_count": 0,
            "dispatch_ready_rate": 1.0,
            "failures_by_week": {},
            "failures_by_run": {},
        }

    payload = json.loads(path.read_text(encoding="utf-8"))
    return {
        "dispatch_metrics_state": "READY",
        "dispatch_metrics_reason": "dispatch audit metrics loaded",
        "parsed_line_count": _safe_int(payload.get("parsed_line_count"), 0),
        "validation_failure_count": _safe_int(payload.get("validation_failure_count"), 0),
        "missing_required_context_count": _safe_int(payload.get("missing_required_context_count"), 0),
        "dispatch_ready_rate": _safe_float(payload.get("dispatch_ready_rate"), 1.0),
        "failures_by_week": _normalize_distribution(payload.get("failures_by_week")),
        "failures_by_run": _normalize_distribution(payload.get("failures_by_run")),
    }


def assess_dispatch_metrics(dispatch_metrics: dict[str, object]) -> dict[str, object]:
    parsed_line_count = _safe_int(dispatch_metrics.get("parsed_line_count"), 0)
    validation_failure_count = _safe_int(dispatch_metrics.get("validation_failure_count"), 0)
    missing_required_context_count = _safe_int(
        dispatch_metrics.get("missing_required_context_count"), 0
    )
    dispatch_ready_rate = _safe_float(dispatch_metrics.get("dispatch_ready_rate"), 1.0)

    validation_failure_signal = (
        "review_note" if validation_failure_count > 0 else "ok"
    )
    missing_context_signal = (
        "hard_attention" if missing_required_context_count > 0 else "ok"
    )
    if parsed_line_count == 0:
        dispatch_ready_rate_signal = "insufficient_data"
    else:
        dispatch_ready_rate_signal = "investigation" if dispatch_ready_rate < 1.0 else "ok"

    overall_signal = "ok"
    if missing_context_signal == "hard_attention":
        overall_signal = "hard_attention"
    elif (
        dispatch_ready_rate_signal == "investigation"
        or validation_failure_signal == "review_note"
    ):
        overall_signal = "review_required"

    return {
        "dispatch_metrics_state": dispatch_metrics.get("dispatch_metrics_state", "READY"),
        "dispatch_metrics_reason": dispatch_metrics.get("dispatch_metrics_reason", ""),
        "parsed_line_count": parsed_line_count,
        "validation_failure_count": validation_failure_count,
        "validation_failure_signal": validation_failure_signal,
        "missing_required_context_count": missing_required_context_count,
        "missing_required_context_signal": missing_context_signal,
        "dispatch_ready_rate": dispatch_ready_rate,
        "dispatch_ready_rate_signal": dispatch_ready_rate_signal,
        "failures_by_week": dispatch_metrics.get("failures_by_week", {}),
        "failures_by_run": dispatch_metrics.get("failures_by_run", {}),
        "dispatch_governance_signal": overall_signal,
    }


def derive_weekly_gate_decision(
    baseline_assessment: str,
    dispatch_governance_signal: str,
) -> dict[str, object]:
    baseline_to_gate = {
        "within_bound": "PASS",
        "near_bound": "WATCH",
        "out_of_bound": "FAIL",
        "pending": "PENDING_BASELINE",
    }
    weekly_gate_status = baseline_to_gate.get(baseline_assessment, "WATCH")

    gate_attention_required = dispatch_governance_signal == "hard_attention"
    gate_review_note_required = dispatch_governance_signal == "review_required"

    if gate_attention_required:
        weekly_gate_status = "ATTENTION_REQUIRED"

    gate_notes: list[str] = []
    if gate_attention_required:
        gate_notes.append(
            "dispatch_governance_signal=hard_attention propagated to weekly gate"
        )
    elif gate_review_note_required:
        gate_notes.append(
            "dispatch_governance_signal=review_required added as weekly gate review note"
        )
    elif dispatch_governance_signal == "insufficient_data":
        gate_notes.append("dispatch telemetry insufficient_data; baseline gate retained")

    return {
        "baseline_assessment": baseline_assessment,
        "dispatch_governance_signal": dispatch_governance_signal,
        "weekly_gate_status": weekly_gate_status,
        "gate_attention_required": gate_attention_required,
        "gate_review_note_required": gate_review_note_required,
        "gate_notes": gate_notes,
    }


def _get_owner_display(owner_canonical: str) -> str:
    """Convert owner canonical key to human-readable display name."""
    owner_display_map = {
        "governance_owner": "Governance Owner",
        "operations_manager": "Operations Manager",
        "operations_analyst": "Operations Analyst",
        "tech_lead": "Tech Lead",
        "none": "none",
    }
    return owner_display_map.get(str(owner_canonical), str(owner_canonical))


def derive_post_gate_action(
    gate_decision: dict[str, object],
    dispatch_assessment: dict[str, object],
    evidence_paths: list[str],
) -> dict[str, object]:
    weekly_gate_status = str(gate_decision.get("weekly_gate_status", "WATCH"))
    dispatch_governance_signal = str(
        gate_decision.get("dispatch_governance_signal", "ok")
    )

    if weekly_gate_status == "ATTENTION_REQUIRED":
        return {
            "required_action": "manual_review_required",
            "runbook_step_id": "RUNBOOK-ATTN-01",
            "owner_canonical": "governance_owner",
            "next_step": "RUNBOOK-ATTN-01: Escalate weekly gate for governance review",
            "evidence_paths": evidence_paths,
        }

    if dispatch_governance_signal == "review_required":
        return {
            "required_action": "add_weekly_review_note",
            "runbook_step_id": "RUNBOOK-REVIEW-01",
            "owner_canonical": "operations_manager",
            "next_step": "RUNBOOK-REVIEW-01: Add weekly review note and inspect dispatch evidence",
            "evidence_paths": evidence_paths,
        }

    if weekly_gate_status == "PENDING_BASELINE":
        return {
            "required_action": "wait_for_baseline_completion",
            "runbook_step_id": "RUNBOOK-PENDING-01",
            "owner_canonical": "operations_analyst",
            "next_step": "RUNBOOK-PENDING-01: Wait for baseline completion and rerun watcher",
            "evidence_paths": evidence_paths,
        }

    if str(dispatch_assessment.get("dispatch_ready_rate_signal", "ok")) == "insufficient_data":
        return {
            "required_action": "monitor_dispatch_data",
            "runbook_step_id": "RUNBOOK-MONITOR-01",
            "owner_canonical": "tech_lead",
            "next_step": "RUNBOOK-MONITOR-01: Monitor dispatch telemetry until parsed_line_count is positive",
            "evidence_paths": evidence_paths,
        }

    return {
        "required_action": "none",
        "runbook_step_id": "RUNBOOK-NONE-01",
        "owner_canonical": "none",
        "next_step": "RUNBOOK-NONE-01: No additional action required",
        "evidence_paths": evidence_paths,
    }


def _render_distribution(items: dict[str, int]) -> str:
    if not items:
        return "none"

    ordered = sorted(items.items(), key=lambda item: item[0])
    return ", ".join(f"{key}:{value}" for key, value in ordered)


def _parse_timestamp(value: object) -> datetime | None:
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    if text.endswith("Z"):
        text = text[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _format_freshness_label(generated_at: object) -> str:
    parsed = _parse_timestamp(generated_at)
    if parsed is None:
        return "stale (unparseable timestamp)"

    age_minutes = int(max(0.0, (datetime.now(timezone.utc) - parsed).total_seconds()) // 60)
    if age_minutes <= POST_GATE_METRICS_FRESHNESS_SLA_MINUTES:
        if age_minutes == 0:
            return f"fresh (<1m, SLA <= {POST_GATE_METRICS_FRESHNESS_SLA_MINUTES}m)"
        return f"fresh ({age_minutes}m ago, SLA <= {POST_GATE_METRICS_FRESHNESS_SLA_MINUTES}m)"
    return f"stale ({age_minutes}m ago, SLA <= {POST_GATE_METRICS_FRESHNESS_SLA_MINUTES}m)"


def _format_data_integrity_label(post_gate_metrics: dict[str, object]) -> str:
    latest_watcher_run_id = str(post_gate_metrics.get("latest_watcher_run_id", "")).strip()
    if not latest_watcher_run_id:
        return "missing (latest_watcher_run_id absent)"

    freshness_label = _format_freshness_label(post_gate_metrics.get("generated_at"))
    if freshness_label.startswith("fresh"):
        return f"fresh / Run: {latest_watcher_run_id} / Freshness: {freshness_label}"
    return f"stale / Run: {latest_watcher_run_id} / Freshness: {freshness_label}"


def _format_dominant_entry(counts: dict[str, object]) -> str:
    normalized: dict[str, int] = {}
    for key, value in counts.items():
        try:
            normalized[str(key)] = int(value)
        except (TypeError, ValueError):
            continue

    if not normalized:
        return "none"

    max_count = max(normalized.values())
    dominant_keys = sorted(key for key, value in normalized.items() if value == max_count)
    if len(dominant_keys) == 1:
        return f"{dominant_keys[0]} (n={max_count})"
    return f"Multiple ({', '.join(dominant_keys)}) (n={max_count})"


def _load_metrics_snapshot(path: Path) -> dict[str, object] | None:
    if not path.exists():
        return None

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None

    return payload if isinstance(payload, dict) else None


def _delta_count_map(
    current: dict[str, object],
    previous: dict[str, object],
    field_name: str,
) -> dict[str, int]:
    current_counts = current.get(field_name, {})
    previous_counts = previous.get(field_name, {})
    if not isinstance(current_counts, dict):
        current_counts = {}
    if not isinstance(previous_counts, dict):
        previous_counts = {}

    delta: dict[str, int] = {}
    for key in sorted(set(current_counts) | set(previous_counts)):
        change = _safe_int(current_counts.get(key), 0) - _safe_int(previous_counts.get(key), 0)
        if change != 0:
            delta[str(key)] = change
    return delta


def _format_total_delta(current_total: object, previous_total: object) -> str:
    delta = _safe_int(current_total, 0) - _safe_int(previous_total, 0)
    if delta == 0:
        return "no change (0)"
    return f"{delta:+d}"


def _format_delta_map(delta_map: dict[str, int]) -> str:
    if not delta_map or all(value == 0 for value in delta_map.values()):
        return "no change"
    return json.dumps(delta_map, ensure_ascii=True)


def _build_watcher_run_id() -> str:
    timestamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    return f"watcher-{timestamp}-{time.time_ns() % 1_000_000_000:09d}"


def build_template_section(
    aggregation: dict[str, object],
    assessment: dict[str, object],
    dispatch_assessment: dict[str, object],
    gate_decision: dict[str, object],
    post_gate_action: dict[str, object],
    post_gate_metrics: dict[str, object] | None = None,
    post_gate_metrics_previous: dict[str, object] | None = None,
) -> str:
    dispatch_state = str(dispatch_assessment["dispatch_metrics_state"])
    dispatch_reason = str(dispatch_assessment["dispatch_metrics_reason"])
    failure_by_week = _render_distribution(dispatch_assessment.get("failures_by_week", {}))
    failure_by_run = _render_distribution(dispatch_assessment.get("failures_by_run", {}))
    gate_notes_lines = [
        f"  - {note}" for note in gate_decision.get("gate_notes", [])
    ]
    if not gate_notes_lines:
        gate_notes_lines = ["  - none"]

    action_evidence_lines = [
        f"  - {path}" for path in post_gate_action.get("evidence_paths", [])
    ]
    if not action_evidence_lines:
        action_evidence_lines = ["  - none"]

    metrics_block_lines = ["### Latest Post-Gate Action Metrics"]
    if post_gate_metrics:
        metrics_block_lines.extend(
            [
                f"- total_records: {post_gate_metrics.get('total_records', 'unknown')}",
                f"- latest_watcher_run_id: {post_gate_metrics.get('latest_watcher_run_id', 'unknown')}",
                f"- latest_record_generated_at: {post_gate_metrics.get('latest_record_generated_at', 'unknown')}",
                f"- counts_by_runbook_step_id: {json.dumps(post_gate_metrics.get('counts_by_runbook_step_id', {}), ensure_ascii=True)}",
                f"- counts_by_weekly_gate_status: {json.dumps(post_gate_metrics.get('counts_by_weekly_gate_status', {}), ensure_ascii=True)}",
                f"- counts_by_dispatch_governance_signal: {json.dumps(post_gate_metrics.get('counts_by_dispatch_governance_signal', {}), ensure_ascii=True)}",
            ]
        )
    else:
        metrics_block_lines.append("- unavailable: metrics artifact could not be loaded")

    trend_snapshot_lines = ["### Trend Snapshot"]
    if post_gate_metrics and post_gate_metrics_previous:
        runbook_delta = _delta_count_map(
            post_gate_metrics,
            post_gate_metrics_previous,
            "counts_by_runbook_step_id",
        )
        gate_delta = _delta_count_map(
            post_gate_metrics,
            post_gate_metrics_previous,
            "counts_by_weekly_gate_status",
        )
        signal_delta = _delta_count_map(
            post_gate_metrics,
            post_gate_metrics_previous,
            "counts_by_dispatch_governance_signal",
        )
        trend_snapshot_lines.extend(
            [
                f"- previous_watcher_run_id: {post_gate_metrics_previous.get('latest_watcher_run_id', 'unknown')}",
                f"- previous_record_generated_at: {post_gate_metrics_previous.get('latest_record_generated_at', 'unknown')}",
                f"- delta_total_records: {_format_total_delta(post_gate_metrics.get('total_records'), post_gate_metrics_previous.get('total_records'))}",
                f"- delta_counts_by_runbook_step_id: {_format_delta_map(runbook_delta)}",
                f"- delta_counts_by_weekly_gate_status: {_format_delta_map(gate_delta)}",
                f"- delta_counts_by_dispatch_governance_signal: {_format_delta_map(signal_delta)}",
            ]
        )
    else:
        trend_snapshot_lines.append("- unavailable: previous metrics snapshot not available")

    quick_interpretation_lines = ["### Quick Interpretation"]
    if post_gate_metrics:
        quick_interpretation_lines.extend(
            [
                f"- Primary Path: {_format_dominant_entry(post_gate_metrics.get('counts_by_runbook_step_id', {}))}",
                f"- Dominant Gate: {_format_dominant_entry(post_gate_metrics.get('counts_by_weekly_gate_status', {}))}",
                f"- Dominant Signal: {_format_dominant_entry(post_gate_metrics.get('counts_by_dispatch_governance_signal', {}))}",
                f"- Data Integrity: {_format_data_integrity_label(post_gate_metrics)}",
            ]
        )
    else:
        quick_interpretation_lines.append("- unavailable: metrics artifact could not be loaded")

    owner_canonical = str(
        post_gate_action.get("owner_canonical", post_gate_action.get("owner", "none"))
    )
    owner_display = _get_owner_display(owner_canonical)

    return "\n".join(
        [
            "## Week2 Baseline Capture Sheet",
            "",
            "### Observation Window",
            "- observation_window: Week2 Day1-Day3",
            f"- measurement_window: {aggregation['measurement_window']}",
            f"- sample_size: {aggregation['sample_size']}",
            f"- data_completeness: {aggregation['data_completeness']:.2%}",
            "",
            "### Measured Values",
            f"- median_cycle_time: {assessment['median_cycle_time']:.2f}h",
            f"- queue_age_p50: {assessment['queue_age_p50']:.2f}h",
            f"- queue_age_p90: {assessment['queue_age_p90']:.2f}h",
            "",
            "### Threshold Bands",
            "#### median_cycle_time",
            "- within_bound: < 48h",
            "- near_bound: 43.2h - 48h",
            "- out_of_bound: >= 48h",
            f"- observed_band: {assessment['median_cycle_time_band']}",
            "",
            "#### queue_age_p50",
            "- within_bound: <= 18h",
            "- near_bound: 16.2h - 18h",
            "- out_of_bound: > 18h",
            f"- observed_band: {assessment['queue_age_p50_band']}",
            "",
            "#### queue_age_p90",
            "- within_bound: <= 36h",
            "- near_bound: 32.4h - 36h",
            "- out_of_bound: > 36h",
            f"- observed_band: {assessment['queue_age_p90_band']}",
            "",
            "### Baseline Assessment",
            f"- baseline_assessment: {assessment['baseline_assessment']}",
            "  - within_bound",
            "  - near_bound",
            "  - out_of_bound",
            "",
            "### Baseline Conclusion",
            f"{assessment['audit_conclusion']}",
            "",
            "### Notes",
            "- invariant issues observed:",
            "- gate_freeze_occurred:",
            f"- measurement caveats: cycle_time basis = {aggregation['cycle_time_basis']}",
            "```",
            "",
            "Assessment rule:",
            "```text",
            "within_bound = all targets satisfied",
            "near_bound   = within 10% of threshold",
            "out_of_bound = any threshold exceeded",
            "```",
            "",
            "## Dispatch Audit Telemetry (Phase14 Governance Signal)",
            f"- dispatch_metrics_state: {dispatch_state}",
            f"- dispatch_metrics_reason: {dispatch_reason}",
            "",
            "### Threshold Evaluation",
            "- validation_failure_count > 0 -> review_note",
            f"  - observed: {dispatch_assessment['validation_failure_count']} -> {dispatch_assessment['validation_failure_signal']}",
            "- missing_required_context_count > 0 -> hard_attention",
            f"  - observed: {dispatch_assessment['missing_required_context_count']} -> {dispatch_assessment['missing_required_context_signal']}",
            "- dispatch_ready_rate < 1.0 -> investigation",
            f"  - observed: {dispatch_assessment['dispatch_ready_rate']:.4f} (parsed_line_count={dispatch_assessment['parsed_line_count']}) -> {dispatch_assessment['dispatch_ready_rate_signal']}",
            "",
            "### Failure Distribution",
            f"- failures_by_week: {failure_by_week}",
            f"- failures_by_run: {failure_by_run}",
            "",
            f"### Dispatch Governance Signal\n- overall_signal: {dispatch_assessment['dispatch_governance_signal']}",
            "",
            "### Weekly Gate Propagation",
            f"- baseline_assessment: {gate_decision['baseline_assessment']}",
            f"- dispatch_governance_signal: {gate_decision['dispatch_governance_signal']}",
            f"- weekly_gate_status: {gate_decision['weekly_gate_status']}",
            f"- gate_attention_required: {str(gate_decision['gate_attention_required']).lower()}",
            f"- gate_review_note_required: {str(gate_decision['gate_review_note_required']).lower()}",
            "- gate_notes:",
            *gate_notes_lines,
            "",
            "### Post-Decision Action Routing",
            f"- required_action: {post_gate_action['required_action']}",
            f"- runbook_step_id: {post_gate_action.get('runbook_step_id', 'RUNBOOK-UNKNOWN')}",
            f"- owner_canonical: {owner_canonical}",
            f"- owner (display): {owner_display}",
            f"- next_step: {post_gate_action['next_step']}",
            "- evidence_paths:",
            *action_evidence_lines,
            "",
            *metrics_block_lines,
            "",
            *trend_snapshot_lines,
            "",
            *quick_interpretation_lines,
        ]
    )

def update_template(
    template_file: str,
    aggregation: dict[str, object],
    assessment: dict[str, object],
    dispatch_assessment: dict[str, object],
    gate_decision: dict[str, object],
    post_gate_action: dict[str, object],
    post_gate_metrics: dict[str, object] | None = None,
    post_gate_metrics_previous: dict[str, object] | None = None,
) -> None:
    path = Path(template_file)
    text = path.read_text(encoding="utf-8")
    start = "## Week2 Baseline Capture Sheet"
    end = "### Risk Signals (Red Flags)"

    start_index = text.index(start)
    end_index = text.index(end)
    updated = (
        text[:start_index]
        + build_template_section(
            aggregation,
            assessment,
            dispatch_assessment,
            gate_decision,
            post_gate_action,
            post_gate_metrics,
            post_gate_metrics_previous,
        )
        + "\n\n"
        + text[end_index:]
    )
    path.write_text(updated, encoding="utf-8")


def _refresh_post_gate_action_metrics(
    output_dir: str = "phase14/data",
) -> tuple[dict[str, object] | None, dict[str, object] | None]:
    """Re-aggregate post-gate action metrics after each watcher run."""
    audit_file = str(Path(output_dir) / "post_gate_action.audit.jsonl")
    metrics_file = Path(output_dir) / "post_gate_action_metrics.latest.json"
    previous_file = Path(output_dir) / "post_gate_action_metrics.previous.json"
    try:
        previous_metrics = _load_metrics_snapshot(metrics_file)
        if previous_metrics is None:
            previous_metrics = _load_metrics_snapshot(previous_file)
        if previous_metrics is not None:
            previous_file.write_text(
                json.dumps(previous_metrics, ensure_ascii=True, indent=2) + "\n",
                encoding="utf-8",
            )
        metrics = build_post_gate_metrics(audit_file)
        metrics_file.parent.mkdir(parents=True, exist_ok=True)
        metrics_file.write_text(
            json.dumps(metrics, ensure_ascii=True, indent=2) + "\n", encoding="utf-8"
        )
        print(f"metrics refreshed: {metrics_file.resolve()}")
        return metrics, previous_metrics
    except Exception as exc:  # noqa: BLE001
        print(f"metrics refresh failed (non-fatal): {exc}", file=sys.stderr)
        return None, None


def save_post_gate_action_artifact(
    post_gate_action: dict[str, object],
    watcher_run_id: str,
    output_dir: str = "phase14/data",
) -> str:
    """Save post_gate_action as JSON artifact with timestamp."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    artifact_file = output_path / "post_gate_action.latest.json"
    
    artifact = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "watcher_run_id": watcher_run_id,
        **post_gate_action,
    }
    
    artifact_file.write_text(
        json.dumps(artifact, ensure_ascii=True, indent=2) + "\n",
        encoding="utf-8",
    )
    
    return str(artifact_file.resolve())


def append_post_gate_action_audit(
    post_gate_action: dict[str, object],
    gate_decision: dict[str, object],
    watcher_run_id: str,
    output_dir: str = "phase14/data",
) -> str:
    """Append post_gate_action as one JSONL record for historical analysis."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    audit_file = output_path / "post_gate_action.audit.jsonl"

    audit_record = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "watcher_run_id": watcher_run_id,
        "weekly_gate_status": str(gate_decision.get("weekly_gate_status", "WATCH")),
        "dispatch_governance_signal": str(
            gate_decision.get("dispatch_governance_signal", "ok")
        ),
        **post_gate_action,
    }
    with audit_file.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(audit_record, ensure_ascii=True) + "\n")

    return str(audit_file.resolve())

def run_once(args: argparse.Namespace) -> int:
    watcher_run_id = _build_watcher_run_id()
    aggregation_result = aggregate_metrics(
        candidate_file=args.candidate_file,
        queue_file=args.queue_file,
        window_start=args.window_start,
        window_end=args.window_end,
        as_of=args.as_of,
    )
    aggregation = aggregation_result.__dict__

    print(json.dumps(aggregation, ensure_ascii=True, indent=2))

    dispatch_metrics = load_dispatch_metrics(args.dispatch_audit_file)
    dispatch_assessment = assess_dispatch_metrics(dispatch_metrics)
    print(json.dumps(dispatch_assessment, ensure_ascii=True, indent=2))

    evidence_paths = [
        str(Path(args.dispatch_audit_file).resolve()),
        str(Path(args.candidate_file).resolve()),
        str(Path(args.queue_file).resolve()),
        str(Path(args.template_file).resolve()),
    ]

    if aggregation["baseline_input_state"] != "COMPLETE":
        pending_assessment = {
            "median_cycle_time": 0.0,
            "median_cycle_time_band": "pending",
            "queue_age_p50": float(aggregation.get("queue_age_p50") or 0.0),
            "queue_age_p50_band": "pending",
            "queue_age_p90": float(aggregation.get("queue_age_p90") or 0.0),
            "queue_age_p90_band": "pending",
            "baseline_assessment": "pending",
            "audit_conclusion": (
                "Week2 baseline pending: "
                f"{aggregation.get('reason', 'waiting for completed reviews')}"
            ),
        }
        gate_decision = derive_weekly_gate_decision(
            baseline_assessment="pending",
            dispatch_governance_signal=str(dispatch_assessment["dispatch_governance_signal"]),
        )
        post_gate_action = derive_post_gate_action(
            gate_decision=gate_decision,
            dispatch_assessment=dispatch_assessment,
            evidence_paths=evidence_paths,
        )

        print(json.dumps(gate_decision, ensure_ascii=True, indent=2))
        print(json.dumps(post_gate_action, ensure_ascii=True, indent=2))

        artifact_file = save_post_gate_action_artifact(post_gate_action, watcher_run_id)
        print(f"artifact saved: {artifact_file}")
        audit_file = append_post_gate_action_audit(
            post_gate_action,
            gate_decision,
            watcher_run_id,
        )
        print(f"audit appended: {audit_file}")
        post_gate_metrics, post_gate_metrics_previous = _refresh_post_gate_action_metrics()

        if not args.no_template_update:
            update_template(
                args.template_file,
                aggregation,
                pending_assessment,
                dispatch_assessment,
                gate_decision,
                post_gate_action,
                post_gate_metrics,
                post_gate_metrics_previous,
            )
            print(f"template updated (pending baseline): {args.template_file}")

        print("baseline fixation skipped: waiting for first completed reviews", file=sys.stderr)
        return 1

    assessment = build_assessment(
        BaselineInput(
            measurement_window=str(aggregation["measurement_window"]),
            sample_size=int(aggregation["sample_size"]),
            data_completeness=float(aggregation["data_completeness"]),
            median_cycle_time=float(aggregation["median_cycle_time"]),
            queue_age_p50=float(aggregation["queue_age_p50"]),
            queue_age_p90=float(aggregation["queue_age_p90"]),
        )
    )

    gate_decision = derive_weekly_gate_decision(
        baseline_assessment=str(assessment["baseline_assessment"]),
        dispatch_governance_signal=str(dispatch_assessment["dispatch_governance_signal"]),
    )
    post_gate_action = derive_post_gate_action(
        gate_decision=gate_decision,
        dispatch_assessment=dispatch_assessment,
        evidence_paths=evidence_paths,
    )

    print(json.dumps(assessment, ensure_ascii=True, indent=2))
    print(json.dumps(gate_decision, ensure_ascii=True, indent=2))
    print(json.dumps(post_gate_action, ensure_ascii=True, indent=2))

    artifact_file = save_post_gate_action_artifact(post_gate_action, watcher_run_id)
    print(f"artifact saved: {artifact_file}")
    audit_file = append_post_gate_action_audit(
        post_gate_action,
        gate_decision,
        watcher_run_id,
    )
    print(f"audit appended: {audit_file}")
    post_gate_metrics, post_gate_metrics_previous = _refresh_post_gate_action_metrics()

    if not args.no_template_update:
        update_template(
            args.template_file,
            aggregation,
            assessment,
            dispatch_assessment,
            gate_decision,
            post_gate_action,
            post_gate_metrics,
            post_gate_metrics_previous,
        )
        print(f"template updated: {args.template_file}")

    return 0


def main() -> None:
    args = parse_args()

    if args.once:
        raise SystemExit(run_once(args))

    while True:
        exit_code = run_once(args)
        if exit_code == 0:
            raise SystemExit(0)
        time.sleep(args.poll_seconds)


if __name__ == "__main__":
    main()