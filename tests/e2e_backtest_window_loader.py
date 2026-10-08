#!/usr/bin/env python3
"""Real Vela + both Pine engines: exact date execution and static-data integrity."""
import argparse
import json
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SETUP = r'''async engineName => {
 const {VelaWorkspace}=await import('/node_modules/@luxalgo/vela/dist/workspace.js');
 const engines=await import('/packages/vela-pinets/dist/index.js');
 const {sharedBarStore}=await import('/node_modules/@luxalgo/vela/dist/index.js');
 const {guardProviderHistory}=await import('/src/integrations/vela/provider-history.ts');
 const {installDefaultTimeframeSwitchPolicy}=await import('/src/integrations/vela/timeframe-switch-policy.ts');
 const {createBacktestWindowMarketLoader}=await import('/src/integrations/vela/backtest-window-loader.ts');
 sharedBarStore.clear();
 const start=Date.UTC(2024,0,1),step=60000,total=18000;
 const dataset=tf=>{const interval=Number(tf)*step;return Array.from({length:Math.floor(total/Number(tf))},(_,i)=>{
   const close=100+i%10;return {time:start+i*interval,open:close,high:close+2,low:close-2,close,volume:1};});};
 const requests=[], executions=[], runs=[], errors=[],callbacks=[];
 const engine=new engines[engineName](),execute=engine.execute.bind(engine);
 engine.execute=(req,handlers)=>{executions.push({symbol:req.market.symbol,tf:req.market.timeframe,
   count:req.bars.length,first:req.bars[0]?.time,last:req.bars.at(-1)?.time});return execute(req,handlers);};
 const provider=guardProviderHistory({
   listSymbols:async()=>[{ticker:'BTCUSDT',type:'crypto'}],
   getSymbolInfo:async()=>({ticker:'BTCUSDT',currency:'USD',mintick:.01,pricescale:100,type:'crypto'}),
   getBars:async(ticker,tf,range={})=>{requests.push({ticker,tf,...range});let bars=dataset(tf)
      .filter(b=>(range.from==null||b.time>=range.from)&&(range.to==null||b.time<=range.to));
     return range.limit==null?bars:bars.slice(-range.limit);},subscribe:()=>()=>{}
 },'binance');
 const ws=new VelaWorkspace(document.querySelector('#ws'),{layout:'1',persist:false,live:true,
   providers:{binance:()=>provider},engines:{pine:()=>engine},cells:{test:{symbol:'BTCUSDT',timeframe:'1',bars:2000}}});
 const stopPolicy=installDefaultTimeframeSwitchPolicy(ws,2000),chart=ws.active.chart;
 await chart.ready();await chart.historyComplete();
 chart.on('script:run',run=>runs.push({id:run.id,barIndex:run.bar,time:run.time,net:run.strategy?.netPnl}));
 const outcome=await chart.runIndicator('//@version=6\nstrategy("Window real engine",initial_capital=10000,default_qty_type=strategy.fixed,default_qty_value=1)\nif bar_index % 10 == 0\n    strategy.entry("L",strategy.long)\nif bar_index % 10 == 5\n    strategy.close("L")\nplot(close)',{language:'pine'});
 if(!outcome.ok)throw outcome.error;
 const loader=createBacktestWindowMarketLoader(chart,{onPending:(req,id)=>callbacks.push(['pending',id.timeframe]),
   onCommit:req=>callbacks.push(['commit',req.mode]),onSettled:r=>callbacks.push(['settled',r.bars]),onError:e=>errors.push(String(e))});
 const from=start+3000*step,to=start+6000*step-1;
 window.__windowLoader={chart,loader,from,to,executions,runs,requests,callbacks,errors,
   apply:()=>loader.apply({mode:'window',from,to}),switch:tf=>chart.setMarket({timeframe:tf}),
   default:()=>loader.apply({mode:'default'}),context:()=>outcome.handle.context(),
   capture:()=>({executions,runs,requests,callbacks,errors,market:chart.market}),
   dispose:()=>{loader.destroy();stopPolicy();ws.destroy();engine.terminate?.();}};
 return {from,to,initial:executions.at(-1)};
}'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'audit-evidence/backtest-window-loader')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    result = {'cases': [], 'pageErrors': []}
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    with (args.output/'server.log').open('w') as log:
        server = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--config', 'tests/vite-provider.config.ts',
                                   '--host', '127.0.0.1', '--port', str(port), '--strictPort'], cwd=ROOT,
                                  stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic()+30
            while True:
                try:
                    with urlopen(base, timeout=1):
                        break
                except OSError:
                    if time.monotonic()>deadline:
                        raise RuntimeError('Vite readiness timeout')
                    time.sleep(.1)
            with sync_playwright() as p:
                browser = p.chromium.launch()
                try:
                    for engine in ['PineEngine', 'PineWorkerEngine']:
                        page = browser.new_page(viewport={'width': 1440, 'height': 900})
                        page.on('pageerror', lambda error: result['pageErrors'].append(str(error)))
                        try:
                            page.goto(base+'/tests/fixtures/history-live.html', wait_until='domcontentloaded')
                            setup = page.evaluate(SETUP, engine)
                            loaded = page.evaluate('window.__windowLoader.apply()')
                            assert loaded['applied'] and loaded['bars']==3000, loaded
                            page.wait_for_function('window.__windowLoader.runs.at(-1)?.barIndex===2999',timeout=30000)
                            first = page.evaluate('window.__windowLoader.capture()')
                            assert first['executions'][-1]['first']==setup['from'], first['executions'][-1]
                            assert first['executions'][-1]['last'] == setup['to'] - 59999, first['executions'][-1]
                            initial_runs = len(first['runs'])
                            before_plots = page.evaluate('window.__windowLoader.context()')['plots']
                            assert before_plots, 'The real engine must publish numeric candle-derived plots'
                            first_plot = next(iter(before_plots.values()))
                            assert first_plot and isinstance(first_plot[-1]['value'], (int, float)), first_plot
                            page.wait_for_timeout(2200)
                            stable = page.evaluate('window.__windowLoader.capture()')
                            assert page.evaluate('window.__windowLoader.context()')['plots'] == before_plots, 'Static candle values changed through synthesized ticks'
                            assert all((run['barIndex'], run['time'], run['net']) ==
                                       (first['runs'][-1]['barIndex'], first['runs'][-1]['time'], first['runs'][-1]['net'])
                                       for run in stable['runs'][initial_runs:]), 'Historical window changed through a live tick'
                            page.evaluate("window.__windowLoader.switch('5')")
                            page.wait_for_function('window.__windowLoader.executions.at(-1)?.tf==="5"&&window.__windowLoader.runs.at(-1)?.barIndex===599',timeout=30000)
                            five = page.evaluate('window.__windowLoader.capture()')
                            assert five['executions'][-1]['count']==600, five['executions'][-1]
                            assert five['executions'][-1]['first'] >= setup['from'], five['executions'][-1]
                            page.evaluate('window.__windowLoader.default()')
                            page.wait_for_function('window.__windowLoader.runs.at(-1)?.barIndex===1999',timeout=30000)
                            default = page.evaluate('window.__windowLoader.capture()')
                            assert default['market']['bars']==2000, default['market']
                            page.evaluate("window.__windowLoader.switch('1')")
                            page.wait_for_function('window.__windowLoader.executions.at(-1)?.tf==="1"&&window.__windowLoader.runs.at(-1)?.barIndex===1999',timeout=30000)
                            final = page.evaluate('window.__windowLoader.capture()')
                            assert final['executions'][-1]['count']==2000, final['executions'][-1]
                            assert not final['errors'], final['errors']
                            result['cases'].append({'engine':engine,'setup':setup,'window':first,'five':five,'default':default,'final':final})
                        except Exception as error:
                            result['cases'].append({'engine':engine,'error':str(error),'capture':page.evaluate('window.__windowLoader?.capture()')})
                            raise
                        finally:
                            page.evaluate('window.__windowLoader?.dispose()')
                            page.close()
                finally:
                    browser.close()
            assert not result['pageErrors'], result['pageErrors']
        finally:
            server.terminate()
            server.wait(timeout=10)
            (args.output/'results.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({'cases':len(result['cases']),'pageErrors':result['pageErrors']}))


if __name__ == '__main__':
    main()
