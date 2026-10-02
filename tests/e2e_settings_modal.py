#!/usr/bin/env python3
"""Real browser modal focus, inert restoration, and delayed-Apply isolation."""
import argparse
import json
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=Path('/tmp/settings-modal-20261001'))
parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
with (args.output/'vite.log').open('w') as log:
    server = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--host','127.0.0.1',
        '--port','5257','--strictPort'],cwd=ROOT,stdout=log,stderr=log)
    try:
        for _ in range(150):
            if server.poll() is not None:
                raise RuntimeError('Private Vite failed')
            try:
                if urlopen('http://127.0.0.1:5257',timeout=1).status == 200:
                    break
            except OSError:
                time.sleep(.2)
        with sync_playwright() as pw:
            browser = getattr(pw, args.browser).launch(headless=True)
            try:
                page=browser.new_page(viewport={'width':1000,'height':800})
                errors=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.route('**/__modal_probe__',lambda route:route.fulfill(content_type='text/html',body='''
                    <html><body><button id="outside">Outside</button><div id="existing" inert>Already inert</div>
                    <main><button id="opener">Open settings</button><div id="host"></div></main></body></html>'''))
                page.goto('http://127.0.0.1:5257/__modal_probe__')
                page.evaluate('''async()=>{
                  await import('/src/features/backtesting/backtest.css');
                  const {StrategySettingsPanel}=await import('/src/features/backtesting/strategy-settings.ts');
                  window.snapshot={key:{cellId:'modal',indicatorId:'strategy'},title:'Modal focus test',inputs:[{key:'length',title:'Length',type:'int',defval:9}],props:[],inputValues:{length:9},propValues:{}};
                  window.panel=new StrategySettingsPanel(document,{onApply:()=>new Promise(resolve=>window.finishApply=resolve)});
                  document.querySelector('#host').append(panel.element);
                  document.querySelector('#opener').onclick=()=>panel.open(snapshot);
                }''')
                # Test keyboard focus restoration explicitly. Safari/WebKit
                # does not focus a button on mouse click by platform design.
                page.locator('#opener').focus()
                page.keyboard.press('Enter')
                page.locator('.quant-backtest-settings-form input').wait_for()
                checks={}
                checks['modalSemantics']=page.locator('.quant-backtest-settings').get_attribute('aria-modal')=='true'
                checks['backgroundInert']=page.evaluate("document.querySelector('#outside').inert && document.querySelector('#opener').inert && document.querySelector('#existing').inert")
                page.locator('.quant-backtest-settings-close').focus()
                page.keyboard.press('Shift+Tab')
                checks['reverseWrap']=page.evaluate("document.activeElement.textContent==='Ok'")
                page.keyboard.press('Tab')
                checks['forwardWrap']=page.evaluate("document.activeElement.matches('.quant-backtest-settings-close')")
                checks['programmaticEscapeBlocked']=page.evaluate("document.querySelector('#outside').focus();document.querySelector('.quant-backtest-settings').contains(document.activeElement)")
                page.evaluate("const b=document.createElement('button');b.id='late';b.textContent='Late';document.body.append(b)")
                page.wait_for_timeout(20)
                checks['newBackgroundInert']=page.evaluate("document.querySelector('#late').inert")
                page.keyboard.press('Escape')
                checks['escapeRestoresFocus']=page.evaluate("document.activeElement.id==='opener'")
                checks['restoresOriginalInert']=page.evaluate("!document.querySelector('#outside').inert&&!document.querySelector('#opener').inert&&!document.querySelector('#late').inert&&document.querySelector('#existing').inert")
                page.locator('#opener').focus()
                page.keyboard.press('Enter')
                page.get_by_role('button',name='Ok',exact=True).click()
                page.evaluate("panel.close();panel.open({...snapshot,title:'Reopened while Apply pending'});finishApply(true)")
                page.wait_for_timeout(50)
                checks['oldApplyDoesNotCloseNewSession']=page.evaluate("panel.isOpen&&document.querySelector('.quant-backtest-settings h2').textContent==='Reopened while Apply pending'&&document.querySelector('#outside').inert")
                page.screenshot(path=str(args.output/'modal.png'),full_page=True)
                page.evaluate('panel.destroy()')
                checks['destroyReleasesBackground']=page.evaluate("!document.querySelector('#outside').inert&&!document.querySelector('#opener').inert&&document.querySelector('#existing').inert")
                checks['destroyRestoresFocus']=page.evaluate("document.activeElement.id==='opener'")
                checks['hostOnCloseFocusRespected']=page.evaluate('''async()=>{
                  const {StrategySettingsPanel}=await import('/src/features/backtesting/strategy-settings.ts');
                  const next=new StrategySettingsPanel(document,{onApply:()=>true,onClose:()=>document.querySelector('#outside').focus()});
                  document.querySelector('#host').append(next.element);document.querySelector('#opener').focus();
                  next.open(snapshot);await Promise.resolve();next.close();
                  const preserved=document.activeElement.id==='outside';next.destroy();return preserved;
                }''')
                checks['twoPanelsHaveOneUsableModal']=page.evaluate('''async()=>{
                  const {StrategySettingsPanel}=await import('/src/features/backtesting/strategy-settings.ts');
                  const hostA=document.createElement('div'),hostB=document.createElement('div');
                  document.body.append(hostA,hostB);
                  const a=new StrategySettingsPanel(document,{onApply:()=>true});
                  const b=new StrategySettingsPanel(document,{onApply:()=>true});
                  hostA.append(a.element);hostB.append(b.element);
                  document.querySelector('#opener').focus();a.open(snapshot);await Promise.resolve();
                  b.open({...snapshot,title:'Second workspace settings'});await Promise.resolve();
                  const usable=!a.isOpen&&b.isOpen&&!b.element.closest('[inert]')&&b.element.contains(document.activeElement);
                  b.close();const released=!hostA.inert&&!hostB.inert&&!document.querySelector('#outside').inert;
                  a.destroy();b.destroy();hostA.remove();hostB.remove();return usable&&released;
                }''')
                checks['noPageErrors']=not errors
                (args.output/'result.json').write_text(json.dumps({'browser':args.browser,'checks':checks,'pageErrors':errors},indent=2)+'\n')
                print(checks)
                assert all(checks.values()),checks
            finally:
                browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)
