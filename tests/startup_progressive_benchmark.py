#!/usr/bin/env python3
"""Finite controlled ABBA, progressive-only comparison against plan §3 budgets.

One isolated production artifact is used on both sides. A test-build transform
adds only an enable flag and an App observer. An owned HTTP server supplies
deterministic venue replies with fixed latency/bandwidth. No Playwright routing
is registered (so the measured HTTP cache remains real). This is controlled
network evidence, never a claim about a real exchange.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import gzip
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import mimetypes
from pathlib import Path
import platform
import statistics
import subprocess
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlencode, urlparse

from playwright.async_api import async_playwright
from startup_loading import ROOT, NOW, KEY, OBSERVE, REPORT_OBSERVE, klines, cache_evidence

EXTRA_OBSERVE = r"""(() => {
  const a=window.__startup;
  a.network=[];a.workers=new Set();a.fullSnapshot=null;a.fullBars=null;
  const fetchOriginal=window.fetch;
  window.fetch=function(input,options){
    const u=new URL(typeof input==='string'?input:input.url,location.href);
    if(u.origin===location.origin)return fetchOriginal.call(this,input,options);
    const entry={url:u.href,start:performance.now()};a.network.push(entry);
    const target=new URL('/__provider',location.origin);
    target.searchParams.set('target',u.href);
    target.searchParams.set('sample',new URL(location.href).searchParams.get('sample')||'unknown');
    return fetchOriginal.call(this,target.href,options).then(response=>{
      entry.status=response.status;entry.headersAt=performance.now();return response;
    });
  };
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
    constructor(...args){super(...args);a.workers.add(this);
      this.addEventListener('message',e=>{const s=e.data?.snapshot;
        if(s?.strategy && s.reportSeries?.points?.length>=2000 && Array.isArray(s.trades))a.fullSnapshot=s;
      });
    }
    postMessage(m,...args){if(m?.bars?.length>=2000)a.fullBars=m.bars;return super.postMessage(m,...args);}
    terminate(){a.workers.delete(this);return super.terminate();}
  };
})();"""


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def percentile(values, fraction):
    values=sorted(values)
    at=(len(values)-1)*fraction
    low=math.floor(at);high=math.ceil(at)
    return values[low]+(values[high]-values[low])*(at-low)


def serve(dist, args, requests):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def do_POST(self):self.do_GET()
        def do_GET(self):
            parsed=urlparse(self.path)
            if parsed.path=='/__provider':
                query=parse_qs(parsed.query);target=query['target'][0];venue=urlparse(target)
                start=time.monotonic();row={'sample':query['sample'][0],'target':target,'start':start}
                requests.append(row)
                body=self.rfile.read(int(self.headers.get('Content-Length',0)))
                if venue.path.endswith('/klines'):
                    payload=klines(target);latency=args.latency_ms/1000
                    # Deliberately includes both trend and faster whipsaw
                    # regimes, so SMA exercises gains/losses and finite PF.
                    # The initial smooth-sine pilot had zero losers and a
                    # legitimate unavailable PF; that failure is retained.
                    interval=parse_qs(venue.query).get('interval',['15m'])[0]
                    step={'15m':900000,'1h':3600000}.get(interval,900000)
                    for bar in payload:
                        i=bar[0]//step
                        price=60000+400*math.sin(i/13)+300*math.sin(i/2.3)+150*math.cos(i/.7)+100*math.cos(i/71)
                        close=price+20*math.sin(i*.41)
                        bar[1:5]=[str(price),str(max(price,close)+30),str(min(price,close)-30),str(close)]
                    start_param=parse_qs(venue.query).get('startTime')
                    if start_param:payload=[bar for bar in payload if bar[0]>=int(start_param[0])]
                    row['bars']=len(payload);row['payloadSha256']=digest(payload)
                elif venue.path.endswith('/exchangeInfo'):
                    payload={'symbols':[{'symbol':'BTCUSDT','baseAsset':'BTC','quoteAsset':'USDT','status':'TRADING','contractType':'PERPETUAL','filters':[{'filterType':'PRICE_FILTER','tickSize':'0.10'}]}]}
                    latency=args.metadata_latency_ms/1000
                elif venue.hostname=='api.hyperliquid.xyz':
                    kind=json.loads(body or b'{}').get('type')
                    payload={'universe':[{'name':'BTC','szDecimals':5}]} if kind=='meta' else {'tokens':[],'universe':[]}
                    latency=args.metadata_latency_ms/1000
                else:
                    row['unexpected']=True;self.send_error(502,'Unexpected controlled endpoint');return
                raw=json.dumps(payload).encode();encoded=gzip.compress(raw,mtime=0)
                time.sleep(latency)
                self.send_response(200);self.send_header('Content-Type','application/json')
                self.send_header('Content-Encoding','gzip');self.send_header('Content-Length',str(len(encoded)))
                self.send_header('Cache-Control','no-store');self.end_headers()
                try:
                    for offset in range(0,len(encoded),8192):
                        chunk=encoded[offset:offset+8192]
                        time.sleep(len(chunk)/args.bytes_per_second)
                        self.wfile.write(chunk);self.wfile.flush()
                except (BrokenPipeError,ConnectionResetError):row['cancelled']=True
                row.update(end=time.monotonic(),encodedBytes=len(encoded),decodedBytes=len(raw))
                return
            file=dist/('index.html' if parsed.path=='/' else parsed.path.lstrip('/'))
            if not file.is_file() or not file.resolve().is_relative_to(dist.resolve()):
                self.send_error(404);return
            raw=file.read_bytes();encoded=gzip.compress(raw,mtime=0)
            self.send_response(200)
            self.send_header('Content-Type',mimetypes.guess_type(file)[0] or 'application/octet-stream')
            self.send_header('Content-Encoding','gzip');self.send_header('Content-Length',str(len(encoded)))
            self.send_header('Cache-Control','public, max-age=31536000, immutable' if parsed.path.startswith('/assets/') else 'no-cache, no-store, must-revalidate')
            self.end_headers()
            try:self.wfile.write(encoded)
            except (BrokenPipeError,ConnectionResetError):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    return server,thread


async def context_for(browser, variant):
    context=await browser.new_context(viewport={'width':1440,'height':900},service_workers='block')
    seed={'version':1,'layout':'1','timezone':'Etc/UTC','charts':[{'id':'c1','symbol':'binance:BTCUSDT','timeframe':'15','bars':2000,
        'indicators':{'manifest':['SMA Cross (strategy)'],'natives':[]}}]}
    # Resetting only the observation floor lets an in-page cached switch be
    # measured without accepting a delayed context from its preceding run.
    report_observe=REPORT_OBSERVE.replace('if(!r.engineReady && history',
        'if(!r.engineReady && history && history.at >= (a.measureAfter??0)')
    await context.add_init_script('\n'.join([
        f'window.__STARTUP_REAL_PROVIDER__=false;window.__STARTUP_EXPECTED_BARS__=2000;window.__STARTUP_DISABLE_PROGRESSIVE__={str(variant=="baseline").lower()};',
        OBSERVE,report_observe,EXTRA_OBSERVE,
        f'localStorage.setItem({json.dumps(KEY)},{json.dumps(json.dumps(seed))});',
    ]))
    return context


async def heap_usage(browser, context, page):
    """Post-GC main + dedicated-worker V8 heaps, never process RSS guesses."""
    page_session=await context.new_cdp_session(page)
    info=(await page_session.send('Target.getTargetInfo'))['targetInfo']
    await page_session.send('HeapProfiler.collectGarbage')
    main=await page_session.send('Runtime.getHeapUsage')
    await page_session.detach()
    root=await browser.new_browser_cdp_session();pending={};counter=0
    def receive(event):
        data=json.loads(event['message']);key=(event['sessionId'],data.get('id'))
        if key in pending and not pending[key].done():pending[key].set_result(data)
    root.on('Target.receivedMessageFromTarget',receive)
    async def call(session,method):
        nonlocal counter
        counter+=1;future=asyncio.get_running_loop().create_future();pending[(session,counter)]=future
        await root.send('Target.sendMessageToTarget',{'sessionId':session,'message':json.dumps({'id':counter,'method':method})})
        response=await asyncio.wait_for(future,10)
        if 'error' in response:raise RuntimeError(response['error'])
        return response.get('result',{})
    workers=[]
    try:
        targets=(await root.send('Target.getTargets'))['targetInfos']
        for target in targets:
            if target['type']!='worker' or target.get('browserContextId')!=info.get('browserContextId'):continue
            sid=(await root.send('Target.attachToTarget',{'targetId':target['targetId'],'flatten':False}))['sessionId']
            try:
                await call(sid,'HeapProfiler.collectGarbage')
                workers.append({'url':target['url'],**await call(sid,'Runtime.getHeapUsage')})
            finally:await root.send('Target.detachFromTarget',{'sessionId':sid})
    finally:await root.detach()
    return {'main':main,'workers':workers,'workerCount':len(workers),
            'totalUsedBytes':main['usedSize']+sum(w['usedSize'] for w in workers)}


async def run_sample(browser, variant, phase, ordinal, base, output, requests, shared=None):
    context=shared or await context_for(browser,variant);page=await context.new_page()
    label=f'{phase}-{ordinal:02}-{variant}';errors=[];failed=[];unexpected=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('requestfailed',lambda r:failed.append({'url':r.url,'failure':r.failure}))
    page.on('request',lambda r:unexpected.append(r.url) if urlparse(r.url).scheme in ('http','https') and not r.url.startswith(base+'/') else None)
    result={'label':label,'variant':variant,'phase':phase,'ordinal':ordinal,'startedAt':datetime.now(timezone.utc).isoformat()}
    try:
        await page.goto(base+'/?chart=maximized&sample='+label,wait_until='domcontentloaded')
        await page.wait_for_function('window.__startup.report.engineReady!==null',timeout=30000)
        await page.locator('#vela-action-quant-favorites').click();await page.keyboard.press('Escape')
        await page.locator('.quant-backtest-dock [aria-label="Open backtest viewer"]').click()
        await page.locator('.quant-backtest-performance').wait_for(state='visible')
        kpis=await page.locator('.quant-backtest-performance .quant-backtest-kpi').evaluate_all("nodes=>nodes.map(n=>({label:n.querySelector('.quant-backtest-kpi-label')?.textContent,value:n.querySelector('.quant-backtest-kpi-value')?.textContent}))")
        assert len(kpis)==5 and all(k['value'] and k['value']!='—' for k in kpis),kpis
        await page.locator('#quant-backtest-tab-simulation').click()
        await page.locator('.quant-backtest-simulation-chart-host').first.wait_for(state='visible')
        data=await page.evaluate("""() => {const a=window.__startup;return {candlePaint:a.candlePaint,history:a.report.historyComplete,
          engine:a.report.engineReady,events:a.events,messages:a.report.messages,longTasks:a.longTasks,
          fullBars:a.fullBars,fullSnapshot:a.fullSnapshot,workerCount:a.workers.size,
          resources:performance.getEntriesByType('resource').map(r=>({name:r.name,transfer:r.transferSize,encoded:r.encodedBodySize})),
          progressiveInstalled:typeof a.workspace.chart.data.providerInstance('binance').getBarsProgressive==='function'};}""")
        assert data['progressiveInstalled']==(variant=='optimized')
        assert data['history']['bars']['count']==2000 and data['engine']['series']['count']==2000
        result.update(data);result['kpis']=kpis
        result['cache']=cache_evidence(data['resources'],{},base)
        if phase=='warm':assert result['cache']['verified'],'warm static cache absent'
        if phase=='cold':assert not result['cache']['verified'],'cold context unexpectedly used cached static resources'
        # Exact field digest excludes only fresh run identity/provenance.
        snapshot=result.pop('fullSnapshot');bars=result.pop('fullBars')
        stable={'bars':bars,'strategy':{k:v for k,v in snapshot['strategy'].items() if k not in ('reportRunId','reportSnapshotRevision')},
                'trades':snapshot['trades'],'points':snapshot['reportSeries']['points'],'precision':snapshot.get('executionPrecision')}
        result['ledgerSha256']=digest(stable)
        result['startupKlineRequests']=len([r for r in requests if r['sample']==label and '/klines?' in r['target']])
        if ordinal==0:(output/f'{label}-full-input-result.json').write_text(json.dumps(stable,indent=2))
        if ordinal==0:await page.screenshot(path=str(output/f'{label}.png'))
        # Clear observation-only retained copies before measuring application
        # retained V8 heaps. Both sides keep the same observer itself.
        await page.evaluate('window.__startup.fullSnapshot=null;window.__startup.fullBars=null;window.__startup.report.messages.length=0;window.__startup.events.length=0')
        result['heap']=await heap_usage(browser,context,page)
        # Simulation releases its short-lived Worker after publishing; the
        # persistent Pine Worker must remain, and both observers must agree.
        assert result['heap']['workerCount']==data['workerCount'] and data['workerCount']>=1,result['heap']
        # Warm data, same page: populate 1h, then return to already cached 15m.
        # The cold/HTTP-warm timings above are already captured and immutable.
        await page.locator('.quant-backtest-viewer [aria-label="Return to chart"]').click()
        await page.evaluate("async()=>{const a=window.__startup;a.fullSnapshot=null;await a.workspace.chart.setMarket({timeframe:'60'});await a.workspace.chart.historyComplete();}")
        await page.wait_for_function(f'window.__startup.fullSnapshot?.reportSeries?.points?.[0]?.time==={NOW-1999*3600000}',timeout=30000)
        before_requests=len([r for r in requests if r['sample']==label and '/klines?' in r['target']])
        warm_start=await page.evaluate("()=>{const a=window.__startup;a.report.engineReady=null;a.report.historyComplete=null;a.measureAfter=performance.now();a.workspace.chart.setMarket({timeframe:'15'});return a.measureAfter;}")
        await page.wait_for_function('window.__startup.report.engineReady!==null',timeout=30000)
        warm_end=await page.evaluate('window.__startup.report.engineReady.at')
        after_requests=len([r for r in requests if r['sample']==label and '/klines?' in r['target']])
        result['inPageWarm']={'reportMs':warm_end-warm_start,'newKlineRequests':after_requests-before_requests}
        # Vela may refresh the forming tail even when the historical bars are
        # already cached. Record it; do not mislabel this as zero-network.
        assert result['inPageWarm']['newKlineRequests']<=1,result['inPageWarm']
        await page.evaluate('window.__startup.app.destroy()')
        await page.wait_for_function('window.__startup.workers.size===0')
        result['destroy']={'workers':await page.evaluate('window.__startup.workers.size'),'canvases':await page.locator('canvas').count()}
        assert result['destroy']=={'workers':0,'canvases':0},result['destroy']
        assert not errors and not unexpected,(errors,unexpected)
    except Exception as error:
        result['failure']=str(error)
        try:
            result['partial']=await page.evaluate('({report:window.__startup?.report,events:window.__startup?.events})')
            await page.screenshot(path=str(output/f'{label}-failed.png'))
        except Exception:pass
    finally:
        result.update(pageErrors=errors,requestFailures=failed,unexpectedExternal=unexpected,
                      network=[r for r in requests if r['sample']==label],finishedAt=datetime.now(timezone.utc).isoformat())
        (output/f'{label}.json').write_text(json.dumps(result,indent=2))
        await page.close()
        if shared is None:await context.close()
    return result


def evaluate(results):
    measured=[r for r in results if r['phase'] in ('cold','warm')]
    failures=[r['label'] for r in results if 'failure' in r]
    summary={'failures':failures,'allSamples':len(measured),'budgets':{},'groups':{}}
    fields={'firstPaint':lambda r:r['candlePaint'],'history':lambda r:r['history']['at'],
            'report':lambda r:r['engine']['at'],'memory':lambda r:r['heap']['totalUsedBytes'],
            'inPageWarm':lambda r:r['inPageWarm']['reportMs']}
    for phase in ('cold','warm'):
        summary['groups'][phase]={}
        for variant in ('baseline','optimized'):
            rows=[r for r in measured if r['phase']==phase and r['variant']==variant and 'failure' not in r]
            summary['groups'][phase][variant]={'n':len(rows),**{field:{'median':statistics.median(values),'p95':percentile(values,.95),
                'min':min(values),'max':max(values)} for field,get in fields.items() if (values:=[get(r) for r in rows])}}
    if failures:return {**summary,'pass':False,'reason':'No budget pass can hide failed/incomplete samples'}
    cold=summary['groups']['cold'];warm=summary['groups']['warm'];budgets=summary['budgets']
    def ratio(groups,field,stat):return groups['optimized'][field][stat]/groups['baseline'][field][stat]
    budgets['coldFirstPaintMedian20Percent']={'ratio':ratio(cold,'firstPaint','median'),'maxRatio':.8,'pass':ratio(cold,'firstPaint','median')<=.8}
    budgets['coldFirstPaintP95NoRegression']={'ratio':ratio(cold,'firstPaint','p95'),'maxRatio':1,'pass':ratio(cold,'firstPaint','p95')<=1}
    for phase,groups in [('cold',cold),('warm',warm)]:
        for field in ('history','report','memory','inPageWarm'):
            for stat in ('median','p95'):
                value=ratio(groups,field,stat);budgets[f'{phase}-{field}-{stat}']={'ratio':value,'maxRatio':1.1,'pass':value<=1.1}
    for stat in ('median','p95'):
        value=ratio(warm,'firstPaint',stat);budgets[f'warm-firstPaint-{stat}']={'ratio':value,'maxRatio':1.1,'pass':value<=1.1}
    stable={r['ledgerSha256'] for r in measured}
    budgets['identicalFullDataAndResults']={'digests':sorted(stable),'pass':len(stable)==1}
    # Startup count is recorded before the intentional warm-data market switch.
    counts=[r['startupKlineRequests'] for r in measured]
    budgets['nativeStartupRequestsAtMostThree']={'maxObserved':max(counts),'pass':max(counts)<=3}
    budgets['minimum20PerPhaseVariant']={'pass':all(summary['groups'][p][v]['n']>=20 for p in ('cold','warm') for v in ('baseline','optimized'))}
    return {**summary,'pass':all(b['pass'] for b in budgets.values())}


async def run(args,base,requests):
    results=[]
    async with async_playwright() as p:
        chrome=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        browser=await p.chromium.launch(**({'executable_path':str(chrome)} if chrome.exists() else {}))
        try:
            for phase in ('cold','warm'):
                shared={}
                try:
                    if phase=='warm':
                        for variant in ('baseline','optimized'):
                            shared[variant]=await context_for(browser,variant)
                            prime=await run_sample(browser,variant,'prime',0,base,args.output,requests,shared[variant]);results.append(prime)
                    for i in range(args.cycles):
                        for variant in ('baseline','optimized','optimized','baseline'):
                            ordinal=len([r for r in results if r['phase']==phase and r['variant']==variant])
                            result=await run_sample(browser,variant,phase,ordinal,base,args.output,requests,shared.get(variant))
                            results.append(result)
                            print(json.dumps({'label':result['label'],'paint':result.get('candlePaint'),'failure':result.get('failure')}),flush=True)
                            if 'failure' in result and args.cycles==1:return results
                finally:
                    for context in shared.values():await context.close()
        finally:await browser.close()
    return results


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cycles',type=int,default=10,help='10 ABBA cycles = 20 per variant per cold/warm phase')
    parser.add_argument('--latency-ms',type=float,default=300)
    parser.add_argument('--metadata-latency-ms',type=float,default=200)
    parser.add_argument('--bytes-per-second',type=int,default=200000)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='quant-progressive-budget-') as temp:
        dist=Path(temp)/'dist'
        with (args.output/'build.log').open('w') as log:
            subprocess.run(['node','tests/startup_progressive_build.mjs',str(dist)],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True)
        provenance={'startedAt':datetime.now(timezone.utc).isoformat(),'platform':platform.platform(),'args':{**vars(args),'output':str(args.output)},
            'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
            'controlled':True,'requestRouting':False,'artifact':{str(f.relative_to(dist)):hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(dist.rglob('*')) if f.is_file()},
            'buildTransform':json.loads((dist/'benchmark-build.json').read_text()),
            'probeSources':{str(f.relative_to(ROOT)):hashlib.sha256(f.read_bytes()).hexdigest() for f in [Path(__file__).resolve(),ROOT/'tests/startup_progressive_build.mjs',ROOT/'tests/startup_loading.py']}}
        requests=[];server,thread=serve(dist,args,requests)
        try:results=asyncio.run(run(args,f'http://127.0.0.1:{server.server_port}',requests))
        finally:server.shutdown();server.server_close();thread.join()
        summary=evaluate(results)
        document={'provenance':provenance,'summary':summary,'resultFiles':[r['label']+'.json' for r in results]}
        (args.output/'summary.json').write_text(json.dumps(document,indent=2))
        print(json.dumps(summary,indent=2));return 0 if summary['pass'] else 1


if __name__=='__main__':raise SystemExit(main())
