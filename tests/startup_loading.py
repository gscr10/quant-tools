#!/usr/bin/env python3
"""Real-App cold-start probe (isolated server/profile; controlled HTTP, real UI).

Examples: python3 tests/startup_loading.py --label routed --symbol binance:BTCUSDT
          python3 tests/startup_loading.py --label bare --symbol BTCUSDT --index-delay 2
          python3 tests/startup_loading.py --preview --label production --samples 20

Artifacts stay in ignored audit-evidence/startup-loading/. No existing server is
stopped. Dev observes the actual App through a response-only main.ts tap; preview
never rewrites its bundle and reports visual/network evidence without inventing
engine-level history/readiness claims. Delays use asynchronous route handlers.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import os
from pathlib import Path
import socket
import subprocess
import time
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
NOW = 1790899200000
KEY = 'quant-tools:workspace:v2'

OBSERVE = r"""(() => {
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
  const D=Date; window.Date=class extends D{constructor(...x){super(...(x.length?x:[1790899200000]));}static now(){return 1790899200000;}};
  class Socket extends EventTarget {constructor(url){super();this.url=url;this.readyState=0;setTimeout(()=>{this.readyState=1;this.onopen?.({});this.dispatchEvent(new Event('open'));},0);}send(){}close(){this.readyState=3;this.onclose?.({});}}
  Object.assign(Socket,{CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3});window.WebSocket=Socket;
  a.attach=app=>{const w=app.workspace.workspace;if(!w)return;a.app=app;a.workspace=w;
    const chart=w.chart; for(const event of ['ready','load:end','history:progress','history:complete','script:run','market:changed'])chart.on(event,p=>add(event,p));
    chart.ready().then(()=>add('ready-promise',null));
    chart.historyComplete().then(()=>add('history-promise',null));
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


async def sample(browser, args, url, number):
    context=await browser.new_context(viewport={'width':1440,'height':900},service_workers='block')
    await context.add_init_script(OBSERVE)
    seed={'version':1,'layout':'1','timezone':'Etc/UTC','charts':[{'id':'c1','symbol':args.symbol,'timeframe':'15','bars':args.bars,'live':True}]}
    if args.symbol:
        await context.add_init_script(f'localStorage.setItem({json.dumps(KEY)},{json.dumps(json.dumps(seed))});')
    if args.storage_fault=='getter':
        await context.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new DOMException('test restriction','SecurityError')}})")
    elif args.storage_fault=='methods':
        await context.add_init_script("for(const name of ['getItem','setItem','removeItem'])Storage.prototype[name]=()=>{throw new DOMException('test restriction','SecurityError')}")
    elif args.storage_fault=='quota':
        await context.add_init_script("Storage.prototype.setItem=function(){throw new DOMException('quota exceeded','QuotaExceededError')}")
    network=[]; errors=[]; resources=[]; started=time.perf_counter()
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
    await context.route('**/*',route_handler)
    page=await context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
    try:
        await page.goto(url+'/?chart=maximized',wait_until='domcontentloaded',timeout=60000)
        await page.wait_for_selector('#vela-action-quant-favorites',timeout=30000)
        await page.locator('#vela-action-quant-favorites').click()
        interactive=await page.evaluate('performance.now()')
        await page.keyboard.press('Escape')
        await page.wait_for_function('window.__startup.candlePaint!==null',timeout=45000)
        if not args.preview:
            await page.wait_for_function("window.__startup.events.some(e=>e.kind==='history-promise')",timeout=45000)
        await page.wait_for_timeout(300)
        data=await page.evaluate("""() => ({events:window.__startup.events,candlePaint:window.__startup.candlePaint,
          errors:window.__startup.errors,longTasks:window.__startup.longTasks,
          state:window.__startup.app?.workspace.getState(),
          resources:performance.getEntriesByType('resource').map(r=>({name:r.name,start:r.startTime,duration:r.duration,transfer:r.transferSize,encoded:r.encodedBodySize,decoded:r.decodedBodySize})),
          canvasCount:document.querySelectorAll('canvas').length})""")
        data.update(interactive=interactive,network=network,pageErrors=errors,sample=number)
        await page.screenshot(path=str(args.output/f'{args.label}-{number}.png'))
        assert not errors, errors
        assert data['canvasCount']>0
        if not args.preview:
            assert data.get('state'), 'Dev App observation missing'
        return data
    finally: await context.close()


async def run(args,url):
    async with async_playwright() as p:
        launcher=getattr(p,args.browser); launch={}
        chrome=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        if args.browser=='chromium' and chrome.exists():launch['executable_path']=str(chrome)
        browser=await launcher.launch(**launch)
        results=[]
        try:
            for i in range(args.samples):
                try: results.append(await sample(browser,args,url,i))
                except Exception as error:results.append({'sample':i,'failure':str(error)})
                (args.output/f'{args.label}.json').write_text(json.dumps({'args':{**vars(args),'output':str(args.output)},'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'results':results},indent=2))
                print(json.dumps({'sample':i,'firstPaint':results[-1].get('candlePaint'),'failure':results[-1].get('failure')}),flush=True)
        finally:await browser.close()
        return any('failure' in item for item in results)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--label',default='startup');parser.add_argument('--samples',type=int,default=1)
    parser.add_argument('--symbol',default='');parser.add_argument('--bars',type=int,default=2000)
    parser.add_argument('--index-delay',type=float,default=0.2);parser.add_argument('--bar-delay',type=float,default=0.3)
    parser.add_argument('--browser',choices=['chromium','firefox','webkit'],default='chromium')
    parser.add_argument('--storage-fault',choices=['none','getter','methods','quota'],default='none')
    parser.add_argument('--preview',action='store_true');parser.add_argument('--url')
    parser.add_argument('--output',type=Path,default=ROOT/'audit-evidence/startup-loading')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    server=None;log=None
    try:
        url=args.url
        if not url:
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            url=f'http://127.0.0.1:{port}'
            log=(args.output/f'{args.label}-server.log').open('w')
            command=[str(ROOT/'node_modules/.bin/vite')]+(['preview'] if args.preview else [])+['--host','127.0.0.1','--port',str(port),'--strictPort']
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


if __name__=='__main__':main()
