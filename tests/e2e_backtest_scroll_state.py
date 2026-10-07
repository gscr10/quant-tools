#!/usr/bin/env python3
"""Fresh browser contract probes for pending report scroll ownership.

These controlled Viewer inputs isolate loading/terminal timing; the separate
production UI-state test exercises actual Workers and application reports.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--base', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--browser', choices=['chromium', 'firefox'], default='chromium')
args = parser.parse_args()
checks = []
errors = []

with sync_playwright() as playwright:
    browser = getattr(playwright, args.browser).launch(headless=True)
    try:
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        # Other collaborators can save files while this isolated contract runs;
        # suppress Vite HMR navigation, not application reports or controls.
        page.route_web_socket('**/*', lambda socket: socket.on_message(lambda _: None))
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/__scroll_contract', lambda route: route.fulfill(
            content_type='text/html', body='<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>'))
        page.goto(args.base + '/__scroll_contract')
        page.evaluate("""async () => {
          await import('/src/style.css');
          await import('/src/features/backtesting/backtest.css');
          const {BacktestViewer}=await import('/src/features/backtesting/backtest-viewer.ts');
          const host=document.createElement('main');host.className='quant-backtest-workbench';
          host.style.cssText='position:relative;width:1440px;height:1000px';
          document.body.append(host);
          window.baseReport={key:{cellId:'cell-a',indicatorId:'sma-a'},runId:'run-a',revision:1,
            strategyName:'Scroll ownership probe',provider:'binance',symbol:'BTCUSDT',timeframe:'15',
            currency:'USD',status:'ready',metrics:{netProfit:120,trades:120},
            trades:Array.from({length:120},(_,i)=>({id:i,number:i+1,status:'closed',direction:i%2?'short':'long',
              entryTime:1791000000000+i*900000,exitTime:1791000000000+(i+1)*900000,
              entryPrice:60000+i,exitPrice:60001+i,size:1,netPnl:1,mfe:2,mae:-1,cumulativePnl:i+1}))};
          window.viewer=new BacktestViewer(document,{onClose:()=>window.viewer.close()});
          host.append(window.viewer.element);
          window.update=(status,extra={})=>window.viewer.setReport({...window.baseReport,status,...extra});
          window.reset=()=>{window.viewer.close();window.viewer.open(window.baseReport);
            document.querySelector('#quant-backtest-tab-log').click();
            document.querySelector('#quant-backtest-panel').scrollTop=330;};
          window.state=()=>({top:document.querySelector('#quant-backtest-panel').scrollTop,
            tab:window.viewer.tab,rows:Number(document.querySelector('.quant-backtest-trade-table')?.dataset.renderedTradeCount??0),
            loading:!!document.querySelector('.quant-backtest-spinner')});
        }""")

        def check(name, expression, expected):
            actual = page.evaluate(expression)
            checks.append({'name': name, 'actual': actual, 'expected': expected, 'passed': actual == expected})

        def shared_tab(name):
            previous = page.evaluate('state().top')
            page.locator('#quant-backtest-tab-' + name).click()
            extent = page.locator('#quant-backtest-panel').evaluate('(panel)=>Math.max(0,panel.scrollHeight-panel.clientHeight)')
            actual = page.evaluate('state().top')
            expected = min(previous, extent)
            # Firefox can round the retained position to a fractional layout
            # unit while scrollHeight/clientHeight expose integer pixels.
            checks.append({'name': 'shared offset follows browser clamp when entering ' + name,
                           'actual': actual, 'expected': expected, 'extent': extent,
                           'toleranceCssPx': 0.5, 'passed': abs(actual - expected) <= 0.5})

        page.evaluate('reset()')
        shared_tab('performance')
        shared_tab('log')
        # Force the long-to-short transition to exercise a real browser clamp;
        # the expected offset depends on the measured destination extent.
        page.evaluate('document.querySelector("#quant-backtest-panel").scrollTop=1e9')
        before_clamp = page.evaluate('state().top')
        shared_tab('performance')
        check('long ledger actually exceeds Performance scroll extent',
              'state().top < ' + str(before_clamp), True)
        shared_tab('log')
        page.evaluate('reset()')
        check('long ledger setup has real scroll extent', 'state().top', 330)
        page.evaluate('update("computing")')
        check('pending visibly hides ledger and clamps DOM', 'state()', {'top': 0, 'tab': 'log', 'rows': 0, 'loading': True})
        page.evaluate('update("partial"); update("updating"); update("ready")')
        check('consecutive pending restores exact offset', 'state()', {'top': 330, 'tab': 'log', 'rows': 120, 'loading': False})
        page.evaluate('update("ready",{revision:2})')
        check('ordinary report revision preserves offset', 'state().top', 330)
        for status in ['error', 'no-data', 'suspended', 'no-trades']:
            page.evaluate('(status)=>{reset();update("computing");update(status,{trades:[]})}', status)
            check(status + ' does not expose old rows', 'state().rows', 0)
            page.evaluate('update("ready")')
            check(status + ' recovery does not resurrect pending scroll', 'state().top', 0)
        page.evaluate('reset();update("computing");document.querySelector("#quant-backtest-tab-performance").click();update("ready")')
        check('switching tab during pending clears active deferred offset', 'state().top', 0)
        page.locator('#quant-backtest-tab-log').click()
        check('Tab switch during pending does not resurrect an old per-tab offset', 'state().top', 0)
        page.evaluate('reset();update("computing");update("ready",{key:{cellId:"cell-b",indicatorId:"sma-b"}})')
        check('new strategy never inherits old scroll', 'state().top', 0)
        page.evaluate('reset();update("computing");update("ready",{symbol:"ETHUSDT"})')
        check('new market never inherits old scroll', 'state().top', 0)
        page.evaluate('reset();update("computing");update("ready",{timeframe:"5"})')
        check('new timeframe never inherits old scroll', 'state().top', 0)
        page.evaluate('reset();update("computing");viewer.close();viewer.open(baseReport)')
        check('close and reopen starts Performance at top', '[state().tab,state().top]', ['performance', 0])
        page.locator('#quant-backtest-tab-log').click()
        check('close clears previous tab memory', 'state().top', 0)
        page.evaluate('reset();update("computing");viewer.setReport(null);update("ready")')
        check('removed report drops deferred offset', 'state().top', 0)
        page.evaluate('reset();document.querySelector("#quant-backtest-tab-log").click()')
        check('same active tab preserves position', 'state().top', 330)
        page.evaluate('viewer.destroy()')
        check('destroy removes Viewer', 'document.querySelectorAll(".quant-backtest-viewer").length', 0)
    finally:
        browser.close()
checks.append({'name': 'page errors', 'actual': errors, 'expected': [], 'passed': not errors})
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
(out/'results.json').write_text(json.dumps({'browser': args.browser, 'checks': checks, 'errors': errors}, indent=2)+'\n')
failed = [check for check in checks if not check['passed']]
print(json.dumps({'checks': len(checks), 'failed': failed}, indent=2))
raise SystemExit(int(bool(failed)))
