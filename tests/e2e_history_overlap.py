"""Fresh real-engine overlap probe; requires the dev server at 127.0.0.1:5190.

Replays the archived base probe with the exact additions used for the
2026-09-30 history-extended results. Does not modify the archived source.
"""
from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
out = Path('/tmp/quant-tools-recheck2-fixes-20260930/history-extended')
source = (root / 'audit-evidence/2026-09-30-recheck-2/history-runtime.py').read_text()
source = source.replace('/tmp/quant-tools-recheck2-20260930/history', str(out))
source = source.replace("page.goto('http://127.0.0.1:5190/__new_history_recheck__')", """page.route('**/@vite/client',lambda r:r.fulfill(content_type='application/javascript',body='export function createHotContext(){return {accept(){},dispose(){},on(){},invalidate(){},prune(){},data:{}}}; export function injectQuery(url){return url}; export function updateStyle(){};export function removeStyle(){};'))
        page.goto('http://127.0.0.1:5190/__new_history_recheck__')""")
source = source.replace('let holdB=false,releaseB=null;', 'let holdB=false,releaseB=null,holdTf=false,releaseTf=null;')
source = source.replace('return barsFor(sym);', """
            if(sym==='EMPTY')return [];
            if(sym==='CCC'&&String(tf)==='5'&&holdTf)await new Promise(resolve=>{releaseTf=resolve});
            return barsFor(sym==='CCC'&&String(tf)==='15'?'DDD':sym);
""")
source = source.replace('overlap.afterOldSettled=projection();', """
          overlap.afterOldSettled=projection();
          const tfTraceStart=trace.length;holdTf=true;
          const pendingTf=chart.setMarket({symbol:'RECHECK2:CCC',timeframe:'5'});
          const tfStarted=await waitFor(()=>releaseTf!==null);
          await chart.setMarket({symbol:'RECHECK2:CCC',timeframe:'15'});await chart.historyComplete();
          const tfReady=await waitFor(()=>value(feature.controller.getSnapshot()?.metrics?.netProfit)===6);
          const timeframeOverlap={tfStarted,tfReady,market:chart.market,ui:projection(),raw:await handle.context(['strategy','trades'])};
          releaseTf?.();holdTf=false;await pendingTf;
          const tfAfterReady=await waitFor(()=>value(feature.controller.getSnapshot()?.metrics?.netProfit)===6);
          timeframeOverlap.afterOldSettled={market:chart.market,ui:projection(),ready:tfAfterReady};
          timeframeOverlap.trace=trace.slice(tfTraceStart);
          const emptyTraceStart=trace.length;
          await chart.setMarket({symbol:'RECHECK2:EMPTY',timeframe:'60'});
          const emptyReady=await waitFor(()=>feature.controller.getSnapshot()?.status==='no-data');
          const emptyTarget={ready:emptyReady,market:chart.market,ui:projection(),trace:trace.slice(emptyTraceStart)};
          await chart.setMarket({symbol:'RECHECK2:DDD',timeframe:'60',data:barsFor('DDD')});await chart.historyComplete();
          const recoveryReady=await waitFor(()=>value(feature.controller.getSnapshot()?.metrics?.netProfit)===6&&feature.controller.getSnapshot()?.status==='ready');
          const recovered={ready:recoveryReady,market:chart.market,ui:projection(),raw:await handle.context(['strategy','trades'])};
""")
source = source.replace('return {engineName,initial,hidden,reshown,serial,overlap,trace,calls,diagnostics};', 'return {engineName,initial,hidden,reshown,serial,overlap,timeframeOverlap,emptyTarget,recovered,trace,calls,diagnostics};')
source = source.replace('cases.append(result)', '''result['checks'].update({
            'timeframe_overlap_started':result['timeframeOverlap']['tfStarted'],
            'timeframe_overlap_current':result['timeframeOverlap']['tfReady'] and result['timeframeOverlap']['ui']['history']['complete'] and result['timeframeOverlap']['raw']['strategy']['netPnl']==6,
            'timeframe_late_reply_ignored':result['timeframeOverlap']['afterOldSettled']['ui']['netProfit']==6,
            'empty_no_data':result['emptyTarget']['ready'] and result['emptyTarget']['ui']['trades']==0 and result['emptyTarget']['ui']['netProfit'] is None,
            'recovery_valid':result['recovered']['ready'] and result['recovered']['ui']['history']['complete'] and result['recovered']['raw']['strategy']['netPnl']==6,
        })
        cases.append(result)''')
exec(compile(source, 'history-extended-reviewer', 'exec'), {'__name__': '__main__'})
results = json.loads((out / 'runtime-results.json').read_text())
assert all(all(case['checks'].values()) for case in results['cases']), [
    (case['engineName'], case['checks']) for case in results['cases']
]
