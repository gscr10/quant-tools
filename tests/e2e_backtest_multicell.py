#!/usr/bin/env python3
"""Browser gate for Backtest 2×2 multi-cell/multi-strategy isolation.

The fixture uses the production BacktestController, BacktestStore and
BacktestWorkbench with a deterministic results source.  It covers selection,
background/late events, revision+epoch ordering, removals and teardown without
starting a real market provider or writing report data to browser storage.

Run directly with ``python3 tests/e2e_backtest_multicell.py``.
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
PORT = int(os.environ.get("QUANT_MULTICELL_PORT", "4185"))
FIXTURE_PATH = "/tests/fixtures/backtest-multicell.html"
FIXTURE_URL = f"http://{HOST}:{PORT}{FIXTURE_PATH}"
LOCAL_HOSTS = {HOST, "localhost", "::1"}


STORAGE_AUDIT_SCRIPT = r"""
(() => {
  const audit = {
    reads: [],
    writes: [],
    removes: [],
    clears: 0,
    summary() {
      return {
        reads: this.reads.length,
        writes: this.writes.length,
        removes: this.removes.length,
        clears: this.clears,
        writeKeys: [...new Set(this.writes)],
      };
    },
  };
  Object.defineProperty(window, '__multicellStorageAudit', {
    configurable: true,
    value: audit,
  });
  const prototype = Storage.prototype;
  const getItem = prototype.getItem;
  const setItem = prototype.setItem;
  const removeItem = prototype.removeItem;
  const clear = prototype.clear;
  prototype.getItem = function auditedGetItem(key) {
    audit.reads.push(String(key));
    return Reflect.apply(getItem, this, [key]);
  };
  prototype.setItem = function auditedSetItem(key, value) {
    audit.writes.push(String(key));
    return Reflect.apply(setItem, this, [key, value]);
  };
  prototype.removeItem = function auditedRemoveItem(key) {
    audit.removes.push(String(key));
    return Reflect.apply(removeItem, this, [key]);
  };
  prototype.clear = function auditedClear() {
    audit.clears += 1;
    return Reflect.apply(clear, this, []);
  };
})();
"""


def assert_port_available() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((HOST, PORT))
        except OSError as error:
            raise RuntimeError(
                f"port {PORT} is already in use; stop the stale server or set "
                "QUANT_MULTICELL_PORT"
            ) from error


def wait_for_server(process: subprocess.Popen[str]) -> None:
    timeout = float(os.environ.get("QUANT_E2E_STARTUP_TIMEOUT", "90"))
    deadline = time.monotonic() + max(5.0, timeout)
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(
                f"Vite exited before serving the fixture ({process.returncode})\n{output}"
            )
        try:
            with urlopen(FIXTURE_URL, timeout=0.75) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.15)
    raise TimeoutError(f"Vite did not serve {FIXTURE_PATH} within {timeout:g}s")


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


def storage_audit(page: Page) -> dict[str, object]:
    return page.evaluate("window.__multicellStorageAudit.summary()")


def fixture_state(page: Page) -> dict[str, object]:
    return page.evaluate("window.__backtestMulticell.state()")


def wait_for_one_chart(page: Page) -> None:
    page.wait_for_function(
        """
        () => {
          const state = window.__backtestMulticell?.state?.();
          return state?.resources?.activeCharts === 1
            && state?.resources?.activeObservers === 1;
        }
        """,
        timeout=10_000,
    )


def assert_active(
    page: Page,
    *,
    cell_id: str,
    indicator_id: str,
    title: str,
    revision: int,
) -> dict[str, object]:
    state = fixture_state(page)
    assert state["activeCellId"] == cell_id, state
    assert state["active"] == {
        **state["active"],
        "cellId": cell_id,
        "indicatorId": indicator_id,
        "revision": revision,
        "title": title,
    }, state["active"]
    assert state["dock"]["hidden"] is False, state["dock"]
    assert state["dock"]["title"] == title, state["dock"]
    return state


def assert_grid_geometry(page: Page) -> None:
    cells = page.locator(".multicell-chart-cell")
    assert cells.count() == 4
    boxes = [cells.nth(index).bounding_box() for index in range(4)]
    assert all(box is not None for box in boxes), boxes
    first, second, third, fourth = boxes
    assert first is not None and second is not None
    assert third is not None and fourth is not None
    assert first["x"] < second["x"]
    assert third["x"] < fourth["x"]
    assert abs(first["y"] - second["y"]) < 1
    assert abs(third["y"] - fourth["y"]) < 1
    assert third["y"] > first["y"]
    assert fourth["y"] > second["y"]


def exercise_fixture(page: Page) -> dict[str, object]:
    page.wait_for_function("window.__backtestMulticell?.ready === true", timeout=30_000)
    assert_grid_geometry(page)

    initial = assert_active(
        page,
        cell_id="cell-1",
        indicator_id="beta",
        title="Cell 1 Beta r5",
        revision=5,
    )
    assert len(initial["entries"]) == 6, initial["entries"]
    assert initial["source"] == {
        **initial["source"],
        "subscribeCount": 1,
        "unsubscribeCount": 0,
        "listeners": 1,
        "bootstrapCount": 1,
        "listSnapshotsCount": 1,
        "providerRequestCount": 1,
    }, initial["source"]
    assert initial["storage"] == {"readCount": 1, "writeCount": 0}
    wait_for_one_chart(page)

    # Each chart cell resolves only its highest-revision strategy.
    for cell_id, indicator_id, title, revision in (
        ("cell-2", "gamma", "Cell 2 Gamma r3", 3),
        ("cell-3", "delta", "Cell 3 Delta r4", 4),
        ("cell-4", "epsilon", "Cell 4 Epsilon r2", 2),
        ("cell-1", "beta", "Cell 1 Beta r5", 5),
    ):
        page.evaluate("cellId => window.__backtestMulticell.selectCell(cellId)", cell_id)
        assert_active(
            page,
            cell_id=cell_id,
            indicator_id=indicator_id,
            title=title,
            revision=revision,
        )

    # Snapshot, error and asynchronous response events from background cells
    # may update their own Store entries but cannot take over the current Dock.
    page.evaluate("window.__backtestMulticell.publishBackgroundSnapshot()")
    assert_active(
        page,
        cell_id="cell-1",
        indicator_id="beta",
        title="Cell 1 Beta r5",
        revision=5,
    )
    page.evaluate("window.__backtestMulticell.publishBackgroundError()")
    assert_active(
        page,
        cell_id="cell-1",
        indicator_id="beta",
        title="Cell 1 Beta r5",
        revision=5,
    )
    page.evaluate("window.__backtestMulticell.publishLateBackground(40)")
    assert_active(
        page,
        cell_id="cell-1",
        indicator_id="beta",
        title="Cell 1 Beta r5",
        revision=5,
    )

    # A same-epoch lower revision and any older epoch must be discarded even
    # when the old epoch carries a much larger revision number.
    page.evaluate("window.__backtestMulticell.publishFreshActive()")
    assert_active(
        page,
        cell_id="cell-1",
        indicator_id="beta",
        title="Cell 1 Beta fresh r8",
        revision=8,
    )
    page.evaluate("window.__backtestMulticell.publishStaleRevision()")
    page.evaluate("window.__backtestMulticell.publishStaleEpoch()")
    fresh = assert_active(
        page,
        cell_id="cell-1",
        indicator_id="beta",
        title="Cell 1 Beta fresh r8",
        revision=8,
    )
    beta_entry = next(
        entry
        for entry in fresh["entries"]
        if entry["cellId"] == "cell-1" and entry["indicatorId"] == "beta"
    )
    assert beta_entry == {
        **beta_entry,
        "epoch": 2,
        "revision": 8,
        "title": "Cell 1 Beta fresh r8",
    }, beta_entry

    # Removing the selected strategy stays inside the selected cell. Removing
    # that cell's final strategy leaves the Dock empty while other reports live.
    page.evaluate("window.__backtestMulticell.removeKey('cell-1', 'beta')")
    assert_active(
        page,
        cell_id="cell-1",
        indicator_id="alpha",
        title="Cell 1 Alpha r2",
        revision=2,
    )
    page.evaluate("window.__backtestMulticell.removeKey('cell-1', 'alpha')")
    empty = fixture_state(page)
    assert empty["activeCellId"] == "cell-1", empty
    assert empty["active"] is None, empty
    assert empty["dock"]["hidden"] is True, empty["dock"]
    assert empty["dock"]["title"] == "", empty["dock"]
    assert empty["dock"]["workbenchState"] == "empty", empty["dock"]
    assert any(entry["cellId"] != "cell-1" for entry in empty["entries"])
    page.wait_for_function(
        """
        () => {
          const resources = window.__backtestMulticell.state().resources;
          return resources.activeCharts === 0 && resources.activeObservers === 0;
        }
        """,
        timeout=10_000,
    )

    # Background traffic also cannot fill an intentionally empty active cell.
    page.evaluate("window.__backtestMulticell.publishBackgroundSnapshot()")
    page.evaluate("window.__backtestMulticell.publishBackgroundError()")
    page.evaluate("window.__backtestMulticell.publishLateBackground(40)")
    still_empty = fixture_state(page)
    assert still_empty["activeCellId"] == "cell-1", still_empty
    assert still_empty["active"] is None, still_empty
    assert still_empty["dock"]["hidden"] is True, still_empty["dock"]

    # Restore a background cell so teardown has a real Highcharts instance and
    # ResizeObserver to release, then queue a provider response across destroy.
    page.evaluate("window.__backtestMulticell.selectCell('cell-4')")
    restored = fixture_state(page)
    assert restored["activeCellId"] == "cell-4", restored
    assert restored["active"] is not None, restored
    assert restored["active"]["cellId"] == "cell-4", restored["active"]
    wait_for_one_chart(page)

    page.evaluate("window.__backtestMulticell.queuePostDestroyLate(80)")
    before_destroy = fixture_state(page)
    storage_before_destroy = storage_audit(page)
    provider_requests_before_destroy = before_destroy["source"]["providerRequestCount"]
    delivered_before_destroy = before_destroy["source"]["deliveredEventCount"]
    assert before_destroy["resources"] == {
        "activeCharts": 1,
        "activeObservers": 1,
    }, before_destroy["resources"]

    page.evaluate("window.__backtestMulticell.destroy()")
    page.evaluate("window.__backtestMulticell.waitForPostDestroyLate()")
    after_late = fixture_state(page)
    assert after_late["source"]["deliveredEventCount"] == delivered_before_destroy + 1
    assert after_late["source"]["deliveredWithoutListeners"] >= 1
    page.evaluate("window.__backtestMulticell.exerciseDestroyedObjects()")
    final = fixture_state(page)
    storage_after_destroy = storage_audit(page)

    assert final["destroyed"] is True
    assert final["active"] is None
    assert final["entries"] == []
    assert final["resources"] == {"activeCharts": 0, "activeObservers": 0}
    assert final["dom"] == {
        "hostChildren": 0,
        "workbenches": 0,
        "reportChartHosts": 0,
        "highchartsContainers": 0,
    }, final["dom"]
    assert final["source"]["listeners"] == 0, final["source"]
    assert final["source"]["unsubscribeCount"] == 1, final["source"]
    assert final["source"]["providerRequestCount"] == provider_requests_before_destroy
    assert final["storage"] == before_destroy["storage"]
    assert storage_after_destroy == storage_before_destroy, {
        "before": storage_before_destroy,
        "after": storage_after_destroy,
    }

    return {
        "initialReports": len(initial["entries"]),
        "finalReports": len(final["entries"]),
        "providerRequests": final["source"]["providerRequestCount"],
        "postDestroyDeliveries": final["source"]["deliveredWithoutListeners"],
        "storage": storage_after_destroy,
        "resources": final["resources"],
        "dom": final["dom"],
    }


def launch_options() -> dict[str, object]:
    options: dict[str, object] = {"headless": True}
    executable = os.environ.get("CHROMIUM_EXECUTABLE")
    if executable:
        options["executable_path"] = executable
    return options


def run() -> dict[str, object]:
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
        blocked: list[str] = []
        bad_responses: list[str] = []
        page_errors: list[str] = []
        console_errors: list[str] = []
        hmr_requests: list[str] = []
        websocket_urls: list[str] = []
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(**launch_options())
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            try:
                context.add_init_script(STORAGE_AUDIT_SCRIPT)
                install_offline_guard(context, blocked)
                page = context.new_page()
                page.on("pageerror", lambda error: page_errors.append(str(error)))
                page.on(
                    "console",
                    lambda message: console_errors.append(message.text)
                    if message.type == "error"
                    else None,
                )
                page.on(
                    "response",
                    lambda response: bad_responses.append(
                        f"{response.status} {response.url}"
                    )
                    if response.status >= 400
                    else None,
                )
                page.on(
                    "request",
                    lambda request: hmr_requests.append(request.url)
                    if "/@vite/client" in request.url
                    else None,
                )
                page.on("websocket", lambda websocket: websocket_urls.append(websocket.url))

                response = page.goto(
                    FIXTURE_URL,
                    wait_until="domcontentloaded",
                    timeout=30_000,
                )
                assert response is not None and response.status == 200
                result = exercise_fixture(page)

                assert not blocked, {"blockedExternalRequests": blocked}
                assert not bad_responses, {"badResponses": bad_responses}
                assert not page_errors, {"pageErrors": page_errors}
                assert not console_errors, {"consoleErrors": console_errors}
                assert not hmr_requests, {"hmrRequests": hmr_requests}
                assert not websocket_urls, {"websockets": websocket_urls}
                return {
                    **result,
                    "blockedExternalRequests": len(blocked),
                    "badResponses": len(bad_responses),
                    "pageErrors": len(page_errors),
                    "hmrRequests": len(hmr_requests),
                    "websockets": len(websocket_urls),
                }
            finally:
                context.close()
                browser.close()
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
    result = run()
    print("Backtest multi-cell browser audit: " + json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - a gate should preserve context.
        print(f"Backtest multi-cell browser audit failed: {error}", file=os.sys.stderr)
        raise
