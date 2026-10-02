#!/usr/bin/env python3
"""Smoke-test the production bundle while the browser has no network access.

This is intentionally narrower than ``tests/e2e_app.py``.  The latter mocks
the supported market providers so it can exercise a deterministic chart and
backtest fixture.  This runner does not mock anything: every non-local HTTP(S)
request is aborted by Playwright and WebSocket attempts are recorded.
Binance/Hyperliquid attempts are reported as
expected provider attempts (the application may still try to discover market
metadata while starting), while any other external host is a release failure.

The test proves that a disconnected production artifact can still mount the
existing Workspace shell and its local controls.  It does *not* claim that
market data is available without a provider/cache.  Provider-backed chart and
backtest behavior remains covered by the deterministic mock-provider E2E.

Usage::

    npm run build
    python3 tests/release_offline_smoke.py

Set ``QUANT_OFFLINE_PORT`` or ``QUANT_E2E_STARTUP_TIMEOUT`` when the local
preview server needs a different port or startup window.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time
from urllib.parse import urlparse
from urllib.request import urlopen

from playwright.sync_api import BrowserContext, Page, Route, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = int(os.environ.get("QUANT_OFFLINE_PORT", "4182"))
BASE_URL = f"http://{HOST}:{PORT}/?chart=maximized"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
PROVIDER_HOSTS = {
    "api.binance.com",
    "api.binance.us",
    "fapi.binance.com",
    "api.hyperliquid.xyz",
}


def assert_port_available() -> None:
    """Fail clearly instead of probing a stale preview process."""

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((HOST, PORT))
        except OSError as error:
            raise RuntimeError(
                f"port {PORT} is already in use; stop the old preview or set "
                "QUANT_OFFLINE_PORT to an unused port"
            ) from error


def wait_for_server(process: subprocess.Popen[str]) -> None:
    timeout = float(os.environ.get("QUANT_E2E_STARTUP_TIMEOUT", "90"))
    deadline = time.monotonic() + max(timeout, 5.0)
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(
                f"Vite preview exited before becoming ready ({process.returncode})\n{output}"
            )
        try:
            with urlopen(BASE_URL, timeout=0.5) as response:
                if response.status == 200:
                    if process.poll() is not None:
                        output = process.stdout.read() if process.stdout else ""
                        raise RuntimeError(
                            f"Vite preview exited while its port was being probed "
                            f"({process.returncode})\n{output}"
                        )
                    return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError("Timed out waiting for the production preview")


def install_network_block(context: BrowserContext, blocked: list[str]) -> None:
    """Abort every non-local request and retain its URL for classification."""

    def handle(route: Route) -> None:
        request_url = route.request.url
        parsed = urlparse(request_url)
        hostname = (parsed.hostname or "").lower().rstrip(".")
        if parsed.scheme in {"http", "https"} and hostname not in LOCAL_HOSTS:
            blocked.append(request_url)
            route.abort("blockedbyclient")
            return
        route.continue_()

    context.route("**/*", handle)


def assert_local_workspace(page: Page) -> dict[str, int]:
    """Exercise controls that must remain available with backtesting isolated."""

    selectors = {
        "favorites": "#vela-action-quant-favorites",
        "templates": "#vela-action-quant-templates",
        "pineEditor": "#vela-tool-vela-widget-panel-quant-pine-editor",
        "backtestHost": "#backtest-workbench",
    }
    counts: dict[str, int] = {}
    for name, selector in selectors.items():
        counts[name] = page.locator(selector).count()
        assert counts[name] == 1, f"missing or duplicate {name}: {counts[name]}"

    indicators = page.get_by_role("button", name="Indicators", exact=True)
    assert indicators.count() == 1, "Indicators control is missing or duplicated"
    indicators.click()
    page.locator(".quant-indicator-category-label").first.wait_for(state="visible")
    page.keyboard.press("Escape")

    pine = page.locator(selectors["pineEditor"])
    if pine.get_attribute("data-active") != "1":
        pine.click()
    page.locator(".quant-pine-body").wait_for(state="visible")

    page.locator(selectors["templates"]).click()
    page.locator(".template-popover").wait_for(state="visible")
    page.keyboard.press("Escape")
    return counts


def run_smoke() -> dict[str, object]:
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
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        blocked: list[str] = []
        websocket_urls: list[str] = []
        page_errors: list[str] = []
        console_errors: list[str] = []
        install_network_block(context, blocked)
        context.on("websocket", lambda websocket: websocket_urls.append(websocket.url))
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error"
            else None,
        )
        try:
            response = page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
            assert response is not None and response.status == 200
            page.wait_for_selector("#vela-action-quant-favorites", timeout=30_000)
            page.wait_for_timeout(2_000)
            selectors = assert_local_workspace(page)

            parsed_hosts = {
                (urlparse(request_url).hostname or "").lower().rstrip(".")
                for request_url in blocked
            }
            websocket_hosts = {
                (urlparse(request_url).hostname or "").lower().rstrip(".")
                for request_url in websocket_urls
            }
            external_hosts = (parsed_hosts | websocket_hosts) - LOCAL_HOSTS
            non_provider = sorted(external_hosts - PROVIDER_HOSTS)
            luxalgo = sorted(
                host
                for host in external_hosts
                if host == "luxalgo.com" or host.endswith(".luxalgo.com")
            )
            assert not non_provider, (
                "production preview attempted unexpected external hosts while offline: "
                f"{non_provider}; requests={blocked}"
            )
            assert not luxalgo, f"production preview attempted LuxAlgo hosts: {luxalgo}"
            assert not page_errors, f"production preview page errors: {page_errors}"
            return {
                "mode": "production-preview-offline",
                "status": response.status,
                "workspace": selectors,
                "blockedExternalRequests": len(blocked),
                "providerAttempts": len(
                    [
                        request_url
                        for request_url in blocked
                        if (urlparse(request_url).hostname or "").lower().rstrip(".")
                        in PROVIDER_HOSTS
                    ]
                )
                + len(
                    [
                        request_url
                        for request_url in websocket_urls
                        if (urlparse(request_url).hostname or "").lower().rstrip(".")
                        in PROVIDER_HOSTS
                    ]
                ),
                "blockedHosts": sorted(parsed_hosts),
                "websocketAttempts": websocket_urls,
                "unexpectedExternalHosts": non_provider,
                "luxalgoHosts": luxalgo,
                "pageErrors": page_errors,
                "consoleErrors": console_errors,
                "networkPolicy": (
                    "non-local HTTP(S) aborted and WebSockets recorded; "
                    "provider attempts are reported, not mocked"
                ),
            }
        finally:
            context.close()
            browser.close()


def main() -> int:
    assert_port_available()
    server = subprocess.Popen(
        [
            "npm",
            "run",
            "preview",
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
        start_new_session=True,
    )
    try:
        wait_for_server(server)
        print(json.dumps(run_smoke(), sort_keys=True))
        return 0
    finally:
        try:
            os.killpg(os.getpgid(server.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(server.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                server.kill()
            server.wait(timeout=5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - release gate reports full failure.
        print(f"Offline release smoke failed: {error}")
        raise
