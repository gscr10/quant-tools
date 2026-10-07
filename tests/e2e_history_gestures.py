#!/usr/bin/env python3
"""Native pointer/wheel history pagination through real Vela and both engines.

Only provider OHLC/failures are controlled. No chart/renderer/input method is
mocked, and no test calls setMarket({bars}) to trigger history pagination.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('QUANT_GESTURE_OUT', ROOT / 'audit-evidence/2026-10-07-history-gestures'))
OUT.mkdir(parents=True, exist_ok=True)
BROWSER = os.environ.get('QUANT_GESTURE_BROWSER', 'chromium')

BOOT = r'''async ({engineName,mode}) => {
  await import('/src/features/backtesting/backtest.css');
  const {VelaWorkspace}=await import('/node_modules/@luxalgo/vela/dist/workspace.js');
  const {sharedBarStore}=await import('/node_modules/@luxalgo/vela/dist/index.js');
  const engines=await import('/packages/vela-pinets/dist/index.js');
  const {guardProviderHistory}=await import('/src/integrations/vela/provider-history.ts');
  const {installVelaHistoryResilience}=await import('/src/integrations/vela/history-resilience.ts');
  const {installDefaultTimeframeSwitchPolicy}=await import('/src/integrations/vela/timeframe-switch-policy.ts');
  const {observeWorkspaceHistory,observedWorkspaceHistory}=await import('/src/integrations/vela/workspace-history-observer.ts');
  const {mountBacktestFeature}=await import('/src/app/backtest-feature.ts');
  sharedBarStore.clear();installVelaHistoryResilience();
  const rows=new Map(),calls=[],events=[],samples=[],inputs=[];
  let release=null,damaged=true,hold=mode==='hold';
  const count=mode==='genesis'?2250:30000;
  const now=Math.floor(Date.now()/300000)*300000;
  const source=tf=>{
    if(rows.has(tf))return rows.get(tf);
    const step=Number(tf)*60000;
    const bars=Array.from({length:count},(_,i)=>({time:now-(count-1-i)*step,
      open:100+i*.01,high:101+i*.01,low:99+i*.01,close:100.2+i*.01,volume:100}));
    rows.set(tf,bars);return bars;
  };
  const provider=guardProviderHistory({
    listSymbols:async()=>[{ticker:'BTCUSDT',type:'crypto'}],
    getSymbolInfo:async()=>({ticker:'BTCUSDT',type:'crypto',currency:'USD',mintick:.01,pricescale:100}),
    getBars:async(symbol,tf,range={})=>{
      const call={symbol,tf,range:{...range},damaged};calls.push(call);
      if(hold&&range.to!=null){hold=false;await new Promise(r=>{release=r;});}
      const all=source(tf);let result=all.filter(b=>(range.from==null||b.time>=range.from)&&(range.to==null||b.time<=range.to));
      if(range.limit!=null)result=result.slice(-range.limit);
      const missing=all.at(-3000)?.time;
      if(damaged&&(mode==='persistent'||mode==='repair')&&range.to!=null&&tf==='1') {
        if(mode==='persistent'||range.from==null)result=result.filter(b=>b.time!==missing);
      }
      call.returned=result.length;return result;
    },subscribe:()=>()=>{},
  },'binance');
  const engine=new engines[engineName]();
  const ws=new VelaWorkspace(document.querySelector('#ws'),{layout:'1',persist:false,live:false,
    symbol:'binance:BTCUSDT',timeframe:'5',bars:2000,animations:false,
    drawingToolbar:false,topbar:{left:['timeframes'],right:[]},
    providers:{binance:()=>provider},engines:{pine:()=>engine}});
  const stopSwitch=installDefaultTimeframeSwitchPolicy(ws,2000);
  const stopHistory=observeWorkspaceHistory(ws);
  const feature=mountBacktestFeature(ws,{host:document.querySelector('#bt'),onDiagnostic:(message,error)=>events.push({kind:'diagnostic',message,error:String(error),stack:error?.stack})});
  const stopDiagnostics=feature.controller.source.subscribe(e=>{if(e.type==='stale-drop')events.push(e);});
  const chart=()=>ws.active.chart;
  const project=()=>{const s=feature.controller.getSnapshot();return s?{
    status:s.status,history:s.history,canSimulate:s.capabilities?.canSimulate,trades:s.trades?.length}:null;};
  const snapshot=()=>{const c=chart(),bars=c.orchestrator.rawBars,all=source(c.market.timeframe),map=new Map(all.map(b=>[b.time,b]));
    return {market:c.market,count:bars.length,first:bars[0]?.time,last:bars.at(-1)?.time,
      range:c.getVisibleRange(),spacing:c.orchestrator.renderer.coords.getViewport().barSpacing,
      continuous:bars.every((b,i)=>i===0||b.time-bars[i-1].time===Number(c.market.timeframe)*60000),
      sourceMatches:bars.every(b=>JSON.stringify(b)===JSON.stringify(map.get(b.time))),
      history:observedWorkspaceHistory(ws,ws.active),report:project(),requests:calls.length};};
  const wait=async(fn,label)=>{for(let i=0;i<600;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}
    throw Error(label+': '+JSON.stringify({state:snapshot(),calls,events,
      switching:chart().orchestrator.switchingMarket,records:chart().orchestrator.registry.all().map(r=>({id:r.id,hidden:r.hidden,pendingCause:r.pendingCause})),
      entries:[...feature.controller.source.entries.values()].map(e=>({revision:e.revision,ledgerRevision:e.ledgerRevision,epoch:e.epoch,awaiting:e.awaitingMarketRun,invalidated:e.invalidatedMarketRunId,runId:e.run?.strategy?.reportRunId,ledger:e.ledgerState,series:e.seriesState,context:e.context?.strategy?.reportRunId,
        adapter:(()=>{const s=feature.controller.source.getSnapshot(e.key);return {status:s?.status,ledger:s?.ledgerRevision,revision:s?.revision,capabilities:s?.capabilities,tradeCount:s?.trades?.length};})()}))}));};
  await chart().ready();await chart().historyComplete();
  await chart().setMarket({timeframe:'1'});await chart().historyComplete();
  chart().on('history:complete',e=>events.push({...e,market:chart().market}));
  ws.on('script:run',e=>events.push({kind:'run',cause:e.cause,complete:e.complete,runId:e.strategy?.reportRunId,points:e.strategy?.reportPointCount}));
  const sourceCode='//@version=6\nstrategy("Gesture history", initial_capital=100000)\nif bar_index % 100 == 2\n    strategy.entry("L", strategy.long, qty=1)\nif bar_index % 100 == 8\n    strategy.close("L")';
  chart().addIndicator(sourceCode,{language:'pine'});
  await wait(()=>project()?.status==='ready'&&project()?.trades===20,'initial ready');
  const sampling=setInterval(()=>samples.push(project()),30);
  for(const kind of ['pointerdown','pointerup','wheel'])document.querySelector('#ws').addEventListener(kind,e=>inputs.push({kind,trusted:e.isTrusted,x:e.clientX,y:e.clientY,dx:e.deltaX,dy:e.deltaY}));
  window.gesture={ws,chart,feature,calls,events,samples,inputs,source,snapshot,wait,
    get held(){return release!==null;},release(){release?.();release=null;},recover(){damaged=false;},
    async settled(depth=4000){await wait(()=>snapshot().count===depth&&project()?.status==='ready','gesture history complete');return snapshot();},
    destroy(){clearInterval(sampling);stopDiagnostics();feature.destroy();stopHistory();stopSwitch();ws.destroy();engine.terminate?.();return document.querySelector('#ws').children.length;}};
  return snapshot();
}'''


def drag(page, multicell=False):
    start=(120,180) if multicell else (270,310)
    end=(600,180) if multicell else (1120,310)
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(*end,steps=16)
    page.mouse.up()


def wheel(page, horizontal=False):
    page.mouse.move(250,310)
    page.mouse.wheel(-1500 if horizontal else 0, 0 if horizontal else 10000)


def run():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    base=f'http://127.0.0.1:{port}'
    results=[]
    with (OUT/'server.log').open('w') as log:
        process=subprocess.Popen([str(ROOT/'node_modules/.bin/vite'),'--config','tests/vite-performance.config.ts',
            '--host','127.0.0.1','--port',str(port),'--strictPort'],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
        try:
            deadline=time.monotonic()+45
            while True:
                if process.poll() is not None:raise RuntimeError('Vite exited')
                try:
                    with urlopen(base,timeout=.5):break
                except OSError:
                    if time.monotonic()>deadline:raise TimeoutError('Vite readiness')
                    time.sleep(.1)
            with sync_playwright() as pw:
                browser=getattr(pw,BROWSER).launch()
                try:
                    for engine in ('PineEngine','PineWorkerEngine'):
                        for scenario,mode in [('pointer','none'),('wheel','none'),('horizontal-wheel','none'),
                            ('bounded-burst','hold'),('late-old-market','hold'),('queued-old-market','none'),
                            ('repair','repair'),('persistent-retry','persistent'),('genesis','genesis'),('destroy-held','hold'),
                            ('multicell','none'),('drawing','none'),('price-axis','none')]:
                            selected=os.environ.get('QUANT_GESTURE_CASE')
                            if selected and selected!=scenario:continue
                            page=browser.new_page(viewport={'width':1440,'height':1000})
                            errors=[];external=[]
                            page.on('pageerror',lambda e:errors.append(str(e)))
                            page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base) else (external.append(route.request.url),route.abort())[-1])
                            page.route('**/gesture-audit',lambda r:r.fulfill(content_type='text/html',body='<html><body style="margin:0"><div id="ws" style="height:800px"></div><div id="bt"></div></body></html>'))
                            page.goto(base+'/gesture-audit')
                            try:
                                before=page.evaluate(BOOT,{'engineName':engine,'mode':mode})
                                if scenario=='multicell':
                                    page.evaluate('gesture.ws.setLayout("4")')
                                    page.evaluate('gesture.ws.setActiveCell("c1")')
                                    page.evaluate('async()=>{await Promise.all(gesture.ws.cells().map(c=>c.chart.historyComplete()));}')
                                    page.wait_for_timeout(350)
                                    before=page.evaluate('gesture.snapshot()')
                                    page.evaluate('window.otherCellBefore=gesture.ws.cells().filter(c=>c!==gesture.ws.active).map(c=>({id:c.id,market:c.chart.market,count:c.chart.orchestrator.rawBars.length}))')
                                if scenario=='drawing':page.evaluate('gesture.chart().drawings.setTool("trendline")')
                                page.wait_for_timeout(350)
                                checks={'initialNoAutoload':page.evaluate('gesture.calls.length')==before['requests']}
                                if scenario=='price-axis':
                                    page.mouse.move(1420,310);page.mouse.wheel(0,10000)
                                elif scenario in ('wheel','horizontal-wheel'):wheel(page,scenario=='horizontal-wheel')
                                else:drag(page,scenario=='multicell')
                                if mode=='hold':page.wait_for_function('gesture.held')
                                if scenario=='bounded-burst':
                                    for _ in range(5):wheel(page)
                                    page.wait_for_timeout(350)
                                    checks['singleInflight']=page.evaluate('gesture.calls.length')==before['requests']+1
                                    checks['pendingNotReady']=page.evaluate('gesture.snapshot().report.status!=="ready"&&!gesture.snapshot().report.canSimulate')
                                    page.evaluate('gesture.release()')
                                if scenario in ('drawing','price-axis'):
                                    page.wait_for_timeout(600)
                                    after=page.evaluate('gesture.snapshot()')
                                    checks.update(nonNavigationNoLoad=after['requests']==before['requests'],defaultDepth=after['count']==2000)
                                elif scenario in ('late-old-market','queued-old-market'):
                                    page.evaluate("gesture.chart().setMarket({timeframe:'5'})")
                                    if mode=='hold':page.evaluate('gesture.release()')
                                    after=page.evaluate('gesture.settled(2000)')
                                    page.wait_for_timeout(600)
                                    after=page.evaluate('gesture.snapshot()')
                                    checks.update(defaultDepth=after['market']['bars']==2000,latestMarket=after['market']['timeframe']=='5',
                                        noOldCommit=after['count']==2000,fullDefaultView=after['range']['from']==after['first'],
                                        canceledQueued=scenario!='queued-old-market' or page.evaluate("gesture.calls.filter(c=>c.tf==='1'&&c.range.to!=null).length") == 0)
                                elif scenario=='destroy-held':
                                    page.evaluate('window.gestureHost=gesture.ws.active.host')
                                    checks['destroyed']=page.evaluate('gesture.destroy()')==0
                                    page.evaluate('gesture.release()');page.wait_for_timeout(700)
                                    after={'count':0}
                                    checks['noLateRemount']=page.locator('#ws > *').count()==0
                                else:
                                    if scenario=='persistent-retry':
                                        page.wait_for_function("gesture.snapshot().history.historyReason==='aborted'")
                                        failed=page.evaluate('gesture.snapshot()')
                                        checks.update(noSparseReady=failed['report']['status']!='ready' and not failed['report']['canSimulate'],
                                            confirmedPrefixRetained=failed['count']==2000 and failed['continuous'],failureVisible=failed['report']['history']['complete'] is False)
                                        page.evaluate('gesture.feature.workbench.openViewer()')
                                        page.get_by_role('button',name='Try again',exact=True).wait_for()
                                        page.evaluate('gesture.recover()')
                                        page.get_by_role('button',name='Try again',exact=True).click()
                                    after=page.evaluate('gesture.settled(2250)' if mode=='genesis' else 'gesture.settled()')
                                    checks.update(realOlderData=after['first']<before['first'],latestRetained=after['last']==before['last'],
                                        complete=after['history']['historyComplete'] is True,actualData=after['continuous'] and after['sourceMatches'],
                                        spacingPreserved=abs(after['spacing']-before['spacing'])<.01)
                                    if scenario=='multicell':
                                        checks['otherCellUnchanged']=page.evaluate('JSON.stringify(otherCellBefore)===JSON.stringify(gesture.ws.cells().filter(c=>c!==gesture.ws.active).map(c=>({id:c.id,market:c.chart.market,count:c.chart.orchestrator.rawBars.length})))')
                                    if mode=='genesis':
                                        previous=page.evaluate('gesture.calls.length');wheel(page);page.wait_for_timeout(600)
                                        checks['genesisStops']=page.evaluate('gesture.calls.length')==previous
                                    if scenario=='persistent-retry':
                                        page.evaluate('gesture.feature.workbench.closeViewer()')
                                        wheel(page)
                                        after=page.evaluate('gesture.settled(6000)')
                                        checks['onlineRetryStillPaginates']=after['count']==6000
                                        page.evaluate("gesture.chart().setMarket({timeframe:'5'})")
                                        after=page.evaluate('gesture.settled(2000)')
                                        checks['onlineRetryDefaultReset']=after['market']['bars']==2000
                                if scenario!='destroy-held':
                                    page.wait_for_timeout(250)
                                    current=page.evaluate('gesture.snapshot()')
                                    checks['noRecursivePagination']=current['count']==after['count']
                                details=page.evaluate('({calls:gesture.calls,events:gesture.events,samples:gesture.samples,inputs:gesture.inputs})')
                                older=details['calls'][before['requests']:]
                                checks['boundedPages']=all(c['range'].get('limit',0)<=(4000 if scenario=='persistent-retry' and c['range'].get('to') is None else 2202) for c in older)
                                checks['trustedGesture']=any(i['trusted'] for i in details['inputs'])
                                checks['noMappingFailure']=not any(e.get('message')=='backtest snapshot mapping failed' for e in details['events'])
                                checks['noPageErrors']=not errors;checks['noExternalRequests']=not external
                                if scenario in ('pointer','persistent-retry','multicell'):
                                    page.screenshot(path=str(OUT/f'{engine}-{scenario}.png'),full_page=True)
                                if scenario!='destroy-held':checks['cleanup']=page.evaluate('gesture.destroy()')==0
                                result={'engine':engine,'scenario':scenario,'before':before,'after':after,'checks':checks,
                                    'pageErrors':errors,'externalRequests':external,**details}
                                results.append(result)
                                print(engine,scenario,json.dumps(checks),flush=True)
                                assert all(checks.values()),json.dumps({'engine':engine,'scenario':scenario,'checks':checks,'after':after},indent=2)
                            except Exception as error:
                                if not results or results[-1].get('engine')!=engine or results[-1].get('scenario')!=scenario:
                                    diagnostic=page.evaluate('async()=>{const ctx=await gesture.chart().indicators().find(h=>!h.nativeType)?.context(["strategy","trades"]);return {state:gesture.snapshot(),events:gesture.events,calls:gesture.calls,raw:{strategy:ctx?.strategy,trades:ctx?.trades?.length}}}')
                                    results.append({'engine':engine,'scenario':scenario,'checks':{'completed':False},'error':str(error),'diagnostic':diagnostic})
                                print(engine,scenario,'FAILED',str(error).splitlines()[0],flush=True)
                            finally:page.close()
                finally:browser.close()
        finally:
            process.terminate();process.wait(timeout=10)
            (OUT/'results.json').write_text(json.dumps({'browser':BROWSER,'cases':results},indent=2))
    assert len(results)==(2 if os.environ.get('QUANT_GESTURE_CASE') else 26)
    assert all(all(c['checks'].values()) for c in results), 'Gesture history gate failed; see results.json'
    print(json.dumps({'passed':len(results),'evidence':str(OUT)}))


if __name__=='__main__':run()
