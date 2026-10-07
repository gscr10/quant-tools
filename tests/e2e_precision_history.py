#!/usr/bin/env python3
"""Real PineEngine/PineWorkerEngine + Viewer historical precision boundaries.

Controlled input, independent fill oracle: each one-unit long enters at 100;
parent OHLC hits 105 before 95, whereas complete children hit 95 before 105.
No recorded app screenshot or engine result is used as the expected value.
"""
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

SETUP = r'''async ({engineName, mode}) => {
  await import('/src/features/backtesting/backtest.css');
  const {VelaWorkspace}=await import('/node_modules/@luxalgo/vela/dist/workspace.js');
  const engines=await import('/packages/vela-pinets/dist/index.js');
  const {guardProviderHistory}=await import('/src/integrations/vela/provider-history.ts');
  const {installVelaHistoryResilience}=await import('/src/integrations/vela/history-resilience.ts');
  const {observeWorkspaceHistory}=await import('/src/integrations/vela/workspace-history-observer.ts');
  const {mountBacktestFeature}=await import('/src/app/backtest-feature.ts');
  const {sharedBarStore}=await import('/node_modules/@luxalgo/vela/dist/index.js');
  sharedBarStore.clear();installVelaHistoryResilience();
  const engine=new engines[engineName](), execute=engine.execute.bind(engine);
  const start=Date.UTC(2024,0,1),hour=3600000,step=600000,total=mode==='history-cap'?2000:20;
  const end=start+total*hour, cutoff=mode==='forming'?end-1:end;
  engine.execute=(request,handlers)=>execute({...request,
    barMagnifier:{...(request.barMagnifier??{}),asOf:cutoff}},handlers);
  const parents=Array.from({length:total},(_,index)=>({time:start+index*hour,open:100,
    high:index%5===2?110:101,low:index%5===2?80:99,close:100,volume:6}));
  let children=Array.from({length:total*6},(_,index)=>{
    const p=Math.floor(index/6),slot=index%6;
    const prices=p%5!==2?[100,101,99,100]:slot===0?[100,101,94,96]
      :slot===1?[96,110,96,105]:slot===2?[105,106,80,100]:[100,101,99,100];
    return {time:start+index*step,open:prices[0],high:prices[1],low:prices[2],close:prices[3],volume:1};
  });
  for(let p=0;p<parents.length;p++){
    const cs=children.slice(p*6,p*6+6),parent=parents[p];
    if(cs[0].open!==parent.open||Math.max(...cs.map(b=>b.high))!==parent.high
      ||Math.min(...cs.map(b=>b.low))!==parent.low||cs.at(-1).close!==parent.close)
      throw Error('parent/child OHLC mismatch');
  }
  if(mode==='history-cap')children=children.slice(-5000);
  if(mode==='inclusive-future')children.push({time:end,open:100,high:1000000,low:0,close:50,volume:1});
  const calls=[],errors=[];
  const provider=guardProviderHistory({
    listSymbols:async()=>[{ticker:'BTC',type:'futures'}],
    getSymbolInfo:async()=>({ticker:'BTC',type:'futures',currency:'USD',mintick:.01,pricescale:100}),
    getBars:async(_symbol,tf,range={})=>{
      calls.push({tf,...range});
      let rows=(tf==='60'?parents:tf==='10'?children:[])
        .filter(b=>(range.from==null||b.time>=range.from)&&(range.to==null||b.time<=range.to));
      if(range.limit!=null)rows=rows.slice(-range.limit);
      return rows;
    },subscribe:()=>()=>{},
  },'hyperliquid');
  const ws=new VelaWorkspace(document.querySelector('#ws'),{layout:'1',persist:false,live:false,
    providers:{hyperliquid:()=>provider},engines:{pine:()=>engine},
    cells:{precision:{symbol:'hyperliquid:BTC',timeframe:'60',bars:total}}});
  const stop=observeWorkspaceHistory(ws);
  const feature=mountBacktestFeature(ws,{host:document.querySelector('#bt'),
    onDiagnostic:(message,error)=>errors.push({message,error:String(error??'')})});
  const project=()=>{const s=feature.controller.getSnapshot();return s?{status:s.status,
    history:s.history,trades:s.trades,canSimulate:s.capabilities?.canSimulate,
    precision:s.execution?.precision}:null};
  window.__historyPrecision={project,open:()=>feature.workbench.openViewer(),
    capture:()=>({report:project(),errors,calls,labels:[...document.querySelectorAll('[data-execution-precision]')]
      .filter(e=>e.offsetWidth||e.offsetHeight||e.getClientRects().length)
      .map(e=>({text:e.textContent,title:e.title,fallback:e.dataset.executionFallback,
        reason:e.dataset.executionFallbackReason}))}),
    dispose:()=>{feature.destroy();stop();ws.destroy();engine.terminate?.();
      return {canvas:document.querySelectorAll('#ws canvas').length,
        dialogs:document.querySelectorAll('[role=dialog]').length};}};
  ws.active.chart.addIndicator('//@version=6\nstrategy("Independent historical precision", initial_capital=100000, default_qty_type=strategy.fixed, default_qty_value=1, use_bar_magnifier=true)\nif bar_index % 5 == 0\n    strategy.entry("L", strategy.long)\nif bar_index >= 1\n    strategy.exit("X", "L", stop=95, limit=105)',{language:'pine'});
  return {total,childRows:children.length,cutoff,expectedTrades:total/5,
    expectedCoverage:mode==='history-cap'?833/2000:mode==='forming'?19/20:1,
    expectedCovered:mode==='history-cap'?833:mode==='forming'?19:20,
    expectedExit:mode==='history-cap'||mode==='forming'?105:95,
    expectedReason:mode==='history-cap'?'partial-lower-coverage':mode==='forming'?'forming-lower-bar':null};
}'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'audit-evidence/2026-10-07-precision-history')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    result = {'cases': [], 'pageErrors': [], 'externalRequests': [],
              'sourceSha256': {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                               for path in [ROOT/'packages/pinets/src/PineTS.class.ts',
                                            ROOT/'packages/pinets/src/types/ExecutionPrecision.ts',
                                            ROOT/'packages/vela-pinets/src/pinets/runtime.ts']}}
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    with (args.output/'server.log').open('w') as log:
        server = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--config',
                                   'tests/vite-provider.config.ts', '--host', '127.0.0.1',
                                   '--port', str(port), '--strictPort'], cwd=ROOT, stdout=log,
                                  stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic()+30
            while True:
                if server.poll() is not None:
                    raise RuntimeError('Vite stopped before readiness')
                try:
                    with urlopen(base, timeout=1):
                        break
                except OSError:
                    if time.monotonic()>deadline:
                        raise RuntimeError('Vite readiness timeout')
                    time.sleep(.1)
            with sync_playwright() as p:
                browser = p.chromium.launch()
                try:
                    for engine in ['PineEngine', 'PineWorkerEngine']:
                        for mode in ['forming', 'closed', 'history-cap', 'inclusive-future']:
                            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                            page.on('pageerror', lambda error: result['pageErrors'].append(str(error)))
                            page.on('request', lambda req: result['externalRequests'].append(req.url)
                                    if req.url.startswith(('http:', 'https:')) and not req.url.startswith(base) else None)
                            item = {'engine': engine, 'mode': mode}
                            result['cases'].append(item)
                            try:
                                page.goto(base+'/tests/fixtures/history-live.html', wait_until='domcontentloaded')
                                page.evaluate("document.body.insertAdjacentHTML('beforeend','<div id=bt></div>')")
                                oracle = page.evaluate(SETUP, {'engineName': engine, 'mode': mode})
                                page.wait_for_function("window.__historyPrecision.project()?.status==='ready'", timeout=30000)
                                page.evaluate('window.__historyPrecision.open()')
                                page.wait_for_function("[...document.querySelectorAll('[data-execution-precision]')].some(e=>e.getBoundingClientRect().height>0)")
                                page.evaluate('() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                                actual = page.evaluate('window.__historyPrecision.capture()')
                                item.update(oracle=oracle, actual=actual)
                                report = actual['report']
                                precision = report['precision']
                                assert report['history']['complete'] and report['canSimulate'], report
                                assert precision['coverage'] == oracle['expectedCoverage'], precision
                                assert precision['coveredParentBars'] == oracle['expectedCovered'], precision
                                assert precision['applied'] == (oracle['expectedReason'] is None), precision
                                assert precision.get('fallbackReason') == oracle['expectedReason'], precision
                                closed = [trade for trade in report['trades'] if trade['status'] == 'closed']
                                assert len(closed) == oracle['expectedTrades'], len(closed)
                                for index, trade in enumerate(closed):
                                    assert trade['entryPrice'] == 100 and trade['exitPrice'] == oracle['expectedExit'], trade
                                    assert trade['size'] == 1 and trade['netPnl'] == oracle['expectedExit']-100, trade
                                    assert trade['entryBar'] == index*5+1 and trade['exitBar'] == index*5+2, trade
                                assert actual['labels'] and not actual['errors'], actual
                                for label in actual['labels']:
                                    assert label['fallback'] == str(oracle['expectedReason'] is not None).lower(), label
                                    if oracle['expectedReason']:
                                        assert label['reason'] == oracle['expectedReason'], label
                                if mode == 'forming':
                                    assert all('lower bar still forming' in label['text'] for label in actual['labels'])
                                if mode == 'history-cap':
                                    assert all('41.7%' in label['text'] and '833/2000' in label['title']
                                               and '5000 lower bars' in label['title'] for label in actual['labels']), actual['labels']
                                image_path = args.output/f'{engine}-{mode}.png'
                                page.screenshot(path=str(image_path))
                                item.update(pass_=True, screenshot=image_path.name)
                            except Exception as error:
                                item.update(pass_=False, error=str(error))
                                page.screenshot(path=str(args.output/f'{engine}-{mode}-failed.png'))
                            finally:
                                item['cleanup'] = page.evaluate('window.__historyPrecision?.dispose()')
                                page.close()
                finally:
                    browser.close()
        finally:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
    (args.output/'results.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({'cases': [{k: c.get(k) for k in ['engine', 'mode', 'pass_', 'error', 'cleanup']}
                                 for c in result['cases']], 'pageErrors': result['pageErrors'],
                      'externalRequests': result['externalRequests']}, indent=2))
    if result['pageErrors'] or result['externalRequests'] or len(result['cases']) != 8 or not all(
            case.get('pass_') and case.get('cleanup') == {'canvas': 0, 'dialogs': 0} for case in result['cases']):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
