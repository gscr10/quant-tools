#!/usr/bin/env python3
"""Real VelaWorkspace timeframe/depth/viewport gate with an observable provider.

Starts an isolated Vite server and records the actual provider requests, chart
bars, viewport and shared cache. Synthetic OHLC is confined to the provider;
no VelaWorkspace, ChartCell, setMarket or renderer method is mocked.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get("QUANT_TIMEFRAME_OUT", str(ROOT / "audit-evidence/2026-10-07-timeframe-switch-full-viewport")))
OUT.mkdir(parents=True, exist_ok=True)
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    PORT = probe.getsockname()[1]
BASE = f"http://127.0.0.1:{PORT}"

BOOT = r"""async () => {
  const {VelaWorkspace} = await import('/node_modules/@luxalgo/vela/dist/workspace.js');
  const {sharedBarStore} = await import('/node_modules/@luxalgo/vela/dist/index.js');
  const {installDefaultTimeframeSwitchPolicy} = await import('/src/integrations/vela/timeframe-switch-policy.ts');
  const {createMigratingWorkspaceStorage} = await import('/src/integrations/storage/workspace-storage.ts');
  sharedBarStore.clear();
  const calls = [], events = [], cases = [];
  const series = new Map();
  const steps = {'1':60000,'5':300000,'15':900000,'60':3600000,'120':7200000,'240':14400000,'D':86400000,'W':604800000};
  const now = Date.now();
  let holdTf = null, release = null;
  function allBars(tf, symbol = 'BTCUSDT') {
    const key = symbol + ':' + tf;
    if (series.has(key)) return series.get(key);
    const available = symbol === 'SHORT' ? 37 : tf === 'M' ? 80 : tf === 'W' ? 500 : 30000;
    const month = new Date(now);
    const step = steps[tf] ?? Number(tf)*60000;
    let end = tf === 'M' ? 0 : Math.floor(now / step) * step;
    if (tf === 'W') end -= (new Date(end).getUTCDay() + 6) % 7 * 86400000;
    const rows = Array.from({length:available}, (_,i) => {
      const offset = available - i - 1;
      const time = tf === 'M' ? Date.UTC(month.getUTCFullYear(),month.getUTCMonth()-offset,1) : end - offset*step;
      const close = 50000 + i % 100;
      return {time,open:close-1,high:close+2,low:close-2,close,volume:10};
    });
    series.set(key, rows);
    return rows;
  }
  const provider = {
    listSymbols:async () => ['BTCUSDT','ETHUSDT','SHORT'].map(ticker => ({ticker,type:'crypto'})),
    getSymbolInfo:async ticker => ({ticker,tickerid:'AUDIT:'+ticker,type:'crypto',currency:'USD',basecurrency:'BTC',timezone:'Etc/UTC',session:'24x7',mintick:0.01,pricescale:100}),
    getBars:async (symbol, tf, range = {}) => {
      calls.push({symbol,tf,range:{...range},at:performance.now()});
      if (holdTf === tf) {
        holdTf = null;
        await new Promise(resolve => {release = resolve;});
      }
      let rows = allBars(tf,symbol).filter(b => (range.from == null || b.time >= range.from) && (range.to == null || b.time <= range.to));
      if (range.limit != null) rows = rows.slice(-range.limit);
      return rows;
    },
    subscribe:() => () => {},
  };
  const wait = ms => new Promise(r => setTimeout(r,ms));
  const waitFor = async (test, label) => {
    for(let n=0;n<250;n++) {if(test())return;await wait(20);}
    throw new Error('Timed out: '+label);
  };
  function mount(persist = false) {
    const workspace = new VelaWorkspace(document.querySelector('#workspace'), {
      layout:'1',symbol:'audit:BTCUSDT',timeframe:'60',bars:2000,live:false,
      theme:'dark',timezone:'Etc/UTC',providers:{audit:()=>provider},
      persist:persist ? 'timeframe-audit' : false,
      storage:createMigratingWorkspaceStorage(),
      drawingToolbar:false,animations:false,
      topbar:{left:['timeframes','layout'],right:[]},
    });
    const detach = installDefaultTimeframeSwitchPolicy(workspace,2000);
    const destroy = workspace.destroy.bind(workspace);
    workspace.destroy = () => {detach();destroy();};
    workspace.cells().forEach(cell => {
      for (const event of ['market:changed','history:complete'])cell.chart.on(event,payload => events.push({cell:cell.id,event,payload}));
    });
    return workspace;
  }
  let workspace = mount();
  const chart = () => workspace.active.chart;
  async function settled(cell = workspace.active) {
    await cell.chart.ready();
    await cell.chart.historyComplete();
    await wait(400);
  }
  function snapshot(cell = workspace.active) {
    // Inspection-only: compare rendered source with actual provider and cache.
    const c = cell.chart, rows = c.orchestrator.rawBars;
    const source = allBars(c.market.timeframe, c.market.symbol.split(':').pop());
    const range = c.getVisibleRange();
    const cache = [...sharedBarStore.series.entries()].map(([key,bars]) => ({key,count:bars.length,first:bars[0]?.time,last:bars.at(-1)?.time}));
    const visibleCount = range ? rows.filter(b=>b.time>=range.from&&b.time<=range.to).length : 0;
    const canvasWidth = cell.chart.orchestrator.renderer.coords.width;
    const key='audit|'+c.market.symbol.split(':').pop()+'|'+c.market.timeframe+(c.market.session&&c.market.session!=='regular'?'|'+c.market.session:'');
    const cached=sharedBarStore.get(key)??[];
    const cachedSourceMatches = cached.slice(-(rows.length-1)).every((b,i)=>b.time===rows[i]?.time&&b.close===rows[i]?.close);
    return {cell:cell.id,market:c.market,count:rows.length,first:rows[0]?.time,last:rows.at(-1)?.time,
      expectedCount:Math.min(c.market.bars,source.length),expectedFirst:source.at(-Math.min(c.market.bars,source.length))?.time,
      expectedLast:source.at(-1)?.time,range,cache,visibleCount,canvasWidth,
      spacing:c.orchestrator.renderer.coords.getViewport().barSpacing,
      styleSpacing:c.renderer.getConfig().series.spacing,
      persistedStyleSpacing:workspace.getState().charts.find(entry=>entry.id===cell.id)?.rendererConfig?.series?.spacing,
      requestCount:calls.length,
      cacheContainsClosedWindow:cached.length>=rows.length-1&&cachedSourceMatches};
  }
  async function save(name,start,cell=workspace.active,ordinary=true) {
    await settled(cell);
    const state = snapshot(cell);
    const requests = calls.slice(start);
    const checks = {
      barsRequested:!ordinary || state.market.bars === 2000,
      actualDepth:state.count === state.expectedCount,
      latestTail:state.last === state.expectedLast,
      latestWindow:state.first === state.expectedFirst,
      sharedCache:state.cacheContainsClosedWindow,
      stylePersists:state.styleSpacing===state.persistedStyleSpacing,
      boundedRequests:!ordinary || requests.every(c => c.range.limit == null || c.range.limit <= 2202),
      viewport:!ordinary || !!state.range && state.range.from >= state.first && state.range.to === state.last,
      viewportFitsDefault:!ordinary || name==='cold-start' || name.startsWith('restore-') || state.visibleCount === state.count,
    };
    const result = {name,state,requests,checks};
    cases.push(result);
    return result;
  }
  await save('cold-start',0);
  window.tfAudit = {workspace,chart,calls,events,cases,allBars,wait,waitFor,snapshot,save,settled,
    interaction(name,checks,before) {const state=snapshot();const result={name,state,before,requests:calls.slice(before.requestCount),checks};cases.push(result);return result;},
    async switch(tf,name='switch-'+tf) {const start=calls.length;workspace.active.setTimeframe(tf);return save(name,start);},
    async overlap() {
      holdTf='5'; release=null;
      const start=calls.length;
      workspace.active.setTimeframe('5');
      await waitFor(()=>release!==null,'held 5m request');
      workspace.active.setTimeframe('15');
      await settled();
      release();await wait(500);
      return save('rapid-overlap',start);
    },
    async deep() {
      const start=calls.length;
      await chart().setMarket({bars:12500});
      return save('explicit-deep-history',start,workspace.active,false);
    },
    async explicitRange() {
      const start=calls.length;
      await chart().setMarket({timeframe:'5',bars:4000,visibleRange:'ALL'});
      return save('explicit-range',start,workspace.active,false);
    },
    async session() {
      for(const session of ['extended','regular']) {
        const start=calls.length;
        await chart().setMarket({session});
        await save('session-'+session,start);
      }
    },
    async offline() {
      const data=allBars('1').slice(-37);
      await chart().setMarket({symbol:'audit:BTCUSDT',timeframe:'1',data,bars:37});
      const start=calls.length;
      await chart().setMarket({timeframe:'5'});
      await settled();
      const c=chart();
      const checks={offlineRetained:c.market.offline,barsRetained:c.market.bars===37,
        noProviderRequest:calls.length===start,dataRetained:JSON.stringify(c.orchestrator.rawBars)===JSON.stringify(data)};
      cases.push({name:'offline-timeframe',checks,state:snapshot(),requests:calls.slice(start)});
    },
    async short() {
      const start=calls.length;
      workspace.active.setSymbol('audit:SHORT');
      return save('insufficient-history',start);
    },
    async multicell() {
      workspace.setLayout('4');
      await Promise.all(workspace.cells().map(settled));
      const targets=['1','5','D','M'];
      const start=calls.length;
      workspace.cells().forEach((cell,i)=>cell.setTimeframe(targets[i]));
      const result=[];
      for(const cell of workspace.cells())result.push(await save('multicell-'+cell.id,start,cell));
      return result;
    },
    async linkedCells() {
      workspace.sync.set('timeframe',true);
      await Promise.all(workspace.cells().map(settled));
      const start=calls.length;
      workspace.active.setTimeframe('120');
      const result=[];
      for(const cell of workspace.cells())result.push(await save('linked-'+cell.id,start,cell));
      workspace.sync.set('timeframe',false);
      return result;
    },
    async migrate(bars) {
      workspace.setLayout('1');await settled();
      const state=workspace.getState();
      for(const cell of state.charts){cell.bars=bars;cell.symbol='audit:BTCUSDT';cell.timeframe='60';}
      workspace.destroy();sharedBarStore.clear();
      localStorage.setItem('timeframe-audit',JSON.stringify(state));
      const start=calls.length;
      workspace=mount(true);this.workspace=workspace;
      const result=await save('restore-'+bars,start,workspace.active,bars<=2000);
      return result;
    },
    destroy(){workspace.destroy();return {children:document.querySelector('#workspace').children.length};},
  };
  return cases[0];
}"""


def run() -> None:
    subprocess.run(['node','scripts/ensure-vela-viewport.mjs','--check-only'],cwd=ROOT,check=True)
    with (OUT / 'vite.log').open('w') as log:
        server = subprocess.Popen([str(ROOT / 'node_modules/.bin/vite'), '--host', '127.0.0.1', '--port', str(PORT), '--strictPort'], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 60
            while True:
                if server.poll() is not None:
                    raise RuntimeError('Vite stopped before ready')
                try:
                    with urlopen(BASE, timeout=0.5) as response:
                        if response.status == 200:
                            break
                except OSError:
                    if time.monotonic() > deadline:
                        raise TimeoutError('Vite did not become ready')
                    time.sleep(0.1)
            with sync_playwright() as p:
                browser = getattr(p,os.environ.get('QUANT_TIMEFRAME_BROWSER','chromium')).launch(headless=True)
                page = browser.new_page(viewport={'width':1440,'height':1000})
                errors, external = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                def route(request):
                    if request.request.url.startswith(BASE):
                        request.continue_()
                    else:
                        external.append(request.request.url)
                        request.abort()
                page.route('**/*', route)
                page.route('**/__timeframe_audit__', lambda route: route.fulfill(content_type='text/html', body='<html><body style="margin:0"><div id="workspace" style="height:100vh"></div></body></html>'))
                page.goto(BASE+'/__timeframe_audit__')
                page.evaluate(BOOT)
                # Start from the full 2,000 hours (~120,000 minute candles),
                # the exact old-span amplification trigger in the bug report.
                page.evaluate("tfAudit.chart().setVisibleRangePreset('ALL')")
                for tf in ['1','5','60','5','30','45','60','120','180','240','D','W','M','1']:
                    page.evaluate('(tf)=>tfAudit.switch(tf)',tf)
                start=page.evaluate('tfAudit.calls.length')
                page.locator('.vela-widget-tf-caret').click()
                page.locator('.vela-menu-item[data-vei-id="5"] .vela-menu-label').click()
                page.wait_for_function('tfAudit.chart().market.timeframe === "5"')
                page.evaluate('(start)=>tfAudit.save("topbar-menu",start)',start)
                start=page.evaluate('tfAudit.calls.length')
                page.evaluate('tfAudit.workspace.active.focus()')
                page.keyboard.press('1')
                page.locator('.vela-tq-input').fill('120')
                page.locator('.vela-tq-input').press('Enter')
                page.wait_for_function('tfAudit.chart().market.timeframe === "120"')
                page.evaluate('(start)=>tfAudit.save("keyboard-entry",start)',start)
                page.evaluate('tfAudit.overlap()')
                page.evaluate('tfAudit.deep()')
                page.evaluate("tfAudit.switch('1','deep-to-default')")
                page.evaluate("tfAudit.switch('15','deep-cache-revisit')")
                page.evaluate('tfAudit.explicitRange()')
                page.evaluate('tfAudit.session()')
                page.evaluate('tfAudit.short()')
                page.evaluate('tfAudit.multicell()')
                page.screenshot(path=str(OUT/'four-cells-full-depth.png'),full_page=True)
                page.evaluate('tfAudit.linkedCells()')
                page.evaluate('tfAudit.migrate(500)')
                page.evaluate('tfAudit.migrate(6000)')
                page.evaluate("tfAudit.switch('5','restored-deep-to-default')")
                page.set_viewport_size({'width':390,'height':844})
                start=page.evaluate('tfAudit.calls.length')
                page.locator('.vela-mb-tf').click()
                page.locator('.vela-tfd-grid').get_by_role('button',name='1m',exact=True).click()
                page.wait_for_function('tfAudit.chart().market.timeframe === "1"')
                page.evaluate('(start)=>tfAudit.save("mobile-timeframe",start)',start)
                for width in [320,480,390]:
                    page.set_viewport_size({'width':width,'height':844})
                    page.evaluate('(name)=>tfAudit.save(name,tfAudit.calls.length)',f'mobile-resize-{width}')
                page.screenshot(path=str(OUT/'mobile-full-depth.png'),full_page=True)
                before=page.evaluate('tfAudit.snapshot()')
                page.evaluate('tfAudit.chart().renderer.set("animZoom",120)')
                page.mouse.move(160,330)
                page.mouse.wheel(0,-90)
                page.wait_for_timeout(1200)
                after=page.evaluate('tfAudit.snapshot()')
                page.evaluate('([before,after])=>tfAudit.interaction("native-wheel-below-old-floor",{zoomed:after.visibleCount<before.visibleCount,continuous:after.spacing>before.spacing&&after.spacing<0.5,styleUnchanged:after.styleSpacing===before.styleSpacing},before)',[before,after])
                page.set_viewport_size({'width':480,'height':844})
                page.wait_for_timeout(500)
                resized=page.evaluate('tfAudit.snapshot()')
                page.evaluate('([before,after])=>tfAudit.interaction("user-zoom-survives-resize",{spacingPreserved:Math.abs(after.spacing-before.spacing)<1e-9,styleUnchanged:after.styleSpacing===before.styleSpacing},before)',[after,resized])
                page.mouse.move(160,330)
                page.mouse.down()
                page.mouse.move(225,330,steps=8)
                page.mouse.up()
                page.wait_for_timeout(500)
                panned=page.evaluate('tfAudit.snapshot()')
                page.evaluate('([before,after])=>tfAudit.interaction("native-pan-after-dense-fit",{moved:after.range.from!==before.range.from||after.range.to!==before.range.to,historyPageAdded:after.count===before.count+2000,tailRetained:after.last===before.last,sourceMatches:after.cacheContainsClosedWindow,styleUnchanged:after.styleSpacing===before.styleSpacing},before)',[resized,panned])
                page.evaluate("tfAudit.chart().setVisibleRange({from:tfAudit.allBars('1').at(-1000).time,to:tfAudit.allBars('1').at(-900).time})")
                page.wait_for_timeout(300)
                located=page.evaluate('tfAudit.snapshot()')
                page.evaluate('(before)=>tfAudit.interaction("explicit-trade-date-location",{localized:tfAudit.snapshot().visibleCount>=100&&tfAudit.snapshot().visibleCount<=102,styleUnchanged:tfAudit.snapshot().styleSpacing===before.styleSpacing},before)',panned)
                page.set_viewport_size({'width':390,'height':844})
                page.wait_for_timeout(500)
                page.evaluate('(before)=>tfAudit.interaction("explicit-location-survives-resize",{spacingPreserved:Math.abs(tfAudit.snapshot().spacing-before.spacing)<1e-9,notRefitted:tfAudit.snapshot().visibleCount<200},before)',located)
                page.evaluate("tfAudit.switch('5','post-navigation-default-reset')")
                before=page.evaluate('tfAudit.snapshot()')
                page.mouse.move(160,330)
                page.mouse.wheel(0,10000)
                page.wait_for_timeout(1200)
                page.evaluate('(before)=>tfAudit.interaction("deliberate-zoom-out-pages-history",{onePageAdded:tfAudit.snapshot().count===before.count+2000,notInfinite:tfAudit.snapshot().spacing>=tfAudit.snapshot().canvasWidth/(tfAudit.snapshot().count+6)-1e-9,boundedPage:tfAudit.calls.slice(before.requestCount).every(c=>(c.range.limit??0)<=2001),actualRequest:tfAudit.calls.length>before.requestCount,styleUnchanged:tfAudit.snapshot().styleSpacing===before.styleSpacing},before)',before)
                if os.environ.get('QUANT_TIMEFRAME_BROWSER','chromium')=='chromium':
                    before=page.evaluate('tfAudit.snapshot()')
                    touch=page.context.new_cdp_session(page)
                    touch.send('Emulation.setTouchEmulationEnabled',{'enabled':True,'maxTouchPoints':2})
                    touch.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':120,'y':330,'id':1},{'x':230,'y':330,'id':2}]})
                    for index in range(1,9):
                        touch.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':120-index*5,'y':330,'id':1},{'x':230+index*5,'y':330,'id':2}]})
                    touch.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                    page.wait_for_timeout(500)
                    after=page.evaluate('tfAudit.snapshot()')
                    page.evaluate('([before,after])=>tfAudit.interaction("native-pinch-below-old-floor",{zoomed:after.visibleCount<before.visibleCount,continuous:after.spacing>before.spacing&&after.spacing<0.5,styleUnchanged:after.styleSpacing===before.styleSpacing,barsRetained:after.count===before.count},before)',[before,after])
                    touch.detach()
                page.evaluate('tfAudit.chart().renderer.applyConfig({series:{spacing:1.7}})')
                page.evaluate("tfAudit.switch('15','custom-style-default-switch')")
                page.evaluate('(before)=>tfAudit.interaction("custom-style-persistence",{stylePreserved:tfAudit.snapshot().styleSpacing===1.7,persistedStylePreserved:tfAudit.snapshot().persistedStyleSpacing===1.7,fullDefaultVisible:tfAudit.snapshot().visibleCount===2000},before)',before)
                page.evaluate('tfAudit.offline()')
                page.screenshot(path=str(OUT/'timeframe-switch.png'),full_page=True)
                result=page.evaluate('({cases:tfAudit.cases,events:tfAudit.events,allRequests:tfAudit.calls,cleanup:tfAudit.destroy()})')
                result.update(pageErrors=errors,externalRequests=external,
                    browser=os.environ.get('QUANT_TIMEFRAME_BROWSER','chromium'),
                    viewportContract={
                        'loadedDepth': 'latest 2000, or actual available history',
                        'ordinarySwitch': 'entire loaded default window fits all tested desktop, cell and mobile widths',
                        'coldAndRestore': 'existing initial viewport preserved; loaded depth checked separately',
                        'cache': 'closed current window must match; intentionally deeper cached history is retained',
                    })
                (OUT/'results.json').write_text(json.dumps(result,indent=2))
                browser.close()
            failures=[{'name':c['name'],'failed':[k for k,v in c['checks'].items() if not v],'state':c['state'],'requests':c['requests']} for c in result['cases'] if not all(c['checks'].values())]
            assert not errors, errors
            assert not external, external
            assert not failures, json.dumps(failures,indent=2)
            assert result['cleanup']['children']==0,result['cleanup']
            print(json.dumps({'passed':len(result['cases']),'pageErrors':len(errors),'externalRequests':len(external),'evidence':str(OUT)}))
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=10)


if __name__ == '__main__':
    run()
