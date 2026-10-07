#!/usr/bin/env python3
"""Real-App startup probe with separate controlled and real-network modes.

Examples: python3 tests/startup_loading.py --label routed --symbol binance:BTCUSDT
          python3 tests/startup_loading.py --label bare --symbol BTCUSDT --index-delay 2
          python3 tests/startup_loading.py --preview --label production --samples 20
          python3 tests/startup_loading.py --real-provider --preview --hot --samples 3
          python3 tests/startup_loading.py --real-provider --preview --complete-report --symbol binance:BTCUSDT

Artifacts stay in ignored audit-evidence/startup-loading/. No existing server is
stopped. Only controlled dev runs tap main.ts to observe App history. Real runs
never install Playwright routes: routing disables HTTP cache even when requests
are continued. --complete-report additionally restores the built-in SMA strategy
and passively observes real Worker history/ledger messages and the production
Viewer. Other real/preview runs remain visual/network only. Hot mode primes one
context, then measures new pages with verified cached production JS/CSS resources.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import math
import os
import platform
from pathlib import Path
import socket
import subprocess
import shutil
import tempfile
import time
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
NOW = 1790899200000
KEY = 'quant-tools:workspace:v2'

OBSERVE = r"""(() => {
  if (window.__startup) return;
  const a = window.__startup = {events:[], candlePaint:null, errors:[], longTasks:[]};
  const add=(kind,value)=>a.events.push({kind,at:performance.now(),value});
  window.addEventListener('error', e=>a.errors.push(e.message));
  try {new PerformanceObserver(l=>a.longTasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});}catch{}
  const fill=CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect=function(...args){
    if(a.candlePaint===null && ['#089981','#f23645'].includes(String(this.fillStyle).toLowerCase()) && args[2]>0 && args[3]>0){
      a.candlePaint=performance.now(); add('candle-paint',{color:this.fillStyle,rect:args});
    }
    return fill.apply(this,args);
  };
  // Synthetic startup cells freeze time and stub the live socket so that the
  // measured first paint depends only on the controlled HTTP delays.  Real
  // provider runs opt out of both shims and therefore measure the actual
  // browser clock and exchange transport.
  if (!window.__STARTUP_REAL_PROVIDER__) {
    const D=Date; window.Date=class extends D{constructor(...x){super(...(x.length?x:[1790899200000]));}static now(){return 1790899200000;}};
    class Socket extends EventTarget {constructor(url){super();this.url=url;this.readyState=0;setTimeout(()=>{this.readyState=1;this.onopen?.({});this.dispatchEvent(new Event('open'));},0);}send(){}close(){this.readyState=3;this.onclose?.({});}}
    Object.assign(Socket,{CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3});window.WebSocket=Socket;
  }
  a.attach=app=>{const w=app.workspace.workspace;if(!w)return;a.app=app;a.workspace=w;
    const chart=w.chart; for(const event of ['ready','load:end','history:progress','history:complete','script:run','market:changed'])chart.on(event,p=>add(event,p));
    chart.ready().then(()=>add('ready-promise',null));
    chart.historyComplete().then(()=>add('history-promise',null));
  };
})();"""

# Observe the real worker transport without changing its messages or its
# execution. A restored manifest strategy starts during navigation, so the
# complete-history milestone is not delayed by a later test click.
REPORT_OBSERVE = r"""(() => {
  const a=window.__startup;
  const r=a.report={messages:[],historyComplete:null,engineReady:null};
  const sessions=new Map(), reads=new Map(), observed=new WeakSet();
  const expected=window.__STARTUP_EXPECTED_BARS__;
  const original=Worker.prototype.postMessage;
  const barsInfo=bars=>({count:bars.length,first:bars[0]?.time??null,last:bars.at(-1)?.time??null,
    gaps:bars.slice(1).filter((b,i)=>b.time-bars[i].time!==900000).length});
  Worker.prototype.postMessage=function(...args){
    const m=args[0];
    if(m && typeof m==='object' && typeof m.kind==='string'){
      if(!observed.has(this)){
        observed.add(this);
        this.addEventListener('message',e=>{
          const x=e.data;
          if(x?.kind!=='contextResult')return;
          const read=reads.get(x.reqId), s=x.snapshot, series=s?.reportSeries, state=s?.strategy;
          const record={direction:'in',kind:x.kind,at:performance.now(),sessionId:read?.sessionId,
            requested:read?.select??null,phase:s?.phase??null,barIndex:s?.barIndex??null,
            strategy:state??null,trades:s?.trades?.length??null,
            closedTrades:s?.trades?.filter(t=>!t.open).length??null,
            openTrades:s?.trades?.filter(t=>t.open).length??null,
            series:series?{runId:series.runId,revision:series.snapshotRevision,count:series.points?.length,
              first:series.points?.[0]?.time,last:series.points?.at(-1)?.time}:null};
          r.messages.push(record);
          const history=sessions.get(read?.sessionId)?.historyComplete;
          const identity=series && state && series.runId===state.reportRunId
            && series.snapshotRevision===state.reportSnapshotRevision;
          const ledger=s?.trades && record.closedTrades===state?.wins+state?.losses+state?.even;
          if(!r.engineReady && history && record.at>=history.at && identity && ledger
              && series.points.length>=expected && s.barIndex>=expected-1
              && series.points[0]?.time===history.bars.first
              && series.points.at(-1)?.time>=history.bars.last){
            r.engineReady={...record,history,identityConsistent:true,ledgerPresent:true};
          }
        });
      }
      const record={direction:'out',kind:m.kind,at:performance.now(),sessionId:m.sessionId,
        historyState:m.historyState??null,restart:m.restart??false,
        ...(Array.isArray(m.bars)?{bars:barsInfo(m.bars)}:{})};
      r.messages.push(record);
      if(m.kind==='execute')sessions.set(m.sessionId,{market:m.market});
      if(m.kind==='getContext')reads.set(m.reqId,{sessionId:m.sessionId,select:m.select});
      if((m.kind==='execute' && m.historyState==='complete') || (m.kind==='bars' && m.restart===true)){
        if(record.bars?.count>=expected && record.bars.gaps===0){
          const session=sessions.get(m.sessionId);
          if(session)session.historyComplete={...record,market:session.market};
          r.historyComplete??={...record,market:session?.market};
        }
      }
    }
    return Reflect.apply(original,this,args);
  };
})();"""


def klines(url: str) -> list:
    q = parse_qs(urlparse(url).query)
    step = {'1m':60000,'15m':900000,'1h':3600000,'1d':86400000}.get(q.get('interval',['15m'])[0],900000)
    count = min(int(q.get('limit',['500'])[0]),1000)
    last = int(q.get('endTime',[str(NOW)])[0]) // step * step
    first = last-(count-1)*step
    result=[]
    for stamp in range(first,last+step,step):
        i=stamp//step; price=60000+400*math.sin(i/13)+100*math.cos(i/71)
        result.append([stamp,str(price),str(price+30),str(price-30),str(price+5),'100',stamp+step-1])
    return result


async def create_context(browser, args):
    context = await browser.new_context(viewport={'width':1440,'height':900},service_workers='block')
    scripts = [f'window.__STARTUP_REAL_PROVIDER__={json.dumps(args.real_provider)};', OBSERVE]
    seed={'version':1,'layout':'1','timezone':'Etc/UTC','charts':[{'id':'c1','symbol':args.symbol,'timeframe':'15','bars':args.bars,'live':True}]}
    if getattr(args,'complete_report',False):
        seed['charts'][0]['indicators']={'manifest':['SMA Cross (strategy)'],'natives':[]}
        scripts.extend([f'window.__STARTUP_EXPECTED_BARS__={args.bars};',REPORT_OBSERVE])
    if args.symbol:
        scripts.append(f'localStorage.setItem({json.dumps(KEY)},{json.dumps(json.dumps(seed))});')
    if args.storage_fault=='getter':
        scripts.append("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('test restriction','SecurityError')}})")
    elif args.storage_fault=='methods':
        scripts.append("for(const name of ['getItem','setItem','removeItem'])Storage.prototype[name]=()=>{throw new DOMException('test restriction','SecurityError')}")
    elif args.storage_fault=='quota':
        scripts.append("Storage.prototype.setItem=function(){throw new DOMException('quota exceeded','QuotaExceededError')}")
    # One ordered script per context, not one more Canvas/Date wrapper on every
    # hot page. The real-provider flag must precede the observer in this script.
    await context.add_init_script('\n'.join(scripts))
    return context


def cache_evidence(resources, cdp_requests, base_url):
    origin = urlparse(base_url).netloc
    local = [r for r in resources if urlparse(r['name']).netloc == origin
             and urlparse(r['name']).path.startswith('/assets/')
             and urlparse(r['name']).path.endswith(('.js', '.css'))]
    timing_hits = [r['name'] for r in local if r['transfer'] == 0 and r['encoded'] > 0]
    cdp_hits = [r['url'] for r in cdp_requests.values()
                if urlparse(r.get('url', '')).netloc == origin
                and urlparse(r.get('url', '')).path.startswith('/assets/')
                and urlparse(r.get('url', '')).path.endswith(('.js', '.css'))
                and (r.get('servedFromCache') or r.get('fromDiskCache'))]
    return {'localStaticResources': local, 'resourceTimingHits': timing_hits,
            'cdpHits': cdp_hits, 'verified': bool(timing_hits or cdp_hits)}


async def sample(browser, args, url, number, shared_context=None):
    owns_context = shared_context is None
    context = shared_context or await create_context(browser, args)
    network=[]; errors=[]; request_failures=[]; requests={}; cdp_requests={}
    started=time.perf_counter()
    async def route_handler(route):
        request=route.request; parsed=urlparse(request.url)
        if parsed.hostname in ('127.0.0.1','localhost'):
            if parsed.path=='/src/main.ts' and not args.preview:
                response=await route.fetch(); text=await response.text()
                await route.fulfill(response=response,body=text+'\nwindow.__startup.attach(app);\n')
            else: await route.continue_()
            return
        entry={'url':request.url,'startMs':(time.perf_counter()-started)*1000};network.append(entry)
        if 'binance' in (parsed.hostname or ''):
            if parsed.path.endswith('/exchangeInfo'):
                await asyncio.sleep(args.index_delay)
                payload={'symbols':[{'symbol':'BTCUSDT','baseAsset':'BTC','quoteAsset':'USDT','status':'TRADING','contractType':'PERPETUAL','filters':[{'filterType':'PRICE_FILTER','tickSize':'0.10'}]}]}
            elif parsed.path.endswith('/klines'):
                await asyncio.sleep(args.bar_delay);payload=klines(request.url)
                entry['bars']=len(payload);entry['sha256']=hashlib.sha256(json.dumps(payload).encode()).hexdigest()
            else: payload={}
        elif parsed.hostname=='api.hyperliquid.xyz':
            await asyncio.sleep(args.index_delay)
            kind=(request.post_data_json or {}).get('type')
            payload={'universe':[{'name':'BTC','szDecimals':5}]} if kind=='meta' else {'tokens':[],'universe':[]}
        else:
            entry['blocked']=True;await route.abort();return
        body=json.dumps(payload);entry.update(endMs=(time.perf_counter()-started)*1000,bytes=len(body))
        await route.fulfill(status=200,content_type='application/json',body=body)
    if not args.real_provider:
        await context.route('**/*',route_handler)
    page=await context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('requestfailed', lambda request: request_failures.append({
        'url': request.url, 'failure': request.failure}))
    def on_request(request):
        if urlparse(request.url).netloc != urlparse(url).netloc:
            entry={'url':request.url, 'startMs':(time.perf_counter()-started)*1000}
            requests[request]=entry
            network.append(entry)
    def on_response(response):
        if entry := requests.get(response.request):
            entry.update(status=response.status,
                         headersReceivedMs=(time.perf_counter()-started)*1000)
    def on_finished(request):
        if entry := requests.get(request):
            entry['endMs']=(time.perf_counter()-started)*1000
    cdp = None
    if args.real_provider:
        page.on('request', on_request)
        page.on('response', on_response)
        page.on('requestfinished', on_finished)
        if args.browser == 'chromium':
            cdp = await context.new_cdp_session(page)
            def cdp_request(event):
                cdp_requests.setdefault(event['requestId'], {})['url']=event['request']['url']
            def cdp_cached(event):
                cdp_requests.setdefault(event['requestId'], {})['servedFromCache']=True
            def cdp_response(event):
                entry=cdp_requests.setdefault(event['requestId'], {})
                response=event['response']
                entry.update(url=response['url'], status=response['status'],
                             fromDiskCache=response.get('fromDiskCache', False),
                             fromServiceWorker=response.get('fromServiceWorker', False))
            cdp.on('Network.requestWillBeSent', cdp_request)
            cdp.on('Network.requestServedFromCache', cdp_cached)
            cdp.on('Network.responseReceived', cdp_response)
            await cdp.send('Network.enable')
    try:
        started=time.perf_counter()
        await page.goto(url+'/?chart=maximized',wait_until='domcontentloaded',timeout=60000)
        await page.wait_for_selector('#vela-action-quant-favorites',timeout=30000)
        await page.locator('#vela-action-quant-favorites').click()
        interactive=await page.evaluate('performance.now()')
        await page.keyboard.press('Escape')
        await page.wait_for_function('window.__startup.candlePaint!==null',timeout=45000)
        if not args.preview and not args.real_provider:
            await page.wait_for_function("window.__startup.events.some(e=>e.kind==='history-promise')",timeout=45000)
        report_result=None
        if getattr(args,'complete_report',False):
            # This is the normal restored-strategy production UI. No module
            # import, synthetic report, route, cache-disable, or engine call.
            await page.wait_for_function('window.__startup.report.engineReady!==null',timeout=90000)
            engine_observed=await page.evaluate('performance.now()')
            await page.locator('.quant-backtest-dock [aria-label="Open backtest viewer"]').click()
            await page.locator('.quant-backtest-performance').wait_for(state='visible',timeout=30000)
            performance_ready=await page.evaluate('performance.now()')
            performance_text=await page.locator('.quant-backtest-performance').inner_text()
            kpis=await page.locator('.quant-backtest-performance .quant-backtest-kpi').evaluate_all("nodes=>nodes.map(n=>({label:n.querySelector('.quant-backtest-kpi-label')?.textContent,value:n.querySelector('.quant-backtest-kpi-value')?.textContent}))")
            assert len(kpis)>=5 and all(k['value'] and k['value']!='—' for k in kpis),kpis
            await page.locator('#quant-backtest-tab-simulation').click()
            await page.locator('.quant-backtest-simulation-chart-host').first.wait_for(state='visible',timeout=30000)
            simulation_ready=await page.evaluate('performance.now()')
            report_result=await page.evaluate('window.__startup.report')
            report_result.update(engineObservedMs=engine_observed,performanceVisibleMs=performance_ready,
                simulationVisibleMs=simulation_ready,performanceText=performance_text,
                kpis=kpis,
                milestonesNote='historyComplete is the complete-history notification delivered to the real Worker; engineReady is a matching full ledger/series reply; UI milestones include the test click and lazy tab rendering')
        await page.wait_for_timeout(300)
        data=await page.evaluate("""() => ({events:window.__startup.events,candlePaint:window.__startup.candlePaint,
          errors:window.__startup.errors,longTasks:window.__startup.longTasks,
          state:window.__startup.app?.workspace.getState(),
          resources:performance.getEntriesByType('resource').map(r=>({name:r.name,start:r.startTime,duration:r.duration,transfer:r.transferSize,encoded:r.encodedBodySize,decoded:r.decodedBodySize})),
          userAgent:navigator.userAgent,
          canvasCount:document.querySelectorAll('canvas').length})""")
        data.update(interactive=interactive,network=network,pageErrors=errors,
                    requestFailures=request_failures,sample=number,
                    realProvider=args.real_provider,hot=args.hot,
                    cachePhase=('prime' if number == 0 else 'warm') if args.hot else 'cold',
                    requestRouting=not args.real_provider,
                    cacheEvidence=cache_evidence(data['resources'], cdp_requests, url),
                    cdpRequests=list(cdp_requests.values()),
                    observationScope='visual/network' if args.preview or args.real_provider else 'app-history')
        if report_result:
            data['report']=report_result
            data['observationScope']='real-worker-history-ledger-and-production-viewer'
        await page.screenshot(path=str(args.output/f'{args.label}-{number}.png'))
        assert not errors, errors
        assert data['canvasCount']>0
        if not args.preview and not args.real_provider:
            assert data.get('state'), 'Dev App observation missing'
        if args.hot and number > 0 and not data['cacheEvidence']['verified']:
            data['failure']='Warm page did not prove any cached local production JS/CSS resource'
        return data
    except Exception as error:
        # Retain partial milestones and real network failures: a timeout is
        # evidence too, not a reason to silently discard the sample.
        partial=await page.evaluate('window.__startup ? ({candlePaint:window.__startup.candlePaint,report:window.__startup.report,errors:window.__startup.errors}) : ({})')
        return {**partial,'sample':number,'failure':str(error),'network':network,
                'pageErrors':errors,'requestFailures':request_failures}
    finally:
        # Hot samples intentionally share one browser context so its HTTP
        # cache is retained while each sample still opens a fresh page and
        # reapplies the persisted workspace seed.  Cold samples own a fresh
        # context and therefore keep the original isolated-cache contract.
        if owns_context:
            await context.close()
        else:
            await page.close()


async def run(args,url):
    provenance = {
        'startedAt': datetime.now(timezone.utc).isoformat(),
        'platform': platform.platform(),
        'explicitBrowserProxy': bool(args.real_provider and os.environ.get('QUANT_PROVIDER_PROXY')),
        'probeSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'productionAssets': {
            str(path.relative_to(Path(args.preview_dist))): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(Path(args.preview_dist).rglob('*')) if path.is_file()
        } if args.preview else None,
        'sampleContract': 'index 0 primes one context; later samples are fresh warm pages'
            if args.hot else 'each sample opens a fresh context; one server/browser process is reused',
    }
    async with async_playwright() as p:
        launcher=getattr(p,args.browser); launch={}
        chrome=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        if args.browser=='chromium' and chrome.exists():launch['executable_path']=str(chrome)
        if args.real_provider and (proxy := os.environ.get('QUANT_PROVIDER_PROXY')):
            launch['proxy']={'server':proxy,'bypass':'127.0.0.1,localhost'}
        browser=await launcher.launch(**launch)
        results=[]
        shared_context = None
        if args.hot:
            shared_context = await create_context(browser, args)
        try:
            for i in range(args.samples):
                try: results.append(await sample(browser,args,url,i,shared_context))
                except Exception as error:results.append({'sample':i,'failure':str(error)})
                (args.output/f'{args.label}.json').write_text(json.dumps({'args':{**vars(args),'output':str(args.output)},'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'provenance':provenance,'results':results},indent=2))
                print(json.dumps({'sample':i,'firstPaint':results[-1].get('candlePaint'),'failure':results[-1].get('failure')}),flush=True)
        finally:
            if shared_context is not None:
                await shared_context.close()
            await browser.close()
        return any('failure' in item for item in results)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--label',default='startup');parser.add_argument('--samples',type=int,default=1)
    parser.add_argument('--symbol',default='');parser.add_argument('--bars',type=int,default=2000)
    parser.add_argument('--index-delay',type=float,default=0.2);parser.add_argument('--bar-delay',type=float,default=0.3)
    parser.add_argument('--browser',choices=['chromium','firefox','webkit'],default='chromium')
    parser.add_argument('--storage-fault',choices=['none','getter','methods','quota'],default='none')
    parser.add_argument('--real-provider',action='store_true',
                        help='use real exchange HTTP/WebSocket traffic; QUANT_PROVIDER_PROXY is optional')
    parser.add_argument('--hot',action='store_true',
                        help='prime once, then verify cached production JS/CSS on fresh pages; requires --real-provider --preview and >=2 samples')
    parser.add_argument('--preview',action='store_true');parser.add_argument('--url')
    parser.add_argument('--complete-report',action='store_true',
                        help='restore built-in SMA strategy and measure full 2000-bar history, real Worker ledger/curve and production Viewer readiness; requires --real-provider --preview --symbol')
    parser.add_argument('--output',type=Path,default=ROOT/'audit-evidence/startup-loading')
    args=parser.parse_args()
    if args.samples < 1:
        parser.error('--samples must be positive')
    if args.hot and (not args.real_provider or not args.preview or args.samples < 2):
        parser.error('--hot requires --real-provider --preview and at least 2 samples (one prime + warm pages)')
    if args.complete_report and (not args.real_provider or not args.preview or not args.symbol or args.bars!=2000):
        parser.error('--complete-report requires --real-provider --preview --symbol and --bars=2000')
    args.output.mkdir(parents=True,exist_ok=True)
    server=None;log=None;snapshot=None
    args.preview_dist=str(ROOT/'dist')
    try:
        url=args.url
        if not url:
            if args.preview:
                # Own a stable copy while another agent may be building dist.
                snapshot=tempfile.TemporaryDirectory(prefix='quant-startup-preview-')
                args.preview_dist=str(Path(snapshot.name)/'dist')
                shutil.copytree(ROOT/'dist',args.preview_dist)
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            url=f'http://127.0.0.1:{port}'
            log=(args.output/f'{args.label}-server.log').open('w')
            command=[str(ROOT/'node_modules/.bin/vite')]+(['preview'] if args.preview else [])+['--host','127.0.0.1','--port',str(port),'--strictPort']
            if args.preview:command+=['--outDir',args.preview_dist]
            server=subprocess.Popen(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
            deadline=time.monotonic()+45
            while time.monotonic()<deadline:
                if server.poll() is not None:raise RuntimeError('Owned Vite server exited')
                try:
                    with urlopen(url,timeout=1) as response:
                        if response.status==200:break
                except OSError:time.sleep(.1)
            else:raise RuntimeError('Owned Vite server not ready')
        raise SystemExit(asyncio.run(run(args,url.rstrip('/'))))
    finally:
        if server:
            server.terminate()
            try:server.wait(timeout=10)
            except subprocess.TimeoutExpired:server.kill();server.wait()
        if log:log.close()
        if snapshot:snapshot.cleanup()


if __name__=='__main__':main()
