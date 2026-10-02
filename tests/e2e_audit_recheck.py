#!/usr/bin/env python3
"""Replay independent audit inputs without overwriting their archived evidence.

Only service origins and output locations are substituted. Explicit assertions
below matter: several original probes intentionally exit 0 even on bad results.
Requires built local bridge packages; does not contact market providers.
"""
import json
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / 'audit-evidence/2026-09-30-recheck'
OUT = ROOT / 'audit-evidence/2026-09-30-recheck-fixes'
BASE = 'http://127.0.0.1:5194'
for directory in ['adapter', 'domain', 'stable/domain']:
    (OUT / directory).mkdir(parents=True, exist_ok=True)

node_runner = r'''
import {readFileSync} from 'node:fs';
let source = readFileSync(process.argv[1], 'utf8');
source = source.replaceAll('/tmp/quant-tools-recheck-20260930', process.argv[2]);
source = source.replaceAll("from '/Users/guoshichao/Desktop/quant-tools/", `from 'file://${process.cwd()}/`);
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
'''
with (OUT / 'adapter/stdout.log').open('w') as log:
    subprocess.run(['node', '--input-type=module', '-e', node_runner,
                    str(ARCHIVE / 'adapter/probe.mjs'), str(OUT)], cwd=ROOT, stdout=log, check=True)
raw = json.loads((OUT / 'adapter/results.json').read_text())
assert not raw['unhandled'], raw['unhandled']
assert all('harnessError' not in c for c in raw['cases']), raw
cases = {c['id']: c for c in raw['cases']}
summary = cases['F01_summary_event_after_atomic']
assert summary['before']['trades'] == summary['after']['trades'], summary
assert summary['after']['status'] == 'ready', summary
error_then_summary = cases['F02_error_then_late_summary']['afterLateSummary']
assert error_then_summary['status'] == 'error' and error_then_summary['error'], error_then_summary
full_then_error = cases['F02_valid_full_then_late_summary_rejection']
assert full_then_error['invalidAfter']['status'] == 'ready', full_then_error
assert full_then_error['invalidAfter']['trades'] == full_then_error['validBefore']['trades'], full_then_error
old_retry = cases['F02_manual_retry_rejects_old_engine_identity']
assert old_retry['retried']['status'] != 'ready' and not old_retry['mapped']['canSimulate'], old_retry
assert cases['F10_completion_before_first_strategy']['mapped']['trades'] == 1
assert cases['F10_pre_subscribe_abort']['after']['finality'] != 'historical-final'

server = subprocess.Popen([str(ROOT / 'node_modules/.bin/vite'), '--config',
    'tests/vite-performance.config.ts', '--host', '127.0.0.1', '--port', '5194', '--strictPort'],
    cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(200):
        if server.poll() is not None:
            raise RuntimeError('Audit dev server failed to start; port 5194 must be free')
        try:
            if urlopen(BASE, timeout=1).status == 200:
                break
        except OSError:
            time.sleep(.1)
    else:
        raise RuntimeError('Audit dev server readiness timed out')
    for file in ['adapter/browser_probe.py', 'domain/worker_cases_recheck.py', 'domain/viewer_recheck.py']:
        source = (ARCHIVE / file).read_text()
        source = source.replace('/tmp/quant-tools-recheck-20260930', str(OUT))
        source = source.replace('/Users/guoshichao/Desktop/quant-tools', str(ROOT))
        source = source.replace('http://localhost:5190', BASE).replace('http://127.0.0.1:5190', BASE)
        exec(compile(source, str(ARCHIVE / file), 'exec'), {'__name__': '__main__'})
    browser = json.loads((OUT / 'adapter/browser_results.json').read_text())
    assert browser['runOk'] and not browser['pageErrors'], browser
    assert len(browser['reports']) == 1, browser
    report = browser['reports'][0]
    assert report['finality'] == 'historical-final' and report['ui']['trades'] == 1, report
    assert report['ui']['netProfit'] == 4 and report['ui']['canSimulate'], report
    # Preserve the literal original worker sample above. It can sample a
    # bootstrap open-only report, exit its wait, then catch the formal history
    # run mid-flight after awaiting raw context. It destroys the feature at
    # that point. The second run below verifies an explicit terminal condition
    # instead of treating a transient sample as either success or failure.
    source = (ARCHIVE / 'domain/worker_cases_recheck.py').read_text()
    source = source.replace('/tmp/quant-tools-recheck-20260930', str(OUT / 'stable'))
    source = source.replace('/Users/guoshichao/Desktop/quant-tools', str(ROOT))
    source = source.replace('http://127.0.0.1:5190', BASE)
    # Install observers BEFORE constructing the workspace. Awaiting an import
    # between workspace construction and feature mount would itself miss the
    # one-shot history event, creating a different unsupported sampling case.
    source = source.replace('const registry=createPineEngineRegistry();', '''let lastAdapterSnapshot;
   const {VelaBacktestResultsAdapter}=await import('/src/integrations/vela/backtest-results-adapter.ts');
   const subscribe=VelaBacktestResultsAdapter.prototype.subscribe;
   VelaBacktestResultsAdapter.prototype.subscribe=function(listener){
     return subscribe.call(this,event=>{if(event.type==='snapshot')lastAdapterSnapshot=event.snapshot;listener(event)});
   };
   const registry=createPineEngineRegistry();''')
    source = source.replace('const handle=workspace.active.chart.addIndicator', '''let completedRuns=0;
   workspace.on('script:run', run=>{if(run.complete&&run.kind==='strategy')completedRuns++});
   const handle=workspace.active.chart.addIndicator''')
    source = source.replace("const rawContext=await handle.context(['meta','strategy','trades']);", '''let rawContext;
   let settled=false;const settleDeadline=performance.now()+15000;
   while(performance.now()<settleDeadline){
     rawContext=await handle.context(['meta','strategy','trades']);
     const current=feature.controller.getSnapshot();
     const snapshot=lastAdapterSnapshot;
     if(completedRuns>0&&current?.status===c.expectedStatus&&current.trades?.length===1
        &&snapshot?.run?.complete&&snapshot.history.complete&&snapshot.ledgerState==='ready'
        &&snapshot.seriesState==='ready'&&snapshot.ledgerRevision===snapshot.revision
        &&snapshot.revision===current.revision
        &&snapshot.reportSeries?.snapshotRevision===rawContext?.strategy?.reportSnapshotRevision
        &&current.runId===rawContext?.strategy?.reportRunId){
       await new Promise(requestAnimationFrame);
       const next=feature.controller.getSnapshot();
       if(next?.revision===current.revision&&next.runId===current.runId&&next.status===current.status){settled=true;break;}
     }
     await new Promise(r=>setTimeout(r,25));
   }
   if(!settled)throw Error('Current completed engine run did not produce a matching settled report: '+JSON.stringify({
     completedRuns, current:feature.controller.getSnapshot(), snapshot:lastAdapterSnapshot,
     rawStrategy:rawContext?.strategy}));''')
    exec(compile(source, 'stable-worker-recheck', 'exec'), {'__name__': '__main__'})
    worker = json.loads((OUT / 'stable/domain/worker_cases_recheck.json').read_text())
    for case in worker['cases']:
        assert all(case['assertions'].values()), (case['case'], case['assertions'], case['report'])
    viewer = json.loads((OUT / 'domain/viewer_recheck.json').read_text())
    assert all(viewer['assertions'].values()), viewer['assertions']
    print('Independent recheck inputs: critical adapter assertions, real PineEngine, Worker open/zero/win, Viewer DOM passed')
finally:
    server.terminate()
    server.wait(timeout=5)
