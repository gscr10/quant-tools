#!/usr/bin/env python3
"""Browser performance gate for large backtest reports.

The normal unit benchmark proves that selectors and samplers are bounded, but
it cannot see DOM row counts, Highcharts/ResizeObserver lifetimes, compositor
frames, long tasks, or browser heap usage. This runner measures those signals
for 10k and 100k ledgers, cold report selectors, range/line tooltips and actual
Simulation Worker cancellation after computation begins.

Run ``python3 tests/backtest_performance.py`` for a report.  ``--strict``
applies the plan's first-pass budgets (200 rendered rows, 2,000 chart points,
50 FPS, 50ms long-task p95, and <=20MiB heap growth after ten open/close
cycles). Chromium exposes precise JS heap and long-task entries; Firefox
reports those unavailable instead of pretending an absent metric is zero.
Use ``--production --browsers chromium,firefox --output audit-evidence/<run>``
to build an isolated static production artifact with app configuration and
save source/build hashes, JSON and traces. Ordinary deployment dist is never
overwritten. ``--dpr 2`` repeats the same matrix at a second pixel density.
``QUANT_PERF_ARTIFACT=1`` retains the legacy artifacts/ output option.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import statistics
import subprocess
import socket
import sys
import tempfile
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


def source_hashes() -> dict[str, str]:
    files = [*ROOT.joinpath('src').rglob('*.ts'), *ROOT.joinpath('src').rglob('*.css'),
             ROOT / 'vite.config.ts', ROOT / 'package-lock.json',
             ROOT / 'tests/vite-runtime-performance.config.ts',
             ROOT / 'tests/fixtures/backtest-runtime-probes.ts',
             ROOT / 'tests/fixtures/backtest-performance.html',
             ROOT / 'tests/fixtures/backtest-simulation.html']
    return {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(files)}


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


def install_error_probe(page: Page) -> None:
    # ResizeObserver loop failures can arrive only as window ErrorEvent and
    # never trigger Playwright's pageerror event. Observe both independently.
    page.add_init_script("""(() => {
      window.__quantPerfWindowErrors = [];
      window.addEventListener('error', event => {
        window.__quantPerfWindowErrors.push(event.message || 'Resource ErrorEvent');
      });
      window.addEventListener('unhandledrejection', event => {
        window.__quantPerfWindowErrors.push(String(event.reason?.stack || event.reason));
      });
    })()""")


def install_raf_probe(page: Page) -> None:
    page.evaluate(
        """
        (() => {
          const longTaskSupported = PerformanceObserver?.supportedEntryTypes?.includes('longtask') ?? false;
          const state = { running: false, started: 0, ended: 0, frames: [], longTasks: [] };
          window.__quantPerfProbe = {
            start() {
              state.running = true;
              state.started = performance.now();
              state.ended = 0;
              state.frames = [];
              state.longTasks = [];
              if (longTaskSupported) {
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
                longTaskSupported,
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
    page.evaluate("""() => {
      const original = HTMLElement.prototype.focus;
      window.__quantPaginationFocusProbe = { original, samples: [] };
      window.__quantPaginationIdentity = {
        panel: document.querySelector('#quant-backtest-trades-view-panel'),
        pager: document.querySelector('.quant-backtest-trade-pagination'),
      };
      HTMLElement.prototype.focus = function (...args) {
        const started = performance.now();
        try { return original.apply(this, args); }
        finally { window.__quantPaginationFocusProbe.samples.push(performance.now() - started); }
      };
    }""")

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
    focus_durations = page.evaluate("""() => {
      const probe = window.__quantPaginationFocusProbe;
      HTMLElement.prototype.focus = probe.original;
      delete window.__quantPaginationFocusProbe;
      return probe.samples;
    }""")
    identity = page.evaluate("""() => {
      const before = window.__quantPaginationIdentity;
      const panel = document.querySelector('#quant-backtest-trades-view-panel');
      const pager = document.querySelector('.quant-backtest-trade-pagination');
      delete window.__quantPaginationIdentity;
      return { samePanel: before.panel === panel, samePager: before.pager === pager,
        role: panel?.getAttribute('role'), labelledBy: panel?.getAttribute('aria-labelledby'),
        tabIndex: panel?.tabIndex, focusStayedInPager: pager?.contains(document.activeElement) };
    }""")
    return {
        "initialRows": rows,
        "initialStatus": page_status,
        "afterRows": after["tableRows"],
        "afterStatus": after["pageStatus"],
        "pageTransitionP50Ms": statistics.median(durations),
        "pageTransitionP95Ms": percentile_nearest_rank(durations, 0.95),
        "pageTransitionMaxMs": max(durations),
        "focusDurationsMs": focus_durations,
        "identity": identity,
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


def measure_case(browser: Browser, count: int, trace_path: Path | None, dpr: float = 1, heap_snapshot: bool = False) -> dict[str, object]:
    context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=dpr)
    if trace_path:
        context.tracing.start(screenshots=False, snapshots=True, sources=True)
    page = context.new_page()
    install_error_probe(page)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on('crash', lambda _: print(f'performance page crashed: {browser.browser_type.name} {count}', flush=True))
    page.on('framenavigated', lambda frame: print(f'performance navigation: {browser.browser_type.name} {count} {frame.url}', flush=True)
            if frame == page.main_frame else None)
    requests: list[str] = []
    page.on('request', lambda request: requests.append(request.url))
    cdp = context.new_cdp_session(page) if browser.browser_type.name == 'chromium' else None
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
    if cdp is not None and trace_path:
        cdp.send('Profiler.enable')
        cdp.send('Profiler.start')
    selector_trace = page.evaluate("window.__backtestPerformance.selectorTrace()")
    if cdp is not None and trace_path:
        profile = cdp.send('Profiler.stop')['profile']
        profile_path = trace_path.with_suffix('.cpuprofile')
        profile_path.write_text(json.dumps(profile) + '\n')
        selector_trace['cpuProfile'] = trace_label(profile_path)
    range_probe = page.evaluate("window.__backtestRuntimeProbes.mountRangeProbe(window.__backtestPerformance.count)")
    # Highcharts lazily builds its pointer search tree on the first event.
    # An actual short pointer stream exercises that asynchronous path too.
    page.mouse.move(range_probe['x'] - 4, range_probe['y'])
    page.wait_for_timeout(100)
    page.mouse.move(range_probe['x'], range_probe['y'])
    page.wait_for_function("document.querySelector('#runtime-range-probe .highcharts-tooltip')?.textContent?.includes('Median')")
    range_probe['tooltip'] = page.locator('#runtime-range-probe').inner_text()
    range_probe['afterUnmount'] = page.evaluate("window.__backtestRuntimeProbes.unmountRangeProbe()")
    early_destroy = page.evaluate("window.__backtestRuntimeProbes.chartEarlyDestroy()")
    constructor_failure = page.evaluate("window.__backtestRuntimeProbes.chartConstructionFailure()")
    page.evaluate("window.__backtestPerformance.destroy()")
    page.wait_for_timeout(150)
    final_resources = page.evaluate("window.__backtestPerformance.chartResources()")
    window_errors = page.evaluate('window.__quantPerfWindowErrors')
    heap_path = None
    if heap_snapshot and cdp is not None and trace_path and count == 100_000:
        heap_path = trace_path.with_suffix('.heapsnapshot.gz')
        with gzip.open(heap_path, 'wt') as stream:
            def heap_chunk(event):
                stream.write(event['chunk'])
            cdp.on('HeapProfiler.addHeapSnapshotChunk', heap_chunk)
            try:
                cdp.send('HeapProfiler.collectGarbage')
                cdp.send('HeapProfiler.takeHeapSnapshot')
            finally:
                cdp.remove_listener('HeapProfiler.addHeapSnapshotChunk', heap_chunk)
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
        "selectors": selector_trace,
        "rangeProbe": range_probe,
        "earlyDestroy": early_destroy,
        "constructorFailure": constructor_failure,
        "finalResources": final_resources,
        "pageErrors": errors,
        "windowErrors": window_errors,
        "externalRequests": [url for url in requests if not url.startswith(f'http://{HOST}:{PORT}/')],
        "devModuleRequests": [url for url in requests if '/@vite/' in url or '/src/' in url],
        "tracePath": trace_label(trace_path),
        "heapSnapshotPath": trace_label(heap_path),
    }


def measure_simulation(browser: Browser, trace_path: Path | None = None) -> dict[str, object]:
    """Run the real controller/Worker path at its supported 10k upper bound."""
    context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    if trace_path:
        context.tracing.start(screenshots=False, snapshots=True, sources=True)
    page = context.new_page()
    install_error_probe(page)
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    requests: list[str] = []
    page.on('request', lambda request: requests.append(request.url))
    cdp = context.new_cdp_session(page) if browser.browser_type.name == 'chromium' else None
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
    window_errors = page.evaluate('window.__quantPerfWindowErrors')
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
        "windowErrors": window_errors,
        "externalRequests": [url for url in requests if not url.startswith(f'http://{HOST}:{PORT}/')],
        "devModuleRequests": [url for url in requests if '/@vite/' in url or '/src/' in url],
        "tracePath": trace_label(trace_path),
    }


def measure_worker_lifecycle(browser: Browser) -> dict[str, object]:
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    install_error_probe(page)
    errors: list[str] = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    requests: list[str] = []
    page.on('request', lambda request: requests.append(request.url))
    page.goto(f"{FIXTURE}?count=1000", wait_until='domcontentloaded')
    page.wait_for_function('window.__backtestPerformance?.ready === true')
    result = page.evaluate('window.__backtestRuntimeProbes.simulationLifecycle()')
    page.evaluate('window.__backtestPerformance.destroy()')
    result['finalCharts'] = page.evaluate('window.__backtestPerformance.chartResources()')
    result['pageErrors'] = errors
    result['windowErrors'] = page.evaluate('window.__quantPerfWindowErrors')
    result['externalRequests'] = [url for url in requests if not url.startswith(f'http://{HOST}:{PORT}/')]
    result['devModuleRequests'] = [url for url in requests if '/@vite/' in url or '/src/' in url]
    context.close()
    return result


def check_budgets(
    results: list[dict[str, object]],
    simulation: dict[str, object],
    enforce_baseline_timing: bool = True,
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
        identity = log['identity']
        if (not identity['samePanel'] or not identity['samePager'] or not identity['focusStayedInPager']
            or identity['role'] != 'tabpanel' or identity['tabIndex'] != 0
            or identity['labelledBy'] != 'quant-backtest-trades-view-list'):
            failures.append(f"{count}: paging lost DOM/focus/tabpanel semantics: {identity}")
        page_budget = 100 if count == 10_000 else 500
        if enforce_baseline_timing and log["pageTransitionP95Ms"] > page_budget:
            failures.append(
                f"{count}: synchronous page transition p95 {log['pageTransitionP95Ms']:.1f}ms > {page_budget}ms"
            )
        drag = result["dockDrag"]
        if enforce_baseline_timing and drag["fps"] < 50:
            failures.append(f"{count}: Dock drag FPS {drag['fps']:.1f} < 50")
        if enforce_baseline_timing and drag["longTaskP95Ms"] > 50:
            failures.append(f"{count}: Dock long-task p95 {drag['longTaskP95Ms']:.1f}ms > 50ms")
        cycles = result["cycles"]
        delta = cycles["heapDeltaBytes"]
        if enforce_baseline_timing and delta is not None and delta > 20 * 1024 * 1024:
            failures.append(f"{count}: heap delta {delta / 1024 / 1024:.1f}MiB > 20MiB")
        if cycles["afterResources"] != cycles["baselineResources"]:
            failures.append(f"{count}: open/close resources changed {cycles['baselineResources']} -> {cycles['afterResources']}")
        if result["finalResources"] != {"activeCharts": 0, "activeObservers": 0}:
            failures.append(f"{count}: final resources {result['finalResources']}")
        if result["pageErrors"]:
            failures.append(f"{count}: page errors {result['pageErrors']}")
        if result['windowErrors']:
            failures.append(f"{count}: window errors {result['windowErrors']}")
        selectors = result['selectors']
        if selectors['durationRows'] != count:
            failures.append(f"{count}: aggregate stress case omitted the populated duration scatter")
        if enforce_baseline_timing and selectors['p95']['combined'] > page_budget:
            failures.append(f"{count}: aggregate selector p95 {selectors['p95']['combined']:.1f}ms > {page_budget}ms")
        ranges = result['rangeProbe']
        if not ranges['extremaPreserved'] or any(value > 2_000 for value in ranges['renderCounts']):
            failures.append(f"{count}: range series exceeded sample budget or lost extrema")
        if not all(label in ranges['tooltip'] for label in ('Median', '5–95%')):
            failures.append(f"{count}: shared tooltip omitted a range/line series: {ranges['tooltip']}")
        if ranges['afterUnmount'] != cycles['afterResources']:
            failures.append(f"{count}: range chart did not release resources")
        if result['earlyDestroy']['before'] != result['earlyDestroy']['after']:
            failures.append(f"{count}: async chart mount resurrected after destroy")
        if result['constructorFailure']['before'] != result['constructorFailure']['after'] or 'injected report observer' not in result['constructorFailure']['message']:
            failures.append(f"{count}: partially constructed chart leaked or fault injection failed")
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
    if simulation['windowErrors']:
        failures.append(f"Simulation 10k window errors {simulation['windowErrors']}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="fail when the plan budgets are exceeded")
    parser.add_argument("--production", action="store_true", help="build isolated production app + fixtures and serve static assets")
    parser.add_argument("--browsers", default="chromium", help="comma separated installed Playwright browsers")
    parser.add_argument("--dpr", type=float, default=1)
    parser.add_argument("--output", type=Path, help="local artifact directory; never modifies deployment dist")
    parser.add_argument("--heap-snapshot", action="store_true", help="save the Chromium 100k post-destroy heap when artifacts are enabled")
    args = parser.parse_args()
    executable = os.environ.get("CHROMIUM_EXECUTABLE") or CHROMIUM_DEFAULT
    if not Path(executable).exists():
        executable = ""
    vite_command = [
            str(ROOT / "node_modules/.bin/vite")
            if (ROOT / "node_modules/.bin/vite").exists()
            else "npx",
            *([] if (ROOT / "node_modules/.bin/vite").exists() else ["vite"]),
        ]
    build_dir = None
    source_before_build = source_hashes()
    artifact_hashes: dict[str, str] = {}
    if args.production:
        build_dir = tempfile.TemporaryDirectory(prefix='quant-runtime-performance-')
        subprocess.run([
            *vite_command, 'build', '--config', str(ROOT / 'tests/vite-runtime-performance.config.ts'),
            '--outDir', build_dir.name, '--emptyOutDir',
        ], cwd=ROOT, check=True)
        artifact_hashes = {str(path.relative_to(build_dir.name)): hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in sorted(Path(build_dir.name).rglob('*')) if path.is_file()}
    source_after_build = source_hashes()
    if source_before_build != source_after_build:
        raise RuntimeError('Source changed during production build; rerun from a stable source snapshot')
    # Refuse an existing listener instead of mistaking somebody else's Vite
    # HTTP 200 for this run's production server while our child exits.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((HOST, PORT))
    server = subprocess.Popen(
        [
            *vite_command,
            *(['preview', '--outDir', build_dir.name] if build_dir else []),
            "--config",
            str(ROOT / ("tests/vite-runtime-performance.config.ts" if args.production else "tests/vite-performance.config.ts")),
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
    artifact_dir = args.output or ROOT / "artifacts"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc)
    try:
        wait_for_server(server)
        if args.production:
            with urlopen(FIXTURE, timeout=5) as response:
                served_hash = hashlib.sha256(response.read()).hexdigest()
            expected_hash = artifact_hashes['tests/fixtures/backtest-performance.html']
            if served_hash != expected_hash or server.poll() is not None:
                raise RuntimeError('Preview identity mismatch: served HTML is not the isolated production build')
        launch_options: dict[str, object] = {
            "headless": True,
            "args": ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
        }
        if executable:
            launch_options["executable_path"] = executable
        browser_reports = []
        failures = []
        save_artifacts = args.output is not None or os.environ.get("QUANT_PERF_ARTIFACT") == "1"
        with sync_playwright() as playwright:
            for browser_name in args.browsers.split(','):
                browser = getattr(playwright, browser_name).launch(**(launch_options if browser_name == 'chromium' else {'headless': True}))
                results: list[dict[str, object]] = []
                for count in (10_000, 100_000):
                    trace = artifact_dir / f"backtest-performance-{browser_name}-{count}.zip" if save_artifacts else None
                    results.append(measure_case(browser, count, trace, args.dpr, args.heap_snapshot))
                    if save_artifacts:
                        (artifact_dir / f'{browser_name}-{count}.json').write_text(json.dumps(results[-1], indent=2) + '\n')
                simulation_trace = artifact_dir / f"backtest-performance-{browser_name}-simulation.zip" if save_artifacts else None
                simulation = measure_simulation(browser, simulation_trace)
                lifecycle = measure_worker_lifecycle(browser)
                is_baseline = browser_name == 'chromium' and args.dpr == 1
                current_failures = check_budgets(results, simulation, enforce_baseline_timing=is_baseline)
                extended_timing = [] if is_baseline else [message for message in check_budgets(results, simulation)
                                                          if message not in current_failures]
                if any(result['externalRequests'] or (args.production and result['devModuleRequests']) for result in [*results, simulation, lifecycle]):
                    current_failures.append('Production performance fixture made external or source module requests')
                for outcome in lifecycle['results']:
                    if outcome['status'] != outcome['kind'] or outcome['elapsedMs'] > 100 or outcome['activeWorkers'] or outcome['lateProgress']:
                        current_failures.append(f"Simulation cancellation contract failed: {outcome}")
                    if not any(value > 0 for value in outcome['progress']):
                        current_failures.append(f"Simulation was cancelled before actual Worker computation: {outcome}")
                    if outcome['kind'] == 'superseded' and outcome['replacementRuns'] != 1_000:
                        current_failures.append(f"Superseding Worker never published the replacement result: {outcome}")
                if (lifecycle['activeWorkers'] or lifecycle['fallbackErrors'] or lifecycle['pageErrors'] or lifecycle['windowErrors']
                    or lifecycle['finalCharts'] != {'activeCharts': 0, 'activeObservers': 0}):
                    current_failures.append(f"Simulation Worker lifecycle leaked/failed: {lifecycle}")
                failures.extend(f'{browser_name}: {failure}' for failure in current_failures)
                browser_reports.append({'browser': browser_name, 'version': browser.version, 'results': results, 'simulation': simulation,
                    'workerLifecycle': lifecycle, 'failures': current_failures,
                    'fixedChromiumBaselineBudgetApplies': is_baseline, 'extendedTimingObservations': extended_timing})
                browser.close()
        source_at_finish = source_hashes()
        if source_at_finish != source_before_build:
            failures.append('Source changed while the production performance run was in progress')
        report = {
            "generatedAt": started.isoformat(),
            "finishedAt": datetime.now(timezone.utc).isoformat(),
            "viewport": {"width": 1440, "height": 900, "deviceScaleFactor": args.dpr},
            "mode": 'production' if args.production else 'development',
            "browserReports": browser_reports,
            "failures": failures,
            "sourceHashesAtBuild": source_before_build,
            "buildSourceStable": source_before_build == source_after_build,
            "sourceStableThroughout": source_before_build == source_at_finish,
            "sourceHashesAtFinish": source_at_finish,
            "artifactHashes": artifact_hashes,
            "device": {"platform": platform.platform(), "machine": platform.machine(),
                       "cpuCount": os.cpu_count(), "python": platform.python_version()},
        }
        print(json.dumps(report, indent=2, sort_keys=True))
        if save_artifacts:
            output = artifact_dir / "backtest-performance-latest.json"
            output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
            print(f"performance artifact: {output}")
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
        if build_dir:
            build_dir.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
