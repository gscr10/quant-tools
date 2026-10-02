"""Replay independent real-engine history probe without altering its evidence.

Checks initial strategy insertion BEFORE any market reload, in both engines.
Run a Vite server separately; defaults to the isolated remediation port 5274.
"""
from pathlib import Path
import json
import os

root = Path(__file__).resolve().parents[1]
out = Path(os.environ.get('QUANT_INITIAL_HISTORY_OUT', '/tmp/quant-initial-history-generation-20261001'))
out.mkdir(parents=True, exist_ok=True)
base = os.environ.get('QUANT_INITIAL_HISTORY_BASE', 'http://127.0.0.1:5274')
source = (root / 'audit-evidence/2026-09-30-recheck-2/history-runtime.py').read_text()
source = source.replace('/tmp/quant-tools-recheck2-20260930/history', str(out))
source = source.replace('http://127.0.0.1:5190', base)
source = source.replace('const engine=new engines[engineName]();', '''
          const {VelaBacktestResultsAdapter}=await import('/src/integrations/vela/backtest-results-adapter.ts');
          const adapterSnapshots=[];
          const bootstrap=VelaBacktestResultsAdapter.prototype.bootstrap;
          VelaBacktestResultsAdapter.prototype.bootstrap=function(...args){
            this.subscribeSnapshots(s=>adapterSnapshots.push({status:s.status,finality:s.finality,history:s.history,ledgerState:s.ledgerState,trades:s.trades?.length??null}));
            return bootstrap.apply(this,args);
          };
          const engine=new engines[engineName]();''')
source = source.replace('const initial={ui:projection(),raw:await handle.context', 'const initial={adapterSnapshots:adapterSnapshots.slice(),ui:projection(),raw:await handle.context')
source = source.replace("await waitFor(()=>feature.controller.getSnapshot()?.trades?.length===1);", "await waitFor(()=>feature.controller.getSnapshot()?.trades?.length===1 && feature.controller.getSnapshot()?.capabilities?.canSimulate);")
exec(compile(source, 'independent-initial-history-generation', 'exec'), {'__name__': '__main__'})
result = json.loads((out / 'runtime-results.json').read_text())
for case in result['cases']:
    assert all(case['checks'].values()), (case['engineName'], case['checks'])
    initial = case['initial']['ui']
    assert initial['history']['complete'] and initial['canSimulate'], (case['engineName'], initial)
    assert initial['trades'] == len(case['initial']['raw']['trades']), case
    assert not any(s['status']=='ready' and s['finality']=='unknown' for s in case['initial']['adapterSnapshots']), case['initial']
