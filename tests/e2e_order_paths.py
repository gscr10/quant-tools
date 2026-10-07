#!/usr/bin/env python3
"""Actual browser engine transport for price order and forming risk rollback."""
import argparse
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
RUN = r'''async engineName => {
 const engines=await import('/packages/vela-pinets/dist/index.js');
 const engine=new engines[engineName](),hour=3600000,start=Date.UTC(2024,0,1);
 const bar=(i,o,h=o,l=o,c=o)=>({time:start+i*hour,open:o,high:h,low:l,close:c,volume:6});
 const assert=(v,m)=>{if(!v)throw Error(m)};
 const near=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} != ${b}`);
 const cases=[];
 async function execute(source,bars,magnified,live=false){
   let done=Promise.withResolvers();
   const prepared=await engine.prepare(source);
   const children=bars.flatMap(b=>[{...b,volume:1},...Array.from({length:5},(_,i)=>({time:b.time+(i+1)*600000,
     open:b.close,high:b.close,low:b.close,close:b.close,volume:1}))]);
   const request={prepared,bars,market:{symbol:'BTCUSDT',timeframe:'60',chartStyle:'candles',
     symbolInfo:{ticker:'BTCUSDT',currency:'USD',mintick:.01,pointvalue:1,timezone:'UTC'}},
     mode:live?'live':'static',historyState:'complete',inputs:{},props:{},getBars:()=>bars,
     barMagnifier:{requested:magnified,lowerTimeframe:'10',asOf:start+bars.length*hour},
     fetchSeries:async()=>children};
   // Static execution has onDone; a live stream publishes through onModel
   // and deliberately never completes while its subscription is alive.
   const session=engine.execute(request,{onModel(){if(live)done.resolve()},onDone:()=>done.resolve(),onError:e=>done.reject(e)});
   const wait=async()=>{let timer;try{await Promise.race([done.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('engine timeout')),15000)})]);}
     finally{clearTimeout(timer)}};
   await wait();
   const raw=()=>session.getContext(['strategy','trades','reportSeries','auditLedger']);
   return {raw,source,bars,children,session,update:async()=>{done=Promise.withResolvers();session.notifyBars();await wait();}};
 }
 try{
  for(const magnified of [false,true])for(const scenario of ['near','exit-before','exit-after']){
   const pathIndex=scenario==='near'?1:2;
   const bars=Array.from({length:pathIndex+1},(_,i)=>i===pathIndex?bar(i,100,115,99,112):bar(i,100));
   const body=scenario==='near'?`if bar_index == 0
    strategy.entry('far', strategy.long, qty=1, stop=110)
    strategy.entry('near', strategy.long, qty=1, stop=105)`:`if bar_index == 0
    strategy.entry('A', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('B', strategy.long, qty=1, stop=${scenario==='exit-before'?110:105})
    strategy.exit('TP', 'A', limit=${scenario==='exit-before'?105:110})`;
   const source=`//@version=6
strategy('browser cross path', initial_capital=10000, pyramiding=5,
    commission_type=strategy.commission.cash_per_order, commission_value=1,
    use_bar_magnifier=${magnified})
strategy.risk.max_position_size(1)
${body}`;
   const run=await execute(source,bars,magnified);
   try{
    const raw=await run.raw(),s=raw.strategy;
    const expected=scenario==='near'?[['near',105]]:scenario==='exit-before'?[['A',100],['TP',105],['B',110]]:[['A',100],['TP',110]];
    assert(JSON.stringify(raw.auditLedger.fillEvents.map(f=>[f.sourceOrderId,f.price]))===JSON.stringify(expected),'incorrect fill path');
    near(s.netPnl,scenario==='near'?-1:scenario==='exit-before'?2:8);
    near(s.equity,scenario==='near'?10006:scenario==='exit-before'?10004:10008);
    near(s.position,scenario==='exit-after'?0:1);
    assert(raw.executionPrecision.applied===magnified,'precision not actually applied');
    if(magnified)near(raw.executionPrecision.coverage,1);
    cases.push({engine:engineName,scenario,magnified,source,bars,children:run.children,raw,pass:true});
   }finally{run.session.stop()}
  }
  const bars=[bar(0,100),bar(1,100),bar(2,100,100,90,90)];
  const source=`//@version=6
strategy('forming risk browser', initial_capital=1000, calc_on_every_tick=true,
    commission_type=strategy.commission.cash_per_contract, commission_value=.5)
strategy.risk.max_position_size(2)
strategy.risk.allow_entry_in(strategy.direction.long)
strategy.risk.max_intraday_loss(20,strategy.cash)
if bar_index == 0
    strategy.entry('L',strategy.long,qty=3)
    strategy.order('waiting',strategy.long,qty=1,limit=80)
if bar_index == 2 and strategy.position_size == 0
    strategy.entry('blocked',strategy.long,qty=1)`;
  const run=await execute(source,bars,false,true);
  try{
   const first=await run.raw();near(first.strategy.position,0);near(first.strategy.netPnl,-22);near(first.strategy.equity,978);
   bars[2]=bar(2,100,105,90,105);await run.update();
   const revised=await run.raw();near(revised.strategy.position,2);near(revised.strategy.netPnl,-1);near(revised.strategy.equity,1009);
   assert(revised.trades.length===1&&!revised.trades[0].exit,'risk close leaked into revised bar');
   assert(JSON.stringify(revised.auditLedger.fillEvents.map(f=>f.sourceOrderId))==='["L"]','risk fill leaked');
   assert(!revised.auditLedger.orderEvents.some(e=>['cancelled','rejected'].includes(e.kind)),'old risk cancellation leaked');
   bars.push(bar(3,105));await run.update();const final=await run.raw();
   const fresh=await execute(source,bars,false);let offline;try{offline=await fresh.raw()}finally{fresh.session.stop()}
   for(const name of ['trades'])assert(JSON.stringify(final[name])===JSON.stringify(offline[name]),'live/static '+name);
   for(const name of ['orderEvents','fillEvents'])assert(JSON.stringify(final.auditLedger[name])===JSON.stringify(offline.auditLedger[name]),'live/static '+name);
   assert(JSON.stringify(final.reportSeries.points)===JSON.stringify(offline.reportSeries.points),
     'live/static curves '+JSON.stringify({live:final.reportSeries,offline:offline.reportSeries}));
   near(final.strategy.equity,1009);near(final.strategy.netPnl,-1);
   cases.push({engine:engineName,scenario:'forming-rollback',source,bars,first,revised,final,offline,pass:true});
  }finally{run.session.stop()}
  return cases;
 }finally{engine.terminate?.()}
}'''


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    base=f'http://127.0.0.1:{port}'
    result={'cases':[],'errors':[],'externalRequests':[]}
    with (args.output/'server.log').open('w') as log:
        server=subprocess.Popen(['node','node_modules/vite/bin/vite.js','--config','tests/vite-provider.config.ts',
            '--host','127.0.0.1','--port',str(port),'--strictPort'],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
        try:
            deadline=time.monotonic()+45
            while True:
                try:
                    if urlopen(base,timeout=1).status==200:break
                except OSError:pass
                if time.monotonic()>deadline:raise TimeoutError('server')
                time.sleep(.1)
            with sync_playwright() as p:
                browser=p.chromium.launch()
                try:
                    for engine in ['PineEngine','PineWorkerEngine']:
                        page=browser.new_page()
                        page.route('**/__order_paths__',lambda route:route.fulfill(content_type='text/html',body='<html><body>Engine transport check</body></html>'))
                        page.on('pageerror',lambda error:result['errors'].append(str(error)))
                        page.on('request',lambda req:result['externalRequests'].append(req.url) if req.url.startswith(('http:','https:')) and not req.url.startswith(base) else None)
                        workers=[];page.on('worker',lambda worker:workers.append(worker.url))
                        try:
                            page.goto(base+'/__order_paths__')
                            result['cases']+=page.evaluate(RUN,engine)
                            if engine=='PineWorkerEngine':assert workers,'no actual browser Worker'
                            deadline=time.monotonic()+5
                            while page.workers and time.monotonic()<deadline:page.wait_for_timeout(20)
                            assert not page.workers,'Worker survived termination'
                        finally:page.close()
                    assert not result['errors'] and not result['externalRequests'],result
                    result['status']='passed'
                finally:browser.close()
        except Exception as error:
            result.update(status='failed',error=str(error));raise
        finally:
            server.terminate();server.wait(timeout=10)
            (args.output/'results.json').write_text(json.dumps(result,indent=2))
            (args.output/'SHA256.json').write_text(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest()
                for p in args.output.iterdir() if p.is_file() and p.name!='SHA256.json'},indent=2))
    print(json.dumps({'status':result['status'],'cases':len(result['cases'])}))


if __name__=='__main__':main()
