#!/usr/bin/env python3
"""Run the startup probe in an ABBA matrix and summarize median/p95.

The probe's explicit venue route is the optimized path; a bare symbol with an
artificial index delay is the baseline path.  The matrix is intentionally
black-box: each cell starts its own isolated Vite server/profile, so browser
cache and localStorage cannot leak between samples.  Results are written to
the ignored startup-loading evidence directory and are suitable for comparing
the same commit on two machines.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / "tests" / "startup_loading.py"


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = (len(ordered) - 1) * fraction
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)


def run_cell(label: str, symbol: str, args: argparse.Namespace) -> dict:
    output = args.output / label
    output.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable, str(PROBE), "--label", label,
        "--samples", str(args.samples), "--symbol", symbol,
        "--bars", str(args.bars), "--index-delay", str(args.index_delay),
        "--bar-delay", str(args.bar_delay), "--browser", args.browser,
        "--output", str(output),
    ]
    if args.preview:
        command.append("--preview")
    subprocess.run(command, cwd=ROOT, check=True)
    payload = json.loads((output / f"{label}.json").read_text())
    results = payload.get("results", [])
    failures = [item for item in results if item.get("failure")]
    paints = [float(item["candlePaint"]) for item in results if item.get("candlePaint") is not None]
    return {
        "label": label,
        "symbol": symbol,
        "samples": len(results),
        "failures": failures,
        "firstPaintMs": {
            "median": percentile(paints, 0.5),
            "p95": percentile(paints, 0.95),
            "min": min(paints) if paints else None,
            "max": max(paints) if paints else None,
        },
        "source": str(output / f"{label}.json"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--bars", type=int, default=2000)
    parser.add_argument("--index-delay", type=float, default=2.0)
    parser.add_argument("--bar-delay", type=float, default=0.3)
    parser.add_argument("--browser", choices=["chromium", "firefox", "webkit"], default="chromium")
    parser.add_argument("--preview", action="store_true")
    parser.add_argument(
        "--max-p95",
        type=float,
        default=None,
        help="fail if any cell's first-paint p95 exceeds this many milliseconds",
    )
    parser.add_argument(
        "--max-failures",
        type=int,
        default=0,
        help="maximum failed samples allowed across the matrix (default: 0)",
    )
    parser.add_argument("--output", type=Path, default=ROOT / "audit-evidence/startup-loading/matrix")
    args = parser.parse_args()
    if args.samples < 1:
        parser.error("--samples must be positive")
    if args.max_p95 is not None and args.max_p95 <= 0:
        parser.error("--max-p95 must be positive")
    if args.max_failures < 0:
        parser.error("--max-failures cannot be negative")

    # ABBA keeps thermal/process drift from making one side look better merely
    # because it ran first.  Every invocation uses a fresh profile and server.
    cells = [
        ("baseline-a", "BTCUSDT"),
        ("optimized-b", "binance:BTCUSDT"),
        ("optimized-b2", "binance:BTCUSDT"),
        ("baseline-a2", "BTCUSDT"),
    ]
    summaries = [run_cell(label, symbol, args) for label, symbol in cells]
    grouped = {
        "baseline": [summaries[0], summaries[3]],
        "optimized": [summaries[1], summaries[2]],
    }
    def merge(items: list[dict]) -> dict:
        values = [
            cell["firstPaintMs"]["median"]
            for cell in items if cell["firstPaintMs"]["median"] is not None
        ]
        failures = sum(len(cell["failures"]) for cell in items)
        return {
            "cells": [cell["label"] for cell in items],
            "samples": sum(cell["samples"] for cell in items),
            "failures": failures,
            "cellMedianOfMediansMs": statistics.median(values) if values else None,
            "cellP95OfP95Ms": max(
                cell["firstPaintMs"]["p95"] for cell in items
                if cell["firstPaintMs"]["p95"] is not None
            ) if values else None,
        }
    result = {
        "schema": 1,
        "order": "ABBA",
        "args": {key: str(value) if isinstance(value, Path) else value for key, value in vars(args).items()},
        "cells": summaries,
        "groups": {name: merge(items) for name, items in grouped.items()},
    }
    args.output.mkdir(parents=True, exist_ok=True)
    path = args.output / "matrix.json"
    path.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False))
    failures = sum(len(cell["failures"]) for cell in summaries)
    over_budget = (
        args.max_p95 is not None
        and any(
            cell["firstPaintMs"]["p95"] is not None
            and cell["firstPaintMs"]["p95"] > args.max_p95
            for cell in summaries
        )
    )
    return 1 if failures > args.max_failures or over_budget else 0


if __name__ == "__main__":
    raise SystemExit(main())
