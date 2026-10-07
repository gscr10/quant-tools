#!/usr/bin/env python3
"""Backtest layout and navigation against the actual application entry.

Only exchange HTTP/WebSocket transport is controlled. The chart, Pine Worker,
adapter, report and Simulation Worker are real. This verifies local responsive
behavior, not reference numerical parity or physical-device accessibility.
"""
import argparse
from contextlib import contextmanager
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

from e2e_app import (ROOT, install_fixed_clock, install_mock_market_data,
                     install_offline_guard, MOCK_WEBSOCKET_SCRIPT, WORKER_AUDIT_SCRIPT)
from e2e_production_a11y import continuous_klines

DESKTOP = [(1920, 1080), (1440, 900), (1280, 720), (1024, 768), (1023, 768),
           (900, 600), (768, 1024), (720, 450), (641, 700), (640, 700), (390, 844),
           (360, 640), (844, 390), (1280, 400)]
TOUCH = [(768, 1024), (390, 844), (360, 640), (844, 390)]


def hashes(directory):
    return {str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(directory.rglob('*')) if p.is_file()}


@contextmanager
def production_preview(output):
    """Own a frozen preview; never stop a developer's existing local server."""
    before = hashes(ROOT/'dist')
    if 'index.html' not in before:
        raise RuntimeError('Run npm run build before the production responsive gate')
    with tempfile.TemporaryDirectory(prefix='quant-responsive-') as temp:
        snapshot = Path(temp)/'dist'
        shutil.copytree(ROOT/'dist', snapshot)
        if hashes(snapshot) != before:
            raise RuntimeError('dist changed while capturing the production snapshot')
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        with (output/'preview.log').open('w') as log:
            process = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), 'preview',
                '--outDir', str(snapshot), '--host', '127.0.0.1', '--port', str(port), '--strictPort'],
                cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic()+45
                while True:
                    if process.poll() is not None:
                        raise RuntimeError('preview stopped before readiness')
                    try:
                        with urlopen(base, timeout=1) as response:
                            if response.status == 200:
                                break
                    except OSError:
                        pass
                    if time.monotonic() > deadline:
                        raise TimeoutError('preview readiness')
                    time.sleep(.1)
                yield base+'/?chart=maximized', before
                if hashes(snapshot) != before:
                    raise RuntimeError('frozen production artifacts changed during verification')
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()

MEASURE = """() => {
  const rect = node => node ? node.getBoundingClientRect().toJSON() : null;
  const visible = node => !!node?.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const viewer=document.querySelector('.quant-backtest-viewer');
  const host=document.querySelector('#backtest-workbench');
  const panel=document.querySelector('#quant-backtest-panel');
  const controls=[...viewer.querySelectorAll('.quant-backtest-viewer-header button,.quant-backtest-tab')]
    .filter(visible).map(node=>({label:node.getAttribute('aria-label')||node.textContent.trim(),
      rect:rect(node),textFits:node.scrollWidth<=node.clientWidth+1&&node.scrollHeight<=node.clientHeight+1}));
  return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,
      touch:matchMedia('(hover:none)').matches,reducedMotion:matchMedia('(prefers-reduced-motion:reduce)').matches},
    host:rect(host),viewer:rect(viewer),panel:rect(panel),controls,
    documentOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
    bodyScroll:scrollY,
    worker:window.__quantWorkerAudit.summary()};
}"""


def settle(page):
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')


def touch_swipe(page, node, horizontal=False, edge=False):
    """Actual Chromium input pipeline, not synthetic DOM TouchEvents."""
    rect=node.bounding_box()
    x=rect['x']+(4 if edge else rect['width']*.75)
    y=rect['y']+min(rect['height']*.6,150)
    dx=min(rect['width']*.5,220) if horizontal else 0
    dy=0 if horizontal else min(rect['height']*.45,200)
    origin=page.evaluate("""({x,y})=>{
      const nodes=[];let node=document.elementFromPoint(x,y);
      while(node){const style=getComputedStyle(node);nodes.push({tag:node.tagName,
        className:node.getAttribute('class'),touchAction:style.touchAction,overflowY:style.overflowY});
        node=node.parentElement;}
      return {x,y,nodes};
    }""",{'x':x,'y':y})
    cdp=page.context.new_cdp_session(page)
    try:
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
        for step in range(1,11):
            cdp.send('Input.dispatchTouchEvent',{'type':'touchMove',
                'touchPoints':[{'x':x-dx*step/10,'y':y-dy*step/10}]})
            page.wait_for_timeout(16)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
        page.wait_for_timeout(300)
    finally:
        cdp.detach()
    return origin


def audit_context(browser, browser_name, url, output, dpr, touch, sizes, expected_html_sha=None):
    name=f'{browser_name}-dpr{dpr}-' + ('touch' if touch else 'pointer')
    context=browser.new_context(viewport={'width':1440,'height':900}, device_scale_factor=dpr,
        has_touch=touch, reduced_motion='reduce', locale='en-US', timezone_id='UTC', service_workers='block')
    errors=[]; blocked=[]; requests=[]; cases=[]; checks=[]; targets=[]; gestures=[]
    install_fixed_clock(context)
    context.add_init_script(MOCK_WEBSOCKET_SCRIPT)
    context.add_init_script(WORKER_AUDIT_SCRIPT)
    context.add_init_script("""window.addEventListener('error', event => {
      if(event instanceof ErrorEvent)console.error('window ErrorEvent: '+event.message);
    });""")
    install_offline_guard(context,blocked)
    install_mock_market_data(context,requests)
    context.route('**/klines?*', lambda route:route.fulfill(status=200,
        content_type='application/json',body=json.dumps(continuous_klines(route.request.url))))
    page=context.new_page();page.set_default_timeout(20000)
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('console',lambda message:errors.append(message.text)
        if message.type=='error' and message.text.startswith('window ErrorEvent:') else None)
    def check(label, actual, expected=True):
        result={'name':label,'actual':actual,'expected':expected,'pass':actual==expected}
        checks.append(result)
        assert result['pass'],result
    def activate(locator):
        if touch: locator.tap()
        else: locator.click()
    def contained(rect, viewport):
        return rect and rect['width']>0 and rect['height']>0 and rect['left']>=-1 and rect['top']>=-1 \
            and rect['right']<=viewport['width']+1 and rect['bottom']<=viewport['height']+1
    try:
        response=page.goto(url,wait_until='domcontentloaded')
        if expected_html_sha:
            check(name+' served expected production entry',hashlib.sha256(response.body()).hexdigest(),expected_html_sha)
        page.locator('button:visible',has_text='Indicators').first.click()
        page.locator('.quant-indicator-category[data-section="built-ins"]').click()
        page.locator('.quant-indicator-row',has_text='SMA Cross (strategy)').locator('.quant-indicator-main').click()
        page.locator('.quant-backtest-dock [aria-label="Open backtest viewer"]').wait_for(state='visible')
        page.wait_for_function('(window.__quantWorkerAudit.summary().byKind.execute??0)>0')
        page.add_script_tag(path=str(ROOT/'node_modules/axe-core/axe.min.js'))
        for width,height in sizes:
            key=f'{name}-{width}x{height}';case_start=len(checks)
            page.set_viewport_size({'width':width,'height':height});settle(page)
            trigger=page.locator('.quant-backtest-mobile-trigger' if width<=1023 else
                                 '.quant-backtest-dock [aria-label="Open backtest viewer"]')
            trigger.wait_for(state='visible');activate(trigger)
            viewer=page.locator('.quant-backtest-viewer');viewer.wait_for(state='visible')
            page.locator('.quant-backtest-performance').wait_for(state='visible')
            for tab,content in [('performance','.quant-backtest-performance'),('analysis','.quant-backtest-analysis'),
                                ('log','.quant-backtest-trades-log'),('simulation','.quant-backtest-simulation')]:
                activate(page.locator('#quant-backtest-tab-'+tab))
                page.locator(content).wait_for(state='visible');settle(page)
                geometry=page.evaluate(MEASURE)
                check(f'{key}/{tab} viewer inside available viewport',contained(geometry['viewer'],geometry['viewport']))
                check(f'{key}/{tab} usable panel',contained(geometry['panel'],geometry['viewport']))
                check(f'{key}/{tab} no document overflow',not geometry['documentOverflow'])
                check(f'{key}/{tab} header and tabs reachable',all(contained(c['rect'],geometry['viewport']) for c in geometry['controls']))
                check(f'{key}/{tab} full tab labels',all(c['textFits'] for c in geometry['controls']))
                check(f'{key}/{tab} selected',page.locator('#quant-backtest-tab-'+tab).get_attribute('aria-selected'),'true')
                check(f'{key}/{tab} labelled panel',page.locator('#quant-backtest-panel').get_attribute('aria-labelledby'),'quant-backtest-tab-'+tab)
                panel=page.locator('#quant-backtest-panel')
                if tab in ('performance','analysis','simulation') and touch and browser_name=='chromium':
                    panel.evaluate('node=>node.scrollTop=0')
                    origin=touch_swipe(page,panel)
                    actual=panel.evaluate('n=>({top:n.scrollTop,client:n.clientHeight,scroll:n.scrollHeight})')
                    edge_probe=None
                    if actual['top']==0 and actual['scroll']>actual['client']+1:
                        edge_origin=touch_swipe(page,panel,edge=True)
                        edge_probe={'origin':edge_origin,'top':panel.evaluate('n=>n.scrollTop')}
                    gestures.append({'case':key,'tab':tab,'axis':'vertical','origin':origin,
                                     'actual':actual,'edgeProbe':edge_probe})
                    check(f'{key}/{tab} trusted touch scroll',actual['top']>0 or actual['scroll']<=actual['client']+1)
                    panel.evaluate('node=>node.scrollTop=0')
                if tab in ('performance','simulation') and touch and browser_name=='chromium':
                    strip=page.locator('.quant-backtest-performance-kpi-bar' if tab=='performance'
                                       else '.quant-backtest-simulation-metrics')
                    strip.wait_for(state='visible')
                    if strip.evaluate('n=>n.scrollWidth>n.clientWidth+1'):
                        strip.evaluate('n=>n.scrollLeft=0')
                        origin=touch_swipe(page,strip,horizontal=True)
                        offset=strip.evaluate('n=>n.scrollLeft')
                        gestures.append({'case':key,'tab':tab,'axis':'horizontal','origin':origin,'offset':offset})
                        check(f'{key}/{tab} KPI values touch reachable',offset>0)
                panel.evaluate('node=>node.scrollTop=node.scrollHeight');settle(page)
                scroll=panel.evaluate('n=>({top:n.scrollTop,height:n.clientHeight,total:n.scrollHeight})')
                check(f'{key}/{tab} content bottom reachable',scroll['total']<=scroll['height']+1 or
                      abs(scroll['top']+scroll['height']-scroll['total'])<=2)
                panel.evaluate('node=>node.scrollTop=0')
                target_scan=page.evaluate("""async()=>{
                  const result=await axe.run({include:['.quant-backtest-viewer']},
                    {runOnly:{type:'rule',values:['target-size']}});
                  return {violations:result.violations,incomplete:result.incomplete};
                }""")
                targets.append({'case':key,'tab':tab,**target_scan})
                check(f'{key}/{tab} target size or spacing',target_scan['violations'],[])
                if tab=='log':
                    if touch and browser_name=='chromium':
                        table=page.locator('.quant-backtest-table-wrap')
                        check(f'{key}/log scroll container exists',table.count(),1)
                        if table.evaluate('n=>n.scrollWidth>n.clientWidth+1'):
                            table.evaluate('n=>n.scrollLeft=0')
                            origin=touch_swipe(page,table,horizontal=True)
                            offset=table.evaluate('n=>n.scrollLeft')
                            gestures.append({'case':key,'tab':tab,'axis':'horizontal','origin':origin,'offset':offset})
                            check(f'{key}/log trusted touch horizontal scroll',offset>0)
                    activate(page.locator('[role="tab"][aria-label="Calendar view"]'))
                    page.locator('.quant-backtest-calendar').wait_for(state='visible');settle(page)
                    check(f'{key}/calendar no page horizontal overflow',not page.evaluate(MEASURE)['documentOverflow'])
                    page.screenshot(path=str(output/f'{key}-calendar.png'))
                    activate(page.locator('[role="tab"][aria-label="List view"]'))
                if tab=='simulation':
                    page.locator('.quant-backtest-simulation-chart-host').first.wait_for(state='visible')
                    settings=page.locator('[data-simulation-settings-trigger]:visible')
                    activate(settings)
                    dialog=page.locator('.quant-backtest-simulation-settings-dialog');dialog.wait_for(state='visible')
                    check(f'{key}/simulation dialog visible bounds',contained(dialog.bounding_box() and dialog.evaluate('n=>n.getBoundingClientRect().toJSON()'),{'width':width,'height':height}))
                    for field in dialog.locator('input,select,button:visible').all():
                        if field.is_visible():
                            field.scroll_into_view_if_needed()
                            check(f'{key}/simulation field reachable '+str(field.get_attribute('id')),
                                  contained(field.evaluate('n=>n.getBoundingClientRect().toJSON()'),{'width':width,'height':height}))
                    page.screenshot(path=str(output/f'{key}-simulation-settings.png'))
                    activate(dialog.locator('[aria-label="Close simulation settings"]'))
                    dialog.wait_for(state='hidden')
                    check(f'{key}/simulation close focus',settings.evaluate('n=>n===document.activeElement'))
            # Exercise actual keyboard routing even in touch contexts.
            page.locator('#quant-backtest-tab-simulation').focus()
            for keypress,selected in [('Home','performance'),('ArrowRight','analysis'),('End','simulation'),('ArrowLeft','log')]:
                page.keyboard.press(keypress)
                check(f'{key}/keyboard {keypress}',page.locator('#quant-backtest-tab-'+selected).get_attribute('aria-selected'),'true')
            page.keyboard.press('Escape');viewer.wait_for(state='hidden')
            check(f'{key}/entry returns',trigger.is_visible())
            check(f'{key}/background interactive',page.locator('.vela-ws-main').evaluate('n=>!n.inert'))
            cases.append({'width':width,'height':height,'checks':len(checks)-case_start,'lastGeometry':geometry})
            print(json.dumps({'case':key,'checks':len(checks)-case_start,'pass':True}),flush=True)
        check(name+' no page/window errors',errors,[])
        check(name+' no unexpected remote requests',blocked,[])
        return {'name':name,'cases':cases,'checks':checks,'targetScans':targets,'gestures':gestures,'errors':errors,'blocked':blocked,'pass':True}
    except Exception as error:
        page.screenshot(path=str(output/f'{name}-failure.png'))
        return {'name':name,'cases':cases,'checks':checks,'targetScans':targets,'gestures':gestures,'errors':errors,'blocked':blocked,'exception':str(error),'pass':False}
    finally:
        context.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',help='Existing server; omit to own a frozen production preview')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--production',action='store_true',help='require served HTML to match current dist and unchanged artifacts')
    parser.add_argument('--browsers',default='chromium,firefox')
    parser.add_argument('--dprs',default='1,2')
    parser.add_argument('--sizes',help='Override pointer cases, e.g. 390x844,844x390')
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--pointer-only',action='store_true')
    mode.add_argument('--touch-only',action='store_true')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    sizes=[tuple(map(int,value.split('x'))) for value in args.sizes.split(',')] if args.sizes else DESKTOP
    if not args.url:
        with production_preview(args.output) as (url, dist_before):
            return run_matrix(args, url, dist_before, sizes, production=True)
    return run_matrix(args, args.url, hashes(ROOT/'dist'), sizes, production=args.production)


def run_matrix(args, url, dist_before, sizes, production):
    if production and 'index.html' not in dist_before:
        raise RuntimeError('Missing production dist/index.html')
    results=[]
    with sync_playwright() as p:
        for browser_name in args.browsers.split(','):
            browser=getattr(p,browser_name).launch()
            try:
                for dpr in map(int,args.dprs.split(',')):
                    for touch,viewports in ([] if args.touch_only else [(False,sizes)])+([] if args.pointer_only else [(True,TOUCH)]):
                        result=audit_context(browser,browser_name,url,args.output,dpr,touch,viewports,
                            dist_before.get('index.html') if production else None)
                        results.append(result)
                        (args.output/(result['name']+'.json')).write_text(json.dumps(result,indent=2))
            finally:
                browser.close()
    dist_after=hashes(ROOT/'dist')
    result={'pass':all(r['pass'] for r in results) and (not production or dist_before==dist_after),'results':results,
            'distBefore':dist_before,'distAfter':dist_after,'distUnchanged':dist_before==dist_after,
            'production':production,'probeSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'scope':'Actual app/Pine/Simulation; controlled exchange transport, emulated touch. 720x450/DPR2 exercises layout equivalent to 1440x900 at 200%, not browser UI zoom or physical-device acceptance.'}
    (args.output/'results.json').write_text(json.dumps(result,indent=2))
    return 0 if result['pass'] else 1


if __name__=='__main__':
    raise SystemExit(main())
