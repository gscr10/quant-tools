#!/usr/bin/env python3
"""Real-browser regression for markerless Summary/Dock keyboard navigation.

Exercises production Workbench charts plus a freshly generated, unsampled
12,001-point source. It does not establish reference-site numerical parity.
Only the local Vite service is allowed; artifacts go to an ignored directory.
"""
import argparse
import json
import socket
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

CREATE_CHART = """async () => {
  window.chartModule = await import('/src/features/backtesting/highcharts-renderer.ts');
  const host = document.createElement('div'); host.id='keyboard-chart';
  host.style.cssText='width:1000px;height:280px;margin:20px;background:#18181b';
  document.body.append(host);
  const after=document.createElement('button'); after.id='after-chart';
  after.textContent='After chart'; document.body.append(after);
  const raw=Array.from({length:12001},(_,i)=>({x:i,y:i/10-600,
    time:Date.UTC(2026,0,1)+i*900000,tradeNumber:i+1,direction:i%2?'short':'long'}));
  window.keyboardOptions={kind:'area',label:'Independent equity',axis:'linear',
    height:'container',markerEnabled:false,tooltipMode:'performance-equity',currency:'USD',
    points:[raw[0],raw[6000],raw[12000]],tooltipPoints:raw};
  await chartModule.enhanceReportChart(host,window.keyboardOptions);
  const H=await chartModule.loadHighcharts();
  window.keyboardChart=H.charts.find(c=>c?.renderTo===host);
  return {rendered:keyboardChart.series[0].points.length,
    raw:host.querySelector('[data-quant-report-curve]').dataset.quantReportCurveCount,
    nodes:host.querySelectorAll('*').length,pointCount:keyboardChart.pointCount};
}"""

OBSERVE = """() => {
  const host=document.querySelector('#keyboard-chart');
  const nav=host.querySelector('[data-quant-report-curve]');
  return {index:nav?.dataset.quantReportCurveIndex,count:nav?.dataset.quantReportCurveCount,
    focused:document.activeElement===nav,
    text:host.querySelector('g.highcharts-tooltip')?.textContent,
    visibility:host.querySelector('g.highcharts-tooltip')?.getAttribute('visibility'),
    status:host.querySelector('[data-quant-report-curve-status]')?.textContent,
    cursors:host.querySelectorAll('[data-quant-report-curve-cursor]').length,
    nodes:host.querySelectorAll('*').length,pointCount:keyboardChart.pointCount};
}"""


def run_case(browser, base, name, output):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000},
                                  locale='en-US', timezone_id='UTC')
    errors, external, checks, observations = [], [], [], []

    def guard(route):
        if route.request.url.startswith(base):
            route.continue_()
        else:
            external.append(route.request.url)
            route.abort()

    def check(label, actual, expected=True):
        assert actual == expected, {'browser': name, 'check': label,
                                    'actual': actual, 'expected': expected}
        checks.append(label)

    context.route('**/*', guard)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_default_timeout(20000)
    try:
        page.goto(base + '/tests/fixtures/backtest-btcusdt.html')
        page.wait_for_function('window.__btcFixture?.ready')
        dock = page.locator('.quant-backtest-dock [data-quant-report-curve]')
        dock.wait_for()
        check('production Dock has a single chart tab stop', dock.count(), 1)
        dock.focus()
        page.keyboard.press('End')
        count = int(dock.get_attribute('data-quant-report-curve-count'))
        check('Dock End visits the final raw point', dock.get_attribute('data-quant-report-curve-index'), str(count-1))
        check('Dock keyboard tooltip shows report value', 'Cumulative P&L' in dock.locator('g.highcharts-tooltip').text_content())
        page.keyboard.press('Home')
        check('Dock Home visits the first raw point', dock.get_attribute('data-quant-report-curve-index'), '0')
        page.get_by_role('button', name='Open backtest viewer', exact=True).click()
        summary = page.locator('.quant-backtest-viewer [data-quant-report-curve]').first
        summary.wait_for()
        summary.focus()
        page.keyboard.press('End')
        count = int(summary.get_attribute('data-quant-report-curve-count'))
        check('production Summary End visits raw final point', summary.get_attribute('data-quant-report-curve-index'), str(count-1))
        page.keyboard.press('Escape')
        check('chart Escape keeps Viewer open', page.locator('.quant-backtest-viewer').is_visible())
        check('chart Escape preserves tab progression', summary.evaluate('(el)=>document.activeElement===el'))
        page.keyboard.press('Home')
        check('Summary resumes after Escape', summary.get_attribute('data-quant-report-curve-index'), '0')
        page.screenshot(path=str(output / (name + '-summary.png')))
        page.evaluate('window.__btcFixture.destroy()')
        check('Workbench chart disposal', page.evaluate('window.__btcFixture.chartResources()'),
              {'activeCharts': 0, 'activeObservers': 0})

        initial = page.evaluate(CREATE_CHART)
        check('independent test actually downsamples', initial['rendered'], 3)
        check('navigation retains all raw points', initial['raw'], '12001')
        check('chart DOM independent of raw point count', initial['nodes'] < 150)
        nav = page.locator('#keyboard-chart [data-quant-report-curve]')
        nav.focus()
        for key, expected in [('ArrowRight', 1), ('ArrowDown', 2), ('ArrowLeft', 1),
                              ('ArrowUp', 0), ('ArrowLeft', 12000), ('Home', 0), ('End', 12000)]:
            page.keyboard.press(key)
            observed = page.evaluate(OBSERVE)
            check('raw navigation ' + key + ' to ' + str(expected), observed['index'], str(expected))
            check('raw tooltip trade ' + str(expected), f'Trade #{expected+1}' in observed['text'])
            check('single cursor ' + str(expected), observed['cursors'], 1)
            check('Highcharts point count unchanged ' + str(expected), observed['pointCount'], initial['pointCount'])
        page.keyboard.press('Home')
        page.keyboard.press('ArrowRight')
        selected = page.evaluate(OBSERVE)
        check('unsampled value is announced', '-599.9 USD' in selected['status'])
        check('unsampled time is announced', '00:15 UTC' in selected['status'])
        check('unsampled point absent from rendered data', page.evaluate('keyboardChart.series[0].points.some(p=>p.x===1)'), False)
        page.evaluate("chartModule.setReportChartLayout(document.querySelector('#keyboard-chart'),{hideAxes:true})")
        check('compact layout hides both axes', page.evaluate('keyboardChart.axes.every(a=>a.visible===false)'))
        check('compact layout retains selected raw point', page.evaluate(OBSERVE)['index'], '1')
        check('compact layout retains focus', page.evaluate(OBSERVE)['focused'])
        page.evaluate("document.querySelector('#keyboard-chart').style.height='360px'")
        page.wait_for_function('keyboardChart.chartHeight===360')
        check('container height follows actual available space', page.evaluate('keyboardChart.chartHeight'), 360)
        page.evaluate("chartModule.setReportChartLayout(document.querySelector('#keyboard-chart'),{hideAxes:false})")
        check('expanded layout restores both axes', page.evaluate('keyboardChart.axes.every(a=>a.visible===true)'))
        check('axis and resize updates reuse one chart', page.evaluate('chartModule.getReportChartResourceStats().activeCharts'), 1)
        page.evaluate("document.querySelector('#keyboard-chart').style.height='280px'")
        page.wait_for_function('keyboardChart.chartHeight===280')
        page.keyboard.press('Escape')
        check('Escape hides tooltip', page.evaluate(OBSERVE)['visibility'], 'hidden')
        check('Escape retains chart focus', page.evaluate(OBSERVE)['focused'])
        page.keyboard.press('Tab')
        check('Tab exits chart without 12001 stops', page.evaluate('document.activeElement.id'), 'after-chart')
        nav.focus()
        page.keyboard.press('End')
        page.evaluate("""() => {
          const raw=keyboardOptions.tooltipPoints.map(p=>({...p,y:p.y+10000,time:p.time+86400000}));
          keyboardOptions={...keyboardOptions,points:[raw[0],raw[6000],raw[12000]],tooltipPoints:raw};
          if(!chartModule.updateReportChart(document.querySelector('#keyboard-chart'),keyboardOptions))
            throw new Error('chart update unexpectedly rejected');
        }""")
        updated = page.evaluate(OBSERVE)
        check('live update retains raw selection', updated['index'], '12000')
        check('live update refreshes visible tooltip', '$ 10.6k' in updated['text'])
        check('live update refreshes announcement', '10,600 USD' in updated['status'])
        check('live update keeps focus', updated['focused'])
        axis = page.evaluate("""() => ({min:keyboardChart.yAxis[0].min,max:keyboardChart.yAxis[0].max,
          userMin:keyboardChart.yAxis[0].userMin,userMax:keyboardChart.yAxis[0].userMax,
          descriptor:document.querySelector('#keyboard-chart').getAttribute('aria-label')})""")
        check('live update recalculates the rendered y-axis minimum', axis['userMin'], 9400)
        check('live update recalculates the rendered y-axis maximum', axis['userMax'], 10600)
        check('live update keeps current currency in chart name', 'Independent equity' in axis['descriptor'])
        page.evaluate('keyboardChart.series[0].hide()')
        check('hidden curves leave no tab stops', nav.count(), 0)
        check('hidden curves leave no cursor', page.locator('[data-quant-report-curve-cursor]').count(), 0)
        page.evaluate('keyboardChart.series[0].show()')
        check('shown curve restores one tab stop', nav.count(), 1)
        nav.focus()
        page.keyboard.press('End')
        page.evaluate("""() => {
          const raw=keyboardOptions.tooltipPoints.slice(0,7);
          keyboardOptions={...keyboardOptions,points:[raw[0],raw[3],raw[6]],tooltipPoints:raw};
          chartModule.updateReportChart(document.querySelector('#keyboard-chart'),keyboardOptions);
        }""")
        check('removed raw selection clamps to current data', page.evaluate(OBSERVE)['index'], '6')
        check('shortened data count current', page.evaluate(OBSERVE)['count'], '7')

        # A real mouse move exercises Highcharts' normal hover path after an
        # in-place update, independently of the keyboard's virtual point.
        point = page.evaluate("""() => {
          const p=keyboardChart.series[0].points[1],r=keyboardChart.container.getBoundingClientRect();
          return {x:r.x+keyboardChart.plotLeft+p.plotX,y:r.y+keyboardChart.plotTop+p.plotY};
        }""")
        page.mouse.move(0, 0)
        page.mouse.move(point['x'] - 2, point['y'], steps=4)
        # Highcharts lazily builds its search tree on the first pointer hit.
        page.wait_for_function('keyboardChart.series[0].kdTree !== undefined')
        page.mouse.move(point['x'], point['y'])
        page.wait_for_function("document.querySelector('#keyboard-chart g.highcharts-tooltip')?.textContent.includes('Trade #4')")
        pointer = page.evaluate(OBSERVE)
        check('pointer uses new raw source', '$ 9.4k' in pointer['text'])
        observations.extend([selected, updated, pointer])
        page.screenshot(path=str(output / (name + '-updated-pointer.png')))
        page.evaluate("window.detachedNav=document.querySelector('[data-quant-report-curve]');chartModule.destroyReportChart(document.querySelector('#keyboard-chart'))")
        check('destroy removes navigation listeners', page.evaluate("detachedNav.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))"))
        check('destroy removes tab stop', page.evaluate("detachedNav.hasAttribute('tabindex')"), False)
        check('destroy releases chart/observer', page.evaluate('chartModule.getReportChartResourceStats()'),
              {'activeCharts': 0, 'activeObservers': 0})

        # Hidden/disabled series must never be reachable through a curve's
        # single navigation sequence. Redraws reuse the bridge and listeners.
        page.evaluate("""async () => {
          const host=document.querySelector('#keyboard-chart');
          await chartModule.enhanceReportChart(host,{kind:'line',label:'Multiple curves',axis:'linear',
            points:[],height:280,series:[
              {name:'A',markerEnabled:false,points:[{x:0,y:11},{x:1,y:12}]},
              {name:'B',markerEnabled:false,points:[{x:0,y:21},{x:1,y:22}]},
              {name:'Decorative',markerEnabled:false,enableMouseTracking:false,points:[{x:0,y:99}]},
            ]});
          const H=await chartModule.loadHighcharts();
          window.keyboardChart=H.charts.find(c=>c?.renderTo===host);
        }""")
        nav.focus()
        page.keyboard.press('End')
        check('decorative series excluded', page.evaluate(OBSERVE)['count'], '4')
        check('multiple series final point', 'B, point 4 of 4' in page.evaluate(OBSERVE)['status'])
        page.evaluate('keyboardChart.series[1].hide()')
        check('hidden selected series clamps to visible sequence', page.evaluate(OBSERVE)['count'], '2')
        check('hidden selection status updated', 'A, point 2 of 2' in page.evaluate(OBSERVE)['status'])
        page.evaluate('for(let i=0;i<10;i++)keyboardChart.redraw(false)')
        page.keyboard.press('Home')
        page.keyboard.press('ArrowRight')
        check('repeated redraw does not stack handlers', page.evaluate(OBSERVE)['index'], '1')
        page.evaluate("chartModule.unregisterReportChart(document.querySelector('#keyboard-chart'))")
        check('unregister removes accessible host role', page.locator('#keyboard-chart').get_attribute('role'), None)
        check('all resources released', page.evaluate('chartModule.getReportChartResourceStats()'),
              {'activeCharts': 0, 'activeObservers': 0})

        # Fresh report input sent through the actual Workbench transient
        # update path. Currency, tooltip mode and complete raw metadata must
        # survive the same-run computing/updating descriptor reuse.
        page.evaluate("""async () => {
          const {BacktestWorkbench}=await import('/src/features/backtesting/backtest-workbench.ts');
          const points=Array.from({length:11},(_,i)=>({x:i,y:100+i,
            time:Date.UTC(2026,0,1,i),tradeNumber:i+1,direction:i%2?'long':'short'}));
          window.liveKeyboardReport={key:{cellId:'keyboard-cell',indicatorId:'keyboard-strategy'},
            runId:'keyboard-live-run',revision:1,status:'ready',strategyName:'Keyboard live report',
            currency:'eur',cumulativePnl:points,equity:points,trades:[],
            metrics:{netProfit:110,trades:10,winRate:50,winningTrades:5,losingTrades:5,
              maxDrawdown:30,maxDrawdownPercent:3,profitFactor:1.2},summary:{netProfit:110,trades:10}};
          window.liveKeyboardWorkbench=new BacktestWorkbench('#fixture-host',{
            initialReport:liveKeyboardReport});
        }""")
        live_nav = page.locator('.quant-backtest-dock [data-quant-report-curve]')
        live_nav.wait_for()
        live_nav.focus()
        page.keyboard.press('End')
        page.evaluate("""async () => {
          const H=await chartModule.loadHighcharts();
          window.liveKeyboardChart=H.charts.find(c=>c?.renderTo.closest('.quant-backtest-dock'));
        }""")
        for status, value, currency_text, day in [('computing', 8888.88, '€ 8.9k', 2),
                                                  ('updating', -432.1, '€ -432.10', 3)]:
            page.evaluate("""({status,value,day}) => {
              const points=liveKeyboardReport.cumulativePnl.map(p=>({...p,y:value,
                time:Date.UTC(2026,0,day,p.x)}));
              liveKeyboardReport={...liveKeyboardReport,status,revision:liveKeyboardReport.revision+1,
                cumulativePnl:points,equity:points};
              liveKeyboardWorkbench.setReport(liveKeyboardReport);
            }""", {'status': status, 'value': value, 'day': day})
            text = live_nav.locator('g.highcharts-tooltip').text_content()
            check(status + ' Workbench preserves currency and tooltip formatter', currency_text in text)
            check(status + ' Workbench publishes new raw time', f'Jan 0{day}, 2026, 10:00' in text)
            check(status + ' Workbench preserves trade metadata', 'Trade #11' in text and 'Short' in text)
            check(status + ' Workbench retains focus', live_nav.evaluate('(e)=>document.activeElement===e'))
            check(status + ' Workbench keeps Highcharts instance', page.evaluate("liveKeyboardChart.container===document.querySelector('.quant-backtest-dock [data-quant-report-curve]')"))
        page.screenshot(path=str(output / (name + '-workbench-live-update.png')))
        page.evaluate('liveKeyboardWorkbench.destroy()')
        check('transient Workbench releases all resources', page.evaluate('chartModule.getReportChartResourceStats()'),
              {'activeCharts': 0, 'activeObservers': 0})
        check('page errors', errors, [])
        check('external requests', external, [])
        return {'browser': name, 'passed': len(checks), 'checks': checks,
                'observations': observations, 'initial': initial, 'errors': errors, 'external': external}
    except Exception:
        (output / (name + '-failure.json')).write_text(json.dumps({
            'checks': checks, 'errors': errors, 'external': external,
            'dom': page.locator('body').first.inner_html(),
        }, indent=2))
        page.screenshot(path=str(output / (name + '-failure.png')))
        raise
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--browsers', default='chromium,firefox')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    results = []
    with (args.output / 'server.log').open('w') as log:
        server = subprocess.Popen(['node', 'node_modules/vite/bin/vite.js', '--config',
            'tests/vite-performance.config.ts', '--host', '127.0.0.1', '--port', str(port),
            '--strictPort'], cwd=ROOT, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if server.poll() is not None:
                    raise RuntimeError('fixture server exited before ready')
                try:
                    if urlopen(base, timeout=1).status == 200:
                        break
                except OSError:
                    time.sleep(.1)
            else:
                raise TimeoutError('fixture server not ready')
            with sync_playwright() as pw:
                for name in args.browsers.split(','):
                    browser = getattr(pw, name).launch(headless=True)
                    try:
                        result = run_case(browser, base, name, args.output)
                        results.append(result)
                        print(json.dumps({'browser': name, 'passed': result['passed']}), flush=True)
                    finally:
                        browser.close()
            (args.output / 'results.json').write_text(json.dumps(results, indent=2))
        finally:
            server.terminate()
            try:
                server.wait(timeout=8)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=8)


if __name__ == '__main__':
    main()
