#!/usr/bin/env python3
"""Browser regression for the application architecture boundary.

Requires Python Playwright. The runner starts and stops Vite dev by default;
pass ``--preview`` after building to exercise production assets. Set
CHROMIUM_EXECUTABLE when Chromium is not installed in a standard macOS path.
"""

from __future__ import annotations

import base64
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
PORT = 4178
BASE_URL = f"http://{HOST}:{PORT}/?chart=maximized"
LIFECYCLE_URL = f"http://{HOST}:{PORT}/tests/fixtures/lifecycle.html"
SERVER_SCRIPT = "preview" if "--preview" in sys.argv[1:] else "dev"
MOCK_WEBSOCKET_SCRIPT = """
class QuantMockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) {
    this.url = String(url);
    this.readyState = QuantMockWebSocket.OPEN;
    queueMicrotask(() => this.onopen?.(new Event('open')));
  }
  send() {}
  close() {
    this.readyState = QuantMockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }
  addEventListener(type, listener) { this[`on${type}`] = listener; }
  removeEventListener(type, listener) {
    if (this[`on${type}`] === listener) this[`on${type}`] = null;
  }
}
window.WebSocket = QuantMockWebSocket;
"""


def mock_klines(url: str) -> list[list[object]]:
    query = parse_qs(urlparse(url).query)
    count = min(int(query.get("limit", ["500"])[0]), 500)
    interval = query.get("interval", ["15m"])[0]
    minutes = {
        "1m": 1,
        "3m": 3,
        "5m": 5,
        "15m": 15,
        "30m": 30,
        "1h": 60,
        "2h": 120,
        "4h": 240,
        "1d": 1440,
        "1w": 10080,
        "1M": 43200,
    }.get(interval, 15)
    step = minutes * 60_000
    end = int(query.get("endTime", ["1735689600000"])[0])
    first = end - count * step
    bars: list[list[object]] = []
    for index in range(count):
        opened = first + index * step
        price = 60_000 + index * 2
        bars.append([
            opened,
            str(price),
            str(price + 25),
            str(price - 20),
            str(price + 5),
            "100",
            opened + step - 1,
        ])
    return bars


def install_mock_market_data(context: BrowserContext, requests: list[str]) -> None:
    symbol = {
        "symbol": "BTCUSDT",
        "baseAsset": "BTC",
        "quoteAsset": "USDT",
        "status": "TRADING",
        "contractType": "PERPETUAL",
        "filters": [{"filterType": "PRICE_FILTER", "tickSize": "0.10"}],
    }

    def handle_binance(route: Route) -> None:
        url = route.request.url
        requests.append(url)
        path = urlparse(url).path
        if path.endswith("/ping"):
            payload: object = {}
        elif path.endswith("/exchangeInfo"):
            payload = {"symbols": [symbol]}
        elif path.endswith("/klines"):
            payload = mock_klines(url)
        else:
            payload = {}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))

    def handle_hyperliquid(route: Route) -> None:
        requests.append(route.request.url)
        body = route.request.post_data_json or {}
        request_type = body.get("type")
        if request_type == "meta":
            payload: object = {"universe": [{"name": "BTC", "szDecimals": 5}]}
        elif request_type == "spotMeta":
            payload = {"tokens": [], "universe": []}
        elif request_type == "candleSnapshot":
            payload = []
        else:
            payload = {}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))

    for pattern in (
        "https://api.binance.com/**",
        "https://api.binance.us/**",
        "https://fapi.binance.com/**",
    ):
        context.route(pattern, handle_binance)
    context.route("https://api.hyperliquid.xyz/**", handle_hyperliquid)
    transparent_png = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
        "AAAADUlEQVR42mNk+M/wHwAF/gL+Xw4AAAAASUVORK5CYII="
    )
    context.route(
        "https://crypto-icons.ledger.com/**",
        lambda route: route.fulfill(
            status=200,
            content_type="image/png",
            body=transparent_png,
        ),
    )
    context.route(
        "**/favicon.ico",
        lambda route: route.fulfill(
            status=200,
            content_type="image/png",
            body=transparent_png,
        ),
    )


def wait_for_server(process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(
                f"Vite exited before becoming ready ({process.returncode})\n{output}"
            )
        try:
            with urlopen(BASE_URL, timeout=0.5) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError("Timed out waiting for the Vite test server")


def visible_button(page: Page, text: str):
    return page.locator("button:visible", has_text=text).first


def observe_page_errors(page: Page, errors: list[str], prefix: str = "") -> None:
    page.on("pageerror", lambda error: errors.append(f"{prefix}page: {error}"))
    page.on(
        "console",
        lambda message: errors.append(
            f"{prefix}console: "
            f"{message.text}"
            f" ({message.location.get('url', '')}:{message.location.get('lineNumber', '')})"
        )
        if message.type == "error"
        else None,
    )
    page.on(
        "response",
        lambda response: errors.append(
            f"{prefix}response: {response.status} {response.url}"
        )
        if response.status >= 400
        else None,
    )


def verify_core_toolbar(page: Page) -> None:
    symbol = page.locator(".vela-widget-symbol")
    symbol.click()
    page.locator(".vela-sp-input").fill("BTCUSDT.P")
    symbol_row = page.locator(".vela-sp-row", has_text="BTCUSDT.P").first
    symbol_row.wait_for(state="visible")
    symbol_row.click()
    assert symbol.inner_text() == "BTCUSDT.P"

    timeframe = page.locator("#vela-topbar-tf")
    timeframe.click()
    page.locator('.vela-menu:visible .vela-menu-item[data-vei-id="30"]').click()
    assert "30m" in (timeframe.get_attribute("aria-label") or "")

    style = page.locator("#vela-topbar-style")
    style.click()
    page.locator('.vela-menu:visible .vela-menu-item[data-vei-id="line"]').click()
    assert "Line" in (style.get_attribute("aria-label") or "")
    style.click()
    page.locator('.vela-menu:visible .vela-menu-item[data-vei-id="candles"]').click()
    assert "Candles" in (style.get_attribute("aria-label") or "")


def create_script_and_template(page: Page) -> None:
    page.locator(".vela-cell").first.click(position={"x": 120, "y": 120})
    data_window = page.locator("#vela-tool-vela-widget-panel-dataWindow")
    object_tree = page.locator("#vela-tool-vela-widget-panel-objects")
    pine_editor = page.locator("#vela-tool-vela-widget-panel-quant-pine-editor")
    data_window.click()
    assert data_window.get_attribute("data-active") == "1"
    object_tree.click()
    assert object_tree.get_attribute("data-active") == "1"
    assert data_window.get_attribute("data-active") != "1"

    pine_editor.click()
    assert pine_editor.get_attribute("data-active") == "1"
    assert object_tree.get_attribute("data-active") != "1"
    page.locator(".quant-pine-body").wait_for(state="visible")
    page.locator(".quant-script-title").click()
    page.locator(".quant-script-menu-item", has_text="+ 新建脚本").click()
    source = page.locator(".cm-content").inner_text()
    assert 'indicator("My Indicator", overlay=true)' in source
    assert 'plot(ta.ema(close, 14), "EMA 14", color.orange)' in source

    page.locator('.quant-pine-header-slot button[aria-label^="保存脚本"]').click()
    page.locator(".quant-field-input").fill("E2E Script")
    page.locator(".quant-dialog-actions .quant-primary-button").click()

    page.locator('.quant-pine-header-slot button[aria-label="另存为副本"]').click()
    page.locator(".quant-field-input").fill("E2E Copy")
    page.locator(".quant-dialog-actions .quant-primary-button").click()
    assert "E2E Copy" in page.locator(".quant-script-title").inner_text()
    page.locator(".cm-content").fill(
        '//@version=6\nindicator("Cell Two", overlay=true)\n\nplot(open)'
    )
    page.locator('.quant-pine-header-slot button[aria-label^="保存脚本"]').click()
    page.locator(".quant-script-title").click()
    page.locator(".quant-script-menu-item", has_text="E2E Script").last.click()
    assert "E2E Script" in page.locator(".quant-script-title").inner_text()

    page.locator('.quant-pine-header-slot button[aria-label="收藏当前脚本"]').click()
    page.locator("#vela-action-quant-favorites").click()
    page.locator(".favorite-indicators-popover").wait_for(state="visible")
    assert page.locator(
        ".favorite-indicators-popover .quant-popover-item",
        has_text="E2E Script",
    ).count() == 1
    page.mouse.click(1100, 700)

    page.locator(".quant-run-button").click()
    page.wait_for_timeout(800)
    assert page.locator(".quant-log-row", has_text="已提交运行 · My Indicator").count() == 1
    assert page.locator(".vela-cell").first.locator(
        '[data-legend-action="quant-favorite-indicator"]'
    ).count() >= 2
    legend_code = page.locator(".vela-cell").first.locator(
        '[data-legend-action="quant-open-indicator-code"]'
    ).last
    legend_row = legend_code.locator("xpath=ancestor::div[1]")
    assert "My Indicator" in legend_row.inner_text()
    legend_row.locator("span").first.hover()
    legend_code.click()
    assert "E2E Script" in page.locator(".quant-script-title").inner_text()
    undo = page.locator("#vela-tool-vela-widget-undo")
    redo = page.locator("#vela-tool-vela-widget-redo")
    assert undo.is_enabled()
    undo.click()
    assert redo.is_enabled()
    redo.click()

    page.locator(".vela-cell").nth(1).click(position={"x": 120, "y": 120})
    visible_button(page, "Indicators").click()
    page.locator('.quant-indicator-category[data-section="personal"]').click()
    copy_row = page.locator(".quant-indicator-row", has_text="E2E Copy")
    copy_row.locator(".quant-indicator-main").click()
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)

    page.locator("#vela-action-quant-templates").click()
    page.locator(".template-popover").wait_for(state="visible")
    page.locator(
        ".template-popover .quant-popover-item",
        has_text="New template",
    ).click()
    page.locator(".quant-field-input").fill("E2E Template")
    page.locator(".quant-dialog-actions .quant-primary-button").click()


def verify_cell_scoped_external_indicators(page: Page) -> None:
    # Running from the editor uses the Pine declaration title, while adding a
    # saved personal indicator keeps the user-assigned library name. This is
    # the pre-refactor behavior and also proves that each item remains scoped
    # to the cell where it was added.
    expected = ((0, "My Indicator", "E2E Copy"), (1, "E2E Copy", "My Indicator"))
    for cell_index, present, absent in expected:
        page.locator(".vela-cell").nth(cell_index).click(position={"x": 120, "y": 120})
        visible_button(page, "Indicators").click()
        page.locator('.quant-indicator-category[data-section="on-chart"]').click()
        names = page.locator(".quant-indicator-row .quant-indicator-name").all_text_contents()
        assert present in names, (cell_index, names)
        assert absent not in names, (cell_index, names)
        page.keyboard.press("Escape")


def verify_indicator_manager(page: Page) -> None:
    visible_button(page, "Indicators").click()
    page.locator(".quant-indicator-dialog").wait_for(state="visible")
    categories = page.locator(".quant-indicator-category-label").all_text_contents()
    assert categories == ["On chart", "Favorites", "My indicators", "Built-ins"]

    page.locator('.quant-indicator-category[data-section="personal"]').click()
    personal_row = page.locator(".quant-indicator-row", has_text="E2E Script")
    assert personal_row.count() == 1
    personal_row.locator(
        '.quant-indicator-action[title="Open in Pine editor"]'
    ).click()
    assert "E2E Script" in page.locator(".quant-script-title").inner_text()
    visible_button(page, "Indicators").click()
    page.locator('.quant-indicator-category[data-section="on-chart"]').click()
    assert page.locator(".quant-indicator-row").count() >= 1
    page.keyboard.press("Escape")


def verify_template_apply(page: Page) -> None:
    page.locator("#vela-topbar-layout").click()
    page.get_by_role("button", name="1 × 1", exact=True).click()
    page.wait_for_function("document.querySelectorAll('.vela-cell').length === 1")

    page.locator("#vela-action-quant-templates").click()
    page.locator(".template-popover").wait_for(state="visible")
    page.locator(
        ".template-popover .quant-popover-item",
        has_text="E2E Template",
    ).click()
    page.wait_for_function("document.querySelectorAll('.vela-cell').length === 2")


def verify_template_delete(page: Page) -> None:
    page.mouse.click(1100, 700)
    page.locator("#vela-action-quant-templates").click()
    page.locator(".template-popover").wait_for(state="visible")
    page.locator(
        ".template-popover .quant-popover-item",
        has_text="Show all",
    ).click()
    dialog = page.locator(".quant-template-dialog")
    dialog.wait_for(state="visible")
    row = dialog.locator(".quant-template-row", has_text="E2E Template")
    assert row.count() == 1
    row.locator(".quant-danger-button", has_text="Delete").click()
    assert dialog.locator(".quant-template-row", has_text="E2E Template").count() == 0
    dialog.locator(".quant-dialog-close").click()


def verify_persisted_state(page: Page) -> None:
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#vela-action-quant-favorites")
    page.wait_for_timeout(1500)
    verify_indicator_manager(page)

    page.locator("#vela-action-quant-favorites").click()
    assert page.locator(
        ".favorite-indicators-popover .quant-popover-item",
        has_text="E2E Script",
    ).count() == 1
    page.mouse.click(1100, 700)

    page.locator("#vela-action-quant-templates").click()
    assert page.locator(
        ".template-popover .quant-popover-item",
        has_text="E2E Template",
    ).count() == 1


def verify_script_rename_and_delete(page: Page) -> None:
    page.mouse.click(1100, 700)
    pine_editor = page.locator("#vela-tool-vela-widget-panel-quant-pine-editor")
    if pine_editor.get_attribute("data-active") != "1":
        pine_editor.click()
    page.locator(".quant-script-title").click()
    page.locator(".quant-script-menu-item", has_text="重命名脚本").click()
    page.locator(".quant-field-input").fill("E2E Renamed")
    page.locator(".quant-dialog-actions .quant-primary-button").click()

    visible_button(page, "Indicators").click()
    page.locator('.quant-indicator-category[data-section="personal"]').click()
    row = page.locator(".quant-indicator-row", has_text="E2E Renamed")
    assert row.count() == 1
    assert row.locator('.quant-indicator-action[title="Remove from favorites"]').count() == 1
    page.once("dialog", lambda dialog: dialog.accept())
    row.locator('.quant-indicator-action[title="Delete saved indicator"]').click()
    assert page.locator(".quant-indicator-row", has_text="E2E Renamed").count() == 0
    page.keyboard.press("Escape")
    page.locator("#vela-action-quant-favorites").click()
    assert page.locator(
        ".favorite-indicators-popover .quant-popover-item",
        has_text="E2E Renamed",
    ).count() == 0


def verify_legacy_workspace_fixture(browser) -> None:
    fixture = (ROOT / "tests/fixtures/workspace-v2.json").read_text(encoding="utf-8")
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    requests: list[str] = []
    errors: list[str] = []
    install_mock_market_data(context, requests)
    context.add_init_script(MOCK_WEBSOCKET_SCRIPT)
    context.add_init_script(
        "localStorage.clear();"
        "sessionStorage.setItem('quant-e2e-seeded', '1');"
        "localStorage.setItem('quant-tools:workspace:v2', "
        f"{json.dumps(fixture)}"
        ");"
    )
    page = context.new_page()
    observe_page_errors(page, errors, "legacy fixture ")
    response = page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
    assert response is not None and response.status == 200
    page.wait_for_selector("#vela-action-quant-favorites")
    page.wait_for_function("document.querySelectorAll('.vela-cell').length === 2")
    page.wait_for_timeout(1_500)
    verify_cell_scoped_external_indicators(page)
    assert page.locator("#vela-tool-vela-widget-panel-quant-pine-editor").get_attribute(
        "data-active"
    ) == "1"
    assert any("/exchangeInfo" in request for request in requests)
    assert any("/klines" in request for request in requests)
    assert not errors, errors
    context.close()


def run_browser_regression() -> None:
    executable = os.environ.get("CHROMIUM_EXECUTABLE")
    if not executable:
        mac_chromium = "/Applications/Chromium.app/Contents/MacOS/Chromium"
        if Path(mac_chromium).exists():
            executable = mac_chromium

    with sync_playwright() as playwright:
        launch_options = {"headless": True}
        if executable:
            launch_options["executable_path"] = executable
        browser = playwright.chromium.launch(**launch_options)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        market_requests: list[str] = []
        install_mock_market_data(context, market_requests)
        context.add_init_script(MOCK_WEBSOCKET_SCRIPT)
        context.add_init_script(
            """
            if (!sessionStorage.getItem('quant-e2e-seeded')) {
              localStorage.clear();
              sessionStorage.setItem('quant-e2e-seeded', '1');
            }
            """
        )
        page = context.new_page()
        errors: list[str] = []
        observe_page_errors(page, errors)

        response = page.goto(BASE_URL, wait_until="domcontentloaded", timeout=30_000)
        assert response is not None and response.status == 200
        page.wait_for_selector("#vela-action-quant-favorites")
        page.wait_for_timeout(1_000)

        verify_core_toolbar(page)

        for selector in (
            ".vela-widget-symbol",
            "#vela-topbar-tf",
            "#vela-topbar-style",
            "#vela-topbar-layout",
            "#vela-action-quant-favorites",
            "#vela-action-quant-templates",
            "#vela-tool-vela-widget-undo",
            "#vela-tool-vela-widget-redo",
            "#vela-action-screenshot",
            "#vela-tool-vela-widget-panel-dataWindow",
            "#vela-tool-vela-widget-panel-objects",
            "#vela-tool-vela-widget-panel-quant-pine-editor",
        ):
            assert page.locator(selector).count() == 1, selector
        assert page.get_by_role("button", name="Indicators", exact=True).count() == 1

        visible_button(page, "Indicators").click()
        categories = page.locator(".quant-indicator-category-label").all_text_contents()
        assert categories == ["On chart", "Favorites", "My indicators", "Built-ins"]
        page.locator('.quant-indicator-category[data-section="built-ins"]').click()
        native_code = page.locator(
            '.quant-indicator-action[title="View implementation details"]'
        )
        assert native_code.count() >= 1
        native_row = native_code.first.locator("xpath=ancestor::*[contains(@class, 'quant-indicator-row')]")
        native_name = native_row.locator(".quant-indicator-name").inner_text()
        page.locator(".quant-indicator-search").fill(native_name)
        assert page.locator(".quant-indicator-row", has_text=native_name).count() == 1
        page.locator(".quant-indicator-search").fill("")
        native_row = page.locator(".quant-indicator-row", has_text=native_name)
        native_row.locator('.quant-indicator-action[title="View implementation details"]').click()
        page.locator(".quant-source-dialog").wait_for(state="visible")
        page.locator(".quant-source-dialog .quant-dialog-close").click()

        visible_button(page, "Indicators").click()
        page.locator('.quant-indicator-category[data-section="built-ins"]').click()
        native_row = page.locator(".quant-indicator-row", has_text=native_name)
        native_row.locator(".quant-indicator-main").click()
        page.locator('.quant-indicator-category[data-section="on-chart"]').click()
        on_chart_native = page.locator(".quant-indicator-row", has_text=native_name)
        assert on_chart_native.count() == 1
        on_chart_native.locator('.quant-indicator-action[title="Add to favorites"]').click()
        page.locator('.quant-indicator-category[data-section="favorites"]').click()
        favorite_row = page.locator(".quant-indicator-row", has_text=native_name)
        assert favorite_row.count() == 1
        favorite_row.locator('.quant-indicator-action[title="Remove from favorites"]').click()
        assert page.locator(".quant-indicator-row", has_text=native_name).count() == 0
        page.locator('.quant-indicator-category[data-section="on-chart"]').click()
        page.locator(".quant-indicator-row", has_text=native_name).locator(
            '.quant-indicator-action[title="Remove from chart"]'
        ).click()
        assert page.locator(".quant-indicator-row", has_text=native_name).count() == 0

        page.locator('.quant-indicator-category[data-section="built-ins"]').click()
        script_code = page.locator(
            '.quant-indicator-action[title="Open in Pine editor"]'
        )
        assert script_code.count() >= 1
        script_row = script_code.first.locator(
            "xpath=ancestor::*[contains(@class, 'quant-indicator-row')]"
        )
        script_name = script_row.locator(".quant-indicator-name").inner_text()
        script_code.first.click()
        page.locator(".quant-pine-body").wait_for(state="visible")
        assert script_name in page.locator(".quant-script-title").inner_text()

        page.locator("#vela-topbar-layout").click()
        page.get_by_role("button", name="2 × 1", exact=True).click()
        page.wait_for_function("document.querySelectorAll('.vela-cell').length === 2")

        create_script_and_template(page)
        verify_cell_scoped_external_indicators(page)
        verify_template_apply(page)
        verify_cell_scoped_external_indicators(page)
        verify_indicator_manager(page)
        with page.expect_download(timeout=15_000) as download_info:
            page.locator("#vela-action-screenshot").click()
        assert download_info.value.suggested_filename.endswith(".png")
        page.wait_for_timeout(1_000)
        verify_persisted_state(page)
        verify_cell_scoped_external_indicators(page)
        verify_script_rename_and_delete(page)
        verify_template_delete(page)
        assert any("/exchangeInfo" in request for request in market_requests)
        assert any("/klines" in request for request in market_requests)
        assert not errors, errors
        persisted_workspace = page.evaluate(
            "localStorage.getItem('quant-tools:workspace:v2')"
        )
        assert persisted_workspace
        assert isinstance(json.loads(persisted_workspace), dict)
        if os.environ.get("QUANT_DUMP_WORKSPACE") == "1":
            print(f"WORKSPACE_STATE={persisted_workspace}")

        if SERVER_SCRIPT == "dev" and os.environ.get("QUANT_SKIP_LIFECYCLE") != "1":
            lifecycle = context.new_page()
            observe_page_errors(lifecycle, errors, "lifecycle ")
            lifecycle.goto(LIFECYCLE_URL, wait_until="domcontentloaded", timeout=30_000)
            lifecycle.wait_for_selector("#vela-action-quant-favorites")
            for selector in (
                "#vela-action-quant-favorites",
                "#vela-action-quant-templates",
                "#vela-action-screenshot",
                "#vela-tool-vela-widget-panel-quant-pine-editor",
            ):
                assert lifecycle.locator(selector).count() == 1, selector

            lifecycle_pine = lifecycle.locator(
                "#vela-tool-vela-widget-panel-quant-pine-editor"
            )
            if lifecycle_pine.get_attribute("data-active") != "1":
                lifecycle_pine.click()
            lifecycle.locator(".quant-pine-body").wait_for(state="visible")
            lifecycle.locator(".cm-content").fill(
                '//@version=6\nindicator("Lifecycle Draft", overlay=true)\n\nplot(close)'
            )
            lifecycle.locator("#vela-action-quant-favorites").click()
            lifecycle.locator(".favorite-indicators-popover").wait_for(state="visible")
            lifecycle.evaluate("window.destroyQuantApp(); window.destroyQuantApp()")
            assert lifecycle.locator("#vela-action-quant-favorites").count() == 0
            assert lifecycle.locator(".favorite-indicators-popover").count() == 0
            lifecycle.evaluate("window.mountQuantApp()")
            lifecycle.wait_for_selector("#vela-action-quant-favorites")
            for selector in (
                "#vela-action-quant-favorites",
                "#vela-action-quant-templates",
                "#vela-action-screenshot",
                "#vela-tool-vela-widget-panel-quant-pine-editor",
            ):
                assert lifecycle.locator(selector).count() == 1, selector
            lifecycle_pine = lifecycle.locator(
                "#vela-tool-vela-widget-panel-quant-pine-editor"
            )
            if lifecycle_pine.get_attribute("data-active") != "1":
                lifecycle_pine.click()
            lifecycle.locator(".quant-pine-body").wait_for(state="visible")
            assert "Lifecycle Draft" in lifecycle.locator(".cm-content").inner_text()
            lifecycle.evaluate("window.destroyQuantApp()")
            assert lifecycle.evaluate("window.failQuantAppMount()") is True
            lifecycle.evaluate("window.mountQuantApp()")
            lifecycle.wait_for_selector("#vela-action-quant-favorites")
            for selector in (
                "#vela-action-quant-favorites",
                "#vela-action-quant-templates",
                "#vela-action-screenshot",
                "#vela-tool-vela-widget-panel-quant-pine-editor",
            ):
                assert lifecycle.locator(selector).count() == 1, selector
            lifecycle.evaluate("window.destroyQuantApp()")
            lifecycle.close()
            assert not errors, errors

        context.close()
        verify_legacy_workspace_fixture(browser)
        browser.close()


def main() -> int:
    server = subprocess.Popen(
        [
            "npm",
            "run",
            SERVER_SCRIPT,
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
        run_browser_regression()
        print("E2E regression passed")
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
    except Exception as error:  # noqa: BLE001 - test runner must report all failures.
        print(f"E2E regression failed: {error}", file=sys.stderr)
        raise
