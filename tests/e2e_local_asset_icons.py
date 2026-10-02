#!/usr/bin/env python3
"""Actual Vela chart header + Viewer icon contract; controlled local OHLC only."""
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:5199'
OUT = Path(os.environ.get('QUANT_ICON_OUTPUT', '/tmp/quant-local-asset-icons'))
process = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--host', '127.0.0.1',
                            '--port', '5199', '--strictPort'], cwd=ROOT,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    deadline = time.monotonic()+30
    while True:
        if process.poll() is not None:
            raise RuntimeError('Vite exited')
        try:
            with urlopen(BASE, timeout=1):
                break
        except OSError:
            if time.monotonic()>deadline:
                raise TimeoutError('Vite startup')
            time.sleep(.1)
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width':1280,'height':900})
        errors=[]
        external=[]
        page.on('pageerror', lambda e:errors.append(str(e)))
        def intercept(route):
            url=route.request.url
            if url.startswith(BASE):
                route.continue_()
            else:
                external.append(url)
                route.abort()
        page.route('**/*', intercept)
        page.route('**/local-icons', lambda r:r.fulfill(content_type='text/html',body='<!doctype html><body style="margin:0"><div id="chart" style="height:600px"></div><div id="report" class="quant-backtest-workbench" style="position:relative;height:300px"></div></body>'))
        page.goto(BASE+'/local-icons')
        page.evaluate('''async()=>{
          await import('/src/features/backtesting/backtest.css');
          const {VelaWorkspace}=await import('/node_modules/@luxalgo/vela/dist/workspace.js');
          const {createWorkspaceProviders}=await import('/src/integrations/vela/provider-registry.ts');
          const {BacktestViewer}=await import('/src/features/backtesting/backtest-viewer.ts');
          const binance=createWorkspaceProviders().binance();
          const bars=Array.from({length:20},(_,i)=>({time:1790812800000+i*900000,open:100+i,high:102+i,low:99+i,close:101+i,volume:50}));
          binance.listSymbols=async()=>['BTCUSDT','ETHUSDT','ETHFIUSDT'].map(ticker=>({ticker,type:'crypto',provider:'binance'}));
          binance.getSymbolInfo=async ticker=>({ticker,type:'crypto',mintick:0.01,pricescale:100});
          binance.getBars=async()=>bars; binance.subscribe=()=>()=>{};
          window.ws=new VelaWorkspace(document.querySelector('#chart'),{layout:'1',live:false,persist:false,
            theme:'dark',providers:{binance:()=>binance},cells:{main:{symbol:'BINANCE:BTCUSDT',timeframe:'15',data:bars}}});
          window.iconProvider=binance;
          window.v=new BacktestViewer(document,{onClose:()=>{}});document.querySelector('#report').append(v.element);
          window.renderAsset=async symbol=>{
            await ws.active.chart.setMarket({symbol:'BINANCE:'+symbol,data:bars});
            v.open({strategyName:'Local icons',symbol,timeframe:'15m',status:'ready',trades:[]});
          };
          await renderAsset('BTCUSDT');
        }''')
        results=[]
        for symbol in ['BTCUSDT','ETHUSDT','ETHFIUSDT']:
            page.evaluate('symbol=>renderAsset(symbol)',symbol)
            page.wait_for_timeout(250)
            result=page.evaluate('''async symbol=>{
              const url=iconProvider.resolveSymbolIcon({ticker:symbol});
              const images=[...document.querySelectorAll('#chart img')].filter(e=>e.getAttribute('src')===url);
              const image=images.find(e=>e.getBoundingClientRect().width>0);
              if(image) await image.decode();
              const paths=[...document.querySelectorAll('#report .quant-backtest-viewer-market-badge path')].map(e=>e.getAttribute('d'));
              let geometryMatches=false,exportable=false;
              if(url){
                const svg=new DOMParser().parseFromString(decodeURIComponent(url.split(',')[1]),'image/svg+xml');
                geometryMatches=JSON.stringify([...svg.querySelectorAll('path')].map(e=>e.getAttribute('d')))===JSON.stringify(paths);
                if(image){const canvas=document.createElement('canvas');canvas.width=56;canvas.height=56;canvas.getContext('2d').drawImage(image,0,0);exportable=canvas.toDataURL().startsWith('data:image/png');}
              }
              return {symbol,local:!!url?.startsWith('data:image/svg+xml'),visibleChartImage:!!image,
                imageLoaded:!!image?.naturalWidth,geometryMatches,exportable,viewerPaths:paths.length,
                remoteImages:[...document.querySelectorAll('#chart img')].filter(e=>/^https?:/.test(e.getAttribute('src')??'')).length};
            }''',symbol)
            if symbol!='ETHFIUSDT':
                assert all(result[k] for k in ['local','visibleChartImage','imageLoaded','geometryMatches','exportable']), result
            else:
                assert not result['local'] and result['viewerPaths']==0, result
            assert result['remoteImages']==0,result
            results.append(result)
            page.screenshot(path=str(OUT/(symbol+'.png')))
        page.evaluate('v.destroy();ws.destroy()')
        assert not errors and not external, {'errors':errors,'external':external}
        summary={'cases':results,'pageErrors':errors,'externalRequests':external,'data':'controlled local OHLC; no provider/price parity claim'}
        (OUT/'results.json').write_text(json.dumps(summary,indent=2))
        print(json.dumps(summary,indent=2))
        browser.close()
finally:
    process.terminate()
    process.wait(timeout=10)
