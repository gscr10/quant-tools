#!/usr/bin/env python3
"""Fresh controlled holes through real Vela, both Pine engines and Viewer Retry.

Only exchange data is controlled. The provider guard, cache, observer, adapter,
controller and UI are the actual application modules. Evidence stays ignored.
"""
import json
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'audit-evidence/2026-10-07-history-continuity'

PROBE = r'''async ({engineName, mode}) => {
  await import('/src/features/backtesting/backtest.css');
  const {VelaWorkspace}=await import('/node_modules/@luxalgo/vela/dist/workspace.js');
  const engines=await import('/packages/vela-pinets/dist/index.js');
  const {guardProviderHistory}=await import('/src/integrations/vela/provider-history.ts');
  const {enableProviderProgressiveHistory}=await import('/src/integrations/vela/provider-progressive.ts');
  const {installVelaHistoryResilience}=await import('/src/integrations/vela/history-resilience.ts');
  const {observeWorkspaceHistory,observedWorkspaceHistory}=await import('/src/integrations/vela/workspace-history-observer.ts');
  const {mountBacktestFeature}=await import('/src/app/backtest-feature.ts');
  const {sharedBarStore}=await import('/node_modules/@luxalgo/vela/dist/index.js');
  sharedBarStore.clear(); installVelaHistoryResilience();
  const engine=new engines[engineName]();
  const step=60000, start=Date.UTC(2026,8,1), total=2000;
  const bars=Array.from({length:total},(_,i)=>({time:start+i*step,
    open:100+i*.01,high:101+i*.01,low:99+i*.01,close:100.2+i*.01,volume:100}));
  const missing=mode==='junction'?999:mode==='prefix'?1700:300;
  let damaged=true;
  const calls=[];
  const provider=enableProviderProgressiveHistory(guardProviderHistory({
    listSymbols:async()=>[{ticker:'BTCUSDT',type:'crypto'}],
    getSymbolInfo:async()=>({ticker:'BTCUSDT',type:'crypto',currency:'USD',mintick:.01,pricescale:100}),
    getBars:async(_symbol,_tf,range={})=>{
      calls.push({...range,damaged});
      let result=bars.filter(b=>(range.from==null||b.time>=range.from)&&(range.to==null||b.time<=range.to));
      if(range.limit!=null)result=result.slice(-range.limit);
      return damaged?result.filter(b=>b.time!==start+missing*step):result;
    },subscribe:()=>()=>{},
  },'binance'));
  const ws=new VelaWorkspace(document.querySelector('#ws'),{layout:'1',persist:false,live:false,
    providers:{binance:()=>provider},engines:{pine:()=>engine},
    cells:{test:{symbol:'binance:BTCUSDT',timeframe:'1',bars:total}}});
  const stop=observeWorkspaceHistory(ws);
  const feature=mountBacktestFeature(ws,{host:document.querySelector('#bt')});
  const project=()=>{const s=feature.controller.getSnapshot();return s?{status:s.status,history:s.history,
    trades:s.trades?.length,canSimulate:s.capabilities?.canSimulate,error:s.error}:null};
  const wait=async(fn,label)=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}
    throw Error(label+': '+JSON.stringify({ui:project(),history:observedWorkspaceHistory(ws,ws.active),calls}));};
  const samples=[];const sample=setInterval(()=>samples.push({damaged,...project()}),20);
  try {
    const chart=ws.active.chart;
    const source='//@version=6\nstrategy("Continuity audit", initial_capital=100000)\nif bar_index % 100 == 2\n    strategy.entry("L", strategy.long, qty=1)\nif bar_index % 100 == 8\n    strategy.close("L")';
    chart.addIndicator(source,{language:'pine'});
    await chart.historyComplete();
    await wait(()=>project()?.history?.reason==='aborted','gap not reported');
    const failed=project();
    if(failed.canSimulate||failed.status==='ready'||failed.history.complete)throw Error('Sparse history exposed as complete: '+JSON.stringify(failed));
    feature.workbench.openViewer();
    await wait(()=>document.querySelector('.quant-backtest-viewer')?.textContent.includes('Try again'),'retry not visible');
    const errorText=document.querySelector('.quant-backtest-viewer').textContent;
    damaged=false;
    const retry=[...document.querySelectorAll('.quant-backtest-viewer button')].find(b=>b.textContent.includes('Try again'));
    retry.click();
    await wait(()=>project()?.status==='ready'&&project()?.history?.barsLoaded===total&&project()?.canSimulate,'full recovery');
    const recovered=project();
    return {engineName,mode,failed,recovered,errorText,calls,samples,checks:{
      noFalseReady:samples.filter(s=>s.damaged).every(s=>s.status!=='ready'&&!s.canSimulate),
      fullLedger:recovered.trades===20,explicitGap:errorText.includes('gap'),
      repairRequested:calls.some(r=>r.from===start+missing*step),
      retryFetched:calls.some(r=>!r.damaged)}};
  }finally{clearInterval(sample);feature.destroy();stop();ws.destroy();engine.terminate?.();}
}'''

with socket.socket() as port_socket:
    port_socket.bind(('127.0.0.1', 0))
    port = port_socket.getsockname()[1]
base = f'http://127.0.0.1:{port}'
OUT.mkdir(parents=True, exist_ok=True)
results = []
with (OUT/'server.log').open('w') as log:
    process = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--config',
        'tests/vite-performance.config.ts', '--host', '127.0.0.1', '--port', str(port), '--strictPort'],
        cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
    try:
        deadline=time.monotonic()+30
        while True:
            if process.poll() is not None: raise RuntimeError('Vite exited before ready')
            try:
                with urlopen(base, timeout=1): break
            except OSError:
                if time.monotonic()>deadline: raise TimeoutError('Vite readiness')
                time.sleep(.1)
        with sync_playwright() as p:
            browser=p.chromium.launch()
            try:
                for engine in ('PineEngine','PineWorkerEngine'):
                    for mode in ('prefix','older','junction'):
                        page=browser.new_page(viewport={'width':1440,'height':1000})
                        errors=[]
                        page.on('pageerror',lambda e:errors.append(str(e)))
                        page.route('**/continuity-audit',lambda r:r.fulfill(content_type='text/html',
                            body='<html><body><div id="ws" style="height:720px"></div><div id="bt"></div></body></html>'))
                        page.goto(base+'/continuity-audit')
                        try:
                            result=page.evaluate(PROBE,{'engineName':engine,'mode':mode})
                            result['pageErrors']=errors
                            result['checks']['noPageErrors']=not errors
                            results.append(result)
                            print(engine,mode,json.dumps(result['checks']),flush=True)
                        finally:page.close()
            finally:browser.close()
    finally:
        process.terminate()
        process.wait(timeout=10)
        (OUT/'results.json').write_text(json.dumps({'cases':results},indent=2))
assert len(results)==6 and all(all(c['checks'].values()) for c in results), 'Continuity gate failed'
