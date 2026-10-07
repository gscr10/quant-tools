#!/usr/bin/env python3
"""Real browser risk liquidation through both engines, the adapter and Viewer.

Expected economics are independent of engine output: a two-contract loss from
100 to 90 with 0.5 commission per contract costs 22; a ten-contract loss from
100 to 70 with 1 commission costs 320. The second case must close 48/7 via
margin and 22/7 via risk, without subtracting either quantity twice.
Entry controls separately require a requested quantity of 3 to become 2,
and a forbidden short entry to close an existing long 2 without reversing.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

SETUP = r'''async ({engineName, magnified, scenario}) => {
  await import('/src/features/backtesting/backtest.css');
  const {VelaWorkspace}=await import('/node_modules/@luxalgo/vela/dist/workspace.js');
  const engines=await import('/packages/vela-pinets/dist/index.js');
  const {guardProviderHistory}=await import('/src/integrations/vela/provider-history.ts');
  const {installVelaHistoryResilience}=await import('/src/integrations/vela/history-resilience.ts');
  const {observeWorkspaceHistory}=await import('/src/integrations/vela/workspace-history-observer.ts');
  const {mountBacktestFeature}=await import('/src/app/backtest-feature.ts');
  const {getReportChartResourceStats}=await import('/src/features/backtesting/highcharts-renderer.ts');
  const {sharedBarStore}=await import('/node_modules/@luxalgo/vela/dist/index.js');
  sharedBarStore.clear();installVelaHistoryResilience();
  const engine=new engines[engineName](), execute=engine.execute.bind(engine);
  const start=Date.UTC(2024,0,1),hour=3600000,step=600000;
  const entryControl=['position-cap','forbidden-direction'].includes(scenario);
  const margin=scenario==='margin-risk', low=entryControl?100:margin?70:90;
  const capital=margin?600:1000,qty=margin?10:2,fee=margin?1:.5;
  const parents=[{time:start,open:100,high:100,low:100,close:100,volume:6},
    {time:start+hour,open:100,high:100,low,close:low,volume:6},
    {time:start+2*hour,open:entryControl?100:110,high:entryControl?100:110,
      low:entryControl?100:110,close:entryControl?100:110,volume:6}];
  const children=parents.flatMap(parent=>[
    {...parent,volume:1},...Array.from({length:5},(_,i)=>({time:parent.time+(i+1)*step,
      open:parent.close,high:parent.close,low:parent.close,close:parent.close,volume:1}))]);
  for(let i=0;i<parents.length;i++){
    const child=children.slice(i*6,i*6+6),parent=parents[i];
    if(child[0].open!==parent.open||Math.max(...child.map(b=>b.high))!==parent.high
      ||Math.min(...child.map(b=>b.low))!==parent.low||child.at(-1).close!==parent.close)
      throw Error('parent/child OHLC mismatch');
  }
  const executionRequests=[];
  engine.execute=(request,handlers)=>{
    const effective={...request,barMagnifier:{...(request.barMagnifier??{}),asOf:start+3*hour}};
    const presence={};
    const field=(object,key,prefix='')=>{
      const path=prefix+key;
      presence[path]=!Object.hasOwn(object,key)?'absent':object[key]===undefined?'undefined':'value';
      return object[key]===undefined?null:structuredClone(object[key]);
    };
    const market={symbol:field(effective.market,'symbol','market.'),
      timeframe:field(effective.market,'timeframe','market.'),
      symbolInfo:field(effective.market,'symbolInfo','market.'),
      chartStyle:field(effective.market,'chartStyle','market.')};
    executionRequests.push({schemaVersion:1,request:{market,
      mode:field(effective,'mode'),historyState:field(effective,'historyState'),
      inputs:field(effective,'inputs'),props:field(effective,'props'),
      visibleRange:field(effective,'visibleRange'),barMagnifier:field(effective,'barMagnifier'),
      bars:structuredClone(effective.bars)},presence,
      callbacks:{getBars:typeof effective.getBars==='function',fetchSeries:typeof effective.fetchSeries==='function'},
      prepared:{language:effective.prepared.language,source:effective.prepared.token?.source??null,
        instanceId:effective.prepared.token?.instanceId??null}});
    return execute(effective,handlers);
  };
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
    cells:{risk:{symbol:'hyperliquid:BTC',timeframe:'60',bars:parents.length}}});
  const stop=observeWorkspaceHistory(ws);
  const feature=mountBacktestFeature(ws,{host:document.querySelector('#bt'),
    onDiagnostic:(message,error)=>errors.push({message,error:String(error??'')})});
  const header=`//@version=6
strategy('Independent risk browser', initial_capital=${capital}, margin_long=50,
    pyramiding=5, commission_type=strategy.commission.cash_per_contract,
    commission_value=${fee}, use_bar_magnifier=${magnified})
`;
  const body=entryControl?(scenario==='position-cap'?`
strategy.risk.max_position_size(2)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=3)
if bar_index == 1
    strategy.close('L')
`:`
strategy.risk.allow_entry_in(strategy.direction.long)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=2)
if bar_index == 1
    strategy.entry('S', strategy.short, qty=1)
`):`
strategy.risk.max_intraday_loss(${margin?100:20}, strategy.cash)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=${qty})
    strategy.order('unfilled', strategy.long, qty=1, limit=${margin?50:80})
if bar_index == 1
    strategy.entry('blocked', strategy.long, qty=1)
`;
  const source=header+body;
  const project=()=>{const s=feature.controller.getSnapshot();return s?{status:s.status,
    history:s.history,trades:s.trades,metrics:s.metrics,canSimulate:s.capabilities?.canSimulate,
    precision:s.execution?.precision}:null};
  let handle;
  window.__riskLiquidation={project,open:()=>feature.workbench.openViewer(),
    capture:async()=>({report:project(),errors,calls,executionRequests:structuredClone(executionRequests),
      raw:await handle.context(['strategy','trades','reportSeries','auditLedger']),
      labels:[...document.querySelectorAll('[data-execution-precision]')]
        .filter(e=>e.getBoundingClientRect().height>0)
        .map(e=>({text:e.textContent,title:e.title,fallback:e.dataset.executionFallback,
          reason:e.dataset.executionFallbackReason})),
      kpis:[...document.querySelectorAll('.quant-backtest-performance-kpi-bar .quant-backtest-kpi')]
        .map(e=>({label:e.querySelector('.quant-backtest-kpi-label')?.textContent,
          value:e.querySelector('.quant-backtest-kpi-value')?.textContent})),
      resources:getReportChartResourceStats()}),
    dispose:()=>{feature.destroy();stop();ws.destroy();engine.terminate?.();
      return {canvas:document.querySelectorAll('#ws canvas').length,
        dialogs:document.querySelectorAll('[role=dialog]').length,
        resources:getReportChartResourceStats()};}};
  await ws.active.chart.historyComplete();
  handle=ws.active.chart.addIndicator(source,{language:'pine'});
  return {source,parents,children,parameters:{capital,qty,fee,magnified,scenario}};
}'''


def near(actual, expected):
    assert isinstance(actual, (float, int)) and math.isclose(actual, expected, abs_tol=1e-9), (actual, expected)


def assert_result(actual, scenario, magnified):
    margin = scenario == 'margin-risk'
    entry_control = scenario in ['position-cap', 'forbidden-direction']
    report, raw = actual['report'], actual['raw']
    requests = actual['executionRequests']
    assert len(requests) == 1, requests
    effective = requests[0]
    assert effective['schemaVersion'] == 1 and effective['request']['mode'] == 'static', effective
    assert effective['request']['barMagnifier']['asOf'] == 1704078000000, effective
    assert all(field in effective['presence'] for field in [
        'market.symbolInfo', 'market.chartStyle', 'mode', 'historyState',
        'inputs', 'props', 'visibleRange', 'barMagnifier']), effective
    expected_net, expected_equity = (-2, 998) if entry_control else (-320, 280) if margin else (-22, 978)
    expected_qty, expected_exit = (2, 100) if entry_control else (10, 70) if margin else (2, 90)
    assert report['status'] == 'ready' and report['history']['complete'] and report['canSimulate'], report
    near(raw['strategy']['position'], 0)
    near(raw['strategy']['netPnl'], expected_net)
    near(raw['strategy']['equity'], expected_equity)
    for precision in [report['precision'], raw['executionPrecision']]:
        assert precision['applied'] == magnified and precision['requested'] == magnified, precision
        if magnified:
            near(precision['coverage'], 1)
            assert precision['coveredParentBars'] == 3, precision
    assert any(call['tf'] == '10' for call in actual['calls']) == magnified, actual['calls']
    assert actual['labels'] and all(label['fallback'] == 'false' for label in actual['labels']), actual['labels']
    assert not actual['errors'], actual['errors']
    trades = raw['trades']
    assert len(trades) == (2 if margin else 1), trades
    assert all(trade.get('exit') for trade in trades), trades
    near(sum(trade['qty'] for trade in trades), expected_qty)
    near(sum(trade['commission'] for trade in trades), 20 if margin else 2)
    near(sum(trade['pnl'] for trade in trades), expected_net)
    for trade in trades:
        near(trade['entry']['price'], 100)
        near(trade['exit']['price'], expected_exit)
        assert trade['entryBarIndex'] == 1 and trade['exitBarIndex'] == (2 if entry_control else 1), trade
    if margin:
        assert [trade['exit']['id'] for trade in trades] == ['Margin call', 'risk.max_intraday_loss'], trades
        near(trades[0]['qty'], 48 / 7)
        near(trades[1]['qty'], 22 / 7)
    elif not entry_control:
        assert trades[0]['exit']['id'] == 'risk.max_intraday_loss', trades
    assert len(report['trades']) == len(trades) and all(t['status'] == 'closed' for t in report['trades']), report
    near(sum(trade['netPnl'] for trade in report['trades']), expected_net)
    audit = raw['auditLedger']
    assert audit['runId'] == raw['strategy']['reportRunId'], audit
    terminal = {event['orderId']: event['kind'] for event in audit['orderEvents']}
    # The public context has no pending_orders field. Reconstruct working
    # orders from the explicit audit lifecycle, without pretending a missing
    # private field is an empty broker queue.
    pending = [order for order, kind in terminal.items() if kind == 'created']
    assert pending == [], pending
    if entry_control:
        near(raw['strategy']['maxContractsHeldAll'], 2)
        near(raw['strategy']['maxContractsHeldShort'], 0)
        fills = audit['fillEvents']
        assert len(fills) == 2 and [fill['qty'] for fill in fills] == [2, 2], fills
        assert [fill['direction'] for fill in fills] == [1, -1], fills
        assert [fill['barIndex'] for fill in fills] == [1, 2], fills
        assert all(fill['price'] == 100 for fill in fills), fills
        assert not any(event['kind'] == 'rejected' for event in audit['orderEvents']), audit
        if scenario == 'position-cap':
            requested = [event for event in audit['orderEvents']
                         if event['kind'] == 'created' and event.get('sourceOrderId') == 'L']
            assert len(requested) == 1 and requested[0]['qty'] == 3, requested
            assert fills[0]['sourceOrderId'] == 'L', fills
        else:
            assert [fill['sourceOrderId'] for fill in fills] == ['L', 'S'], fills
            assert trades[0]['exit']['id'] == 'S', trades
    else:
        assert any(event.get('sourceOrderId') == 'unfilled' and event['kind'] == 'cancelled'
                   and event.get('reason') == 'risk.max_intraday_loss' for event in audit['orderEvents']), audit
        assert not any(fill.get('sourceOrderId') == 'blocked' for fill in audit['fillEvents']), audit
        exits = [fill for fill in audit['fillEvents'] if fill.get('sourceOrderId') == 'risk.max_intraday_loss']
        assert len(exits) == 1 and exits[0]['direction'] == -1 and exits[0]['barIndex'] == 1, exits
        near(exits[0]['qty'], 22 / 7 if margin else 2)
        near(exits[0]['price'], expected_exit)
        if margin:
            fills = audit['fillEvents']
            assert [fill['sourceOrderId'] for fill in fills] == ['L', 'Margin call', 'risk.max_intraday_loss'], fills
            margin_fill = fills[1]
            near(margin_fill['qty'], 48 / 7)
            near(margin_fill['price'], 70)
            assert margin_fill['parentOrderIds'] == [fills[0]['orderId']], margin_fill
            assert margin_fill['tradeIds'] == [trades[0]['id']], margin_fill
            assert margin_fill['category'] == 'exit' and margin_fill['direction'] == -1, margin_fill
            assert [event['kind'] for event in audit['orderEvents']
                    if event['orderId'] == margin_fill['orderId']] == ['created', 'filled'], audit
    near(raw['reportSeries']['points'][-1]['equity'], expected_equity)
    kpis = {kpi['label']: kpi['value'] for kpi in actual['kpis']}
    assert kpis.get('Net Profit') == f'{expected_net:.2f} USD', kpis
    assert kpis.get('Trades') == str(len(trades)), kpis
    actual['pendingFromAuditLifecycle'] = pending


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'audit-evidence/2026-10-07-risk-browser-controls')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    subprocess.run(['node', 'scripts/ensure-fork-build.mjs', '--check-only'], cwd=ROOT, check=True)
    paths = [Path(__file__).resolve(), ROOT/'packages/pinets/src/namespaces/strategy/utils.ts',
             ROOT/'packages/pinets/src/namespaces/strategy/ledger.ts',
             ROOT/'packages/pinets/src/namespaces/strategy/methods/entry.ts',
             ROOT/'packages/pinets/src/namespaces/strategy/methods/order.ts',
             ROOT/'packages/vela-pinets/dist/index.js', ROOT/'packages/pinets/dist/pinets.min.cjs',
             ROOT/'packages/pinets/dist/pinets.min.es.js', ROOT/'packages/pinets/dist/pinets.min.browser.es.js']
    result = {'cases': [], 'pageErrors': [], 'externalRequests': [],
              'sha256': {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                         for path in paths if path.is_file()}}
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
                        for scenario in ['daily-loss', 'margin-risk', 'position-cap', 'forbidden-direction']:
                            for magnified in [False, True]:
                                page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                                page.on('pageerror', lambda error: result['pageErrors'].append(str(error)))
                                page.on('request', lambda req: result['externalRequests'].append(req.url)
                                        if req.url.startswith(('http:', 'https:')) and not req.url.startswith(base) else None)
                                workers = []
                                page.on('worker', lambda worker: workers.append(worker.url))
                                key = f'{engine}-{scenario}-'+('lower' if magnified else 'default')
                                item = {'engine': engine, 'scenario': scenario, 'magnified': magnified}
                                result['cases'].append(item)
                                try:
                                    page.goto(base+'/tests/fixtures/history-live.html', wait_until='domcontentloaded')
                                    page.evaluate("document.body.insertAdjacentHTML('beforeend','<div id=bt></div>')")
                                    inputs = page.evaluate(SETUP, {'engineName': engine, 'magnified': magnified, 'scenario': scenario})
                                    item['inputs'] = inputs
                                    page.wait_for_function("window.__riskLiquidation.project()?.status==='ready'", timeout=30000)
                                    page.evaluate('window.__riskLiquidation.open()')
                                    page.locator('.quant-backtest-performance-kpi-bar').wait_for(state='visible')
                                    page.evaluate('() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                                    actual = page.evaluate('window.__riskLiquidation.capture()')
                                    item['actual'] = actual
                                    assert_result(actual, scenario, magnified)
                                    assert bool(workers) == (engine == 'PineWorkerEngine'), workers
                                    assert actual['raw']['provenance']['execution'] == ('worker' if engine == 'PineWorkerEngine' else 'in-process'), actual['raw']['provenance']
                                    page.screenshot(path=str(args.output/f'{key}-performance.png'))
                                    page.get_by_role('tab', name='Trades Log', exact=True).click()
                                    table = page.locator('.quant-backtest-trade-table')
                                    table.wait_for(state='visible')
                                    assert table.locator('tbody tr').count() == (2 if scenario == 'margin-risk' else 1)
                                    item['visibleTradesLog'] = table.inner_text()
                                    assert 'Open' not in item['visibleTradesLog'], item['visibleTradesLog']
                                    page.screenshot(path=str(args.output/f'{key}-trades.png'))
                                    item.update(pass_=True, browserWorkers=workers)
                                except Exception as error:
                                    item.update(pass_=False, error=str(error), browserWorkers=workers)
                                    page.screenshot(path=str(args.output/f'{key}-failed.png'))
                                finally:
                                    item['cleanup'] = page.evaluate('window.__riskLiquidation?.dispose()')
                                    page.wait_for_function('window.__riskLiquidation===undefined || document.querySelectorAll("#ws canvas").length===0')
                                    # Worker termination is asynchronous at the browser boundary.
                                    deadline = time.monotonic()+5
                                    while page.workers and time.monotonic()<deadline:
                                        page.wait_for_timeout(20)
                                    item['workersAfterDestroy'] = len(page.workers)
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
    manifest = {str(path.relative_to(args.output)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sorted(args.output.rglob('*')) if path.is_file() and path.name != 'SHA256.json'}
    (args.output/'SHA256.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({'cases': [{k: c.get(k) for k in ['engine', 'scenario', 'magnified', 'pass_', 'error', 'cleanup', 'workersAfterDestroy']}
                                 for c in result['cases']], 'pageErrors': result['pageErrors'],
                      'externalRequests': result['externalRequests']}, indent=2))
    if result['pageErrors'] or result['externalRequests'] or len(result['cases']) != 16 or not all(
            case.get('pass_') and case.get('cleanup', {}).get('canvas') == 0
            and case.get('cleanup', {}).get('dialogs') == 0 and case.get('workersAfterDestroy') == 0
            and case.get('cleanup', {}).get('resources', {}).get('activeCharts') == 0
            and case.get('cleanup', {}).get('resources', {}).get('activeObservers') == 0 for case in result['cases']):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
