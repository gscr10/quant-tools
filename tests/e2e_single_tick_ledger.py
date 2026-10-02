#!/usr/bin/env python3
"""Controlled provider + real Pine engines: publish exactly one tick, then stop.

This is not a live-network test. Uses generated bars to isolate the state
machine and asserts completion without a second tick rescuing the ledger.
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
    parser.add_argument('--port', type=int, default=5256)
    parser.add_argument('--output', type=Path, default=Path('/tmp/sma-single-tick-20261001'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    base = f'http://127.0.0.1:{args.port}'
    cases = []
    with (args.output/'vite.log').open('w') as log:
        server = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--host', '127.0.0.1',
                                   '--port', str(args.port), '--strictPort'], cwd=ROOT, stdout=log, stderr=log)
        try:
            for _ in range(150):
                if server.poll() is not None:
                    raise RuntimeError('Private Vite failed')
                try:
                    if urlopen(base, timeout=1).status == 200:
                        break
                except OSError:
                    time.sleep(.2)
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=True)
                try:
                    for engine_name in ('PineEngine', 'PineWorkerEngine'):
                        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                        errors = []
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        page.route('**/__single_tick_probe__', lambda route: route.fulfill(
                            content_type='text/html', body='<html><body><div id="ws" style="height:650px"></div><div id="bt"></div></body></html>'))
                        page.goto(base+'/__single_tick_probe__')
                        result = page.evaluate('''async engineName => {
                          await import('/src/features/backtesting/backtest.css');
                          const {VelaWorkspace}=await import('/node_modules/@luxalgo/vela/dist/workspace.js');
                          const engines=await import('/packages/vela-pinets/dist/index.js');
                          const {mountBacktestFeature}=await import('/src/app/backtest-feature.ts');
                          const engine=new engines[engineName]();
                          const bars=Array.from({length:80},(_,i)=>({time:1711929600000+i*3600000,open:80+i*.25,high:81+i*.25,low:79+i*.25,close:80+i*.25,volume:100+i}));
                          let stream=null,emitted=0;const runs=[];
                          const provider={listSymbols:async()=>[{ticker:'BTCUSDT',type:'crypto'}],getBars:async()=>bars,
                            subscribe:(ticker,timeframe,onBar)=>{stream=onBar;return ()=>{stream=null}}};
                          const workspace=new VelaWorkspace(document.getElementById('ws'),{layout:'1',theme:'dark',timezone:'Etc/UTC',live:true,persist:false,
                            providers:{singletick:()=>provider},engines:{pine:()=>engine},
                            cells:{probe:{symbol:'SINGLETICK:BTCUSDT',timeframe:'60',bars:80}}});
                          const chart=workspace.active.chart;
                          workspace.on('script:run',r=>runs.push({cause:r.cause,complete:r.complete,forming:r.forming,runId:r.runId,snapshotRevision:r.snapshotRevision}));
                          const diagnostics=[];
                          const feature=mountBacktestFeature(workspace,{host:document.getElementById('bt'),onDiagnostic:(m,e)=>diagnostics.push(m+':'+String(e??''))});
                          const pause=ms=>new Promise(r=>setTimeout(r,ms));
                          const waitFor=async fn=>{for(let i=0;i<200;i++){if(fn())return true;await pause(25)}return false};
                          const value=v=>typeof v==='object'?v?.value:v;
                          const project=()=>{const s=feature.controller.getSnapshot();return s?{status:s.status,revision:s.revision,ledgerRevision:s.ledgerRevision,
                            history:s.history,trades:s.trades?.length,canSimulate:s.capabilities?.canSimulate,netProfit:value(s.metrics?.netProfit)}:null};
                          await chart.historyComplete();
                          const handle=chart.addIndicator('//@version=6\\nstrategy("Independent single tick",overlay=true,initial_capital=25000)\\nif bar_index == 2\\n    strategy.entry("IN",strategy.long,qty=2)\\nif bar_index == 8\\n    strategy.close("IN")',{language:'pine'});
                          const settled=()=>feature.controller.getSnapshot()?.status==='ready'&&feature.controller.getSnapshot()?.trades?.length===1;
                          const initialReady=await waitFor(settled);const before=project();
                          const subscribed=await waitFor(()=>!!stream);
                          if(!subscribed)throw Error('Controlled provider was never subscribed');
                          const tickCountBefore=runs.filter(r=>r.cause==='tick').length;
                          stream({...bars.at(-1),close:bars.at(-1).close+.1,high:bars.at(-1).high+.1,volume:200});emitted++;
                          const tickObserved=await waitFor(()=>runs.filter(r=>r.cause==='tick').length>tickCountBefore);
                          const afterReady=await waitFor(settled);await pause(800);
                          const after=project();const raw=await handle.context(['strategy','trades']);
                          feature.workbench.openViewer();
                          const viewer=document.querySelector('.quant-backtest-viewer')?.textContent;
                          window.cleanupSingleTick=()=>{feature.destroy();workspace.destroy();engine.terminate?.()};
                          return {engineName,controlledProvider:true,emitted,initialReady,before,tickObserved,afterReady,after,raw,runs,viewer,diagnostics};
                        }''', engine_name)
                        page.screenshot(path=str(args.output/f'{engine_name}.png'), full_page=True)
                        page.evaluate('window.cleanupSingleTick()')
                        result['pageErrors'] = errors
                        result['checks'] = {'initialSettled': result['initialReady'], 'oneTickOnly': result['emitted']==1,
                            'tickObserved': result['tickObserved'], 'readyAfterOnlyTick': result['afterReady'] and result['after']['status']=='ready',
                            'ledgerPreserved': result['after']['trades']==1 and result['after']['netProfit']==3,
                            'simulationAvailable': result['after']['canSimulate'], 'noPageErrors': not errors}
                        cases.append(result)
                        print(engine_name, result['checks'], flush=True)
                        page.close()
                finally:
                    browser.close()
        finally:
            server.terminate()
            server.wait(timeout=10)
            (args.output/'result.json').write_text(json.dumps({'cases': cases}, indent=2)+'\n')
    assert len(cases)==2 and all(all(case['checks'].values()) for case in cases), cases


if __name__ == '__main__':
    main()
