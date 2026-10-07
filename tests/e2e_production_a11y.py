#!/usr/bin/env python3
"""Production-root accessibility audit with real Pine/Simulation Workers.

Only exchange HTTP and live WebSocket traffic are controlled. The production
entry, scripts, controls, report adapter and Workers are unmodified. No old
geometry/image baseline or synthetic report is used. This is automated DOM,
axe and Chromium AX-tree evidence, not a VoiceOver or real-device claim.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

from e2e_app import (ROOT, FIXED_BROWSER_NOW_MS, MOCK_WEBSOCKET_SCRIPT, WORKER_AUDIT_SCRIPT,
                     install_fixed_clock, install_mock_market_data, install_offline_guard)

AXE_PATH = ROOT/'node_modules/axe-core/axe.min.js'
SCOPE = '#backtest-workbench'


def continuous_klines(url):
    # Stable timestamps and inclusive exchange endTime semantics keep each
    # progressive page continuous and make repeated ranges identical. The
    # controlled transport never injects a report or replaces the Pine Worker.
    query=parse_qs(urlparse(url).query)
    minutes={'1m':1,'5m':5,'15m':15,'30m':30,'1h':60,'2h':120,'4h':240,'1d':1440}
    step=minutes[query.get('interval',['15m'])[0]]*60000
    count=min(int(query.get('limit',['1000'])[0]),1000)
    last=int(query.get('endTime',[str(FIXED_BROWSER_NOW_MS)])[0])//step*step
    first=last-(count-1)*step
    if 'startTime' in query:
        first=max(first,((int(query['startTime'][0])+step-1)//step)*step)
    rows=[]
    for stamp in range(first,last+step,step):
        phase=(stamp//step)%48
        triangle=phase if phase<24 else 48-phase
        price=60000+(triangle-12)*30
        rows.append([stamp,str(price),str(price+25),str(price-20),str(price+5),'100',stamp+step-1])
    return rows


def hashes(directory):
    return {str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(directory.rglob('*')) if p.is_file()}


def save(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False)+'\n')


def focus_state(page):
    return page.evaluate("""() => {
      const n=document.activeElement;
      return {tag:n?.tagName,id:n?.id,name:n?.getAttribute('aria-label')||n?.textContent?.trim(),
        className:n?.className,insideBacktest:!!n?.closest('#backtest-workbench'),
        chartKeyboardTarget:n instanceof HTMLCanvasElement&&n.tabIndex>=0&&n.isConnected
          &&!!n.getClientRects().length&&!n.closest('[hidden],[inert],[aria-hidden="true"]')
          &&n.getAttribute('aria-label')?.startsWith('Interactive price chart.')};
    }""")


def focus_loop(page, selector):
    root=page.locator(selector)
    stops=root.locator('button:visible:not([disabled]),input:visible:not([disabled]),select:visible:not([disabled]),[tabindex="0"]:visible')
    count=stops.count()
    assert count > 0, selector
    stops.first.focus()
    results=[]
    for key in ['Shift+Tab']+['Tab']*(count+2):
        page.keyboard.press(key)
        results.append({'key':key, 'focus':focus_state(page),
                        'contained':root.evaluate('(root)=>root.contains(document.activeElement)')})
    return {'selector':selector,'steps':results,'pass':all(r['contained'] for r in results)}


def resize_workspace(page, width, height):
    page.set_viewport_size({'width':width,'height':height})
    page.wait_for_function("""() => {
      const r=document.querySelector('#backtest-workbench')?.getBoundingClientRect();
      return r&&r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight;
    }""")


def layout_state(page):
    return page.evaluate("""() => {
      const measure=selector=>{
        const node=document.querySelector(selector);
        if(!node)return null;
        const r=node.getBoundingClientRect();
        return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,
          visibility:getComputedStyle(node).visibility,display:getComputedStyle(node).display};
      };
      return {viewport:{width:innerWidth,height:innerHeight},host:measure('#backtest-workbench'),
        topbar:measure('.vela-widget-topbar'),bottombar:measure('.vela-widget-bottombar'),
        mobilebar:measure('.vela-mobilebar'),settings:measure('.quant-backtest-settings-dialog')};
    }""")


def capture(page, session, output, name, expected_live=None):
    """Retain all violations; do not turn missing states or AX evidence green."""
    root=page.locator(SCOPE)
    assert root.count()==1 and root.locator('button:visible').count()>0, 'No visible Backtest controls'
    if not page.evaluate('!!window.axe'):
        page.add_script_tag(path=str(AXE_PATH))
    scan=page.evaluate("""async (scope) => {
      const result=await axe.run({include:[scope]}, {resultTypes:['violations','incomplete']});
      const rows = list => list.map(v=>({id:v.id,impact:v.impact,help:v.help,tags:v.tags,
        nodes:v.nodes.map(n=>({target:n.target,html:n.html,failureSummary:n.failureSummary,
          any:n.any,all:n.all,none:n.none}))}));
      return {version:result.testEngine.version,violations:rows(result.violations),
        incomplete:rows(result.incomplete),passes:result.passes.map(p=>p.id)};
    }""", SCOPE)
    dom=root.evaluate(r"""root => {
      const exposed=n=>!!n.getClientRects().length&&!n.closest('[hidden],[inert],[aria-hidden="true"]');
      const refs=[];
      for(const n of root.querySelectorAll('[aria-controls],[aria-labelledby],[aria-describedby]')) {
        if(!exposed(n)) continue;
        for(const attr of ['aria-controls','aria-labelledby','aria-describedby'])
          for(const id of (n.getAttribute(attr)||'').split(/\s+/).filter(Boolean))
            if(!document.getElementById(id))refs.push({attr,id,html:n.outerHTML});
      }
      const controls=[...root.querySelectorAll('button,input,select,[role="tab"],[role="dialog"]')]
        .filter(exposed).map(n=>({tag:n.tagName,id:n.id,role:n.getAttribute('role'),
          label:n.getAttribute('aria-label'),labelledby:n.getAttribute('aria-labelledby'),
          selected:n.getAttribute('aria-selected'),tabIndex:n.tabIndex,
          text:n.textContent?.trim().slice(0,180),disabled:!!n.disabled}));
      const live=[...root.querySelectorAll('[aria-live],[role="status"],[role="alert"]')]
        .map(n=>({role:n.getAttribute('role'),live:n.getAttribute('aria-live'),atomic:n.getAttribute('aria-atomic'),
          text:n.textContent?.trim(),exposed:exposed(n),html:n.outerHTML}));
      const tabs=[...root.querySelectorAll('.quant-backtest-tab')].map(n=>({id:n.id,
        selected:n.getAttribute('aria-selected'),tabIndex:n.tabIndex,controls:n.getAttribute('aria-controls')}));
      const panel=root.querySelector('#quant-backtest-panel');
      const rect=root.getBoundingClientRect();
      const bounds={x:rect.x,y:rect.y,width:rect.width,height:rect.height,
        top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right};
      const intersectsViewport=rect.width>0&&rect.height>0&&rect.right>0&&rect.left<innerWidth&&rect.bottom>0&&rect.top<innerHeight;
      return {refs,controls,live,tabs,bounds,intersectsViewport,
        panel:panel?{role:panel.getAttribute('role'),labelledby:panel.getAttribute('aria-labelledby')}:null};
    }""")
    ax=session.send('Accessibility.getFullAXTree')
    live_ax=[n for n in ax['nodes'] if not n.get('ignored')
             and n.get('role',{}).get('value') in ['status','alert','progressbar']]
    result={'name':name,'viewport':page.viewport_size,'axe':scan,'dom':dom,'liveAX':live_ax,
            'focus':focus_state(page),'expectedLive':expected_live,'layout':layout_state(page)}
    result['checks']={'scopeHasNoAxeViolation':not scan['violations'],
                      'ariaReferencesResolve':not dom['refs'],
                      'workbenchIntersectsViewport':dom['intersectsViewport']}
    if expected_live:
        role,politeness=expected_live
        result['checks']['actualLiveDOM']=any(x['role']==role and x['exposed'] and x['text']
          and (x['live']==politeness or x['live'] is None) for x in dom['live'])
        result['checks']['actualLiveAX']=any(n.get('role',{}).get('value')==role
          and any(p['name']=='live' and p['value']['value']==politeness for p in n.get('properties',[])) for n in live_ax)
    result['pass']=all(result['checks'].values())
    save(output/f'{name}.json',result)
    save(output/f'{name}-ax.json',ax)
    (output/f'{name}.html').write_text(root.evaluate('n=>n.outerHTML'))
    page.screenshot(path=str(output/f'{name}.png'))
    return result


def open_viewer(page):
    # Immediately after resize the desktop trigger can remain visible until
    # the queued resize handler runs. A combined :visible locator may resolve
    # it once, then keep retrying that now-hidden node. Select the actual
    # responsive entry explicitly and still require a real actionable click.
    compact=page.evaluate('innerWidth<=1023')
    selector='.quant-backtest-mobile-trigger' if compact else '.quant-backtest-dock [aria-label="Open backtest viewer"]'
    page.locator(selector).click()
    page.locator('.quant-backtest-viewer').wait_for(state='visible')


def return_chart(page):
    page.locator('.quant-backtest-viewer [aria-label="Return to chart"]').click()
    page.locator('.quant-backtest-viewer').wait_for(state='hidden')


def select_timeframe(page, value):
    page.locator('#vela-topbar-tf').click()
    page.locator(f'.vela-menu:visible .vela-menu-item[data-vei-id="{value}"]').click()


def audit_viewport(browser, base, label, width, height, output):
    # Mobile is a real responsive transition of this production instance;
    # Settings has a desktop Dock entry, which is opened before resizing.
    context=browser.new_context(viewport={'width':1440,'height':900},service_workers='block',has_touch=label=='mobile')
    install_fixed_clock(context)
    context.add_init_script(MOCK_WEBSOCKET_SCRIPT)
    context.add_init_script(WORKER_AUDIT_SCRIPT)
    blocked=[]; requests=[]; errors=[]; workers=[]; states=[]; interactions=[]
    install_offline_guard(context,blocked)
    install_mock_market_data(context,requests)
    page=context.new_page();page.set_default_timeout(45000)
    page.on('pageerror',lambda e: errors.append(str(e)))
    # ResizeObserver loop errors may be window events without pageerror.
    # Keep injected HTTP failures separate from real uncaught UI errors.
    page.add_init_script("""window.addEventListener('error', event => {
      if (event instanceof ErrorEvent) console.error('window ErrorEvent: ' + event.message);
    });""")
    page.on('console', lambda message: errors.append(message.text)
            if message.type == 'error' and message.text.startswith('window ErrorEvent:') else None)
    page.on('worker',lambda w: workers.append({'url':w.url}))
    session=context.new_cdp_session(page)
    session.send('Accessibility.enable')
    fault={'mode':'pass','held':[],'requests':[]}
    def control_market(route):
        fault['requests'].append({'url':route.request.url,'mode':fault['mode']})
        if fault['mode']=='hold': fault['held'].append(route)
        elif fault['mode']=='error': route.fulfill(status=503,content_type='application/json',body='{"error":"audit upstream outage"}')
        else: route.fulfill(status=200,content_type='application/json',body=json.dumps(continuous_klines(route.request.url)))
    context.route('**/klines?*',control_market)
    def snapshot(name, expected_live=None):
        value=capture(page,session,output,f'{label}-{name}',expected_live)
        states.append(value)
        print(json.dumps({'viewport':label,'state':name,'pass':value['pass'],
                          'violations':[v['id'] for v in value['axe']['violations']]}),flush=True)
        return value
    try:
        page.goto(base+'/?chart=maximized',wait_until='domcontentloaded')
        page.locator('button:visible',has_text='Indicators').first.click()
        page.locator('.quant-indicator-category[data-section="built-ins"]').click()
        page.locator('.quant-indicator-row',has_text='SMA Cross (strategy)').locator('.quant-indicator-main').click()
        page.locator('.quant-backtest-dock [aria-label="Open strategy settings"]').wait_for(state='visible')
        page.wait_for_function("(window.__quantWorkerAudit?.summary().byKind.execute??0)>0")
        # Ready dock + non-empty ledger is observed through the normal Viewer.
        open_viewer(page)
        page.locator('.quant-backtest-performance').wait_for(state='visible')
        return_chart(page)
        trigger=page.locator('.quant-backtest-dock [aria-label="Open strategy settings"]')
        trigger.click()
        resize_workspace(page,width,height)
        settings=page.locator('.quant-backtest-settings-dialog')
        settings.wait_for(state='visible')
        snapshot('settings-inputs')
        interactions.append(focus_loop(page,'.quant-backtest-settings-dialog'))
        page.locator('.quant-backtest-settings [role="tab"]',has_text='Properties').click()
        snapshot('settings-properties')
        interactions.append(focus_loop(page,'.quant-backtest-settings-dialog'))
        # Keep a real open modal usable across both responsive boundaries.
        # Actual pointer clicks and a complete Tab cycle must work after each
        # transition; measured chrome rectangles are evidence, not snapshots.
        alternate=(390,844) if label=='desktop' else (1440,900)
        resize_workspace(page,*alternate)
        page.locator('.quant-backtest-settings [role="tab"]',has_text='Inputs').click()
        snapshot('settings-resized-inputs')
        page.locator('.quant-backtest-settings [role="tab"]',has_text='Properties').click()
        interactions.append({'name':'settings-resize-alternate','pass':True,'layout':layout_state(page)})
        interactions.append(focus_loop(page,'.quant-backtest-settings-dialog'))
        resize_workspace(page,width,height)
        page.locator('.quant-backtest-settings [role="tab"]',has_text='Inputs').click()
        page.locator('.quant-backtest-settings [role="tab"]',has_text='Properties').click()
        snapshot('settings-resized-restored')
        interactions.append({'name':'settings-resize-restored','pass':True,'layout':layout_state(page)})
        page.keyboard.press('Escape')
        page.locator('.quant-backtest-settings').wait_for(state='hidden')
        interactions.append({'name':'settings-escape','focus':focus_state(page),
           'pass':page.evaluate("document.activeElement===document.querySelector('.quant-backtest-dock [aria-label=\"Open strategy settings\"]')") if label=='desktop' else
                  focus_state(page)['chartKeyboardTarget']})
        open_viewer(page)
        for tab, content in [('performance','.quant-backtest-performance'),('analysis','.quant-backtest-analysis'),
                             ('log','.quant-backtest-trades-log'),('simulation','.quant-backtest-simulation')]:
            page.locator(f'#quant-backtest-tab-{tab}').click()
            page.locator(content).wait_for(state='visible')
            if tab=='simulation':
                page.locator('.quant-backtest-simulation-chart-host').first.wait_for(state='visible')
            snapshot(tab)
            if tab=='simulation':
                streaks=page.locator('.quant-backtest-simulation-streaks > div')
                streaks.focus()
                before=streaks.evaluate('(n)=>({left:n.scrollLeft,width:n.clientWidth,scrollWidth:n.scrollWidth,focused:n===document.activeElement})')
                page.keyboard.press('ArrowRight')
                if before['scrollWidth']>before['width']:
                    page.wait_for_function('(before)=>document.querySelector(".quant-backtest-simulation-streaks > div").scrollLeft>before',arg=before['left'])
                after=streaks.evaluate('(n)=>({left:n.scrollLeft,focused:n===document.activeElement})')
                interactions.append({'name':'simulation-streaks-keyboard-scroll','before':before,'after':after,
                                     'pass':before['focused'] and after['focused'] and
                                     (before['scrollWidth']<=before['width'] or after['left']>before['left'])})
            selected=page.locator(f'#quant-backtest-tab-{tab}')
            interactions.append({'name':f'{tab}-tabpanel','pass':selected.get_attribute('aria-selected')=='true'
                and selected.get_attribute('tabindex')=='0'
                and page.locator('#quant-backtest-panel').get_attribute('aria-labelledby')==f'quant-backtest-tab-{tab}'})
            if tab=='log':
                page.locator('[role="tab"][aria-label="Calendar view"]').click()
                page.locator('.quant-backtest-calendar').wait_for(state='visible')
                snapshot('calendar')
                before=page.locator('.quant-backtest-calendar-heading strong').inner_text()
                page.locator('[aria-label="Previous month"]').click()
                after=page.locator('.quant-backtest-calendar-heading strong').inner_text()
                interactions.append({'name':'calendar-previous-month','pass':before!=after,
                                     'before':before,'after':after,'focus':focus_state(page)})
                snapshot('calendar-previous')
                page.locator('[aria-label="Move to current month"]').click()
                day=page.locator('.quant-backtest-calendar-day.is-profit,.quant-backtest-calendar-day.is-loss,.quant-backtest-calendar-day.is-flat').first
                day.click()
                snapshot('calendar-selected-day')
        modal_trigger=page.locator('[data-simulation-settings-trigger]:visible')
        modal_trigger.click()
        page.locator('.quant-backtest-simulation-settings-dialog').wait_for(state='visible')
        snapshot('simulation-settings')
        interactions.append(focus_loop(page,'.quant-backtest-simulation-settings-dialog'))
        page.keyboard.press('Escape')
        page.locator('.quant-backtest-simulation-settings-dialog').wait_for(state='hidden')
        interactions.append({'name':'simulation-escape','pass':modal_trigger.evaluate('n=>n===document.activeElement'),
                             'focus':focus_state(page)})
        # Keyboard routing among Viewer tabs, independent of old screenshots.
        page.locator('#quant-backtest-tab-performance').focus()
        page.keyboard.press('ArrowRight')
        interactions.append({'name':'viewer-arrow-right','pass':page.locator('#quant-backtest-tab-analysis').get_attribute('aria-selected')=='true',
                             'focus':focus_state(page)})
        page.keyboard.press('End')
        interactions.append({'name':'viewer-end','pass':page.locator('#quant-backtest-tab-simulation').get_attribute('aria-selected')=='true'})
        page.keyboard.press('Home')
        interactions.append({'name':'viewer-home','pass':page.locator('#quant-backtest-tab-performance').get_attribute('aria-selected')=='true'})
        # Block a real market reload to retain loading long enough for AX scan.
        return_chart(page)
        if label=='mobile': resize_workspace(page,1440,900)
        fault['mode']='hold'
        select_timeframe(page,'30')
        page.wait_for_timeout(100)
        resize_workspace(page,width,height)
        open_viewer(page)
        page.locator('.quant-backtest-state[role="status"]').wait_for(state='visible')
        snapshot('loading',('status','polite'))
        # Deliver an actual HTTP outage into that pending history request.
        fault['mode']='error'
        for route in fault['held']:
            route.fulfill(status=503,content_type='application/json',body='{"error":"audit upstream outage"}')
        fault['held'].clear()
        page.locator('.quant-backtest-state[role="alert"]').wait_for(state='visible',timeout=60000)
        snapshot('error',('alert','assertive'))
        fault['mode']='pass'
        page.locator('.quant-backtest-state button',has_text='Try again').click()
        page.locator('.quant-backtest-performance').wait_for(state='visible',timeout=60000)
        snapshot('retry-recovered')
        # Zero-data status comes from an actual empty HTTP market response,
        # not a synthetic report or direct adapter update.
        return_chart(page)
        if label=='mobile': resize_workspace(page,1440,900)
        def no_candles(route): route.fulfill(status=200,content_type='application/json',body='[]')
        context.route('**/klines?*',no_candles)
        select_timeframe(page,'60')
        resize_workspace(page,width,height)
        open_viewer(page)
        page.locator('.quant-backtest-state',has_text='No market data').wait_for(state='visible')
        snapshot('no-data',('status','polite'))
        context.unroute('**/klines?*',no_candles)
        result={'viewport':label,'states':states,'interactions':interactions,'pageErrors':errors,
                'blockedRequests':blocked,'marketRequests':requests,'workerInstances':workers,
                'workerMessages':page.evaluate('window.__quantWorkerAudit.summary()'),
                'faultRequests':fault['requests'],'actualProductionRoot':base+'/?chart=maximized',
                'notes':['Controlled HTTP OHLC and inert test WebSocket; native Pine and Simulation Workers remain real.',
                         'Mobile Settings is opened through desktop Dock then resized; all mobile Viewer interactions use its actual Backtest button.',
                         'CDP AX trees and axe are automated evidence, not human screen-reader acceptance.']}
    except Exception as error:
        result={'viewport':label,'exception':str(error),'states':states,'interactions':interactions,
                'pageErrors':errors,'blockedRequests':blocked,'marketRequests':requests,'workerInstances':workers,
                'faultRequests':fault['requests']}
        try:
            page.screenshot(path=str(output/f'{label}-failure.png'))
            (output/f'{label}-failure.html').write_text(page.content())
        except Exception: pass
    finally:
        context.close()
    result['pass']=not result.get('exception') and not errors and not blocked and bool(states) and all(
        s['pass'] for s in states) and all(i['pass'] for i in interactions)
    save(output/f'{label}-result.json',result)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'audit-evidence/production-a11y')
    parser.add_argument(
        '--scope',
        choices=('desktop', 'full'),
        default='full',
        help='audit desktop production states only, or retain the desktop/mobile matrix (default: full)',
    )
    parser.add_argument('--skip-build',action='store_true',help='audit the existing dist snapshot and record its hashes')
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    if not args.skip_build:
        with (args.output/'build.log').open('w') as log:
            subprocess.run(['npm','run','build'],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True)
    original_hashes=hashes(ROOT/'dist')
    if 'index.html' not in original_hashes: raise RuntimeError('production dist is absent')
    with tempfile.TemporaryDirectory(prefix='quant-production-a11y-') as temp:
        snapshot=Path(temp)/'dist'
        shutil.copytree(ROOT/'dist',snapshot)
        if hashes(snapshot)!=original_hashes: raise RuntimeError('dist changed while capturing build snapshot')
        provenance={'startedAt':datetime.now(timezone.utc).isoformat(),
                    'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
                    'buildMode':'existing-dist' if args.skip_build else 'fresh-build',
                    'productionAssets':original_hashes,
                    'probeSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
        save(args.output/'provenance.json',provenance)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
        base=f'http://127.0.0.1:{port}'
        with (args.output/'server.log').open('w') as log:
            process=subprocess.Popen([str(ROOT/'node_modules/.bin/vite'),'preview','--outDir',str(snapshot),
               '--host','127.0.0.1','--port',str(port),'--strictPort'],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
            try:
                deadline=time.monotonic()+45
                while True:
                    if process.poll() is not None: raise RuntimeError('preview stopped before readiness')
                    try:
                        with urlopen(base,timeout=1) as response:
                            if response.status==200:break
                    except OSError: pass
                    if time.monotonic()>deadline: raise TimeoutError('preview readiness')
                    time.sleep(.1)
                with sync_playwright() as p:
                    browser=p.chromium.launch()
                    try:
                        viewports = [('desktop', 1440, 900)]
                        if args.scope == 'full':
                            viewports.append(('mobile', 390, 844))
                        results=[audit_viewport(browser,base,label,width,height,args.output)
                                 for label,width,height in viewports]
                    finally:browser.close()
            finally:
                process.terminate()
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait()
        summary={'results':[{k:r.get(k) for k in ['viewport','pass','exception','pageErrors','blockedRequests']} for r in results],
                 'pass':all(r['pass'] for r in results),'ownServerStopped':process.poll() is not None}
        save(args.output/'summary.json',summary)
    save(args.output/'SHA256.json',{'algorithm':'SHA-256','files':{
        str(p.relative_to(args.output)):hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(args.output.rglob('*')) if p.is_file() and p.name!='SHA256.json'}})
    print(json.dumps(summary),flush=True)
    return 0 if summary['pass'] else 1


if __name__=='__main__':raise SystemExit(main())
