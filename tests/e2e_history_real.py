#!/usr/bin/env python3
"""Current history guards and real Vela against public exchange candles.

No market fixture or request interception. Set QUANT_PROVIDER_PROXY explicitly
when the headless browser needs a proxy. Private evidence stays ignored.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

PROBE = r'''async () => {
  const {createWorkspaceProviders}=await import('/src/integrations/vela/provider-registry.ts');
  const {historyGaps}=await import('/src/integrations/vela/history-continuity.ts');
  const {providerHistoryCalendar}=await import('/src/integrations/vela/provider-history.ts');
  const {VelaWorkspace}=await import('/node_modules/@luxalgo/vela/dist/workspace.js');
  const {installVelaHistoryResilience}=await import('/src/integrations/vela/history-resilience.ts');
  const {installDefaultTimeframeSwitchPolicy}=await import('/src/integrations/vela/timeframe-switch-policy.ts');
  const {observeWorkspaceHistory,observedWorkspaceHistory}=await import('/src/integrations/vela/workspace-history-observer.ts');
  const factories=createWorkspaceProviders();
  installVelaHistoryResilience();
  const cases=[];
  for (const [kind,symbol] of [['binance','BTCUSDT'],['hyperliquid','BTC']]) {
    const provider=factories[kind]();
    for (const [tf,limit] of [['1',2000],['5',2000],['120',2000],['240',2000],['D',2000],['W',2000],['M',2000],['M',24]]) {
      const started=performance.now();
      const item={kind,symbol,timeframe:tf,limit,calendar:providerHistoryCalendar(provider)};
      try {
        const bars=await provider.getBars(symbol,tf,{limit});
        item.count=bars.length;item.first=bars[0]?.time;item.last=bars.at(-1)?.time;
        item.gaps=historyGaps(bars,tf,item.calendar);
        item.finite=bars.every(b=>['time','open','high','low','close'].every(k=>Number.isFinite(b[k])));
        item.dataComplete=bars.length>0&&bars.length<=limit&&!item.gaps.length&&item.finite;
        item.pass=item.dataComplete;
        item.outcome=item.dataComplete?'complete':'invalid-data';
      }catch(error){
        item.error=String(error);item.errorName=error.name;item.gaps=error.gaps;
        item.dataComplete=false;item.pass=false;item.outcome='rejected';
        // Independently distinguish a source hole from our calendar mistake.
        // This does not mark sparse data complete: the guarded load rejected.
        if(kind==='hyperliquid'&&tf==='M'&&error.name==='HistoryGapError') {
          item.sourceGapChecks=[];
          for(const gap of error.gaps.slice(0,8)) {
            const response=await fetch('https://api.hyperliquid.xyz/info',{method:'POST',
              headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'candleSnapshot',
                req:{coin:symbol,interval:'1M',startTime:gap.from,endTime:gap.to+30*86400000-1}})});
            const raw=await response.json();
            item.sourceGapChecks.push({gap,status:response.status,raw,
              absent:response.ok&&Array.isArray(raw)&&!raw.some(k=>k.t>=gap.from&&k.t<=gap.to)});
          }
          item.confirmedSourceGap=error.gaps.length<=8&&item.sourceGapChecks.length>0&&item.sourceGapChecks.every(c=>c.absent);
          item.pass=item.confirmedSourceGap;
          if(item.confirmedSourceGap)item.outcome='source-gap-rejected';
        }
      }
      item.elapsedMs=Math.round(performance.now()-started);cases.push(item);
    }
  }
  const workspace=new VelaWorkspace(document.querySelector('#ws'),{
    layout:'1',live:false,persist:false,providers:factories,
    theme:'dark',timezone:'Etc/UTC',animations:false,
    cells:{real:{symbol:'binance:BTCUSDT',timeframe:'60',bars:2000}},
  });
  const stop=observeWorkspaceHistory(workspace),stopPolicy=installDefaultTimeframeSwitchPolicy(workspace,2000);
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  function snapshot() {
    const chart=workspace.active.chart,rows=chart.orchestrator.rawBars;
    const history=observedWorkspaceHistory(workspace,workspace.active);
    const range=chart.getVisibleRange();
    const visibleCount=range?rows.filter(bar=>bar.time>=range.from&&bar.time<=range.to).length:0;
    const canvases=[...document.querySelectorAll('#ws canvas')].map(canvas=>{
      const rect=canvas.getBoundingClientRect();
      // Inspect the canvas that is still mounted, not a detached workspace or
      // the observer's load count. A copied surface supports either renderer.
      const copy=document.createElement('canvas');copy.width=96;copy.height=64;
      const context=copy.getContext('2d',{willReadFrequently:true});
      context.drawImage(canvas,0,0,96,64);
      const pixels=context.getImageData(0,0,96,64).data,colors=new Set();
      let opaquePixels=0;
      for(let offset=0;offset<pixels.length;offset+=4) {
        if(pixels[offset+3]>0) {
          opaquePixels++;
          colors.add([pixels[offset],pixels[offset+1],pixels[offset+2],pixels[offset+3]].join(','));
        }
      }
      return {width:canvas.width,height:canvas.height,displayWidth:rect.width,displayHeight:rect.height,
        opaquePixels,distinctColors:colors.size};
    });
    const state={timeframe:chart.market.timeframe,market:chart.market,history,
      rawBars:{count:rows.length,first:rows[0]?.time,last:rows.at(-1)?.time,
        finite:rows.every(bar=>['time','open','high','low','close'].every(key=>Number.isFinite(bar[key]))),
        strictlyIncreasing:rows.every((bar,index)=>index===0||bar.time>rows[index-1].time),
        gaps:historyGaps(rows,chart.market.timeframe,'utc-month')},
      range,visibleCount,canvases};
    state.checks={historyComplete:history?.historyComplete===true&&history.historyReason!=='aborted',
      boundedDepth:rows.length>0&&rows.length<=2000&&chart.market.bars===2000,
      observerMatchesRendered:history?.historyBarsLoaded===rows.length,
      finite:state.rawBars.finite,ordered:state.rawBars.strictlyIncreasing,continuous:state.rawBars.gaps.length===0,
      viewportFitsLoaded:visibleCount===rows.length&&range?.to===rows.at(-1)?.time,
      canvasPainted:canvases.some(canvas=>canvas.displayWidth>500&&canvas.displayHeight>300&&canvas.opaquePixels>100&&canvas.distinctColors>3)};
    state.pass=Object.values(state.checks).every(Boolean);
    return state;
  }
  // Python captures each state before cleanup. Previously finally destroyed
  // this workspace before chart.png was taken, leaving false blank evidence.
  window.__historyReal={workspace,
    async switch(tf) {
      await workspace.active.chart.setMarket({timeframe:tf});
      await workspace.active.chart.historyComplete();
      await paint();await wait(300);await paint();
      return snapshot();
    },snapshot,
    dispose() {stopPolicy();stop();workspace.destroy();delete window.__historyReal;
      return {workspaceDisposed:true,remainingCanvases:document.querySelectorAll('#ws canvas').length};},
  };
  await workspace.active.chart.historyComplete();
  return {cases};
}'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path,
                        default=ROOT/'audit-evidence/2026-10-07-history-real')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    result = {'fixtureRouting': False, 'responses': [], 'pageErrors': [], 'requestFailures': [],
              'explicitBrowserProxy': bool(os.environ.get('QUANT_PROVIDER_PROXY')),
              'sourceSha256': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                               for p in (ROOT/'src/integrations/vela').glob('*.ts')}}
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    with (args.output/'server.log').open('w') as log:
        process = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--config',
                                    'tests/vite-provider.config.ts', '--host', '127.0.0.1',
                                    '--port', str(port), '--strictPort'], cwd=ROOT, stdout=log,
                                   stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic()+30
            while True:
                if process.poll() is not None:
                    raise RuntimeError('Vite failed before ready')
                try:
                    with urlopen(base, timeout=1):
                        break
                except OSError:
                    if time.monotonic()>deadline:
                        raise RuntimeError('Vite readiness timeout')
                    time.sleep(.1)
            with sync_playwright() as p:
                options = {'headless': True}
                if proxy := os.environ.get('QUANT_PROVIDER_PROXY'):
                    options['proxy'] = {'server': proxy, 'bypass': '127.0.0.1,localhost'}
                browser = p.chromium.launch(**options)
                try:
                    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                    page.on('pageerror', lambda e: result['pageErrors'].append(str(e)))
                    page.on('requestfailed', lambda r: result['requestFailures'].append(
                        {'url': r.url, 'failure': r.failure}))

                    def response(r):
                        if '/klines?' not in r.url and r.url!='https://api.hyperliquid.xyz/info':
                            return
                        entry = {'url': r.url, 'status': r.status, 'request': r.request.post_data}
                        try:
                            body = r.body()
                            index = len(result['responses'])
                            name = f'response-{index:03d}.json'
                            (args.output/name).write_bytes(body)
                            entry.update(file=name, sha256=hashlib.sha256(body).hexdigest())
                        except Exception as e:
                            entry['captureError'] = str(e)
                        result['responses'].append(entry)

                    page.on('response', response)
                    # A blank same-origin surface avoids unrelated startup requests.
                    page.goto(base+'/tests/fixtures/history-live.html', wait_until='domcontentloaded')
                    result.update(page.evaluate(PROBE))
                    result['charts'] = []
                    for timeframe, label in [('1', '1m'), ('5', '5m'), ('120', '2h'), ('M', 'M')]:
                        chart = page.evaluate('(tf) => window.__historyReal.switch(tf)', timeframe)
                        screenshot = args.output/f'chart-{label}.png'
                        page.screenshot(path=str(screenshot))
                        chart.update(screenshot=screenshot.name,
                                     screenshotSha256=hashlib.sha256(screenshot.read_bytes()).hexdigest())
                        result['charts'].append(chart)
                finally:
                    if 'page' in locals() and not page.is_closed():
                        try:
                            result['cleanup'] = page.evaluate(
                                '() => window.__historyReal?.dispose() ?? {workspaceDisposed: false}')
                        except Exception as e:
                            result['cleanupError'] = str(e)
                    browser.close()
        except Exception as e:
            result['exception'] = str(e)
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
    (args.output/'result.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({k: result.get(k) for k in ['cases', 'charts', 'pageErrors', 'exception']}, indent=2))
    if result.get('exception') or result.get('cleanupError') or result['pageErrors'] or not result.get('cases') or len(result.get('charts', [])) != 4 or not all(
            c['pass'] for c in result.get('cases', [])+result.get('charts', [])):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
