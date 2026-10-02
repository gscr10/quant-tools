#!/usr/bin/env python3
"""Dev-only fault isolation for the real application composition root.

This deliberately uses the normal lifecycle fixture rather than a mocked
BacktestFeature: the fixture injects failures through createApp's public test
override after the real Workspace has mounted.  It verifies that repeated
optional-feature failures neither duplicate nor disable the legacy toolbar and
Pine editor, and that a later normal remount remains usable.

Run directly with ``python3 tests/backtest_app_lifecycle_fault.py``.  It starts
Vite's binary directly, avoiding ``npm run build`` and any production dist
rewrite.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

from playwright.sync_api import BrowserContext, Page, Route, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = 4193
LIFECYCLE_URL = f"http://{HOST}:{PORT}/tests/fixtures/lifecycle.html"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
CORE_SELECTORS = (
    "#vela-action-quant-favorites",
    "#vela-action-quant-templates",
    "#vela-action-screenshot",
    "#vela-tool-vela-widget-panel-quant-pine-editor",
)
WORKSPACE_STORAGE_KEY = "quant-tools:workspace:v2"


def wait_for_server(process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(f"Vite exited early ({process.returncode})\n{output}")
        try:
            with urlopen(LIFECYCLE_URL, timeout=0.5) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError("timed out waiting for the dev lifecycle fixture")


def deterministic_klines(url: str) -> list[list[object]]:
    query = parse_qs(urlparse(url).query)
    count = min(int(query.get("limit", ["500"])[0]), 500)
    interval = query.get("interval", ["15m"])[0]
    minutes = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60}.get(interval, 15)
    step = minutes * 60_000
    end = int(query.get("endTime", ["1760000000000"])[0])
    end -= end % step
    return [
        [
            opened := end - (count - index) * step,
            "60000",
            "60025",
            "59980",
            "60005",
            "100",
            opened + step - 1,
        ]
        for index in range(count)
    ]


def install_market_routes(context: BrowserContext, blocked: list[str]) -> None:
    symbol = {
        "symbol": "BTCUSDT",
        "baseAsset": "BTC",
        "quoteAsset": "USDT",
        "status": "TRADING",
        "contractType": "PERPETUAL",
        "filters": [{"filterType": "PRICE_FILTER", "tickSize": "0.10"}],
    }

    def binance(route: Route) -> None:
        path = urlparse(route.request.url).path
        payload: object
        if path.endswith("/exchangeInfo"):
            payload = {"symbols": [symbol]}
        elif path.endswith("/klines"):
            payload = deterministic_klines(route.request.url)
        else:
            payload = {}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))

    def hyperliquid(route: Route) -> None:
        request_type = (route.request.post_data_json or {}).get("type")
        if request_type == "meta":
            payload: object = {"universe": [{"name": "BTC", "szDecimals": 5}]}
        elif request_type == "spotMeta":
            payload = {"tokens": [], "universe": []}
        else:
            payload = []
        route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))

    def offline_guard(route: Route) -> None:
        parsed = urlparse(route.request.url)
        if parsed.scheme in {"http", "https"} and (parsed.hostname or "").lower() not in LOCAL_HOSTS:
            blocked.append(route.request.url)
            route.abort("blockedbyclient")
            return
        route.continue_()

    # Route handlers are evaluated in reverse-install order, so the provider
    # fixtures intentionally follow the broad offline guard.
    context.route("**/*", offline_guard)
    for pattern in (
        "https://api.binance.com/**",
        "https://api.binance.us/**",
        "https://fapi.binance.com/**",
    ):
        context.route(pattern, binance)
    context.route("https://api.hyperliquid.xyz/**", hyperliquid)


def assert_legacy_surface_works(page: Page) -> None:
    for selector in CORE_SELECTORS:
        assert page.locator(selector).count() == 1, selector

    # Use real click paths, not merely DOM presence.  These controls belong to
    # pre-existing features and must survive a Backtest construction rollback.
    page.locator("#vela-action-quant-favorites").click()
    page.locator(".favorite-indicators-popover").wait_for(state="visible")
    # The production popover is pointer-toggle driven; keep the interaction
    # assertion on that public control instead of assuming it consumes Escape.
    page.locator("#vela-action-quant-favorites").click()
    page.locator(".favorite-indicators-popover").wait_for(state="hidden")

    editor = page.locator("#vela-tool-vela-widget-panel-quant-pine-editor")
    # The normal Workspace persists the active panel across a remount. Do not
    # toggle a legitimately restored editor closed; activate it only when the
    # failure path left it inactive.
    if editor.get_attribute("data-active") != "1":
        editor.click()
        page.wait_for_function(
            "document.querySelector('#vela-tool-vela-widget-panel-quant-pine-editor')?.getAttribute('data-active') === '1'"
        )
    assert editor.get_attribute("data-active") == "1"
    page.locator(".quant-pine-body").wait_for(state="visible")
    assert page.locator(".cm-content").count() == 1


def mount_and_assert_failure(page: Page, option: str) -> None:
    page.evaluate(f"window.destroyQuantApp(); window.mountQuantApp({{{option}: true}})")
    page.wait_for_selector("#vela-action-quant-favorites")
    assert_legacy_surface_works(page)
    assert page.locator("#backtest-workbench").count() == 0
    assert page.locator(".quant-backtest-workbench").count() == 0
    if option == "failBacktestResize":
        stats = page.evaluate("window.__backtestResizeStats")
        assert stats == {"created": 1, "disconnected": 1}, stats


def run() -> None:
    server = subprocess.Popen(
        [
            str(ROOT / "node_modules/.bin/vite"),
            "--host", HOST,
            "--port", str(PORT),
            "--strictPort",
        ],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        wait_for_server(server)
        with sync_playwright() as playwright:
            executable = os.environ.get("CHROMIUM_EXECUTABLE")
            browser = playwright.chromium.launch(executable_path=executable or None)
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            blocked: list[str] = []
            errors: list[str] = []
            install_market_routes(context, blocked)
            context.add_init_script("localStorage.clear(); sessionStorage.clear();")
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(LIFECYCLE_URL, wait_until="domcontentloaded", timeout=30_000)
            page.wait_for_selector("#vela-action-quant-favorites")
            assert_legacy_surface_works(page)

            # A real browser refresh does not call the test harness's explicit
            # destroy helper. Verify the normal live application tears down
            # with the document, restores only one Workspace/Backtest shell,
            # and does not rewrite the pre-existing Workspace payload while it
            # comes back. This covers the refresh half of the G9 lifecycle
            # contract separately from the explicit create/destroy checks.
            # Workspace persistence is debounced; capture only after the
            # initial mount has settled so a refresh cannot race the write.
            page.wait_for_timeout(600)
            before_refresh = page.evaluate(
                f"localStorage.getItem({WORKSPACE_STORAGE_KEY!r})"
            )
            page.reload(wait_until="domcontentloaded", timeout=30_000)
            page.wait_for_selector("#vela-action-quant-favorites")
            page.wait_for_timeout(600)
            assert_legacy_surface_works(page)
            assert page.locator("#backtest-workbench").count() == 1
            assert page.locator(".quant-backtest-workbench").count() == 1
            after_refresh = page.evaluate(
                f"localStorage.getItem({WORKSPACE_STORAGE_KEY!r})"
            )
            canonical_storage = """
              (raw) => {
                const volatile = new Set(['savedAt', 'revision', 'snapshotRevision',
                  'runtimeRevision', 'runId', 'generatedAt', 'updatedAt', 'lastUpdated', 'persistedAt', 'panels']);
                const walk = (value, depth) => {
                  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1));
                  if (value && typeof value === 'object') {
                    const result = {};
                    for (const key of Object.keys(value).sort()) {
                      if (depth === 0 && volatile.has(key)) continue;
                      result[key] = walk(value[key], depth + 1);
                    }
                    return result;
                  }
                  return value;
                };
                try { return JSON.stringify(walk(JSON.parse(raw || 'null'), 0)); }
                catch { return raw; }
              }
            """
            before_canonical = page.evaluate(canonical_storage, before_refresh)
            after_canonical = page.evaluate(canonical_storage, after_refresh)
            assert before_canonical == after_canonical

            # Repeat both transactional failure points. Existing lifecycle
            # coverage proves one pass; this catches leaked singleton handlers
            # that only surface on the next remount.
            for _ in range(2):
                mount_and_assert_failure(page, "failBacktest")
                mount_and_assert_failure(page, "failBacktestResize")

            # A successful optional feature mount after four failed attempts
            # must recreate exactly one host and leave the legacy actions live.
            page.evaluate("window.destroyQuantApp(); window.mountQuantApp()")
            page.wait_for_selector("#vela-action-quant-favorites")
            assert_legacy_surface_works(page)
            assert page.locator("#backtest-workbench").count() == 1
            assert page.locator(".quant-backtest-workbench").count() == 1

            # Destroy twice to prove the composition root remains idempotent
            # after fault recovery, then assert no pre-existing UI survives.
            page.evaluate("window.destroyQuantApp(); window.destroyQuantApp()")
            assert page.locator("#vela-action-quant-favorites").count() == 0
            assert page.locator("#backtest-workbench").count() == 0
            assert page.locator(".favorite-indicators-popover").count() == 0
            assert page.evaluate("window.__quantLifecycleStats") == {
                "mounts": 6,
                "destroys": 6,
                "noopDestroys": 1,
            }
            assert not blocked, f"unexpected external requests: {blocked}"
            assert not errors, errors
            context.close()
            browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)


if __name__ == "__main__":
    try:
        run()
        print("Backtest app lifecycle fault test passed")
    except Exception as error:  # noqa: BLE001 - a standalone test should expose failures.
        print(f"Backtest app lifecycle fault test failed: {error}", file=sys.stderr)
        raise
