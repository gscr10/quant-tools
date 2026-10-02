#!/usr/bin/env python3
"""Real Workspace/Worker F-07 regression, with deterministic Binance OHLC."""
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:4197'
SOURCE = '''//@version=6
strategy("Both Atomic", overlay=true)
len=input.int(10,"Length")
plot(len)
if bar_index==2
    strategy.entry("L",strategy.long)
'''


def install_independent_market(context, audit):
    """Self-contained finite feed; no repository OHLC fixtures or E2E helpers."""
    end = int(datetime(2026, 9, 29, 12, tzinfo=timezone.utc).timestamp() * 1000)

    def answer(route):
        url = urlparse(route.request.url)
        query = parse_qs(url.query)
        payload = {}
        if url.path.endswith('/exchangeInfo'):
            payload = {'symbols': [{'symbol': 'BTCUSDT', 'status': 'TRADING',
                'baseAsset': 'BTC', 'quoteAsset': 'USDT', 'contractType': 'PERPETUAL',
                'filters': [{'filterType': 'PRICE_FILTER', 'tickSize': '0.01'}]}]}
        elif url.path.endswith('/klines'):
            interval = query.get('interval', ['15m'])[0]
            units = {'m': 60000, 'h': 3600000, 'd': 86400000, 'w': 604800000}
            step = int(interval[:-1]) * units.get(interval[-1], 60000)
            last = (end // step) * step
            first = last - 1199 * step
            lo = int(query.get('startTime', [str(first)])[0])
            hi = int(query.get('endTime', [str(last)])[0])
            limit = min(1500, max(1, int(query.get('limit', ['500'])[0])))
            rows = []
            for index in range(1200):
                stamp = first + index * step
                if not lo <= stamp <= hi:
                    continue
                # A fresh deterministic stepped trend, deliberately unrelated
                # to the application's old crossover/chart fixture.
                opened = 63100 + index * 0.75 + (index % 7 - 3) * 2
                closed = opened + (1.5 if index % 3 else -2.25)
                rows.append([stamp, str(opened), str(max(opened, closed) + 4),
                    str(min(opened, closed) - 3), str(closed), str(18 + index % 11),
                    stamp + step - 1, '0', 1, '0', '0', '0'])
            payload = rows[:limit] if 'startTime' in query else rows[-limit:]
            audit.append({'interval': interval, 'count': len(payload),
                'from': payload[0][0] if payload else None,
                'to': payload[-1][0] if payload else None})
        elif url.hostname == 'api.hyperliquid.xyz':
            request = route.request.post_data_json or {}
            payload = {'universe': []} if request.get('type') == 'meta' else {'tokens': [], 'universe': []}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(payload))

    for host in ('api.binance.com', 'api.binance.us', 'fapi.binance.com', 'api.hyperliquid.xyz'):
        context.route(f'https://{host}/**', answer)

server = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--config',
    'tests/vite-performance.config.ts', '--host', '127.0.0.1', '--port', '4197', '--strictPort'],
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
        context = browser.new_context(viewport={'width':1440, 'height':900})
        market_audit = []
        install_independent_market(context, market_audit)
        context.route_web_socket('**/*', lambda socket: None)
        context.add_init_script('''(() => {
          window.__settingsMessages=[];
          const post=Worker.prototype.postMessage;
          Worker.prototype.postMessage=function(message) {
            window.__settingsMessages.push(structuredClone(message));
            return post.apply(this,arguments);
          };
        })()''')
        page = context.new_page()
        page.goto(BASE+'/?chart=maximized', wait_until='domcontentloaded')
        page.get_by_label('Pine editor', exact=True).first.click()
        page.locator('.cm-content').click()
        page.keyboard.press('ControlOrMeta+A')
        page.keyboard.insert_text(SOURCE)
        page.get_by_text('Run', exact=True).click()
        page.get_by_label('Open strategy settings', exact=True).first.wait_for(timeout=30000)
        page.wait_for_timeout(1500)
        page.get_by_label('Open strategy settings', exact=True).first.click()
        dialog = page.locator('.quant-backtest-settings-dialog')
        dialog.locator('input[type=number]:visible').first.fill('11')
        dialog.get_by_text('Properties', exact=True).click()
        dialog.locator('input[data-setting-key="precision"]').fill('3')
        before = page.locator('.quant-log-row').filter(has_text='script:run · Both Atomic').count()
        page.evaluate('window.__settingsMessages=[]')
        dialog.get_by_role('button', name='Ok', exact=True).click()
        page.wait_for_function('''before => [...document.querySelectorAll('.quant-log-row')]
          .filter(x=>x.textContent.includes('script:run · Both Atomic')).length > before''', arg=before)
        page.wait_for_timeout(1000)
        messages = page.evaluate('window.__settingsMessages.filter(x=>x.kind==="update")')
        runs = page.locator('.quant-log-row').filter(has_text='script:run · Both Atomic').count()-before
        assert len(messages)==1, messages
        assert runs==1, {'runs':runs}
        assert 11 in messages[0]['inputs'].values(), messages
        assert messages[0]['props']['precision']==3, messages
        page.get_by_label('Open strategy settings', exact=True).first.click()
        dialog.get_by_text('Inputs', exact=True).click()
        assert dialog.locator('input[type=number]:visible').first.input_value()=='11'
        dialog.get_by_text('Properties', exact=True).click()
        assert dialog.locator('input[data-setting-key="precision"]').input_value()=='3'
        page.evaluate('window.__settingsMessages=[]')
        dialog.get_by_role('button', name='Ok', exact=True).click()
        page.wait_for_timeout(300)
        assert page.evaluate('window.__settingsMessages.filter(x=>x.kind==="update").length')==0
        assert any(request['count'] > 0 for request in market_audit), market_audit
        print(json.dumps({'marketData': 'independently-generated-1200-bars',
            'marketRequests': market_audit, 'updateCount':len(messages),'runCount':runs,
            'inputAndPropsPersisted':True,'unchangedApplyUpdates':0,'update':messages[0]}, indent=2))
        browser.close()
finally:
    server.terminate()
    server.wait(timeout=5)
