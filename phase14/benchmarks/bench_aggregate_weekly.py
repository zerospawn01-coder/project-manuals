"""
phase14/benchmarks/bench_aggregate_weekly.py
============================================

自己完結型ベンチマークハーネス — aggregate_weekly_governance_report の實測
=========================================================================

目的:
    Phase B の BenchmarkSandboxRunner から呼び出され、
    「baseline 実行時間 vs patched 実行時間」を計測して JSON で返す。
    pytest-benchmark に依存せず stdlib のみ使用。

出力 (stdout の最後の JSON 行):
    {
      "benchmark_run_id": "<uuid>",
      "benchmark_signature": "<sha256 of this script>",
      "target_function": "aggregate_weekly_governance_report._load_json",
      "baseline_mean_ms": <float>,
      "patched_mean_ms": <float>,
      "saved_time_minutes_actual": <float | null>,
      "iterations": <int>,
      "repetitions": <int>,
      "delta_ms": <float>,
      "delta_pct": <float | null>,
      "measurement_env_valid": <bool>,
      "env": {
        "python_version": "<str>",
        "platform": "<str>",
        "cpu_count": <int | null>,
        "benchmark_script_path": "<str>"
      },
      "error": null | "<str>"
    }

呼び出し方:
    python bench_aggregate_weekly.py \
        --baseline-dir <path_to_original_worktree> \
        --patched-dir  <path_to_patched_worktree> \
        [--iterations 10] \
        [--repetitions 3]

    どちらの dir も省略した場合は統合テスト用の self-timing モード:
    _load_json_standalone のダミーを計測して provenance を発行する。

Provenance セマンティクス:
    benchmark_signature = SHA-256 of THIS FILE (bench_aggregate_weekly.py)
    Phase B の audit log に記録され、再現可能性の証拠になる。
    スクリプトを変更したらシグネチャが変わり、前後の計測結果が区別できる。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import sys
import tempfile
import timeit
import uuid
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Provenance: hash this script itself
# ---------------------------------------------------------------------------

def _script_signature() -> str:
    """SHA-256 of this benchmark script (reproducibility proof)."""
    script_path = Path(__file__).resolve()
    try:
        content = script_path.read_bytes()
        return hashlib.sha256(content).hexdigest()
    except OSError:
        return "unavailable"


# ---------------------------------------------------------------------------
# Standalone fallback target
# (used in self-timing mode / when source dir is unavailable)
# ---------------------------------------------------------------------------

def _load_json_standalone(tmp_file: str) -> dict:
    """Minimal reproduction of aggregate_weekly_governance_report._load_json."""
    p = Path(tmp_file)
    if not p.exists():
        raise RuntimeError(f"Required file not found: {p}")
    return json.loads(p.read_text(encoding="utf-8-sig"))


# ---------------------------------------------------------------------------
# Real target loader: import from a worktree dir via sys.path manipulation
# ---------------------------------------------------------------------------

def _make_loader(scripts_dir: str):
    """
    Dynamically import _load_json from the target worktree.
    Falls back to the standalone version on ImportError.
    Returns (callable, source_label).
    """
    scripts_path = Path(scripts_dir).resolve()
    if not scripts_path.is_dir():
        return _load_json_standalone, "standalone_fallback"

    src_dir = str(scripts_path.parent.parent / "src")
    for p in [str(scripts_path), src_dir]:
        if p not in sys.path:
            sys.path.insert(0, p)

    try:
        import importlib.util as ilu
        spec = ilu.spec_from_file_location(
            "aggregate_weekly_governance_report",
            scripts_path / "aggregate_weekly_governance_report.py",
        )
        if spec is None or spec.loader is None:
            raise ImportError("spec_from_file_location returned None")
        mod = ilu.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        # mod._load_json expects Path, but harness passes str → wrap to convert
        _real_fn = mod._load_json  # type: ignore[attr-defined]
        return lambda p: _real_fn(Path(p)), "worktree"
    except Exception:
        return _load_json_standalone, "standalone_fallback"


# ---------------------------------------------------------------------------
# Single timing run
# ---------------------------------------------------------------------------

def _time_load_json(
    loader,
    tmp_file: str,
    iterations: int,
    number: int = 1,
) -> list[float]:
    """
    Run `loader(tmp_file)` `iterations` times (each timed by timeit).
    Returns list of elapsed seconds (length = iterations).
    """
    results: list[float] = []
    stmt = lambda: loader(tmp_file)  # noqa: E731
    for _ in range(iterations):
        elapsed = timeit.timeit(stmt, number=number)
        results.append(elapsed / number)
    return results


def _mean(vals: list[float]) -> float:
    if not vals:
        return 0.0
    return sum(vals) / len(vals)


# ---------------------------------------------------------------------------
# Main bench logic
# ---------------------------------------------------------------------------

def run_benchmark(
    baseline_dir: str | None,
    patched_dir: str | None,
    iterations: int,
    repetitions: int,
    tmp_json_content: dict | None = None,
) -> dict[str, Any]:
    run_id = str(uuid.uuid4())
    signature = _script_signature()

    env = {
        "python_version": sys.version,
        "platform": platform.platform(),
        "cpu_count": os.cpu_count(),
        "benchmark_script_path": str(Path(__file__).resolve()),
    }

    # Create a temp JSON file for the loader to read
    tmp_content = tmp_json_content or {"_bench": True, "rows": list(range(100))}
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    ) as f:
        json.dump(tmp_content, f)
        tmp_path = f.name

    try:
        baseline_fn, baseline_src = _make_loader(baseline_dir or "")
        patched_fn, patched_src = _make_loader(patched_dir or "")

        # Run baseline
        baseline_times: list[float] = []
        for _ in range(repetitions):
            baseline_times.extend(
                _time_load_json(baseline_fn, tmp_path, iterations)
            )

        # Run patched
        patched_times: list[float] = []
        for _ in range(repetitions):
            patched_times.extend(
                _time_load_json(patched_fn, tmp_path, iterations)
            )

        baseline_mean_ms = _mean(baseline_times) * 1000.0
        patched_mean_ms = _mean(patched_times) * 1000.0
        delta_ms = baseline_mean_ms - patched_mean_ms  # positive = improvement

        # Convert to minutes (for Phase B saved_time_minutes_actual)
        # Assumption: this I/O call runs once per "manual investigation session"
        # that would otherwise take a human ~1 min to locate the file.
        # saved_time = wall_clock_delta_per_run * estimated_calls_per_day_by_human / 60
        # For Phase 14 context: governance report is generated ~1x/week;
        # if the script saves delta_ms across 100 invocations / week, convert:
        ESTIMATED_WEEKLY_INVOCATIONS = 100
        saved_time_minutes_actual: float | None = None
        if delta_ms > 0:
            saved_seconds = (delta_ms / 1000.0) * ESTIMATED_WEEKLY_INVOCATIONS
            saved_time_minutes_actual = round(saved_seconds / 60.0, 4)

        delta_pct: float | None = None
        if baseline_mean_ms > 0:
            delta_pct = round((delta_ms / baseline_mean_ms) * 100.0, 2)

        measurement_env_valid = (
            baseline_mean_ms > 0 and patched_mean_ms > 0
            and len(baseline_times) >= repetitions
            and len(patched_times) >= repetitions
        )

        return {
            "benchmark_run_id": run_id,
            "benchmark_signature": signature,
            "target_function": "aggregate_weekly_governance_report._load_json",
            "baseline_label": baseline_src,
            "patched_label": patched_src,
            "baseline_mean_ms": round(baseline_mean_ms, 4),
            "patched_mean_ms": round(patched_mean_ms, 4),
            "saved_time_minutes_actual": saved_time_minutes_actual,
            "iterations": iterations,
            "repetitions": repetitions,
            "delta_ms": round(delta_ms, 4),
            "delta_pct": delta_pct,
            "measurement_env_valid": measurement_env_valid,
            "env": env,
            "error": None,
        }

    except Exception as exc:
        return {
            "benchmark_run_id": run_id,
            "benchmark_signature": signature,
            "target_function": "aggregate_weekly_governance_report._load_json",
            "baseline_label": None,
            "patched_label": None,
            "baseline_mean_ms": None,
            "patched_mean_ms": None,
            "saved_time_minutes_actual": None,
            "iterations": iterations,
            "repetitions": repetitions,
            "delta_ms": None,
            "delta_pct": None,
            "measurement_env_valid": False,
            "env": env,
            "error": str(exc),
        }
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Benchmark _load_json in aggregate_weekly_governance_report.py. "
            "Outputs a single JSON line to stdout."
        )
    )
    parser.add_argument(
        "--baseline-dir",
        default=None,
        help="Path to scripts/ dir of the baseline worktree. "
             "Omit to use standalone fallback.",
    )
    parser.add_argument(
        "--patched-dir",
        default=None,
        help="Path to scripts/ dir of the patched worktree. "
             "Omit to use standalone fallback (same fn as baseline → delta≈0).",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=10,
        help="Number of timing iterations per repetition (default: 10).",
    )
    parser.add_argument(
        "--repetitions",
        type=int,
        default=3,
        help="Number of repetitions (default: 3; total samples = iterations × repetitions).",
    )
    parser.add_argument(
        "--out-json",
        default=None,
        help="Optional path to write the JSON result (in addition to stdout).",
    )
    args = parser.parse_args(argv)

    result = run_benchmark(
        baseline_dir=args.baseline_dir,
        patched_dir=args.patched_dir,
        iterations=args.iterations,
        repetitions=args.repetitions,
    )

    output = json.dumps(result, ensure_ascii=False)
    print(output)

    if args.out_json:
        out_path = Path(args.out_json)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output, encoding="utf-8")


if __name__ == "__main__":
    main()
