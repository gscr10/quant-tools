#!/usr/bin/env python3
"""Real Workbench/Worker trade-location and transient-marker lifecycle."""
import argparse
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import urlopen

from playwright.sync_api import sync_playwright
from e2e_app import install_fixed_clock, install_mock_market_data, install_offline_guard, MOCK_WEBSOCKET_SCRIPT
from e2e_production_a11y import continuous_klines

ROOT = Path(__file__).resolve().parents[1]
SETUP = r'''async () => {
  await import('/src/style.css');
  const {createApp}=await import('/src/app/create-app.ts');
  const {mountBacktestFeature}=await import('/src/app/backtest-feature.ts');
  const {getNativeIndicator}=await import('/node_modules/@luxalgo/vela/dist/index.js');
  let ws,feature,options;
  const trace={ranges:[],crosshairs:[],labels:[],calls:[],toasts:[]};
  const app=createApp('#ws',{mountBacktestFeature(workspace,opts){
    ws=workspace;options=opts;
    const chart=ws.active.chart,renderer=chart.renderer;
    const range=chart.setVisibleRange.bind(chart),cross=renderer.setExternalCrosshair.bind(renderer);
    chart.setVisibleRange=value=>{if(trace.failRange)throw Error('injected range failure');trace.ranges.push(value);return range(value)};
    renderer.setExternalCrosshair=(...args)=>{trace.crosshairs.push(args);return cross(...args)};
    const add=chart.addNativeIndicator.bind(chart);
    chart.addNativeIndicator=(type,opts)=>{
      const d=getNativeIndicator(type);
      if(type==='quant-backtest-execution-highlight'&&d){
        const create=d.create;d.create=()=>{const item=create();const start=item.start;
          item.start=(ctx,inputs)=>start({...ctx,emit:out=>{trace.labels.push(out);ctx.emit(out)}},inputs);
          return item;};
      }
      return add(type,opts);
    };
    feature=mountBacktestFeature(workspace,{...opts,onTradeLocate:(report,trade,side)=>{
      trace.calls.push({runId:report.runId,revision:report.revision,trade,side});
      opts.onTradeLocate(report,trade,side);
    }});return feature;
  }});
  const toast=app.workspace.toast.bind(app.workspace);
  app.workspace.toast=(text,kind)=>{trace.toasts.push({text,kind});toast(text,kind)};
  const capture=()=>({report:feature.controller.getSnapshot(),trace,
    active:ws.active.id,market:ws.active.chart.market,range:ws.active.chart.getVisibleRange(),
    indicators:ws.active.chart.indicators().map(h=>({id:h.id,title:h.title,nativeType:h.nativeType})),
    onChart:app.workspace.getOnChartIndicators().map(i=>i.name),builtins:app.workspace.getBuiltInIndicators().map(i=>i.name),
    scene:ws.active.chart.inspect(),exportedState:app.workspace.getState(),
    saved:localStorage.getItem('quant-tools:workspace:v2')});
  window.__tradeLocation={ws,feature,options,app,capture,trace,
    invoke:(report,trade,side)=>options.onTradeLocate(report,trade,side),
    destroy:()=>{app.destroy();return document.querySelectorAll('#ws canvas').length}};
}'''


def run_case(browser, browser_name, base, width, output):
    context=browser.new_context(viewport={'width':width,'height':1000 if width>500 else 844},locale='en-US',timezone_id='UTC',has_touch=width<500)
    errors=[];blocked=[];requests=[];checks=[];console=[]
    install_fixed_clock(context);context.add_init_script(MOCK_WEBSOCKET_SCRIPT)
    install_offline_guard(context,blocked);install_mock_market_data(context,requests)
    def market_response(route):
        requests.append(route.request.url)
        route.fulfill(status=200,content_type='application/json',body=json.dumps(continuous_klines(route.request.url)))
    context.route('**/klines?*',market_response)
    context.add_init_script("window.__locationErrors=[];window.addEventListener('error',e=>window.__locationErrors.push(e.message))")
    page=context.new_page();page.set_default_timeout(45000)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:console.append({'type':m.type,'text':m.text}))
    name=f'{browser_name}-{width}'
    def check(label,actual,expected=True):
        checks.append({'name':label,'actual':actual,'expected':expected,'passed':actual==expected})
        assert actual==expected,checks[-1]
    def capture():return page.evaluate('window.__tradeLocation?.capture()??null')
    def open_log():
        page.locator('[aria-label="Open backtest viewer"]:visible').click()
        page.get_by_role('tab',name='Trades Log',exact=True).click()
    try:
        page.goto(base+'/tests/fixtures/history-live.html',wait_until='domcontentloaded')
        page.evaluate(SETUP)
        page.locator('button:visible',has_text='Indicators').first.click()
        page.locator('.quant-indicator-category[data-section="built-ins"]').click()
        page.locator('.quant-indicator-row',has_text='SMA Cross (strategy)').locator('.quant-indicator-main').click()
        page.wait_for_function("window.__tradeLocation.feature.controller.getSnapshot()?.history?.complete&&window.__tradeLocation.feature.controller.getSnapshot()?.trades?.length>1")
        baseline=capture();key=baseline['report']['key'];run=baseline['report']['runId']
        page.evaluate("window.__locationHistory=1;window.__tradeLocation.ws.active.history.push({undo:()=>window.__locationHistory=0,redo:()=>window.__locationHistory=1})")
        open_log()
        page.locator('[data-trade-sort="netPnl"]').click()
        row=page.locator('.quant-backtest-trade-table tbody tr:has([data-trade-locate="exit"])').first
        source_index=int(row.get_attribute('data-trade-source-index'))
        trade=baseline['report']['trades'][source_index]
        if width>500:row.hover()
        row.locator('[data-trade-locate="entry"]').click()
        page.wait_for_function('window.__tradeLocation.trace.labels.length>0')
        after=capture()
        check('Entry closes Viewer',page.locator('.quant-backtest-viewer').is_visible(),False)
        check('Entry remains active strategy',after['report']['key'],key)
        check('Entry does not rerun strategy',after['report']['runId'],run)
        check('crosshair time and price',after['trace']['crosshairs'][-1],[trade['entryTime'],trade['entryPrice']])
        half=60*15*60*1000
        check('reference +/-60 bars requested',after['trace']['ranges'][-1],{'from':trade['entryTime']-half,'to':trade['entryTime']+half})
        marker=after['trace']['labels'][-1]['labels'][0]
        check('reference marker label',marker['text'].split('\n')[0],f"Trade #{trade['number']} · {trade['direction'].title()} entry")
        check('reference marker styling',[marker['color'],marker['textColor'],marker['style'],marker['yloc']],['#2962ff','#ffffff','label_down','abovebar'])
        check('marker excluded from On chart',after['onChart'],baseline['onChart'])
        check('marker excluded from builtin catalog',after['builtins'],baseline['builtins'])
        check('marker excluded from template export','quant-backtest-execution-highlight' not in json.dumps(after['exportedState']))
        page.wait_for_timeout(650)
        check('autosave excludes marker','quant-backtest-execution-highlight' not in (capture()['saved'] or ''))
        page.screenshot(path=str(output/(name+'-entry.png')))
        page.wait_for_function("!window.__tradeLocation.ws.active.chart.indicators().some(h=>h.nativeType==='quant-backtest-execution-highlight')",timeout=6500)
        cleared=capture();check('four-second cleanup clears crosshair',cleared['trace']['crosshairs'][-1],[None])
        check('cleanup preserves all user indicators',cleared['indicators'],baseline['indicators'])
        page.evaluate('window.__tradeLocation.ws.active.history.undo()')
        check('transient removal does not consume user Undo',page.evaluate('window.__locationHistory'),0)
        page.evaluate('window.__tradeLocation.ws.active.history.redo()')
        check('user Redo is preserved',page.evaluate('window.__locationHistory'),1)
        open_log()
        page.get_by_role('tab',name='Calendar view',exact=True).click()
        check('Calendar has no invented locate buttons',page.locator('[data-trade-locate]').count(),0)
        page.get_by_role('tab',name='List view',exact=True).click()
        row=page.locator('.quant-backtest-trade-table tbody tr:has([data-trade-locate="exit"])').first
        row.locator('[data-trade-locate="exit"]').focus();page.keyboard.press('Enter')
        page.wait_for_function("window.__tradeLocation.trace.calls.at(-1)?.side==='exit'")
        check('Calendar/List keyboard exit uses correct trade',capture()['trace']['crosshairs'][-1],[trade['exitTime'],trade['exitPrice']])
        open_log()
        open_row=page.locator('.quant-backtest-trade-table tbody tr').filter(has=page.locator('.quant-backtest-trade-datetime',has_text='Open')).first
        check('open row has Entry',open_row.locator('[data-trade-locate="entry"]').count(),1)
        check('open row has no fictitious Exit',open_row.locator('[data-trade-locate="exit"]').count(),0)
        if width>500:open_row.hover()
        open_row.locator('[data-trade-locate="entry"]').click()
        page.wait_for_timeout(80)
        after=capture();check('new locate replaces previous native',len([i for i in after['indicators'] if i.get('nativeType')=='quant-backtest-execution-highlight']),1)
        page.evaluate('window.__locationSaved=window.__tradeLocation.capture().report')
        owner=after['active']
        page.evaluate('window.__tradeLocation.ws.setLayout("4")')
        other=page.evaluate('window.__tradeLocation.ws.cells().find(c=>c.id!==window.__locationSaved.key.cellId).id')
        page.evaluate('(id)=>window.__tradeLocation.ws.setActiveCell(id)',other)
        check('Cell switch clears original marker',page.evaluate("window.__tradeLocation.ws.cell(window.__locationSaved.key.cellId).chart.indicators().some(h=>h.nativeType==='quant-backtest-execution-highlight')"),False)
        check('Cell switch does not move marker to new Cell',any(i.get('nativeType')=='quant-backtest-execution-highlight' for i in capture()['indicators']),False)
        page.evaluate('(id)=>window.__tradeLocation.ws.setActiveCell(id)',owner)
        page.wait_for_function('(id)=>window.__tradeLocation.feature.controller.getSnapshot()?.key?.cellId===id',arg=owner)
        page.evaluate("(()=>{const r=window.__locationSaved;window.__tradeLocation.invoke(r,r.trades[0],'entry')})()")
        page.evaluate('window.__tradeLocation.ws.active.chart.indicators().find(h=>h.id===window.__locationSaved.key.indicatorId).remove()')
        check('source deletion clears its marker immediately',any(i.get('nativeType')=='quant-backtest-execution-highlight' for i in capture()['indicators']),False)
        before=capture();count=len(before['trace']['ranges'])
        page.evaluate("(()=>{const r=window.__locationSaved;window.__tradeLocation.invoke(r,r.trades[0],'entry')})()")
        check('late deleted-source callback cannot navigate',len(capture()['trace']['ranges']),count)
        check('deleted-source callback gives visible error',capture()['trace']['toasts'][-1]['text'],'Unable to locate entry on chart')
        page.evaluate("window.__tradeLocation.app.workspace.addScriptIndicator('Location recovery',window.__locationSaved.source)")
        page.wait_for_function("window.__tradeLocation.feature.controller.getSnapshot()?.history?.complete&&window.__tradeLocation.feature.controller.getSnapshot()?.trades?.length>1&&window.__tradeLocation.feature.controller.getSnapshot()?.key?.indicatorId!==window.__locationSaved.key.indicatorId")
        page.evaluate('window.__locationSaved=window.__tradeLocation.capture().report')
        page.evaluate("(()=>{const r=window.__locationSaved;window.__tradeLocation.trace.failRange=true;window.__tradeLocation.invoke(r,r.trades[0],'entry');window.__tradeLocation.trace.failRange=false})()")
        check('chart range failure is visible and contained',capture()['trace']['toasts'][-1]['text'],'Unable to locate entry on chart')
        open_log()
        check('Viewer remains usable after location failure',page.locator('.quant-backtest-trade-table tbody tr').count()>0)
        page.locator('[data-trade-locate="entry"]').first.focus();page.keyboard.press('Enter')
        check('location recovers after chart range failure',any(i.get('nativeType')=='quant-backtest-execution-highlight' for i in capture()['indicators']))
        # Invoke the production composition callback with an old report while
        # the public chart market already announces its new requested identity.
        page.evaluate("window.__tradeLocation.ws.active.chart.setMarket({symbol:'binance:ETHUSDT',timeframe:'5'})")
        page.wait_for_timeout(100)
        before=capture();count=len(before['trace']['ranges'])
        page.evaluate("(()=>{const r=window.__locationSaved;window.__tradeLocation.invoke(r,r.trades[0],'entry')})()")
        stale=capture();check('old market report cannot navigate new market',len(stale['trace']['ranges']),count)
        check('stale market gives visible error',stale['trace']['toasts'][-1]['text'],'Unable to locate entry on chart')
        check('switch clears transient native',any(i.get('nativeType')=='quant-backtest-execution-highlight' for i in stale['indicators']),False)
        page.wait_for_function("window.__tradeLocation.feature.controller.getSnapshot()?.history?.complete&&window.__tradeLocation.feature.controller.getSnapshot()?.symbol==='binance:ETHUSDT'&&window.__tradeLocation.feature.controller.getSnapshot()?.trades?.length>1")
        page.evaluate("(()=>{const r=window.__tradeLocation.capture().report;window.__tradeLocation.invoke(r,r.trades[0],'entry')})()")
        check('active marker present before destroy',any(i.get('nativeType')=='quant-backtest-execution-highlight' for i in capture()['indicators']))
        check('destroy clears canvas',page.evaluate('window.__tradeLocation.destroy()'),0)
        before=page.evaluate('window.__tradeLocation.trace.crosshairs.length')
        page.wait_for_timeout(4300)
        check('destroy cancels delayed marker mutation',page.evaluate('window.__tradeLocation.trace.crosshairs.length'),before)
        check('page errors',errors,[]);check('window errors',page.evaluate('window.__locationErrors'),[]);check('external requests',blocked,[])
        result={'name':name,'checks':checks,'trace':stale['trace'],'sourceTrade':trade,'console':console,'requests':requests,'passed':True}
        (output/(name+'.json')).write_text(json.dumps(result,indent=2))
        return {'name':name,'checks':len(checks),'passed':True}
    except Exception as error:
        page.screenshot(path=str(output/(name+'-failure.png')))
        (output/(name+'-failure.json')).write_text(json.dumps({'error':str(error),'checks':checks,'errors':errors,'blocked':blocked,'console':console,'requests':requests,'state':capture()},indent=2))
        raise
    finally:context.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'audit-evidence/2026-10-07-trade-location/local')
    parser.add_argument('--browsers',default='chromium,firefox')
    parser.add_argument('--widths',default='1440')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    source_paths=[ROOT/p for p in ['src/integrations/vela/backtest-chart-adapter.ts','src/integrations/vela/workspace-adapter.ts','src/integrations/storage/workspace-storage.ts','src/domain/ports/workspace-port.ts','src/app/create-app.ts','tests/e2e_trade_location.py']]
    source_hashes=lambda:{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source_paths}
    before_hashes=source_hashes()
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    base=f'http://127.0.0.1:{port}'
    with (args.output/'server.log').open('w') as log:
        server=subprocess.Popen([str(ROOT/'node_modules/.bin/vite'),'--config','tests/vite-trade-location.config.ts','--host','127.0.0.1','--port',str(port),'--strictPort'],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
        try:
            deadline=time.monotonic()+30
            while True:
                try:
                    with urlopen(base,timeout=1):break
                except OSError:
                    if server.poll() is not None or time.monotonic()>deadline:raise RuntimeError('server not ready')
                    time.sleep(.1)
            results=[]
            with sync_playwright() as p:
                for name in args.browsers.split(','):
                    browser=getattr(p,name).launch(headless=True)
                    try:
                        for width in map(int,args.widths.split(',')):
                            result=run_case(browser,name,base,width,args.output);results.append(result);print(json.dumps(result),flush=True)
                    finally:browser.close()
            after_hashes=source_hashes()
            assert before_hashes==after_hashes,'source changed during run'
            (args.output/'results.json').write_text(json.dumps({'cases':results,'passed':True,'sourceHashes':after_hashes,'sourceUnchanged':True},indent=2))
        finally:
            server.terminate()
            try:server.wait(timeout=5)
            except subprocess.TimeoutExpired:server.kill();server.wait()


if __name__=='__main__':main()
