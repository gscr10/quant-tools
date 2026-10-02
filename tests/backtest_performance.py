#!/usr/bin/env python3
"""Browser performance gate for large backtest reports.

The normal unit benchmark proves that selectors and samplers are bounded, but
it cannot see DOM row counts, Highcharts/ResizeObserver lifetimes, compositor
frames, long tasks, or browser heap usage.  This runner mounts the checked-in
synthetic fixture in a fixed 1440x900 Chromium page and records those signals
for 10k and 100k ledgers.

Run ``python3 tests/backtest_performance.py`` for a report.  ``--strict``
applies the plan's first-pass budgets (200 rendered rows, 2,000 chart points,
50 FPS, 50ms long-task p95, and <=20MiB heap growth after ten open/close
cycles).  Set ``QUANT_PERF_ARTIFACT=1`` to write JSON and a Playwright trace
under ``artifacts/``; generated traces are ignored by the repository's
``*.zip`` rule while the JSON remains a reviewable local artifact.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import statistics
import subprocess
import sys
import time
from urllib.request import urlopen

from playwright.sync_api import Browser, Page, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = int(os.environ.get("QUANT_PERF_PORT", "4182"))
FIXTURE = f"http://{HOST}:{PORT}/tests/fixtures/backtest-performance.html"
SIMULATION_FIXTURE = f"http://{HOST}:{PORT}/tests/fixtures/backtest-simulation.html"
CHROMIUM_DEFAULT = "/Applications/Chromium.app/Contents/MacOS/Chromium"


def trace_label(path: Path | None) -> str | None:
    if path is None:
        return None
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def percentile_nearest_rank(values: list[float], percentile: float) -> float:
    """Return the nearest-rank percentile used by the strict gate."""

    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, min(len(ordered), math.ceil(len(ordered) * percentile)))
    return ordered[rank - 1]


def wait_for_server(process: subprocess.Popen[str]) -> None:
    startup_timeout = float(os.environ.get("QUANT_E2E_STARTUP_TIMEOUT", "90"))
    deadline = time.monotonic() + startup_timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(f"Vite exited before startup ({process.returncode}):\n{output}")
        try:
            with urlopen(f"http://{HOST}:{PORT}/", timeout=1) as response:
                if response.status == 200:
                    return
        except Exception:  # noqa: BLE001 - startup probe retries by design.
            time.sleep(0.15)
    raise TimeoutError(f"Vite did not start within {startup_timeout} seconds")


def heap_usage(page: Page, cdp) -> dict[str, int | None]:
    """Collect a comparable heap signal when Chromium exposes precise usage."""
    try:
        cdp.send("HeapProfiler.collectGarbage")
        usage = cdp.send("Runtime.getHeapUsage")
        used = usage.get("usedSize")
        total = usage.get("totalSize")
        if isinstance(used, int) and isinstance(total, int):
            return {"usedBytes": used, "totalBytes": total}
    except Exception:  # noqa: BLE001 - Firefox/WebKit or restricted Chromium.
        pass
    try:
        value = page.evaluate("performance.memory?.usedJSHeapSize ?? null")
        return {"usedBytes": int(value) if isinstance(value, (int, float)) else None, "totalBytes": None}
    except Exception:  # noqa: BLE001 - optional diagnostic only.
        return {"usedBytes": None, "totalBytes": None}


def install_raf_probe(page: Page) -> None:
    page.evaluate(
        """
        (() => {
          const state = { running: false, started: 0, ended: 0, frames: [], longTasks: [] };
          window.__quantPerfProbe = {
            start() {
              state.running = true;
              state.started = performance.now();
              state.ended = 0;
              state.frames = [];
              state.longTasks = [];
              if (window.PerformanceObserver) {
                try {
                  const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
                  });
                  observer.observe({ type: 'longtask', buffered: false });
                  state.observer = observer;
                } catch { /* longtask is optional */ }
              }
              let previous = state.started;
              const tick = (now) => {
                if (!state.running) return;
                state.frames.push(now - previous);
                previous = now;
                requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            },
            stop() {
              state.ended = performance.now();
              state.running = false;
              state.observer?.disconnect();
              const duration = Math.max(1, state.ended - state.started);
              const intervals = state.frames.filter((value) => Number.isFinite(value) && value > 0);
              const frameBudget = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0;
              const sortedLong = [...state.longTasks].sort((a, b) => a - b);
              const percentile = (values, p) => values.length
                ? values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]
                : 0;
              return {
                durationMs: duration,
                frameCount: state.frames.length,
                fps: state.frames.length / duration * 1000,
                averageFrameMs: frameBudget,
                longTaskCount: sortedLong.length,
                longTaskP95Ms: percentile(sortedLong, 0.95),
                longTaskMaxMs: sortedLong.at(-1) ?? 0,
              };
            },
          };
        })()
        """
    )


def wait_chart_upgrade(page: Page) -> None:
    # The local Highcharts chunk is lazy.  SVG fallback is already a valid
    # render, but wait briefly so resource counts include the upgraded chart.
    page.wait_for_timeout(250)


def measure_trade_log(page: Page) -> dict[str, object]:
    page.evaluate("window.__backtestPerformance.openViewer()")
    page.locator(".quant-backtest-viewer").wait_for(state="visible")
    page.wait_for_timeout(1_000)
    page.evaluate("window.__backtestPerformance.selectTab('log')")
    table = page.locator(".quant-backtest-trade-table")
    table.wait_for(state="visible")
    page_status = page.locator(".quant-backtest-trade-pagination-status").inner_text()
    rows = table.locator("tbody tr").count()

    # Prime the sorted-entry cache and the first DOM replacement before timing
    # steady-state page changes.  The first click also mounts the lazy table
    # path on some Chromium revisions and would otherwise make a 10-sample
    # p95 depend on one-time setup rather than pagination cost.
    for selector in ("[data-trade-pagination=\"next\"]", "[data-trade-pagination=\"previous\"]"):
        page.evaluate(
            """
            (selector) => {
              const button = document.querySelector(selector);
              if (!(button instanceof HTMLElement)) throw new Error(`pagination button missing: ${selector}`);
              button.click();
            }
            """
            , selector,
        )
        page.wait_for_timeout(40)

    # Ten page transitions exercise the real rerender/focus path while keeping
    # the trace short enough to inspect.  The final status proves that only a
    # page, never the full ledger, is present in the DOM.
    durations: list[float] = []
    for _ in range(10):
        duration = page.evaluate(
            """
            () => {
              const button = document.querySelector('[data-trade-pagination="next"]');
              if (!(button instanceof HTMLElement)) throw new Error('next page button missing');
              const started = performance.now();
              button.click();
              return performance.now() - started;
            }
            """
        )
        durations.append(float(duration))
    after = page.evaluate("window.__backtestPerformance.state()")
    return {
        "initialRows": rows,
        "initialStatus": page_status,
        "afterRows": after["tableRows"],
        "afterStatus": after["pageStatus"],
        "pageTransitionP50Ms": statistics.median(durations),
        "pageTransitionP95Ms": percentile_nearest_rank(durations, 0.95),
        "pageTransitionMaxMs": max(durations),
    }


def measure_dock_chart_stability(page: Page) -> dict[str, object]:
    """Check the actual Dock SVG, not only the hidden/full-screen Viewer host."""
    return page.evaluate(
        """
        async () => {
          const host = document.querySelector('.quant-backtest-dock-sparkline .quant-backtest-chart-host');
          const svg = host?.querySelector('svg.highcharts-root');
          if (!host || !svg) throw new Error('Dock Highcharts SVG is not ready');
          const samples = [];
          for (let index = 0; index < 32; index += 1) {
            // Let the native ResizeObserver and delayed chart reflows settle
            // between repeats of the exact same live report.
            window.__backtestPerformance.liveMetricOnly(window.__backtestPerformance.report.metrics.netProfit);
            await new Promise(resolve => setTimeout(resolve, 40));
            const box = host.getBoundingClientRect();
            const svgBox = svg.getBoundingClientRect();
            samples.push([box.width, box.height, svgBox.width, svgBox.height,
              Number(svg.getAttribute('width')), Number(svg.getAttribute('height'))]);
          }
          const stable = samples[0].every((_, index) => {
            const values = samples.map(sample => sample[index]);
            return Math.max(...values) - Math.min(...values) <= 1;
          });
          const result = { stable, samples, sameHost: host === document.querySelector('.quant-backtest-dock-sparkline .quant-backtest-chart-host'),
            sameSvg: svg === host.querySelector('svg.highcharts-root') };
          window.__backtestPerformance.restoreReady();
          return result;
        }
        """
    )


def measure_live_update(page: Page) -> dict[str, object]:
    """Verify forming-bar updates reuse mounted Dock and Viewer chart instances."""
    page.evaluate("window.__backtestPerformance.openViewer()")
    page.locator(".quant-backtest-viewer").wait_for(state="visible")
    return page.evaluate(
        """
        async () => {
          const host = document.querySelector('.quant-backtest-performance .quant-backtest-chart-host[data-quant-report-chart]');
          if (!(host instanceof HTMLElement)) throw new Error('Viewer chart host missing');
          const initialTitle = document.querySelector('.quant-backtest-viewer-heading h2')?.textContent ?? null;
          window.__backtestPerformance.newRunSameData();
          const newRunTitle = document.querySelector('.quant-backtest-viewer-heading h2')?.textContent ?? null;
          window.__backtestPerformance.terminalError('Fixture terminal failure');
          const errorVisible = document.querySelector('.quant-backtest-state-error')?.textContent?.includes('Fixture terminal failure') ?? false;
          window.__backtestPerformance.restoreReady();
          // Highcharts enhancement is intentionally scheduled after the
          // synchronous SVG render; let that upgrade settle before exercising
          // the next forming snapshot.
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const restoredHost = document.querySelector('.quant-backtest-performance .quant-backtest-chart-host[data-quant-report-chart]');
          if (!(restoredHost instanceof HTMLElement)) throw new Error('Viewer did not recover after terminal error');
          const before = window.__backtestPerformance.chartResources();
          const beforeHost = restoredHost;
          const sizeSamples = [];
          for (let sample = 0; sample < 12; sample += 1) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const rect = beforeHost.getBoundingClientRect();
            sizeSamples.push([Number(rect.width.toFixed(2)), Number(rect.height.toFixed(2))]);
          }
          const widths = sizeSamples.map(([width]) => width);
          const heights = sizeSamples.map(([, height]) => height);
          const beforeKpi = document.querySelector('.quant-backtest-performance-kpi-bar .quant-backtest-kpi-value');
          window.__backtestPerformance.liveMetricOnly(234.56);
          const afterMetricHost = document.querySelector('.quant-backtest-performance .quant-backtest-chart-host[data-quant-report-chart]');
          const afterMetricKpi = document.querySelector('.quant-backtest-performance-kpi-bar .quant-backtest-kpi-value');
          const afterMetric = window.__backtestPerformance.chartResources();
          window.__backtestPerformance.liveUpdate(123.45, 123.45);
          const afterHost = document.querySelector('.quant-backtest-performance .quant-backtest-chart-host[data-quant-report-chart]');
          const amount = document.querySelector('.quant-backtest-dock-kpi strong');
          const afterLive = window.__backtestPerformance.chartResources();
          // Return the fixture to a terminal snapshot before the next
          // interaction; the assertion above captures the live update itself.
          window.__backtestPerformance.liveUpdate(123.45, 123.45, 'ready');
          return {
            sameHost: beforeHost === afterHost,
            runChanged: initialTitle !== newRunTitle && newRunTitle?.includes('(new run)'),
            initialTitle,
            newRunTitle,
            errorVisible,
            sameMetricHost: beforeHost === afterMetricHost,
            metricKpiBefore: beforeKpi?.textContent ?? null,
            metricKpiAfter: afterMetricKpi?.textContent ?? null,
            beforeMetric: before,
            before,
            sizeSamples,
            sizeStable: Math.max(...widths) - Math.min(...widths) <= 1
              && Math.max(...heights) - Math.min(...heights) <= 1,
            afterMetric,
            after: afterLive,
            netProfit: amount?.textContent ?? null,
          };
        }
        """
    )


def measure_dock_drag(page: Page) -> dict[str, object]:
    # Return to the Dock before starting a pointer drag; Viewer intentionally
    # hides the Dock and ignores resize events while it is open.
    # The fixture starts in Dock mode.  Do not ask Playwright to click the
    # hidden viewer control in that normal state: hidden controls wait until
    # the locator timeout and make the performance gate look like an app
    # lifecycle failure.  This also makes the helper safe when a caller has
    # already opened the Viewer.
    viewer = page.locator('.quant-backtest-viewer')
    if viewer.count() and viewer.is_visible():
        page.locator('[aria-label="Return to chart"]').click()
    page.locator(".quant-backtest-dock").wait_for(state="visible")
    install_raf_probe(page)
    separator = page.locator('[aria-label="Resize backtest summary"]')
    box = separator.bounding_box()
    if not box:
        raise AssertionError("Dock resize separator has no geometry")
    x = box["x"] + box["width"] / 2
    y = box["y"] + box["height"] / 2
    page.evaluate("window.__quantPerfProbe.start()")
    page.mouse.move(x, y)
    page.mouse.down()
    # A real pointer stream at ~60Hz gives the ResizeObserver/reflow path a
    # chance to run instead of measuring a single synthetic event.
    for step in range(90):
        page.mouse.move(x, y - 220 * (step + 1) / 90)
        page.wait_for_timeout(8)
    page.mouse.up()
    page.wait_for_timeout(100)
    probe = page.evaluate("window.__quantPerfProbe.stop()")
    height = page.locator("#quant-backtest-dock").bounding_box()["height"]
    return {**probe, "finalDockHeight": height}


def measure_cycles(page: Page, cdp, cycles: int = 10) -> dict[str, object]:
    baseline = heap_usage(page, cdp)
    baseline_resources = page.evaluate("window.__backtestPerformance.chartResources()")
    for _ in range(cycles):
        page.evaluate("window.__backtestPerformance.openViewer()")
        page.locator(".quant-backtest-viewer").wait_for(state="visible")
        page.wait_for_timeout(50)
        page.locator('[aria-label="Return to chart"]').click()
        page.locator(".quant-backtest-dock").wait_for(state="visible")
        page.wait_for_timeout(50)
    after = heap_usage(page, cdp)
    after_resources = page.evaluate("window.__backtestPerformance.chartResources()")
    delta = None
    if baseline["usedBytes"] is not None and after["usedBytes"] is not None:
        delta = after["usedBytes"] - baseline["usedBytes"]
    return {
        "cycles": cycles,
        "baselineHeap": baseline,
        "afterHeap": after,
        "heapDeltaBytes": delta,
        "baselineResources": baseline_resources,
        "afterResources": after_resources,
    }


def measure_case(browser: Browser, count: int, trace_path: Path | None) -> dict[str, object]:
    context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    if trace_path:
        context.tracing.start(screenshots=False, snapshots=True, sources=True)
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    cdp = context.new_cdp_session(page)
    page.goto(f"{FIXTURE}?count={count}", wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_function("window.__backtestPerformance?.ready === true", timeout=60_000)
    page.wait_for_timeout(250)
    initial = page.evaluate("window.__backtestPerformance.state()")
    dock_stability = measure_dock_chart_stability(page)
    live_update = measure_live_update(page)
    page.locator('[aria-label="Return to chart"]').click()
    page.locator('.quant-backtest-dock').wait_for(state='visible')
    page.wait_for_timeout(250)
    trade_log = measure_trade_log(page)
    page.evaluate("window.__backtestPerformance.selectTab('performance')")
    page.wait_for_timeout(250)
    performance_state = page.evaluate("window.__backtestPerformance.state()")
    dock_drag = measure_dock_drag(page)
    cycles = measure_cycles(page, cdp)
    page.evaluate("window.__backtestPerformance.destroy()")
    page.wait_for_timeout(150)
    final_resources = page.evaluate("window.__backtestPerformance.chartResources()")
    if trace_path:
        context.tracing.stop(path=str(trace_path))
    context.close()
    return {
        "count": count,
        "initial": initial,
        "dockStability": dock_stability,
        "liveUpdate": live_update,
        "tradeLog": trade_log,
        "performance": performance_state,
        "dockDrag": dock_drag,
        "cycles": cycles,
        "finalResources": final_resources,
        "pageErrors": errors,
        "tracePath": trace_label(trace_path),
    }


def measure_simulation(browser: Browser, trace_path: Path | None = None) -> dict[str, object]:
    """Run the real controller/Worker path at its supported 10k upper bound."""
    context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    if trace_path:
        context.tracing.start(screenshots=False, snapshots=True, sources=True)
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    cdp = context.new_cdp_session(page)
    page.goto(SIMULATION_FIXTURE, wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_function("window.__simulationFixture?.ready === true", timeout=60_000)
    before = heap_usage(page, cdp)
    accepted = page.evaluate(
        """
        () => {
          window.__quantSimulationPerfStart = performance.now();
          return window.__simulationFixture.runSimulation({ runs: 10_000 });
        }
        """
    )
    if not accepted:
        raise AssertionError("10k Simulation request was rejected by the controller")
    polled_progress: list[dict[str, object]] = []
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        state = page.evaluate("window.__simulationFixture.state()")
        runtime = state.get("simulationRuntime", {})
        run = runtime.get("run")
        if run:
            polled_progress.append(run)
        if (
            runtime.get("run") is None
            and state.get("report", {}).get("simulation", {}).get("runs") == 10_000
        ):
            break
        time.sleep(0.02)
    else:
        raise TimeoutError("10k Simulation did not settle within 30 seconds")
    elapsed = page.evaluate("performance.now() - window.__quantSimulationPerfStart")
    final = page.evaluate("window.__simulationFixture.state()")
    final_runtime = final.get("simulationRuntime") or {}
    # The fixture records every controller notification, including Worker
    # progress updates that can complete between two 20ms Python polls.
    progress = final_runtime.get("progressEvents") or polled_progress
    final_runtime = {
        key: value
        for key, value in final_runtime.items()
        if key != "progressEvents"
    }
    after = heap_usage(page, cdp)
    delta = None
    if before["usedBytes"] is not None and after["usedBytes"] is not None:
        delta = after["usedBytes"] - before["usedBytes"]
    if trace_path:
        context.tracing.stop(path=str(trace_path))
    context.close()
    return {
        "runs": 10_000,
        "elapsedMs": elapsed,
        "progressSamples": progress,
        "final": final_runtime,
        "heapBefore": before,
        "heapAfter": after,
        "heapDeltaBytes": delta,
        "pageErrors": errors,
        "tracePath": trace_label(trace_path),
    }


def check_budgets(
    results: list[dict[str, object]],
    simulation: dict[str, object],
) -> list[str]:
    failures: list[str] = []
    for result in results:
        count = result["count"]
        state = result["performance"]
        for host in state["chartHosts"]:
            if host["render"] > 2_000:
                failures.append(f"{count}: chart render points {host['render']} > 2000")
        log = result["tradeLog"]
        if log["initialRows"] > 200 or log["afterRows"] > 200:
            failures.append(f"{count}: Trades Log rendered {max(log['initialRows'], log['afterRows'])} rows")
        page_budget = 100 if count == 10_000 else 500
        if log["pageTransitionP95Ms"] > page_budget:
            failures.append(
                f"{count}: synchronous page transition p95 {log['pageTransitionP95Ms']:.1f}ms > {page_budget}ms"
            )
        drag = result["dockDrag"]
        if drag["fps"] < 50:
            failures.append(f"{count}: Dock drag FPS {drag['fps']:.1f} < 50")
        if drag["longTaskP95Ms"] > 50:
            failures.append(f"{count}: Dock long-task p95 {drag['longTaskP95Ms']:.1f}ms > 50ms")
        cycles = result["cycles"]
        delta = cycles["heapDeltaBytes"]
        if delta is not None and delta > 20 * 1024 * 1024:
            failures.append(f"{count}: heap delta {delta / 1024 / 1024:.1f}MiB > 20MiB")
        if cycles["afterResources"] != cycles["baselineResources"]:
            failures.append(f"{count}: open/close resources changed {cycles['baselineResources']} -> {cycles['afterResources']}")
        if result["finalResources"] != {"activeCharts": 0, "activeObservers": 0}:
            failures.append(f"{count}: final resources {result['finalResources']}")
        if result["pageErrors"]:
            failures.append(f"{count}: page errors {result['pageErrors']}")
        live_update = result.get("liveUpdate") or {}
        dock_stability = result.get("dockStability") or {}
        if not all(dock_stability.get(key) for key in ("stable", "sameHost", "sameSvg")):
            failures.append(f"{count}: Dock chart resized or rebuilt on identical live snapshots: {dock_stability}")
        if not live_update.get("errorVisible"):
            failures.append(f"{count}: terminal error with unchanged chart data did not replace the Viewer state")
        if not live_update.get("runChanged"):
            failures.append(f"{count}: identical chart/KPI data with a new runId did not refresh the Viewer header: {live_update}")
        if not live_update.get("sameHost"):
            failures.append(f"{count}: forming-bar update replaced the Dock chart host")
        if not live_update.get("sameMetricHost"):
            failures.append(f"{count}: scalar-only forming update replaced the Viewer chart host")
        if not live_update.get("sizeStable"):
            failures.append(f"{count}: Viewer chart host changed size without a layout action: {live_update}")
        if live_update.get("metricKpiAfter") == live_update.get("metricKpiBefore"):
            failures.append(f"{count}: scalar-only forming update left the Viewer KPI stale: {live_update}")
        if "234.56" not in (live_update.get("metricKpiAfter") or ""):
            failures.append(f"{count}: scalar-only Viewer KPI did not update: {live_update}")
        if live_update.get("beforeMetric") != live_update.get("afterMetric"):
            failures.append(f"{count}: scalar-only update changed chart resources {live_update}")
        if live_update.get("before") != live_update.get("after"):
            failures.append(f"{count}: forming-bar update changed chart resources {live_update}")
        if live_update.get("netProfit") != "+123.45 USD":
            failures.append(f"{count}: forming-bar KPI did not update: {live_update}")
    if simulation["elapsedMs"] > 20_000:
        failures.append(f"Simulation 10k elapsed {simulation['elapsedMs']:.1f}ms > 20s")
    if simulation["final"] is None or simulation["final"].get("run") is not None:
        failures.append(f"Simulation 10k left a pending run: {simulation['final']}")
    if simulation["final"] is None or simulation["final"].get("populationSize") != 16:
        failures.append(f"Simulation population contract changed: {simulation['final']}")
    if simulation["final"] is None or simulation["final"].get("runs") != 10_000:
        failures.append(f"Simulation run-count contract changed: {simulation['final']}")
    if simulation["final"] is None or simulation["final"].get("bandPoints", 0) <= 0:
        failures.append(f"Simulation confidence bands are empty: {simulation['final']}")
    progress = simulation.get("progressSamples") or []
    completed = [sample.get("completedRuns") for sample in progress]
    if not completed or completed[0] != 0 or completed[-1] != 10_000:
        failures.append(f"Simulation progress did not cover 0→10000: {progress}")
    if any(
        not isinstance(value, (int, float)) or value < 0 or value > 10_000
        for value in completed
    ) or any(left > right for left, right in zip(completed, completed[1:])):
        failures.append(f"Simulation progress is not bounded/monotonic: {progress}")
    sim_delta = simulation["heapDeltaBytes"]
    if sim_delta is not None and sim_delta > 20 * 1024 * 1024:
        failures.append(f"Simulation 10k heap delta {sim_delta / 1024 / 1024:.1f}MiB > 20MiB")
    if simulation["pageErrors"]:
        failures.append(f"Simulation 10k page errors {simulation['pageErrors']}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="fail when the plan budgets are exceeded")
    args = parser.parse_args()
    executable = os.environ.get("CHROMIUM_EXECUTABLE") or CHROMIUM_DEFAULT
    if not Path(executable).exists():
        executable = ""
    server = subprocess.Popen(
        [
            str(ROOT / "node_modules/.bin/vite")
            if (ROOT / "node_modules/.bin/vite").exists()
            else "npx",
            *([] if (ROOT / "node_modules/.bin/vite").exists() else ["vite"]),
            "--config",
            str(ROOT / "tests/vite-performance.config.ts"),
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
    artifact_dir = ROOT / "artifacts"
    artifact_dir.mkdir(exist_ok=True)
    started = datetime.now(timezone.utc)
    try:
        wait_for_server(server)
        launch_options: dict[str, object] = {
            "headless": True,
            "args": ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
        }
        if executable:
            launch_options["executable_path"] = executable
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(**launch_options)
            results: list[dict[str, object]] = []
            save_artifacts = os.environ.get("QUANT_PERF_ARTIFACT") == "1"
            for count in (10_000, 100_000):
                trace = artifact_dir / f"backtest-performance-{count}.zip" if save_artifacts else None
                results.append(measure_case(browser, count, trace))
            simulation_trace = artifact_dir / "backtest-performance-simulation.zip" if save_artifacts else None
            simulation = measure_simulation(browser, simulation_trace)
            browser.close()
        report = {
            "generatedAt": started.isoformat(),
            "finishedAt": datetime.now(timezone.utc).isoformat(),
            "viewport": {"width": 1440, "height": 900, "deviceScaleFactor": 1},
            "browser": executable or "playwright-default",
            "results": results,
            "simulation": simulation,
        }
        print(json.dumps(report, indent=2, sort_keys=True))
        if os.environ.get("QUANT_PERF_ARTIFACT") == "1":
            output = artifact_dir / "backtest-performance-latest.json"
            output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
            print(f"performance artifact: {output}")
        failures = check_budgets(results, simulation)
        if failures:
            print("performance budget failures:", file=sys.stderr)
            for failure in failures:
                print(f"- {failure}", file=sys.stderr)
            if args.strict:
                return 1
        return 0
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
