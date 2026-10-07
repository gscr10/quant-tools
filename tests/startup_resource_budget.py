#!/usr/bin/env python3
"""Production startup JS gzip budget: isolated eager vs current lazy builds.

The eager build only makes Worker/editor implementation imports static. Both
variants keep the same business data, lazy controller behavior and progressive
history. Empty chart and restored SMA are separate scenarios. All samples use
cold browser contexts, actual gzip HTTP responses and no Playwright routing.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import tempfile
from urllib.parse import urlparse

from playwright.async_api import async_playwright
from startup_loading import ROOT, KEY, OBSERVE, REPORT_OBSERVE
from startup_progressive_benchmark import serve, EXTRA_OBSERVE, digest


async def create_context(browser, scenario):
    context=await browser.new_context(viewport={'width':1440,'height':900},service_workers='block')
    seed={'version':1,'layout':'1','timezone':'Etc/UTC','charts':[{'id':'c1','symbol':'binance:BTCUSDT','timeframe':'15','bars':2000,
        'indicators':{'manifest':['SMA Cross (strategy)'] if scenario=='sma' else [],'natives':[]}}]}
    await context.add_init_script('\n'.join([
        'window.__STARTUP_REAL_PROVIDER__=false;window.__STARTUP_EXPECTED_BARS__=2000;',
        OBSERVE,REPORT_OBSERVE,EXTRA_OBSERVE,
        f'localStorage.setItem({json.dumps(KEY)},{json.dumps(json.dumps(seed))});',
    ]))
    return context


async def resource_stage(page, dist, responses):
    await page.wait_for_load_state('networkidle',timeout=30000)
    data=await page.evaluate("""() => ({at:performance.now(),workers:window.__startup.workers.size,
      resources:performance.getEntriesByType('resource').map(r=>({name:r.name,initiator:r.initiatorType,
        start:r.startTime,duration:r.duration,transfer:r.transferSize,encoded:r.encodedBodySize,decoded:r.decodedBodySize}))})""")
    assets=[]
    for row in data['resources']:
        path=urlparse(row['name']).path
        if not path.startswith('/assets/'):continue
        file=dist/path.lstrip('/')
        assert file.is_file(),row
        encoded=len(gzip.compress(file.read_bytes(),mtime=0))
        assert row['encoded']==encoded and row['transfer']>0,(row,encoded)
        observed=[response for response in responses if response['url']==row['name']]
        assert observed and all(response['encoding']=='gzip' and response['status']==200 for response in observed),observed
        assets.append({**row,'actualGzipBytes':encoded,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
    scripts=[row for row in assets if urlparse(row['name']).path.endswith('.js')]
    assert scripts,'No production JavaScript request was observed'
    return {**data,'assets':assets,'jsRequests':len(scripts),'jsEncodedBytes':sum(row['encoded'] for row in scripts),
            'staticEncodedBytes':sum(row['encoded'] for row in assets)}


async def sample(browser,variant,scenario,ordinal,base,dist,output,requests):
    context=await create_context(browser,scenario);page=await context.new_page()
    label=f'{scenario}-{ordinal:02}-{variant}';errors=[];failures=[];external=[];responses=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('requestfailed',lambda r:failures.append({'url':r.url,'failure':r.failure}))
    page.on('request',lambda r:external.append(r.url) if urlparse(r.url).scheme in ('http','https') and not r.url.startswith(base+'/') else None)
    page.on('response',lambda r:responses.append({'url':r.url,'status':r.status,'encoding':r.headers.get('content-encoding'),'type':r.request.resource_type}))
    result={'label':label,'variant':variant,'scenario':scenario,'ordinal':ordinal,'startedAt':datetime.now(timezone.utc).isoformat()}
    try:
        await page.goto(base+'/?chart=maximized&sample='+label,wait_until='domcontentloaded')
        await page.wait_for_function("window.__startup.events.some(e=>e.kind==='history:complete' && e.value.barsLoaded===2000)",timeout=30000)
        await page.wait_for_function('window.__startup.candlePaint!==null')
        if scenario=='sma':await page.wait_for_function('window.__startup.report.engineReady!==null',timeout=30000)
        if scenario=='sma':
            # The report dock's sparkline is the real product enhancement
            # boundary. Waiting for its Highcharts SVG, rather than a guessed
            # sleep, makes both eager/lazy variants include the same chart
            # module before the startup byte sample.
            await page.wait_for_selector('.quant-backtest-dock .quant-backtest-chart-host svg.highcharts-root',timeout=30000)
            await page.wait_for_timeout(100)
        else:
            # Empty pages intentionally do not mount Highcharts. Keep a small
            # quiet window only to collect any other post-history resources.
            await page.wait_for_timeout(100)
        result['startup']=await resource_stage(page,dist,responses)
        result['startup']['history']=await page.evaluate("window.__startup.events.find(e=>e.kind==='history:complete' && e.value.barsLoaded===2000)")
        result['startup']['candlePaint']=await page.evaluate('window.__startup.candlePaint')
        if scenario=='sma':
            snapshot=await page.evaluate('window.__startup.fullSnapshot')
            stable={'strategy':{k:v for k,v in snapshot['strategy'].items() if k not in ('reportRunId','reportSnapshotRevision')},
                    'trades':snapshot['trades'],'points':snapshot['reportSeries']['points'],'precision':snapshot.get('executionPrecision')}
            result['reportSha256']=digest(stable)
            result['report']=await page.evaluate('window.__startup.report.engineReady')
            assert result['startup']['workers']==1
        else:assert result['startup']['workers']==0
        assert not await page.locator('.cm-editor').count(),'Editor must not be mounted before actual first open'
        # Assert implementation absence on the lazy path with the complete
        # browser waterfall; eager bundles merge these modules into entry JS.
        if variant=='lazy':
            assert not any('pine-editor-controller' in r['name'] for r in result['startup']['assets'])
            if scenario=='empty':assert not any('worker-engine' in r['name'] for r in result['startup']['assets'])
        if ordinal==0:await page.screenshot(path=str(output/f'{label}-startup.png'))
        # Byte cutoff above is full chart/history/(if present) strategy
        # readiness, before user interactions intentionally request features.
        await page.locator('#vela-tool-vela-widget-panel-quant-pine-editor').click()
        editor=page.locator('.cm-content');await editor.wait_for(state='visible')
        source=await editor.inner_text();assert 'indicator("EMA 20 + Bands"' in source,source
        await editor.click();await page.keyboard.press('ControlOrMeta+End')
        await page.keyboard.insert_text('\n// Resource budget first-open verification')
        await page.locator('.quant-run-button').click()
        await page.wait_for_function("window.__startup.events.some(e=>e.kind==='script:run' && e.value.title==='EMA 20 + Bands' && e.value.complete===true)",timeout=30000)
        result['editor']={'source':await editor.inner_text(),'executions':await page.evaluate("window.__startup.events.filter(e=>e.kind==='script:run' && e.value.title==='EMA 20 + Bands')")}
        assert 'Resource budget first-open verification' in result['editor']['source']
        result['afterEditor']=await resource_stage(page,dist,responses)
        if variant=='lazy':
            assert any('pine-editor-controller' in row['name'] for row in result['afterEditor']['assets'])
            assert any('worker-engine' in row['name'] for row in result['afterEditor']['assets'])
        if ordinal==0:await page.screenshot(path=str(output/f'{label}-editor.png'))
        await page.evaluate('window.__startup.app.destroy()')
        await page.wait_for_function('window.__startup.workers.size===0')
        result['destroy']={'workers':await page.evaluate('window.__startup.workers.size'),'canvases':await page.locator('canvas').count(),'editors':await page.locator('.cm-editor').count()}
        assert result['destroy']=={'workers':0,'canvases':0,'editors':0},result['destroy']
        assert not errors and not failures and not external,(errors,failures,external)
    except Exception as error:
        result['failure']=str(error)
        try:await page.screenshot(path=str(output/f'{label}-failed.png'))
        except Exception:pass
    finally:
        result.update(pageErrors=errors,requestFailures=failures,unexpectedExternal=external,responses=responses,
            network=[row for row in requests if row['sample']==label],finishedAt=datetime.now(timezone.utc).isoformat())
        (output/f'{label}.json').write_text(json.dumps(result,indent=2))
        await context.close()
    return result


def evaluate(results):
    failures=[row['label'] for row in results if 'failure' in row]
    summary={'failures':failures,'minimumSamplesPerVariantScenario':20,'minimumReduction':.15,'scenarios':{}}
    if failures:return {**summary,'pass':False}
    for scenario in ('empty','sma'):
        groups={variant:[row for row in results if row['scenario']==scenario and row['variant']==variant] for variant in ('eager','lazy')}
        count_ok=all(len(rows)>=20 for rows in groups.values())
        stages={}
        for stage in ('startup','afterEditor'):
            totals={variant:sorted(set(row[stage]['jsEncodedBytes'] for row in rows)) for variant,rows in groups.items()}
            stable=all(len(values)==1 for values in totals.values())
            reduction=1-totals['lazy'][0]/totals['eager'][0] if stable else None
            stages[stage]={'jsEncodedBytes':totals,'stable':stable,'reduction':reduction}
        reports=set(row['reportSha256'] for rows in groups.values() for row in rows if 'reportSha256' in row)
        result={'samples':{v:len(rows) for v,rows in groups.items()},'stages':stages,'reportDigests':sorted(reports),
            'pass':count_ok and stages['startup']['stable'] and stages['startup']['reduction']>=.15 and (scenario=='empty' or len(reports)==1)}
        summary['scenarios'][scenario]=result
    return {**summary,'pass':all(row['pass'] for row in summary['scenarios'].values())}


async def run(args,servers,dists,requests):
    results=[]
    async with async_playwright() as p:
        chrome=Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        browser=await p.chromium.launch(**({'executable_path':str(chrome)} if chrome.exists() else {}))
        try:
            for scenario in ('empty','sma'):
                for cycle in range(args.cycles):
                    for variant in ('eager','lazy','lazy','eager'):
                        ordinal=len([row for row in results if row['scenario']==scenario and row['variant']==variant])
                        result=await sample(browser,variant,scenario,ordinal,servers[variant],dists[variant],args.output,requests[variant])
                        results.append(result)
                        print(json.dumps({'label':result['label'],'startupJS':result.get('startup',{}).get('jsEncodedBytes'),'failure':result.get('failure')}),flush=True)
                        if 'failure' in result and args.cycles==1:return results
        finally:await browser.close()
    return results


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cycles',type=int,default=10)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.cycles<1:parser.error('--cycles must be positive')
    # Same deterministic HTTP/data model as the accepted progressive run.
    args.latency_ms=300;args.metadata_latency_ms=200;args.bytes_per_second=200000
    args.output.mkdir(parents=True,exist_ok=True)
    owned=[]
    with tempfile.TemporaryDirectory(prefix='quant-startup-resources-') as temp:
        dists={};requests={};urls={};builds={}
        try:
            for variant in ('eager','lazy'):
                dist=Path(temp)/variant;dists[variant]=dist;requests[variant]=[]
                with (args.output/f'{variant}-build.log').open('w') as log:
                    subprocess.run(['node','tests/startup_resource_build.mjs',str(dist),variant],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,check=True)
                builds[variant]={'transform':json.loads((dist/'benchmark-build.json').read_text()),
                    'assets':{str(file.relative_to(dist)):{'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'gzipBytes':len(gzip.compress(file.read_bytes(),mtime=0))}
                        for file in sorted(dist.rglob('*')) if file.is_file()}}
                server,thread=serve(dist,args,requests[variant]);owned.append((server,thread));urls[variant]=f'http://127.0.0.1:{server.server_port}'
            assert builds['eager']['transform']['inputs']==builds['lazy']['transform']['inputs'],'Source changed between A/B builds'
            source_paths=['tests/startup_resource_budget.py','tests/startup_resource_build.mjs','tests/startup_loading.py','tests/startup_progressive_benchmark.py']
            provenance={'startedAt':datetime.now(timezone.utc).isoformat(),'platform':platform.platform(),'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
                'args':{**vars(args),'output':str(args.output)},'controlledNetwork':True,'requestRouting':False,'servers':urls,'builds':builds,
                'sourceSha256':{path:hashlib.sha256((ROOT/path).read_bytes()).hexdigest() for path in source_paths}}
            results=asyncio.run(run(args,urls,dists,requests));summary=evaluate(results)
            (args.output/'summary.json').write_text(json.dumps({'provenance':provenance,'summary':summary,'resultFiles':[row['label']+'.json' for row in results]},indent=2))
            print(json.dumps(summary,indent=2));return 0 if summary['pass'] else 1
        finally:
            for server,thread in owned:server.shutdown();server.server_close();thread.join()


if __name__=='__main__':raise SystemExit(main())
