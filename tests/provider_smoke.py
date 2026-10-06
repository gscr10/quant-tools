#!/usr/bin/env python3
"""Real-network smoke test for the Vela Binance and Hyperliquid providers."""

from __future__ import annotations

import json
import math
import os
import argparse
from pathlib import Path
import subprocess
import sys
import time
import socket
import tempfile
from urllib.request import urlopen

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = int(os.environ.get("QUANT_PROVIDER_PORT", "4179"))
URL = f"http://{HOST}:{PORT}/tests/fixtures/provider-smoke.html"


def wait_for_server(process: subprocess.Popen[str]) -> None:
    startup_timeout = float(os.environ.get("QUANT_E2E_STARTUP_TIMEOUT", "90"))
    deadline = time.monotonic() + max(5.0, startup_timeout)
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(
                f"Vite exited before becoming ready ({process.returncode})\n{output}"
            )
        try:
            with urlopen(URL, timeout=0.5) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError("Timed out waiting for the Vite provider-smoke server")


def wait_for_recovery_bar(page, minimum: int, timeout_ms: int = 90_000) -> list[dict[str, object]]:
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        state = page.evaluate("window.providerRecoveryState()")
        if state.get("error"):
            raise AssertionError(state["error"])
        bars = state.get("bars", [])
        if len(bars) >= minimum:
            return bars
        time.sleep(0.25)
    raise TimeoutError(f"provider recovery did not deliver bar {minimum} within {timeout_ms}ms")


def run_smoke(rounds: int = 1, recovery: bool = False, duration_seconds: float = 0) -> dict[str, object]:
    executable = os.environ.get("CHROMIUM_EXECUTABLE")
    if not executable:
        mac_chromium = "/Applications/Chromium.app/Contents/MacOS/Chromium"
        if Path(mac_chromium).exists():
            executable = mac_chromium

    with sync_playwright() as playwright:
        launch_options: dict[str, object] = {"headless": True}
        if executable:
            launch_options["executable_path"] = executable
        browser = playwright.chromium.launch(**launch_options)
        page = browser.new_page()
        page.set_default_timeout(45_000)
        page_errors: list[str] = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        response = page.goto(URL, wait_until="domcontentloaded", timeout=30_000)
        assert response is not None and response.status == 200
        page.wait_for_function("window.providerSmokeReady === true")
        if duration_seconds:
            result = page.evaluate(
                "durationMs => window.runProviderSoak(durationMs)",
                round(duration_seconds * 1000),
            )
            result["roundsCompleted"] = 1
            result["durationSeconds"] = duration_seconds
        else:
            result = page.evaluate("rounds => window.runProviderSmoke(rounds)", rounds)
        if recovery:
            recovery_results = {}
            for provider_name in ("binance", "hyperliquid"):
                page.evaluate("name => window.beginProviderRecovery(name)", provider_name)
                before = wait_for_recovery_bar(page, 1)
                page.evaluate("window.setProviderRecoveryOnline(false)")
                page.context.set_offline(True)
                time.sleep(1.0)
                offline_state = page.evaluate("window.providerRecoveryState()")
                page.context.set_offline(False)
                page.evaluate("window.setProviderRecoveryOnline(true)")
                after = wait_for_recovery_bar(page, len(before) + 1)
                page.evaluate("window.endProviderRecovery()")
                if offline_state.get("offlineBars", 0):
                    raise AssertionError(
                        f"{provider_name} delivered {offline_state['offlineBars']} bars while offline"
                    )
                recovery_results[provider_name] = {
                    "initialBars": len(before),
                    "resumedBars": len(after),
                    "offlineBars": offline_state.get("offlineBars", 0),
                    "resumed": True,
                }
            result["networkRecovery"] = recovery_results
        browser.close()
        if page_errors:
            raise AssertionError(page_errors)
        return result


def choose_port() -> int:
    requested = os.environ.get("QUANT_PROVIDER_PORT")
    if requested:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind((HOST, PORT))
        return PORT
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((HOST, 0))
        return int(probe.getsockname()[1])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rounds', type=int, default=int(os.environ.get('QUANT_PROVIDER_SMOKE_ROUNDS', '1')))
    parser.add_argument('--recovery', action='store_true', help='toggle the real browser offline/online state')
    parser.add_argument('--duration-seconds', type=float, default=float(os.environ.get('QUANT_PROVIDER_SMOKE_DURATION_SECONDS', '0')))
    args = parser.parse_args()
    if args.rounds < 1:
        parser.error('--rounds must be positive')
    if not math.isfinite(args.duration_seconds) or args.duration_seconds < 0:
        parser.error('--duration-seconds must be finite and non-negative')
    global PORT, URL
    PORT = choose_port()
    URL = f"http://{HOST}:{PORT}/tests/fixtures/provider-smoke.html"
    server_log = tempfile.TemporaryFile(mode="w+")
    server = subprocess.Popen(
        [
            "npm",
            "run",
            "dev:fast",
            "--",
            "--host",
            HOST,
            "--port",
            str(PORT),
            "--strictPort",
            "--config",
            "tests/vite-provider.config.ts",
        ],
        cwd=ROOT,
        stdout=server_log,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        wait_for_server(server)
        if args.duration_seconds:
            # A duration gate is one continuous browser/page lease. Repeating
            # short smoke processes would only test cold-start connections and
            # could never prove that a mounted subscription survives the soak.
            started = time.monotonic()
            result = run_smoke(1, recovery=args.recovery, duration_seconds=args.duration_seconds)
            result["roundsCompleted"] = 1
            result["durationSeconds"] = round(time.monotonic() - started, 3)
        else:
            result = run_smoke(args.rounds, args.recovery)
        required = {'binance', 'binanceFutures', 'hyperliquid'}
        missing = required.difference(result)
        if missing:
            raise AssertionError(f'provider smoke omitted routes: {sorted(missing)}')
        expected_rounds = args.rounds if not args.duration_seconds else int(result.get("roundsCompleted", 0))
        if result.get('roundsCompleted') != expected_rounds:
            raise AssertionError(f"provider smoke completed {result.get('roundsCompleted')} rounds, expected {args.rounds}")
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        server_log.flush()
        server_log.seek(0)
        print(server_log.read()[-8000:], file=sys.stderr)
        raise
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)
        server_log.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - smoke runner must report all failures.
        print(f"Provider smoke failed: {error}", file=sys.stderr)
        raise
