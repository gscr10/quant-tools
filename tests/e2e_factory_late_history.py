"""Production createWorkspace captures completion before BacktestFeature exists."""
from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright

out = Path(os.environ.get('QUANT_FACTORY_HISTORY_OUT', '/tmp/quant-factory-late-history-20261001'))
out.mkdir(parents=True, exist_ok=True)
base = os.environ.get('QUANT_INITIAL_HISTORY_BASE', 'http://127.0.0.1:5274')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1400, 'height': 950})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base) else route.abort())
    page.route('**/@vite/client', lambda route: route.fulfill(content_type='application/javascript', body='export function createHotContext(){return {accept(){},dispose(){},on(){},invalidate(){},prune(){},data:{}}};export function injectQuery(url){return url};export function updateStyle(){};export function removeStyle(){};'))
    page.route('**/__factory_history__', lambda route: route.fulfill(content_type='text/html', body='<div id="workspace" style="height:750px"></div><div id="backtest"></div>'))
    page.goto(base + '/__factory_history__')
    result = page.evaluate('''async () => {
      const {createWorkspace}=await import('/src/integrations/vela/create-workspace.ts');
      const {mountBacktestFeature}=await import('/src/app/backtest-feature.ts');
      const {observedWorkspaceHistory}=await import('/src/integrations/vela/workspace-history-observer.ts');
      const {VelaBacktestResultsAdapter}=await import('/src/integrations/vela/backtest-results-adapter.ts');
      const snapshots=[];
      const bootstrap=VelaBacktestResultsAdapter.prototype.bootstrap;
      VelaBacktestResultsAdapter.prototype.bootstrap=function(...args){
        this.subscribeSnapshots(s=>snapshots.push({status:s.status,finality:s.finality,trades:s.trades?.length,history:s.history}));
        return bootstrap.apply(this,args);
      };
      const workspace=createWorkspace(document.getElementById('workspace'));
      const cell=workspace.active, chart=cell.chart;
      const bars=Array.from({length:36},(_,i)=>({time:1711929600000+i*900000,open:80+i/4,high:81+i/4,low:79+i/4,close:80+i/4,volume:100+i}));
      // Explicit offline user market change settles BEFORE the feature mounts.
      // No fixture replaces createWorkspace or the production Worker engine.
      await chart.setMarket({symbol:'BTCUSDT',timeframe:'15',data:bars,bars:36});
      await chart.historyComplete();
      const beforeFeature=observedWorkspaceHistory(workspace,cell);
      const feature=mountBacktestFeature(workspace,{host:document.getElementById('backtest')});
      const source='//@version=6\\nstrategy("Factory late mount",overlay=true,initial_capital=25000)\\nif bar_index == 2\\n    strategy.entry("IN",strategy.long,qty=2)\\nif bar_index == 8\\n    strategy.close("IN")';
      const handle=chart.addIndicator(source,{language:'pine'});
      for(let n=0;n<200;n++){
        if(feature.controller.getSnapshot()?.capabilities?.canSimulate)break;
        await new Promise(r=>setTimeout(r,25));
      }
      const s=feature.controller.getSnapshot();
      const projection={status:s?.status,history:s?.history,trades:s?.trades?.length,canSimulate:s?.capabilities?.canSimulate};
      const raw=await handle.context(['strategy','trades']);
      feature.workbench.openViewer();
      window.disposeProbe=()=>{feature.destroy();workspace.destroy();return {cached:observedWorkspaceHistory(workspace,cell),children:document.getElementById('workspace').children.length};};
      return {beforeFeature,projection,raw,snapshots};
    }''')
    page.screenshot(path=str(out / 'factory-late.png'), full_page=True)
    result['cleanup'] = page.evaluate('window.disposeProbe()')
    result['pageErrors'] = errors
    browser.close()
(out / 'results.json').write_text(json.dumps(result, indent=2))
assert result['beforeFeature']['historyReason'] == 'depth', result
assert result['projection']['canSimulate'] and result['projection']['trades'] == 1, result
assert not any(s['status'] == 'ready' and s['finality'] == 'unknown' for s in result['snapshots']), result
assert result['cleanup']['cached'] is None and result['cleanup']['children'] == 0, result
assert not errors, errors
print(json.dumps({'factoryLateMount':result['projection'],'cleanup':result['cleanup']}))
