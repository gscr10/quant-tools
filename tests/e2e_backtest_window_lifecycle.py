#!/usr/bin/env python3
"""Real Vela, PineEngine/Worker and mounted window UI lifecycle.

Fresh deterministic provider bars isolate window execution from exchange
availability. This is integration evidence, not reference parity evidence.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path

from playwright.sync_api import sync_playwright
from e2e_simulation_components import serve

ROOT = Path(__file__).resolve().parents[1]
SETUP = r'''async engineName => {
  await import('/src/style.css');
  const {VelaWorkspace}=await import('/node_modules/@luxalgo/vela/dist/workspace.js');
  const {sharedBarStore}=await import('/node_modules/@luxalgo/vela/dist/index.js');
  const engines=await import('/packages/vela-pinets/dist/index.js');
  const {guardProviderHistory}=await import('/src/integrations/vela/provider-history.ts');
  const {installVelaHistoryResilience}=await import('/src/integrations/vela/history-resilience.ts');
  const {observeWorkspaceHistory}=await import('/src/integrations/vela/workspace-history-observer.ts');
  const {installDefaultTimeframeSwitchPolicy}=await import('/src/integrations/vela/timeframe-switch-policy.ts');
  const {mountBacktestFeature}=await import('/src/app/backtest-feature.ts');
  sharedBarStore.clear();installVelaHistoryResilience();
  const now=Date.now(), day=86400000,start=Math.floor((now-120*day)/day)*day;
  const records=[],events=[],errors=[],pending=[];
  const state={fault:'none',held:0};
  const dataset=tf=>{const step=Number(tf)*60000;const end=Math.floor(now/step)*step;
    const price=time=>100+Math.floor((time-start)/day)*.01+(time%day)/60000*.001;
    return Array.from({length:Math.floor((end-start)/step)+1},(_,i)=>{const time=start+i*step;
      const open=price(time),last=price(time+step-60000);
      return {time,open,high:last+1,low:open-1,close:last+.1,volume:step/60000};});};
  const provider=guardProviderHistory({
    listSymbols:async()=>[{ticker:'BTCUSDT',type:'crypto'}],
    getSymbolInfo:async()=>({ticker:'BTCUSDT',type:'crypto',currency:'USD',mintick:.01,pricescale:100}),
    getBars:async(ticker,tf,range={})=>{records.push({ticker,tf,...range});
      if(state.fault==='error')throw Error('Controlled window HTTP 503');
      if(state.fault==='hold-once'){state.fault='none';state.held++;
        await new Promise(resolve=>pending.push(resolve));}
      const all=dataset(tf).filter(b=>(range.from==null||b.time>=range.from)&&(range.to==null||b.time<=range.to));
      return range.limit==null?all:all.slice(-range.limit);},subscribe:()=>()=>{}
  },'binance');
  const engine=new engines[engineName](), execute=engine.execute.bind(engine);
  const executions=[];
  engine.execute=(request,handlers)=>{executions.push({tf:request.market.timeframe,count:request.bars.length,
    first:request.bars[0]?.time,last:request.bars.at(-1)?.time});return execute(request,handlers);};
  const ws=new VelaWorkspace(document.querySelector('#ws'),{layout:'1',persist:false,live:false,
    providers:{binance:()=>provider},engines:{pine:()=>engine},
    cells:{window:{symbol:'binance:BTCUSDT',timeframe:'15',bars:2000}}});
  const stopHistory=observeWorkspaceHistory(ws),stopPolicy=installDefaultTimeframeSwitchPolicy(ws,2000);
  const feature=mountBacktestFeature(ws,{host:document.querySelector('#bt'),
    onDiagnostic:(message,error)=>errors.push({message,error:String(error??'')})});
  const chart=ws.active.chart; await chart.ready();await chart.historyComplete();
  const source='//@version=6\nstrategy("Window lifecycle",initial_capital=100000,default_qty_type=strategy.fixed,default_qty_value=1)\nif bar_index % 20 == 1\n    strategy.entry("L",strategy.long)\nif bar_index % 20 == 10\n    strategy.close("L")';
  const handle=chart.addIndicator(source,{language:'pine'});
  const snap=()=>{const s=feature.controller.getSnapshot();return s?{key:s.key,status:s.status,runId:s.runId,
    revision:s.revision,window:s.window,metrics:s.metrics,trades:s.trades,history:s.history,
    canSimulate:s.capabilities?.canSimulate,precision:s.execution?.precision,error:s.error}:null;};
  const unsubscribe=feature.controller.subscribe(s=>events.push(s?{status:s.status,runId:s.runId,
    window:s.window,canSimulate:s.capabilities?.canSimulate,trades:s.trades?.length,error:s.error}:null));
  window.__windowLifecycle={state,chart,feature,ws,handle,records,errors,events,executions,
    snap,capture:()=>({snapshot:snap(),market:chart.market,records,errors,events,executions}),
    addSecond:()=>chart.addIndicator(source.replace('Window lifecycle','Window second'),{language:'pine'}).id,
    reports:()=>feature.controller.listReports().map(s=>({key:s.key,status:s.status,runId:s.runId,window:s.window,
      trades:s.trades?.length,canSimulate:s.capabilities?.canSimulate})),
    release:()=>pending.splice(0).forEach(resolve=>resolve()),
    dispose:()=>{pending.splice(0).forEach(resolve=>resolve());unsubscribe();feature.destroy();stopPolicy();stopHistory();ws.destroy();engine.terminate?.();}};
  const iso=t=>new Date(t).toISOString().slice(0,10);
  return {now,from:iso(now-70*day),to:iso(now-60*day),secondFrom:iso(now-50*day),secondTo:iso(now-40*day)};
}'''


def run(args):
    args.output.mkdir(parents=True, exist_ok=True)
    results = {'cases': [], 'pageErrors': []}
    with serve(args.base_url, args.output/'runtime') as base, sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            for engine in ['PineEngine', 'PineWorkerEngine']:
                page = browser.new_page(viewport={'width':1440,'height':900}, timezone_id='UTC')
                page.set_default_timeout(45000)
                page.on('pageerror',lambda error: results['pageErrors'].append(str(error)))
                page.route('**/__window_lifecycle__',lambda route:route.fulfill(content_type='text/html',body='''<!doctype html>
                  <body style="margin:0"><div id="ws" style="height:900px"></div><div id="bt"></div></body>'''))
                case = {'engine':engine,'checks':[],'captures':{}}
                results['cases'].append(case)
                def check(name, value):
                    case['checks'].append({'name':name,'passed':bool(value)})
                def ready():
                    page.wait_for_function("['ready','no-trades','open-only'].includes(window.__windowLifecycle.snap()?.status)")
                    return page.evaluate('__windowLifecycle.capture()')
                def preset(key):
                    page.locator('.quant-backtest-window-button').click()
                    page.locator('[data-window-preset="'+key+'"]').click()
                def custom(start,end):
                    page.locator('.quant-backtest-window-button').click()
                    page.get_by_label('Backtest start date',exact=True).fill(start)
                    page.get_by_label('Backtest end date',exact=True).fill(end)
                    page.locator('.quant-backtest-window-apply').click()
                def precision(label):
                    page.get_by_role('button',name='Open strategy settings',exact=True).click()
                    settings=page.locator('.quant-backtest-settings')
                    settings.get_by_role('tab',name='Properties',exact=True).click()
                    settings.get_by_role('combobox',name='Backtest precision',exact=True).click()
                    settings.get_by_role('listbox',name='Backtest precision',exact=True).get_by_role('option',name=label,exact=True).click()
                    settings.locator('.quant-backtest-settings-actions .quant-backtest-button-primary').click()
                    settings.wait_for(state='hidden')
                try:
                    page.goto(base+'/__window_lifecycle__')
                    dates=page.evaluate(SETUP,engine)
                    initial=ready();case['captures']['initial']=initial
                    check('default engine receives 2000 candles',initial['executions'][-1]['count']==2000)
                    custom(dates['from'],dates['to'])
                    first=ready();case['captures']['custom']=first
                    start=int(datetime.fromisoformat(dates['from']).replace(tzinfo=timezone.utc).timestamp()*1000)
                    end=int(datetime.fromisoformat(dates['to']).replace(tzinfo=timezone.utc).timestamp()*1000)+86400000-1
                    check('custom reruns a distinct ledger',first['snapshot']['runId']!=initial['snapshot']['runId'])
                    check('custom executes requested old dates',first['executions'][-1]['first']>=start and first['executions'][-1]['last']<=end)
                    check('custom is not recent viewport filtering',first['executions'][-1]['last']<initial['executions'][-1]['first'])
                    check('custom report exposes selected dates',first['snapshot'].get('window',{}).get('preset')=='custom')
                    second_id=page.evaluate('__windowLifecycle.addSecond()')
                    page.wait_for_function("id=>__windowLifecycle.reports().some(r=>r.key.indicatorId===id&&r.status==='ready')",arg=second_id)
                    reports=page.evaluate('__windowLifecycle.reports()');case['captures']['addedStrategy']=reports
                    check('new strategy inherits active chart window metadata',all((r.get('window') or {}).get('preset')=='custom' for r in reports))
                    page.evaluate("__windowLifecycle.state.fault='hold-once';void __windowLifecycle.chart.setMarket({timeframe:'60'})")
                    page.wait_for_function('__windowLifecycle.state.held===1')
                    held_tf=page.evaluate('__windowLifecycle.reports()');case['captures']['heldTimeframe']=held_tf
                    check('timeframe wait disables every strategy report',all(r['status'] not in ['ready','no-trades','open-only'] and not r['canSimulate'] for r in held_tf))
                    page.evaluate('__windowLifecycle.release()')
                    hourly=ready();case['captures']['hourly']=hourly
                    check('timeframe switch keeps dates and reruns at hourly',hourly['executions'][-1]['tf']=='60' and hourly['executions'][-1]['first']>=start and hourly['executions'][-1]['last']<=end)
                    check('window remains visible after timeframe switch',hourly['snapshot'].get('window',{}).get('preset')=='custom')
                    precision('High precision')
                    page.wait_for_function('__windowLifecycle.snap()?.precision?.requested===true')
                    high=ready();case['captures']['highPrecision']=high
                    check('high precision preserves the selected date window',(high['snapshot'].get('window') or {}).get('preset')=='custom')
                    check('high precision uses lower candles',(high['snapshot'].get('precision') or {}).get('appliedPrecision')=='lower-timeframe')
                    precision('Default precision')
                    page.wait_for_function('__windowLifecycle.snap()?.precision?.requested===false')
                    ready()
                    preset('1M');monthly=ready();case['captures']['monthly']=monthly
                    check('monthly report has requested window',monthly['snapshot'].get('window',{}).get('preset')=='1M')
                    check('monthly range includes more days than custom',monthly['executions'][-1]['count']>hourly['executions'][-1]['count'])
                    page.evaluate("__windowLifecycle.state.fault='hold-once'")
                    custom(dates['secondFrom'],dates['secondTo'])
                    page.wait_for_function('__windowLifecycle.state.held===2')
                    during=page.evaluate('__windowLifecycle.snap()');case['captures']['held']=during
                    check('held request hides old readiness and Simulation',during['status'] not in ['ready','no-trades','open-only'] and not during['canSimulate'])
                    preset('1M');latest=ready()
                    page.evaluate('__windowLifecycle.release()')
                    page.wait_for_timeout(150)
                    after=page.evaluate('__windowLifecycle.capture()');case['captures']['superseded']=after
                    check('late old window cannot overwrite newer selection',after['snapshot'].get('window',{}).get('preset')=='1M' and after['snapshot']['runId']==latest['snapshot']['runId'])
                    page.evaluate("__windowLifecycle.state.fault='error'")
                    custom(dates['from'],dates['to'])
                    page.wait_for_function("__windowLifecycle.snap()?.status==='error'")
                    failed=page.evaluate('__windowLifecycle.snap()');case['captures']['failed']=failed
                    check('current provider failure is visible with Simulation disabled',bool(failed.get('error')) and not failed['canSimulate'])
                    page.evaluate("__windowLifecycle.state.fault='none'")
                    page.evaluate('__windowLifecycle.feature.workbench.openViewer()')
                    page.get_by_role('button',name='Try again',exact=True).click()
                    recovered=ready();case['captures']['recovered']=recovered
                    check('visible Retry reruns failed window',recovered['snapshot'].get('window',{}).get('preset')=='custom' and not recovered['snapshot'].get('error'))
                    page.evaluate('__windowLifecycle.feature.workbench.closeViewer()')
                    preset('default');restored=ready();case['captures']['restored']=restored
                    check('default restores latest 2000 candles',restored['executions'][-1]['count']==2000 and not restored['snapshot'].get('window'))
                    page.screenshot(path=str(args.output/(engine+'.png')))
                finally:
                    if page.evaluate('Boolean(window.__windowLifecycle)'):
                        case['final']=page.evaluate('__windowLifecycle.capture()')
                        page.evaluate('__windowLifecycle.dispose()')
                    page.close()
        finally:
            browser.close()
            (args.output/'results.json').write_text(json.dumps(results,indent=2))
    assert not results['pageErrors'],results['pageErrors']
    failures=[{'engine':case['engine'],'check':check['name']} for case in results['cases'] for check in case['checks'] if not check['passed']]
    assert not failures,failures
    print(json.dumps({'engines':len(results['cases']),'checks':[len(c['checks']) for c in results['cases']],'pageErrors':results['pageErrors']}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url')
    parser.add_argument('--output',type=Path,default=ROOT/'audit-evidence/backtest-window-lifecycle')
    run(parser.parse_args())
