#!/usr/bin/env python3
"""Real Vela + both Pine engines, controlled delayed deep history (no old fixtures).

The provider's OHLC arrays are freshly constructed, not exchange-price evidence.
Captures first paint/market commit before a held older-range response and checks
the final ledger after completion; separately exercises depth-only setMarket.
"""
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:5280'
OUT = Path(os.environ.get('QUANT_DEEP_OUTPUT', ROOT/'audit-evidence/2026-10-01-ledger-remediation/deep-history'))

PROBE = r'''async ({engineName, mode}) => {
  await import('/src/features/backtesting/backtest.css');
  const {VelaWorkspace}=await import('/node_modules/@luxalgo/vela/dist/workspace.js');
  const engines=await import('/packages/vela-pinets/dist/index.js');
  const {mountBacktestFeature}=await import('/src/app/backtest-feature.ts');
  const {observeWorkspaceHistory,observedWorkspaceHistory}=await import('/src/integrations/vela/workspace-history-observer.ts');
  const engine=new engines[engineName]();
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(fn,label)=>{for(let i=0;i<1000;i++){if(fn())return;await pause(25);}throw new Error('Timed out: '+label);};
  const bars=Array.from({length:16000},(_,i)=>({time:1750000000000+i*900000,open:100+i*.01,
    high:101+i*.01,low:99+i*.01,close:100.2+i*.01,volume:100+i}));
  const calls=[],trace=[],snapshots=[];let hold=false;const held=[];
  const provider={listSymbols:async()=>['BASE','DEEP'].map(ticker=>({ticker,type:'crypto'})),
    getSymbolInfo:async ticker=>({ticker,mintick:.01,pricescale:100,type:'crypto'}),
    getBars:async(symbol,tf,range={})=>{
      const record={symbol,tf,range:{...range},held:hold&&range.to!==undefined};calls.push(record);
      if(record.held)await new Promise(resolve=>held.push(resolve));
      let result=bars.filter(b=>(range.from===undefined||b.time>=range.from)&&(range.to===undefined||b.time<=range.to));
      if(range.limit!==undefined)result=result.slice(-range.limit);
      record.returned=result.length;return result;
    },subscribe:()=>()=>{}};
  const ws=new VelaWorkspace(document.querySelector('#ws'),{layout:'1',theme:'dark',timezone:'Etc/UTC',
    live:false,persist:false,providers:{deepaudit:()=>provider},engines:{pine:()=>engine},
    cells:{deep:{symbol:'DEEPAUDIT:BASE',timeframe:'15',bars:36}}});
  const stopObserver=observeWorkspaceHistory(ws);
  const chart=ws.active.chart;
  const cleanups=[];
  for(const name of ['load:start','load:end','history:progress','history:complete','market:changed']){
    cleanups.push(chart.on(name,event=>trace.push({index:trace.length,event:name,...event})));
  }
  cleanups.push(ws.on('script:run',r=>trace.push({index:trace.length,event:'script:run',cause:r.cause,complete:r.complete,bar:r.bar})));
  const diagnostics=[];
  const feature=mountBacktestFeature(ws,{host:document.querySelector('#bt'),onDiagnostic:(m,e)=>diagnostics.push(m+':'+String(e??''))});
  const project=()=>{const s=feature.controller.getSnapshot();return s?{status:s.status,history:s.history,
    trades:s.trades?.length,canSimulate:s.capabilities?.canSimulate,revision:s.revision,
    pnl:typeof s.metrics?.netProfit==='object'?s.metrics.netProfit.value:s.metrics?.netProfit,error:s.error}:null;};
  const sample=()=>{const s=project();if(s){const previous=snapshots.at(-1);if(JSON.stringify(previous?.value)!==JSON.stringify(s))snapshots.push({traceIndex:trace.length,value:s});}};
  const timer=setInterval(sample,20);
  try{
    await chart.historyComplete();
    const source='//@version=6\nstrategy("Fresh deferred deep audit",overlay=true,initial_capital=1000000)\nif bar_index % 1000 == 2\n    strategy.entry("entry",strategy.long,qty=1)\nif bar_index % 1000 == 8\n    strategy.close("entry")';
    const handle=chart.addIndicator(source,{language:'pine'});
    await wait(()=>project()?.status==='ready'&&project()?.trades===1,'initial complete ledger');
    const initial=project();const startIndex=trace.length;const callsStart=calls.length;
    hold=true;
    const target=mode==='market' ? 12000 : 2000;
    const pending=chart.setMarket(mode==='market'?{symbol:'DEEPAUDIT:DEEP',bars:target}:{bars:target});
    await wait(()=>held.length>0,'deferred older-range request');
    await pending;
    await pause(150);sample();
    const during={ui:project(),history:observedWorkspaceHistory(ws,ws.active),trace:trace.slice(startIndex)};
    hold=false;held.splice(0).forEach(resolve=>resolve());
    await chart.historyComplete();
    let completed=true;
    try{await wait(()=>project()?.status==='ready'&&project()?.trades===target/1000&&project()?.history?.complete===true,'final deep ledger');}
    catch{completed=false;}
    sample();
    const raw=await handle.context(['strategy','trades']);
    const after=project();const events=trace.slice(startIndex);
    const changed=events.findIndex(e=>e.event==='market:changed');
    const complete=events.findIndex(e=>e.event==='history:complete');
    const checks={deferredOlderRange: calls.slice(callsStart).some(c=>c.held),
      notReadyDuringBackfill:during.ui?.status!=='ready',
      completionAfterRelease:complete>=0,
      targetHistoryObserved:after?.history?.barsLoaded===target,
      completeLedger:completed&&after?.trades===target/1000,
      rawLedgerCount:raw?.trades?.length===target/1000,
      transitionContract:mode==='market'?changed>=0&&complete>changed:
        !events.some(e=>e.event==='market:changed'||e.event==='load:start')};
    feature.workbench.openViewer();await pause(100);
    return {engineName,mode,target,checks,initial,during,after,raw:{trades:raw?.trades?.length,
      netPnl:raw?.strategy?.netPnl,identity:raw?.strategy?.reportIdentity},events,calls:calls.slice(callsStart),snapshots,diagnostics};
  }finally{
    clearInterval(timer);hold=false;held.splice(0).forEach(resolve=>resolve());
    window.cleanupDeep=()=>{feature.destroy();cleanups.forEach(f=>f());stopObserver();ws.destroy();engine.terminate?.();};
  }
}'''

process=subprocess.Popen([str(ROOT/'node_modules/.bin/vite'),'--host','127.0.0.1','--port','5280','--strictPort'],
                         cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
results=[]
try:
    deadline=time.monotonic()+30
    while True:
        if process.poll() is not None:
            raise RuntimeError('Vite startup failed')
        try:
            with urlopen(BASE,timeout=1): break
        except OSError:
            if time.monotonic()>deadline: raise TimeoutError('Vite startup')
            time.sleep(.1)
    OUT.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        browser=p.chromium.launch()
        try:
            for engine in ['PineEngine','PineWorkerEngine']:
                for mode in ['market','depth']:
                    page=browser.new_page(viewport={'width':1440,'height':1000})
                    errors=[]
                    page.on('pageerror',lambda e:errors.append(str(e)))
                    page.route('**/deep-ledger-probe',lambda r:r.fulfill(content_type='text/html',body='<!doctype html><body style="margin:0"><div id="ws" style="height:720px"></div><div id="bt"></div></body>'))
                    page.goto(BASE+'/deep-ledger-probe')
                    try:
                        result=page.evaluate(PROBE,{'engineName':engine,'mode':mode})
                        result['pageErrors']=errors
                        result['checks']['noPageErrors']=not errors
                        page.screenshot(path=str(OUT/f'{engine}-{mode}.png'))
                        results.append(result)
                    finally:
                        page.evaluate('window.cleanupDeep?.()')
                        page.close()
        finally:
            browser.close()
finally:
    process.terminate()
    process.wait(timeout=10)
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'results.json').write_text(json.dumps({'cases':results,'data':'fresh controlled OHLC; actual Vela and Pine engines'},indent=2))
for result in results:
    print(result['engineName'],result['mode'],json.dumps(result['checks']))
assert len(results)==4 and all(all(r['checks'].values()) for r in results), 'Deep history assertions failed; see results.json'
