#!/usr/bin/env python3
"""Fresh DOM probes for V-04/05/07/08, using actual UI components.

This is a rendering contract check with newly constructed large KPI values,
not evidence of provider, engine, or reference-site numerical parity.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('QUANT_VISUAL_BASE_URL', 'http://127.0.0.1:5198')
OUT = Path(os.environ.get('QUANT_VISUAL_OUTPUT', '/tmp/quant-visual-boundaries-20261001'))
BROWSER = os.environ.get('QUANT_VISUAL_BROWSER', 'chromium')


@contextmanager
def server():
    if os.environ.get('QUANT_VISUAL_BASE_URL'):
        yield
        return
    process = subprocess.Popen([str(ROOT / 'node_modules/.bin/vite'), '--host', '127.0.0.1',
                                '--port', '5198', '--strictPort'], cwd=ROOT,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        deadline = time.monotonic() + 30
        while True:
            if process.poll() is not None:
                raise RuntimeError('Vite exited')
            try:
                with urlopen(BASE, timeout=1):
                    break
            except OSError:
                if time.monotonic() > deadline:
                    raise TimeoutError('Vite startup')
                time.sleep(.1)
        yield
    finally:
        process.terminate()
        process.wait(timeout=10)


with server(), sync_playwright() as playwright:
    OUT.mkdir(parents=True, exist_ok=True)
    browser = getattr(playwright, BROWSER).launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/visual-boundaries', lambda route: route.fulfill(content_type='text/html',
               body='<!doctype html><html><body style="margin:0"><main id="host" style="position:absolute;inset:0"></main></body></html>'))
    page.goto(BASE + '/visual-boundaries')
    page.evaluate('''async () => {
      const {BacktestWorkbench} = await import('/src/features/backtesting/backtest-workbench.ts');
      const {BacktestViewer} = await import('/src/features/backtesting/backtest-viewer.ts');
      const settings = {key:{cellId:'visual',indicatorId:'new'},title:'Boundary strategy',visible:true,
        inputs:[{key:'length',title:'Length',type:'int',defval:21}],props:[],inputValues:{length:34},propValues:{}};
      const report = {strategyName:'Boundary strategy',symbol:'ETHUSDT',timeframe:'15m',status:'ready',
        currency:'USD',metrics:{netProfit:123456789.12,trades:12345,winRate:54.67,maxDrawdown:1234567.89,
          maxDrawdownPercent:12.34,profitFactor:1.237,winningTrades:6749,losingTrades:5596},trades:[]};
      window.workbench = new BacktestWorkbench(document.querySelector('#host'),{
        initialReport:report,settings:{read:()=>settings,apply:()=>true}});
      window.report = report;
      window.second = new BacktestViewer(document,{onClose:()=>{}});
      document.querySelector('#host').append(second.element);
      second.open(report);
      second.element.style.display='none';
    }''')
    page.locator('[aria-label="Open strategy settings"]').click()
    settings_result = page.evaluate('''() => {
      const close=document.querySelector('.quant-backtest-settings-close');
      const style=getComputedStyle(close);
      const reset=[...document.querySelectorAll('.quant-backtest-settings-actions button')].find(e=>e.textContent==='Reset defaults');
      reset.click();
      return {appearance:style.appearance,background:style.backgroundColor,border:style.borderStyle,
        resetAppearance:getComputedStyle(reset).appearance,
        resetValue:document.querySelector('input[data-setting-key="length"]').value,
        settingsIconPaths:document.querySelectorAll('[aria-label="Open strategy settings"] svg path').length};
    }''')
    assert settings_result['appearance'] == 'none', settings_result
    assert settings_result['background'] == 'rgba(0, 0, 0, 0)', settings_result
    assert settings_result['border'] == 'none', settings_result
    assert settings_result['resetAppearance'] == 'none', settings_result
    assert settings_result['resetValue'] == '21', settings_result
    assert settings_result['settingsIconPaths'] >= 2, settings_result
    page.screenshot(path=str(OUT / 'settings.png'))
    page.locator('.quant-backtest-settings-close').click()
    page.evaluate('workbench.openViewer()')
    gradients = page.evaluate('''() => [...document.querySelectorAll('linearGradient[id^="quant-eth-gradient"]')].map(e=>({
      id:e.id,fill:e.closest('svg').querySelector('rect').getAttribute('fill')}))''')
    assert len(gradients) >= 2, gradients
    assert len({g['id'] for g in gradients}) == len(gradients), gradients
    assert all(g['fill'] == 'url(#' + g['id'] + ')' for g in gradients), gradients
    samples = []
    for width in [1440, 768, 390, 320]:
        page.set_viewport_size({'width':width,'height':844})
        page.wait_for_timeout(150)
        sample = page.evaluate('''() => {
          const bar=document.querySelector('.quant-backtest-workbench .quant-backtest-performance-kpi-bar');
          const cards=[...bar.children].map(e=>({width:e.clientWidth,scroll:e.scrollWidth,
            label:e.querySelector('.quant-backtest-kpi-label').textContent}));
          bar.scrollLeft=bar.scrollWidth;
          return {width:innerWidth,client:bar.clientWidth,scroll:bar.scrollWidth,
            scrollLeft:bar.scrollLeft,cards,bodyWidth:document.body.scrollWidth};
        }''')
        assert all(card['scroll'] <= card['width'] + 1 for card in sample['cards']), sample
        assert sample['bodyWidth'] <= width, sample
        if width <= 390:
            assert sample['scroll'] > sample['client'] and sample['scrollLeft'] > 0, sample
        samples.append(sample)
        page.screenshot(path=str(OUT / f'performance-{width}.png'))
    page.evaluate('workbench.destroy(); second.destroy()')
    assert not errors, errors
    result = {'browser':BROWSER,'settings':settings_result,'gradients':gradients,'samples':samples,'pageErrors':errors}
    (OUT / 'results.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    browser.close()
