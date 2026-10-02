#!/usr/bin/env python3
"""Independent O-02: real Workspace, both engines, setter fault and recovery."""
import json
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:4198'
server = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--config',
    'tests/vite-performance.config.ts', '--host', '127.0.0.1', '--port', '4198', '--strictPort'],
    cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(300):
        try:
            if urlopen(BASE, timeout=1).status == 200:
                break
        except OSError:
            time.sleep(.1)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        outcomes = []
        for kind in ('PineEngine', 'PineWorkerEngine'):
            page = browser.new_page(viewport={'width':1440,'height':900})
            page.route('**/__settings_fault__', lambda route: route.fulfill(content_type='text/html',
                body='<html><body><div id="chart" style="width:1400px;height:800px"></div><div id="report"></div></body></html>'))
            page.goto(BASE+'/__settings_fault__')
            result = page.evaluate('''async kind => {
              const {VelaWorkspace}=await import('/node_modules/@luxalgo/vela/dist/workspace.js');
              const engines=await import('/packages/vela-pinets/dist/index.js');
              const {mountBacktestFeature}=await import('/src/app/backtest-feature.ts');
              const sleep=ms=>new Promise(r=>setTimeout(r,ms));
              const assert=(v,msg)=>{if(!v)throw Error(msg)};
              const wait=async(fn,label)=>{for(let i=0;i<250;i++){if(fn())return;await sleep(25)}throw Error(label)};
              const bars=Array.from({length:48},(_,i)=>({time:1790000000000+i*3600000,
                open:210+i*2,high:213+i*2,low:209+i*2,close:212+i*2,volume:50+i}));
              const engine=new engines[kind]();
              const ws=new VelaWorkspace(document.querySelector('#chart'),{layout:'1',theme:'dark',
                live:false,persist:false,defaultLanguage:'pine',cells:{fault:{symbol:'BTCUSDT',timeframe:'60',data:bars}},
                engines:{pine:()=>engine}});
              const feature=mountBacktestFeature(ws,{host:document.querySelector('#report')});
              const handle=ws.active.chart.addIndicator('//@version=6\\nstrategy("O02 fresh",initial_capital=20000)\\nqty=input.int(10,"Quantity")\\nif bar_index==3\\n    strategy.entry("L",strategy.long,qty=qty)\\nif bar_index==13\\n    strategy.close("L")\\nplot(qty)',{language:'pine'});
              await wait(()=>feature.controller.getSnapshot()?.status==='ready','initial ready');
              // The first report can precede the public completion event by
              // one microtask. Drain initial history work before fault counts.
              await sleep(300);
              let runs=0;
              const unsub=ws.on('script:run',()=>runs++);
              const original=handle.setProps.bind(handle);
              let fail=true;
              handle.setProps=values=>{if(fail)throw Error('O02 injected second setter');original(values)};
              const open=()=>document.querySelector('[aria-label="Open strategy settings"]').click();
              const tab=id=>document.querySelector('[data-settings-tab="'+id+'"]').click();
              const field=(key,value)=>{const el=document.querySelector('input[data-setting-key="'+key+'"]');
                el.value=String(value);el.dispatchEvent(new Event('change',{bubbles:true}))};
              const ok=()=>document.querySelector('.quant-backtest-settings .quant-backtest-button-primary').click();
              open(); field('qty',19); tab('properties'); field('initial_capital',77777); ok();
              await sleep(100);
              const failureText=document.querySelector('.quant-backtest-settings-status').textContent;
              const failed=feature.controller.getSnapshot();
              assert(!failureText.includes('strategy is unchanged'),'false unchanged promise');
              assert(failureText.includes('Current host values were reloaded'),'no authoritative re-read');
              assert(handle.inputValues().qty===19,'fault did not partially mutate host');
              tab('inputs');assert(document.querySelector('input[data-setting-key="qty"]').value==='19','form not refreshed');
              assert(failed.status==='error'&&!failed.trades?.length,'stale report exposed');
              assert(feature.controller.settingsNeedRecovery(failed.key),'failure gate missing');
              assert(runs===0,'failed batch executed');
              document.querySelector('.quant-backtest-settings-close').click();open();
              assert(document.querySelector('input[data-setting-key="qty"]').value==='19','reopen not authoritative');
              // Deliberately submit unchanged host values. Recovery must send
              // all settings despite a normal diff otherwise being empty.
              fail=false;ok();
              await wait(()=>feature.controller.getSnapshot()?.status==='ready','recovery ready');
              await sleep(100);
              const recovered=feature.controller.getSnapshot();
              const context=await handle.context(['strategy','trades']);
              assert(!feature.controller.settingsNeedRecovery(recovered.key),'recovery gate retained');
              assert(runs===1,'recovery must execute once: '+runs);
              assert(context.trades[0].qty===19,'engine did not receive unchanged persisted qty');
              assert(context.strategy.initialCapital===20000,'unexpected failed property persisted');
              const out={engine:kind,failureText,failureStatus:failed.status,failureTrades:failed.trades?.length??0,
                hostQty:19,recoveryRuns:runs,engineQty:context.trades[0].qty,engineCapital:context.strategy.initialCapital,
                recoveredStatus:recovered.status};
              unsub();feature.destroy();ws.destroy();engine.terminate?.();return out;
            }''', kind)
            outcomes.append(result)
            page.close()
        print(json.dumps(outcomes, indent=2))
        browser.close()
finally:
    server.terminate()
    server.wait(timeout=5)
