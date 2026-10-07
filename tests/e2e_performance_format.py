"""Actual Viewer DOM regression for Performance/Benchmark display precision.

Expected presentation was independently checked against the reference's loaded
StrategyPerformance component with controlled props. This does not assert that
the reference naturally publishes a non-empty benchmark or matching formulas.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    (None, '-'), (0, '0.00'), (0.1, '+0.1'), (-0.1, '-0.1'),
    (0.000123456789, '+0.0001235'), (-0.000123456789, '-0.0001235'),
    (1e-7, '+0.0000001'), (1e-8, '+1.00e-8'), (-1e-8, '-1.00e-8'),
    (1, '+1.00'), (-1, '-1.00'), (1234.56789, '+1,234.57'),
    (-1234.56789, '-1,234.57'), (999999.99, '+999,999.99'),
    (1000000, '+1.0M'), (-1234567.89, '-1.2M'),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('/tmp/quant-performance-format'))
    parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    base = 'http://127.0.0.1:5387'
    results, errors, window_errors, dev_clients = [], [], [], []
    server = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--config', 'tests/vite-performance.config.ts',
                               '--host', '127.0.0.1', '--port', '5387', '--strictPort'],
                              cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.monotonic() + 45
        while True:
            if server.poll() is not None:
                raise RuntimeError('Performance format Vite exited')
            try:
                if urlopen(base, timeout=1).status == 200:
                    break
            except OSError:
                pass
            if time.monotonic() > deadline:
                raise TimeoutError('Performance format Vite startup timed out')
            time.sleep(.1)
        with sync_playwright() as pw:
            browser = getattr(pw, args.browser).launch()
            try:
                page = browser.new_page(viewport={'width': 1440, 'height': 1000}, locale='en-US')
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('request', lambda request: dev_clients.append(request.url) if '/@vite/client' in request.url else None)
                page.add_init_script('window.__windowErrors=[];addEventListener("error",e=>window.__windowErrors.push(e.message));')
                page.route('**/__performance_format__', lambda route: route.fulfill(content_type='text/html', body='''
                  <!doctype html><html><head><link rel="icon" href="data:,">
                  <link rel="stylesheet" href="/src/style.css"></head>
                  <body><main id="host" style="position:fixed;inset:0"></main></body></html>'''))
                page.goto(base+'/__performance_format__')
                page.evaluate('''async () => {
                  const {BacktestWorkbench}=await import('/src/features/backtesting/backtest-workbench.ts');
                  const base={key:{cellId:'format-cell',indicatorId:'format-strategy'},revision:1,runId:'format-run',
                    strategyName:'Performance formatting',status:'ready',symbol:'BINANCE:BTCUSDT',timeframe:'15',
                    currency:'usd',trades:[],metrics:{trades:0},summary:{trades:0}};
                  const workbench=new BacktestWorkbench('#host',{initialReport:base});
                  workbench.openViewer();
                  window.__formatProbe={set(value,currency='usd'){
                    const metrics={trades:0,netProfit:value,grossProfit:value,grossLoss:value,
                      buyAndHoldPnl:value,buyAndHoldPercent:value,strategyOutperformance:value,
                      maxDrawdown:value,maxDrawdownPercent:value,profitFactor:value,sharpe:value,sortino:value};
                    workbench.setReport({...base,revision:++base.revision,currency,metrics,summary:metrics,
                      comparison:{all:metrics,long:{},short:{}}});
                    return [...document.querySelectorAll('.quant-backtest-metric-table tbody tr')].map(row=>({
                      cells:[...row.querySelectorAll('th,td')].map(cell=>cell.textContent),
                      colors:[...row.querySelectorAll('td')].map(cell=>getComputedStyle(cell).color),
                      units:[...row.querySelectorAll('.quant-backtest-metric-unit')].map(unit=>({text:unit.textContent,fontSize:getComputedStyle(unit).fontSize})),
                    }));
                  },destroy:()=>workbench.destroy()};
                  await document.fonts.ready;
                }''')
                for currency in ['usd', 'EUR', 'usdt']:
                    for value, expected in CASES:
                        rows = page.evaluate('({value,currency})=>window.__formatProbe.set(value,currency)', {'value':value,'currency':currency})
                        indexed = {row['cells'][0]: row for row in rows}
                        for label in ['Buy and Hold PnL', 'Buy and Hold % Gain', 'Strategy Outperformance']:
                            row = indexed[label]
                            suffix = '' if value is None else '%' if label == 'Buy and Hold % Gain' else ' '+currency.upper()
                            assert row['cells'] == [label, expected+suffix, '', ''], row
                            expected_color = 'rgb(245, 245, 245)' if value is None else 'rgb(8, 153, 129)' if value > 0 else 'rgb(242, 54, 69)'
                            assert row['colors'][0] == expected_color, row
                            assert all(unit['fontSize'] == '12px' for unit in row['units']), row
                        if value == 1234.56789:
                            assert indexed['Profit Factor']['cells'][1] == '1234.568'
                            assert indexed['Drawdown']['cells'][1] == f'1,234.57 {currency.upper()} (1,234.57%)'
                        results.append({'currency':currency,'input':value,'rows':rows})
                page.evaluate('window.__formatProbe.set(0.000123456789)')
                page.locator('.quant-backtest-metric-table').screenshot(path=str(args.output/f'{args.browser}-small-values.png'))
                page.set_viewport_size({'width':390,'height':844})
                page.evaluate('window.__formatProbe.set(1234567.89)')
                page.locator('.quant-backtest-metric-table tr').last.scroll_into_view_if_needed()
                page.screenshot(path=str(args.output/f'{args.browser}-mobile-million-values.png'))
                page.evaluate('window.__formatProbe.destroy()')
                window_errors = page.evaluate('window.__windowErrors')
                assert not errors and not window_errors and not dev_clients, [errors,window_errors,dev_clients]
            finally:
                browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)
        (args.output/f'{args.browser}-results.json').write_text(json.dumps({
            'scope':'Controlled values through actual local Workbench/Viewer, independent of arithmetic golden.',
            'browser':args.browser,'cases':results,'pageErrors':errors,'windowErrors':window_errors,'devClientRequests':dev_clients,
        },indent=2)+'\n')
    print(json.dumps({'browser':args.browser,'cases':len(results),'benchmarkCells':len(results)*9,'pageErrors':errors,'windowErrors':window_errors}))


if __name__ == '__main__':
    main()
