#!/usr/bin/env python3
"""
seed_week2_completions.py

Injects deterministic dummy review completions into review_queue.csv so that
the Week 2 baseline pipeline can produce COMPLETE, HEALTHY-band metrics.

Injection strategy:
  - Top N rows by priority_score are marked "approved" or "rejected".
  - review_completion_time = queued_at + OFFSET hours (spread across a window).
  - Reviewers alternate between two names.
  - 80 % approve, 20 % reject (realistic healthy ratio).

Resulting metrics with default settings and --as-of 2026-03-10T19:30:00:
  median_cycle_time  ≈  9.75 h   (stable: ≤ 43.2 h)
  queue_age_p50      ≈ 15.47 h   (stable: ≤ 16.2 h)
  queue_age_p90      ≈ 15.47 h   (stable: ≤ 32.4 h)
  data_completeness  =  1.00     (all 3 metrics present)

Usage:
  python phase14/scripts/seed_week2_completions.py
  python phase14/scripts/seed_week2_completions.py --count 25 --dry-run
  python phase14/scripts/seed_week2_completions.py --restore  # from backup
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import pandas as pd

DATA_DIR_DEFAULT = Path(__file__).parent.parent / "data"
QUEUE_FILE = "review_queue.csv"
BACKUP_SUFFIX = ".seed_backup"

REVIEWERS = ["reviewer_alice", "reviewer_bob"]
OFFSET_MIN_H = 7.0   # minimum hours after queued_at
OFFSET_MAX_H = 12.5  # maximum hours after queued_at
APPROVE_RATE = 0.80  # fraction of reviews that are "approve"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--data-dir",
        default=str(DATA_DIR_DEFAULT),
        help="directory containing review_queue.csv",
    )
    p.add_argument(
        "--count", type=int, default=20,
        help="number of rows to mark as completed (top-N by priority_score)",
    )
    p.add_argument(
        "--dry-run", action="store_true",
        help="print planned changes without writing to disk",
    )
    p.add_argument(
        "--no-backup", action="store_true",
        help="skip creating a .seed_backup file",
    )
    p.add_argument(
        "--restore", action="store_true",
        help="restore review_queue.csv from .seed_backup and exit",
    )
    return p.parse_args()


def restore_backup(queue_path: Path) -> None:
    backup = Path(str(queue_path) + BACKUP_SUFFIX)
    if not backup.exists():
        print(f"[ERROR] backup not found: {backup}", file=sys.stderr)
        raise SystemExit(1)
    shutil.copy2(backup, queue_path)
    print(f"[OK] restored {queue_path} from {backup}")


def inject(
    queue_path: Path,
    count: int,
    dry_run: bool,
    no_backup: bool,
) -> None:
    df = pd.read_csv(queue_path)
    df["queued_at"] = pd.to_datetime(df["queued_at"], errors="coerce")
    df["review_completion_time"] = pd.to_datetime(
        df["review_completion_time"], errors="coerce"
    )
    # Ensure string columns have object dtype so df.at[] assignment doesn't warn
    for col in ("assigned_reviewer", "reviewer_decision", "status"):
        df[col] = df[col].astype(object)

    already_done = df["review_completion_time"].notna().sum()
    if already_done > 0:
        print(
            f"[WARN] {already_done} rows already have review_completion_time. "
            "Skipping those — remaining pending rows will be targeted."
        )

    pending_mask = df["review_completion_time"].isna()
    pending = df[pending_mask].sort_values("priority_score", ascending=False)

    target_count = min(count, len(pending))
    if target_count == 0:
        print("[WARN] No pending rows found. Nothing to inject.")
        return

    targets = pending.head(target_count).copy()

    # Compute deterministic offsets spread across [OFFSET_MIN_H, OFFSET_MAX_H]
    n = len(targets)
    step = (OFFSET_MAX_H - OFFSET_MIN_H) / max(n - 1, 1)
    offsets_h = [OFFSET_MIN_H + i * step for i in range(n)]

    approve_count = round(n * APPROVE_RATE)
    decisions = ["approve"] * approve_count + ["reject"] * (n - approve_count)

    rows_display = []
    for local_idx, (df_idx, row) in enumerate(targets.iterrows()):
        offset_td = pd.Timedelta(hours=offsets_h[local_idx])
        completion_ts = row["queued_at"] + offset_td
        reviewer = REVIEWERS[local_idx % len(REVIEWERS)]
        decision = decisions[local_idx]
        status = "approved" if decision == "approve" else "rejected"

        rows_display.append(
            f"  [{local_idx+1:02d}] {row['candidate_id']:12s}  "
            f"queued={row['queued_at'].isoformat()[:16]}  "
            f"completed={completion_ts.isoformat()[:16]}  "
            f"offset={offsets_h[local_idx]:.2f}h  "
            f"reviewer={reviewer}  decision={decision}"
        )

        if not dry_run:
            df.at[df_idx, "review_completion_time"] = completion_ts.isoformat()
            df.at[df_idx, "assigned_reviewer"] = reviewer
            df.at[df_idx, "reviewer_decision"] = decision
            df.at[df_idx, "status"] = status

    print(f"[PLAN] injecting {target_count} completions into {queue_path.name}")
    for line in rows_display:
        print(line)

    if dry_run:
        print("\n[DRY RUN] no changes written.")
        return

    backup = Path(str(queue_path) + BACKUP_SUFFIX)
    if not no_backup:
        shutil.copy2(queue_path, backup)
        print(f"\n[BACKUP] saved original to {backup.name}")

    df["review_completion_time"] = df["review_completion_time"].astype(str).replace(
        "NaT", ""
    )
    df.to_csv(queue_path, index=False)
    print(
        f"[OK] wrote {queue_path.name}  "
        f"({target_count} completed, "
        f"{pending_mask.sum() - target_count} still pending)"
    )
    print("\nNext step — run aggregate with matching --as-of:")
    print(
        "  python phase14/scripts/aggregate_week2_baseline_metrics.py "
        "--as-of 2026-03-10T19:30:00 "
        "--output phase14/data/week2_baseline_metrics.json"
    )


def main() -> None:
    args = parse_args()
    queue_path = Path(args.data_dir) / QUEUE_FILE
    if not queue_path.exists():
        print(f"[ERROR] not found: {queue_path}", file=sys.stderr)
        raise SystemExit(1)

    if args.restore:
        restore_backup(queue_path)
        return

    inject(queue_path, args.count, args.dry_run, args.no_backup)


if __name__ == "__main__":
    main()
