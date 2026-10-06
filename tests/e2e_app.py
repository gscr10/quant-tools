#!/usr/bin/env python3
"""Browser regression for the application architecture boundary.

Requires Python Playwright. The runner starts and stops Vite dev by default;
pass ``--preview`` after building to exercise production assets. Set
CHROMIUM_EXECUTABLE when Chromium is not installed in a standard macOS path.
"""

from __future__ import annotations

import base64
from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

from playwright.sync_api import BrowserContext, Page, Route, TimeoutError as PlaywrightTimeoutError, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = 4178
BASE_URL = f"http://{HOST}:{PORT}/?chart=maximized"
LIFECYCLE_URL = f"http://{HOST}:{PORT}/tests/fixtures/lifecycle.html"
G3A_FIXTURE_URL = f"http://{HOST}:{PORT}/tests/fixtures/backtest-workbench.html"
SIMULATION_FIXTURE_URL = (
    f"http://{HOST}:{PORT}/tests/fixtures/backtest-simulation.html"
)
BTCUSDT_FIXTURE_URL = (
    f"http://{HOST}:{PORT}/tests/fixtures/backtest-btcusdt.html"
)
SERVER_SCRIPT = "preview" if "--preview" in sys.argv[1:] else "dev"
WORKSPACE_STORAGE_KEY = "quant-tools:workspace:v2"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}

# A direct ``python3 tests/e2e_app.py --preview`` invocation used to start
# Vite against whatever happened to be in dist/.  That made the test report
# application failures from an older bundle (notably missing strategy Dock
# selectors) unless the caller remembered to run ``npm run build`` first.
# Keep the convenient direct invocation safe by checking the bundle before
# starting the server.  The npm script remains fast when the bundle is
# current, while source edits and a newer commit trigger the normal build.
PREVIEW_BUILD_INPUTS = (
    "src",
    # Only fork sources are build inputs.  Their generated dist/ and
    # node_modules/ trees are outputs and must not make every preview look
    # stale after ``npm run build``.
    "packages/pinets/src",
    "packages/pinets/package.json",
    "packages/vela-pinets/src",
    "packages/vela-pinets/package.json",
    "public",
    "index.html",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
)


def _latest_mtime(path: Path) -> float:
    """Return the newest mtime below *path*, or zero when it is absent."""

    try:
        if path.is_file():
            return path.stat().st_mtime
        if path.is_dir():
            return max(
                (entry.stat().st_mtime for entry in path.rglob("*") if entry.is_file()),
                default=path.stat().st_mtime,
            )
    except OSError:
        return 0.0
    return 0.0


def preview_build_is_current() -> bool:
    """Check whether dist/ can safely be used for a production preview."""

    dist_index = ROOT / "dist" / "index.html"
    try:
        dist_mtime = dist_index.stat().st_mtime
    except OSError:
        return False

    # Filesystem mtimes catch both tracked and untracked source edits.  A
    # small tolerance avoids rebuilding when a filesystem rounds timestamps.
    newest_input = max(
        (_latest_mtime(ROOT / relative) for relative in PREVIEW_BUILD_INPUTS),
        default=0.0,
    )
    if newest_input > dist_mtime + 1.0:
        return False

    # Git can restore a checkout with normalized mtimes, so also compare the
    # newest commit timestamp.  This closes the stale-dist case where source
    # content changed but all restored files look older than dist/index.html.
    try:
        commit = subprocess.run(
            ["git", "log", "-1", "--format=%ct"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        latest_commit = float(commit.stdout.strip())
    except (OSError, subprocess.CalledProcessError, ValueError):
        latest_commit = 0.0
    return dist_mtime + 1.0 >= latest_commit


def ensure_preview_build() -> None:
    """Build production assets when direct preview execution would be stale."""

    if preview_build_is_current():
        return
    print("Production dist/ is missing or stale; running npm run build", flush=True)
    subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)
# Pin each run to noon on the 15th of the browser's current local month. This
# keeps the Calendar's required current-month population stable at month
# boundaries while still exercising the real current year/month.
_runtime_now = datetime.now().astimezone()
FIXED_BROWSER_NOW_MS = int(_runtime_now.replace(
    day=15,
    hour=12,
    minute=0,
    second=0,
    microsecond=0,
).timestamp() * 1000)

# The application is expected to be self-contained.  Keep this audit in the
# browser context (rather than relying on an allow-list of mocked providers)
# so a newly introduced LuxAlgo request cannot silently become a runtime
# dependency.
STORAGE_AUDIT_SCRIPT = r"""
(() => {
  const audit = {
    writes: [],
    removes: [],
    clears: [],
    reset() {
      this.writes.length = 0;
      this.removes.length = 0;
      this.clears.length = 0;
    },
    summary() {
      const summarize = (items) => ({
        count: items.length,
        keys: [...new Set(items.map((item) => item.key).filter(Boolean))],
        storages: [...new Set(items.map((item) => item.storage))],
      });
      return {
        writes: summarize(this.writes),
        removes: summarize(this.removes),
        clears: summarize(this.clears),
      };
    },
  };
  Object.defineProperty(window, '__quantStorageAudit', {
    configurable: true,
    value: audit,
  });

  const storageName = (storage) => {
    try {
      if (storage === window.localStorage) return 'local';
      if (storage === window.sessionStorage) return 'session';
    } catch {
      // Access can be denied in a sandboxed frame; the operation still runs.
    }
    return 'unknown';
  };
  const prototype = Storage.prototype;
  const originalSetItem = prototype.setItem;
  const originalRemoveItem = prototype.removeItem;
  const originalClear = prototype.clear;
  prototype.setItem = function auditedSetItem(key, value) {
    audit.writes.push({
      key: String(key),
      storage: storageName(this),
      length: String(value).length,
    });
    return originalSetItem.call(this, key, value);
  };
  prototype.removeItem = function auditedRemoveItem(key) {
    audit.removes.push({ key: String(key), storage: storageName(this) });
    return originalRemoveItem.call(this, key);
  };
  prototype.clear = function auditedClear() {
    audit.clears.push({ storage: storageName(this) });
    return originalClear.call(this);
  };
})();
"""
WORKER_AUDIT_SCRIPT = r"""
(() => {
  const audit = {
    messages: [],
    reset() { this.messages.length = 0; },
    summary() {
      const kinds = this.messages.map((message) => message.kind);
      return {
        count: kinds.length,
        kinds,
        byKind: Object.fromEntries(
          [...new Set(kinds)].map((kind) => [
            kind,
            kinds.filter((candidate) => candidate === kind).length,
          ]),
        ),
      };
    },
  };
  Object.defineProperty(window, '__quantWorkerAudit', {
    configurable: true,
    value: audit,
  });
  if (typeof Worker !== 'function') return;
  const originalPostMessage = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function auditedWorkerPostMessage(...args) {
    const payload = args[0];
    audit.messages.push({
      kind: payload && typeof payload === 'object' && typeof payload.kind === 'string'
        ? payload.kind
        : 'unknown',
    });
    return Reflect.apply(originalPostMessage, this, args);
  };
})();
"""
MOCK_WEBSOCKET_SCRIPT = """
const quantMockWebSocketAudit = {
  constructions: [],
  sends: [],
  closes: 0,
  reset() {
    this.constructions.length = 0;
    this.sends.length = 0;
    this.closes = 0;
  },
  summary() {
    return {
      constructions: this.constructions.length,
      sends: this.sends.length,
      closes: this.closes,
    };
  },
};
Object.defineProperty(window, '__quantMockWebSocketAudit', {
  configurable: true,
  value: quantMockWebSocketAudit,
});
class QuantMockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) {
    this.url = String(url);
    this.readyState = QuantMockWebSocket.OPEN;
    quantMockWebSocketAudit.constructions.push(this.url);
    queueMicrotask(() => this.onopen?.(new Event('open')));
  }
  send(value) {
    quantMockWebSocketAudit.sends.push(typeof value);
  }
  close() {
    this.readyState = QuantMockWebSocket.CLOSED;
    quantMockWebSocketAudit.closes += 1;
    this.onclose?.(new CloseEvent('close'));
  }
  addEventListener(type, listener) { this[`on${type}`] = listener; }
  removeEventListener(type, listener) {
    if (this[`on${type}`] === listener) this[`on${type}`] = null;
  }
}
window.WebSocket = QuantMockWebSocket;
"""


def install_fixed_clock(context: BrowserContext) -> None:
    context.add_init_script(
        f"""
        (() => {{
          const fixedNow = {FIXED_BROWSER_NOW_MS};
          const NativeDate = Date;
          class QuantFixedDate extends NativeDate {{
            constructor(...args) {{
              super(...(args.length === 0 ? [fixedNow] : args));
            }}
            static now() {{ return fixedNow; }}
          }}
          window.Date = QuantFixedDate;
        }})();
        """
    )


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
    # Keep the deterministic price fixture aligned with the pinned browser
    # clock so the Calendar's current-month default always has recent rows.
    default_end = FIXED_BROWSER_NOW_MS
    end = int(query.get("endTime", [str(default_end)])[0])
    end -= end % step
    first = end - count * step
    bars: list[list[object]] = []
    for index in range(count):
        opened = first + index * step
        # A deterministic trend plus triangle wave keeps the browser fixture
        # realistic enough for the built-in SMA Cross strategy to produce
        # both crossover and crossunder fills. A strictly monotonic fixture
        # leaves that strategy in the legitimate `no-trades` state, where the
        # Viewer intentionally has no Performance curve to inspect.
        phase = index % 48
        triangle = phase if phase < 24 else 48 - phase
        price = 60_000 + index * 2 + (triangle - 12) * 30
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


def install_offline_guard(context: BrowserContext, blocked: list[str]) -> None:
    """Abort any non-local request not handled by a later, specific mock route.

    Playwright evaluates routes in reverse registration order. Callers install
    this catch-all before ``install_mock_market_data`` so the deterministic
    Binance/Hyperliquid/icon handlers take precedence while every other
    network dependency is both blocked and recorded.
    """

    def handle(route: Route) -> None:
        parsed = urlparse(route.request.url)
        hostname = (parsed.hostname or "").lower().rstrip(".")
        if parsed.scheme in {"http", "https"} and hostname not in LOCAL_HOSTS:
            blocked.append(route.request.url)
            route.abort("blockedbyclient")
            return
        route.continue_()

    context.route("**/*", handle)


def install_storage_audit(context: BrowserContext) -> None:
    """Track browser storage writes without recording user values in output."""

    context.add_init_script(STORAGE_AUDIT_SCRIPT)


def install_luxalgo_request_audit(
    context: BrowserContext,
    requests: list[str],
) -> None:
    """Record any reference-site request; the expected count is zero."""

    def record(request) -> None:
        hostname = (urlparse(request.url).hostname or "").lower().rstrip(".")
        if hostname == "luxalgo.com" or hostname.endswith(".luxalgo.com"):
            requests.append(request.url)

    context.on("request", record)


def browser_storage_snapshot(page: Page) -> dict[str, dict[str, str]]:
    return page.evaluate(
        """
        () => {
          const read = (storage) => {
            const result = {};
            for (let index = 0; index < storage.length; index += 1) {
              const key = storage.key(index);
              if (key !== null) result[key] = storage.getItem(key);
            }
            return result;
          };
          return { local: read(localStorage), session: read(sessionStorage) };
        }
        """
    )


def assert_storage_unchanged(
    before: dict[str, dict[str, str]],
    after: dict[str, dict[str, str]],
    *,
    ignored_keys: set[str] = frozenset(),
) -> None:
    """Compare key/value snapshots while omitting intentional workspace writes."""

    changed: list[str] = []
    for storage_name in ("local", "session"):
        before_values = before.get(storage_name, {})
        after_values = after.get(storage_name, {})
        keys = set(before_values) | set(after_values)
        for key in sorted(keys - ignored_keys):
            if before_values.get(key) != after_values.get(key):
                changed.append(f"{storage_name}:{key}")
    assert not changed, f"unexpected browser storage changes: {changed}"


def storage_audit_summary(page: Page) -> dict[str, object]:
    summary = page.evaluate(
        """
        () => window.__quantStorageAudit?.summary?.() ?? {
          writes: { count: 0, keys: [], storages: [] },
          removes: { count: 0, keys: [], storages: [] },
          clears: { count: 0, keys: [], storages: [] },
        }
        """
    )
    return summary


def reset_storage_audit(page: Page) -> None:
    page.evaluate("window.__quantStorageAudit?.reset?.()")


def assert_no_luxalgo_requests(requests: list[str], label: str) -> None:
    assert not requests, f"{label} made LuxAlgo-domain requests: {requests}"


def wait_for_server(process: subprocess.Popen[str]) -> None:
    # `npm run dev` performs the local PineTS/Vela-PineTS prebuild first.  A
    # cold checkout can legitimately exceed the old 20s probe window even
    # though the server is healthy; keep the timeout explicit and overridable
    # instead of making a prebuild race look like an application failure.
    startup_timeout = float(os.environ.get("QUANT_E2E_STARTUP_TIMEOUT", "90"))
    deadline = time.monotonic() + max(5.0, startup_timeout)
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

    # CodeMirror is an optional first-open chunk. The initial-graph assertion
    # is made before any earlier indicator action can intentionally open the
    # editor; this helper also verifies that the real side-panel interaction
    # loads it on demand.
    pine_editor.click()
    assert pine_editor.get_attribute("data-active") == "1"
    assert object_tree.get_attribute("data-active") != "1"
    page.locator(".quant-pine-body").wait_for(state="visible")
    page.wait_for_function(
        """() => performance.getEntriesByType('resource').some(entry =>
        entry.name.includes('pine-editor-controller'))"""
    )
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


def verify_simulation_workspace(
    page: Page,
    viewer,
    tabs,
    market_requests: list[str],
) -> dict[str, object]:
    """Exercise Simulation through the real Viewer and local Pine report."""

    storage_before = browser_storage_snapshot(page)
    storage_audit_before = storage_audit_summary(page)
    provider_request_count = len(market_requests)
    provider_kline_count = sum("/klines" in request for request in market_requests)
    page.evaluate(
        """
        () => {
          window.__quantWorkerAudit?.reset?.();
          window.__quantMockWebSocketAudit?.reset?.();
        }
        """
    )

    tabs.filter(has_text="Simulation").click()
    simulation = viewer.locator(".quant-backtest-simulation")
    simulation.wait_for(state="visible")
    toolbar = simulation.locator(".quant-backtest-simulation-toolbar")
    assert toolbar.is_visible(), {
        "toolbarCount": toolbar.count(),
        "simulationText": simulation.inner_text()[:500],
        "simulationHtml": simulation.inner_html()[:1_000],
    }
    assert toolbar.locator('[role="group"][aria-label="Method"]').count() == 1
    assert toolbar.locator(
        '[role="group"][aria-label="Drawdown threshold"]'
    ).count() == 1
    assert toolbar.locator(
        '[role="group"][aria-label="Drawdown unit"]'
    ).count() == 1
    toolbar_box = toolbar.bounding_box()
    assert toolbar_box is not None and 44 <= toolbar_box["height"] <= 52, toolbar_box

    method_help = toolbar.get_by_role(
        "button", name="About Method", exact=True
    )
    method_help.focus()
    tooltip_id = method_help.get_attribute("aria-describedby")
    assert tooltip_id
    method_tooltip = simulation.locator(f"#{tooltip_id}")
    method_tooltip.wait_for(state="visible")
    tooltip_geometry = method_tooltip.evaluate(
        """
        (node) => {
          const rect = node.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            viewportWidth: document.documentElement.clientWidth,
          };
        }
        """
    )
    assert tooltip_geometry["left"] >= 8, tooltip_geometry
    assert tooltip_geometry["right"] <= (
        tooltip_geometry["viewportWidth"] - 8
    ), tooltip_geometry
    method_help.evaluate("node => node.blur()")
    method_tooltip.wait_for(state="hidden")

    method = toolbar.locator('[role="group"][aria-label="Method"]')
    assert method.get_by_role(
        "button", name="Resample", exact=True
    ).get_attribute("aria-pressed") == "true"
    assert method.get_by_role(
        "button", name="Shuffle", exact=True
    ).get_attribute("aria-pressed") == "false"
    drawdown_threshold = toolbar.locator(
        '[role="group"][aria-label="Drawdown threshold"]'
    )
    assert drawdown_threshold.get_by_role(
        "button", name="2× DD", exact=True
    ).get_attribute("aria-pressed") == "true"
    drawdown_unit = toolbar.locator(
        '[role="group"][aria-label="Drawdown unit"]'
    )
    assert drawdown_unit.get_by_role(
        "button", name="USD", exact=True
    ).get_attribute("aria-pressed") == "true"

    kpi_labels = simulation.locator(
        ".quant-backtest-simulation-kpi > span"
    ).all_text_contents()
    assert kpi_labels[0:2] == ["Probability of profit", "Median outcome"], kpi_labels
    assert "P95–P99 drawdown" in kpi_labels
    assert "Risk of ruin" in kpi_labels
    assert any(label.startswith("P(drawdown ≥ ") for label in kpi_labels)
    assert "P95 max losing streak" in kpi_labels
    assert any(label.startswith("Actual ") for label in kpi_labels)

    chart_titles = simulation.locator(
        ".quant-backtest-simulation-chart-panel h4"
    ).all_text_contents()
    assert chart_titles[0:2] == [
        "Simulated Net Profit Paths",
        "Outcome Distribution (USD)",
    ], chart_titles
    assert len(chart_titles) == 3, chart_titles
    assert chart_titles[2].endswith("Max Drawdown Distribution"), chart_titles

    streak_table = simulation.locator(".quant-backtest-simulation-streaks table")
    assert streak_table.locator("thead th").all_text_contents() == [
        "Metric", "Actual", "Median", "P95",
    ]
    assert streak_table.locator("tbody td:first-child").all_text_contents() == [
        "Longest losing streak",
        "Max DD duration",
        "Recovery duration",
    ]
    assert all(
        value.endswith(" trades")
        for value in streak_table.locator("tbody td:not(:first-child)").all_text_contents()
    )

    # The confidence bands must be a genuine local Highcharts More upgrade,
    # not just the static SVG fallback or a source-level arearange declaration.
    try:
        page.wait_for_function(
            """
            () => {
              const simulation = document.querySelector(
                '.quant-backtest-viewer .quant-backtest-simulation',
              );
              const hosts = simulation?.querySelectorAll(
                '.quant-backtest-simulation-chart-host',
              );
              const path = simulation?.querySelector(
                '.quant-backtest-simulation-paths-host',
              );
              return hosts?.length === 3
                && simulation.querySelectorAll('svg.highcharts-root').length === 3
                && path?.querySelectorAll(
                  '.highcharts-series.highcharts-arearange-series',
                ).length === 2;
            }
            """,
            timeout=30_000,
        )
    except Exception as error:
        runtime = simulation.evaluate(
            """
            (node) => ({
              titles: [...node.querySelectorAll(
                '.quant-backtest-simulation-chart-panel h4',
              )].map((title) => title.textContent?.trim()),
              hosts: node.querySelectorAll(
                '.quant-backtest-simulation-chart-host',
              ).length,
              roots: node.querySelectorAll('svg.highcharts-root').length,
              fallbacks: node.querySelectorAll(
                '.quant-backtest-simulation-chart-fallback',
              ).length,
              rangeSeries: node.querySelectorAll(
                '.highcharts-series.highcharts-arearange-series',
              ).length,
              rangeClasses: [...node.querySelectorAll(
                '.highcharts-arearange-series',
              )].map((series) => series.getAttribute('class')),
            })
            """
        )
        raise AssertionError(
            f"Simulation charts did not upgrade through Highcharts More: {runtime}"
        ) from error

    chart_hosts = simulation.locator(
        ".quant-backtest-simulation-chart-host[data-quant-report-chart]"
    )
    assert chart_hosts.count() == 3
    assert simulation.locator(
        ".quant-backtest-simulation-chart-fallback"
    ).count() == 0
    for index in range(chart_hosts.count()):
        host = chart_hosts.nth(index)
        assert host.get_attribute("role") == "img"
        assert (host.get_attribute("aria-label") or "").strip()
        root = host.locator("svg.highcharts-root")
        assert root.count() == 1
        assert (root.get_attribute("aria-label") or "").strip()
        assert root.locator("desc[data-quant-report-description]").count() == 1
    paths_host = simulation.locator(".quant-backtest-simulation-paths-host")
    assert paths_host.locator(
        ".highcharts-series.highcharts-arearange-series"
    ).count() == 2
    distribution_labels = simulation.locator(
        ".quant-backtest-simulation-distribution-host .highcharts-plot-line-label"
    ).all_text_contents()
    assert distribution_labels.count("P5") == 2, distribution_labels
    assert distribution_labels.count("P95") == 2, distribution_labels
    assert distribution_labels.count("Actual") == 2, distribution_labels

    # Shuffle without variation has one deterministic terminal outcome. It
    # therefore hides only the outcome distribution, retaining drawdown risk.
    shuffle = method.get_by_role("button", name="Shuffle", exact=True)
    shuffle.click()
    expect(shuffle).to_have_attribute("aria-pressed", "true")
    assert (simulation.locator(
        ".quant-backtest-simulation-kpi > span"
    ).first.text_content() or "").strip() == "Final net profit (every run)"
    assert simulation.locator(
        ".quant-backtest-simulation-chart-panel",
        has_text="Outcome Distribution",
    ).count() == 0
    assert simulation.locator(
        ".quant-backtest-simulation-distribution-host"
    ).count() == 1
    assert "every run ends at the same total" in simulation.locator(
        ".quant-backtest-simulation-methodology"
    ).inner_text()

    settings_trigger = simulation.locator(
        '[data-simulation-settings-trigger="desktop"]'
    )
    settings_trigger.click()
    settings_dialog = simulation.locator(
        ".quant-backtest-simulation-settings-dialog"
    )
    settings_dialog.wait_for(state="visible")
    page.wait_for_function(
        """
        () => document.activeElement === document.querySelector(
          '.quant-backtest-simulation-settings-dialog',
        )
        """
    )
    assert settings_dialog.get_attribute("role") == "dialog"
    assert settings_dialog.get_attribute("aria-modal") == "true"
    expect(settings_trigger).to_have_attribute("aria-expanded", "true")
    modal_isolation = viewer.evaluate(
        """
        (node) => {
          const header = node.querySelector('.quant-backtest-viewer-header');
          const tablist = node.querySelector('.quant-backtest-tabs');
          const simulation = node.querySelector('.quant-backtest-simulation');
          const overlay = simulation?.querySelector(
            '.quant-backtest-simulation-settings',
          );
          const background = [...(simulation?.children ?? [])]
            .filter((child) => child !== overlay)
            .map((child) => ({
              className: child.className,
              inert: child.inert,
              ariaHidden: child.getAttribute('aria-hidden'),
            }));
          return {
            header: {
              inert: header?.inert ?? null,
              ariaHidden: header?.getAttribute('aria-hidden') ?? null,
            },
            tablist: {
              inert: tablist?.inert ?? null,
              ariaHidden: tablist?.getAttribute('aria-hidden') ?? null,
            },
            background,
            overlay: {
              inert: overlay?.inert ?? null,
              ariaHidden: overlay?.getAttribute('aria-hidden') ?? null,
            },
          };
        }
        """
    )
    assert modal_isolation["header"] == {
        "inert": True,
        "ariaHidden": "true",
    }, modal_isolation
    assert modal_isolation["tablist"] == {
        "inert": True,
        "ariaHidden": "true",
    }, modal_isolation
    assert len(modal_isolation["background"]) >= 3, modal_isolation
    assert all(
        item["inert"] is True and item["ariaHidden"] == "true"
        for item in modal_isolation["background"]
    ), modal_isolation
    assert modal_isolation["overlay"] == {
        "inert": False,
        "ariaHidden": None,
    }, modal_isolation

    # Shift+Tab from the first control wraps to the last visible control; the
    # following Tab wraps back to the close button, proving the modal trap.
    settings_close = settings_dialog.locator(
        ".quant-backtest-simulation-settings-close"
    )
    settings_close.focus()
    page.keyboard.press("Shift+Tab")
    assert settings_dialog.evaluate(
        "node => node.contains(document.activeElement)"
    ) is True
    assert page.evaluate(
        "document.activeElement?.classList.contains("
        "'quant-backtest-simulation-settings-close')"
    ) is False
    page.keyboard.press("Tab")
    assert page.evaluate(
        "document.activeElement?.classList.contains("
        "'quant-backtest-simulation-settings-close')"
    ) is True

    runs = settings_dialog.locator("#quant-backtest-simulation-runs")
    variation = settings_dialog.locator("#quant-backtest-simulation-variation")
    preserve = settings_dialog.locator("#quant-backtest-simulation-preserve")
    assert runs.input_value() == "1000"
    assert variation.input_value() == "0"
    assert preserve.is_disabled()
    variation = settings_dialog.locator("#quant-backtest-simulation-variation")
    variation.fill("10")
    variation.dispatch_event("change")
    page.wait_for_function(
        """
        () => document.querySelector('#quant-backtest-simulation-variation')?.value === '10'
          && document.querySelector('#quant-backtest-simulation-preserve')?.disabled === false
        """
    )
    preserve = settings_dialog.locator("#quant-backtest-simulation-preserve")
    assert not preserve.is_disabled()
    preserve.check()
    expect(settings_dialog.locator(
        "#quant-backtest-simulation-preserve"
    )).to_be_checked()
    pending_start = page.evaluate(
        """
        () => {
          const panel = document.querySelector('#quant-backtest-panel');
          const runs = panel?.querySelector('#quant-backtest-simulation-runs');
          if (!(panel instanceof HTMLElement) || !(runs instanceof HTMLSelectElement)) {
            throw new Error('Simulation runs control is unavailable');
          }
          const records = [];
          let previous = '';
          const capture = () => {
            const status = panel.querySelector(
              '[data-simulation-run-status="pending"]',
            );
            if (!(status instanceof HTMLElement)) return null;
            const progress = status.querySelector('progress');
            const detail = status.querySelector('span')?.textContent?.trim() ?? '';
            const match = detail.match(/([0-9,]+) of ([0-9,]+) complete/);
            const viewer = panel.closest('.quant-backtest-viewer');
            const simulation = panel.querySelector('.quant-backtest-simulation');
            const overlay = simulation?.querySelector(
              '.quant-backtest-simulation-settings',
            );
            const background = [...(simulation?.children ?? [])]
              .filter((child) => child !== overlay);
            const record = {
              status: status.dataset.simulationRunStatus ?? null,
              visible: status.getClientRects().length > 0,
              role: status.getAttribute('role'),
              ariaLive: status.getAttribute('aria-live'),
              title: status.querySelector('strong')?.textContent?.trim() ?? '',
              detail,
              completedRuns: match ? Number(match[1].replaceAll(',', '')) : null,
              totalRuns: match ? Number(match[2].replaceAll(',', '')) : null,
              progressValue: progress instanceof HTMLProgressElement
                ? progress.value
                : null,
              progressMax: progress instanceof HTMLProgressElement
                ? progress.max
                : null,
              progressLabel: progress?.getAttribute('aria-label') ?? null,
              focusKey: document.activeElement instanceof HTMLElement
                ? document.activeElement.dataset.simulationFocus ?? null
                : null,
              runsValue: panel.querySelector('#quant-backtest-simulation-runs')?.value
                ?? null,
              modalIsolation: {
                header: viewer?.querySelector(
                  '.quant-backtest-viewer-header',
                )?.inert === true,
                tablist: viewer?.querySelector('.quant-backtest-tabs')?.inert === true,
                background: background.length >= 3 && background.every(
                  (child) => child.inert
                    && child.getAttribute('aria-hidden') === 'true',
                ),
                overlayExposed: overlay?.inert === false
                  && overlay.getAttribute('aria-hidden') === null,
              },
            };
            const signature = `${record.completedRuns}:${record.progressValue}`;
            if (signature !== previous) {
              previous = signature;
              records.push(record);
            }
            return record;
          };
          const observer = new MutationObserver(capture);
          observer.observe(panel, { childList: true, subtree: true });
          Object.defineProperty(window, '__quantSimulationPendingAudit', {
            configurable: true,
            value: {
              records,
              stop: () => {
                capture();
                observer.disconnect();
                return structuredClone(records);
              },
            },
          });
          runs.focus();
          runs.value = '2500';
          runs.dispatchEvent(new Event('change', { bubbles: true }));
          return capture();
        }
        """
    )
    assert pending_start == {
        "status": "pending",
        "visible": True,
        "role": "status",
        "ariaLive": "polite",
        "title": "Running 2,500 simulations…",
        "detail": "0 of 2,500 complete",
        "completedRuns": 0,
        "totalRuns": 2500,
        "progressValue": 0,
        "progressMax": 1,
        "progressLabel": "Simulation progress",
        "focusKey": "settings:runs",
        "runsValue": "2500",
        "modalIsolation": {
            "header": True,
            "tablist": True,
            "background": True,
            "overlayExposed": True,
        },
    }, pending_start
    page.wait_for_function(
        """
        () => window.__quantSimulationPendingAudit?.records?.some(
          (record) => record.completedRuns > 0,
        ) === true
        """,
        timeout=30_000,
    )
    page.wait_for_function(
        """
        () => window.__simulationFixture?.state?.().report?.simulation?.runs === 2500
        """,
        timeout=30_000,
    )
    pending_records = page.evaluate(
        "window.__quantSimulationPendingAudit.stop()"
    )
    assert len(pending_records) >= 2, pending_records
    assert any(
        record["completedRuns"] > 0 and record["progressValue"] > 0
        for record in pending_records
    ), pending_records
    assert all(
        record["status"] == "pending"
        and record["visible"] is True
        and record["focusKey"] == "settings:runs"
        and record["runsValue"] == "2500"
        and all(record["modalIsolation"].values())
        for record in pending_records
    ), pending_records
    assert simulation.locator(
        "[data-simulation-run-status]"
    ).count() == 0
    page.wait_for_function(
        """
        () => document.activeElement?.dataset.simulationFocus === 'settings:runs'
          && document.activeElement?.value === '2500'
        """
    )

    page.keyboard.press("Escape")
    simulation.locator(
        ".quant-backtest-simulation-settings"
    ).wait_for(state="detached")
    page.wait_for_function(
        """
        () => document.activeElement?.dataset.simulationSettingsTrigger === 'desktop'
        """
    )
    expect(settings_trigger).to_have_attribute("aria-expanded", "false")
    restored_background = viewer.evaluate(
        """
        (node) => {
          const header = node.querySelector('.quant-backtest-viewer-header');
          const tablist = node.querySelector('.quant-backtest-tabs');
          const simulation = node.querySelector('.quant-backtest-simulation');
          return {
            header: {
              inert: header?.inert ?? null,
              ariaHidden: header?.getAttribute('aria-hidden') ?? null,
            },
            tablist: {
              inert: tablist?.inert ?? null,
              ariaHidden: tablist?.getAttribute('aria-hidden') ?? null,
            },
            simulationChildren: [...(simulation?.children ?? [])].map((child) => ({
              inert: child.inert,
              ariaHidden: child.getAttribute('aria-hidden'),
            })),
          };
        }
        """
    )
    assert restored_background["header"] == {
        "inert": False,
        "ariaHidden": None,
    }, restored_background
    assert restored_background["tablist"] == {
        "inert": False,
        "ariaHidden": None,
    }, restored_background
    assert all(
        item["inert"] is False and item["ariaHidden"] is None
        for item in restored_background["simulationChildren"]
    ), restored_background

    # Variation restores an outcome distribution in Shuffle mode. Exercise
    # the remaining toolbar controls and both independent chart view toggles.
    page.wait_for_function(
        """
        () => document.querySelectorAll(
          '.quant-backtest-viewer .quant-backtest-simulation-chart-host '
          + 'svg.highcharts-root',
        ).length === 3
        """
    )
    old_threshold_label = simulation.locator(
        ".quant-backtest-simulation-kpi > span",
        has_text="P(drawdown ≥ ",
    ).inner_text()
    drawdown_three = drawdown_threshold.get_by_role(
        "button", name="3× DD", exact=True
    )
    drawdown_three.click()
    expect(drawdown_three).to_have_attribute("aria-pressed", "true")
    new_threshold_label = simulation.locator(
        ".quant-backtest-simulation-kpi > span",
        has_text="P(drawdown ≥ ",
    ).inner_text()
    assert new_threshold_label != old_threshold_label

    percent_unit = drawdown_unit.get_by_role("button", name="%", exact=True)
    percent_unit.click()
    expect(percent_unit).to_have_attribute("aria-pressed", "true")
    assert simulation.locator(
        ".quant-backtest-simulation-kpi"
    ).last.locator("strong").inner_text().endswith("%")
    currency_unit = drawdown_unit.get_by_role(
        "button", name="USD", exact=True
    )
    currency_unit.click()
    expect(currency_unit).to_have_attribute("aria-pressed", "true")
    assert simulation.locator(
        ".quant-backtest-simulation-kpi"
    ).last.locator("strong").inner_text().endswith("USD")

    outcome_panel = simulation.locator(
        ".quant-backtest-simulation-chart-panel",
        has_text="Outcome Distribution (USD)",
    )
    drawdown_panel = simulation.locator(
        ".quant-backtest-simulation-chart-panel",
        has_text="Drawdown Distribution",
    )
    outcome_modes = outcome_panel.locator(
        '[role="group"][aria-label="Outcome Distribution (USD)"]'
    )
    drawdown_title = drawdown_panel.locator("h4").inner_text()
    drawdown_modes = drawdown_panel.locator(
        f'[role="group"][aria-label="{drawdown_title}"]'
    )
    assert outcome_modes.get_by_role(
        "button", name="Histogram", exact=True
    ).get_attribute("aria-pressed") == "true"
    assert drawdown_modes.get_by_role(
        "button", name="Histogram", exact=True
    ).get_attribute("aria-pressed") == "true"

    outcome_modes.get_by_role("button", name="Cumulative", exact=True).click()
    outcome_panel.locator(
        ".highcharts-series.highcharts-area-series"
    ).wait_for(state="attached")
    assert drawdown_panel.locator(
        ".highcharts-series.highcharts-column-series"
    ).count() == 1
    drawdown_modes.get_by_role("button", name="Cumulative", exact=True).click()
    drawdown_panel.locator(
        ".highcharts-series.highcharts-area-series"
    ).wait_for(state="attached")
    assert outcome_panel.locator(
        ".highcharts-series.highcharts-area-series"
    ).count() == 1
    outcome_modes.get_by_role("button", name="Histogram", exact=True).click()
    outcome_panel.locator(
        ".highcharts-series.highcharts-column-series"
    ).wait_for(state="attached")
    assert drawdown_panel.locator(
        ".highcharts-series.highcharts-area-series"
    ).count() == 1
    drawdown_modes.get_by_role("button", name="Histogram", exact=True).click()
    drawdown_panel.locator(
        ".highcharts-series.highcharts-column-series"
    ).wait_for(state="attached")
    assert outcome_panel.locator(
        ".highcharts-series.highcharts-column-series"
    ).count() == 1

    resample = method.get_by_role("button", name="Resample", exact=True)
    visible_pending_start = page.evaluate(
        """
        () => {
          const panel = document.querySelector('#quant-backtest-panel');
          const resample = [...(panel?.querySelectorAll(
            '[role="group"][aria-label="Method"] button',
          ) ?? [])].find((candidate) => candidate.textContent?.trim() === 'Resample');
          if (!(panel instanceof HTMLElement) || !(resample instanceof HTMLButtonElement)) {
            throw new Error('Resample control is unavailable');
          }
          const records = [];
          let previous = '';
          const capture = () => {
            const status = panel.querySelector(
              '[data-simulation-run-status="pending"]',
            );
            if (!(status instanceof HTMLElement)) return null;
            const progress = status.querySelector('progress');
            const detail = status.querySelector('span')?.textContent?.trim() ?? '';
            const match = detail.match(/([0-9,]+) of ([0-9,]+) complete/);
            const record = {
              completedRuns: match ? Number(match[1].replaceAll(',', '')) : null,
              totalRuns: match ? Number(match[2].replaceAll(',', '')) : null,
              progressValue: progress instanceof HTMLProgressElement
                ? progress.value
                : null,
              progressMax: progress instanceof HTMLProgressElement
                ? progress.max
                : null,
              visible: status.getClientRects().length > 0
                && getComputedStyle(status).visibility !== 'hidden'
                && getComputedStyle(status).display !== 'none',
              exposed: status.closest('[inert], [aria-hidden="true"]') === null
                && panel.querySelector('.quant-backtest-simulation-settings') === null,
            };
            const signature = `${record.completedRuns}:${record.progressValue}`;
            if (signature !== previous) {
              previous = signature;
              records.push(record);
            }
            return record;
          };
          const observer = new MutationObserver(capture);
          observer.observe(panel, { childList: true, subtree: true });
          Object.defineProperty(window, '__quantVisibleSimulationPendingAudit', {
            configurable: true,
            value: {
              records,
              stop: () => {
                capture();
                observer.disconnect();
                return structuredClone(records);
              },
            },
          });
          resample.focus();
          resample.click();
          return capture();
        }
        """
    )
    assert visible_pending_start == {
        "completedRuns": 0,
        "totalRuns": 2500,
        "progressValue": 0,
        "progressMax": 1,
        "visible": True,
        "exposed": True,
    }, visible_pending_start
    expect(resample).to_have_attribute("aria-pressed", "true")
    page.wait_for_function(
        """
        () => window.__quantVisibleSimulationPendingAudit?.records?.some(
          (record) => record.completedRuns > 0,
        ) === true
        """,
        timeout=30_000,
    )
    page.wait_for_function(
        """
        () => window.__simulationFixture?.state?.().report?.simulation?.method
          === 'resample'
        """,
        timeout=30_000,
    )
    visible_pending_records = page.evaluate(
        "window.__quantVisibleSimulationPendingAudit.stop()"
    )
    assert len(visible_pending_records) >= 2, visible_pending_records
    assert all(
        record["visible"] is True
        and record["exposed"] is True
        and record["totalRuns"] == 2500
        for record in visible_pending_records
    ), visible_pending_records
    assert simulation.locator(
        "[data-simulation-run-status]"
    ).count() == 0
    assert (simulation.locator(
        ".quant-backtest-simulation-kpi > span"
    ).first.text_content() or "").strip() == "Probability of profit"

    # Simulation is a local projection of the settled ledger. None of these
    # controls may execute Pine again, re-subscribe the provider, or persist UI
    # state. Worker and WebSocket audits are installed before application boot.
    page.wait_for_timeout(300)
    runtime_audit = page.evaluate(
        """
        () => ({
          worker: window.__quantWorkerAudit?.summary?.(),
          websocket: window.__quantMockWebSocketAudit?.summary?.(),
        })
        """
    )
    rerun_kinds = {"prepare", "execute", "update", "notifyBars", "bars"}
    assert not rerun_kinds.intersection(
        runtime_audit["worker"]["byKind"]
    ), runtime_audit
    assert runtime_audit["worker"]["byKind"].get("run", 0) >= 2, runtime_audit
    assert runtime_audit["websocket"] == {
        "constructions": 0,
        "sends": 0,
        "closes": 0,
    }, runtime_audit
    assert len(market_requests) == provider_request_count, market_requests[
        provider_request_count:
    ]
    assert sum("/klines" in request for request in market_requests) == (
        provider_kline_count
    )

    storage_after = browser_storage_snapshot(page)
    assert_storage_unchanged(storage_before, storage_after)
    storage_audit_after = storage_audit_summary(page)
    for mutation_type in ("writes", "removes", "clears"):
        assert storage_audit_after[mutation_type]["count"] == (
            storage_audit_before[mutation_type]["count"]
        ), {
            "before": storage_audit_before,
            "after": storage_audit_after,
        }
    return {
        "worker": runtime_audit["worker"],
        "websocket": runtime_audit["websocket"],
        "providerRequests": len(market_requests) - provider_request_count,
        "storageBefore": storage_audit_before,
        "storageAfter": storage_audit_after,
    }


def verify_simulation_mobile_settings(
    page: Page,
    viewer,
) -> dict[str, object]:
    """Freeze the bottom drawer and cross-breakpoint focus contracts."""

    storage_before = browser_storage_snapshot(page)
    storage_audit_before = storage_audit_summary(page)
    page.evaluate(
        """
        () => {
          window.__quantWorkerAudit?.reset?.();
          window.__quantMockWebSocketAudit?.reset?.();
        }
        """
    )
    simulation = viewer.locator(".quant-backtest-simulation")
    simulation.wait_for(state="visible")
    desktop_trigger = simulation.locator(
        '[data-simulation-settings-trigger="desktop"]'
    )
    assert desktop_trigger.is_visible()
    desktop_trigger.click()
    dialog = simulation.locator(
        ".quant-backtest-simulation-settings-dialog"
    )
    dialog.wait_for(state="visible")
    page.wait_for_function(
        """
        () => document.activeElement === document.querySelector(
          '.quant-backtest-simulation-settings-dialog',
        )
        """
    )
    expect(desktop_trigger).to_have_attribute("aria-expanded", "true")

    # Open from the desktop trigger, cross the responsive breakpoint while
    # the modal stays open, then close into the now-visible mobile trigger.
    page.set_viewport_size({"width": 390, "height": 844})
    assert simulation.locator(
        ".quant-backtest-simulation-toolbar"
    ).is_hidden()
    mobile_trigger = simulation.locator(
        '[data-simulation-settings-trigger="mobile"]'
    )
    mobile_trigger.scroll_into_view_if_needed()
    assert mobile_trigger.is_visible()
    mobile_surface = simulation.evaluate(
        """
        (node) => {
          const trigger = node.querySelector(
            '[data-simulation-settings-trigger="mobile"]',
          );
          const triggerStyle = getComputedStyle(trigger);
          const triggerRect = trigger.getBoundingClientRect();
          return {
            viewportWidth: innerWidth,
            simulationPaddingBottom: parseFloat(getComputedStyle(node).paddingBottom),
            triggerDisplay: triggerStyle.display,
            triggerBottomInset: innerHeight - triggerRect.bottom,
          };
        }
        """
    )
    assert mobile_surface["viewportWidth"] == 390, mobile_surface
    assert mobile_surface["simulationPaddingBottom"] >= 60, mobile_surface
    assert mobile_surface["triggerDisplay"] == "flex", mobile_surface
    assert 15 <= mobile_surface["triggerBottomInset"] <= 17, mobile_surface
    drawer = simulation.evaluate(
        """
        (node) => {
          const overlay = node.querySelector(
            '.quant-backtest-simulation-settings',
          );
          const dialog = node.querySelector(
            '.quant-backtest-simulation-settings-dialog',
          );
          const body = node.querySelector(
            '.quant-backtest-simulation-settings-body',
          );
          const handle = node.querySelector(
            '.quant-backtest-simulation-settings-handle',
          );
          const controls = node.querySelector(
            '.quant-backtest-simulation-mobile-controls',
          );
          const description = node.querySelector(
            '.quant-backtest-simulation-settings-header p',
          );
          const rect = dialog.getBoundingClientRect();
          const style = getComputedStyle(dialog);
          return {
            overlayAlignItems: getComputedStyle(overlay).alignItems,
            left: rect.left,
            right: rect.right,
            bottomGap: innerHeight - rect.bottom,
            width: rect.width,
            maxHeight: rect.height,
            viewportHeight: innerHeight,
            borderTopLeftRadius: parseFloat(style.borderTopLeftRadius),
            borderBottomLeftRadius: parseFloat(style.borderBottomLeftRadius),
            bodyPaddingBottom: parseFloat(getComputedStyle(body).paddingBottom),
            handleDisplay: getComputedStyle(handle).display,
            mobileControlsDisplay: getComputedStyle(controls).display,
            descriptionDisplay: getComputedStyle(description).display,
          };
        }
        """
    )
    assert drawer["overlayAlignItems"] == "flex-end", drawer
    assert abs(drawer["left"]) <= 1, drawer
    assert abs(drawer["right"] - 390) <= 1, drawer
    assert abs(drawer["width"] - 390) <= 1, drawer
    assert abs(drawer["bottomGap"]) <= 1, drawer
    assert drawer["maxHeight"] <= drawer["viewportHeight"] * 0.88 + 1, drawer
    assert drawer["borderTopLeftRadius"] >= 15, drawer
    assert drawer["borderBottomLeftRadius"] == 0, drawer
    assert drawer["bodyPaddingBottom"] >= 16, drawer
    assert drawer["handleDisplay"] == "block", drawer
    assert drawer["mobileControlsDisplay"] == "flex", drawer
    assert drawer["descriptionDisplay"] == "none", drawer

    # Drawer controls intentionally reuse the desktop toolbar's logical focus
    # keys. Every Worker report replaces the panel subtree, so restoration must
    # choose the visible control inside the active dialog instead of the first
    # (hidden and inert) desktop duplicate.
    page.evaluate(
        """
        () => {
          const describeFocus = () => {
            const active = document.activeElement;
            const dialog = document.querySelector(
              '.quant-backtest-simulation-settings-dialog',
            );
            return {
              focusKey: active instanceof HTMLElement
                ? active.dataset.simulationFocus ?? null
                : null,
              inDialog: active instanceof HTMLElement
                && dialog?.contains(active) === true,
              inMobileControls: active instanceof HTMLElement
                && active.closest(
                  '.quant-backtest-simulation-mobile-controls',
                ) !== null,
              dialogFocused: active === dialog,
              blocked: active instanceof HTMLElement
                && active.closest(
                  '[hidden], [inert], [aria-hidden="true"]',
                ) !== null,
              visible: active instanceof HTMLElement
                && active.getClientRects().length > 0
                && getComputedStyle(active).display !== 'none'
                && getComputedStyle(active).visibility !== 'hidden',
            };
          };
          const start = (variationPercent) => {
            const panel = document.querySelector('#quant-backtest-panel');
            if (!(panel instanceof HTMLElement)) {
              throw new Error('Simulation panel is unavailable');
            }
            const records = [];
            let previous = '';
            const capture = () => {
              const status = panel.querySelector(
                '[data-simulation-run-status="pending"]',
              );
              if (!(status instanceof HTMLElement)) return null;
              const detail = status.querySelector('span')?.textContent?.trim() ?? '';
              const match = detail.match(/([0-9,]+) of ([0-9,]+) complete/);
              const progress = status.querySelector('progress');
              const record = {
                completedRuns: match
                  ? Number(match[1].replaceAll(',', ''))
                  : null,
                progressValue: progress instanceof HTMLProgressElement
                  ? progress.value
                  : null,
                ...describeFocus(),
              };
              const signature = `${record.completedRuns}:${record.progressValue}`;
              if (signature !== previous) {
                previous = signature;
                records.push(record);
              }
              return record;
            };
            const observer = new MutationObserver(capture);
            observer.observe(panel, { childList: true, subtree: true });
            const started = window.__simulationFixture?.rerunSimulation?.(
              variationPercent,
            ) === true;
            Object.defineProperty(window, '__quantSimulationFocusAudit', {
              configurable: true,
              value: {
                records,
                describeFocus,
                stop: () => {
                  capture();
                  observer.disconnect();
                  return structuredClone(records);
                },
              },
            });
            return { started, initial: capture() };
          };
          Object.defineProperty(window, '__startQuantSimulationFocusAudit', {
            configurable: true,
            value: start,
          });
        }
        """
    )
    mobile_method = dialog.locator(
        '.quant-backtest-simulation-mobile-controls '
        '[role="group"][aria-label="Method"]'
    )
    mobile_resample = mobile_method.get_by_role(
        "button", name="Resample", exact=True
    )
    mobile_resample.focus()
    mobile_focus_start = page.evaluate(
        "window.__startQuantSimulationFocusAudit(11)"
    )
    assert mobile_focus_start["started"] is True, mobile_focus_start
    assert mobile_focus_start["initial"] == {
        "completedRuns": 0,
        "progressValue": 0,
        "focusKey": "segment:Method:resample",
        "inDialog": True,
        "inMobileControls": True,
        "dialogFocused": False,
        "blocked": False,
        "visible": True,
    }, mobile_focus_start
    page.wait_for_function(
        """
        () => window.__quantSimulationFocusAudit?.records?.some(
          (record) => record.completedRuns > 0,
        ) === true
        """,
        timeout=30_000,
    )
    page.wait_for_function(
        """
        () => document.querySelector(
          '[data-simulation-run-status="pending"]',
        ) === null
        """,
        timeout=30_000,
    )
    mobile_focus_records = page.evaluate(
        "window.__quantSimulationFocusAudit.stop()"
    )
    assert len(mobile_focus_records) >= 2, mobile_focus_records
    assert all(
        record["focusKey"] == "segment:Method:resample"
        and record["inDialog"] is True
        and record["inMobileControls"] is True
        and record["dialogFocused"] is False
        and record["blocked"] is False
        and record["visible"] is True
        for record in mobile_focus_records
    ), mobile_focus_records

    # If the viewport widens while that Drawer control owns focus, its new
    # counterpart is hidden and the background toolbar remains inert. A redraw
    # must fall back to the dialog rather than leave focus on body/hidden UI.
    page.set_viewport_size({"width": 1440, "height": 900})
    assert mobile_resample.is_hidden()
    page.wait_for_function(
        """
        () => document.activeElement === document.querySelector(
          '.quant-backtest-simulation-settings-dialog',
        )
        """
    )
    desktop_focus_start = page.evaluate(
        "window.__startQuantSimulationFocusAudit(12)"
    )
    assert desktop_focus_start["started"] is True, desktop_focus_start
    assert desktop_focus_start["initial"] == {
        "completedRuns": 0,
        "progressValue": 0,
        "focusKey": None,
        "inDialog": True,
        "inMobileControls": False,
        "dialogFocused": True,
        "blocked": False,
        "visible": True,
    }, desktop_focus_start
    page.wait_for_function(
        """
        () => window.__quantSimulationFocusAudit?.records?.some(
          (record) => record.completedRuns > 0,
        ) === true
        """,
        timeout=30_000,
    )
    page.wait_for_function(
        """
        () => document.querySelector(
          '[data-simulation-run-status="pending"]',
        ) === null
        """,
        timeout=30_000,
    )
    desktop_focus_records = page.evaluate(
        "window.__quantSimulationFocusAudit.stop()"
    )
    assert len(desktop_focus_records) >= 2, desktop_focus_records
    assert all(
        record["focusKey"] is None
        and record["inDialog"] is True
        and record["inMobileControls"] is False
        and record["dialogFocused"] is True
        and record["blocked"] is False
        and record["visible"] is True
        for record in desktop_focus_records
    ), desktop_focus_records
    assert page.evaluate(
        "window.__simulationFixture.rerunSimulation(10)"
    ) is True
    page.wait_for_function(
        """
        () => window.__simulationFixture?.state?.().report?.simulation
          ?.variationPercent === 10
        """
    )
    page.set_viewport_size({"width": 390, "height": 844})

    close = dialog.locator(".quant-backtest-simulation-settings-close")
    close.focus()
    page.keyboard.press("Shift+Tab")
    assert dialog.evaluate("node => node.contains(document.activeElement)") is True
    assert page.evaluate(
        "document.activeElement?.classList.contains("
        "'quant-backtest-simulation-settings-close')"
    ) is False
    page.keyboard.press("Tab")
    assert page.evaluate(
        "document.activeElement?.classList.contains("
        "'quant-backtest-simulation-settings-close')"
    ) is True

    page.keyboard.press("Escape")
    simulation.locator(
        ".quant-backtest-simulation-settings"
    ).wait_for(state="detached")
    page.wait_for_function(
        """
        () => document.activeElement?.dataset.simulationSettingsTrigger === 'mobile'
        """
    )
    expect(mobile_trigger).to_have_attribute("aria-expanded", "false")

    # Exercise the inverse transition as well: a drawer opened on mobile must
    # return focus to the desktop trigger if the viewport widens before close.
    mobile_trigger.click()
    dialog.wait_for(state="visible")
    page.wait_for_function(
        """
        () => document.activeElement === document.querySelector(
          '.quant-backtest-simulation-settings-dialog',
        )
        """
    )
    expect(mobile_trigger).to_have_attribute("aria-expanded", "true")
    page.set_viewport_size({"width": 1440, "height": 900})
    assert desktop_trigger.is_visible()
    assert mobile_trigger.is_hidden()
    page.keyboard.press("Escape")
    simulation.locator(
        ".quant-backtest-simulation-settings"
    ).wait_for(state="detached")
    page.wait_for_function(
        """
        () => document.activeElement?.dataset.simulationSettingsTrigger === 'desktop'
        """
    )
    expect(desktop_trigger).to_have_attribute("aria-expanded", "false")

    runtime_audit = page.evaluate(
        """
        () => ({
          worker: window.__quantWorkerAudit?.summary?.(),
          websocket: window.__quantMockWebSocketAudit?.summary?.(),
        })
        """
    )
    rerun_kinds = {"prepare", "execute", "update", "notifyBars", "bars"}
    assert not rerun_kinds.intersection(
        runtime_audit["worker"]["byKind"]
    ), runtime_audit
    assert runtime_audit["worker"]["byKind"].get("run", 0) >= 2, runtime_audit
    assert runtime_audit["websocket"] == {
        "constructions": 0,
        "sends": 0,
        "closes": 0,
    }, runtime_audit
    storage_after = browser_storage_snapshot(page)
    assert_storage_unchanged(storage_before, storage_after)
    storage_audit_after = storage_audit_summary(page)
    for mutation_type in ("writes", "removes", "clears"):
        assert storage_audit_after[mutation_type]["count"] == (
            storage_audit_before[mutation_type]["count"]
        ), {
            "before": storage_audit_before,
            "after": storage_audit_after,
        }
    return {
        "surface": mobile_surface,
        "drawer": drawer,
        "focusFallback": {
            "workerMobileDuplicate": "mobile-control",
            "workerHiddenDuplicate": "dialog",
            "desktopToMobile": "mobile",
            "mobileToDesktop": "desktop",
        },
        "runtime": runtime_audit,
    }


def verify_simulation_empty_states(page: Page) -> dict[str, object]:
    """Render terminal and invalid-capital reports through the real shell."""

    page.evaluate(
        """
        async () => {
          const { mapSnapshot } = await import('/src/app/backtest-controller.ts');
          const { BacktestWorkbench } = await import(
            '/src/features/backtesting/backtest-workbench.ts'
          );
          const host = document.createElement('div');
          host.id = 'simulation-empty-state-fixture';
          Object.assign(host.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '10000',
            overflow: 'hidden',
            background: '#0f1115',
          });
          document.body.appendChild(host);

          const makeSnapshot = (kind) => {
            const indicatorId = `simulation-${kind}`;
            const key = { cellId: 'simulation-empty-cell', indicatorId };
            const closedTrade = {
              id: `${indicatorId}-closed`,
              side: 'long',
              qty: 1,
              entry: { id: `${indicatorId}-entry`, time: 1_000, price: 100 },
              exit: { id: `${indicatorId}-exit`, time: 2_000, price: 110 },
              entryBarIndex: 1,
              exitBarIndex: 2,
              open: false,
              pnl: 10,
              mae: 2,
              mfe: 12,
            };
            const openTrade = {
              ...closedTrade,
              id: `${indicatorId}-open`,
              exit: undefined,
              exitBarIndex: undefined,
              open: true,
              pnl: undefined,
            };
            const status = kind === 'no-closed'
              ? 'no-trades'
              : kind === 'open-only' ? 'open-only' : 'ready';
            const trades = kind === 'no-closed'
              ? []
              : kind === 'open-only' ? [openTrade] : [closedTrade];
            const initialCapital = kind === 'invalid-capital' ? 0 : 1_000;
            const strategy = {
              position: kind === 'open-only' ? 1 : 0,
              avgPrice: kind === 'open-only' ? 100 : 0,
              equity: initialCapital + (kind === 'invalid-capital' ? 10 : 0),
              openPnl: kind === 'open-only' ? 1 : 0,
              netPnl: kind === 'invalid-capital' ? 10 : 0,
              grossProfit: kind === 'invalid-capital' ? 10 : 0,
              grossLoss: 0,
              wins: kind === 'invalid-capital' ? 1 : 0,
              losses: 0,
              even: 0,
              maxDrawdown: 0,
              maxRunup: kind === 'invalid-capital' ? 10 : 0,
              initialCapital,
              accountCurrency: 'USD',
            };
            return {
              key,
              revision: 1,
              epoch: 0,
              runToken: `${indicatorId}:run`,
              status,
              finality: 'historical-final',
              ledgerState: 'ready',
              // The adapter contract requires the published ledger to carry
              // the revision it belongs to. Keep this synthetic fixture
              // aligned with real snapshots so no-trades maps correctly.
              ledgerRevision: 1,
              capabilities: {
                tradeLedger: true,
                exactEquityCurve: false,
                exactDrawdownCurve: false,
                riskRatios: false,
                benchmark: false,
                rawOrders: false,
                rawFills: false,
                barIndices: true,
                individualOpenPnl: false,
                executionPrecision: 'chart-ohlc',
              },
              visible: true,
              handle: {
                id: indicatorId,
                title: `Simulation ${kind}`,
                visible: true,
              },
              run: {
                id: indicatorId,
                title: `Simulation ${kind}`,
                kind: 'strategy',
                cause: 'history',
                first: true,
                bar: 2,
                time: 2_000,
                forming: false,
                complete: true,
                plots: {},
                vars: {},
                warnings: [],
              },
              context: {
                language: 'pine',
                phase: 'idle',
                barIndex: 2,
                meta: { title: `Simulation ${kind}`, overlay: true },
                plots: {},
                variables: {},
                strategy,
                trades,
                warnings: [],
              },
              trades,
              inputs: { schema: [], values: {} },
              props: { schema: [], values: {} },
              error: null,
              source: `strategy("Simulation ${kind}")`,
            };
          };

          let workbench = null;
          let report = null;
          Object.defineProperty(window, '__simulationEmptyStateFixture', {
            configurable: true,
            value: {
              show(kind) {
                workbench?.destroy();
                host.replaceChildren();
                report = mapSnapshot(makeSnapshot(kind), {
                  getMarket: () => ({
                    provider: 'binance',
                    symbol: 'BTCUSDT',
                    timeframe: '1h',
                    timezone: 'UTC',
                    currency: 'USD',
                  }),
                });
                workbench = new BacktestWorkbench(host, {
                  initialReport: report,
                });
                return {
                  status: report.status,
                  reason: report.simulationUnavailableReason ?? null,
                  simulation: report.simulation ?? null,
                };
              },
              destroy() {
                workbench?.destroy();
                workbench = null;
                report = null;
                host.remove();
              },
            },
          });
        }
        """
    )

    host = page.locator("#simulation-empty-state-fixture")
    cases = (
        (
            "no-closed",
            "no-trades",
            "no-closed-trades",
            "No closed trades to simulate.",
        ),
        (
            "open-only",
            "open-only",
            "no-closed-trades",
            "No closed trades to simulate.",
        ),
        (
            "invalid-capital",
            "ready",
            "invalid-initial-capital",
            "The simulation needs a starting capital to measure drawdowns against.",
        ),
    )
    audit: dict[str, object] = {}
    for kind, status, reason, message in cases:
        mapped = page.evaluate(
            "kind => window.__simulationEmptyStateFixture.show(kind)",
            kind,
        )
        assert mapped == {
            "status": status,
            "reason": reason,
            "simulation": None,
        }, {"kind": kind, "mapped": mapped}
        dock = host.locator(".quant-backtest-dock")
        dock.wait_for(state="visible")
        dock.locator('[aria-label="Open backtest viewer"]').click()
        viewer = host.locator(".quant-backtest-viewer")
        viewer.wait_for(state="visible")
        viewer.locator(".quant-backtest-tab", has_text="Simulation").click()
        state = viewer.locator("#quant-backtest-panel .quant-backtest-state")
        state.wait_for(state="visible")
        assert state.inner_text() == message
        assert viewer.locator(".quant-backtest-simulation-toolbar").count() == 0
        assert viewer.locator("[data-simulation-settings-trigger]").count() == 0
        audit[kind] = {
            "status": mapped["status"],
            "reason": mapped["reason"],
            "message": message,
        }

    page.evaluate("window.__simulationEmptyStateFixture.destroy()")
    assert host.count() == 0
    return audit


def verify_backtest_workspace(
    page: Page,
    market_requests: list[str],
) -> dict[str, object]:
    """Exercise the application-level backtest Dock/Viewer wiring.

    The strategy is one of the checked-in Built-ins, so this smoke does not
    depend on a remote script or on a live provider.  Market requests remain
    covered by ``install_mock_market_data`` in the surrounding regression.
    """
    visible_button(page, "Indicators").click()
    page.locator(".quant-indicator-dialog").wait_for(state="visible")
    page.locator('.quant-indicator-category[data-section="built-ins"]').click()

    strategy_row = page.locator(
        ".quant-indicator-row",
        has_text="SMA Cross (strategy)",
    )
    strategy_row.wait_for(state="visible")
    strategy_row.locator(".quant-indicator-main").click()

    dock = page.locator("#backtest-workbench .quant-backtest-dock")
    page.wait_for_function(
        """
        () => {
          const dock = document.querySelector('#backtest-workbench .quant-backtest-dock');
          return Boolean(dock && !dock.hidden);
        }
        """
    )
    assert dock.is_visible()
    assert dock.locator(".quant-backtest-dock-title").inner_text() == "SMA Cross"

    # Strategy settings are surfaced from the Dock and commit through the
    # public Vela handle.  Inputs are parsed from Pine and Properties remains
    # available only when the engine publishes declaration props.
    dock.locator('[aria-label="Open strategy settings"]').click()
    settings = page.locator(".quant-backtest-settings")
    settings.wait_for(state="visible")
    assert settings.locator('[role="tab"]', has_text="Inputs").get_attribute("aria-selected") == "true"
    fast_field = settings.locator(".quant-backtest-settings-field", has_text="Fast Length")
    assert fast_field.count() == 1
    fast_field.locator("input").fill("12")
    properties_tab = settings.locator('[role="tab"]', has_text="Properties")
    assert properties_tab.count() == 1
    properties_tab.click()
    assert settings.locator(".quant-backtest-settings-field", has_text="Initial capital").count() == 1
    settings.locator('[role="tab"]', has_text="Inputs").click()
    settings.locator(".quant-backtest-settings-actions .quant-backtest-button-primary").click()
    settings.wait_for(state="hidden")

    # Cancel must discard a draft, while Reset restores the Pine declaration
    # default in-place without submitting or closing the dialog.
    dock.locator('[aria-label="Open strategy settings"]').click()
    settings.wait_for(state="visible")
    settings.locator(".quant-backtest-settings-field", has_text="Fast Length").locator("input").fill("18")
    settings.locator(".quant-backtest-settings-actions .quant-backtest-button", has_text="Cancel").click()
    settings.wait_for(state="hidden")
    dock.locator('[aria-label="Open strategy settings"]').click()
    settings.wait_for(state="visible")
    assert settings.locator(".quant-backtest-settings-field", has_text="Fast Length").locator("input").input_value() == "12"
    settings.locator(".quant-backtest-settings-actions .quant-backtest-button", has_text="Cancel").click()
    settings.wait_for(state="hidden")
    dock.locator('[aria-label="Open strategy settings"]').click()
    settings.wait_for(state="visible")
    settings.locator(".quant-backtest-settings-actions .quant-backtest-button", has_text="Reset").click()
    # Reset defaults is draft-only in the reference dialog: it restores the
    # declaration values in place and does not submit or close the dialog.
    assert settings.is_visible()
    assert settings.locator(".quant-backtest-settings-field", has_text="Fast Length").locator("input").input_value() == "9"
    settings.locator(".quant-backtest-settings-actions .quant-backtest-button", has_text="Cancel").click()
    settings.wait_for(state="hidden")
    dock.locator('[aria-label="Open strategy settings"]').click()
    settings.wait_for(state="visible")
    assert settings.locator(".quant-backtest-settings-field", has_text="Fast Length").locator("input").input_value() == "12"
    settings.locator(".quant-backtest-settings-actions .quant-backtest-button", has_text="Cancel").click()
    settings.wait_for(state="hidden")

    # Backtest precision is a presentation of Pine's real
    # `use_bar_magnifier` strategy Property. It stays a local draft until Ok;
    # precision-only submission must issue exactly one Worker update rather
    # than redundantly replaying the unchanged Inputs tab first.
    dock.locator('[aria-label="Open strategy settings"]').click()
    settings.wait_for(state="visible")
    properties_tab = settings.locator('[role="tab"]', has_text="Properties")
    properties_tab.click()
    precision_field = settings.locator(
        '.quant-backtest-settings-field[data-setting-key="use_bar_magnifier"]'
    )
    precision_select = precision_field.locator("select")
    assert precision_field.locator(".quant-backtest-settings-label").inner_text() == "Backtest precision"
    assert precision_select.locator("option").all_text_contents() == [
        "Default precision",
        "High precision",
    ]
    assert precision_select.input_value() == "false"
    page.evaluate("window.__quantWorkerAudit?.reset?.()")
    precision_select.select_option("true")
    assert page.evaluate(
        "window.__quantWorkerAudit?.summary?.().byKind?.update ?? 0"
    ) == 0
    settings.locator(
        ".quant-backtest-settings-actions .quant-backtest-button",
        has_text="Cancel",
    ).click()
    settings.wait_for(state="hidden")
    assert page.evaluate(
        "window.__quantWorkerAudit?.summary?.().byKind?.update ?? 0"
    ) == 0

    dock.locator('[aria-label="Open strategy settings"]').click()
    settings.wait_for(state="visible")
    settings.locator('[role="tab"]', has_text="Properties").click()
    precision_select = settings.locator(
        '.quant-backtest-settings-field[data-setting-key="use_bar_magnifier"] select'
    )
    assert precision_select.input_value() == "false"
    page.evaluate("window.__quantWorkerAudit?.reset?.()")
    precision_select.select_option("true")
    settings.locator(
        ".quant-backtest-settings-actions .quant-backtest-button",
        has_text="Reset",
    ).click()
    assert precision_select.input_value() == "false"
    assert page.evaluate(
        "window.__quantWorkerAudit?.summary?.().byKind?.update ?? 0"
    ) == 0
    settings.locator(
        ".quant-backtest-settings-actions .quant-backtest-button",
        has_text="Cancel",
    ).click()
    settings.wait_for(state="hidden")

    # Start a clean precision-only draft after exercising Reset. Otherwise the
    # intentionally reset Inputs defaults would require a second public Vela
    # batch command as well.
    dock.locator('[aria-label="Open strategy settings"]').click()
    settings.wait_for(state="visible")
    settings.locator('[role="tab"]', has_text="Properties").click()
    precision_select = settings.locator(
        '.quant-backtest-settings-field[data-setting-key="use_bar_magnifier"] select'
    )
    precision_select.select_option("true")
    settings.locator(
        ".quant-backtest-settings-actions .quant-backtest-button-primary"
    ).click()
    settings.wait_for(state="hidden")
    page.wait_for_function(
        "(window.__quantWorkerAudit?.summary?.().byKind?.update ?? 0) === 1"
    )
    assert page.evaluate(
        "window.__quantWorkerAudit?.summary?.().byKind?.update ?? 0"
    ) == 1
    page.wait_for_function(
        "document.querySelector('.quant-backtest-dock-range')"
        "?.dataset.executionPrecision?.startsWith('LTF')"
    )

    # Reopening reads the applied Vela Property rather than a parallel UI
    # preference. Restore the default so the remainder of this regression
    # continues against its original chart-OHLC baseline.
    dock.locator('[aria-label="Open strategy settings"]').click()
    settings.wait_for(state="visible")
    settings.locator('[role="tab"]', has_text="Properties").click()
    precision_select = settings.locator(
        '.quant-backtest-settings-field[data-setting-key="use_bar_magnifier"] select'
    )
    assert precision_select.input_value() == "true"
    page.evaluate("window.__quantWorkerAudit?.reset?.()")
    precision_select.select_option("false")
    settings.locator(
        ".quant-backtest-settings-actions .quant-backtest-button-primary"
    ).click()
    settings.wait_for(state="hidden")
    page.wait_for_function(
        "(window.__quantWorkerAudit?.summary?.().byKind?.update ?? 0) === 1"
    )
    assert page.evaluate(
        "window.__quantWorkerAudit?.summary?.().byKind?.update ?? 0"
    ) == 1
    page.wait_for_function(
        "document.querySelector('.quant-backtest-dock-range')"
        "?.dataset.executionPrecision === 'OHLC'"
    )

    # The Viewer is a read-only projection of the already computed report.
    # Capture the pre-viewer storage state after the intentional strategy
    # settings commit, then assert that opening/switching/closing the Viewer
    # does not mutate scripts, editor state, favorites, templates, or session
    # state. The Vela workspace document is intentionally ignored because
    # chart strategy add/remove operations persist through that public key.
    page.wait_for_timeout(400)
    storage_before_viewer = browser_storage_snapshot(page)
    reset_storage_audit(page)

    geometry = page.evaluate(
        """
        () => {
          const cell = document.querySelector('.vela-cell');
          const dockEl = document.querySelector('#backtest-workbench .quant-backtest-dock');
          const bottom = document.querySelector('.vela-widget-bottombar');
          if (!cell || !dockEl || !bottom) return null;
          const cellRect = cell.getBoundingClientRect();
          const dockRect = dockEl.getBoundingClientRect();
          const bottomRect = bottom.getBoundingClientRect();
          return {
            cellBottom: cellRect.bottom,
            dockTop: dockRect.top,
            dockBottom: dockRect.bottom,
            bottomTop: bottomRect.top,
          };
        }
        """
    )
    assert geometry is not None
    assert geometry["cellBottom"] <= geometry["dockTop"] + 1
    assert geometry["dockBottom"] <= geometry["bottomTop"] + 1

    dock.locator('[aria-label="Open backtest viewer"]').click()
    viewer = page.locator("#backtest-workbench .quant-backtest-viewer")
    viewer.wait_for(state="visible")
    # Vela's own aria-hidden manager may run an asynchronous cleanup after the
    # Viewer callback. The application feature must re-assert the background
    # suppression rather than leaving the chart tabbable to screen readers.
    page.wait_for_function(
        "() => document.querySelector('.vela-ws-main')?.getAttribute('aria-hidden') === 'true'"
    )
    assert page.locator(".vela-ws-main").get_attribute("aria-hidden") == "true"
    assert page.locator(".vela-ws-main").evaluate("node => node.inert") is True
    tabs = viewer.locator(".quant-backtest-tab")
    assert tabs.count() == 4
    assert tabs.all_text_contents() == [
        "Performance",
        "Trades Analysis",
        "Trades Log",
        "Simulation",
    ], tabs.all_text_contents()

    # The browser-visible Performance curve must come from PineTS' real
    # per-bar strategy report series. This guards the complete worker -> Vela
    # context -> adapter -> controller -> Viewer path; a closed-trade-ledger
    # fallback would expose "realized-ledger" here instead.
    performance_panel = viewer.locator("#quant-backtest-panel")
    cumulative_pnl = performance_panel.locator(
        ".quant-backtest-chart-frame"
    ).filter(has_text="Cumulative P&L")
    cumulative_pnl.wait_for(state="visible")
    assert cumulative_pnl.count() == 1
    assert cumulative_pnl.locator(
        ".quant-backtest-chart-label"
    ).inner_text() == "Cumulative P&L"
    cumulative_pnl_source = cumulative_pnl.get_attribute(
        "data-cumulative-pnl-source"
    )
    assert cumulative_pnl_source == "realized-ledger", (
        "SMA Cross Performance curve did not use trade-aligned cumulative P&L: "
        f"source={cumulative_pnl_source!r}"
    )

    # The local Highcharts core does not include its optional accessibility
    # module.  The renderer must therefore repair the generated SVG label
    # instead of leaving Highcharts' default empty aria-label in the DOM.
    chart_a11y = page.locator(
        "#backtest-workbench .quant-backtest-chart-host svg.highcharts-root"
    )
    # A no-trade/empty report legitimately keeps the SVG fallback without a
    # Highcharts root. Whenever the local chunk does upgrade a chart, verify
    # every generated root rather than making empty-state rendering fail.
    if chart_a11y.count() > 0:
        for index in range(chart_a11y.count()):
            svg = chart_a11y.nth(index)
            assert (svg.get_attribute("aria-label") or "").strip()
            assert svg.locator("desc[data-quant-report-description]").count() == 1
    # Reference Viewer keeps settings in the chart Dock; it does not duplicate
    # the action in the report header.
    assert viewer.locator('[aria-label="Open strategy settings"]').count() == 0
    for tab_name, panel_id in (
        ("Performance", "performance"),
        ("Trades Analysis", "analysis"),
        ("Trades Log", "log"),
        ("Simulation", "simulation"),
    ):
        tabs.filter(has_text=tab_name).click()
        selected = tabs.filter(has_text=tab_name)
        assert selected.get_attribute("aria-selected") == "true"
        assert selected.get_attribute("id") == f"quant-backtest-tab-{panel_id}"
        assert selected.get_attribute("aria-controls") == "quant-backtest-panel"
        panel = viewer.locator("#quant-backtest-panel")
        assert panel.count() == 1
        assert panel.get_attribute("aria-labelledby") == f"quant-backtest-tab-{panel_id}"

    # Trades Analysis is a fixed reference surface rather than a collection
    # of generic cards: freeze both table populations/order, the three chart
    # upgrades, donut categories and the chart teardown/re-entry lifecycle.
    tabs.filter(has_text="Trades Analysis").click()
    analysis_page = viewer.locator(".quant-backtest-analysis")
    analysis_page.wait_for(state="visible")
    assert analysis_page.locator(".quant-backtest-analysis-empty").count() == 0
    assert analysis_page.locator(
        ".quant-backtest-analysis-chart-title"
    ).all_text_contents() == [
        "P&L Distribution (USD)",
        "Winrate",
        "Duration vs P&L (USD)",
    ]
    analysis_tables = analysis_page.locator(".quant-backtest-analysis-table")
    assert analysis_tables.count() == 2
    assert analysis_tables.nth(0).locator("thead th").all_text_contents() == [
        "Metric", "All", "Long", "Short",
    ]
    assert analysis_tables.nth(0).locator("tbody th").all_text_contents() == [
        "Closed Trades",
        "Winning Trades",
        "Losing Trades",
        "Breakeven Trades",
        "Win Rate",
        "Avg P&L",
        "Avg Winning Trade",
        "Avg Losing Trade",
        "Largest Winning Trade",
        "Largest Losing Trade",
    ]
    assert analysis_tables.nth(0).locator("tbody tr").count() == 10
    assert analysis_tables.nth(1).locator("thead th").all_text_contents() == [
        "Metric", "All", "Long", "Short",
    ]
    assert analysis_tables.nth(1).locator("tbody th").all_text_contents() == [
        "Avg Trade Duration (bars)",
        "Avg Winning Trade Duration (bars)",
        "Avg Losing Trade Duration (bars)",
        "Avg Trades per Day",
        "Avg Trades per Week",
        "Longest Trade (bars)",
        "Shortest Trade (bars)",
        "Longest Winning Streak (bars)",
        "Longest Losing Streak (bars)",
    ]
    assert analysis_tables.nth(1).locator("tbody tr").count() == 9
    # A settings commit immediately before opening the Viewer can publish a
    # short updating snapshot while the strategy reruns. Wait for the
    # canonical closed-ledger projection before asserting the donut legend;
    # asserting the empty transient DOM made this regression intermittently
    # depend on Pine execution timing.
    page.wait_for_function(
        """() => {
          const labels = [...document.querySelectorAll(
            '#backtest-workbench .quant-backtest-analysis-winrate-legend-item small',
          )].map((node) => node.textContent?.trim() ?? '');
          return labels.length >= 2;
        }"""
    )
    donut_labels = analysis_page.locator(
        ".quant-backtest-analysis-winrate-legend-item small"
    ).all_text_contents()
    assert donut_labels[0:2] == ["winners", "losers"], donut_labels
    assert set(donut_labels).issubset({"winners", "losers", "breakevens"})
    assert "Current" not in analysis_page.inner_text()

    analysis_hosts = analysis_page.locator(
        ".quant-backtest-analysis-chart-host[data-quant-report-chart]"
    )
    assert analysis_hosts.count() == 3
    try:
        page.wait_for_function(
            """
            () => document.querySelectorAll(
              '#backtest-workbench .quant-backtest-analysis-chart-host '
              + 'svg.highcharts-root',
            ).length === 3
            """
        )
    except Exception as error:
        analysis_runtime = page.evaluate(
            """
            () => ({
              viewerHidden: document.querySelector(
                '#backtest-workbench .quant-backtest-viewer',
              )?.hidden ?? null,
              activeTab: document.querySelector(
                '#backtest-workbench .quant-backtest-tab[aria-selected="true"]',
              )?.textContent?.trim() ?? null,
              analysisHosts: document.querySelectorAll(
                '#backtest-workbench .quant-backtest-analysis-chart-host',
              ).length,
              highchartsRoots: document.querySelectorAll(
                '#backtest-workbench .quant-backtest-analysis-chart-host '
                + 'svg.highcharts-root',
              ).length,
              fallbacks: document.querySelectorAll(
                '#backtest-workbench .quant-backtest-analysis-fallback-chart',
              ).length,
              panelText: document.querySelector(
                '#backtest-workbench #quant-backtest-panel',
              )?.textContent?.trim().slice(0, 200) ?? null,
            })
            """
        )
        raise AssertionError(
            f"Trades Analysis charts did not upgrade: {analysis_runtime}"
        ) from error
    for index in range(analysis_hosts.count()):
        host = analysis_hosts.nth(index)
        assert host.get_attribute("role") == "img"
        assert (host.get_attribute("aria-label") or "").strip()
        root = host.locator("svg.highcharts-root")
        assert root.count() == 1
        assert (root.get_attribute("aria-label") or "").strip()
        assert root.locator("desc[data-quant-report-description]").count() == 1
    analysis_series = analysis_page.evaluate(
        """
        (node) => Object.fromEntries([
          ['distribution', '.quant-backtest-analysis-distribution-host'],
          ['donut', '.quant-backtest-analysis-donut-host'],
          ['duration', '.quant-backtest-analysis-duration-host'],
        ].map(([key, selector]) => [key, [
          ...node.querySelectorAll(`${selector} .highcharts-series`),
        ].map((series) => series.getAttribute('class') ?? '')]))
        """
    )
    assert any(
        "highcharts-column-series" in value
        for value in analysis_series["distribution"]
    ), analysis_series
    assert any(
        "highcharts-pie-series" in value
        for value in analysis_series["donut"]
    ), analysis_series
    assert sum(
        "highcharts-scatter-series" in value
        for value in analysis_series["duration"]
    ) == 1, analysis_series
    assert sum(
        "highcharts-line-series" in value
        for value in analysis_series["duration"]
    ) == 1, analysis_series
    page.evaluate(
        """
        window.__quantAnalysisChartHosts = [...document.querySelectorAll(
          '#backtest-workbench .quant-backtest-analysis-chart-host',
        )];
        """
    )
    tabs.filter(has_text="Performance").click()
    assert page.evaluate(
        "window.__quantAnalysisChartHosts.every((host) => !host.isConnected)"
    ) is True
    assert viewer.locator(".quant-backtest-analysis-chart-host").count() == 0
    tabs.filter(has_text="Trades Analysis").click()
    page.wait_for_function(
        """
        () => document.querySelectorAll(
          '#backtest-workbench .quant-backtest-analysis-chart-host '
          + 'svg.highcharts-root',
        ).length === 3
        """
    )
    assert viewer.locator(
        ".quant-backtest-analysis-chart-host[data-quant-report-chart]"
    ).count() == 3

    # Trades Log view modes are icon-only ARIA tabs. When the strategy has a
    # realized ledger, exercise the monthly calendar navigation and summary
    # surface without assuming a particular provider's trade count.
    tabs.filter(has_text="Trades Log").click()
    view_tabs_selector = (
        '[role="tablist"][aria-label="Trades Log view mode"] [role="tab"]'
    )
    view_tabs = viewer.locator(view_tabs_selector)
    # The view-mode buttons are mounted after the report tab transition.  A
    # fixed sleep made the production preview occasionally observe the outgoing
    # empty tablist and fail even though the next render was correct.  Wait on
    # the DOM contract instead of wall-clock time so slow CI and fast local
    # runs share the same deterministic gate.
    page.wait_for_function(
        """selector => document.querySelectorAll(selector).length === 2""",
        arg=view_tabs_selector,
    )
    assert view_tabs.count() == 2
    if view_tabs.count() == 2:
        assert viewer.locator(
            f'{view_tabs_selector}[aria-selected="true"]'
        ).count() == 1

        # The list projection follows the reference table contract: its
        # always-present columns keep their exact order, optional Size and
        # MFE/MAE columns stay grouped, and a newly selected sort starts in
        # descending order.  These assertions exercise the rendered DOM so
        # source-only contract tests cannot hide a wiring or CSS regression.
        trade_table = viewer.locator(".quant-backtest-trade-table")
        assert trade_table.count() == 1
        headers = [
            value.strip()
            for value in trade_table.locator("thead th").all_text_contents()
        ]
        # A live report can replace the table between the view-mode click and
        # the first DOM read.  Wait for the complete sortable header row before
        # comparing the snapshot; otherwise one read can observe the outgoing
        # table while the next observes the incoming table and produce a
        # timing-only failure.
        page.wait_for_function(
            """() => {
              const table = document.querySelector('.quant-backtest-trade-table');
              if (!table) return false;
              const headers = table.querySelectorAll('thead th');
              const buttons = table.querySelectorAll('thead button');
              return headers.length > 0 && buttons.length === headers.length;
            }"""
        )
        headers = [
            value.strip()
            for value in trade_table.locator("thead th").all_text_contents()
        ]
        assert headers[0:3] == ["Trade #", "Entry", "Exit"], headers
        assert headers[-1] == "Cumulative P&L", headers
        expected_headers = ["Trade #", "Entry", "Exit"]
        if "Size" in headers:
            expected_headers.append("Size")
        expected_headers.append("Net P&L")
        if "MFE" in headers or "MAE" in headers:
            assert "MFE" in headers and "MAE" in headers, headers
            expected_headers.extend(["MFE", "MAE"])
        expected_headers.append("Cumulative P&L")
        assert headers == expected_headers, headers
        assert trade_table.locator("thead button").count() == len(headers)
        assert trade_table.locator("thead th").first.get_attribute("aria-sort") == "descending"

        entry_sort = trade_table.locator("thead button", has_text="Entry")
        entry_sort.click()
        assert trade_table.locator("thead th").nth(1).get_attribute("aria-sort") == "descending"
        entry_sort.click()
        assert trade_table.locator("thead th").nth(1).get_attribute("aria-sort") == "ascending"
        trade_table.locator("thead button", has_text="Trade #").click()
        assert trade_table.locator("thead th").first.get_attribute("aria-sort") == "descending"

        trade_numbers = trade_table.locator(".quant-backtest-trade-number-value")
        assert trade_numbers.count() > 0
        if trade_numbers.count() > 0:
            numeric_trade_numbers = [
                float(value.strip()) for value in trade_numbers.all_text_contents()
            ]
            assert all(value.is_integer() for value in numeric_trade_numbers)
            assert len(set(numeric_trade_numbers)) == len(numeric_trade_numbers)
            assert numeric_trade_numbers == sorted(numeric_trade_numbers, reverse=True)

            # A live report revision replaces the tbody as one DOM subtree.
            # Wait for a complete row shape before taking any child locators;
            # otherwise a locator can observe the number from the old row and
            # the badge/times from the brief replacement gap.
            page.wait_for_function(
                """() => {
                  const row = document.querySelector('.quant-backtest-trade-table tbody tr');
                  return Boolean(row
                    && row.querySelector('.quant-backtest-trade-number-value')
                    && row.querySelector('.quant-backtest-direction-badge')
                    && row.querySelectorAll('td.quant-backtest-trade-time').length === 2
                    && row.querySelectorAll('.quant-backtest-trade-datetime').length === 2
                    && row.querySelectorAll('.quant-backtest-trade-price').length === 2
                    && row.querySelector('td.quant-backtest-trade-time button[aria-label="Show entry on chart"] svg'));
                }"""
            )
            first_row = trade_table.locator("tbody tr").first
            badge = first_row.locator(".quant-backtest-direction-badge")
            expect(badge).to_have_count(1)
            assert badge.inner_text() in ("long", "short")
            time_cells = first_row.locator("td.quant-backtest-trade-time")
            # Live Vela revisions replace the complete table subtree. Wait for
            # the newly rendered row instead of sampling between detach and
            # replacement and reporting a false structural regression.
            expect(time_cells).to_have_count(2)
            entry_cell = time_cells.nth(0)
            assert entry_cell.locator(".quant-backtest-trade-datetime").count() == 1
            entry_price = entry_cell.locator(".quant-backtest-trade-price").inner_text().strip()
            entry_amount, entry_currency = entry_price.rsplit(" ", 1)
            assert entry_currency == "USD", entry_price
            assert "," in entry_amount and "." in entry_amount, entry_price
            assert len(entry_amount.rsplit(".", 1)[1]) == 2, entry_price
            entry_locator = entry_cell.locator(
                'button[aria-label="Show entry on chart"]'
            )
            expect(entry_locator).to_have_count(1)
            assert entry_locator.inner_text().strip() == ""
            expect(entry_locator.locator("svg")).to_have_count(1)

            exit_cell = time_cells.nth(1)
            exit_price = exit_cell.locator(".quant-backtest-trade-price").inner_text().strip()
            exit_amount, exit_currency = exit_price.rsplit(" ", 1)
            assert exit_currency == "USD", exit_price
            if exit_amount != "N/A":
                assert "," in exit_amount and "." in exit_amount, exit_price
                assert len(exit_amount.rsplit(".", 1)[1]) == 2, exit_price
            if exit_price.startswith("N/A "):
                assert exit_cell.locator(
                    'button[aria-label="Show exit on chart"]'
                ).count() == 0

        # Sorting and live strategy revisions replace the table subtree. Base
        # the optional-column assertion on the current header, not the stale
        # text snapshot captured before the sort interactions above.
        excursion_header = trade_table.locator("thead").evaluate(
            """head => {
              const labels = [...head.querySelectorAll('th')]
                .map((cell) => cell.textContent?.trim() ?? '');
              const snapshot = (title) => {
                const span = head.querySelector(`span[title="${title}"]`);
                const control = head.querySelector(`button[title="${title}"]`);
                return {
                  spanCount: span ? 1 : 0,
                  ariaLabel: control?.getAttribute('aria-label') ?? null,
                };
              };
              return {
                labels,
                mfe: snapshot('Maximum favorable excursion'),
                mae: snapshot('Maximum adverse excursion'),
              };
            }"""
        )
        if "MFE" in excursion_header["labels"]:
            assert excursion_header["mfe"] == {
                "spanCount": 1,
                "ariaLabel": "MFE: Maximum favorable excursion",
            }, excursion_header
            assert excursion_header["mae"] == {
                "spanCount": 1,
                "ariaLabel": "MAE: Maximum adverse excursion",
            }, excursion_header

        calendar_view = viewer.locator(
            f'{view_tabs_selector}[aria-label="Calendar view"]'
        )
        calendar_view.click()
        assert calendar_view.get_attribute("aria-controls") == (
            "quant-backtest-trades-view-panel"
        )
        assert page.evaluate("document.activeElement?.getAttribute('aria-label')") == (
            "Calendar view"
        )
        # A live revision may briefly replace the result with its updating
        # state between the click and this assertion. The selected view must
        # survive that revision and return a single calendar when it settles.
        expect(calendar_view).to_have_attribute("aria-selected", "true")
        expect(viewer.locator(".quant-backtest-calendar")).to_have_count(1)
        if viewer.locator(".quant-backtest-calendar").count() == 1:
            calendar = viewer.locator(".quant-backtest-calendar")
            page.wait_for_function(
                """
                () => ['Previous month', 'Next month', 'Move to current month']
                  .every((label) => document.querySelectorAll(
                    `.quant-backtest-calendar [aria-label="${label}"]`,
                  ).length === 1)
                """
            )
            navigation_counts = calendar.evaluate(
                """
                (node) => Object.fromEntries(
                  ['Previous month', 'Next month', 'Move to current month']
                    .map((label) => [
                      label,
                      node.querySelectorAll(`[aria-label="${label}"]`).length,
                    ]),
                )
                """
            )
            assert navigation_counts == {
                "Previous month": 1,
                "Next month": 1,
                "Move to current month": 1,
            }, navigation_counts
            page.wait_for_function(
                """() => JSON.stringify(
                  [...document.querySelectorAll('.quant-backtest-calendar-weekday')]
                    .map((node) => node.textContent?.trim()),
                ) === JSON.stringify(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])"""
            )
            assert calendar.locator(".quant-backtest-calendar-weekday").all_text_contents() == [
                "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"
            ]
            initial_month = calendar.locator(
                ".quant-backtest-calendar-heading strong"
            ).inner_text()
            expected_current_month = page.evaluate(
                "new Date().toLocaleDateString('en-US', "
                "{ month: 'long', year: 'numeric' })"
            )
            assert initial_month == expected_current_month
            calendar.locator('[aria-label="Previous month"]').click()
            previous_month = calendar.locator(
                ".quant-backtest-calendar-heading strong"
            ).inner_text()
            assert previous_month != initial_month
            assert page.evaluate("document.activeElement?.getAttribute('aria-label')") == (
                "Previous month"
            )
            calendar.locator('[aria-label="Move to current month"]').click()
            assert calendar.locator(
                ".quant-backtest-calendar-heading strong"
            ).inner_text() == initial_month
            assert page.evaluate("document.activeElement?.getAttribute('aria-label')") == (
                "Move to current month"
            )
            calendar.locator('[aria-label="Next month"]').click()
            assert calendar.locator(
                ".quant-backtest-calendar-heading strong"
            ).inner_text() != initial_month
            assert page.evaluate("document.activeElement?.getAttribute('aria-label')") == (
                "Next month"
            )
            calendar.locator('[aria-label="Move to current month"]').click()
            assert calendar.locator(
                ".quant-backtest-calendar-heading strong"
            ).inner_text() == initial_month

            active_days = calendar.locator(
                ".quant-backtest-calendar-day.is-profit, "
                ".quant-backtest-calendar-day.is-loss, "
                ".quant-backtest-calendar-day.is-flat"
            )
            active_days.first.wait_for(state="visible")
            calendar_snapshot = calendar.evaluate(
                """
                (node) => {
                  const all = (selector) => [...node.querySelectorAll(selector)];
                  const text = (selector) => node.querySelector(selector)?.textContent?.trim() ?? null;
                  const amount = (summary) => text(
                    `[data-calendar-summary="${summary}"] .quant-backtest-calendar-amount`,
                  );
                  const days = all(
                    '.quant-backtest-calendar-day[role="gridcell"]:not(.is-padding)',
                  );
                  const active = all(
                    '.quant-backtest-calendar-day.is-profit, '
                    + '.quant-backtest-calendar-day.is-loss, '
                    + '.quant-backtest-calendar-day.is-flat',
                  ).map((day) => ({
                    amount: day.querySelector(
                      '.quant-backtest-calendar-day-pnl .quant-backtest-calendar-amount',
                    )?.textContent?.trim() ?? null,
                    metadata: [...day.querySelectorAll('.quant-backtest-calendar-day-meta')]
                      .map((item) => item.textContent?.trim() ?? ''),
                  }));
                  return {
                    weekdays: all('.quant-backtest-calendar-weekday')
                      .map((item) => item.textContent?.trim() ?? ''),
                    dayCount: days.length,
                    timeCount: days.reduce(
                      (count, day) => count + day.querySelectorAll('time').length,
                      0,
                    ),
                    rowCount: all('[role="row"]').length,
                    active,
                    summaryLabels: all('.quant-backtest-calendar-summary-label')
                      .map((item) => item.textContent?.trim() ?? ''),
                    summaryCount: all('.quant-backtest-calendar-summary-item').length,
                    monthNetText: text('[data-calendar-summary="net-pnl"]'),
                    monthNet: amount('net-pnl'),
                    bestDay: amount('best-day'),
                    worstDay: amount('worst-day'),
                    averageTrades: text(
                      '[data-calendar-summary="average-trades"] '
                      + '.quant-backtest-calendar-summary-average',
                    ),
                  };
                }
                """
            )
            assert calendar_snapshot["weekdays"] == [
                "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"
            ]
            assert 28 <= calendar_snapshot["dayCount"] <= 31
            assert calendar_snapshot["timeCount"] == calendar_snapshot["dayCount"]
            assert calendar_snapshot["rowCount"] >= 5
            assert calendar_snapshot["active"]
            day_pnls: list[float] = []
            day_trade_counts: list[int] = []
            for active_day in calendar_snapshot["active"]:
                assert active_day["amount"] is not None
                day_pnls.append(float(active_day["amount"].replace(",", "")))
                metadata = active_day["metadata"]
                assert len(metadata) == 2
                day_trade_counts.append(int(metadata[0].split()[0]))
                win_rate_text = metadata[1].split("%", 1)[0]
                assert win_rate_text.isdigit(), metadata[1]
                win_rate = int(win_rate_text)
                assert 0 <= win_rate <= 100
            assert calendar_snapshot["summaryCount"] == 4
            assert calendar_snapshot["summaryLabels"] == [
                "Month Net P&L",
                "Best Day",
                "Worst Day",
                "Avg Trades per Day",
            ]
            assert "USD" in calendar_snapshot["monthNetText"]
            month_net = float(calendar_snapshot["monthNet"].replace(",", ""))
            assert abs(month_net - sum(day_pnls)) <= 0.2
            best_day = float(calendar_snapshot["bestDay"].replace(",", ""))
            worst_day = float(calendar_snapshot["worstDay"].replace(",", ""))
            assert abs(best_day - max(day_pnls)) <= 0.01
            assert abs(worst_day - min(day_pnls)) <= 0.01
            average_trades_value = float(
                calendar_snapshot["averageTrades"].replace(",", "")
            )
            assert abs(
                average_trades_value
                - (sum(day_trade_counts) / len(day_trade_counts))
            ) <= 0.01
            overflow_probes: dict[int, dict[str, int] | None] = {}
            for viewport_width in (1025, 1024, 901, 900, 768, 767, 700, 641, 640):
                page.set_viewport_size({"width": viewport_width, "height": 900})
                calendar.locator(
                    ".quant-backtest-calendar-day-pnl "
                    ".quant-backtest-calendar-amount"
                ).first.wait_for(state="visible")
                overflow_probes[viewport_width] = calendar.evaluate(
                    """
                    (node) => {
                      const amount = node.querySelector(
                        '.quant-backtest-calendar-day-pnl '
                        + '.quant-backtest-calendar-amount',
                      );
                      if (!amount) return null;
                      const original = amount.textContent;
                      amount.textContent = '+999,999.99';
                      const cell = amount.closest('.quant-backtest-calendar-day');
                      const result = cell
                        ? {
                            clientWidth: cell.clientWidth,
                            scrollWidth: cell.scrollWidth,
                          }
                        : null;
                      amount.textContent = original;
                      return result;
                    }
                    """
                )
            page.set_viewport_size({"width": 1440, "height": 900})
            for viewport_width, overflow_probe in overflow_probes.items():
                assert overflow_probe is not None, viewport_width
                assert (
                    overflow_probe["scrollWidth"]
                    <= overflow_probe["clientWidth"]
                ), (viewport_width, overflow_probe)

    viewer.locator(".quant-backtest-viewer-back").click()
    viewer.wait_for(state="hidden")
    assert dock.is_visible()
    assert page.locator(".vela-ws-main").get_attribute("aria-hidden") is None
    assert page.locator(".vela-ws-main").evaluate("node => node.inert") is False

    page.wait_for_timeout(400)
    storage_after_viewer = browser_storage_snapshot(page)
    assert_storage_unchanged(
        storage_before_viewer,
        storage_after_viewer,
        ignored_keys={WORKSPACE_STORAGE_KEY},
    )
    viewer_storage_audit = storage_audit_summary(page)
    assert viewer_storage_audit.get("clears", {}).get("count", 0) == 0, (
        "Viewer unexpectedly cleared browser storage: "
        f"audit={viewer_storage_audit}"
    )
    non_workspace_mutations = []
    for mutation_type in ("writes", "removes", "clears"):
        entries = viewer_storage_audit.get(mutation_type, {})
        for key in entries.get("keys", []):
            if key != WORKSPACE_STORAGE_KEY:
                non_workspace_mutations.append(f"{mutation_type}:{key}")
    assert not non_workspace_mutations, (
        "Viewer touched non-workspace storage keys: "
        f"{non_workspace_mutations}; audit={viewer_storage_audit}"
    )

    # Remove the strategy through the same Indicators surface a user would
    # use.  The result report and Dock must be removed with the chart handle.
    visible_button(page, "Indicators").click()
    page.locator('.quant-indicator-category[data-section="on-chart"]').click()
    on_chart_strategy = page.locator(".quant-indicator-row", has_text="SMA Cross")
    on_chart_strategy.wait_for(state="visible")
    on_chart_strategy.locator(
        '.quant-indicator-action[title="Remove from chart"]'
    ).click()
    page.wait_for_function(
        """
        () => {
          const dock = document.querySelector('#backtest-workbench .quant-backtest-dock');
          return Boolean(dock && dock.hidden);
        }
        """
    )
    assert dock.is_hidden()
    page.keyboard.press("Escape")
    page.locator(".quant-indicator-dialog").wait_for(state="hidden")

    return {
        "storageBeforeViewer": {
            "localKeys": sorted(storage_before_viewer.get("local", {})),
            "sessionKeys": sorted(storage_before_viewer.get("session", {})),
        },
        "storageAfterViewer": {
            "localKeys": sorted(storage_after_viewer.get("local", {})),
            "sessionKeys": sorted(storage_after_viewer.get("session", {})),
        },
        "viewerStorageAudit": viewer_storage_audit,
    }


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
    luxalgo_requests: list[str] = []
    blocked_requests: list[str] = []
    errors: list[str] = []
    install_fixed_clock(context)
    install_offline_guard(context, blocked_requests)
    install_mock_market_data(context, requests)
    install_storage_audit(context)
    install_luxalgo_request_audit(context, luxalgo_requests)
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
    assert not blocked_requests, f"legacy fixture made non-local requests: {blocked_requests}"
    assert_no_luxalgo_requests(luxalgo_requests, "legacy fixture")
    assert not errors, errors
    context.close()


def verify_g3a_workbench_fixture(browser) -> None:
    """Exercise the focus and ARIA paths that do not require a live Vela run."""
    # The reference keeps the Dock at the desktop breakpoint and replaces it
    # with a compact Backtest entry at <=1023px.  Keep the detailed Dock,
    # resize and focus assertions on a desktop viewport, then exercise the
    # compact entry explicitly at the end of this fixture.
    context = browser.new_context(viewport={"width": 1440, "height": 600})
    page = context.new_page()
    errors: list[str] = []
    observe_page_errors(page, errors, "G3a fixture ")
    response = page.goto(G3A_FIXTURE_URL, wait_until="domcontentloaded", timeout=30_000)
    assert response is not None and response.status == 200
    page.wait_for_function("Boolean(window.__g3aFixture)")

    dock = page.locator("#quant-backtest-dock")
    dock.wait_for(state="visible")
    separator = dock.locator('[role="separator"]')
    collapse = dock.locator('[aria-controls="quant-backtest-dock-content"]')
    assert separator.get_attribute("aria-controls") == "quant-backtest-dock"
    assert collapse.get_attribute("aria-expanded") == "true"
    assert page.locator("#quant-backtest-dock-content").count() == 1

    collapse.click()
    page.wait_for_function(
        "(() => { const dock = document.querySelector('#quant-backtest-dock');"
        " const control = document.querySelector("
        "'[aria-controls=\"quant-backtest-dock-content\"]');"
        " const separator = document.querySelector("
        "'[aria-label=\"Resize backtest summary\"]');"
        " return dock.getBoundingClientRect().height <= 29"
        " && control.getAttribute('aria-expanded') === 'false'"
        " && separator.tabIndex === -1"
        " && separator.getAttribute('aria-hidden') === 'true'"
        " && separator.getAttribute('aria-disabled') === 'true'; })()"
    )
    collapsed_height = separator.get_attribute("aria-valuenow")
    # A hidden separator must not react to synthetic keyboard/pointer input;
    # the expanded height is retained for the next explicit Expand action.
    page.evaluate(
        "document.querySelector('[aria-label=\"Resize backtest summary\"]')"
        ".dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))"
    )
    assert separator.get_attribute("aria-valuenow") == collapsed_height
    separator.dispatch_event("pointerdown", {"button": 0, "clientY": 300, "pointerId": 7})
    assert separator.get_attribute("aria-valuenow") == collapsed_height
    collapse.click()
    page.wait_for_function(
        "(() => { const dock = document.querySelector('#quant-backtest-dock');"
        " const control = document.querySelector("
        "'[aria-controls=\"quant-backtest-dock-content\"]');"
        " const separator = document.querySelector("
        "'[aria-label=\"Resize backtest summary\"]');"
        " return dock.getBoundingClientRect().height >= 279"
        " && control.getAttribute('aria-expanded') === 'true'"
        " && separator.tabIndex === 0"
        " && !separator.hasAttribute('aria-hidden')"
        " && !separator.hasAttribute('aria-disabled'); })()"
    )

    # Any future interactive chart/tooltip control rendered in the Dock body
    # must not retain focus after the body is hidden by Collapse.  Make the
    # current body temporarily focusable to exercise that lifecycle directly.
    page.evaluate(
        "(() => { const body = document.querySelector('#quant-backtest-dock-content');"
        " body.tabIndex = 0; body.focus(); })()"
    )
    assert page.evaluate(
        "document.activeElement?.id === 'quant-backtest-dock-content'"
    )
    collapse.click()
    page.wait_for_function(
        "document.activeElement === document.querySelector("
        "'[aria-controls=\"quant-backtest-dock-content\"]')"
    )
    collapse.click()
    page.wait_for_function(
        "document.querySelector('[aria-label=\"Resize backtest summary\"]')?.tabIndex === 0"
    )

    separator.focus()
    before_arrow = int(separator.get_attribute("aria-valuenow"))
    page.keyboard.press("ArrowDown")
    assert int(separator.get_attribute("aria-valuenow")) == max(104, before_arrow - 16)
    page.keyboard.press("ArrowUp")
    assert int(separator.get_attribute("aria-valuenow")) == before_arrow
    page.keyboard.press("Home")
    assert int(separator.get_attribute("aria-valuenow")) == 104
    page.keyboard.press("End")
    assert separator.get_attribute("aria-valuenow") == separator.get_attribute("aria-valuemax")
    separator.dblclick()
    assert separator.get_attribute("aria-valuenow") == "280"

    dock_settings = dock.locator('[aria-label="Open strategy settings"]')
    dock_settings.click()
    settings = page.locator(".quant-backtest-settings")
    settings.wait_for(state="visible")
    assert page.evaluate(
        "document.activeElement?.dataset.settingKey"
    ) == "length"
    settings.locator(".quant-backtest-button", has_text="Cancel").click()
    settings.wait_for(state="hidden")
    page.wait_for_function(
        "document.activeElement === document.querySelector("
        "'#quant-backtest-dock [aria-label=\"Open strategy settings\"]')"
    )

    dock.locator('[aria-label="Open backtest viewer"]').click()
    viewer = page.locator(".quant-backtest-viewer")
    viewer.wait_for(state="visible")
    assert viewer.locator('[aria-label="Open strategy settings"]').count() == 0

    # Removing the active report used to leave focus on a button inside the
    # now-hidden Viewer. The unified close path must clean up state, emit one
    # close callback, and move focus to the public chart fallback.
    page.evaluate("window.__g3aFixture.removeReport()")
    viewer.wait_for(state="hidden")
    assert dock.is_hidden()
    page.wait_for_function("document.activeElement?.id === 'chart-focus'")
    assert page.evaluate(
        "Boolean(document.activeElement?.closest('[hidden], [inert]'))"
    ) is False
    fixture_state = page.evaluate("window.__g3aFixture.state()")
    assert fixture_state["closeViewerCount"] == 1
    assert fixture_state["focusFallbackCount"] >= 1

    # The same invalid-target fallback applies when report removal closes the
    # Settings panel from the Dock rather than an open Viewer.
    page.evaluate("window.__g3aFixture.restoreReport()")
    dock.wait_for(state="visible")
    dock.locator('[aria-label="Open strategy settings"]').click()
    settings.wait_for(state="visible")
    page.evaluate("window.__g3aFixture.removeReport()")
    settings.wait_for(state="hidden")
    page.wait_for_function("document.activeElement?.id === 'chart-focus'")

    page.evaluate("window.__g3aFixture.restoreReport()")
    dock.wait_for(state="visible")
    page.set_viewport_size({"width": 1440, "height": 300})
    page.wait_for_function(
        "document.querySelector('[aria-label=\"Resize backtest summary\"]')"
        ".getAttribute('aria-valuemax') === '225'"
    )
    assert int(separator.get_attribute("aria-valuenow")) <= 225

    # A later normal open/close must not reuse a stale return-focus reference.
    viewer_trigger = dock.locator('[aria-label="Open backtest viewer"]')
    viewer_trigger.click()
    viewer.wait_for(state="visible")
    viewer.locator(".quant-backtest-viewer-back").click()
    viewer.wait_for(state="hidden")
    page.wait_for_function(
        "document.activeElement === document.querySelector("
        "'#quant-backtest-dock [aria-label=\"Open backtest viewer\"]')"
    )
    assert page.evaluate("window.__g3aFixture.state().closeViewerCount") == 2

    # At the compact breakpoint the Dock is intentionally not rendered as a
    # visible chart reservation.  The single Backtest entry must open the
    # same Viewer and return focus to itself without creating another report
    # or changing the host lifecycle.
    page.set_viewport_size({"width": 800, "height": 600})
    mobile_entry = page.locator(".quant-backtest-mobile-trigger")
    mobile_entry.wait_for(state="visible")
    page.wait_for_function(
        "document.querySelector('#quant-backtest-dock')?.hidden === true"
    )
    assert dock.is_hidden()
    mobile_entry.click()
    viewer.wait_for(state="visible")
    viewer.locator(".quant-backtest-viewer-back").click()
    viewer.wait_for(state="hidden")
    page.wait_for_function(
        "document.activeElement === document.querySelector('.quant-backtest-mobile-trigger')"
    )
    assert not errors, errors
    context.close()


def verify_simulation_fixture(browser) -> dict[str, object]:
    """Run Simulation against a settled report through real app components."""

    context = browser.new_context(viewport={"width": 1440, "height": 900})
    blocked_requests: list[str] = []
    luxalgo_requests: list[str] = []
    errors: list[str] = []
    install_offline_guard(context, blocked_requests)
    install_storage_audit(context)
    install_luxalgo_request_audit(context, luxalgo_requests)
    context.add_init_script(WORKER_AUDIT_SCRIPT)
    context.add_init_script(MOCK_WEBSOCKET_SCRIPT)
    page = context.new_page()
    observe_page_errors(page, errors, "Simulation fixture ")

    response = page.goto(
        SIMULATION_FIXTURE_URL,
        wait_until="domcontentloaded",
        timeout=30_000,
    )
    assert response is not None and response.status == 200
    page.wait_for_function("window.__simulationFixture?.ready === true")
    dock = page.locator(".quant-backtest-dock")
    dock.wait_for(state="visible")
    assert dock.locator(".quant-backtest-dock-title").inner_text() == (
        "Simulation Strategy"
    )
    before = page.evaluate("window.__simulationFixture.state()")
    assert before["report"] == {
        "runId": "simulation-run-7",
        "revision": 7,
        "status": "ready",
        "simulation": {
            "method": "resample",
            "runs": 1_000,
            "variationPercent": 0,
            "preserveWinLoss": False,
            "drawdownMultiple": 2,
            "drawdownUnit": "currency",
            "outcomeChartMode": "histogram",
            "drawdownChartMode": "histogram",
        },
    }, before

    dock.locator('[aria-label="Open backtest viewer"]').click()
    viewer = page.locator(".quant-backtest-viewer")
    viewer.wait_for(state="visible")
    tabs = viewer.locator(".quant-backtest-tab")
    desktop_audit = verify_simulation_workspace(page, viewer, tabs, [])
    mobile_audit = verify_simulation_mobile_settings(page, viewer)
    empty_state_audit = verify_simulation_empty_states(page)
    after = page.evaluate("window.__simulationFixture.state()")

    assert after["source"] == before["source"], {
        "before": before,
        "after": after,
    }
    assert after["source"] == {
        "subscribeCount": 1,
        "unsubscribeCount": 0,
        "bootstrapCount": 1,
        "listSnapshotsCount": 1,
        "emittedEventCount": 0,
    }
    assert after["simulationChangeCount"] == 12, after
    assert after["report"]["runId"] == before["report"]["runId"]
    assert after["report"]["revision"] == before["report"]["revision"]
    assert after["report"]["status"] == "ready"
    assert after["report"]["simulation"] == {
        "method": "resample",
        "runs": 2500,
        "variationPercent": 10,
        "preserveWinLoss": True,
        "drawdownMultiple": 3,
        "drawdownUnit": "currency",
        "outcomeChartMode": "histogram",
        "drawdownChartMode": "histogram",
    }, after
    assert not blocked_requests, (
        f"Simulation fixture made non-local requests: {blocked_requests}"
    )
    assert_no_luxalgo_requests(luxalgo_requests, "Simulation fixture")
    assert not errors, errors
    context.close()
    return {
        "desktop": desktop_audit,
        "mobile": mobile_audit,
        "emptyStates": empty_state_audit,
    }


def verify_btcusdt_fixture(browser) -> dict[str, object]:
    """Run the checked-in Binance BTCUSDT/1h fixture through the app layer.

    Unlike the generic simulation fixture, this page executes the local
    Vela-PineTS bridge against the exact 24-bar fixture used by the package
    determinism test.  No provider route is installed here: the page imports
    only checked-in JSON/Pine assets, so any accidental market/LuxAlgo request
    is caught by the offline guard.
    """

    context = browser.new_context(viewport={"width": 1440, "height": 900})
    blocked_requests: list[str] = []
    luxalgo_requests: list[str] = []
    errors: list[str] = []
    install_offline_guard(context, blocked_requests)
    install_storage_audit(context)
    install_luxalgo_request_audit(context, luxalgo_requests)
    context.add_init_script(WORKER_AUDIT_SCRIPT)
    page = context.new_page()
    observe_page_errors(page, errors, "BTCUSDT fixture ")

    response = page.goto(
        BTCUSDT_FIXTURE_URL,
        wait_until="domcontentloaded",
        timeout=30_000,
    )
    assert response is not None and response.status == 200
    page.wait_for_function("window.__btcFixture?.ready === true", timeout=60_000)
    metadata = page.evaluate("window.__btcFixture.metadata")
    assert metadata == {
        "provider": "binance",
        "symbol": "BTCUSDT",
        "timeframe": "1h",
        "timezone": "UTC",
        "bars": 24,
        # Keep the browser gate bound to the same immutable hashes as the
        # package determinism test; a self-referential assertion would allow a
        # changed fixture to pass without an explicit baseline review.
        "fixtureSha256": "29b1d15777827e46b47a7386aa368f0389252b16565f58b3b19805c363e39cd1",
        "strategySha256": "e3e6260620a19b4c5941a039a358ea398462cdf5fbbe861847e0eeadc69f98bc",
        "reportSeriesPoints": 24,
    }
    assert len(metadata["fixtureSha256"]) == 64
    assert len(metadata["strategySha256"]) == 64

    dock = page.locator(".quant-backtest-dock")
    dock.wait_for(state="visible")
    assert dock.locator(".quant-backtest-dock-title").inner_text() == (
        "BTCUSDT 1h deterministic"
    )
    state = page.evaluate("window.__btcFixture.state()")
    report = state["report"]
    assert report["status"] == "ready"
    assert report["provider"] == "binance"
    assert report["symbol"] == "BTCUSDT"
    assert report["strategyName"] == "BTCUSDT 1h deterministic"
    assert report["summary"]["trades"] == 3
    assert abs(report["summary"]["netProfit"] - (-1.6809529999998745)) < 1e-9
    assert abs(report["summary"]["grossProfit"] - 61.97049900000008) < 1e-9
    assert abs(report["summary"]["grossLoss"] - 63.65145199999995) < 1e-9
    assert report["trades"] and len(report["trades"]) == 3
    assert {trade["direction"] for trade in report["trades"]} == {"long", "short"}
    assert report["simulation"]["method"] == "resample"
    assert report["simulation"]["runs"] == 1000

    dock.locator('[aria-label="Open backtest viewer"]').click()
    viewer = page.locator(".quant-backtest-viewer")
    viewer.wait_for(state="visible")
    header = viewer.locator(".quant-backtest-viewer-header")
    # The chart/report identity remains BTCUSDT, while the reference Viewer
    # presents the display-oriented USD pair label as BTCUSD.
    assert "BTCUSD" in header.inner_text()
    assert "1h" in header.inner_text()
    tabs = viewer.locator(".quant-backtest-tab")
    assert tabs.all_text_contents() == [
        "Performance",
        "Trades Analysis",
        "Trades Log",
        "Simulation",
    ]

    # Summary follows the reference trade-aligned historical P&L, while the
    # separate exact PineTS bar series remains available for risk statistics.
    performance = viewer.locator("#quant-backtest-panel")
    performance.locator(".quant-backtest-chart-frame", has_text="Cumulative P&L").wait_for(
        state="visible"
    )
    cumulative = performance.locator(
        ".quant-backtest-chart-frame", has_text="Cumulative P&L"
    )
    assert cumulative.get_attribute("data-cumulative-pnl-source") == "realized-ledger"
    assert cumulative.locator('[data-raw-point-count]').get_attribute("data-raw-point-count") == "3"
    summary_svg = cumulative.locator('svg.highcharts-root')
    summary_svg.wait_for(state="visible")
    expect(summary_svg.locator('.highcharts-tracker-line')).to_have_count(1)
    summary_box = summary_svg.bounding_box()
    assert summary_box
    # Highcharts builds its pointer-search tree lazily on the first mousemove.
    # Move again after that initialization, like a real pointer entering the
    # plot, while still failing if the trade metadata never becomes visible.
    for fraction in (0.83, 0.85, 0.87):
        summary_svg.hover(position={"x": summary_box["width"] * fraction, "y": summary_box["height"] * 0.4})
        try:
            page.wait_for_function("""() => [...document.querySelectorAll('.highcharts-tooltip')]
                .some(node => node.textContent.includes('Trade #3')
                  && node.textContent.includes('Cumulative P&L')
                  && node.textContent.includes('(UTC)'))""", timeout=1000)
            break
        except PlaywrightTimeoutError:
            if fraction == 0.87:
                raise
    assert performance.locator(
        ".quant-backtest-kpi-label", has_text="Net Profit"
    ).count() == 1
    assert "-1.68 USD" in performance.inner_text()

    # Analysis: freeze the reference population and the three chart surfaces.
    tabs.filter(has_text="Trades Analysis").click()
    analysis = viewer.locator(".quant-backtest-analysis")
    analysis.wait_for(state="visible")
    assert analysis.locator(".quant-backtest-analysis-chart-title").all_text_contents() == [
        "P&L Distribution (USD)",
        "Winrate",
        "Duration vs P&L (USD)",
    ]
    analysis_tables = analysis.locator(".quant-backtest-analysis-table")
    assert analysis_tables.count() == 2
    assert analysis_tables.nth(0).locator("tbody tr").count() == 10
    assert analysis_tables.nth(1).locator("tbody tr").count() == 9
    assert analysis.locator(".quant-backtest-analysis-winrate-legend-item").count() >= 2

    # Log: all three deterministic trades and stable descending trade numbers.
    tabs.filter(has_text="Trades Log").click()
    trade_table = viewer.locator(".quant-backtest-trade-table")
    trade_table.wait_for(state="visible")
    assert trade_table.locator("tbody tr").count() == 3
    numbers = [
        int(value.strip())
        for value in trade_table.locator(".quant-backtest-trade-number-value").all_text_contents()
    ]
    assert numbers == [3, 2, 1]
    assert trade_table.locator(".quant-backtest-direction-badge", has_text="long").count() == 2
    assert trade_table.locator(".quant-backtest-direction-badge", has_text="short").count() == 1
    assert "42,612.24 USD" in trade_table.inner_text()
    assert "-36.71 USD" in trade_table.inner_text()

    # Simulation: opening the tab must retain the same report identity and
    # expose the computed reference controls/charts.
    tabs.filter(has_text="Simulation").click()
    simulation = viewer.locator(".quant-backtest-simulation")
    simulation.wait_for(state="visible")
    assert simulation.locator(".quant-backtest-simulation-toolbar").count() == 1
    assert simulation.locator(".quant-backtest-simulation-chart-panel").count() >= 3
    assert "PROBABILITY OF PROFIT" in simulation.inner_text()
    assert "Simulated Net Profit Paths" in simulation.inner_text()
    assert page.evaluate("window.__btcFixture.state().report.runId") == report["runId"]

    # Long open/close cycle: the Viewer must release its Highcharts and
    # ResizeObserver instances while the Dock remains alive.  This is a
    # browser-level companion to the renderer counter contract; it does not
    # claim a heap/FPS budget, which remains a separate performance gate.
    page.wait_for_timeout(700)
    viewer.locator('[aria-label="Return to chart"]').click()
    dock.wait_for(state="visible")
    page.wait_for_timeout(120)
    baseline_chart_resources = page.evaluate("window.__btcFixture.chartResources()")
    dock.locator('[aria-label="Open backtest viewer"]').click()
    viewer.wait_for(state="visible")
    page.wait_for_timeout(120)
    for _ in range(10):
        viewer.locator('[aria-label="Return to chart"]').click()
        dock.wait_for(state="visible")
        page.wait_for_timeout(80)
        closed_resources = page.evaluate("window.__btcFixture.chartResources()")
        assert closed_resources == baseline_chart_resources, (
            "Viewer close leaked chart resources",
            baseline_chart_resources,
            closed_resources,
        )
        dock.locator('[aria-label="Open backtest viewer"]').click()
        viewer.wait_for(state="visible")
        page.wait_for_timeout(120)
    viewer.locator('[aria-label="Return to chart"]').click()
    dock.wait_for(state="visible")

    # The page is deliberately offline and read-only.  Verify the fixture did
    # not introduce persistence writes while merely inspecting the report.
    assert not blocked_requests, f"BTCUSDT fixture made non-local requests: {blocked_requests}"
    assert_no_luxalgo_requests(luxalgo_requests, "BTCUSDT fixture")
    storage_audit = storage_audit_summary(page)
    assert storage_audit["writes"]["count"] == 0, storage_audit
    assert storage_audit["removes"]["count"] == 0, storage_audit
    assert storage_audit["clears"]["count"] == 0, storage_audit
    assert not errors, errors
    page.evaluate("window.__btcFixture.destroy()")
    page.wait_for_function("document.querySelector('#fixture-host')?.childElementCount === 0")
    final_chart_resources = page.evaluate("window.__btcFixture.chartResources()")
    assert final_chart_resources == {"activeCharts": 0, "activeObservers": 0}, final_chart_resources
    context.close()
    return {
        "metadata": metadata,
        "summary": report["summary"],
        "tradeCount": len(report["trades"]),
        "blockedExternalRequests": len(blocked_requests),
        "luxalgoRequests": len(luxalgo_requests),
        "storage": storage_audit,
        "chartResources": {
            "baseline": baseline_chart_resources,
            "final": final_chart_resources,
        },
    }


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
        luxalgo_requests: list[str] = []
        blocked_requests: list[str] = []
        install_fixed_clock(context)
        install_offline_guard(context, blocked_requests)
        install_mock_market_data(context, market_requests)
        install_storage_audit(context)
        install_luxalgo_request_audit(context, luxalgo_requests)
        context.add_init_script(WORKER_AUDIT_SCRIPT)
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

        if os.environ.get("QUANT_EXPECT_BACKTEST_DISABLED") == "1":
            # index.html keeps an empty shell host for stable layout; the
            # kill switch must leave it empty and must not add the feature's
            # owned workbench node or mark the host as dynamically created.
            assert page.locator(
                "#backtest-workbench > [data-backtest-workbench='true']"
            ).count() == 0
            assert page.locator('[data-backtest-host="true"]').count() == 0

            visible_button(page, "Indicators").click()
            page.locator(".quant-indicator-category-label").first.wait_for(state="visible")
            assert page.locator(".quant-indicator-category").count() == 4
            page.keyboard.press("Escape")

            pine_editor = page.locator(
                "#vela-tool-vela-widget-panel-quant-pine-editor"
            )
            pine_editor.click()
            page.locator(".quant-pine-body").wait_for(state="visible")
            assert pine_editor.get_attribute("data-active") == "1"

            page.locator("#vela-action-quant-templates").click()
            page.locator(".template-popover").wait_for(state="visible")
            assert page.locator(
                ".template-popover .quant-popover-item",
                has_text="New template",
            ).count() == 1

            assert not blocked_requests, (
                f"kill-switch smoke made non-local requests: {blocked_requests}"
            )
            assert_no_luxalgo_requests(luxalgo_requests, "kill-switch smoke")
            assert not errors, errors
            print(
                "E2E kill-switch audit: "
                + json.dumps({
                    "backtestHosts": 0,
                    "blockedExternalRequests": len(blocked_requests),
                    "luxalgoRequests": len(luxalgo_requests),
                    "marketRequests": len(market_requests),
                }, sort_keys=True)
            )
            context.close()
            browser.close()
            return

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

        initial_editor_chunk = page.evaluate(
            """() => performance.getEntriesByType('resource').some(entry =>
            entry.name.includes('pine-editor-controller'))"""
        )
        assert not initial_editor_chunk, "Pine Editor chunk was eagerly loaded"

        visible_button(page, "Indicators").click()
        page.locator(".quant-indicator-category-label").first.wait_for(state="visible")
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

        backtest_audit = verify_backtest_workspace(page, market_requests)

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
        assert not blocked_requests, f"main regression made non-local requests: {blocked_requests}"
        assert_no_luxalgo_requests(luxalgo_requests, "main regression")
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

            # A synchronous Backtest Feature construction failure must be
            # isolated to the optional feature. The existing Workspace and
            # its toolbar still need to mount exactly once, and a dynamically
            # created backtest host must not be left behind.
            lifecycle.evaluate(
                "window.destroyQuantApp(); window.mountQuantApp({failBacktest: true})"
            )
            lifecycle.wait_for_selector("#vela-action-quant-favorites")
            for selector in (
                "#vela-action-quant-favorites",
                "#vela-action-quant-templates",
                "#vela-action-screenshot",
                "#vela-tool-vela-widget-panel-quant-pine-editor",
            ):
                assert lifecycle.locator(selector).count() == 1, selector
            assert lifecycle.locator(
                "#backtest-workbench .quant-backtest-workbench"
            ).count() == 0

            # Exercise a failure after the real Backtest Workbench and Cell
            # subscription have been created. The transaction rollback must
            # disconnect the partially-created ResizeObserver and leave no
            # optional-feature host/DOM behind while the existing Workspace
            # remains usable.
            lifecycle.evaluate("window.destroyQuantApp(); window.mountQuantApp({failBacktestResize: true})")
            lifecycle.wait_for_selector("#vela-action-quant-favorites")
            resize_stats = lifecycle.evaluate("window.__backtestResizeStats")
            assert resize_stats["created"] == 1
            assert resize_stats["disconnected"] == 1
            assert lifecycle.locator("#backtest-workbench").count() == 0
            assert lifecycle.locator("#vela-action-quant-favorites").count() == 1

            # The release kill switch must skip the Backtesting constructor
            # entirely (the injected constructor would throw if called), keep
            # the existing toolbar usable, and leave the saved Workspace byte
            # for byte unchanged.
            disabled_workspace = lifecycle.evaluate(
                "localStorage.getItem('quant-tools:workspace:v2')"
            )
            lifecycle.evaluate(
                "window.destroyQuantApp(); "
                "window.mountQuantApp({failBacktest: true, enableBacktesting: false})"
            )
            lifecycle.wait_for_selector("#vela-action-quant-favorites")
            assert lifecycle.locator("#backtest-workbench").count() == 0
            assert lifecycle.locator("#vela-action-quant-favorites").count() == 1
            assert lifecycle.locator("#vela-action-quant-templates").count() == 1
            assert lifecycle.locator(
                "#vela-tool-vela-widget-panel-quant-pine-editor"
            ).count() == 1
            assert lifecycle.evaluate(
                "localStorage.getItem('quant-tools:workspace:v2')"
            ) == disabled_workspace

            lifecycle.evaluate("window.destroyQuantApp(); window.mountQuantApp()")
            lifecycle.wait_for_selector("#vela-action-quant-favorites")

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
            lifecycle_stats = lifecycle.evaluate("window.__quantLifecycleStats")
            assert lifecycle_stats == {
                "mounts": 7,
                "destroys": 7,
                "noopDestroys": 1,
            }, lifecycle_stats
            lifecycle.close()
            assert not errors, errors

        print(
            "E2E audit: "
            + json.dumps(
                {
                    "luxalgoRequests": len(luxalgo_requests),
                    "blockedExternalRequests": len(blocked_requests),
                    "marketRequests": len(market_requests),
                    "viewerStorage": backtest_audit["viewerStorageAudit"],
                    "lifecycle": lifecycle_stats
                    if SERVER_SCRIPT == "dev" and os.environ.get("QUANT_SKIP_LIFECYCLE") != "1"
                    else None,
                },
                sort_keys=True,
            )
        )
        context.close()
        verify_legacy_workspace_fixture(browser)
        # The deterministic browser fixture intentionally imports the local
        # workspace PineEngine source and checked-in test assets.  Vite's
        # production preview serves only `dist/`, so those test-only modules
        # are not a runtime production dependency.  Keep the engine-backed
        # fixture in the dev E2E (where it is actually served) and use the
        # production application smoke above plus the offline package fixture
        # Gate for the production build.
        btcusdt_audit = (
            verify_btcusdt_fixture(browser)
            if SERVER_SCRIPT == "dev"
            else None
        )
        if SERVER_SCRIPT == "dev":
            verify_simulation_fixture(browser)
            verify_g3a_workbench_fixture(browser)
        if btcusdt_audit is not None:
            print("BTCUSDT fixture audit: " + json.dumps(btcusdt_audit, sort_keys=True))
        browser.close()


def main() -> int:
    if SERVER_SCRIPT == "preview":
        ensure_preview_build()
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
