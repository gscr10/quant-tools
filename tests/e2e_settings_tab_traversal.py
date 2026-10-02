#!/usr/bin/env python3
"""R-09: traverse naturally from modal entry; never seed a boundary control."""
import argparse
import json
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--port', type=int, default=5283)
parser.add_argument('--width', type=int, default=390)
parser.add_argument('--height', type=int, default=844)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
base = f'http://127.0.0.1:{args.port}'
results = []
with (args.output / 'vite.log').open('w') as log:
    server = subprocess.Popen([str(ROOT / 'node_modules/.bin/vite'), '--host', '127.0.0.1',
                               '--port', str(args.port), '--strictPort', '--config',
                               'tests/vite-settings-keyboard.config.ts'], cwd=ROOT, stdout=log, stderr=log)
    try:
        for _ in range(150):
            if server.poll() is not None:
                raise RuntimeError('Private Vite failed')
            try:
                if urlopen(base, timeout=1).status == 200:
                    break
            except OSError:
                time.sleep(.2)
        with sync_playwright() as pw:
            for name in ['chromium', 'firefox', 'webkit']:
                browser = getattr(pw, name).launch()
                try:
                    for mode in ['default', 'explicit-button-tabindex']:
                        page = browser.new_page(viewport={'width':args.width, 'height':args.height})
                        errors = []
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        page.route('**/__r09__', lambda route: route.fulfill(content_type='text/html', body='''
                          <html><body><button id="open">Open</button><button id="outside">Outside</button>
                          <main id="host"></main><main id="host2"></main></body></html>'''))
                        page.goto(base + '/__r09__')
                        page.evaluate('''async()=>{
                          await import('/src/features/backtesting/backtest.css');
                          const {StrategySettingsPanel}=await import('/src/features/backtesting/strategy-settings.ts');
                          window.Settings=StrategySettingsPanel;
                          window.snapshot={key:{cellId:'r09',indicatorId:'sma'},title:'R09 keyboard',
                            inputs:[{key:'length',title:'Length',type:'int',defval:9},
                              {key:'choice',title:'Choice',type:'string',defval:'A',options:['A','B']}],
                            props:[{key:'initial_capital',title:'Capital',type:'float',defval:10000}],
                            inputValues:{length:9,choice:'A'},propValues:{initial_capital:10000}};
                          window.panel=new Settings(document,{onApply:()=>new Promise(r=>window.finishApply=r)});
                          document.querySelector('#host').append(panel.element);
                          document.querySelector('#open').onclick=()=>panel.open(snapshot);
                        }''')
                        if mode == 'explicit-button-tabindex':
                            page.evaluate("document.querySelectorAll('.quant-backtest-settings button:not([tabindex])').forEach(e=>e.tabIndex=0)")
                        row = {'browser':name, 'version':browser.version, 'mode':mode,
                               'viewport':{'width':args.width,'height':args.height}, 'checks':{}, 'traces':{}}
                        def open_panel(empty=False):
                            page.evaluate('panel.close()')
                            if empty:
                                page.evaluate('panel.open({...snapshot,inputs:[],props:[],inputValues:{},propValues:{}})')
                            else:
                                page.locator('#open').click()
                            page.wait_for_timeout(10)
                        def trace(label, key, count=24):
                            steps = []
                            for i in range(count + 1):
                                if i:
                                    page.keyboard.press(key)
                                steps.append(page.evaluate('''()=>({tag:document.activeElement.tagName,
                                  text:document.activeElement.textContent,cls:document.activeElement.className,
                                  inside:panel.element.contains(document.activeElement),focused:document.hasFocus(),
                                  disabled:document.activeElement.matches(':disabled')})'''))
                            row['traces'][label] = steps
                            row['checks'][label] = all(s['inside'] and s['focused'] and not s['disabled'] for s in steps)
                        for key in ['Tab', 'Shift+Tab']:
                            open_panel()
                            trace('natural-' + key, key)
                            page.keyboard.press('Escape')
                            row['checks']['escape-' + key] = page.evaluate('!panel.isOpen')
                        open_panel()
                        page.get_by_role('tab',name='Properties',exact=True).click()
                        trace('properties', 'Tab')
                        page.get_by_role('tab',name='Inputs',exact=True).click()
                        trace('inputs-again', 'Shift+Tab')
                        open_panel(True)
                        trace('empty-forward', 'Tab')
                        trace('empty-reverse', 'Shift+Tab')
                        page.keyboard.press('Escape')
                        row['checks']['empty-escape'] = page.evaluate('!panel.isOpen')
                        open_panel()
                        # Reach Ok through the actual keyboard traversal, rather than .focus().
                        for _ in range(20):
                            if page.evaluate("document.activeElement.textContent==='Ok'"):
                                break
                            page.keyboard.press('Tab')
                        page.keyboard.press('Enter')
                        page.wait_for_timeout(10)
                        trace('busy-forward', 'Tab', 12)
                        trace('busy-reverse', 'Shift+Tab', 12)
                        page.keyboard.press('Escape')
                        row['checks']['busy-escape'] = page.evaluate('!panel.isOpen')
                        open_panel()
                        page.evaluate('finishApply(true)')
                        page.wait_for_timeout(10)
                        row['checks']['old-apply-does-not-close-new'] = page.evaluate('panel.isOpen')
                        page.evaluate('''()=>{
                          window.second=new Settings(document,{onApply:()=>true});
                          document.querySelector('#host2').append(second.element);second.open(snapshot);
                        }''')
                        page.wait_for_timeout(10)
                        row['checks']['one-modal'] = page.evaluate('!panel.isOpen&&second.isOpen&&second.element.contains(document.activeElement)')
                        page.keyboard.press('Tab')
                        page.keyboard.press('Shift+Tab')
                        page.keyboard.press('Escape')
                        row['checks']['second-escape'] = page.evaluate('!second.isOpen')
                        open_panel()
                        page.evaluate('panel.destroy();second.destroy()')
                        row['checks']['destroy-releases-inert'] = page.evaluate("!document.querySelector('[inert]')")
                        row['checks']['no-errors'] = not errors
                        row['errors'] = errors
                        results.append(row)
                        page.close()
                finally:
                    browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)
(args.output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
for row in results:
    print(row['browser'], row['mode'], row['checks'])
assert len(results) == 6 and all(all(row['checks'].values()) for row in results)
