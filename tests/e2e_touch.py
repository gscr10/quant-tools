#!/usr/bin/env python3
"""Touch-input regression for the responsive backtest workspace.

This is intentionally separate from ``e2e_cross_browser.py``.  A desktop
browser running at a narrow viewport is not evidence that pointer/touch input
works: this gate creates Playwright contexts with ``has_touch`` and drives
controls through the touchscreen API.  It is still a local emulation gate,
not a substitute for a physical iOS/Android device or VoiceOver.

The test is offline and uses the deterministic BTCUSDT fixture.  It verifies
the compact mobile entry, all Viewer tabs, Simulation settings, and the return
path for both phone and tablet breakpoints in every installed Playwright
engine.
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
from urllib.parse import urlparse
from urllib.request import urlopen

from playwright.sync_api import Browser, BrowserContext, Page, Route, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = int(os.environ.get("QUANT_TOUCH_PORT", "4184"))
FIXTURE_PATH = "/tests/fixtures/backtest-btcusdt.html"
FIXTURE_URL = f"http://{HOST}:{PORT}{FIXTURE_PATH}"
LOCAL_HOSTS = {HOST, "localhost", "::1"}
DEFAULT_BROWSERS = ("chromium", "firefox", "webkit")
VIEWPORTS = (("phone", 390, 844), ("tablet", 768, 900))


@dataclass
class TouchAudit:
    browser: str
    viewport: str
    blocked_external_requests: list[str]
    page_errors: list[str]
    summary: dict[str, object]


def choose_port() -> int:
    """Return the requested port, or a free fallback when the default is busy.

    Touch E2E is commonly run in parallel with another browser smoke.  A
    fixed default made a harmless TIME_WAIT/parallel listener look like a
    product failure.  Explicit ``QUANT_TOUCH_PORT`` remains strict so CI can
    reserve a deterministic port; the default picks an ephemeral fallback.
    """
    if os.environ.get("QUANT_TOUCH_PORT"):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind((HOST, PORT))
            except OSError as error:
                raise RuntimeError(
                    f"port {PORT} is already in use; set QUANT_TOUCH_PORT to an unused port"
                ) from error
        return PORT
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((HOST, PORT))
            return PORT
        except OSError:
            probe.bind((HOST, 0))
            return int(probe.getsockname()[1])


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
                    return
        except OSError:
            time.sleep(0.15)
    raise TimeoutError(f"Vite did not serve {FIXTURE_PATH} within {timeout:g}s")


def launch_options(browser_name: str) -> dict[str, object]:
    options: dict[str, object] = {"headless": True}
    executable = os.environ.get(f"{browser_name.upper()}_EXECUTABLE")
    if executable:
        options["executable_path"] = executable
    return options


def install_offline_guard(context: BrowserContext, blocked: list[str]) -> None:
    def handle(route: Route) -> None:
        parsed = urlparse(route.request.url)
        hostname = (parsed.hostname or "").lower().rstrip(".")
        if parsed.scheme in {"http", "https"} and hostname not in LOCAL_HOSTS:
            blocked.append(route.request.url)
            route.abort("blockedbyclient")
            return
        route.continue_()

    context.route("**/*", handle)


def observe_errors(page: Page, errors: list[str]) -> None:
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on(
        "console",
        lambda message: errors.append(f"console: {message.text}")
        if message.type == "error"
        else None,
    )


def assert_touch_page(page: Page, browser_name: str, viewport_name: str) -> dict[str, object]:
    errors: list[str] = []
    blocked: list[str] = []
    observe_errors(page, errors)
    install_offline_guard(page.context, blocked)
    response = page.goto(FIXTURE_URL, wait_until="domcontentloaded", timeout=30_000)
    assert response is not None and response.status == 200
    page.wait_for_function("window.__btcFixture?.ready === true", timeout=60_000)

    trigger = page.locator('.quant-backtest-mobile-trigger')
    trigger.wait_for(state="visible")
    assert trigger.get_attribute("aria-label") == "Backtest"
    trigger.tap()
    viewer = page.locator(".quant-backtest-viewer")
    viewer.wait_for(state="visible")

    expected_tabs = (
        ("Performance", ".quant-backtest-chart-frame"),
        ("Trades Analysis", ".quant-backtest-analysis"),
        ("Trades Log", ".quant-backtest-trade-table"),
        ("Simulation", ".quant-backtest-simulation"),
    )
    for label, selector in expected_tabs:
        tab = viewer.locator(".quant-backtest-tab", has_text=label)
        tab.tap()
        viewer.locator(selector).first.wait_for(state="visible")
        assert tab.get_attribute("aria-selected") == "true"

    simulation = viewer.locator(".quant-backtest-simulation")
    # Both desktop and compact toolbars stay mounted for responsive layout;
    # CSS hides one of them.  Select the actual visible touch target rather
    # than relying on DOM order.
    settings_button = simulation.locator(
        '[aria-label="Simulation settings"]:visible'
    ).first
    settings_button.tap()
    dialog = viewer.locator('[role="dialog"][aria-modal="true"]')
    dialog.wait_for(state="visible")
    assert dialog.locator("#quant-backtest-simulation-runs").is_visible()
    assert dialog.locator("#quant-backtest-simulation-variation").is_visible()

    # Backdrop and header close are both touch targets.  Exercise both paths;
    # checking the trigger's focus is deliberately omitted because touchscreen
    # focus semantics differ across OS/browser and need a physical-device gate.
    dialog.locator('[aria-label="Close simulation settings"]').tap()
    dialog.wait_for(state="hidden")
    settings_button.tap()
    dialog.wait_for(state="visible")
    viewer.locator('.quant-backtest-simulation-settings-close').tap()
    dialog.wait_for(state="hidden")

    viewer.locator('[aria-label="Return to chart"]').tap()
    viewer.wait_for(state="hidden")
    # Below the Dock breakpoint the Workbench intentionally keeps the Dock
    # hidden and exposes the compact chart-area entry instead.
    page.locator(".quant-backtest-mobile-trigger").wait_for(state="visible")
    page.wait_for_function(
        "(() => { const r = window.__btcFixture.chartResources(); "
        "return r.activeCharts === 1 && r.activeObservers === 1; })()",
        timeout=10_000,
    )
    resources = page.evaluate("window.__btcFixture.chartResources()")
    assert resources == {"activeCharts": 1, "activeObservers": 1}, resources

    assert not blocked, blocked
    assert not errors, errors
    return {
        "browser": browser_name,
        "viewport": viewport_name,
        "touch": True,
        "tabs": len(expected_tabs),
        "simulationSettings": True,
        "chartResources": resources,
        "blockedExternalRequests": len(blocked),
        "pageErrors": len(errors),
    }


def parse_browsers(value: str) -> tuple[str, ...]:
    names = tuple(item.strip().lower() for item in value.split(",") if item.strip())
    unknown = sorted(set(names) - set(DEFAULT_BROWSERS))
    if not names or unknown:
        raise argparse.ArgumentTypeError(
            "browsers must be a comma-separated subset of "
            f"{','.join(DEFAULT_BROWSERS)}; unknown: {unknown}"
        )
    return tuple(dict.fromkeys(names))


def run(browsers: tuple[str, ...]) -> list[TouchAudit]:
    global PORT, FIXTURE_URL
    PORT = choose_port()
    FIXTURE_URL = f"http://{HOST}:{PORT}{FIXTURE_PATH}"
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
        audits: list[TouchAudit] = []
        with sync_playwright() as playwright:
            for browser_name in browsers:
                factory = getattr(playwright, browser_name)
                browser: Browser | None = None
                try:
                    browser = factory.launch(**launch_options(browser_name))
                    for viewport_name, width, height in VIEWPORTS:
                        context = browser.new_context(
                            viewport={"width": width, "height": height},
                            has_touch=True,
                            # is_mobile is intentionally false: this keeps the
                            # test valid for Firefox while has_touch still
                            # exposes the real touchscreen API.
                            is_mobile=False,
                        )
                        try:
                            page = context.new_page()
                            result = assert_touch_page(page, browser_name, viewport_name)
                            audits.append(
                                TouchAudit(
                                    browser=browser_name,
                                    viewport=viewport_name,
                                    blocked_external_requests=[],
                                    page_errors=[],
                                    summary=result,
                                )
                            )
                        finally:
                            context.close()
                except Exception as error:  # noqa: BLE001 - add engine context.
                    raise RuntimeError(
                        f"{browser_name} touch regression failed: {error}"
                    ) from error
                finally:
                    if browser is not None:
                        browser.close()
        return audits
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
        "Touch backtest audit: "
        + json.dumps([audit.summary for audit in results], sort_keys=True)
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - command-line gate must fail loudly.
        print(f"Touch backtest regression failed: {error}", file=sys.stderr)
        raise
