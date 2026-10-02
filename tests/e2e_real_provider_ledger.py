#!/usr/bin/env python3
"""Real-network SMA ledger/readiness probe; no request routing or market fixtures.

Starts a private Vite unless --base-url is supplied. Evidence records public
market responses only (never cookies, credentials or request headers).
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url')
    parser.add_argument('--port', type=int, default=5255)
    parser.add_argument('--output', type=Path, default=Path('/tmp/sma-live-fix-20261001'))
    parser.add_argument('--samples', type=int, default=12)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    base = args.base_url or f'http://127.0.0.1:{args.port}'
    evidence = {'url': base, 'startedAt': datetime.now(timezone.utc).isoformat(),
                'fixtureRouting': False, 'responses': [], 'requestFailures': [],
                'websockets': [], 'pageErrors': [], 'samples': [], 'checks': {}}
    evidence['sourceSha256'] = {name: hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in (
        'src/integrations/vela/backtest-results-adapter.ts',
        'src/integrations/vela/workspace-history-observer.ts',
        'src/integrations/vela/create-workspace.ts',
        'src/integrations/vela/provider-registry.ts',
        'src/app/backtest-controller.ts',
        'src/features/backtesting/backtest-viewer.ts',
        'src/features/backtesting/backtest-workbench.ts',
        'src/features/backtesting/strategy-settings.ts',
        'src/shared/asset-logos.ts',
    ) if (ROOT/name).exists()}
    server = None
    log = None
    try:
        if not args.base_url:
            log = (args.output/'vite.log').open('w')
            server = subprocess.Popen([str(ROOT/'node_modules/.bin/vite'), '--host', '127.0.0.1',
                                       '--port', str(args.port), '--strictPort'], cwd=ROOT, stdout=log, stderr=log)
            for _ in range(150):
                if server.poll() is not None:
                    raise RuntimeError('Private Vite failed; see vite.log')
                try:
                    if urlopen(base, timeout=1).status == 200:
                        break
                except OSError:
                    time.sleep(.2)
            else:
                raise RuntimeError('Private Vite did not become ready')
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                page.on('pageerror', lambda error: evidence['pageErrors'].append(str(error)))
                def record_socket(socket):
                    # Only public Binance market-stream endpoints are recorded.
                    if 'binance' not in socket.url:
                        return
                    item = {'url': socket.url, 'receivedFrames': 0, 'closed': False}
                    evidence['websockets'].append(item)
                    socket.on('framereceived', lambda _: item.update(receivedFrames=item['receivedFrames']+1))
                    socket.on('close', lambda: item.update(closed=True))
                page.on('websocket', record_socket)
                page.on('requestfailed', lambda req: evidence['requestFailures'].append(
                    {'url': req.url, 'failure': req.failure}) if 'binance' in req.url else None)

                def record_response(response):
                    if 'binance' not in response.url or '/klines?' not in response.url:
                        return
                    item = {'url': response.url, 'status': response.status}
                    try:
                        body = response.body()
                        item['bodySha256'] = hashlib.sha256(body).hexdigest()
                        data = json.loads(body)
                        item['barCount'] = len(data) if isinstance(data, list) else None
                        item['firstOpenTime'] = data[0][0] if isinstance(data, list) and data else None
                        item['lastOpenTime'] = data[-1][0] if isinstance(data, list) and data else None
                    except Exception as exc:
                        item['captureError'] = str(exc)
                    evidence['responses'].append(item)

                page.on('response', record_response)
                page.goto(base+'/?chart=maximized', wait_until='domcontentloaded')
                page.get_by_role('button', name='Indicators', exact=True).wait_for(timeout=60000)
                page.wait_for_function("() => document.body.innerText.includes('BTCUSDT')", timeout=60000)
                page.wait_for_timeout(4000)
                page.get_by_role('button', name='Indicators', exact=True).click()
                page.locator('.quant-indicator-category[data-section="built-ins"]').click()
                page.locator('.quant-indicator-row', has_text='SMA Cross (strategy)').locator('.quant-indicator-main').click()
                page.locator('#backtest-workbench .quant-backtest-dock').wait_for(timeout=60000)
                for index in range(args.samples):
                    page.wait_for_timeout(1000)
                    sample = page.evaluate('''() => {
                      const dock=document.querySelector('#backtest-workbench .quant-backtest-dock');
                      return {dockText:dock?.innerText, metrics:Object.fromEntries(
                        [...(dock?.querySelectorAll('.quant-backtest-dock-kpi')??[])].map(card=>[
                          card.querySelector('span')?.textContent,card.querySelector('strong')?.textContent]))};
                    }''')
                    evidence['samples'].append({'index': index, **sample})
                page.screenshot(path=str(args.output/'dock.png'), full_page=True)
                # The indicator dialog can cover the Dock; close via Escape, then
                # use its actual Viewer button rather than calling internal APIs.
                page.keyboard.press('Escape')
                page.locator('[aria-label="Open backtest viewer"]').click(timeout=15000)
                page.wait_for_timeout(2000)
                viewer = page.locator('[aria-label="Backtest report"]')
                evidence['viewerText'] = viewer.inner_text()
                evidence['performanceRows'] = viewer.locator('tr').evaluate_all("rows => rows.map(r=>[...r.querySelectorAll('th,td')].map(c=>c.textContent))")
                def amount(text):
                    import re
                    match = re.search(r'[-+]?\d[\d,]*\.\d+', text or '')
                    return float(match.group().replace(',', '')) if match else None
                performance = {row[0]: row[1:] for row in evidence['performanceRows'] if len(row)>1}
                nets = [amount(value) for value in performance.get('Net Profit', [])]
                benchmark = amount((performance.get('Buy and Hold PnL') or [''])[0])
                outperformance = amount((performance.get('Strategy Outperformance') or [''])[0])
                evidence['performanceFormulaChecks'] = {
                    'directionsSumToAll': len(nets)==3 and all(v is not None for v in nets) and abs(nets[0]-nets[1]-nets[2])<=.021,
                    'outperformanceVisibleFormula': bool(nets) and nets[0] is not None and benchmark is not None and outperformance is not None and abs(outperformance-(nets[0]-benchmark))<=.021,
                }
                page.screenshot(path=str(args.output/'viewer.png'), full_page=True)
                viewer.get_by_role('tab', name='Trades Log', exact=True).click()
                page.wait_for_timeout(500)
                evidence['tradeRows'] = viewer.locator('.quant-backtest-trade-table tbody tr').count()
                evidence['tradesLogText'] = viewer.inner_text()
                page.screenshot(path=str(args.output/'trades-log.png'), full_page=True)
                final = evidence['samples'][-1]['metrics']
                evidence['checks'] = {
                    'realHistoryResponse': any(r['status']==200 and (r.get('barCount') or 0)>0 for r in evidence['responses']),
                    'ledgerKpisPresent': all(final.get(key) not in (None, '', '—') for key in ('Trades', 'Win Rate', 'Profit Factor')),
                    'allSamplesHaveLedgerKpis': all(
                        sample['metrics'].get(key) not in (None, '', '—')
                        for sample in evidence['samples'] for key in ('Trades', 'Win Rate', 'Profit Factor')),
                    'viewerNotRunning': 'Running backtest' not in evidence['viewerText'],
                    'viewerHasTradeRows': evidence['tradeRows'] > 0,
                    'noPageErrors': not evidence['pageErrors'],
                    **evidence['performanceFormulaChecks'],
                }
            finally:
                browser.close()
    except Exception as exc:
        evidence['exception'] = str(exc)
    finally:
        if server:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
        if log:
            log.close()
        (args.output/'result.json').write_text(json.dumps(evidence, indent=2)+'\n')
    print(json.dumps({'checks': evidence['checks'], 'exception': evidence.get('exception'), 'output': str(args.output)}))
    if evidence.get('exception') or not evidence['checks'] or not all(evidence['checks'].values()):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
