"""Independent delayed-mount boundary: unknown history must not appear ready."""
from pathlib import Path
import json
import os

root = Path(__file__).resolve().parents[1]
out = Path(os.environ.get('QUANT_DELAYED_HISTORY_OUT', '/tmp/quant-delayed-adapter-history-20261001'))
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
source = source.replace('const feature=mountBacktestFeature(', 'await chart.historyComplete();\n          const feature=mountBacktestFeature(')
exec(compile(source, 'independent-delayed-adapter-history', 'exec'), {'__name__': '__main__'})
result = json.loads((out / 'runtime-results.json').read_text())
for case in result['cases']:
    initial = case['initial']['ui']
    assert initial['status'] not in ['ready', 'open-only', 'no-trades'], (case['engineName'], initial)
    assert not initial['canSimulate'], (case['engineName'], initial)
    assert not any(s['status'] in ['ready', 'open-only', 'no-trades'] and s['finality'] == 'unknown' for s in case['initial']['adapterSnapshots']), case['initial']
    assert case['checks']['serial_market'] and case['checks']['superseded_market'], case
