#!/usr/bin/env python3
"""U-01: real Settings DOM + controlled second-setter failure, fresh geometry checks."""
import json
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:4199'
server = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--config',
    'tests/vite-performance.config.ts', '--host', '127.0.0.1', '--port', '4199', '--strictPort'],
    cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(300):
        try:
            if urlopen(BASE, timeout=1).status == 200:
                break
        except OSError:
            time.sleep(.1)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        outcomes = []
        for width, height in [(1440,900),(390,640),(320,300),(320,180)]:
            page = browser.new_page(viewport={'width':width,'height':height})
            page.route('**/__error_layout__', lambda r: r.fulfill(content_type='text/html', body='''
              <html><body style="margin:0"><main class="quant-backtest-workbench" style="position:relative;width:100vw;height:100vh"></main></body></html>'''))
            page.goto(BASE+'/__error_layout__')
            page.evaluate('''async () => {
              await import('/src/features/backtesting/backtest.css');
              const {StrategySettingsPanel}=await import('/src/features/backtesting/strategy-settings.ts');
              const {VelaBacktestControlAdapter}=await import('/src/integrations/vela/backtest-control-adapter.ts');
              let values={size:2};
              const inputs=Array.from({length:24},(_,i)=>({key:i?'setting'+i:'size',title:'Independent setting '+i,type:'int',defval:2}));
              const handle={id:'layout',title:'Independent failure layout',visible:true,inputs,
                props:[{key:'precision',title:'Precision',type:'int',defval:10}],
                inputValues:()=>({...values}),propValues:()=>({precision:10}),
                setInputs:next=>{values={...values,...next}},setProps:()=>{throw Error('injected second setter failure')}};
              const adapter=new VelaBacktestControlAdapter({cell:()=>({chart:{indicators:()=>[handle]}})});
              const key={cellId:'layout-cell',indicatorId:'layout'};
              const panel=new StrategySettingsPanel(document,{
                onApply:()=>adapter.applySettings(key,{size:19},{precision:3}),
                onReadAfterFailure:()=>adapter.readSettings(key)});
              document.querySelector('main').append(panel.element);panel.open(adapter.readSettings(key));
              window.layoutPanel=panel;
            }''')
            page.get_by_role('button', name='Ok', exact=True).click()
            status = page.locator('.quant-backtest-settings-status.error')
            status.wait_for()
            geometry = page.evaluate('''() => {
              const q=s=>document.querySelector(s), rect=e=>e.getBoundingClientRect();
              const status=q('.quant-backtest-settings-status'), footer=q('.quant-backtest-settings-footer');
              const form=q('.quant-backtest-settings-form'), dialog=q('.quant-backtest-settings-dialog');
              const range=document.createRange();range.selectNodeContents(status);
              const lines=[...range.getClientRects()].map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom}));
              const b=rect(status),f=rect(form),ft=rect(footer),d=rect(dialog),style=getComputedStyle(status);
              return {text:status.textContent,role:status.getAttribute('role'),whiteSpace:style.whiteSpace,
                lineCount:lines.length,noHorizontalClipping:lines.every(l=>l.left>=b.left-1&&l.right<=b.right+1),
                noVerticalClipping:status.scrollHeight<=status.clientHeight+1,
                noOverlap:f.bottom<=ft.top+1,dialogNoHorizontalOverflow:dialog.scrollWidth<=dialog.clientWidth+1,
                viewportBounded:d.left>=0&&d.right<=innerWidth&&d.top>=0&&d.bottom<=innerHeight,
                dialogScrollHeight:dialog.scrollHeight,dialogClientHeight:dialog.clientHeight};
            }''')
            assert geometry['text'].endswith('before using its results.'), geometry
            assert geometry['role']=='status' and geometry['whiteSpace']=='normal', geometry
            assert geometry['lineCount']>1, geometry
            for check in ('noHorizontalClipping','noVerticalClipping','noOverlap','dialogNoHorizontalOverflow','viewportBounded'):
                assert geometry[check], (check,geometry)
            # Tab through the long real form rather than programmatically
            # focusing the footer. Keyboard focus must scroll each button in.
            page.locator('input[data-setting-key="size"]').focus()
            reached=[]
            for _ in range(40):
                page.keyboard.press('Tab')
                state=page.evaluate('''() => {
                  const e=document.activeElement,r=e.getBoundingClientRect();
                  return {text:e.textContent,footer:!!e.closest('.quant-backtest-settings-actions'),
                    visible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth};
                }''')
                if state['footer']:
                    assert state['visible'], state
                    reached.append(state['text'])
                    if state['text']=='Ok': break
            assert reached==['Reset defaults','Cancel','Ok'], reached
            page.screenshot(path=f'/tmp/u01-settings-{width}x{height}.png',full_page=True)
            outcomes.append({'viewport':[width,height],**geometry,'keyboardButtons':reached})
            page.evaluate('window.layoutPanel.destroy()')
            page.close()
        print(json.dumps(outcomes,indent=2))
        browser.close()
finally:
    server.terminate()
    server.wait(timeout=5)
