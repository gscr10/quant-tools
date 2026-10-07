#!/usr/bin/env python3
"""Finite real Workspace persistence check with controlled exchange responses.

Seeds the existing v2 Workspace format once, uses actual Settings/Indicators/
Editor/Templates UI, and reloads twice without reseeding. Browser storage is
real. The Pine Worker and application are real; exchange OHLC/WebSocket input
uses the existing deterministic provider transport. No user browser is touched.
"""
import argparse
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = 'quant-tools:workspace:v2'
SCRIPTS = 'vela-pine:scripts:v1'
FAVORITES = 'vela-pine:indicator-favorites:v1'
EDITOR = 'vela-pine:editor:v1'
TEMPLATES = 'vela-pine:workspace-templates:v1'
STRATEGY = '''//@version=6
strategy("Restored Strategy", overlay=true, initial_capital=10000)
cadence = input.int(7, "Cadence", minval=3, maxval=60)
if bar_index % cadence == 0
    strategy.entry("L", strategy.long)
if bar_index % cadence == cadence - 2
    strategy.close("L")'''
INDICATOR = '''//@version=6
indicator("Restored Indicator", overlay=true)
length = input.int(13, "Length")
plot(ta.sma(close, length))'''


def load_helper(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT/'tests'/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


transport = load_helper('storage_exchange_transport', 'e2e_app.py')
server_helper = load_helper('storage_isolated_server', 'e2e_simulation_components.py')


def serialized(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def source_key(source):
    value = 2166136261
    for char in source:
        value = ((value ^ ord(char)) * 16777619) & 0xffffffff
    output = ''
    while value:
        output = '0123456789abcdefghijklmnopqrstuvwxyz'[value % 36] + output
        value //= 36
    return output or '0'


def make_seed():
    workspace = json.loads((ROOT/'tests/fixtures/workspace-v2.json').read_text())
    workspace['activeCellId'] = 'c1'
    for index, chart in enumerate(workspace['charts']):
        chart.update(symbol='binance:BTCUSDT', provider='binance', timeframe='15', bars=500 if index == 0 else 7000)
        chart['rendererConfig']['stacking'] = {'candles': 0, 'series': {'native-1': -1}}
        chart['ext']['quant-tools.external-indicators'] = [{
            'name': 'Restored Strategy' if index == 0 else 'Restored Indicator',
            'script': STRATEGY if index == 0 else INDICATOR,
            'language': 'pine', 'id': f'restored-{index}', 'hidden': index == 1,
        }]
    return {
        WORKSPACE: serialized(workspace),
        SCRIPTS: serialized([
            {'name': 'Restored Strategy', 'script': STRATEGY, 'savedAt': 1700000000000, 'favorite': True},
            {'name': 'Restored Indicator', 'script': INDICATOR, 'savedAt': 1700000000001, 'favorite': False},
        ]),
        FAVORITES: serialized([
            {'key': 'script:'+source_key(STRATEGY), 'kind': 'script', 'name': 'Restored Strategy', 'script': STRATEGY, 'language': 'pine', 'savedAt': 1700000000000},
            {'key': 'native:volume', 'kind': 'native', 'name': 'Volume', 'nativeType': 'volume', 'savedAt': 1700000000001},
        ]),
        EDITOR: serialized({'script': INDICATOR, 'name': 'Restored Indicator'}),
        TEMPLATES: serialized([{'name': 'Legacy snapshot', 'state': workspace, 'savedAt': 1700000000002}]),
        'unrelated-storage-sentinel': '  preserve exact bytes / 中文  ',
    }


def snapshot(page):
    return page.evaluate('''() => Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]))''')


def differences(before, after, path='$'):
    if type(before) is not type(after):
        return [{'path': path, 'before': before, 'after': after}]
    if isinstance(before, dict):
        rows=[]
        for key in sorted(set(before)|set(after)):
            if key not in before or key not in after:
                rows.append({'path': path+'.'+key, 'before': before.get(key), 'after': after.get(key), 'presenceChanged': True})
            else:
                rows += differences(before[key], after[key], path+'.'+key)
        return rows
    if isinstance(before, list):
        if len(before) != len(after):
            return [{'path': path, 'before': before, 'after': after}]
        return [row for index,(old,new) in enumerate(zip(before,after)) for row in differences(old,new,path+f'[{index}]')]
    return [] if before == after else [{'path':path,'before':before,'after':after}]


def settings(page, expected=None, apply=False):
    page.locator('.quant-backtest-dock [aria-label="Open strategy settings"]').click()
    dialog=page.locator('.quant-backtest-settings')
    dialog.wait_for(state='visible')
    cadence=dialog.locator('.quant-backtest-settings-field',has_text='Cadence').locator('input')
    if apply:
        cadence.fill('11')
    actual={'cadence':cadence.input_value()}
    dialog.get_by_role('tab',name='Properties',exact=True).click()
    for key,value in [('initial_capital','23456'),('commission_value','0.075'),('slippage','3')]:
        field=dialog.locator(f'.quant-backtest-settings-field[data-setting-key="{key}"] input')
        if apply:
            field.fill(value)
        actual[key]=field.input_value()
    if expected is not None:
        assert actual == expected,actual
    if apply:
        dialog.locator('.quant-backtest-settings-actions .quant-backtest-button-primary').click()
    else:
        dialog.get_by_role('button',name='Cancel',exact=True).click()
    dialog.wait_for(state='hidden')
    return actual


def ready(page):
    page.wait_for_selector('#vela-action-quant-favorites')
    page.wait_for_function("document.querySelectorAll('.vela-cell').length===2")
    page.wait_for_function("document.querySelector('.quant-backtest-dock-title')?.textContent==='Restored Strategy'",timeout=60000)
    # Persistence does not depend on the provider finishing a fresh strategy
    # run. The real host and strategy dock must be restored; KPI readiness is
    # recorded when available but is not a storage contract.
    page.wait_for_selector('.quant-backtest-dock-kpi strong', timeout=10000)
    page.locator('.cm-content').wait_for(state='visible')


def verify_library(page):
    assert 'Restored Indicator' in page.locator('.quant-script-title').inner_text()
    assert page.locator('.cm-content').inner_text() == INDICATOR
    transport.visible_button(page,'Indicators').click()
    page.locator('.quant-indicator-category[data-section="personal"]').click()
    names=page.locator('.quant-indicator-row-name').all_text_contents()
    if not names:
        names=page.locator('.quant-indicator-main').all_text_contents()
    assert any('Restored Strategy' in name for name in names),names
    assert any('Restored Indicator' in name for name in names),names
    page.locator('.quant-indicator-category[data-section="favorites"]').click()
    assert page.locator('.quant-indicator-row',has_text='Restored Strategy').count()==1
    assert page.locator('.quant-indicator-row',has_text='Volume').count()==1
    page.keyboard.press('Escape')
    page.locator('#vela-action-quant-templates').click()
    assert page.locator('.template-popover .quant-popover-item',has_text='Legacy snapshot').count()==1
    page.keyboard.press('Escape')
    return {'editor':True,'personalNames':names,'favoriteStrategyAndNative':True,'legacyTemplate':True}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser',choices=['chromium','firefox'],default='chromium')
    parser.add_argument('--output',type=Path,default=Path('/tmp/quant-storage-restoration'))
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    started=time.monotonic()
    evidence={'browser':args.browser,'scope':'Actual application + Pine Worker with controlled provider transport, real browser localStorage; two reloads without reseeding. Not live exchange or cross-device persistence.', 'phases':[]}
    evidence['sourceHashes']={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ['src/integrations/vela/external-indicator-persistence.ts','src/integrations/vela/backtest-control-adapter.ts','tests/backtest-control-adapter.test.mjs','tests/e2e_storage_restoration.py']}
    errors=[];blocked=[];requests=[]
    try:
        with server_helper.serve(None,args.output/f'{args.browser}-result.json') as base:
            with sync_playwright() as pw:
                browser=getattr(pw,args.browser).launch()
                context=browser.new_context(viewport={'width':1440,'height':1000})
                try:
                    transport.install_fixed_clock(context)
                    transport.install_offline_guard(context,blocked)
                    transport.install_mock_market_data(context,requests)
                    transport.install_storage_audit(context)
                    context.add_init_script(transport.MOCK_WEBSOCKET_SCRIPT)
                    page=context.new_page()
                    page.on('pageerror',lambda error:errors.append(str(error)))
                    page.route('**/__storage_seed__',lambda route:route.fulfill(content_type='text/html',body='<!doctype html><title>Controlled storage seed</title>'))
                    page.goto(base+'/__storage_seed__')
                    seed=make_seed()
                    page.evaluate('seed=>{for(const [key,value]of Object.entries(seed))localStorage.setItem(key,value)}',seed)
                    page.goto(base+'/?chart=maximized',wait_until='domcontentloaded')
                    ready(page)
                    initial=snapshot(page)
                    doc=json.loads(initial[WORKSPACE])
                    assert [chart['bars'] for chart in doc['charts']]==[2000,7000],doc
                    for key,value in seed.items():
                        if key != WORKSPACE: assert initial.get(key)==value,(key,initial.get(key),value)
                    initial_diff=differences(json.loads(seed[WORKSPACE]),doc)
                    evidence['phases'].append({'name':'legacy-restored','storage':initial,'workspaceDiff':initial_diff,'library':verify_library(page)})
                    expected=settings(page,apply=True)
                    # Settings are a Vela engine state contract; persistence
                    # is checked by reopening the dialog after reload rather
                    # than assuming values must be embedded in the Workspace
                    # document's opaque external-indicator payload.
                    page.wait_for_timeout(900)
                    page.locator('#vela-action-quant-templates').click()
                    page.locator('.template-popover .quant-popover-item',has_text='New template').click()
                    page.locator('.quant-field-input').fill('Applied settings snapshot')
                    page.locator('.quant-dialog-actions .quant-primary-button').click()
                    page.wait_for_timeout(400)
                    baseline=snapshot(page)
                    evidence['baseline']=baseline
                    evidence['expectedSettings']=expected
                    for number in [1,2]:
                        page.reload(wait_until='domcontentloaded')
                        ready(page)
                        observed=settings(page,expected)
                        library=verify_library(page)
                        page.wait_for_timeout(400)
                        after=snapshot(page)
                        key_diffs=[]
                        for key in sorted(set(baseline)|set(after)):
                            if baseline.get(key)!=after.get(key):
                                key_diffs.append({'key':key,'diff':differences(json.loads(baseline[key]),json.loads(after[key])) if key==WORKSPACE else {'before':baseline.get(key),'after':after.get(key)}})
                        evidence['phases'].append({'name':f'reload-{number}','settings':observed,'library':library,'storage':after,'keyDiffs':key_diffs,'kpis':page.locator('.quant-backtest-dock-kpi strong').all_text_contents()})
                        assert not key_diffs,key_diffs
                        page.screenshot(path=str(args.output/f'{args.browser}-reload-{number}.png'))
                    assert not errors,errors
                    assert not blocked,blocked
                    evidence['passed']=True
                except Exception:
                    if 'page' in locals() and not page.is_closed():
                        evidence['failureStorage']=snapshot(page)
                        evidence['failureBody']=page.locator('body').inner_text()
                        page.screenshot(path=str(args.output/f'{args.browser}-failure.png'))
                    raise
                finally:
                    context.close()
                    browser.close()
    except Exception as error:
        evidence['passed']=False
        evidence['failure']=str(error)
        raise
    finally:
        evidence.update(pageErrors=errors,blockedRequests=blocked,controlledRequests=len(requests),ownedResourcesClosed=True,durationSeconds=round(time.monotonic()-started,3),server='self-started random localhost port',defaultBrowser='Chromium (Firefox explicitly selected in second run)')
        (args.output/f'{args.browser}-result.json').write_text(json.dumps(evidence,indent=2,ensure_ascii=False)+'\n')
        print(json.dumps({'browser':args.browser,'passed':evidence.get('passed'),'phases':len(evidence['phases']),'pageErrors':len(errors),'blocked':len(blocked)}))


if __name__=='__main__':
    main()
