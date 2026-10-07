#!/usr/bin/env python3
"""Fresh desktop Dock controls through the real Workbench and Highcharts.

Uses a new controlled presentation report, not historical snapshots or a Pine
execution fixture. Callback/network guards prove the UI boundary has no extra
execution side effects; the main application E2E separately verifies engines.
Starts/stops an owned Vite server unless --base-url is provided.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import time
from urllib.parse import urlparse
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WATCHED = [
    'src/features/backtesting/backtest-workbench.ts',
    'src/features/backtesting/backtest.css',
    'src/features/backtesting/highcharts-renderer.ts',
    'src/features/backtesting/backtest-viewer.ts',
    'tests/e2e_dock_interactions.py',
]
CASES = [
    {'name': 'desktop', 'width': 1440, 'height': 900},
    {'name': 'breakpoint', 'width': 1024, 'height': 768},
    {'name': 'short', 'width': 1280, 'height': 400},
    {'name': 'embedded', 'width': 1440, 'height': 900,
     'host': {'left': 120, 'top': 40, 'width': 900, 'height': 420}},
]


def source_hashes():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in WATCHED}


@contextmanager
def serve(base_url, output):
    if base_url:
        yield base_url.rstrip('/')
        return
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    with (output / 'server.log').open('w') as log:
        server = subprocess.Popen([str(ROOT / 'node_modules/.bin/vite'), '--host',
            '127.0.0.1', '--port', str(port), '--strictPort'], cwd=ROOT,
            stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 45
            while True:
                try:
                    with urlopen(base, timeout=1) as response:
                        if response.status == 200:
                            break
                except OSError:
                    pass
                if server.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError('Owned Dock test Vite did not become ready')
                time.sleep(.1)
            yield base
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)


SETUP = """async ({host}) => {
  const {BacktestWorkbench}=await import('/src/features/backtesting/backtest-workbench.ts');
  const renderer=await import('/src/features/backtesting/highcharts-renderer.ts');
  const Highcharts=await renderer.loadHighcharts();
  const element=document.querySelector('#dock-test-host');
  if(host)Object.assign(element.style,{inset:'auto',left:host.left+'px',top:host.top+'px',
    width:host.width+'px',height:host.height+'px'});
  const metrics={netProfit:0,trades:6,winRate:50,winningTrades:3,losingTrades:3,
    maxDrawdown:30,maxDrawdownPercent:3,profitFactor:1};
  const start=Date.UTC(2025,11,31,9),deltas=[10,-20,30,-10,10,-20];
  let total=0;
  const trades=deltas.map((pnl,index)=>({id:'fresh-'+index,tradeNumber:index+1,
    direction:index%2?'short':'long',status:'closed',entryTime:start+index*3_600_000,
    exitTime:start+(index+1)*3_600_000,entryPrice:100,exitPrice:100+pnl,
    size:1,netPnl:pnl,netPnlPercent:pnl,pnl,cumulativePnl:total+=pnl}));
  const report={key:{cellId:'dock-audit',indicatorId:'fresh-strategy'},revision:1,runId:'dock-run',
    strategyName:'Dock interaction strategy',status:'ready',currency:'USD',symbol:'BTCUSDT',
    timeframe:'15m',activityRange:{from:Date.UTC(2025,11,31),to:Date.UTC(2026,0,2)},
    metrics,trades,cumulativePnl:trades.map((trade,index)=>({x:index+1,y:trade.cumulativePnl,
      time:trade.exitTime,direction:trade.direction,tradeNumber:index+1})),
    cumulativePnlSource:'realized-ledger'};
  const state={resizes:[],preferences:[],open:0,close:0,settingsRead:0,settingsApply:0,
    retry:0,simulation:0,tradeLocate:0,favorite:0,subscriptions:0,unsubscribes:0};
  const settings={key:report.key,title:report.strategyName,visible:true,
    inputs:[{key:'length',title:'Length',type:'int',defval:9}],props:[],
    inputValues:{length:9},propValues:{}};
  let subscriber;
  const workbench=new BacktestWorkbench(element,{initialReport:report,
    subscribe(listener){state.subscriptions++;subscriber=listener;return()=>{state.unsubscribes++}},
    onResize(height){state.resizes.push(height)},
    onDockPreferencesChange(value){state.preferences.push(structuredClone(value))},
    onOpenViewer(){state.open++},onCloseViewer(){state.close++},
    onRetry(){state.retry++},onSimulationChange(){state.simulation++},
    onTradeLocate(){state.tradeLocate++},onToggleFavorite(){state.favorite++},
    settings:{read(){state.settingsRead++;return settings},apply(){state.settingsApply++;return true}}});
  window.__dockAudit={workbench,report,state,Highcharts,renderer,host:element,
    dockChart:()=>Highcharts.charts.find(c=>c?.renderTo?.closest('.quant-backtest-dock')),
    publish(change){subscriber({...report,...change,metrics:{...metrics,...change.metrics}})},
    snapshot:()=>structuredClone(state)};
}"""

MEASURE = """() => {
  const dock=document.querySelector('.quant-backtest-dock');
  const visible=node=>!!node?.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
  const rect=node=>node?.getBoundingClientRect().toJSON()??null;
  const strip=dock.querySelector('.quant-backtest-dock-kpi-strip');
  const graph=dock.querySelector('.quant-backtest-dock-sparkline');
  const chart=__dockAudit.dockChart();
  return {dock:rect(dock),host:rect(__dockAudit.host),strip:rect(strip),graph:rect(graph),
    graphVisible:visible(graph),graphHidden:graph.hidden,graphInert:graph.inert,
    titleVisible:visible(dock.querySelector('.quant-backtest-dock-title')),
    rangeVisible:visible(dock.querySelector('.quant-backtest-dock-range')),
    netVisible:visible(dock.querySelector('.quant-backtest-dock-collapsed-net')),
    viewerVisible:visible(dock.querySelector('[aria-label="Open backtest viewer"]')),
    value:Number(dock.querySelector('[role=separator]').getAttribute('aria-valuenow')),
    maximum:Number(dock.querySelector('[role=separator]').getAttribute('aria-valuemax')),
    kpis:[...dock.querySelectorAll('.quant-backtest-dock-kpi')].map(node=>({text:node.innerText,
      rect:rect(node),tone:node.querySelector('strong').className,
      color:getComputedStyle(node.querySelector('strong')).color})),
    chart:chart?{index:chart.index,width:chart.chartWidth,height:chart.chartHeight,
      host:rect(chart.renderTo),axisVisible:[...chart.xAxis,...chart.yAxis].map(a=>a.visible),
      focusable:chart.container.tabIndex}:null,
    focusedVisible:visible(document.activeElement),focusedClass:document.activeElement.className,
    resources:__dockAudit.renderer.getReportChartResourceStats(),state:__dockAudit.snapshot()};
}"""


def settle(page):
    # CSS transitions and ResizeObserver callbacks are part of the product.
    page.wait_for_timeout(200)
    page.evaluate('() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')


def run_case(browser, browser_name, case, base, output):
    name = browser_name + '-' + case['name']
    context = browser.new_context(viewport={'width':case['width'],'height':case['height']},
        device_scale_factor=1, locale='en-US', timezone_id='UTC', service_workers='block')
    errors = []; external = []; checks = []; samples = []
    origin = urlparse(base).netloc
    def guard(route):
        parsed = urlparse(route.request.url)
        if parsed.scheme in ('http','https') and parsed.netloc != origin:
            external.append(route.request.url)
            route.abort()
        else:
            route.continue_()
    context.route('**/*', guard)
    page = context.new_page()
    page.set_default_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text)
        if message.type=='error' and message.text.startswith('DockWindowError:') else None)
    page.add_init_script("""window.addEventListener('error',event=>{
      if(event instanceof ErrorEvent)console.error('DockWindowError:'+event.message)});""")
    page.route('**/dock-interaction-audit', lambda route:route.fulfill(content_type='text/html',
        body='<!doctype html><html lang="en"><head><link rel="icon" href="data:,"><style>'
             '*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#151619}'
             '#dock-test-host{position:absolute;inset:0}</style></head><body><main id="dock-test-host"></main></body></html>'))
    def check(label, actual, expected=True):
        entry={'name':label,'actual':actual,'expected':expected,'passed':actual==expected}
        checks.append(entry)
        assert entry['passed'],entry
    def capture(label):
        value=page.evaluate(MEASURE)
        samples.append({'label':label,**value})
        return value
    def height_key(key, wanted):
        sep=page.locator('.quant-backtest-dock [role=separator]')
        sep.focus();page.keyboard.press(key);settle(page)
        check(key+' changes Dock to '+str(wanted),capture(key)['value'],wanted)
    def drag_to(target, expected=None):
        before=capture('before-drag-'+str(target))
        sep=page.locator('.quant-backtest-dock [role=separator]')
        box=sep.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
        page.mouse.move(x,y);page.mouse.down()
        page.mouse.move(x,y+before['value']-target,steps=10)
        # A drag may resize many times, but must commit preference once on end.
        check('drag '+str(target)+' has no intermediate preference writes',
              page.evaluate('__dockAudit.state.preferences.length'),len(before['state']['preferences']))
        page.mouse.up();settle(page)
        after=capture('drag-'+str(target))
        check('pointer release '+str(target),after['value'],target if expected is None else expected)
        check('pointer release writes one preference',len(after['state']['preferences']),len(before['state']['preferences'])+1)
        return after
    try:
        page.goto(base+'/dock-interaction-audit',wait_until='domcontentloaded')
        page.evaluate(SETUP,{'host':case.get('host')})
        page.wait_for_function('window.__dockAudit?.dockChart()?.series[0]?.points.length===6')
        settle(page)
        initial=capture('initial')
        maximum=max(104,round(initial['host']['height']*.75))
        check('default height clamped to host',initial['value'],min(280,maximum))
        check('ARIA maximum uses host75%',initial['maximum'],maximum)
        check('five KPI cards',len(initial['kpis']),5)
        check('five KPI cards share a row',max(k['rect']['top'] for k in initial['kpis'])-min(k['rect']['top'] for k in initial['kpis'])<1)
        check('chart is below KPI strip',initial['graph']['top']>=initial['strip']['bottom']-1)
        check('chart fills KPI strip width',abs(initial['graph']['width']-initial['strip']['width'])<=1)
        check('zero Net Profit neutral',initial['kpis'][0]['tone'],'quant-backtest-tone-neutral')
        check('PF1 neutral',initial['kpis'][4]['tone'],'quant-backtest-tone-neutral')
        check('initial render does not persist',initial['state']['preferences'],[])
        original_chart=initial['chart']['index']
        page.screenshot(path=str(output/(name+'-initial.png')))

        # Keyboard steps use independent expected constants from the reference.
        height_key('End',104)
        height_key('Shift+ArrowUp',152)
        height_key('ArrowUp',168)
        height_key('ArrowDown',152)
        height_key('Shift+ArrowDown',104)
        height_key('Home',maximum)
        height_key('Shift+ArrowUp',maximum)
        check('keys keep chart instance',capture('keys-finished')['chart']['index'],original_chart)

        for height in [230,229,190]:
            state=drag_to(height)
            check(str(height)+' chart visible',state['graphVisible'])
            check(str(height)+' axes visibility',state['chart']['axisVisible'],[height>=230,height>=230])
        state=drag_to(189,104)
        check('under190 chart hidden and inert',state['graphHidden'] and state['graphInert'] and not state['graphVisible'])
        state=drag_to(min(280,maximum))
        check('restore height restores axes',state['chart']['axisVisible'],[True,True])
        check('drag keeps chart instance',state['chart']['index'],original_chart)
        full_height=state['chart']['height']
        small=drag_to(230)
        check('actual chart shrinks with Dock',small['chart']['height']<full_height)
        check('chart height matches actual host',abs(small['chart']['height']-small['chart']['host']['height'])<=1)
        state=drag_to(min(280,maximum))

        # After pointer release there must be no ongoing resize feedback cycle.
        stable=page.evaluate("""async()=>{const values=[];for(let i=0;i<24;i++){
          await new Promise(resolve=>requestAnimationFrame(resolve));const c=__dockAudit.dockChart();
          values.push({width:c.chartWidth,height:c.chartHeight,callbacks:__dockAudit.state.resizes.length});
        }return values}""")
        check('settled chart dimensions do not oscillate',len({(s['width'],s['height']) for s in stable}),1)
        check('settled onResize does not loop',len({s['callbacks'] for s in stable}),1)
        samples.append({'label':'settled-frames','frames':stable})

        # The explicit transient same-run path must preserve chart ownership.
        # A new settled report may legitimately rebuild its presentation.
        before=page.evaluate('__dockAudit.snapshot()')
        page.evaluate("""__dockAudit.publish({revision:2,status:'updating',metrics:{netProfit:10,profitFactor:2}})""")
        settle(page)
        live=capture('live-update')
        check('live report keeps Dock chart',live['chart']['index'],original_chart)
        check('live report does not persist preferences',len(live['state']['preferences']),len(before['preferences']))
        page.evaluate("""__dockAudit.publish({revision:3,metrics:{netProfit:0,profitFactor:1}})""")
        settle(page)

        # A collapse while a real graph control has focus must recover focus.
        page.locator('.quant-backtest-dock .highcharts-container').focus()
        page.evaluate("""document.querySelector('[aria-label="Collapse backtest summary"]').click()""")
        settle(page)
        collapsed=capture('collapsed')
        check('collapsed reference header height',round(collapsed['dock']['height']),45)
        check('collapsed title/date/net/viewer retained',all(collapsed[k] for k in
            ['titleVisible','rangeVisible','netVisible','viewerVisible']))
        check('collapsed keeps full date and neutral net',page.locator('.quant-backtest-dock-range').inner_text(),'Dec 31, 2025 - Jan 2, 2026')
        check('collapsed graph focus recovers',page.locator('[aria-label="Expand backtest summary"]').evaluate('n=>n===document.activeElement'))
        check('collapsed resize handle not tabbable',page.locator('.quant-backtest-dock [role=separator]').get_attribute('tabindex'),'-1')
        page.screenshot(path=str(output/(name+'-collapsed.png')))
        page.locator('.quant-backtest-dock [aria-label="Open backtest viewer"]').click()
        page.locator('.quant-backtest-viewer').wait_for(state='visible')
        check('Viewer opens from collapsed row',page.locator('#quant-backtest-tab-performance').get_attribute('aria-selected'),'true')
        page.keyboard.press('Escape')
        page.locator('.quant-backtest-viewer').wait_for(state='hidden')
        settle(page)
        check('return preserves collapsed row',page.locator('[aria-label="Expand backtest summary"]').is_visible())
        check('return restores actual Viewer trigger',page.locator('.quant-backtest-dock [aria-label="Open backtest viewer"]').evaluate('n=>n===document.activeElement'))
        page.locator('[aria-label="Expand backtest summary"]').click();settle(page)

        # Passive host resize must clamp against the parent, without a save.
        before=capture('before-host-resize')
        page.evaluate("""()=>{__dockAudit.host.style.height='240px';window.dispatchEvent(new Event('resize'))}""")
        settle(page)
        short=capture('host240')
        check('embedded parent clamp uses180',short['value'],180)
        check('parent clamp hides graph',short['graphHidden'] and short['graphInert'])
        check('passive resize not persisted',len(short['state']['preferences']),len(before['state']['preferences']))
        page.evaluate("""()=>{__dockAudit.host.style.height='400px';window.dispatchEvent(new Event('resize'))}""")
        height_key('Home',300)
        # A real keyboard Tab sweep cannot enter the previously hidden graph.
        page.locator('.quant-backtest-dock [role=separator]').focus()
        page.keyboard.press('End');settle(page)
        for index in range(5):
            page.keyboard.press('Tab')
            check('hidden graph excluded from Tab '+str(index),page.evaluate("""()=>{
              const active=document.activeElement;return !active.closest('.quant-backtest-dock-sparkline')
                && !!active.getClientRects().length && !active.closest('[inert]');}"""))

        final=capture('final-before-destroy')
        check('settings apply/retry/simulation/locate/favorite never invoked',
            [final['state'][k] for k in ['settingsApply','retry','simulation','tradeLocate','favorite']],[0]*5)
        check('single report subscription',final['state']['subscriptions'],1)
        check('onResize emits deduplicated heights',all(a!=b for a,b in zip(final['state']['resizes'],final['state']['resizes'][1:])))
        saves=len(final['state']['preferences'])
        page.evaluate('__dockAudit.workbench.destroy();__dockAudit.workbench.destroy()')
        settle(page)
        disposed=page.evaluate('({state:__dockAudit.snapshot(),resources:__dockAudit.renderer.getReportChartResourceStats()})')
        check('destroy unsubscribes once',disposed['state']['unsubscribes'],1)
        check('destroy does not save',len(disposed['state']['preferences']),saves)
        check('destroy removes chart DOM',page.locator('.quant-backtest-workbench,.highcharts-container').count(),0)
        check('destroy releases all charts and observers',all(value==0 for value in disposed['resources'].values()))
        check('no page/window errors',errors,[])
        check('no external requests',external,[])
        return {'name':name,'case':case,'checks':checks,'samples':samples,'disposed':disposed,
                'errors':errors,'external':external,'passed':True}
    except Exception as error:
        page.screenshot(path=str(output/(name+'-failure.png')))
        return {'name':name,'case':case,'checks':checks,'samples':samples,'errors':errors,
                'external':external,'exception':str(error),'passed':False}
    finally:
        context.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url')
    parser.add_argument('--browsers',default='chromium,firefox')
    parser.add_argument('--cases',default=','.join(case['name'] for case in CASES))
    parser.add_argument('--output',type=Path,default=ROOT/'audit-evidence/dock-interactions')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    cases=[case for case in CASES if case['name'] in args.cases.split(',')]
    if not cases:raise ValueError('No supported Dock case selected')
    before=source_hashes();results=[]
    with serve(args.base_url,args.output) as base,sync_playwright() as playwright:
        for browser_name in args.browsers.split(','):
            browser=getattr(playwright,browser_name).launch()
            try:
                for case in cases:
                    result=run_case(browser,browser_name,case,base,args.output)
                    results.append(result)
                    (args.output/(result['name']+'.json')).write_text(json.dumps(result,indent=2)+'\n')
                    print(json.dumps({'case':result['name'],'passed':result['passed'],
                        'checks':len(result['checks']),'exception':result.get('exception')}),flush=True)
            finally:
                browser.close()
    after=source_hashes()
    result={'passed':all(case['passed'] for case in results) and before==after,
        'cases':results,'checks':sum(len(case['checks']) for case in results),
        'sourceBefore':before,'sourceAfter':after,'sourceStable':before==after,
        'scope':'Fresh UI report / real Workbench+Highcharts; UI port side-effect guards, not engine or reference numerical golden.'}
    (args.output/'results.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'passed':result['passed'],'cases':len(results),'checks':result['checks'],
        'sourceStable':result['sourceStable']}))
    return 0 if result['passed'] else 1


if __name__=='__main__':
    raise SystemExit(main())
