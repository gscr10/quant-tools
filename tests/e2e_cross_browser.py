#!/usr/bin/env python3
"""Cross-browser smoke for the self-contained BTCUSDT backtest fixture.

The full application regression intentionally runs in Chromium (it covers the
large workspace surface and the existing lifecycle suite).  This smaller gate
loads the deterministic backtest fixture in all Playwright engines so that
Firefox and WebKit also exercise the real Vela-PineTS bridge and Backtest
Viewer without the noise of the application's provider mocks.

The runner starts Vite with ``tests/vite-performance.config.ts``.  The config
disables update handling, strips the document-level client tag, and replaces
the fixture stylesheet's dev wrapper with a plain local style element.  The
gate remains offline: any non-local HTTP request or WebSocket is
aborted/reported as a failure, and a reintroduced Vite client fails the gate.

Run ``npm run test:e2e:cross-browser``.  Browsers can be selected for a quick
local check with ``--browsers firefox,webkit``.  The Playwright browser
install is a prerequisite (``python3 -m playwright install``).
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from urllib.request import urlopen
from urllib.parse import urlparse

from playwright.sync_api import Browser, BrowserContext, Page, Route, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = int(os.environ.get("QUANT_CROSS_BROWSER_PORT", "4183"))
FIXTURE_PATH = "/tests/fixtures/backtest-btcusdt.html"
FIXTURE_URL = f"http://{HOST}:{PORT}{FIXTURE_PATH}"
LOCAL_HOSTS = {HOST, "localhost", "::1"}
DEFAULT_BROWSERS = ("chromium", "firefox", "webkit")


@dataclass
class BrowserAudit:
    browser: str
    metadata: dict[str, object]
    summary: dict[str, object]
    blocked_external_requests: list[str]
    bad_responses: list[str]
    page_errors: list[str]
    hmr_requests: list[str]
    websocket_urls: list[str]
    chart_resources_before_destroy: dict[str, object]
    chart_resources_after_destroy: dict[str, object]


def assert_port_available() -> None:
    """Fail clearly instead of accidentally reusing a stale Vite server."""

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((HOST, PORT))
        except OSError as error:
            raise RuntimeError(
                f"port {PORT} is already in use; stop the old test server or set "
                "QUANT_CROSS_BROWSER_PORT to an unused port"
            ) from error


def wait_for_server(process: subprocess.Popen[str]) -> None:
    timeout = float(os.environ.get("QUANT_E2E_STARTUP_TIMEOUT", "90"))
    deadline = time.monotonic() + max(5.0, timeout)
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(
                f"Vite exited before becoming ready ({process.returncode})\n{output}"
            )
        try:
            with urlopen(FIXTURE_URL, timeout=0.75) as response:
                if response.status == 200:
                    if process.poll() is not None:
                        output = process.stdout.read() if process.stdout else ""
                        raise RuntimeError(
                            f"Vite exited while its port was being probed "
                            f"({process.returncode})\n{output}"
                        )
                    return
        except OSError:
            time.sleep(0.15)
    raise TimeoutError(f"Vite did not serve {FIXTURE_PATH} within {timeout:g}s")


def install_offline_guard(
    context: BrowserContext,
    blocked: list[str],
) -> None:
    """Abort and record every non-local HTTP(S) request."""

    def handle(route: Route) -> None:
        parsed = urlparse(route.request.url)
        hostname = (parsed.hostname or "").lower().rstrip(".")
        if parsed.scheme in {"http", "https"} and hostname not in LOCAL_HOSTS:
            blocked.append(route.request.url)
            route.abort("blockedbyclient")
            return
        route.continue_()

    context.route("**/*", handle)


def launch_options(browser_name: str) -> dict[str, object]:
    options: dict[str, object] = {"headless": True}
    env_name = f"{browser_name.upper()}_EXECUTABLE"
    executable = os.environ.get(env_name)
    if executable:
        options["executable_path"] = executable
    return options


def observe_page(page: Page, audit: dict[str, list[str]]) -> None:
    page.on(
        "pageerror",
        lambda error: audit["page_errors"].append(str(error)),
    )
    page.on(
        "console",
        lambda message: audit["page_errors"].append(
            f"console: {message.text}"
        )
        if message.type == "error"
        else None,
    )
    page.on(
        "response",
        lambda response: audit["bad_responses"].append(
            f"{response.status} {response.url}"
        )
        if response.status >= 400
        else None,
    )
    page.on(
        "request",
        lambda request: audit["hmr_requests"].append(request.url)
        if "/@vite/client" in request.url
        else None,
    )
    page.on(
        "websocket",
        lambda websocket: audit["websocket_urls"].append(websocket.url),
    )


def assert_fixture_page(
    page: Page,
    browser_name: str,
    blocked_external_requests: list[str],
) -> BrowserAudit:
    audit = {
        "bad_responses": [],
        "page_errors": [],
        "hmr_requests": [],
        "websocket_urls": [],
    }
    observe_page(page, audit)

    response = page.goto(FIXTURE_URL, wait_until="domcontentloaded", timeout=30_000)
    assert response is not None and response.status == 200
    page.wait_for_function(
        "window.__btcFixture?.ready === true",
        timeout=60_000,
    )

    metadata = page.evaluate("window.__btcFixture.metadata")
    assert metadata == {
        "provider": "binance",
        "symbol": "BTCUSDT",
        "timeframe": "1h",
        "timezone": "UTC",
        "bars": 24,
        "fixtureSha256": "29b1d15777827e46b47a7386aa368f0389252b16565f58b3b19805c363e39cd1",
        "strategySha256": "e3e6260620a19b4c5941a039a358ea398462cdf5fbbe861847e0eeadc69f98bc",
        "reportSeriesPoints": 24,
    }, metadata

    state = page.evaluate("window.__btcFixture.state()")
    report = state["report"]
    assert report["status"] == "ready", report
    assert report["provider"] == "binance", report
    assert report["symbol"] == "BTCUSDT", report
    # The controller's report DTO intentionally carries timeframe through the
    # market context only in the full app; this fixture's authoritative
    # timeframe assertion is the immutable metadata above.
    assert report["summary"]["trades"] == 3, report["summary"]
    assert report["summary"]["netProfit"] == -1.6809529999998745, report["summary"]
    assert len(report["trades"]) == 3, report
    assert {trade["direction"] for trade in report["trades"]} == {"long", "short"}

    dock = page.locator(".quant-backtest-dock")
    dock.wait_for(state="visible")
    assert dock.locator(".quant-backtest-dock-title").inner_text() == (
        "BTCUSDT 1h deterministic"
    )
    # The Dock owns its summary chart while the Viewer is closed.  Capture
    # that live baseline before opening the Viewer; closing the Viewer should
    # restore this baseline, while destroying the whole fixture must release
    # everything back to zero. Highcharts is a local lazy chunk, and WebKit
    # can expose the ready report/Dock one task before that upgrade commits.
    # Wait for the owned resources instead of turning module scheduling into
    # a cross-browser flake; the assertion still fails if the chart never
    # mounts, and the teardown checks below still require a return to zero.
    page.wait_for_function(
        "(() => { const resources = window.__btcFixture.chartResources(); "
        "return resources.activeCharts === 1 && resources.activeObservers === 1; })()",
        timeout=10_000,
    )
    dock_resources = page.evaluate("window.__btcFixture.chartResources()")
    assert dock_resources == {"activeCharts": 1, "activeObservers": 1}, dock_resources
    dock.locator('[aria-label="Open backtest viewer"]').click()
    viewer = page.locator(".quant-backtest-viewer")
    viewer.wait_for(state="visible")
    assert viewer.locator(".quant-backtest-tab").all_text_contents() == [
        "Performance",
        "Trades Analysis",
        "Trades Log",
        "Simulation",
    ]

    # Each tab must be mountable in every browser. The tab-specific assertions
    # stay intentionally small; the Chromium regression owns the detailed UI
    # contracts and this gate focuses on cross-engine lifecycle compatibility.
    for tab_name, expected_selector in (
        ("Performance", ".quant-backtest-chart-frame"),
        ("Trades Analysis", ".quant-backtest-analysis"),
        ("Trades Log", ".quant-backtest-trade-table"),
        ("Simulation", ".quant-backtest-simulation"),
    ):
        viewer.locator(".quant-backtest-tab", has_text=tab_name).click()
        viewer.locator(expected_selector).first.wait_for(state="visible")

    # The point bridge must work in every supported browser after the real
    # Highcharts chunk upgrades the Analysis charts. This is a keyboard-only
    # check; pointer hover remains covered by the Chromium fixture regression.
    viewer.locator(".quant-backtest-tab", has_text="Trades Analysis").click()
    page.wait_for_function(
        """() => document.querySelectorAll(
          '.quant-backtest-analysis-chart-host [data-quant-report-point]',
        ).length > 0"""
    )
    points = viewer.locator(".quant-backtest-analysis [data-quant-report-point]")
    assert points.count() > 0
    points.first.focus()
    assert page.evaluate(
        "document.activeElement?.getAttribute('data-quant-report-point')"
    ) == "0"
    page.wait_for_function(
        """() => [...document.querySelectorAll('.highcharts-tooltip')]
          .some(node => getComputedStyle(node).visibility !== 'hidden'
            && node.textContent?.trim())"""
    )
    points.first.press("ArrowRight")
    assert page.evaluate(
        "document.activeElement?.getAttribute('data-quant-report-point')"
    ) == "1"

    # Closing the Viewer must release Highcharts/ResizeObserver resources. A
    # short wait is enough for the component's synchronous destroy path while
    # still allowing a browser with slower layout scheduling to settle.
    viewer.locator('[aria-label="Return to chart"]').click()
    dock.wait_for(state="visible")
    page.wait_for_function(
        "(() => { const resources = window.__btcFixture.chartResources(); "
        "return resources.activeCharts === 1 && resources.activeObservers === 1; })()",
        timeout=10_000,
    )
    resources_before_destroy = page.evaluate("window.__btcFixture.chartResources()")

    page.evaluate("window.__btcFixture.destroy()")
    page.wait_for_function(
        "document.querySelector('#fixture-host')?.childElementCount === 0",
        timeout=10_000,
    )
    resources_after_destroy = page.evaluate("window.__btcFixture.chartResources()")

    # The offline route is installed on the context, so its list is passed in
    # separately from page-level console/response events.
    assert not blocked_external_requests, {
        "blockedExternalRequests": blocked_external_requests,
    }
    assert not audit["bad_responses"], audit
    assert not audit["page_errors"], audit
    assert not audit["hmr_requests"], audit
    assert not audit["websocket_urls"], audit
    assert resources_before_destroy == dock_resources
    assert resources_after_destroy == {"activeCharts": 0, "activeObservers": 0}

    return BrowserAudit(
        browser=browser_name,
        metadata=metadata,
        summary=report["summary"],
        blocked_external_requests=list(blocked_external_requests),
        bad_responses=audit["bad_responses"],
        page_errors=audit["page_errors"],
        hmr_requests=audit["hmr_requests"],
        websocket_urls=audit["websocket_urls"],
        chart_resources_before_destroy=resources_before_destroy,
        chart_resources_after_destroy=resources_after_destroy,
    )


def parse_browsers(value: str) -> tuple[str, ...]:
    names = tuple(item.strip().lower() for item in value.split(",") if item.strip())
    unknown = sorted(set(names) - set(DEFAULT_BROWSERS))
    if not names or unknown:
        choices = ", ".join(DEFAULT_BROWSERS)
        raise argparse.ArgumentTypeError(
            f"browsers must be a comma-separated subset of {choices}; unknown: {unknown}"
        )
    # Preserve user order but avoid launching an engine twice.
    return tuple(dict.fromkeys(names))


def run(browsers: tuple[str, ...]) -> list[BrowserAudit]:
    assert_port_available()
    vite = ROOT / "node_modules/.bin/vite"
    command = [
        str(vite) if vite.exists() else "npx",
        *([] if vite.exists() else ["vite"]),
        "--config",
        str(ROOT / "tests/vite-performance.config.ts"),
        "--host",
        HOST,
        "--port",
        str(PORT),
        "--strictPort",
    ]
    server = subprocess.Popen(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )
    try:
        wait_for_server(server)
        results: list[BrowserAudit] = []
        with sync_playwright() as playwright:
            for browser_name in browsers:
                browser_factory = getattr(playwright, browser_name)
                browser: Browser | None = None
                context: BrowserContext | None = None
                blocked: list[str] = []
                try:
                    browser = browser_factory.launch(**launch_options(browser_name))
                    context = browser.new_context(
                        viewport={"width": 1440, "height": 900},
                    )
                    install_offline_guard(context, blocked)
                    page = context.new_page()
                    result = assert_fixture_page(page, browser_name, blocked)
                    results.append(result)
                except Exception as error:  # noqa: BLE001 - add engine context.
                    raise RuntimeError(f"{browser_name} fixture smoke failed: {error}") from error
                finally:
                    if context is not None:
                        context.close()
                    if browser is not None:
                        browser.close()
        return results
    finally:
        # Keep an interrupted test from orphaning Vite and poisoning the next
        # run with a stale port/configuration.
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--browsers",
        type=parse_browsers,
        default=DEFAULT_BROWSERS,
        help="comma-separated browser engines (default: chromium,firefox,webkit)",
    )
    args = parser.parse_args()
    results = run(args.browsers)
    print(
        "Cross-browser backtest fixture audit: "
        + json.dumps(
            [
                {
                    "browser": result.browser,
                    "provider": result.metadata["provider"],
                    "symbol": result.metadata["symbol"],
                    "timeframe": result.metadata["timeframe"],
                    "trades": result.summary["trades"],
                    "netProfit": result.summary["netProfit"],
                    "blockedExternalRequests": len(result.blocked_external_requests),
                    "badResponses": len(result.bad_responses),
                    "pageErrors": len(result.page_errors),
                    "hmrRequests": len(result.hmr_requests),
                    "websockets": len(result.websocket_urls),
                    "chartResources": result.chart_resources_after_destroy,
                }
                for result in results
            ],
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - command-line gate must fail loudly.
        print(f"Cross-browser backtest fixture failed: {error}", file=sys.stderr)
        raise
