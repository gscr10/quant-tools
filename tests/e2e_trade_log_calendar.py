#!/usr/bin/env python3
"""Real DOM Log/Calendar interactions across browsers, viewports and DPR.

Uses the existing 501-trade performance harness to exercise the production
Workbench without network/engine timing noise. This is an interaction gate;
reference screenshot comparison remains a separate same-input acceptance.
The default desktop scope retains DPR 1/2 and narrow embedded containers;
--scope full also runs the retained mobile viewport/touch matrix.
"""
import argparse
import hashlib
import json
import socket
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
VIEWPORT_SCOPES = {'desktop': [1440], 'full': [1440, 390, 360]}


def run_case(browser, browser_name, base, width, height, dpr, output):
    context = browser.new_context(viewport={'width': width, 'height': height},
                                  device_scale_factor=dpr, has_touch=width < 500,
                                  locale='en-US', timezone_id='UTC')
    errors = []
    external = []
    def guard(route):
        if route.request.url.startswith(base):
            route.continue_()
        else:
            external.append(route.request.url)
            route.abort()
    context.route('**/*', guard)
    # ResizeObserver loop failures are window ErrorEvents and need not emit
    # Playwright's pageerror. Observe both channels without suppressing them.
    context.add_init_script("""window.__logCalendarWindowErrors=[];
      window.addEventListener('error',event=>window.__logCalendarWindowErrors.push({
        message:event.message,filename:event.filename,line:event.lineno,column:event.colno
      }));""")
    # The real calendar's current-month control must be deterministic while
    # still using its own Date and formatting code.
    context.add_init_script("""{
      const RealDate=Date; const fixed=Date.UTC(2024,0,25,12);
      window.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[fixed]));}
        static now(){return fixed;}};
    }""")
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_default_timeout(15000)
    name = f'{browser_name}-{width}-dpr{dpr}'
    checks = []
    def check(label, actual, expected=True):
        assert actual == expected, {'case': name, 'check': label, 'actual': actual, 'expected': expected}
        checks.append(label)
    try:
        page.goto(base + '/tests/fixtures/backtest-performance.html?count=501')
        page.wait_for_function('window.__backtestPerformance?.ready')
        page.evaluate('window.__backtestPerformance.openViewer()')
        page.get_by_role('tab', name='Trades Log', exact=True).click()
        table = page.locator('.quant-backtest-trade-table')
        check('default descending first number', table.locator('tbody th .quant-backtest-trade-number-value').first.inner_text(), '501')
        check('bounded first page', table.get_attribute('data-rendered-trade-count'), '200')
        check('total rows announced', table.get_attribute('aria-rowcount'), '502')
        numbers = []
        for index, count in enumerate([200, 200, 101]):
            check(f'page {index + 1} row bound', table.locator('tbody tr').count(), count)
            panel=page.locator('.quant-backtest-table-wrap')
            check(f'page {index + 1} retains tabpanel role', panel.get_attribute('role'), 'tabpanel')
            check(f'page {index + 1} retains tabpanel id', panel.get_attribute('id'), 'quant-backtest-trades-view-panel')
            check(f'page {index + 1} retains List accessible label', panel.get_attribute('aria-labelledby'), 'quant-backtest-trades-view-list')
            check(f'page {index + 1} remains keyboard reachable', panel.get_attribute('tabindex'), '0')
            check(f'page {index + 1} reference row height', table.locator('tbody tr').nth(1).bounding_box()['height'], 59)
            check(f'page {index + 1} currency separator does not grow price line', table.locator('.quant-backtest-trade-price').first.bounding_box()['height'], 20)
            numbers.extend(table.locator('.quant-backtest-trade-number-value').all_text_contents())
            if index < 2:
                page.locator('[data-trade-pagination="next"]').click()
        check('pagination covers entire ledger once', numbers, [str(n) for n in range(501, 0, -1)])
        check('last next disabled', page.locator('[data-trade-pagination="next"]').is_disabled())
        check('last page focus falls back to previous', page.evaluate('document.activeElement?.dataset.tradePagination'), 'previous')
        page.locator('[data-trade-pagination="previous"]').click()
        check('previous page restores bound', table.get_attribute('data-trade-window-start'), '200')
        page.locator('[data-trade-pagination="previous"]').focus()
        page.keyboard.press('Enter')
        check('first previous disabled', page.locator('[data-trade-pagination="previous"]').is_disabled())
        check('first page focus falls back to next', page.evaluate('document.activeElement?.dataset.tradePagination'), 'next')
        sort_number = table.locator('[data-trade-sort="number"]')
        sort_number.focus()
        page.keyboard.press('Enter')
        check('keyboard sort keeps header focus', page.evaluate('document.activeElement?.dataset.tradeSort'), 'number')
        check('keyboard sort announces ascending', table.locator('thead th').first.get_attribute('aria-sort'), 'ascending')
        page.keyboard.press('Space')
        check('keyboard reverse keeps header focus', page.evaluate('document.activeElement?.dataset.tradeSort'), 'number')
        check('keyboard reverse announces descending', table.locator('thead th').first.get_attribute('aria-sort'), 'descending')
        # Each new metric starts descending; repeated selection toggles.
        for label, column in [('Net P&L', 4), ('Size', 3), ('MFE', 5), ('MAE', 6), ('Cumulative P&L', 7)]:
            control = table.locator('thead button').filter(has_text=label)
            for expected in ['descending', 'ascending']:
                control.click()
                check(f'{label} {expected}', table.locator('thead th').nth(column).get_attribute('aria-sort'), expected)
                check(f'{label} resets page', table.get_attribute('data-trade-window-start'), '0')
        check('MFE descriptive tooltip', table.locator('thead button').filter(has_text='MFE').get_attribute('title'), 'Maximum favorable excursion')
        page.screenshot(path=str(output / (name + '-log.png')))
        page.get_by_role('tab', name='Calendar view', exact=True).click()
        calendar_icon = page.locator('[data-trade-view="calendar"] svg')
        check('Calendar icon keeps native reference viewBox', calendar_icon.get_attribute('viewBox'), '0 0 24 24')
        check('Calendar icon frame remains within viewBox', calendar_icon.locator('rect').evaluate('(r)=>({x:r.x.baseVal.value,y:r.y.baseVal.value,width:r.width.baseVal.value,height:r.height.baseVal.value})'), {'x':3,'y':4,'width':18,'height':18})
        heading = page.locator('.quant-backtest-calendar-heading strong')
        check('initial month', heading.inner_text(), 'January 2024')
        check('all month days', page.locator('.quant-backtest-calendar-day[data-date]').count(), 31)
        check('calendar weekday headers', page.get_by_role('columnheader').all_text_contents(), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
        check('calendar stays within viewport', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        check('calendar grid width', page.locator('.quant-backtest-calendar-grid').bounding_box()['width'] <= width)
        check('day amount uses reference component size', page.locator('.quant-backtest-calendar-day-pnl').first.evaluate('(e)=>getComputedStyle(e).fontSize'), '14px')
        check('day currency uses reference component size', page.locator('.quant-backtest-calendar-day-pnl .quant-backtest-calendar-currency').first.evaluate('(e)=>getComputedStyle(e).fontSize'), '12px')
        def check_compact_values(label):
            compact_amounts=page.locator('.quant-backtest-calendar-day-pnl > .quant-backtest-calendar-compact')
            check(label+' keeps real numeric content visible', compact_amounts.evaluate_all('''elements=>elements.map(e=>{
              const s=getComputedStyle(e);const p=e.parentElement.getBoundingClientRect();
              const width=Math.max(e.getBoundingClientRect().width,...[...e.children].map(c=>c.getBoundingClientRect().width));
              return {text:e.textContent,width,available:p.width,display:s.display};
            }).filter(e=>e.display==='none'||!/[0-9]/.test(e.text)||e.width>e.available+0.1)'''), [])
            check(label+' preserves approximate value sign and digits', compact_amounts.first.inner_text().strip(), '-924')
            check(label+' uses readable count and rate', page.locator('.quant-backtest-calendar-day-details').first.locator('.quant-backtest-calendar-day-meta').all_inner_texts(), ['24 tr','0%'])
            check(label+' count/rate are not clipped to ellipsis', page.locator('.quant-backtest-calendar-day-meta').evaluate_all('''elements=>elements.every(e=>{
              const value=e.querySelector('.quant-backtest-calendar-compact');return value.getBoundingClientRect().width<=e.getBoundingClientRect().width+0.1;
            })'''))
            check(label+' monthly summary keeps explicit currency', page.locator('[data-calendar-summary="net-pnl"] .quant-backtest-calendar-currency').inner_text(), 'USD')
        if width < 500:
            check_compact_values('phone')
        else:
            # A desktop browser can contain a narrow workspace column. The
            # component must respond to its own width rather than viewport.
            page.locator('.quant-backtest-calendar').evaluate('(e)=>e.style.width="280px"')
            check_compact_values('narrow embedded desktop')
            page.locator('.quant-backtest-calendar').evaluate('(e)=>e.style.removeProperty("width")')
            check('wide container restores precise inline amount', page.locator('.quant-backtest-calendar-day-pnl > .quant-backtest-calendar-amount').first.is_visible())
        day_toggle=page.locator('[data-calendar-day-details]').first
        full_summary=day_toggle.get_attribute('aria-label').removeprefix('Show daily summary: ')
        expanded=page.get_by_role('region',name='Daily trade summary')
        day_toggle.focus()
        page.keyboard.press('Enter')
        check('keyboard Enter exposes full day values', expanded.locator('[role="status"]').inner_text(), full_summary)
        check('daily summary announces expanded trigger', day_toggle.get_attribute('aria-expanded'), 'true')
        check('daily summary focus moves to visible close control', page.get_by_role('button',name='Close daily summary').evaluate('(e)=>e===document.activeElement'))
        page.keyboard.press('Escape')
        check('Escape closes daily summary without closing Viewer', expanded.count(), 0)
        check('daily summary Escape restores day focus', day_toggle.evaluate('(e)=>e===document.activeElement'))
        page.keyboard.press('Space')
        check('keyboard Space also exposes full values', expanded.locator('[role="status"]').inner_text(), full_summary)
        page.get_by_role('button',name='Close daily summary').click()
        check('daily Close restores day focus', day_toggle.evaluate('(e)=>e===document.activeElement'))
        last_day=page.locator('[data-calendar-day-details]').last
        last_day.click()
        page.keyboard.press('Escape')
        check('closing a late day restores its focus and visibility', last_day.evaluate('''e=>{
          const r=e.getBoundingClientRect();return e===document.activeElement&&r.top>=0&&r.bottom<=innerHeight;
        }'''))
        if width < 500:
            day_toggle.tap()
            check('touch exposes full day values', expanded.locator('[role="status"]').inner_text(), full_summary)
            check('expanded full values wrap inside phone', expanded.locator('[role="status"]').evaluate('(e)=>e.scrollWidth<=e.clientWidth'))
            page.screenshot(path=str(output / (name + '-day-summary.png')))
            page.get_by_role('button',name='Close daily summary').tap()
            check('touch Close collapses summary', day_toggle.get_attribute('aria-expanded'), 'false')
            check('phone day labels remain inside their own cells', page.locator('.quant-backtest-calendar-day-details').evaluate_all('''elements=>elements.every(e=>{
              const cell=e.closest('.quant-backtest-calendar-day').getBoundingClientRect();
              return [...e.children].every(child=>{const r=child.getBoundingClientRect();return r.x>=cell.x&&r.right<=cell.right&&r.bottom<=cell.bottom;});
            })'''))
        january = page.locator('.quant-backtest-calendar-grid').inner_text()
        page.locator('[data-calendar-navigation="previous"]').click()
        check('year boundary previous', heading.inner_text(), 'December 2023')
        check('previous button retains focus', page.evaluate('document.activeElement?.dataset.calendarNavigation'), 'previous')
        check('empty month status', page.locator('.quant-backtest-calendar-empty').inner_text(), 'No closed trades in this month.')
        check('empty announcement does not shift visual summary', page.locator('.quant-backtest-calendar-empty').bounding_box()['height'], 1)
        page.locator('[data-calendar-navigation="next"]').click()
        check('year boundary next', heading.inner_text(), 'January 2024')
        check('return month identical', page.locator('.quant-backtest-calendar-grid').inner_text(), january)
        page.locator('[data-calendar-navigation="next"]').click()
        check('leap month has 29 days', page.locator('.quant-backtest-calendar-day[data-date]').count(), 29)
        page.get_by_role('tab', name='List view', exact=True).click()
        page.get_by_role('tab', name='Calendar view', exact=True).click()
        check('list toggle preserves month', heading.inner_text(), 'February 2024')
        page.get_by_role('tab', name='Performance', exact=True).click()
        page.get_by_role('tab', name='Trades Log', exact=True).click()
        check('tab roundtrip preserves month', heading.inner_text(), 'February 2024')
        page.locator('[data-calendar-navigation="current"]').click()
        check('current month returns January', heading.inner_text(), 'January 2024')
        check('current button retains focus', page.evaluate('document.activeElement?.dataset.calendarNavigation'), 'current')
        current = page.locator('[data-calendar-navigation="current"]')
        tooltip = current.get_by_role('tooltip')
        current.hover()
        tooltip.wait_for(state='visible')
        check('current month popup content', tooltip.inner_text(), 'Move to current month')
        page.keyboard.press('Escape')
        tooltip.wait_for(state='hidden')
        check('tooltip Escape keeps Viewer open', page.locator('.quant-backtest-viewer').is_visible())
        check('tooltip Escape preserves current trigger focus', page.evaluate('document.activeElement?.dataset.calendarNavigation'), 'current')
        page.mouse.move(0,0)
        page.locator('[data-calendar-navigation="previous"]').focus()
        page.keyboard.press('Tab')
        page.keyboard.press('Tab')
        check('keyboard returns to current month', page.evaluate('document.activeElement?.dataset.calendarNavigation'), 'current')
        tooltip.wait_for(state='visible')
        check('keyboard current popup visible', tooltip.is_visible())
        page.keyboard.press('Escape')
        tooltip.wait_for(state='hidden')
        # A later report revision keeps UI state; a new strategy run clears it.
        page.locator('[data-calendar-navigation="previous"]').click()
        page.evaluate('window.__backtestPerformance.liveMetricOnly(123,"ready")')
        check('live revision preserves selected month', heading.inner_text(), 'December 2023')
        page.evaluate('window.__backtestPerformance.newRunSameData()')
        check('new run resets current month', heading.inner_text(), 'January 2024')
        page.screenshot(path=str(output / (name + '-calendar.png')))
        boundary_values=[0,0.1234,-0.1234,1e-9,-1e-9,1488.41,-4885.54,1234567.89,-9876543.21,980000,-920000]
        exact_values=['0.00 USD','+0.1234 USD','-0.1234 USD','+1e-9 USD','-1e-9 USD',
                      '+1,488.41 USD','-4,885.54 USD','+1,234,567.89 USD','-9,876,543.21 USD',
                      '+980,000.00 USD','-920,000.00 USD']
        awaitable='''async values=>{
          const {renderBacktestTradeCalendar}=await import('/src/features/backtesting/trade-calendar-view.ts');
          const days=new Map(values.map((pnl,index)=>{const date=`2024-01-${String(index+1).padStart(2,'0')}`;
            return [date,Object.freeze({date,pnl,tradeCount:24,winningTrades:12,winRate:50})];}));
          window.__boundaryCalendarInput=days;window.__boundaryCalendarBefore=JSON.stringify([...days]);
          const next=renderBacktestTradeCalendar(document,{days,currency:'USD',month:'2024-01',onMonthChange:()=>{}});
          if(innerWidth>=500)next.style.width='280px';
          document.querySelector('.quant-backtest-calendar').replaceWith(next);
        }'''
        page.evaluate(awaitable,boundary_values)
        boundary_compact=page.locator('.quant-backtest-calendar-day-pnl > .quant-backtest-calendar-compact')
        check('boundary numbers remain entirely readable', boundary_compact.evaluate_all('''elements=>elements.map(e=>({
          text:e.textContent,width:Math.max(e.getBoundingClientRect().width,...[...e.children].map(c=>c.getBoundingClientRect().width)),available:e.parentElement.getBoundingClientRect().width
        })).filter(e=>e.width>e.available+0.1)'''),[])
        for index,(value,exact) in enumerate(zip(boundary_values,exact_values)):
            text=boundary_compact.nth(index).inner_text().strip()
            check(f'boundary {index} preserves direction and nonzero', text.startswith('-') if value<0 else text.startswith('+') if value>0 else text=='0')
            check(f'boundary {index} numeric value is recognizable', any(character.isdigit() for character in text))
            if abs(value)>=1000:
                scale={'K':1000,'M':1000000,'B':1000000000,'T':1000000000000}[text[-1]]
                check(f'boundary {index} compact rounding stays within six percent',abs(float(text[:-1])*scale-value)/abs(value)<=0.06)
            control=page.locator('[data-calendar-day-details]').nth(index)
            control.focus();page.keyboard.press('Enter')
            check(f'boundary {index} expands exact unabridged amount',exact in page.get_by_role('region',name='Daily trade summary').inner_text())
            page.keyboard.press('Escape')
        check('boundary display leaves source values unchanged',page.evaluate('JSON.stringify([...window.__boundaryCalendarInput])===window.__boundaryCalendarBefore'))
        page.screenshot(path=str(output / (name + '-boundary-values.png')))
        check('DPR applied', page.evaluate('devicePixelRatio'), dpr)
        page.evaluate('window.__backtestPerformance.destroy()')
        resources = page.evaluate('window.__backtestPerformance.chartResources()')
        check('charts destroyed', resources['activeCharts'], 0)
        check('observers destroyed', resources['activeObservers'], 0)
        check('page errors', errors, [])
        check('window error events', page.evaluate('window.__logCalendarWindowErrors'), [])
        check('external requests', external, [])
        return {'case': name, 'checks': checks, 'passed': len(checks), 'resources': resources}
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--browsers', default='chromium,firefox,webkit')
    parser.add_argument('--scope', choices=VIEWPORT_SCOPES, default='desktop',
                        help='desktop (default) or full retained mobile/touch matrix')
    parser.add_argument('--viewports', nargs='+', type=int, choices=[1440,390,360],
                        help='explicit viewport widths override --scope')
    args = parser.parse_args()
    viewports = args.viewports if args.viewports is not None else VIEWPORT_SCOPES[args.scope]
    args.output.mkdir(parents=True, exist_ok=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    results = []
    sources = sorted((ROOT / 'src/features/backtesting').glob('*.ts')) + [ROOT / 'src/features/backtesting/backtest.css']
    def source_hashes():
        return {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    before = source_hashes()
    with (args.output / 'server.log').open('w') as log:
        server = subprocess.Popen(['node', 'node_modules/vite/bin/vite.js', '--config',
                                   'tests/vite-performance.config.ts', '--host', '127.0.0.1',
                                   '--port', str(port), '--strictPort'], cwd=ROOT, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                try:
                    if urlopen(base, timeout=1).status == 200:
                        break
                except OSError:
                    time.sleep(.1)
            else:
                raise TimeoutError('fixture server not ready')
            with sync_playwright() as pw:
                for browser_name in args.browsers.split(','):
                    browser = getattr(pw, browser_name).launch(headless=True)
                    try:
                        for width in viewports:
                            height={1440:1000,390:844,360:800}[width]
                            for dpr in [1, 2]:
                                results.append(run_case(browser, browser_name, base, width, height, dpr, args.output))
                                print(json.dumps({'case': results[-1]['case'], 'passed': results[-1]['passed']}), flush=True)
                    finally:
                        browser.close()
        finally:
            server.terminate()
            server.wait(timeout=10)
            (args.output / 'results.json').write_text(json.dumps(results, indent=2))
            after = source_hashes()
            (args.output / 'source-sha256.json').write_text(json.dumps({'start':before,'end':after,'unchanged':before==after},indent=2))
    assert before == after, 'Backtest source changed during the browser matrix'


if __name__ == '__main__':
    main()
