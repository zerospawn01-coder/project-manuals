from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise RuntimeError(f"Required file not found: {path}")

    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise RuntimeError(
                    f"Invalid JSONL in {path} at line {line_number}: {exc.msg}"
                ) from exc
            if not isinstance(row, dict):
                raise RuntimeError(
                    f"Invalid JSONL row in {path} at line {line_number}: expected object"
                )
            rows.append(row)
    return rows
