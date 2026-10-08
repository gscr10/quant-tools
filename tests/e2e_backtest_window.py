#!/usr/bin/env python3
"""Backtest calculation-window control browser contract.

The test mounts the real ``BacktestWorkbench`` fixture and checks the
calculation-window control independently of Vela or a provider.  It covers
the desktop sizes used by the workbench; phone layouts are intentionally out
of scope for this phase.

Run ``python3 tests/e2e_backtest_window.py`` or select a browser with
``--browsers chromium,firefox``.  Set ``QUANT_WINDOW_BASE_URL`` to reuse an
already-running Vite server.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import os
from pathlib import Path
import subprocess
import time
from urllib.request import urlopen

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = 4196
BASE = os.environ.get(
    "QUANT_WINDOW_BASE_URL",
    f"http://{HOST}:{PORT}",
)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--browsers",
    default=os.environ.get("QUANT_WINDOW_BROWSERS", "chromium,firefox"),
    help="comma-separated Playwright browser names",
)
args = parser.parse_args()
BROWSERS = [name.strip() for name in args.browsers.split(",") if name.strip()]

# The mobile breakpoint is deliberately excluded.  The calculation-window
# menu is a Dock control and the mobile report entry has a separate contract.
VIEWPORTS = ((1024, 768), (1280, 720), (1440, 900), (1024, 400), (1280, 400))


@contextmanager
def dev_server():
    if os.environ.get("QUANT_WINDOW_BASE_URL"):
        yield
        return
    process = subprocess.Popen(
        [
            str(ROOT / "node_modules/.bin/vite"),
            "--config",
            "tests/vite-performance.config.ts",
            "--host",
            HOST,
            "--port",
            str(PORT),
            "--strictPort",
        ],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.monotonic() + 45
        while True:
            if process.poll() is not None:
                raise RuntimeError("Backtest-window Vite exited before startup")
            try:
                with urlopen(BASE, timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                pass
            if time.monotonic() >= deadline:
                raise TimeoutError("Backtest-window Vite startup timed out")
            time.sleep(0.1)
        yield
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def assert_window_contract(page, width: int, height: int) -> None:
    page.goto(f"{BASE}/tests/fixtures/backtest-workbench.html")
    page.wait_for_selector(".quant-backtest-window-button")
    button = page.locator(".quant-backtest-window-button")
    menu = page.locator(".quant-backtest-window-menu")

    assert button.get_attribute("aria-haspopup") == "menu"
    assert button.get_attribute("aria-expanded") == "false"
    button.click()
    assert button.get_attribute("aria-expanded") == "true"
    assert menu.get_attribute("role") == "menu"

    options = menu.locator('[role="menuitemradio"]')
    assert options.count() == 5
    assert options.nth(0).get_attribute("aria-checked") == "true"
    assert options.nth(0).inner_text().strip() == "Default · 2,000 bars"

    # The menu belongs to the Dock header.  It must remain reachable at the
    # compact heights used while a chart is visible, without expanding the
    # document or losing the Apply control below the viewport.
    rect = menu.bounding_box()
    assert rect is not None
    assert rect["x"] >= 0 and rect["y"] >= 0
    assert rect["x"] + rect["width"] <= width + 1, (width, height, rect)
    assert rect["y"] + rect["height"] <= height + 1, (width, height, rect)
    assert page.evaluate(
        "({html: document.documentElement.scrollHeight, body: document.body.scrollHeight})"
    ) == {"html": height, "body": height}, (width, height)

    # APG menu-button behavior: open on the selected item, move through the
    # radio options with arrows/Home/End, and submit with Enter.  A hidden
    # menu item must never retain focus after a selection.
    assert page.evaluate(
        "document.activeElement?.getAttribute('data-window-preset')"
    ) == "default"
    page.keyboard.press("ArrowDown")
    assert page.evaluate(
        "document.activeElement?.getAttribute('data-window-preset')"
    ) == "1M"
    page.keyboard.press("End")
    assert page.evaluate(
        "document.activeElement?.getAttribute('data-window-preset')"
    ) == "1Y"
    page.keyboard.press("Home")
    assert page.evaluate(
        "document.activeElement?.getAttribute('data-window-preset')"
    ) == "default"
    page.keyboard.press("ArrowUp")
    assert page.evaluate(
        "document.activeElement?.getAttribute('data-window-preset')"
    ) == "1Y"
    page.keyboard.press("Enter")
    assert menu.is_hidden()
    assert page.evaluate(
        "document.activeElement?.classList.contains('quant-backtest-window-button')"
    )

    # Removing an active strategy also closes its transient menu. Restoring a
    # strategy must not resurrect a half-finished selection or stale expanded
    # state from the previous report.
    button.click()
    page.evaluate("window.__g3aFixture.removeReport()")
    assert button.get_attribute("aria-expanded") == "false"
    page.evaluate("window.__g3aFixture.restoreReport()")
    assert menu.is_hidden()
    assert button.get_attribute("aria-expanded") == "false"

    # Escape and an outside pointer close the menu and leave no stale expanded
    # state.  Focus after the outside pointer belongs to the pointer target;
    # Escape must always return to the trigger.
    button.click()
    page.keyboard.press("Escape")
    assert menu.is_hidden()
    assert button.get_attribute("aria-expanded") == "false"
    assert button.evaluate("node => document.activeElement === node")

    button.click()
    page.mouse.click(width - 8, 8)
    assert menu.is_hidden()
    assert button.get_attribute("aria-expanded") == "false"

    # Invalid custom dates keep the menu open and expose an accessible error;
    # valid dates close it and return focus to the trigger just like presets.
    button.click()
    custom_inputs = menu.locator('.quant-backtest-window-custom input[type="date"]')
    assert custom_inputs.count() == 2
    custom_inputs.nth(0).fill("2026-02-01")
    custom_inputs.nth(1).fill("2026-01-01")
    custom_inputs.nth(0).focus()
    # Date inputs use arrow keys to edit their native day/month/year segment.
    # The menu's radio navigation must not steal those keys from the form.
    page.keyboard.press("ArrowUp")
    assert custom_inputs.nth(0).evaluate("node => document.activeElement === node")
    custom_inputs.nth(0).fill("2026-02-01")
    menu.locator(".quant-backtest-window-apply").click()
    assert menu.get_attribute("data-error") == "true"
    assert menu.locator('[role="alert"]').count() == 1
    assert menu.locator('[aria-describedby]').count() >= 1

    custom_inputs.nth(0).fill("2026-01-01")
    custom_inputs.nth(1).fill("2026-02-01")
    menu.locator(".quant-backtest-window-apply").click()
    assert menu.is_hidden()
    assert page.evaluate(
        "document.activeElement?.classList.contains('quant-backtest-window-button')"
    )


with dev_server(), sync_playwright() as playwright:
    for browser_name in BROWSERS:
        browser_type = getattr(playwright, browser_name)
        browser = browser_type.launch()
        try:
            for width, height in VIEWPORTS:
                page = browser.new_page(viewport={"width": width, "height": height})
                errors: list[str] = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                try:
                    assert_window_contract(page, width, height)
                    assert not errors, (browser_name, width, height, errors)
                finally:
                    page.close()
        finally:
            browser.close()
        print(f"{browser_name}: {len(VIEWPORTS)}/{len(VIEWPORTS)} window cases passed")
