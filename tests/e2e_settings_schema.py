"""Typed Pine settings through real PineEngine/PineWorkerEngine and DOM controls.

The schema comes from a real script prepare, never an invented snapshot. Only
the extra conditional DTO cases are explicitly synthetic integration inputs.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SOURCE = '''//@version=6
strategy("Settings schema audit", overlay=true, initial_capital=100000)
length=input.int(9,"Length",options=[5,9,21],group="Numeric")
ratio=input.float(1.5,"Ratio",options=[0.5,1.5,2.5],group="Numeric")
enabled=input.bool(true,"Enabled",group="Inline",inline="a",tooltip="Enable trading")
price=input.price(100.0,"Price",group="Numeric")
shade=input.color(color.new(color.teal,25),"Shade",group="Inline",inline="a",tooltip="Color hint")
textValue=input.string("alpha","Text",group="Text")
choice=input.string("B","Choice",options=["A","B","C"],group="Text")
notes=input.text_area("line 1\\nline 2","Notes",group="Text")
src=input.source(close,"Source",group="Market")
tf=input.timeframe("15","Timeframe",group="Market")
symbol=input.symbol("BINANCE:BTCUSDT","Symbol",group="Market")
session=input.session("0930-1600:23456","Session",group="Time")
start=input.time(1704067200000,"Start",group="Time")
fast=ta.sma(src,length)
if enabled and bar_index == 3
    strategy.entry("Long",strategy.long)
if bar_index == 12
    strategy.close("Long")
plot(length,title="LengthValue")
plot(ratio,title="RatioValue")
plot(start,title="StartValue")
plot(src,title="SourceValue")
plot(tf == "60" ? 1 : 0,title="TimeframeValue")
plot(session == "1000-1600:23456" ? 1 : 0,title="SessionValue")
plot(price,title="PriceValue")
plot(enabled ? 1 : 0,title="EnabledValue")
plot(textValue == "gamma" ? 1 : 0,title="TextValue")
plot(choice == "C" ? 1 : 0,title="ChoiceValue")
plot(symbol == "BINANCE:ETHUSDT" ? 1 : 0,title="SymbolValue")
plot(notes == "edited\\nsecond line" ? 1 : 0,title="NotesValue")
plot(fast,color=shade)
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
    parser.add_argument('--base')
    parser.add_argument('--mobile', action='store_true', help='Optional prior-scope mobile geometry check; excluded from the current desktop gate.')
    parser.add_argument('--output', type=Path, default=Path('/tmp/quant-settings-schema'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    base = args.base or 'http://127.0.0.1:5388'
    server = None
    result = {'browser': args.browser, 'engines': [], 'pageErrors': [], 'windowErrors': []}
    try:
        if not args.base:
            server = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--config', 'tests/vite-performance.config.ts',
                '--host', '127.0.0.1', '--port', '5388', '--strictPort'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            deadline = time.monotonic() + 45
            while True:
                if server.poll() is not None: raise RuntimeError('Settings schema Vite exited')
                try:
                    if urlopen(base, timeout=1).status == 200: break
                except OSError: pass
                if time.monotonic() > deadline: raise TimeoutError('Settings schema Vite startup timed out')
                time.sleep(.1)
        with sync_playwright() as pw:
            browser = getattr(pw, args.browser).launch()
            try:
                page = browser.new_page(viewport={'width': 1440, 'height': 1000}, locale='en-US', timezone_id='UTC')
                page.on('pageerror', lambda error: result['pageErrors'].append(str(error)))
                page.add_init_script('window.__schemaWindowErrors=[];addEventListener("error",e=>window.__schemaWindowErrors.push(e.message));')
                page.route('**/__settings_schema__', lambda route: route.fulfill(content_type='text/html', body='''
                  <!doctype html><html><head><link rel="icon" href="data:,"><link rel="stylesheet" href="/src/style.css"></head>
                  <body><main id="host" class="quant-backtest-workbench" style="position:fixed;inset:0"></main></body></html>'''))
                page.goto(base+'/__settings_schema__')
                for engine in ['PineEngine', 'PineWorkerEngine']:
                    prepared = page.evaluate('''async ({source,engineName}) => {
                      await import('/src/features/backtesting/backtest.css');
                      const { StrategySettingsPanel } = await import('/src/features/backtesting/strategy-settings.ts');
                      const { velaSettingsControls } = await import('/src/integrations/vela/settings-controls.ts');
                      const engines=await import('/packages/vela-pinets/dist/index.js');
                      const engine=new engines[engineName]();
                      const prepared=await engine.prepare(source,'schema');
                      const bars=Array.from({length:40},(_,i)=>({time:1704067200000+i*900000,
                        open:100+i,high:103+i,low:98+i,close:101+i,volume:10}));
                      const snapshot={key:{cellId:'schema-cell',indicatorId:'schema'},title:'Settings schema audit',visible:true,
                        inputs:prepared.inputs,props:prepared.props,inputValues:{},propValues:{}};
                      const state={engine,prepared,snapshot,applied:[],models:[],errors:[],session:null};
                      const panel=new StrategySettingsPanel(document,{controls:velaSettingsControls,onApply:async(_s,inputs,props)=>{
                        state.applied.push({inputs,props});
                        await new Promise((resolve,reject)=>{
                          state.session?.stop();
                          state.session=engine.execute({prepared,inputs,props,bars,mode:'static',historyState:'complete',
                            market:{symbol:'BTCUSDT',timeframe:'15'}},{onModel:model=>{state.models.push(model);resolve();},
                            onError:error=>{state.errors.push(error.message);reject(error);}});
                        });
                        return true;
                      }});
                      state.panel=panel;window.__schema=state;
                      document.querySelector('#host').append(panel.element);panel.open(snapshot);
                      return {inputs:prepared.inputs,props:prepared.props};
                    }''', {'source': SOURCE, 'engineName': engine})
                    assert len({field['type'] for field in prepared['inputs']}) == 12
                    dialog = page.locator('.quant-backtest-settings-dialog')
                    assert dialog.locator('[data-setting-inline="a"] [data-setting-key="enabled"]').count() == 2
                    assert dialog.locator('.quant-backtest-settings-group').count() == 5, 'Repeated groups must share one section'
                    hint = dialog.get_by_role('button', name='Color hint', exact=True)
                    hint.hover()
                    assert page.get_by_role('tooltip').inner_text() == 'Color hint'
                    page.mouse.move(0, 0)
                    assert dialog.locator('[data-field-type="text_area"]').evaluate('(e)=>getComputedStyle(e).gridColumn') == '1 / -1'
                    for title, option in [('Length', '21'), ('Ratio', '2.5'), ('Source', 'open'), ('Timeframe', '1 hour'), ('Choice', 'C')]:
                        dialog.get_by_role('combobox', name=title, exact=True).click()
                        page.get_by_role('listbox', name=title, exact=True).get_by_role('option', name=option, exact=True).click()
                    dialog.locator('input[data-setting-key="price"]').fill('125.5')
                    dialog.locator('input[data-setting-key="price"]').press('Tab')
                    dialog.locator('input[data-setting-key="enabled"]').uncheck()
                    dialog.locator('input[data-setting-key="textValue"]').fill('gamma')
                    dialog.locator('input[data-setting-key="textValue"]').press('Tab')
                    dialog.get_by_label('Start date', exact=True).fill('2024-01-02')
                    dialog.get_by_label('Start date', exact=True).press('Tab')
                    dialog.get_by_label('Start time', exact=True).fill('1015')
                    dialog.get_by_label('Start time', exact=True).press('Tab')
                    dialog.get_by_label('Session start', exact=True).fill('10:00')
                    dialog.get_by_label('Session start', exact=True).press('Tab')
                    # Invalid typed values revert without erasing the last valid draft.
                    dialog.get_by_label('Session end', exact=True).fill('99:99')
                    dialog.get_by_label('Session end', exact=True).press('Tab')
                    assert dialog.get_by_label('Session end', exact=True).input_value() == '16:00'
                    dialog.get_by_label('Start date', exact=True).fill('2024-02-30')
                    dialog.get_by_label('Start date', exact=True).press('Tab')
                    assert dialog.get_by_label('Start date', exact=True).input_value() == '2024-01-02'
                    dialog.locator('textarea[data-setting-key="notes"]').fill('edited\nsecond line')
                    dialog.locator('textarea[data-setting-key="notes"]').press('Tab')
                    dialog.locator('input[data-setting-key="symbol"]').fill('BINANCE:ETHUSDT')
                    dialog.locator('input[data-setting-key="symbol"]').press('Tab')
                    dialog.get_by_role('button', name='Shade', exact=True).click()
                    picker = page.get_by_role('dialog', name='Shade color', exact=True)
                    assert picker.is_visible()
                    picker.locator('button[data-c]').first.click()
                    opacity = picker.get_by_role('slider', name='Opacity', exact=True)
                    opacity.focus(); opacity.press('Home'); opacity.press('PageUp')
                    assert opacity.get_attribute('aria-valuenow') == '10'
                    page.keyboard.press('Escape')
                    assert dialog.is_visible() and not picker.count(), 'First Escape should dismiss only color picker'
                    dialog.get_by_role('button', name='Open calendar for Start date', exact=True).click()
                    calendar = page.get_by_role('dialog', name='Start date calendar', exact=True)
                    calendar.get_by_role('button', name='Choose year', exact=True).click()
                    calendar.get_by_role('button', name='2024', exact=True).click()
                    calendar.get_by_role('button', name='January', exact=True).click()
                    calendar.get_by_role('button', name='2024-01-03', exact=True).click()
                    assert dialog.get_by_label('Start date', exact=True).input_value() == '2024-01-03'
                    dialog.get_by_role('tab', name='Properties', exact=True).click()
                    assert len(prepared['props']) == 31
                    for prop in prepared['props']:
                        assert dialog.locator('input[data-setting-key="'+prop['key']+'"],select[data-setting-key="'+prop['key']+'"]') .count() == 1, prop
                    dialog.locator('input[data-setting-key="initial_capital"]').fill('200000')
                    dialog.locator('input[data-setting-key="initial_capital"]').press('Tab')
                    dialog.locator('input[data-setting-key="behind_chart"]').uncheck()
                    dialog.get_by_role('combobox', name='Currency', exact=True).click()
                    page.get_by_role('listbox', name='Currency', exact=True).get_by_role('option', name='EUR', exact=True).click()
                    assert dialog.get_by_role('combobox', name='Backtest precision', exact=True).inner_text().strip() == 'Default precision'
                    # Plain Apply crosses the real engine with typed primitives.
                    dialog.get_by_role('button', name='Ok', exact=True).click()
                    page.wait_for_function('window.__schema.applied.length===1 && window.__schema.models.length===1 && !window.__schema.panel.isOpen')
                    first = page.evaluate('''() => ({applied:window.__schema.applied,models:window.__schema.models,errors:window.__schema.errors})''')
                    (args.output/f'{args.browser}-{engine}-run.json').write_text(json.dumps({'prepared':prepared,'run':first},indent=2)+'\n')
                    applied = first['applied'][0]['inputs']
                    assert applied['length'] == 21 and applied['ratio'] == 2.5
                    assert applied['start'] == 1704276900000, applied['start']
                    session_key = next(field['key'] for field in prepared['inputs'] if field['type'] == 'session')
                    assert applied[session_key] == '1000-1600:23456'
                    assert applied['notes'] == 'edited\nsecond line' and applied['symbol'] == 'BINANCE:ETHUSDT'
                    assert applied['shade'].lower().endswith('1a'), applied['shade']
                    assert not first['errors']
                    assert first['applied'][0]['props'] == {'initial_capital':200000,'behind_chart':False,'currency':'EUR'}
                    model = first['models'][0]
                    assert all(model['propValues'][key] == value for key,value in first['applied'][0]['props'].items())
                    for key in ['length', 'ratio', 'start', session_key, 'src', 'tf', 'notes', 'symbol']:
                        assert model['inputValues'][key] == applied[key], (key, model['inputValues'], applied)
                    series = {item['title']:item['points'] for item in model['series']}
                    for title, expected in [('LengthValue',21),('RatioValue',2.5),('StartValue',1704276900000),
                                            ('TimeframeValue',1),('SessionValue',1),('PriceValue',125.5),
                                            ('EnabledValue',0),('TextValue',1),('ChoiceValue',1),('SymbolValue',1),('NotesValue',1)]:
                        assert len(series[title]) == 40 and all(point['value'] == expected for point in series[title]), (title,series[title])
                    assert [point['value'] for point in series['SourceValue']] == [100+i for i in range(40)]
                    assert model['series'][-1]['style']['color'].lower() == applied['shade'].lower()
                    # Reset is draft-only until Ok; Cancel never executes an engine run.
                    page.evaluate('window.__schema.panel.open({...window.__schema.snapshot,inputValues:window.__schema.applied[0].inputs})')
                    dialog.get_by_role('button', name='Reset defaults', exact=True).click()
                    assert page.evaluate('window.__schema.applied.length') == 1
                    assert dialog.get_by_role('combobox', name='Length', exact=True).inner_text().strip() == '9'
                    dialog.get_by_role('button', name='Cancel', exact=True).click()
                    assert page.evaluate('window.__schema.applied.length') == 1
                    page.evaluate('window.__schema.panel.open(window.__schema.snapshot)')
                    if args.mobile: page.set_viewport_size({'width':390,'height':844})
                    dialog.get_by_label('Start date', exact=True).scroll_into_view_if_needed()
                    bounds = dialog.bounding_box()
                    if args.mobile: assert bounds['x'] >= 0 and bounds['x']+bounds['width'] <= 391
                    assert dialog.evaluate('(e)=>e.scrollWidth<=e.clientWidth'), 'Dialog horizontal overflow'
                    native_style = dialog.evaluate('''(dialog, keys) => {
                      const controls=keys.map(key=>dialog.querySelector('.quant-backtest-settings-field[data-setting-key="'+key+'"]')?.children[1]);
                      const color=getComputedStyle(dialog.querySelector('.quant-backtest-settings-color-trigger'));
                      const textarea=getComputedStyle(dialog.querySelector('textarea'));
                      const check=getComputedStyle(dialog.querySelector('input[type="checkbox"]'),'::after');
                      return {columns:controls.map(control=>({left:control.getBoundingClientRect().left,width:control.getBoundingClientRect().width})),
                        color:{width:color.width,height:color.height,padding:color.padding,borderRadius:color.borderRadius},
                        textareaPadding:textarea.padding,checkboxMask:decodeURIComponent(check.maskImage)};
                    }''', ['length', 'price', 'textValue', 'src', 'tf', session_key, 'start'])
                    assert max(item['left'] for item in native_style['columns']) - min(item['left'] for item in native_style['columns']) < 1, native_style
                    assert native_style['color'] == {'width':'26px','height':'26px','padding':'3px','borderRadius':'4px'}, native_style
                    assert native_style['textareaPadding'] == '8px', native_style
                    assert 'M3.2 8.1 6.3 11.2' in native_style['checkboxMask'] and 'M6.3 11.2 12.8 4.7' in native_style['checkboxMask'], native_style
                    assert "stroke-width='1.7'" in native_style['checkboxMask'], native_style
                    temporal_bounds = dialog.locator('.quant-backtest-settings-combo').evaluate_all('''nodes => nodes.map(node => {
                      const input=node.querySelector('input'), icon=node.querySelector('button'),
                        field=input.getBoundingClientRect(), button=icon.getBoundingClientRect();
                      return {label:input.getAttribute('aria-label'), paddingRight:getComputedStyle(input).paddingRight,
                        input:{left:field.left,right:field.right,top:field.top,bottom:field.bottom},
                        icon:{left:button.left,right:button.right,top:button.top,bottom:button.bottom}};
                    })''')
                    for control in temporal_bounds:
                        assert control['paddingRight'] == '26px', control
                        field, icon = control['input'], control['icon']
                        assert field['left'] <= icon['left'] and icon['right'] <= field['right'] + 1, control
                        assert field['top'] <= icon['top'] and icon['bottom'] <= field['bottom'] + 1, control
                    mode = 'mobile' if args.mobile else 'desktop'
                    page.screenshot(path=str(args.output/f'{args.browser}-{engine}-{mode}.png'))
                    result['engines'].append({'engine':engine,'prepared':prepared,'firstRun':first,'viewportMode':mode,'dialog':bounds,'temporalGeometry':temporal_bounds,'nativeControlStyles':native_style})
                    page.evaluate('''() => { const s=window.__schema;s.panel.destroy();s.session?.stop();s.engine.terminate?.(); }''')
                    page.set_viewport_size({'width':1440,'height':1000})
                result['windowErrors'] = page.evaluate('window.__schemaWindowErrors')
                assert not result['pageErrors'] and not result['windowErrors'], result
            finally:
                browser.close()
    finally:
        if server: server.terminate(); server.wait(timeout=10)
        (args.output/f'{args.browser}-results.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'browser':args.browser,'engines':len(result['engines']),'pageErrors':result['pageErrors'],'windowErrors':result['windowErrors']}))


if __name__ == '__main__': main()
