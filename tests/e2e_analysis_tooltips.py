#!/usr/bin/env python3
"""Painted Analysis tooltips and legend/keyboard navigation in real browsers.

Uses the locally executed Pine fixture and production Workbench/Highcharts.
This is a regression gate, not evidence of reference-site numerical parity.
Screenshots and observations belong in an ignored output directory.
The default desktop scope retains DPR 1/2; --scope full also runs mobile.
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
CHARTS = ['distribution', 'donut', 'duration']
VIEWPORT_SCOPES = {
    'desktop': [(1440, 1000)],
    'full': [(1440, 1000), (390, 844)],
}

POINT = """async ({kind,index}) => {
  const H=await(await import('/src/features/backtesting/highcharts-renderer.ts')).loadHighcharts();
  const c=H.charts.find(c=>c?.renderTo.classList.contains(`quant-backtest-analysis-${kind}-host`));
  const points=c.series[0].points.filter(p=>p.visible!==false && p.graphic?.element);
  const p=points[index??points.findIndex(p=>p.y!==0)];
  const r=c.renderTo.getBoundingClientRect();
  let x=p.plotX+c.plotLeft,y=p.plotY+c.plotTop;
  if(p.series.type==='pie') {
    const s=p.shapeArgs,angle=(s.start+s.end)/2,radius=(s.r+s.innerR)/2;
    x=s.x+Math.cos(angle)*radius+c.plotLeft;y=s.y+Math.sin(angle)*radius+c.plotTop;
  } else if(p.series.type==='column') {
    const s=p.shapeArgs;x=s.x+s.width/2+c.plotLeft;y=s.y+s.height/2+c.plotTop;
  }
  return {x:r.x+x,y:r.y+y,index:p.graphic.element.dataset.quantReportPoint,
    value:p.y,custom:p.options.custom,visible:points.length};
}"""

OBSERVE = """kind=>{
 const host=document.querySelector(`.quant-backtest-analysis-${kind}-host`);
 const box=host.querySelector('.highcharts-tooltip-box');
 const svg=host.querySelector('g.highcharts-tooltip');
 const html=host.querySelector('div.highcharts-tooltip');
 const text=html??svg;
 return {background:box?getComputedStyle(box).fill:null,
   border:box?getComputedStyle(box).stroke:null,
   visibility:svg?getComputedStyle(svg).visibility:null,
   text:text?.textContent,foreground:html?getComputedStyle(html).color:
     svg?.querySelector('text')?getComputedStyle(svg.querySelector('text')).fill:null};
}"""


def run_case(browser, base, browser_name, width, height, dpr, output):
    context = browser.new_context(viewport={'width': width, 'height': height},
                                  device_scale_factor=dpr, locale='en-US', timezone_id='UTC')
    errors, external, checks, observations = [], [], [], []
    def guard(route):
        if route.request.url.startswith(base):
            route.continue_()
        else:
            external.append(route.request.url)
            route.abort()
    context.route('**/*', guard)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("""window.addEventListener('error', event => {
      if (event instanceof ErrorEvent) console.error('window ErrorEvent: ' + event.message);
    });""")
    page.on('console', lambda message: errors.append(message.text)
            if message.type == 'error' and message.text.startswith('window ErrorEvent:') else None)
    page.set_default_timeout(15000)
    name = f'{browser_name}-{width}-dpr{dpr}'
    def check(label, actual, expected=True):
        assert actual == expected, {'case': name, 'check': label, 'actual': actual, 'expected': expected}
        checks.append(label)
    try:
        page.goto(base + '/tests/fixtures/backtest-btcusdt.html')
        page.wait_for_function('window.__btcFixture?.ready')
        if width < 1024:
            page.locator('.quant-backtest-mobile-trigger').click()
        else:
            page.get_by_role('button', name='Open backtest viewer', exact=True).click()
        page.get_by_role('tab', name='Trades Analysis', exact=True).click()
        for kind in CHARTS:
            host = page.locator(f'.quant-backtest-analysis-{kind}-host')
            host.locator('[data-quant-report-point]').first.wait_for()
            host.scroll_into_view_if_needed()
            point = page.evaluate(POINT, {'kind': kind})
            # Trusted mouse coordinates exercise the actual Highcharts tracker.
            page.mouse.move(point['x'], point['y'])
            page.wait_for_function("kind=>{const e=document.querySelector(`.quant-backtest-analysis-${kind}-host g.highcharts-tooltip`);return e&&getComputedStyle(e).visibility==='visible'}", arg=kind)
            hovered = page.evaluate(OBSERVE, kind)
            check(kind + ' pointer background', hovered['background'], 'rgb(26, 26, 27)')
            check(kind + ' pointer text present', bool(hovered['text']))
            check(kind + ' pointer foreground differs', hovered['foreground'] != hovered['background'])
            if kind == 'distribution':
                check('distribution labels', 'Interval:' in hovered['text'] and 'Trades:' in hovered['text'])
                check('distribution count', str(point['value']) in hovered['text'])
            elif kind == 'duration':
                check('duration labels', all(value in hovered['text'] for value in ['Trade', 'P&L', '(UTC)']))
                check('duration direction', point['custom']['direction'].title() in hovered['text'])
            else:
                check('winrate population', str(point['value']) in hovered['text'])
            page.screenshot(path=str(output / (name + '-' + kind + '-hover.png')))
            page.mouse.move(0, 0)
            host.locator('[data-quant-report-point="0"]').focus()
            page.keyboard.press('ArrowRight')
            check(kind + ' keyboard next', page.evaluate('document.activeElement.dataset.quantReportPoint'), '1')
            focused = page.evaluate(OBSERVE, kind)
            check(kind + ' focus background', focused['background'], 'rgb(26, 26, 27)')
            check(kind + ' focus visible', focused['visibility'], 'visible')
            page.keyboard.press('End')
            check(kind + ' keyboard end', page.evaluate('document.activeElement.dataset.quantReportPoint'), str(point['visible'] - 1))
            page.evaluate('window.__analysisEscapeTarget = document.activeElement')
            page.keyboard.press('Escape')
            check(kind + ' Escape keeps Viewer open', page.locator('.quant-backtest-viewer').is_visible())
            check(kind + ' Escape retains exact point focus', page.evaluate('document.activeElement === window.__analysisEscapeTarget'))
            check(kind + ' Escape immediately hides tooltip', page.evaluate(OBSERVE, kind)['visibility'], 'hidden')
            page.keyboard.press('Home')
            check(kind + ' keyboard home', page.evaluate('document.activeElement.dataset.quantReportPoint'), '0')
            check(kind + ' Home resumes tooltip after Escape', page.evaluate(OBSERVE, kind)['visibility'], 'visible')
            observations.append({'chart': kind, 'hover': hovered, 'focus': focused})
        donut = page.locator('.quant-backtest-analysis-donut-host')
        donut.scroll_into_view_if_needed()
        slices = donut.locator('[data-quant-report-point]').count()
        check('fixture has multiple nonempty slices', slices > 1)
        donut.locator('.highcharts-legend-item').first.click()
        check('hidden slice removed from navigation', donut.locator('[data-quant-report-point]').count(), slices - 1)
        check('visible slice retains tab entry', donut.locator('[data-quant-report-point][tabindex="0"]').count(), 1)
        check('tab entry is visible', donut.locator('[data-quant-report-point][tabindex="0"]').is_visible())
        donut.locator('[data-quant-report-point="0"]').focus()
        page.keyboard.press('ArrowLeft')
        check('navigation wraps over visible slices', page.evaluate('document.activeElement.dataset.quantReportPoint'), str(slices - 2))
        check('wrapped slice is visible', page.evaluate("getComputedStyle(document.activeElement).visibility"), 'visible')
        donut.locator('.highcharts-legend-item').first.click()
        check('restored slice rejoins navigation', donut.locator('[data-quant-report-point]').count(), slices)
        check('restored chart has one tab entry', donut.locator('[data-quant-report-point][tabindex="0"]').count(), 1)
        page.evaluate('window.__btcFixture.destroy()')
        resources = page.evaluate('window.__btcFixture.chartResources()')
        check('charts released', resources['activeCharts'], 0)
        check('observers released', resources['activeObservers'], 0)
        check('page errors', errors, [])
        check('external requests', external, [])
        return {'case': name, 'passed': len(checks), 'checks': checks,
                'observations': observations, 'resources': resources}
    finally:
        context.close()




def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--browsers', default='chromium,firefox')
    parser.add_argument('--scope', choices=VIEWPORT_SCOPES, default='desktop',
                        help='desktop (default) or full retained mobile matrix')
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
                for browser_name in args.browsers.split(','):
                    browser = getattr(pw, browser_name).launch()
                    try:
                        for width, height in VIEWPORT_SCOPES[args.scope]:
                            for dpr in [1, 2]:
                                results.append(run_case(browser, base, browser_name, width, height, dpr, args.output))
                                print(json.dumps({'case': results[-1]['case'], 'passed': results[-1]['passed']}), flush=True)
                    finally:
                        browser.close()
        finally:
            server.terminate()
            server.wait(timeout=10)
            (args.output / 'results.json').write_text(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
