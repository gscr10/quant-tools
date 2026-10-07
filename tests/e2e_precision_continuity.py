#!/usr/bin/env python3
"""Real engines + guarded provider/cache + Viewer: child/parent gap isolation.

The independent fill oracle is four one-unit longs entered at 100. Parent OHLC
visits 110 before 80, hitting the 105 target first (+5). Complete 10m children
visit 94 before 110, hitting the 95 stop first (-5). Both paths aggregate to
exactly the same 1h OHLC. Missing data is never filled with invented candles.
"""
import json
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'audit-evidence/2026-10-07-precision-continuity'

SETUP = r'''async ({engineName, mode}) => {
  await import('/src/features/backtesting/backtest.css');
  const {VelaWorkspace}=await import('/node_modules/@luxalgo/vela/dist/workspace.js');
  const engines=await import('/packages/vela-pinets/dist/index.js');
  const {guardProviderHistory}=await import('/src/integrations/vela/provider-history.ts');
  const {installVelaHistoryResilience}=await import('/src/integrations/vela/history-resilience.ts');
  const {observeWorkspaceHistory}=await import('/src/integrations/vela/workspace-history-observer.ts');
  const {mountBacktestFeature}=await import('/src/app/backtest-feature.ts');
  const {sharedBarStore}=await import('/node_modules/@luxalgo/vela/dist/index.js');
  sharedBarStore.clear(); installVelaHistoryResilience();
  const engine=new engines[engineName]();
  const start=Date.UTC(2026,8,1), hour=3600000, childStep=600000, total=20;
  const parents=Array.from({length:total},(_,i)=>({time:start+i*hour,open:100,
    high:i%5===2?110:101,low:i%5===2?80:99,close:100,volume:6}));
  const children=Array.from({length:total*6},(_,i)=>{
    const p=Math.floor(i/6), slot=i%6;
    const ohlc=p%5!==2?[100,101,99,100]:slot===0?[100,101,94,96]
      :slot===1?[96,110,96,105]:slot===2?[105,106,80,100]:[100,101,99,100];
    return {time:start+i*childStep,open:ohlc[0],high:ohlc[1],low:ohlc[2],close:ohlc[3],volume:1};
  });
  // Verify the controlled input independently before passing it to the engine.
  for(let p=0;p<parents.length;p++){
    const cs=children.slice(p*6,p*6+6), parent=parents[p];
    if(cs[0].open!==parent.open||Math.max(...cs.map(b=>b.high))!==parent.high
      ||Math.min(...cs.map(b=>b.low))!==parent.low||cs.at(-1).close!==parent.close)
      throw Error('invalid independent parent/child aggregation at '+p);
  }
  let phase=mode;
  const calls=[],samples=[],diagnostics=[];
  const missingChild=start+12*childStep, missingParent=start+10*hour;
  const provider=guardProviderHistory({
    listSymbols:async()=>[{ticker:'BTCUSDT',type:'crypto'}],
    getSymbolInfo:async()=>({ticker:'BTCUSDT',type:'crypto',currency:'USD',mintick:.01,pricescale:100}),
    getBars:async(_symbol,tf,range={})=>{
      calls.push({tf,phase,...range});
      if(tf==='10'&&phase==='http'){
        const response=await fetch('/precision-child-feed?case=http');
        if(!response.ok)throw Object.assign(new Error(`HTTP ${response.status} lower timeframe unavailable`),{status:response.status});
      }
      if(tf==='10'&&phase==='empty')return [];
      const source=tf==='60'?parents:tf==='10'?children:[];
      let result=source.filter(b=>(range.from==null||b.time>=range.from)&&(range.to==null||b.time<=range.to));
      if(range.limit!=null)result=result.slice(-range.limit);
      if(tf==='60'&&phase==='parent-gap')result=result.filter(b=>b.time!==missingParent);
      const narrow=range.from===missingChild&&range.to<=missingChild+childStep-1;
      if(tf==='10'&&(phase==='unresolved'||phase==='repair'&&!narrow))result=result.filter(b=>b.time!==missingChild);
      if(tf==='10'&&phase==='tail')result=result.filter(b=>b.time!==children.at(-1).time);
      return result;
    },subscribe:()=>()=>{},
  },'binance');
  const ws=new VelaWorkspace(document.querySelector('#ws'),{layout:'1',persist:false,live:false,
    providers:{binance:()=>provider},engines:{pine:()=>engine},
    cells:{test:{symbol:'binance:BTCUSDT',timeframe:'60',bars:total}}});
  const stop=observeWorkspaceHistory(ws);
  const feature=mountBacktestFeature(ws,{host:document.querySelector('#bt'),
    onDiagnostic:(message,error)=>diagnostics.push({message,error:String(error??'')})});
  const project=()=>{const s=feature.controller.getSnapshot();return s?{status:s.status,runId:s.runId,
    history:s.history,trades:s.trades,canSimulate:s.capabilities?.canSimulate,error:s.error,
    precision:s.execution?.precision}:null};
  const capture=()=>({phase,report:project(),labels:[...document.querySelectorAll('[data-execution-precision]')].map(e=>({
    text:e.textContent,title:e.title,visible:!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length),
    precision:e.dataset.executionPrecision,fallback:e.dataset.executionFallback,reason:e.dataset.executionFallbackReason})),
    calls:[...calls],samples:[...samples],diagnostics:[...diagnostics]});
  const timer=setInterval(()=>samples.push({phase,...project()}),20);
  window.__precision={project,capture,setPhase:value=>{phase=value;},
    openViewer:()=>feature.workbench.openViewer(),closeViewer:()=>feature.workbench.closeViewer(),
    dispose:()=>{clearInterval(timer);feature.destroy();stop();ws.destroy();engine.terminate?.();}};
  const source='//@version=6\nstrategy("Independent precision continuity", initial_capital=100000, default_qty_type=strategy.fixed, default_qty_value=1, use_bar_magnifier=true)\nif bar_index % 5 == 0\n    strategy.entry("L", strategy.long)\nif bar_index >= 1\n    strategy.exit("X", "L", stop=95, limit=105)';
  ws.active.chart.addIndicator(source,{language:'pine'});
  return {parentBars:parents.length,childBars:children.length,missingChild,missingParent,
    oracle:{closedTrades:4,entry:100,defaultExit:105,defaultPnl:20,highPrecisionExit:95,highPrecisionPnl:-20}};
}'''


def wait_ready(page):
    page.wait_for_function("window.__precision.project()?.status === 'ready'", timeout=20000)


def toggle_precision(page, value):
    page.evaluate('window.__precision.closeViewer()')
    page.locator('[aria-label="Open strategy settings"]').click()
    settings = page.locator('.quant-backtest-settings')
    settings.get_by_role('tab', name='Properties').click()
    settings.locator('[data-setting-key="use_bar_magnifier"] select').select_option(str(value).lower())
    settings.locator('.quant-backtest-settings-actions .quant-backtest-button-primary').click()
    settings.wait_for(state='hidden')
    page.wait_for_function('(value) => { const r=window.__precision.project(); return r?.status === "ready" && r.precision?.requested===value; }', arg=value)
    page.evaluate('window.__precision.openViewer()')


def check_fills(report, price):
    closed = [t for t in report['trades'] if t.get('status') == 'closed']
    assert len(closed) == 4, closed
    for index, trade in enumerate(closed):
        assert trade['entryPrice'] == 100 and trade['exitPrice'] == price, trade
        assert trade['size'] == 1 and trade['netPnl'] == price - 100, trade
        assert trade['entryBar'] == 1 + 5 * index and trade['exitBar'] == 2 + 5 * index, trade
    assert sum(t['netPnl'] for t in closed) == 4 * (price - 100)


def run_case(page, engine, mode):
    input_facts = page.evaluate(SETUP, {'engineName': engine, 'mode': mode})
    result = {'engine': engine, 'mode': mode, 'inputs': input_facts}
    if mode == 'parent-gap':
        page.wait_for_function("window.__precision.project()?.history?.reason === 'aborted'", timeout=20000)
        page.evaluate('window.__precision.openViewer()')
        before = page.evaluate('window.__precision.capture()')
        result['initial'] = before
        report = before['report']
        assert report['status'] != 'ready' and not report['canSimulate'] and not report['history']['complete'], report
        assert all(s.get('status') != 'ready' and not s.get('canSimulate') for s in before['samples']), before['samples']
        page.screenshot(path=str(OUT / f'{engine}-{mode}-initial.png'))
        page.evaluate("window.__precision.setPhase('healthy')")
        page.get_by_role('button', name='Try again').click()
        wait_ready(page)
    else:
        wait_ready(page)
        page.evaluate('window.__precision.openViewer()')
        before = page.evaluate('window.__precision.capture()')
        result['initial'] = before
        report = before['report']
        assert report['history']['complete'] and report['canSimulate'], report
        precision = report['precision']
        assert precision['requested'] and precision['lowerTimeframe'] == '10', precision
        labels = [label for label in before['labels'] if label['visible']]
        assert labels, before
        if mode == 'repair':
            assert precision['applied'] and precision['coverage'] == 1, precision
            assert any(c.get('from') == input_facts['missingChild'] for c in before['calls']), before['calls']
            assert all(label['fallback'] == 'false' for label in labels), labels
            check_fills(report, 95)
        else:
            assert not precision['applied'] and precision['appliedPrecision'] == 'chart-ohlc', precision
            reason = 'lower-data-empty' if mode == 'empty' else 'partial-lower-coverage' if mode == 'tail' else 'lower-data-unavailable'
            assert precision.get('fallbackReason') == reason, precision
            assert all(label['fallback'] == 'true' and label['reason'] == reason
                       and reason.replace('-', ' ') in label['text'].lower() for label in labels), labels
            check_fills(report, 105)
        page.screenshot(path=str(OUT / f'{engine}-{mode}-initial.png'))
        toggle_precision(page, False)
        normal = page.evaluate('window.__precision.capture()')
        result['default'] = normal
        assert not normal['report']['precision']['requested'], normal['report']
        assert all(label['fallback'] == 'false' and label.get('reason') in (None, 'not-requested')
                   for label in normal['labels']), normal['labels']
        check_fills(normal['report'], 105)
        page.evaluate("window.__precision.setPhase('healthy')")
        toggle_precision(page, True)

    after = page.evaluate('window.__precision.capture()')
    result['recovered'] = after
    report = after['report']
    assert report['precision']['applied'] and report['precision']['coverage'] == 1, report
    assert report['history']['complete'] and report['canSimulate'], report
    assert not report['precision'].get('fallbackReason'), report['precision']
    assert all(label['fallback'] == 'false' and not label.get('reason') for label in after['labels']), after['labels']
    check_fills(report, 95)
    if mode != 'repair':
        assert any(c['phase'] == 'healthy' and c['tf'] == '10' for c in after['calls']), after['calls']
    page.screenshot(path=str(OUT / f'{engine}-{mode}-recovered.png'))
    result['passed'] = True
    return result


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with socket.socket() as port_socket:
        port_socket.bind(('127.0.0.1', 0))
        port = port_socket.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    results = []
    with (OUT/'server.log').open('w') as log:
        process = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--config',
            'tests/vite-performance.config.ts', '--host', '127.0.0.1', '--port', str(port), '--strictPort'],
            cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic()+30
            while True:
                if process.poll() is not None:
                    raise RuntimeError('Vite exited before readiness')
                try:
                    with urlopen(base, timeout=1):
                        break
                except OSError:
                    if time.monotonic() > deadline:
                        raise TimeoutError('Vite readiness')
                    time.sleep(.1)
            with sync_playwright() as p:
                browser = p.chromium.launch()
                try:
                    for engine in ('PineEngine', 'PineWorkerEngine'):
                        for mode in ('repair', 'unresolved', 'http', 'empty', 'tail', 'parent-gap'):
                            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                            errors = []
                            http_responses = []
                            page.on('pageerror', lambda error: errors.append(str(error)))
                            page.on('response', lambda response: http_responses.append({'url': response.url, 'status': response.status})
                                    if '/precision-child-feed?' in response.url else None)
                            page.route('**/precision-child-feed?*', lambda route: route.fulfill(status=503,
                                content_type='application/json', body='{"error":"controlled lower feed outage"}'))
                            page.route('**/precision-audit', lambda route: route.fulfill(content_type='text/html',
                                body='<html><body style="margin:0"><div id="ws" style="height:900px"></div><div id="bt"></div></body></html>'))
                            page.goto(base+'/precision-audit')
                            try:
                                result = run_case(page, engine, mode)
                                assert not errors, errors
                                if mode == 'http':
                                    assert http_responses and all(response['status'] == 503 for response in http_responses), http_responses
                            except Exception as error:
                                result = {'engine': engine, 'mode': mode, 'passed': False, 'error': str(error),
                                          'capture': page.evaluate('window.__precision?.capture()')}
                                page.screenshot(path=str(OUT/f'{engine}-{mode}-failure.png'))
                            finally:
                                result['pageErrors'] = errors
                                result['httpResponses'] = http_responses
                                results.append(result)
                                print(engine, mode, json.dumps({'passed': result['passed'], 'error': result.get('error')}), flush=True)
                                page.evaluate('window.__precision?.dispose()')
                                page.close()
                finally:
                    browser.close()
        finally:
            process.terminate()
            process.wait(timeout=10)
            (OUT/'results.json').write_text(json.dumps({'cases': results}, indent=2))
    assert len(results) == 12 and all(case['passed'] for case in results), 'Precision continuity gate failed'


if __name__ == '__main__':
    main()
