#!/usr/bin/env python3
"""Compare a complete reference Trades Log export with a local report.

Both inputs may be either ``{"trades": [...]}``, ``{"rows": [...]}``, or a
raw trade array.  The command deliberately fails when a source is missing or
the trade counts differ; partial captures must not be reported as parity.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime
from pathlib import Path

FIELDS = ("side", "entryTime", "entryPrice", "exitTime", "exitPrice", "qty", "pnl", "mfe", "mae")
NUMERIC = {"entryPrice", "exitPrice", "qty", "pnl", "mfe", "mae"}


def load_rows(path: Path) -> list[dict]:
    payload = json.loads(path.read_text())
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = payload.get("trades") or payload.get("rows")
        if rows is None and isinstance(payload.get("context"), dict):
            rows = payload["context"].get("trades")
    else:
        rows = None
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise ValueError(f"{path}: expected a trade array or an object containing trades/rows")
    return rows


def value(row: dict, field: str):
    aliases = {
        "entryTime": ("entryTime", "entry_time", "openTime", "entryTimestamp"),
        "exitTime": ("exitTime", "exit_time", "closeTime", "exitTimestamp"),
        "entryPrice": ("entryPrice", "entry_price", "openPrice"),
        "exitPrice": ("exitPrice", "exit_price", "closePrice"),
        "qty": ("qty", "quantity", "size"),
        "pnl": ("pnl", "profit", "netProfit"),
        "mfe": ("mfe", "maxRunup", "max_runup"),
        "mae": ("mae", "maxDrawdown", "max_drawdown"),
        "side": ("side", "direction"),
    }[field]
    for key in aliases:
        if key in row:
            current = row[key]
            if field in {"entryTime", "exitTime"} and isinstance(current, str):
                try:
                    return int(datetime.fromisoformat(current.replace("Z", "+00:00")).timestamp() * 1000)
                except ValueError:
                    pass
            return current
    return None


def key(row: dict, index: int) -> int:
    number = row.get("number", row.get("tradeNumber", row.get("id")))
    try:
        return int(number)
    except (TypeError, ValueError):
        return index + 1


def compare(reference: list[dict], local: list[dict], tolerance: float) -> dict:
    ref = {key(row, index): row for index, row in enumerate(reference)}
    actual = {key(row, index): row for index, row in enumerate(local)}
    differences = []
    for number in sorted(set(ref) | set(actual)):
        if number not in ref or number not in actual:
            differences.append({"trade": number, "reason": "missing-row"})
            continue
        for field in FIELDS:
            expected, observed = value(ref[number], field), value(actual[number], field)
            if field in NUMERIC and expected is not None and observed is not None:
                equal = math.isclose(float(expected), float(observed), abs_tol=tolerance, rel_tol=0)
            else:
                equal = expected == observed
            if not equal:
                differences.append({"trade": number, "field": field, "reference": expected, "local": observed})
    return {
        "referenceTrades": len(reference),
        "localTrades": len(local),
        "matchedTrades": len(set(ref) & set(actual)),
        "differenceCount": len(differences),
        "pass": not differences and len(ref) == len(actual),
        "differences": differences,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--local", type=Path, required=True)
    parser.add_argument("--tolerance", type=float, default=0.005)
    args = parser.parse_args()
    if not args.reference.is_file() or not args.local.is_file():
        print(json.dumps({"status": "not_run", "reason": "both complete golden inputs are required"}))
        return 2
    result = compare(load_rows(args.reference), load_rows(args.local), args.tolerance)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI reports malformed evidence.
        print(json.dumps({"status": "failed", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
