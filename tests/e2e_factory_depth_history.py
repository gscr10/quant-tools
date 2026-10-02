"""Actual Vela depth-only setMarket({bars}) through production workspace factory."""
from pathlib import Path
import os

root = Path(__file__).resolve().parents[1]
source = (root / 'tests/e2e_factory_late_history.py').read_text()
source = source.replace("'/tmp/quant-factory-late-history-20261001'", "'/tmp/quant-factory-depth-history-20261001'")
source = source.replace("const bars=Array.from({length:36}", "const bars=Array.from({length:120}")
source = source.replace("await chart.setMarket({symbol:'BTCUSDT',timeframe:'15',data:bars,bars:36});", '''
      chart.data.registerProvider('depthaudit', {
        listSymbols:async()=>[{ticker:'BTCUSDT',type:'crypto'}],
        getBars:async(symbol,tf,range)=>bars.filter(b=>(range?.from==null||b.time>=range.from)&&(range?.to==null||b.time<=range.to)).slice(-(range?.limit??36)),
        subscribe:()=>()=>{},
      });
      await chart.setMarket({symbol:'DEPTHAUDIT:BTCUSDT',timeframe:'15',bars:36});''')
source = source.replace("const raw=await handle.context(['strategy','trades']);", '''
      const raw=await handle.context(['strategy','trades']);
      const trace=[];
      for(const event of ['load:start','load:end','history:progress','history:complete','market:changed'])chart.on(event,payload=>trace.push({event,...payload}));
      await chart.setMarket({bars:72});
      await chart.historyComplete();
      for(let n=0;n<200;n++){
        if(feature.controller.getSnapshot()?.history?.barsLoaded===72 && feature.controller.getSnapshot()?.capabilities?.canSimulate)break;
        await new Promise(r=>setTimeout(r,25));
      }
      const extended=feature.controller.getSnapshot();
      const extendedProjection={status:extended?.status,history:extended?.history,trades:extended?.trades?.length,canSimulate:extended?.capabilities?.canSimulate,trace};''')
source = source.replace('return {beforeFeature,projection,raw,snapshots};','return {beforeFeature,projection,raw,snapshots,extendedProjection};')
source += '''
assert result['extendedProjection']['history']['barsLoaded']==72, result
assert result['extendedProjection']['canSimulate'], result
assert not any(e['event']=='load:start' for e in result['extendedProjection']['trace']), result
print('Depth-only 36 -> 72 without load:start: PASS')
'''
exec(compile(source, 'production-factory-depth-history', 'exec'), {'__name__':'__main__'})
