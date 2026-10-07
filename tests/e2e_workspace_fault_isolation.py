#!/usr/bin/env python3
"""Complete Workspace fault boundaries with explicitly injected browser faults.

Market HTTP/WebSocket input is controlled; PineWorkerEngine, Controller,
Workbench, Settings, favorite repositories, and Vela chart are real components.
"""
import argparse
import hashlib
import json
from pathlib import Path

from playwright.sync_api import sync_playwright
from e2e_app import install_fixed_clock, install_mock_market_data, install_offline_guard, MOCK_WEBSOCKET_SCRIPT, WORKER_AUDIT_SCRIPT
from e2e_production_a11y import continuous_klines
from e2e_simulation_components import serve

ROOT = Path(__file__).resolve().parents[1]

STORAGE_FAULT = r'''mode => {
  const backing = window.localStorage;
  const originals = Object.fromEntries(['getItem','setItem','removeItem'].map(name => [name, Storage.prototype[name]]));
  const fault = window.__workspaceStorageFault = {
    mode, denied: {getter: 0, getItem: 0, setItem: 0, removeItem: 0},
    persisted: key => originals.getItem.call(backing, key),
  };
  if (mode === 'getter') Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() { fault.denied.getter++; throw new DOMException('Injected unavailable storage getter', 'SecurityError'); },
  });
  if (mode === 'methods' || mode === 'quota') {
    for (const name of mode === 'methods' ? ['getItem','setItem','removeItem'] : ['setItem']) {
      Storage.prototype[name] = function () {
        fault.denied[name]++;
        throw new DOMException('Injected storage method failure', mode === 'quota' ? 'QuotaExceededError' : 'SecurityError');
      };
    }
  }
}'''

SETUP = r'''async () => {
  await import('/src/style.css');
  const {createApp} = await import('/src/app/create-app.ts');
  const {mountBacktestFeature} = await import('/src/app/backtest-feature.ts');
  const {listIndicatorFavorites} = await import('/src/integrations/storage/favorite-repository.ts');
  let ws, feature;
  const trace = {failLocate: false, failedLocateCalls: 0, rangeCalls: 0, toasts: []};
  const app = createApp('#ws', {mountBacktestFeature(workspace, options) {
    ws = workspace;
    const chart = ws.active.chart;
    const setRange = chart.setVisibleRange.bind(chart);
    chart.setVisibleRange = range => {
      if (trace.failLocate) { trace.failedLocateCalls++; throw Error('Injected chart setVisibleRange failure'); }
      trace.rangeCalls++;
      return setRange(range);
    };
    feature = mountBacktestFeature(workspace, options);
    return feature;
  }});
  const toast = app.workspace.toast.bind(app.workspace);
  app.workspace.toast = (text, kind) => { trace.toasts.push({text, kind}); toast(text, kind); };
  const capture = () => {
    const report = feature.controller.getSnapshot();
    const settings = report?.key ? feature.control.readSettings(report.key) : null;
    return {
      market: ws.active.chart.market,
      range: ws.active.chart.getVisibleRange(),
      activeCell: ws.active.id,
      barCount: ws.active.chart.orchestrator.rawBars.length,
      report: report ? {key: report.key, runId: report.runId, revision: report.revision,
        status: report.status, favorite: report.favorite, metrics: report.metrics,
        tradeCount: report.trades.length, history: report.history, capabilities: report.capabilities} : null,
      settings: settings ? {inputValues: settings.inputValues, propValues: settings.propValues} : null,
      favorites: listIndicatorFavorites().map(({key, name}) => ({key, name})),
      indicators: ws.active.chart.indicators().map(h => ({id: h.id, nativeType: h.nativeType})),
      worker: __quantWorkerAudit.summary(),
      trace,
      storage: {mode: __workspaceStorageFault.mode, denied: {...__workspaceStorageFault.denied},
        workspace: __workspaceStorageFault.persisted('quant-tools:workspace:v2'),
        favorites: __workspaceStorageFault.persisted('vela-pine:indicator-favorites:v1')},
    };
  };
  window.__workspaceFault = {app, ws, feature, trace, capture, destroy: () => app.destroy()};
}'''


def run_case(browser, name, mode, base, output):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, locale='en-US', timezone_id='UTC')
    blocked, requests, errors, checks, messages = [], [], [], [], []
    install_fixed_clock(context)
    context.add_init_script(MOCK_WEBSOCKET_SCRIPT)
    context.add_init_script(WORKER_AUDIT_SCRIPT)
    context.add_init_script('(' + STORAGE_FAULT + ')(' + json.dumps(mode) + ')')
    install_offline_guard(context, blocked)
    install_mock_market_data(context, requests)

    def market_response(route):
        requests.append(route.request.url)
        route.fulfill(status=200, content_type='application/json', body=json.dumps(continuous_klines(route.request.url)))

    context.route('**/klines?*', market_response)
    page = context.new_page()
    page.set_default_timeout(45000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: messages.append({'type': message.type, 'text': message.text}))
    case = name + '-' + mode

    def check(label, value):
        checks.append({'label': label, 'passed': bool(value)})
        assert value, label

    def capture():
        return page.evaluate('__workspaceFault.capture()')

    def stable_report(report):
        """Compare user-visible report semantics, excluding live identity churn.

        A chart locate failure must not mutate the report. A forming candle can
        legitimately advance runId/revision or history timestamps between the
        two snapshots, so those transport/provenance fields are not a useful
        fault-isolation assertion here.
        """
        if report is None:
            return None
        return {key: report.get(key) for key in (
            'key', 'status', 'favorite', 'metrics', 'tradeCount', 'capabilities',
        )}

    def stable_worker(worker):
        """Ignore harmless context reads while checking locate isolation.

        Trades Log navigation must not execute or update Pine. Vela may still
        finish an already queued context read while the chart callback throws,
        so comparing the full audit message list makes this check timing
        dependent.
        """
        by_kind = worker.get('byKind', {}) if worker else {}
        return {kind: by_kind.get(kind, 0) for kind in ('prepare', 'execute', 'update')}

    def settled():
        page.wait_for_function("""() => {
          const report = __workspaceFault.feature.controller.getSnapshot();
          return report?.history?.complete && report.status === 'ready'
            && report.trades.length > 1 && report.capabilities.canSimulate;
        }""")

    def open_viewer(tab='performance'):
        page.get_by_role('button', name='Open backtest viewer', exact=True).click()
        page.locator(f'[data-tab="{tab}"]').click()

    try:
        page.goto(base + '/tests/fixtures/history-live.html', wait_until='domcontentloaded')
        page.evaluate(SETUP)
        # Add the same built-in sample through Vela's public context seam. This
        # keeps the fault probe about Storage/Backtest isolation: Firefox can
        # legitimately keep an indicator catalog's lazy import pending when
        # every Storage prototype method is forcibly replaced with a throw.
        page.evaluate("""() => __workspaceFault.ws.context().addIndicator({
          name: 'SMA Cross (strategy)',
          language: 'pine',
          script: `//@version=6\nstrategy(\"SMA Cross\", overlay=true)\nfastLen = input.int(9, \"Fast Length\")\nslowLen = input.int(21, \"Slow Length\")\nfast = ta.sma(close, fastLen)\nslow = ta.sma(close, slowLen)\nif ta.crossover(fast, slow)\n    strategy.entry(\"Long\", strategy.long)\nif ta.crossunder(fast, slow)\n    strategy.entry(\"Short\", strategy.short)\nplot(fast, \"Fast\", color.aqua)\nplot(slow, \"Slow\", color.fuchsia)`
        })""")
        settled()
        initial = capture()
        check('Workspace and real Worker complete 2,000 bars despite storage mode', initial['barCount'] == 2000)
        check('Report exposes a settled ledger and Simulation', initial['report']['capabilities']['canSimulate'])
        check('The actual Pine Worker executed the strategy', initial['worker']['byKind'].get('execute', 0) > 0)
        open_viewer()
        page.get_by_role('button', name='Save strategy', exact=True).click()
        check('Viewer favorite updates the session repository',
              capture()['report']['favorite'] and len(capture()['favorites']) == 1)
        page.get_by_role('button', name='Return to chart', exact=True).click()
        page.locator('#vela-action-quant-favorites').click()
        check('Favorite remains usable through the legacy toolbar',
              page.locator('.favorite-indicators-popover .quant-popover-item', has_text='SMA Cross').count() == 1)
        page.locator('#vela-action-quant-favorites').click()

        # Commit both strategy tabs through the actual modal and Worker.
        page.get_by_role('button', name='Open strategy settings', exact=True).click()
        dialog = page.locator('.quant-backtest-settings-dialog')
        input_field = dialog.locator('input[data-setting-key][type="number"]').first
        input_key = input_field.get_attribute('data-setting-key')
        input_value = float(input_field.input_value()) + 1
        input_field.fill(str(input_value))
        dialog.get_by_role('tab', name='Properties', exact=True).click()
        capital_field = dialog.locator('input[data-setting-key="initial_capital"]')
        capital = float(capital_field.input_value()) + 1234
        capital_field.fill(str(capital))
        dialog.get_by_role('button', name='Ok', exact=True).click()
        page.wait_for_function('oldRun => __workspaceFault.feature.controller.getSnapshot()?.runId !== oldRun', arg=initial['report']['runId'])
        settled()
        applied = capture()
        check('Settings Inputs and Properties apply while storage is unavailable',
              applied['settings']['inputValues'][input_key] == input_value
              and applied['settings']['propValues']['initial_capital'] == capital)
        check('Settings rerun retains the favorite and usable report',
              applied['report']['favorite'] and applied['report']['tradeCount'] > 1)
        page.get_by_role('button', name='Open strategy settings', exact=True).click()
        check('Reopening Settings reads live applied parameters',
              float(dialog.locator(f'input[data-setting-key="{input_key}"]').input_value()) == input_value)
        dialog.get_by_role('button', name='Cancel', exact=True).click()

        open_viewer()
        for tab in ['performance', 'analysis', 'simulation', 'log']:
            page.locator(f'[data-tab="{tab}"]').click()
            check(f'{tab} remains a visible usable report tab',
                  page.locator(f'[data-tab="{tab}"]').get_attribute('aria-selected') == 'true'
                  and page.locator('#quant-backtest-panel').inner_text().strip() != '')
        before_locate = capture()
        request_count = len(requests)
        page.evaluate('__workspaceFault.trace.failLocate = true')
        locate = page.locator('[data-trade-locate="entry"]').first
        locate.locator('xpath=ancestor::tr').hover()
        locate.click()
        check('The actual Trades Log action closes Viewer without escaping its failure',
              page.locator('.quant-backtest-viewer').is_hidden() and capture()['trace']['failedLocateCalls'] == 1)
        error_toast = page.locator('.vela-toast[data-type="error"][data-open]')
        error_toast.wait_for(state='visible')
        check('Chart-location failure is visible to the user', 'Unable to locate entry on chart' in error_toast.inner_text())
        failed = capture()
        check('Failed location preserves requested market, active Cell and chart range',
              all(failed[key] == before_locate[key] for key in ['market', 'activeCell', 'range']))
        check('Failed location preserves Settings, favorite and report results',
              failed['settings'] == before_locate['settings'] and failed['favorites'] == before_locate['favorites']
              and stable_report(failed['report']) == stable_report(before_locate['report']))
        check('Failed location performs no new Provider request or transient annotation',
              len(requests) == request_count and failed['indicators'] == before_locate['indicators'])
        check('Failed location does not execute or update the Pine Worker',
              stable_worker(failed['worker']) == stable_worker(before_locate['worker']))
        page.screenshot(path=str(output / (case + '-visible-location-error.png')))
        page.evaluate('__workspaceFault.trace.failLocate = false')
        open_viewer('log')
        page.locator('.quant-backtest-trade-table tbody tr').first.wait_for(state='visible')
        check('Viewer and Trades Log reopen after location failure', page.locator('.quant-backtest-trade-table tbody tr').count() > 1)
        entry = page.locator('[data-trade-locate="entry"]').first
        entry.focus()
        page.keyboard.press('Enter')
        page.wait_for_function("__workspaceFault.ws.active.chart.indicators().some(h => h.nativeType === 'quant-backtest-execution-highlight')")
        # Successful navigation changes the chart range and may publish a
        # transient partial context before the same strategy settles again.
        # Assert the recovered report after that normal lifecycle, rather than
        # racing the first post-navigation snapshot.
        settled()
        recovered = capture()
        recovered_ok = (recovered['market'] == before_locate['market']
              and recovered['settings'] == before_locate['settings']
              and stable_report(recovered['report']) == stable_report(before_locate['report']))
        check('Actual keyboard locate recovers on the same market and parameters', recovered_ok)
        page.locator('#vela-tool-vela-widget-panel-quant-pine-editor').click()
        page.locator('.cm-content').wait_for(state='visible')
        check('Legacy Pine Editor and chart remain usable', page.locator('#ws canvas:visible').count() > 0)
        # Autosave is debounced. Wait on observable writes, not an assumed delay.
        if mode == 'none':
            page.wait_for_function("__workspaceStorageFault.persisted('quant-tools:workspace:v2') !== null")
        else:
            page.wait_for_function('Object.values(__workspaceStorageFault.denied).some(count => count > 0)')
        final = capture()
        if mode != 'none':
            check('Injected storage denial was exercised by the app', sum(final['storage']['denied'].values()) > 0)
            check('Session fallback does not claim durable storage writes',
                  final['storage']['workspace'] is None and final['storage']['favorites'] is None)
        else:
            check('Control case writes normal Workspace and favorite storage',
                  final['storage']['workspace'] is not None and final['storage']['favorites'] is not None)
        page.evaluate('__workspaceFault.destroy()')
        check('Destroy releases Workspace canvas, Viewer and editor',
              page.locator('#ws canvas,.quant-backtest-workbench,.cm-editor').count() == 0)
        check('No uncaught browser errors or unhandled external requests', errors == [] and blocked == [])
        record = {'name': case, 'checks': checks, 'initial': initial, 'applied': applied,
                  'failedLocate': failed, 'recovered': recovered, 'final': final,
                  'pageErrors': errors, 'blockedExternalRequests': blocked, 'console': messages, 'passed': True}
        (output / (case + '.json')).write_text(json.dumps(record, indent=2) + '\n')
        return {'name': case, 'checks': len(checks), 'passed': True}
    except Exception as error:
        page.screenshot(path=str(output / (case + '-failure.png')))
        (output / (case + '-failure.json')).write_text(json.dumps({
            'name': case, 'error': str(error), 'checks': checks, 'pageErrors': errors, 'console': messages,
            'state': page.evaluate('window.__workspaceFault?.capture() ?? null'),
        }, indent=2) + '\n')
        raise
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'audit-evidence/2026-10-07-workspace-fault-isolation-final')
    parser.add_argument('--browsers', default='chromium,firefox')
    parser.add_argument('--storage-modes', default='none,getter,methods,quota')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    sources = [ROOT / name for name in [
        'src/app/create-app.ts', 'src/app/backtest-feature.ts', 'src/features/backtesting/backtest-workbench.ts',
        'src/integrations/vela/backtest-results-adapter.ts',
        'src/integrations/storage/json-store.ts', 'src/integrations/storage/workspace-storage.ts',
        'src/integrations/vela/backtest-chart-adapter.ts', 'tests/e2e_workspace_fault_isolation.py',
    ]]
    hashes = lambda: {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    before = hashes()
    results = []
    with serve(None, args.output / 'results.json') as base, sync_playwright() as playwright:
        for name in args.browsers.split(','):
            browser = getattr(playwright, name).launch()
            try:
                for mode in args.storage_modes.split(','):
                    result = run_case(browser, name, mode, base, args.output)
                    results.append(result)
                    print(json.dumps(result), flush=True)
            finally:
                browser.close()
    after = hashes()
    assert before == after, 'Fault-test inputs changed during this run'
    result = {'cases': results, 'checks': sum(row['checks'] for row in results),
              'sourceHashes': after, 'sourceUnchanged': True, 'passed': True}
    (args.output / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'cases': len(results), 'checks': result['checks'], 'passed': True}))


if __name__ == '__main__':
    main()
