#!/usr/bin/env python3
"""Real Hyperliquid, Workspace, both Pine engines and report recovery."""

import argparse
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

from provider_smoke import NetworkEvidence, browser_resources


ROOT = Path(__file__).resolve().parents[1]

BOOTSTRAP = r'''async engineName => {
  await import('/src/features/backtesting/backtest.css');
  const { VelaWorkspace } = await import('/node_modules/@luxalgo/vela/dist/workspace.js');
  const engines = await import('/packages/vela-pinets/dist/index.js');
  const { createWorkspaceProviders } = await import('/src/integrations/vela/provider-registry.ts');
  const { observeWorkspaceHistory } = await import('/src/integrations/vela/workspace-history-observer.ts');
  const { mountBacktestFeature } = await import('/src/app/backtest-feature.ts');
  const { getReportChartResourceStats } = await import('/src/features/backtesting/highcharts-renderer.ts');
  const engine = new engines[engineName]();
  const provider = createWorkspaceProviders().hyperliquid();
  const counters = { historyRequests: 0, historyBars: 0, subscriptions: 0,
    unsubscriptions: 0, callbacks: 0, lateCallbacks: 0, runEvents: 0 };
  const requests = [];
  const getBars = provider.getBars.bind(provider);
  provider.getBars = async (...args) => {
    const request = { symbol: args[0], timeframe: args[1], range: args[2], startedAt: Date.now() };
    requests.push(request); counters.historyRequests += 1;
    try {
      const bars = await getBars(...args);
      counters.historyBars += bars.length; request.bars = bars.length;
      request.end = bars.at(-1)?.time;
      return bars;
    } catch (error) {
      request.error = String(error); throw error;
    }
  };
  const subscribe = provider.subscribe.bind(provider);
  provider.subscribe = (...args) => {
    counters.subscriptions += 1;
    let active = true;
    const callback = args[2];
    args[2] = bar => {
      counters.callbacks += 1;
      if (!active) counters.lateCallbacks += 1;
      callback(bar);
    };
    const unsubscribe = subscribe(...args);
    return () => { if (active) { active = false; counters.unsubscriptions += 1; } unsubscribe(); };
  };
  const workspace = new VelaWorkspace(document.querySelector('#chart'), {
    layout: '1', theme: 'dark', timezone: 'Etc/UTC', live: true, persist: false,
    providers: { hyperliquid: () => provider }, engines: { pine: () => engine },
    cells: { real: { symbol: 'HYPERLIQUID:BTC', timeframe: '15', bars: 500 } },
  });
  const stopHistory = observeWorkspaceHistory(workspace);
  const diagnostics = [];
  const feature = mountBacktestFeature(workspace, { host: document.querySelector('#report'),
    onDiagnostic: (message, error) => diagnostics.push(`${message}: ${String(error ?? '')}`) });
  const runs = [];
  const connectivityEvents = [];
  window.addEventListener('offline', () => connectivityEvents.push({ event: 'offline', at: Date.now() }));
  window.addEventListener('online', () => connectivityEvents.push({ event: 'online', at: Date.now() }));
  const stopRuns = workspace.on('script:run', run => {
    counters.runEvents += 1;
    runs.push({ cause: run.cause, runId: run.runId, snapshotRevision: run.snapshotRevision,
      complete: run.complete, time: run.time });
    if (runs.length > 100) runs.shift();
  });
  const project = () => {
    const report = feature.controller.getSnapshot();
    return report ? { status: report.status, revision: report.revision, runId: report.runId,
      ledgerRevision: report.ledgerRevision, context: report.context, history: report.history,
      canSimulate: report.capabilities?.canSimulate, trades: report.trades,
      metrics: report.metrics, range: report.range, error: report.error } : null;
  };
  const source = '//@version=6\nstrategy("Live Provider Recovery", overlay=true, initial_capital=100000, calc_on_every_tick=true)\nif bar_index == 2\n    strategy.entry("CLOSED", strategy.long, qty=0.1)\nif bar_index == 8\n    strategy.close("CLOSED")\nif bar_index == 10\n    strategy.entry("OPEN", strategy.long, qty=0.1)';
  let handle;
  window.realProviderRecovery = {
    addStrategy: () => { handle = workspace.active.chart.addIndicator(source, { language: 'pine' }); },
    state: () => structuredClone({ report: project(), counters, requests, runs, diagnostics,
      connectivityEvents, navigatorOnline: navigator.onLine,
      chartResources: getReportChartResourceStats(), viewer: document.querySelector('.quant-backtest-viewer')?.textContent }),
    context: () => handle.context(['strategy', 'trades', 'reportSeries']),
    openViewer: () => feature.workbench.openViewer(),
    destroy: () => { feature.destroy(); stopRuns(); stopHistory(); workspace.destroy(); engine.terminate?.(); },
  };
  await workspace.active.chart.historyComplete();
  window.realProviderRecovery.addStrategy();
  return true;
}'''


def wait_state(page, predicate, label, timeout=90):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        last = page.evaluate('window.realProviderRecovery.state()')
        if predicate(last):
            return last
        page.wait_for_timeout(250)
    raise AssertionError(f'{label} timed out: {json.dumps(last)}')


def gc_resources(session):
    session.send('HeapProfiler.collectGarbage')
    return browser_resources(session)


def run_workspace(browser, base, engine_name, cycles, output, strict_offline):
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    session = page.context.new_cdp_session(page)
    network = NetworkEvidence(session)
    page.route('**/__real_provider_recovery__', lambda route: route.fulfill(content_type='text/html',
        body='<html><body style="margin:0"><div id="chart" style="height:720px"></div><div id="report"></div></body></html>'))
    result = {'engine': engine_name, 'cycles': [], 'pageErrors': errors}
    try:
        page.goto(base + '/__real_provider_recovery__')
        result['resourcesBlank'] = gc_resources(session)
        page.evaluate(BOOTSTRAP, engine_name)
        initial = wait_state(page, lambda state: state['report'] and state['report']['status'] == 'ready'
                             and len(state['report']['trades']) == 2 and state['counters']['callbacks'] > 0,
                             'ready historical ledger and live callback')
        result['initial'] = initial
        result['resourcesBeforeCycles'] = gc_resources(session)
        page.evaluate('window.realProviderRecovery.openViewer()')
        for cycle in range(cycles):
            before = wait_state(page, lambda state: state['report']['status'] == 'ready', 'ready before offline')
            previous_connections = network.snapshot()['hyperliquid']['created']
            page.context.set_offline(True)
            page.wait_for_function('navigator.onLine === false')
            page.wait_for_function('window.realProviderRecovery.state().connectivityEvents.some(event => event.event === "offline")')
            page.wait_for_timeout(150)
            offline_immediate = page.evaluate('window.realProviderRecovery.state()')
            page.wait_for_timeout(1500)
            offline_start = page.evaluate('window.realProviderRecovery.state()')
            page.wait_for_timeout(2000)
            offline_end = page.evaluate('window.realProviderRecovery.state()')
            assert offline_start['counters']['callbacks'] == offline_end['counters']['callbacks'], 'offline callbacks'
            offline_transition = {
                'immediateRevisionAdvanced': before['report']['revision'] != offline_immediate['report']['revision'],
                'immediateStatusAdvanced': before['report']['status'] != offline_immediate['report']['status'],
                'immediateRunEventsAdded': offline_immediate['counters']['runEvents'] - before['counters']['runEvents'],
                'immediateCallbacksAdded': offline_immediate['counters']['callbacks'] - before['counters']['callbacks'],
                'revisionAdvanced': offline_start['report']['revision'] != offline_end['report']['revision'],
                'statusAdvanced': offline_start['report']['status'] != offline_end['report']['status'],
                'tradesChanged': offline_start['report']['trades'] != offline_end['report']['trades'],
                'runEventsAdded': offline_end['counters']['runEvents'] - offline_start['counters']['runEvents'],
                'callbacksAdded': offline_end['counters']['callbacks'] - offline_start['counters']['callbacks'],
                'connectivityEvents': offline_end['connectivityEvents'],
            }
            if strict_offline:
                assert not offline_transition['revisionAdvanced'], 'offline report advanced'
                assert not offline_transition['tradesChanged'], 'offline ledger mutated'
            page.context.set_offline(False)
            page.wait_for_function('navigator.onLine === true')
            page.wait_for_function('window.realProviderRecovery.state().connectivityEvents.some(event => event.event === "online")')
            recovered = wait_state(page, lambda state: state['report']['status'] == 'ready'
                                   and state['report']['revision'] > offline_end['report']['revision']
                                   and state['counters']['callbacks'] > offline_end['counters']['callbacks']
                                   and network.snapshot()['hyperliquid']['lastCandleConnection'] > previous_connections,
                                   'fresh socket candle and report revision after recovery')
            assert len(recovered['report']['trades']) == 2, 'ledger lost during recovery'
            assert recovered['report']['runId'] == before['report']['runId'], 'unexpected historical rerun'
            assert recovered['report']['canSimulate'], 'settled ledger simulation unavailable'
            raw = page.evaluate('window.realProviderRecovery.context()')
            assert len(raw['trades']) == 2, 'engine and report population diverged'
            result['cycles'].append({'before': before, 'offline': offline_end, 'offlineTransition': offline_transition,
                                     'recovered': recovered,
                                     'engineLedger': raw['trades'], 'reportIdentity': raw['strategy'].get('reportIdentity'),
                                     'resourcesAfterGC': gc_resources(session), 'websockets': network.snapshot()})
            (output / f'{engine_name}.json').write_text(json.dumps(result, indent=2))
            print(json.dumps({'engine': engine_name, 'cycle': cycle + 1,
                              'revision': recovered['report']['revision'], 'trades': 2}), flush=True)
            page.wait_for_timeout(5000)
        page.screenshot(path=str(output / f'{engine_name}.png'))
        result['beforeDestroy'] = page.evaluate('window.realProviderRecovery.state()')
        page.evaluate('window.realProviderRecovery.destroy()')
        # Match a real route unmount: remove the host nodes after their
        # owners have torn down subscriptions, then force GC so retained DOM
        # listeners are measured separately from the active page shell.
        page.evaluate("document.querySelector('#chart')?.replaceChildren(); document.querySelector('#report')?.replaceChildren()")
        page.wait_for_timeout(3500)
        result['afterDestroy'] = page.evaluate('window.realProviderRecovery.state()')
        result['resourcesAfterDestroyGC'] = gc_resources(session)
        result['websockets'] = network.snapshot()
        final = result['afterDestroy']['counters']
        assert final['subscriptions'] == final['unsubscriptions'], 'subscription leak'
        assert final['lateCallbacks'] == 0, 'callback after unsubscribe'
        assert final['runEvents'] == result['beforeDestroy']['counters']['runEvents'], 'run event after destroy'
        assert network.snapshot()['hyperliquid']['active'] == 0, 'socket survived destroy'
        assert not errors, errors
        result['status'] = 'passed'
    except Exception as error:
        result.update(status='failed', error=str(error))
        try:
            result['failureState'] = page.evaluate('window.realProviderRecovery?.state()')
            page.screenshot(path=str(output / f'{engine_name}-failure.png'))
        except Exception:
            pass
        raise
    finally:
        (output / f'{engine_name}.json').write_text(json.dumps(result, indent=2))
        page.close()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cycles', type=int, default=3)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--observe-offline-rerun', action='store_true',
                        help='record a reproduced offline report transition instead of failing at it')
    args = parser.parse_args()
    if args.cycles < 1:
        parser.error('--cycles must be positive')
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    with (args.output_dir / 'vite.log').open('w') as log:
        server = subprocess.Popen(['node', str(ROOT / 'node_modules/vite/bin/vite.js'), '--config',
            'tests/vite-provider.config.ts', '--host', '127.0.0.1', '--port', str(port), '--strictPort'],
            cwd=ROOT, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if server.poll() is not None:
                    raise RuntimeError('Vite failed to start')
                try:
                    if urlopen(base, timeout=.5).status == 200:
                        break
                except OSError:
                    time.sleep(.1)
            else:
                raise TimeoutError('Vite startup')
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    results = [run_workspace(browser, base, engine, args.cycles, args.output_dir,
                                             not args.observe_offline_rerun)
                               for engine in ('PineEngine', 'PineWorkerEngine')]
                    (args.output_dir / 'results.json').write_text(json.dumps(results, indent=2))
                finally:
                    browser.close()
        finally:
            server.terminate()
            server.wait(timeout=10)
            manifest = {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                        for path in sorted(args.output_dir.iterdir()) if path.is_file() and path.name != 'SHA256.json'}
            (args.output_dir / 'SHA256.json').write_text(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
