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
ALIASES = {
    "entryTime": ("entryTime", "entry_time", "openTime", "entryTimestamp"),
    "exitTime": ("exitTime", "exit_time", "closeTime", "exitTimestamp"),
    "entryPrice": ("entryPrice", "entry_price", "openPrice"),
    "exitPrice": ("exitPrice", "exit_price", "closePrice"),
    "qty": ("qty", "quantity", "size"),
    "pnl": ("pnl", "profit", "netProfit"),
    "mfe": ("mfe", "maxRunup", "max_runup"),
    "mae": ("mae", "maxDrawdown", "max_drawdown"),
    "side": ("side", "direction"),
}


def load_rows(path: Path) -> list[dict]:
    def reject_nonfinite(token: str):
        raise ValueError(f"{path}: non-finite JSON number {token}")
    payload = json.loads(path.read_text(), parse_constant=reject_nonfinite)
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        # Do not use ``a or b`` here.  An explicitly exported empty ``trades``
        # array is meaningful evidence and must not silently fall back to a
        # different, possibly stale ``rows`` field in the same envelope.
        containers = [key for key in ("trades", "rows") if key in payload]
        if len(containers) > 1:
            raise ValueError(f"{path}: ambiguous trade envelope contains both trades and rows")
        if containers:
            rows = payload[containers[0]]
        elif isinstance(payload.get("context"), dict) and "trades" in payload["context"]:
            rows = payload["context"]["trades"]
        else:
            rows = None
    else:
        rows = None
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise ValueError(f"{path}: expected a trade array or an object containing trades/rows")
    return rows


def value(row: dict, field: str):
    for key in ALIASES[field]:
        if key in row:
            current = row[key]
            if field in {"entryTime", "exitTime"} and isinstance(current, str):
                try:
                    return int(datetime.fromisoformat(current.replace("Z", "+00:00")).timestamp() * 1000)
                except ValueError:
                    try:
                        numeric_time = float(current.strip())
                        return int(numeric_time) if numeric_time.is_integer() else numeric_time
                    except ValueError:
                        pass
            if field == "side" and isinstance(current, str):
                return current.strip().lower()
            if field in NUMERIC and isinstance(current, str):
                try:
                    number = float(current)
                    return number if math.isfinite(number) else current
                except ValueError:
                    return current
            return current
    return None


def has_value_field(row: dict, field: str) -> bool:
    """Distinguish an explicit null (valid for an open exit) from omission."""
    return any(alias in row for alias in ALIASES[field])


def key(row: dict, index: int) -> int:
    number = row.get("number", row.get("tradeNumber", row.get("id")))
    try:
        return int(number)
    except (TypeError, ValueError):
        return index + 1


def indexed_rows(rows: list[dict], source: str) -> tuple[dict[int, dict], list[dict]]:
    """Index rows without silently dropping duplicate Trade # records."""
    indexed: dict[int, dict] = {}
    errors: list[dict] = []
    for index, row in enumerate(rows):
        number = row.get("number", row.get("tradeNumber", row.get("id")))
        if number is None or (isinstance(number, str) and not number.strip()):
            errors.append({"source": source, "row": index, "reason": "missing-trade-number"})
            continue
        if isinstance(number, bool):
            errors.append({"source": source, "row": index, "reason": "invalid-trade-number", "value": number})
            continue
        try:
            trade_number = int(number)
            if isinstance(number, float) and not number.is_integer():
                raise ValueError("non-integral number")
            if isinstance(number, str) and str(trade_number) != number.strip():
                raise ValueError("non-integral or non-canonical number")
        except (TypeError, ValueError):
            errors.append({"source": source, "row": index, "reason": "invalid-trade-number", "value": number})
            continue
        if trade_number in indexed:
            errors.append({"source": source, "row": index, "trade": trade_number, "reason": "duplicate-trade-number"})
            continue
        indexed[trade_number] = row
    return indexed, errors


def validate_values(rows: list[dict], source: str) -> list[dict]:
    """Matching omissions/nulls must not masquerade as a complete golden.

    Only an open trade can omit its exit values and realized P&L. Numeric
    strings are accepted, but booleans are not numbers in this contract.
    """
    errors = []
    for index, row in enumerate(rows):
        open_trade = has_value_field(row, "exitTime") and value(row, "exitTime") is None
        if "open" in row and (not isinstance(row["open"], bool) or row["open"] != open_trade):
            errors.append({"source": source, "row": index, "reason": "inconsistent-open-state"})
        for field in FIELDS:
            # The comparison reports missing-field separately.
            if not has_value_field(row, field):
                continue
            current = value(row, field)
            if current is None and open_trade and field in {"exitTime", "exitPrice", "pnl"}:
                continue
            if field == "side":
                valid = current in ("long", "short")
            else:
                valid = (not isinstance(current, bool) and isinstance(current, (int, float))
                         and math.isfinite(current))
                if valid and field in {"entryTime", "exitTime"}:
                    valid = current == int(current)
            if not valid:
                errors.append({"source": source, "row": index, "field": field,
                               "reason": "invalid-field-value", "value": current})
        if open_trade and has_value_field(row, "exitPrice") and value(row, "exitPrice") is not None:
            errors.append({"source": source, "row": index, "field": "exitPrice",
                           "reason": "open-trade-has-exit-price"})
    return errors


def compare(reference: list[dict], local: list[dict], tolerance: float) -> dict:
    if not math.isfinite(tolerance) or tolerance < 0:
        raise ValueError("tolerance must be finite and non-negative")
    ref, ref_errors = indexed_rows(reference, "reference")
    actual, local_errors = indexed_rows(local, "local")
    differences = []
    errors = ref_errors + local_errors + validate_values(reference, "reference") + validate_values(local, "local")
    for number in sorted(set(ref) | set(actual)):
        if number not in ref or number not in actual:
            differences.append({"trade": number, "reason": "missing-row"})
            continue
        for field in FIELDS:
            if not has_value_field(ref[number], field) or not has_value_field(actual[number], field):
                differences.append({"trade": number, "field": field, "reason": "missing-field"})
                continue
            expected, observed = value(ref[number], field), value(actual[number], field)
            if field in NUMERIC and expected is not None and observed is not None:
                try:
                    expected_number, observed_number = float(expected), float(observed)
                    equal = (math.isfinite(expected_number) and math.isfinite(observed_number)
                             and math.isclose(expected_number, observed_number, abs_tol=tolerance, rel_tol=0))
                except (TypeError, ValueError):
                    equal = False
            else:
                equal = expected == observed
            if not equal:
                differences.append({"trade": number, "field": field, "reference": expected, "local": observed})
    return {
        "referenceTrades": len(reference),
        "localTrades": len(local),
        "matchedTrades": len(set(ref) & set(actual)),
        "differenceCount": len(differences),
        "pass": not errors and not differences and len(reference) == len(local),
        "errors": errors,
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
