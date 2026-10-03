#!/usr/bin/env python3
"""Real-network smoke test for the Vela Binance and Hyperliquid providers."""

from __future__ import annotations

import json
import os
import argparse
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import urlopen

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = 4179
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


def run_smoke(rounds: int = 1) -> dict[str, object]:
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
        result = page.evaluate("rounds => window.runProviderSmoke(rounds)", rounds)
        browser.close()
        if page_errors:
            raise AssertionError(page_errors)
        return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rounds', type=int, default=int(os.environ.get('QUANT_PROVIDER_SMOKE_ROUNDS', '1')))
    args = parser.parse_args()
    if args.rounds < 1:
        parser.error('--rounds must be positive')
    server = subprocess.Popen(
        [
            "npm",
            "run",
            "dev",
            "--",
            "--host",
            HOST,
            "--port",
            str(PORT),
            "--strictPort",
        ],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        wait_for_server(server)
        result = run_smoke(args.rounds)
        required = {'binance', 'binanceFutures', 'hyperliquid'}
        missing = required.difference(result)
        if missing:
            raise AssertionError(f'provider smoke omitted routes: {sorted(missing)}')
        if result.get('roundsCompleted') != args.rounds:
            raise AssertionError(f"provider smoke completed {result.get('roundsCompleted')} rounds, expected {args.rounds}")
        print(json.dumps(result, sort_keys=True))
        return 0
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - smoke runner must report all failures.
        print(f"Provider smoke failed: {error}", file=sys.stderr)
        raise
