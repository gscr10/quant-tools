#!/usr/bin/env python3
"""Desktop Simulation controls through the actual Controller and Workbench.

Starts an isolated Vite server, or accepts --base-url for an existing server.
The synthetic ledger is an explicit control fixture, not reference parity evidence.
"""
import argparse
import json
from contextlib import contextmanager
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def serve(base_url, output):
    if base_url:
        yield base_url.rstrip("/")
        return
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base_url = f"http://127.0.0.1:{port}"
    with output.with_suffix(".server.log").open("w") as log:
        server = subprocess.Popen([
            str(ROOT / "node_modules/.bin/vite"), "--config", "tests/vite-trade-location.config.ts",
            "--host", "127.0.0.1", "--port", str(port), "--strictPort",
        ], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 45
            while True:
                try:
                    with urlopen(base_url, timeout=1):
                        break
                except OSError:
                    if server.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError("Simulation test Vite server was not ready")
                    time.sleep(0.1)
            yield base_url
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()

def verify_pointer_tooltip_escape(page, check):
    """A pointer tooltip must be dismissible before Escape exits its Viewer."""
    viewer = page.locator('.quant-backtest-viewer')
    tab = page.locator('[data-tab="simulation"]')
    opener = page.get_by_role('button', name='Open backtest viewer', exact=True)

    def hover_path():
        page.locator('.quant-backtest-simulation-paths-host').scroll_into_view_if_needed()
        point = page.evaluate("""async () => {
          const H=await(await import('/src/features/backtesting/highcharts-renderer.ts')).loadHighcharts();
          const chart=H.charts.find(c=>c?.renderTo.classList.contains('quant-backtest-simulation-paths-host'));
          const point=chart.series[3].points[8],rect=chart.renderTo.getBoundingClientRect();
          return {x:rect.x+chart.xAxis[0].toPixels(point.x),y:rect.y+chart.yAxis[0].toPixels(point.y)};
        }""")
        page.mouse.move(0, 0)
        page.mouse.move(point['x'] - 2, point['y'])
        # First actual hover lets Highcharts construct its deferred KD tree.
        page.wait_for_timeout(100)
        page.mouse.move(point['x'] + 2, point['y'])
        page.wait_for_timeout(100)
        page.mouse.move(point['x'], point['y'])
        page.wait_for_function("""() => {
          const tip=document.querySelector('.quant-backtest-simulation-paths-host g.highcharts-tooltip');
          return tip&&getComputedStyle(tip).visibility==='visible';
        }""")

    def reopen():
        opener.click()
        tab.click()
        page.wait_for_function("document.querySelectorAll('#Simulation .highcharts-container').length===3")

    hover_path()
    check('Pointer hover does not steal Simulation Tab focus', tab.evaluate('el=>el===document.activeElement'))
    page.keyboard.press('Escape')
    check('First pointer-tooltip Escape keeps Viewer open', viewer.is_visible())
    check('First pointer-tooltip Escape hides tooltip and retains Tab focus',
          tab.evaluate("""el=>el===document.activeElement&&
            getComputedStyle(document.querySelector('.quant-backtest-simulation-paths-host g.highcharts-tooltip')).visibility==='hidden'"""))
    page.keyboard.press('Escape')
    check('Second Escape exits Viewer and returns to host trigger',
          viewer.is_hidden() and opener.evaluate('el=>el===document.activeElement'))
    reopen()
    hover_path()
    page.mouse.move(0, 0)
    page.wait_for_function("""() => {
      const tip=document.querySelector('.quant-backtest-simulation-paths-host g.highcharts-tooltip');
      return tip&&getComputedStyle(tip).visibility==='hidden';
    }""")
    page.keyboard.press('Escape')
    check('After pointer leave Escape exits normally without a stale tooltip trap',
          viewer.is_hidden() and opener.evaluate('el=>el===document.activeElement'))
    reopen()


def verify_path_bands(page, check):
    """Explore real range points and visible boundaries without changing a run."""
    host = page.locator('.quant-backtest-simulation-paths-host')
    host.scroll_into_view_if_needed()
    state_before = page.evaluate('__simulationFixture.state()')
    before = page.evaluate("""async () => {
      const H = await (await import('/src/features/backtesting/highcharts-renderer.ts')).loadHighcharts();
      const chart = H.charts.find(c => c?.renderTo.classList.contains('quant-backtest-simulation-paths-host'));
      window.__simulationBandCheck = chart;
      return chart.series.map(series => {
        const style = getComputedStyle(series.graph.element);
        return {name:series.name,type:series.type,stroke:style.stroke,width:parseFloat(style.strokeWidth),
          dash:style.strokeDasharray,tracking:series.options.enableMouseTracking,
          data:series.points.map(p => ({x:p.x,y:p.y,low:p.low,high:p.high}))};
      });
    }""")
    bands = before[:2]
    check('Both probability bands have visible opaque boundaries', all(
        band['type'] == 'arearange' and band['width'] >= 1 and band['stroke'] != 'none'
        for band in bands))
    check('Outer and inner bands have non-color line distinctions',
          bands[0]['dash'] != 'none' and bands[1]['dash'] == 'none')
    check('Both probability ranges support pointer tracking', all(band['tracking'] for band in bands))
    legend = host.locator('xpath=..').locator('.quant-backtest-simulation-chart-legend')
    check('Both range identities have separate legend labels', all(
        legend.locator('span', has_text=band['name']).count() == 1 for band in bands))
    styles = legend.locator('i[class*="legend-band-"]').evaluate_all(
        "items=>items.map(el=>({style:getComputedStyle(el).borderTopStyle,width:parseFloat(getComputedStyle(el).borderTopWidth)}))")
    check('Legend distinguishes dashed and solid range boundaries',
          {style['style'] for style in styles} == {'dashed', 'solid'} and all(style['width'] >= 1 for style in styles))
    nav = host.locator('[data-quant-report-curve]')
    check('Keyboard covers all original range and line points',
          int(nav.get_attribute('data-quant-report-curve-count')) == sum(len(s['data']) for s in before))
    for index, band in enumerate(bands):
        raw_index = min(8, len(band['data']) - 1)
        target = sum(len(s['data']) for s in before[:index]) + raw_index
        nav.focus()
        nav.press('Home')
        for _ in range(target):
            nav.press('ArrowRight')
        point = band['data'][raw_index]
        observed = nav.evaluate("""el=>({index:Number(el.dataset.quantReportCurveIndex),
          status:el.querySelector('[data-quant-report-curve-status]').textContent,
          tooltip:[...el.querySelectorAll('.highcharts-tooltip')].map(t=>t.textContent).join(' ')})""")
        check(band['name'] + ' keyboard selects its actual source point', observed['index'] == target)
        check(band['name'] + ' exposes both original endpoints and currency',
              band['name'] in observed['status'] and
              f"{point['low']:g} to {point['high']:g} USD" in observed['status'])
        check(band['name'] + ' tooltip names the range and values',
              band['name'] in observed['tooltip'] and
              f"{point['low']:.2f} – {point['high']:.2f}" in observed['tooltip'])
    nav.press('Escape')
    check('Escape dismisses band tooltip while retaining chart keyboard focus',
          nav.evaluate("el=>el===document.activeElement && el.querySelector('[data-quant-report-curve-status]').textContent==='' && __simulationBandCheck.tooltip.isHidden"))
    after = page.evaluate("__simulationBandCheck.series.map(s=>s.points.map(p=>({x:p.x,y:p.y,low:p.low,high:p.high})))")
    check('Band exploration leaves all plotted values unchanged', after == [series['data'] for series in before])
    check('Band exploration does not change the simulation or source lifecycle',
          page.evaluate('__simulationFixture.state()') == state_before)


def run_case(browser, name, width, base_url, output):
    context = browser.new_context(viewport={"width": width, "height": 1000})
    page = context.new_page()
    page.set_default_timeout(30000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    checks = []

    def check(label, value):
        checks.append({"label": label, "passed": bool(value)})
        assert value, label

    try:
        page.goto(base_url + "/tests/fixtures/backtest-simulation.html")
        page.wait_for_function("window.__simulationFixture?.ready")
        page.get_by_role("button", name="Open backtest viewer", exact=True).click()
        page.locator('[data-tab="simulation"]').click()
        page.wait_for_function("document.querySelectorAll('#Simulation .highcharts-container').length === 3")
        verify_pointer_tooltip_escape(page, check)
        verify_path_bands(page, check)
        page.get_by_role("button", name="Simulation settings", exact=True).filter(visible=True).click()
        dialog = page.get_by_role("dialog", name="Simulation settings", exact=True)
        runs = page.get_by_role("combobox", name="Simulations", exact=True)
        check("Modal description is programmatically associated", dialog.get_attribute("aria-describedby") == "quant-backtest-simulation-settings-description")
        check("Native value model retained", page.locator("#quant-backtest-simulation-runs").input_value() == "1000")
        preserve_style = page.locator('.quant-backtest-simulation-preserve').evaluate("""row=>{
          const input=row.querySelector('input'),label=row.querySelector('span'),r=row.getBoundingClientRect(),i=input.getBoundingClientRect(),l=label.getBoundingClientRect();
          const style=getComputedStyle(row),control=getComputedStyle(input),thumb=getComputedStyle(input,'::after');
          return {shadow:style.boxShadow,background:style.backgroundColor,radius:style.borderRadius,height:r.height,
            margin:control.margin,padding:control.padding,width:i.width,toggleHeight:i.height,opacity:control.opacity,
            thumbWidth:thumb.width,thumbHeight:thumb.height,leftInset:i.left-r.left,labelGap:l.left-i.right};
        }""")
        check("Preserve row has native 1px translucent ring", preserve_style['shadow'] == 'rgba(255, 255, 255, 0.05) 0px 0px 0px 1px')
        check("Preserve row uses elevated muted background", preserve_style['background'] == 'color(srgb 0.109804 0.113725 0.12549 / 0.2)')
        check("Preserve layout has no native input margin shift", preserve_style['margin'] == '0px' and preserve_style['padding'] == '0px' and preserve_style['leftInset'] == 12 and preserve_style['labelGap'] == 12)
        check("Preserve native component dimensions and disabled opacity", preserve_style['width'] == 32 and abs(preserve_style['toggleHeight'] - 18.4) < 0.02 and preserve_style['thumbWidth'] == '16px' and preserve_style['thumbHeight'] == '16px' and preserve_style['opacity'] == '0.5' and preserve_style['height'] == 44)
        dialog.screenshot(path=str(output.parent / f'{name}-{width}-preserve-settings.png'))
        runs.click()
        options = page.get_by_role("listbox", name="Simulations", exact=True)
        check("Reference option labels", options.inner_text().splitlines() == ["250 runs", "1,000 runs", "2,500 runs"])
        check("Selected run count exposed", options.get_by_role("option", selected=True).inner_text() == "1,000 runs")
        dialog.locator('h3').click()
        check("Clicking a nonfocusable modal area dismisses popup", options.is_hidden() and dialog.is_visible())
        runs.click()
        page.keyboard.press("Shift+Tab")
        check("Shift Tab closes runs popup and reaches help", options.is_hidden() and page.get_by_role("button", name="About Simulations", exact=True).evaluate("e=>e===document.activeElement"))
        runs.click()
        check("Focused help does not block a pointer reopening runs", options.is_visible())
        page.keyboard.press("Escape")
        check("First Escape closes list and restores trigger", dialog.is_visible() and options.is_hidden() and runs.evaluate("e=>e===document.activeElement"))
        runs.press("ArrowDown")
        page.keyboard.press("End")
        check("End focuses last option", page.evaluate("document.activeElement.textContent") == "2,500 runs")
        page.keyboard.press("Home")
        page.keyboard.press("Enter")
        page.wait_for_function("__simulationFixture.state().report.simulation.runs === 250")
        check("Selection publishes numeric model once", page.evaluate("__simulationFixture.state().simulationChangeCount") == 1)
        check("Selection redraw restores runs trigger", runs.evaluate("e=>e===document.activeElement"))
        runs.click()
        page.keyboard.press("Tab")
        check("Tab closes popup and advances inside modal", options.is_hidden() and dialog.evaluate("e=>e.contains(document.activeElement)"))
        variation = page.locator("#quant-backtest-simulation-variation")
        variation.fill("35")
        page.keyboard.press("Tab")
        page.wait_for_function("__simulationFixture.state().report.simulation.variationPercent === 35")
        check("Variation redraw enables and focuses Preserve", page.locator("#quant-backtest-simulation-preserve").is_enabled() and page.locator("#quant-backtest-simulation-preserve").evaluate("e=>e===document.activeElement"))
        close = dialog.get_by_role("button", name="Close simulation settings", exact=True)
        close.focus()
        page.keyboard.press("Shift+Tab")
        check("Shift Tab remains in modal", dialog.evaluate("e=>e.contains(document.activeElement)"))
        page.keyboard.press("Escape")
        check("Second Escape closes modal and restores settings", dialog.count() == 0 and page.locator(".quant-backtest-simulation-settings-button").evaluate("e=>e===document.activeElement"))
        page.get_by_role("button", name="Simulation settings", exact=True).filter(visible=True).click()
        runs.click()
        page.evaluate("__simulationFixture.destroy()")
        check("Destroy releases popup and charts", page.locator(".quant-backtest-simulation-runs-menu,.highcharts-container").count() == 0)
        check("No browser errors", errors == [])
        return {"browser": name, "width": width, "checks": checks, "preserveStyle": preserve_style, "passed": True}
    finally:
        context.close()


def run_lifecycle_case(browser, name, base_url, output):
    """Use the real Worker, delaying delivery of its real responses to test unmount races."""
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    context.add_init_script("""(() => {
      const NativeWorker = window.Worker;
      const audit = window.__simulationWorkerDelivery = {records: [], release(index) {
        const record = this.records[index];
        for (const message of record.queue.splice(0)) message.deliver();
      }};
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.record = {queue: [], kinds: [], terminated: false};
          audit.records.push(this.record);
        }
        addEventListener(type, listener, options) {
          if (type !== 'message') return super.addEventListener(type, listener, options);
          return super.addEventListener(type, event => {
            this.record.kinds.push(event.data.kind);
            this.record.queue.push({deliver: () => typeof listener === 'function'
              ? listener.call(this, event) : listener.handleEvent(event)});
          }, options);
        }
        terminate() { this.record.terminated = true; super.terminate(); }
      };
    })();""")
    page = context.new_page()
    page.set_default_timeout(30000)
    errors, external, checks = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: external.append(request.url)
            if request.url.startswith(('http:', 'https:')) and not request.url.startswith(base_url + '/') else None)

    def check(label, value):
        checks.append({'label': label, 'passed': bool(value)})
        assert value, label

    def state():
        return page.evaluate('__simulationFixture.state()')

    def enter():
        page.locator('[data-tab="simulation"]').click()
        page.wait_for_function("document.querySelectorAll('#Simulation .highcharts-container').length === 3")

    def start_worker(variation, index):
        check(f'Worker {index + 1} requested through real controller', page.evaluate(
            'variation => __simulationFixture.runSimulation({runs:2500, variationPercent:variation})', variation))
        page.wait_for_function('index => __simulationWorkerDelivery.records[index]?.kinds.includes("complete")', arg=index)
        check(f'Worker {index + 1} executed real progress and completion', page.evaluate(
            'index => __simulationWorkerDelivery.records[index].kinds.includes("progress")', index))
        check(f'Worker {index + 1} remains pending until delivery', state()['simulationRuntime']['run']['status'] == 'pending')

    try:
        page.goto(base_url + '/tests/fixtures/backtest-simulation.html')
        page.wait_for_function('window.__simulationFixture?.ready')
        defaults = state()['report']['simulation']
        original_source = state()['source']
        opener = page.get_by_role('button', name='Open backtest viewer', exact=True)
        opener.click()
        enter()
        # Actual parameter changes are made through the mounted controls.
        page.get_by_role('button', name='Simulation settings', exact=True).filter(visible=True).click()
        page.get_by_role('combobox', name='Simulations', exact=True).click()
        page.get_by_role('option', name='250 runs', exact=True).click()
        page.locator('#quant-backtest-simulation-variation').fill('25')
        page.keyboard.press('Tab')
        page.locator('#quant-backtest-simulation-preserve').check()
        page.keyboard.press('Escape')
        configured = state()['report']['simulation']
        check('Mounted controls have non-default runs, variation and preserve',
              configured['runs'] == 250 and configured['variationPercent'] == 25 and configured['preserveWinLoss'])
        page.locator('[data-tab="simulation"]').click()
        check('Clicking the active Simulation Tab preserves its settings', state()['report']['simulation'] == configured)
        page.evaluate('__simulationFixture.emitRevision()')
        check('Same report revision update preserves mounted settings',
              state()['report']['simulation'] == configured and state()['report']['revision'] == 8)
        page.locator('[data-tab="performance"]').click()
        check('Leaving Simulation discards its local parameters', state()['report']['simulation'] == defaults)
        enter()
        page.get_by_role('button', name='Simulation settings', exact=True).filter(visible=True).click()
        check('Remounted controls display 1,000 runs and zero variation',
              page.locator('#quant-backtest-simulation-runs').input_value() == '1000'
              and page.locator('#quant-backtest-simulation-variation').input_value() == '0'
              and not page.locator('#quant-backtest-simulation-preserve').is_checked())
        page.keyboard.press('Escape')

        start_worker(17, 0)
        page.locator('[data-tab="analysis"]').click()
        check('Leaving Simulation terminates its real Worker', page.evaluate('__simulationWorkerDelivery.records[0].terminated'))
        check('Cancelled Worker leaves defaults and no pending state',
              state()['report']['simulation'] == defaults and state()['simulationRuntime']['run'] is None)
        enter()
        start_worker(9, 1)
        page.evaluate('__simulationWorkerDelivery.release(0)')
        check('Late old progress and completion cannot settle the new mount',
              state()['report']['simulation'] == defaults and state()['simulationRuntime']['run']['status'] == 'pending')
        page.evaluate('__simulationWorkerDelivery.release(1)')
        page.wait_for_function('__simulationFixture.state().simulationRuntime.run === null')
        check('The new mount accepts only its own real Worker result',
              state()['report']['simulation']['variationPercent'] == 9 and state()['report']['simulation']['runs'] == 2500)

        start_worker(31, 2)
        page.locator('.quant-backtest-viewer-back').click()
        page.evaluate('__simulationWorkerDelivery.release(2)')
        check('Closing Viewer cancels pending work and ignores its late response',
              page.evaluate('__simulationWorkerDelivery.records[2].terminated')
              and state()['report']['simulation'] == defaults and state()['simulationRuntime']['run'] is None)
        opener.click()
        enter()
        check('Close and reopen starts at all reference defaults', state()['report']['simulation'] == defaults)
        check('Mount changes do not rerun or resubscribe the underlying strategy',
              state()['source'] == {**original_source, 'emittedEventCount': 1}
              and state()['report']['runId'] == 'simulation-run-7')
        start_worker(39, 3)
        page.evaluate('__simulationFixture.destroy(); __simulationWorkerDelivery.release(3)')
        check('Destroy terminates the Worker and releases every chart',
              page.evaluate('__simulationWorkerDelivery.records.every(record => record.terminated)')
              and page.locator('.highcharts-container').count() == 0)
        check('Lifecycle and native Worker delivery have no page errors or external requests', not errors and not external)
        return {'browser': name, 'scenario': 'mount-lifecycle-real-worker', 'checks': checks,
                'workerKinds': page.evaluate('__simulationWorkerDelivery.records.map(record => record.kinds)'),
                'pageErrors': errors, 'externalRequests': external, 'passed': True}
    except Exception:
        page.screenshot(path=str(output.parent / f'{name}-simulation-lifecycle-failure.png'))
        raise
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url")
    parser.add_argument("--browsers", default="chromium,firefox")
    parser.add_argument("--output", type=Path, default=ROOT / "audit-evidence/simulation-components/results.json")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    results = []
    with serve(args.base_url, args.output) as base_url, sync_playwright() as playwright:
        for name in args.browsers.split(","):
            browser = getattr(playwright, name).launch()
            try:
                for width in [1440, 1100]:
                    results.append(run_case(browser, name, width, base_url, args.output))
                results.append(run_lifecycle_case(browser, name, base_url, args.output))
            finally:
                browser.close()
    result = {"cases": results, "passed": True, "checks": sum(len(case["checks"]) for case in results)}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"cases": len(results), "checks": result["checks"], "passed": True}))


if __name__ == "__main__":
    main()
