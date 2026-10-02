#!/usr/bin/env python3
"""Real-DOM settings namespace and asynchronous dialog lifecycle regression.

Run: python3 tests/e2e_strategy_settings.py
Starts isolated Vite without a build. QUANT_SETTINGS_BASE_URL reuses an existing
dev server; QUANT_SETTINGS_BROWSER selects chromium, firefox or webkit.
"""
from contextlib import contextmanager
import os
from pathlib import Path
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("QUANT_SETTINGS_BASE_URL", "http://127.0.0.1:4194")
BROWSER = os.environ.get("QUANT_SETTINGS_BROWSER", "chromium")


@contextmanager
def dev_server():
    if os.environ.get("QUANT_SETTINGS_BASE_URL"):
        yield
        return
    process = subprocess.Popen(
        [str(ROOT / "node_modules/.bin/vite"), "--host", "127.0.0.1", "--port", "4194", "--strictPort"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.monotonic() + 45
        while True:
            if process.poll() is not None:
                raise RuntimeError("Settings test Vite exited before startup")
            try:
                with urlopen(BASE, timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                pass
            if time.monotonic() >= deadline:
                raise TimeoutError("Settings test Vite startup timed out")
            time.sleep(0.1)
        yield
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


with dev_server(), sync_playwright() as p:
    browser = getattr(p, BROWSER).launch()
    page = browser.new_page()
    # Minimal same-origin document: exercise the real component without
    # starting a second Workspace, provider connection or strategy Worker.
    page.route("**/settings-regression", lambda route: route.fulfill(
        content_type="text/html", body="<!doctype html><body></body>"))
    page.goto(BASE + "/settings-regression")
    result = page.evaluate("""async () => {
      const { StrategySettingsPanel } = await import('/src/features/backtesting/strategy-settings.ts');
      const assert = (value, message) => { if (!value) throw new Error(message); };
      const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
      const snapshot = (id) => ({
        key: {cellId:'cell', indicatorId:id}, title:id, visible:true,
        inputs: [
          {key:'initial_capital',title:'Signal length',type:'int',defval:3},
          {key:'use_bar_magnifier',title:'User toggle',type:'bool',defval:false},
          {key:'ratio',title:'Ratio',type:'float',defval:0.5},
        ],
        props: [
          {key:'initial_capital',title:'Capital',type:'float',defval:10000},
          {key:'use_bar_magnifier',title:'Magnifier',type:'bool',defval:true},
        ], inputValues:{}, propValues:{},
      });
      let request = deferred();
      const panel = new StrategySettingsPanel(document, {onApply: () => request.promise});
      document.body.append(panel.element);
      const field = (key) => panel.element.querySelector('input[data-setting-key="'+key+'"]');
      const ok = () => panel.element.querySelector('.quant-backtest-button-primary').click();
      const tab = (id) => panel.element.querySelector('[data-settings-tab="'+id+'"]').click();
      panel.open(snapshot('A'));
      assert(field('initial_capital').value === '3', 'Input default overwritten by property');
      assert(field('use_bar_magnifier').type === 'checkbox', 'User input became precision property');
      assert(field('ratio').step === 'any', 'Fractional float input has implicit integer step');
      tab('properties');
      assert(field('initial_capital').value === '10000', 'Property default overwritten by input');
      assert(panel.element.querySelector('select[data-setting-key="use_bar_magnifier"]'), 'Missing precision property selector');
      tab('inputs');
      field('initial_capital').value = '1.5';
      field('initial_capital').dispatchEvent(new Event('change', {bubbles:true}));
      ok();
      assert(panel.element.querySelector('.quant-backtest-settings-status.error'), 'Fractional integer accepted');
      field('initial_capital').value = '4';
      field('initial_capital').dispatchEvent(new Event('change', {bubbles:true}));
      assert(!panel.element.querySelector('.quant-backtest-settings-status.error'), 'Edited draft retained stale error styling');
      ok();
      assert([...panel.element.querySelectorAll('[data-setting-type]')].every(x => x.disabled), 'Busy controls still editable');
      panel.close();
      panel.open(snapshot('B'));
      request.resolve(true);
      await Promise.resolve(); await Promise.resolve();
      assert(panel.isOpen && panel.currentKey.indicatorId === 'B', 'Old apply closed new dialog');
      request = deferred(); ok();
      panel.close(); panel.open(snapshot('C'));
      request.reject(new Error('delayed failure'));
      await Promise.resolve(); await Promise.resolve();
      assert(!panel.element.querySelector('.quant-backtest-settings-status').textContent, 'Old rejection polluted new session');
      request = deferred(); ok();
      panel.destroy(); request.resolve(true);
      await Promise.resolve(); await Promise.resolve();
      assert(!panel.element.isConnected && panel.currentKey === null, 'Destroyed dialog resurrected');
      return {namespaces:true, precisionScope:true, fractionalInput:true, staleSuccess:true, staleFailure:true, destroy:true};
    }""")
    print(BROWSER, result)
    browser.close()
