#!/usr/bin/env python3
"""Bounded full production Workspace soak with actual Hyperliquid data.

An isolated copy of the deployment dist, real default Pine Worker, real
Simulation, real REST/WebSocket and actual UI controls stay open throughout.
Periodic forced-GC samples distinguish retained resources from garbage awaiting
collection. This is a local Chromium scenario, not all-device proof.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright
from e2e_production_a11y import open_viewer, return_chart, hashes
from provider_smoke import NetworkEvidence, browser_resources

ROOT = Path(__file__).resolve().parents[1]
AUDIT = r'''(() => {
  const workers=new Set(); let created=0, stopped=0;
  const Worker=window.Worker;
  window.Worker=class extends Worker {
    constructor(...args){super(...args);workers.add(this);created++;}
    terminate(){if(workers.delete(this))stopped++;return super.terminate();}
  };
  window.__soakWorkers=()=>({active:workers.size,created,stopped});
})();'''


def wait_visible(page, selector, timeout=60000):
    # Python Playwright Locator.wait_for drops the ElementHandle returned by
    # Frame.wait_for_selector without disposing it. Each detached Tab then
    # remains rooted by the protocol session ("DevTools console" in the heap).
    # Own the returned handle explicitly; visibility/action assertions stay.
    handle=page.wait_for_selector(selector,state='visible',timeout=timeout)
    if handle is not None:handle.dispose()


def sample(page, session, network, started):
    page.wait_for_function('window.__soakWorkers().active===1')
    # Let disconnected SVG/DOM complete rendering lifecycle before measuring
    # retained resources; sampling immediately after a click catches the
    # previous frame's pending Blink cleanup instead.
    page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    # Playwright's selector diagnostics write DOM handles into DevTools'
    # console history. A heap snapshot of the first calibration traced the
    # detached panels directly to "DevTools console" global handles, even
    # after GC. Clear that observer-owned history before measuring the app;
    # original failure evidence and its retaining paths remain archived.
    session.send('Runtime.discardConsoleEntries')
    session.send('HeapProfiler.collectGarbage')
    dom=page.evaluate('''() => ({workers:window.__soakWorkers(),
      charts:document.querySelectorAll('.highcharts-root').length,
      canvases:document.querySelectorAll('canvas').length,
      dialogs:document.querySelectorAll('[role=dialog]:not([hidden])').length,
      workbenches:document.querySelectorAll('#backtest-workbench').length,
      cells:document.querySelectorAll('.vela-cell').length,
      kpis:[...document.querySelectorAll('.quant-backtest-performance-kpi-bar .quant-backtest-kpi')].map(n=>n.innerText),
      state:document.querySelector('.quant-backtest-state')?.innerText??null,
      viewer:!!document.querySelector('.quant-backtest-viewer:not([hidden])')})''')
    assert dom['workbenches']==1 and dom['cells']==1, dom
    assert dom['workers']['active']==1, dom
    assert dom['dialogs']==0 and not dom['state'], dom
    assert len(dom['kpis'])>=4 and all('—' not in value for value in dom['kpis']), dom
    return dict(elapsedSeconds=time.monotonic()-started,dom=dom,domCounters=session.send('Memory.getDOMCounters'),
                resources=browser_resources(session),network=network.snapshot())


def exercise(page, cycle):
    for tab,selector in [('analysis','.quant-backtest-analysis'),('log','.quant-backtest-trades-log'),
                         ('simulation','.quant-backtest-simulation'),('performance','.quant-backtest-performance')]:
        page.locator(f'#quant-backtest-tab-{tab}').click()
        wait_visible(page,selector)
        if tab=='simulation':
            wait_visible(page,'.quant-backtest-simulation-chart-host')
    if cycle%5==0:
        return_chart(page)
        page.locator('.quant-backtest-dock [aria-label="Open strategy settings"]').click()
        page.locator('.quant-backtest-settings [role="tab"]',has_text='Properties').click()
        page.locator('.quant-backtest-settings [role="tab"]',has_text='Inputs').click()
        page.keyboard.press('Escape')
        page.locator('.quant-backtest-settings').wait_for(state='hidden')
        open_viewer(page)
        wait_visible(page,'.quant-backtest-performance')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seconds',type=int,default=7200)
    parser.add_argument('--interval',type=int,default=60)
    parser.add_argument('--proxy',default='http://127.0.0.1:9981')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--heap-on-failure',action='store_true')
    args=parser.parse_args()
    if args.seconds<60 or args.interval<10:parser.error('seconds >=60 and interval >=10 required')
    args.output.mkdir(parents=True,exist_ok=True)
    result=dict(status='running',durationRequested=args.seconds,samples=[],errors=[],networkSource='real Hyperliquid BTC perpetual')
    save=lambda: (args.output/'results.json').write_text(json.dumps(result,indent=2))
    with tempfile.TemporaryDirectory(prefix='quant-workspace-soak-') as temporary:
        snapshot=Path(temporary)/'dist'
        original=hashes(ROOT/'dist')
        shutil.copytree(ROOT/'dist',snapshot)
        assert original==hashes(snapshot),'dist changed during snapshot'
        result['buildAssets']=original
        result['runnerSha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        base=f'http://127.0.0.1:{port}'
        with (args.output/'server.log').open('w') as log:
            server=subprocess.Popen(['node','node_modules/vite/bin/vite.js','preview','--outDir',str(snapshot),
                '--host','127.0.0.1','--port',str(port),'--strictPort'],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
            try:
                deadline=time.monotonic()+45
                while True:
                    if server.poll() is not None:raise RuntimeError('preview exited')
                    try:
                        if urlopen(base,timeout=1).status==200:break
                    except OSError:pass
                    if time.monotonic()>deadline:raise TimeoutError('preview startup')
                    time.sleep(.1)
                with sync_playwright() as p:
                    browser=p.chromium.launch(headless=True,proxy={'server':args.proxy,'bypass':'localhost,127.0.0.1'} if args.proxy else None)
                    try:
                        context=browser.new_context(viewport={'width':1440,'height':900})
                        seed={'version':1,'layout':'1','timezone':'Etc/UTC','charts':[{'id':'c1','symbol':'hyperliquid:BTC','timeframe':'15','bars':2000,'live':True}]}
                        context.add_init_script('if(location.origin==='+json.dumps(base)+')localStorage.setItem("quant-tools:workspace:v2",'+json.dumps(json.dumps(seed))+');')
                        context.add_init_script(AUDIT)
                        page=context.new_page();page.set_default_timeout(60000)
                        page.on('pageerror',lambda e:result['errors'].append(str(e)))
                        # Dispose protocol previews of logged DOM nodes as
                        # well; the Playwright session owns those handles.
                        def release_console(message):
                            for argument in message.args:argument.dispose()
                        page.on('console',release_console)
                        workers={'created':0,'closed':0}
                        def worker_created(worker):
                            workers['created']+=1
                            worker.on('close',lambda:workers.__setitem__('closed',workers['closed']+1))
                        page.on('worker',worker_created)
                        session=context.new_cdp_session(page)
                        network=NetworkEvidence(session)
                        page.goto(base+'/?chart=maximized',wait_until='domcontentloaded')
                        page.locator('button:visible',has_text='Indicators').first.click()
                        page.locator('.quant-indicator-category[data-section="built-ins"]').click()
                        page.locator('.quant-indicator-row',has_text='SMA Cross (strategy)').locator('.quant-indicator-main').click()
                        open_viewer(page)
                        wait_visible(page,'.quant-backtest-performance',timeout=120000)
                        started=time.monotonic()
                        cycle=0
                        while True:
                            exercise(page,cycle)
                            row=sample(page,session,network,started)
                            result['samples'].append(row)
                            assert not result['errors'],result['errors']
                            save()
                            print(json.dumps({'cycle':cycle,'elapsed':round(row['elapsedSeconds']),
                                              'resources':row['resources'],'sockets':row['network']['hyperliquid']}),flush=True)
                            if row['elapsedSeconds']>=args.seconds:break
                            cycle+=1
                            delay=min(args.interval,args.seconds-(time.monotonic()-started))
                            if delay>0:page.wait_for_timeout(delay*1000)
                        result['durationObserved']=time.monotonic()-started
                        # Compare the same Performance state after warmup,
                        # with GC at every sample. These are explicit local
                        # retained-resource budgets, not proof of zero leaks.
                        baseline=result['samples'][min(2,len(result['samples'])-1)]['resources']
                        tail=result['samples'][-1]['resources']
                        budgets={'Nodes':baseline['Nodes']+500,
                                 'JSEventListeners':baseline['JSEventListeners']+100,
                                 'JSHeapUsedSize':max(baseline['JSHeapUsedSize']*2,baseline['JSHeapUsedSize']+32*1024*1024)}
                        result['resourceBudgets']={'baseline':baseline,'limits':budgets,'final':tail}
                        assert all(tail[name]<=limit for name,limit in budgets.items()),result['resourceBudgets']
                        assert network.snapshot()['hyperliquid']['candleFrames']>0,'no actual upstream candle observed'
                        page.screenshot(path=str(args.output/'final.png'))
                        result['finalWorkersBeforeUnload']=workers.copy()
                        page.goto('about:blank')
                        page.wait_for_timeout(3500)
                        result['afterUnload']={'workers':workers,'network':network.snapshot()}
                        assert workers['created']==workers['closed'],workers
                        assert network.snapshot()['hyperliquid']['active']==0,'socket survived document unload'
                        assert not result['errors'],result['errors']
                        result['status']='passed'
                    except Exception as error:
                        result.update(status='failed',error=str(error))
                        if args.heap_on_failure:
                            try:
                                with (args.output/'failure.heapsnapshot').open('w') as heap:
                                    session.on('HeapProfiler.addHeapSnapshotChunk',lambda event:heap.write(event['chunk']))
                                    session.send('HeapProfiler.takeHeapSnapshot',{'reportProgress':False})
                            except Exception as heap_error:result['heapError']=str(heap_error)
                        try:page.screenshot(path=str(args.output/'failure.png'))
                        except Exception:pass
                        raise
                    finally:
                        browser.close()
            finally:
                server.terminate();server.wait(timeout=10)
                result['serverStopped']=server.poll() is not None
                save()
                (args.output/'SHA256.json').write_text(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in sorted(args.output.iterdir()) if p.is_file() and p.name!='SHA256.json'},indent=2))


if __name__=='__main__':main()
