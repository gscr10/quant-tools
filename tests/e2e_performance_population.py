"""R08: fresh actual-engine reports, account-only open P&L, actual Viewer rows.

Generated OHLC isolates projection algebra, not reference-site broker parity.
"""
import argparse
import json
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('/tmp/r08-performance'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    base = 'http://127.0.0.1:5284'
    server = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--host', '127.0.0.1', '--port', '5284', '--strictPort'],
                              cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    results = []
    try:
        for _ in range(100):
            if server.poll() is not None:
                raise RuntimeError('Vite exited')
            try:
                if urlopen(base, timeout=1).status == 200:
                    break
            except OSError:
                time.sleep(.1)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for engine in ['PineEngine', 'PineWorkerEngine']:
                    for scenario in ['long', 'short', 'flat', 'reversal']:
                        page = browser.new_page(viewport={'width':1440, 'height':1000})
                        errors = []
                        page.on('pageerror', lambda e: errors.append(str(e)))
                        page.route('**/__r08__', lambda route: route.fulfill(content_type='text/html', body='<main id="chart" style="height:500px"></main><div id="report"></div>'))
                        page.goto(base+'/__r08__')
                        result = page.evaluate('''async ({engineName,scenario}) => {
                          const {VelaWorkspace}=await import('/node_modules/@luxalgo/vela/dist/workspace.js');
                          const engines=await import('/packages/vela-pinets/dist/index.js');
                          const {mountBacktestFeature}=await import('/src/app/backtest-feature.ts');
                          const {observeWorkspaceHistory}=await import('/src/integrations/vela/workspace-history-observer.ts');
                          await import('/src/features/backtesting/backtest.css');
                          const bars=Array.from({length:48},(_,i)=>({time:1760000000000+i*900000,open:100+i*.5,close:100.25+i*.5,high:101+i*.5,low:99+i*.5,volume:100}));
                          const instance=new engines[engineName]();
                          const ws=new VelaWorkspace(document.querySelector('#chart'),{layout:'1',persist:false,live:false,theme:'dark',
                            engines:{pine:()=>instance},cells:{test:{symbol:'TEST:BTCUSDT',timeframe:'15',bars:48,data:bars}}});
                          const stop=observeWorkspaceHistory(ws);
                          const feature=mountBacktestFeature(ws,{host:document.querySelector('#report')});
                          await ws.active.chart.historyComplete();
                          const source='//@version=6\\nstrategy("R08 '+scenario+'",overlay=true,initial_capital=10000,commission_type=strategy.commission.percent,commission_value=0.1,slippage=2)\\n'
                            +'if bar_index == 3\\n    strategy.entry("L",strategy.long,qty=2)\\n'
                            +'if bar_index == 12\\n    strategy.close("L")\\n'
                            +(scenario==='flat'?'':scenario==='short'?'if bar_index == 20\\n    strategy.entry("S",strategy.short,qty=3)\\n':
                              'if bar_index == 20\\n    strategy.entry("L2",strategy.long,qty=3)\\n')
                            +(scenario==='reversal'?'if bar_index == 30\\n    strategy.entry("S",strategy.short,qty=2)\\n':'');
                          const handle=ws.active.chart.addIndicator(source,{language:'pine'});
                          for(let i=0;i<400&&feature.controller.getSnapshot()?.status!=='ready';i++)await new Promise(r=>setTimeout(r,25));
                          const report=feature.controller.getSnapshot();
                          if(report?.status!=='ready')throw Error('report did not settle: '+JSON.stringify(report));
                          const raw=await handle.context(['strategy','trades']);
                          feature.workbench.openViewer();
                          for(let i=0;i<100&&!document.querySelector('.quant-backtest-viewer tr');i++)await new Promise(r=>setTimeout(r,20));
                          const rows=[...document.querySelectorAll('.quant-backtest-viewer tr')].map(r=>[...r.querySelectorAll('th,td')].map(c=>c.textContent));
                          const close=(a,b)=>Math.abs(a-b)<1e-7;
                          const net=report.metrics.netProfit, benchmark=report.metrics.buyAndHoldPnl;
                          const expectedNet=raw.strategy.netPnl+raw.strategy.openPnl;
                          const expected={long:0,short:0};
                          for(const t of raw.trades)if(!t.open)expected[t.side]+=t.pnl;
                          for(const t of raw.trades)if(t.open)expected[t.side]-=t.commission||0;
                          if(raw.strategy.position!==0)expected[raw.strategy.position>0?'long':'short']+=raw.strategy.openPnl;
                          const checks={ready:report.status==='ready',accountMTM:close(net,expectedNet),
                            directionSum:close(report.comparison.long.netProfit+report.comparison.short.netProfit,net),
                            long:close(report.comparison.long.netProfit,expected.long),short:close(report.comparison.short.netProfit,expected.short),
                            benchmarkFormula:typeof benchmark==='number'&&close(report.metrics.strategyOutperformance,net-benchmark),
                            allRowFormula:close(report.comparison.all.strategyOutperformance,report.comparison.all.netProfit-report.comparison.all.buyAndHoldPnl),
                            hasNetRow:rows.some(r=>r[0]==='Net Profit'),hasBenchmarkRow:rows.some(r=>r[0]==='Strategy Outperformance')};
                          window.cleanupR08=()=>{feature.destroy();stop();ws.destroy();instance.terminate?.()};
                          return {engineName,scenario,checks,expected,metrics:report.metrics,comparison:report.comparison,raw,rows};
                        }''', {'engineName':engine,'scenario':scenario})
                        page.screenshot(path=str(args.output/f'{engine}-{scenario}.png'), full_page=True)
                        page.evaluate('window.cleanupR08()')
                        result['pageErrors'] = errors
                        result['checks']['noPageErrors'] = not errors
                        results.append(result)
                        print(engine, scenario, result['checks'], flush=True)
                        page.close()
            finally:
                browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)
        (args.output/'results.json').write_text(json.dumps({'cases':results,'data':'generated OHLC, actual engines, fees/slippage enabled'},indent=2)+'\n')
    assert len(results)==8 and all(all(c['checks'].values()) for c in results), 'R08 failed; inspect output'


if __name__ == '__main__':
    main()
