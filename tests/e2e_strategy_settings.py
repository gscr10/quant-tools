#!/usr/bin/env python3
"""Real-DOM settings namespace and asynchronous dialog lifecycle regression.

Run: python3 tests/e2e_strategy_settings.py
Starts isolated Vite without HMR or a build. QUANT_SETTINGS_BASE_URL reuses an existing
dev server; QUANT_SETTINGS_BROWSER selects chromium, firefox or webkit.
The default desktop scope includes compact windows; --scope full retains the
deferred phone layout/reset matrix as well.
"""
from contextlib import contextmanager
import argparse
import os
from pathlib import Path
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("QUANT_SETTINGS_BASE_URL", "http://127.0.0.1:4194")
BROWSER = os.environ.get("QUANT_SETTINGS_BROWSER", "chromium")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--scope", choices=("desktop", "full"), default="desktop",
                    help="desktop (default) or full retained phone layout/reset matrix")
args = parser.parse_args()


@contextmanager
def dev_server():
    if os.environ.get("QUANT_SETTINGS_BASE_URL"):
        yield
        return
    process = subprocess.Popen(
        [str(ROOT / "node_modules/.bin/vite"), "--config", "tests/vite-performance.config.ts",
         "--host", "127.0.0.1", "--port", "4194", "--strictPort"],
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
    page_errors = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    # ResizeObserver loop errors are dispatched as ErrorEvents, and do not
    # consistently surface through Playwright's pageerror in every engine.
    page.add_init_script("""window.__settingsRuntimeErrors=[];
      window.addEventListener('error', event => window.__settingsRuntimeErrors.push(event.message));""")
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
      const settingsTab = (id) => panel.element.querySelector('[data-settings-tab="'+id+'"]');
      const settingsPanel = panel.element.querySelector('#quant-backtest-settings-panel');
      assert(settingsPanel?.getAttribute('role') === 'tabpanel', 'Settings fields missing tabpanel semantics');
      assert(settingsPanel.tagName === 'DIV' && settingsPanel.querySelector('form:not([role])'), 'Settings tabpanel must preserve a native form without overriding its allowed role');
      assert(settingsTab('inputs')?.getAttribute('aria-controls') === 'quant-backtest-settings-panel', 'Inputs tab missing panel relation');
      assert(settingsTab('properties')?.getAttribute('aria-controls') === 'quant-backtest-settings-panel', 'Properties tab missing panel relation');
      settingsTab('inputs').focus();
      settingsTab('inputs').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
      assert(settingsTab('properties').getAttribute('aria-selected') === 'true', 'ArrowRight did not switch Settings tab');
      assert(document.activeElement === settingsTab('properties'), 'ArrowRight did not retain focus on the selected tab');
      assert(settingsPanel.getAttribute('aria-labelledby') === 'quant-backtest-settings-tab-properties', 'Properties panel label is stale');
      settingsTab('properties').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowLeft', bubbles:true}));
      assert(settingsTab('inputs').getAttribute('aria-selected') === 'true', 'ArrowLeft did not switch Settings tab');
      assert(document.activeElement === settingsTab('inputs'), 'ArrowLeft did not retain focus on the selected tab');
      settingsTab('inputs').dispatchEvent(new KeyboardEvent('keydown', {key:'End', bubbles:true}));
      assert(settingsTab('properties').getAttribute('aria-selected') === 'true', 'End did not select the last Settings tab');
      settingsTab('properties').dispatchEvent(new KeyboardEvent('keydown', {key:'Home', bubbles:true}));
      assert(settingsTab('inputs').getAttribute('aria-selected') === 'true', 'Home did not select the first Settings tab');
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

    # Fresh pointer/keyboard control contracts, including the reference Vela
    # dropdown and numeric steppers. Exercise the visible control as well as
    # the native form model; selecting hidden form state alone cannot prove UI.
    page.set_viewport_size({"width": 1440, "height": 1000})
    page.evaluate("""async () => {
      await new Promise((resolve, reject) => {
        const style = document.createElement('link'); style.rel = 'stylesheet';
        style.href = '/src/style.css'; style.onload = resolve; style.onerror = reject;
        document.head.append(style);
      });
      await import('/src/features/backtesting/backtest.css');
      const { StrategySettingsPanel } = await import('/src/features/backtesting/strategy-settings.ts');
      const { velaSettingsControls } = await import('/src/integrations/vela/settings-controls.ts');
      document.body.style.margin='0';
      const host=document.createElement('main');
      host.className='quant-backtest-workbench';
      host.style.cssText='position:fixed;inset:36px 0 0;pointer-events:auto';
      const dock=document.createElement('div');dock.className='quant-backtest-dock';dock.style.height='280px';host.append(dock);
      document.body.append(host);
      const snapshot={key:{cellId:'control-cell',indicatorId:'SMA'},title:'SMA Cross',visible:true,
        inputs:[{key:'fast',title:'Fast Length',type:'int',defval:9,min:1,max:99},
          {key:'slow',title:'Slow Length',type:'int',defval:21,min:1,max:199}],
        props:[{key:'quantity',title:'Default qty type',type:'string',defval:'fixed',options:['fixed','cash','percent_of_equity']},
          {key:'ratio',title:'Ratio',type:'float',defval:1,min:0,max:10,step:0.1},
          {key:'enabled',title:'Enabled',type:'bool',defval:false},
          {key:'use_bar_magnifier',title:'Magnifier',type:'bool',defval:false}],inputValues:{},propValues:{}};
      window.__settingsProbe={snapshot,applyCount:0,fail:false};
      const panel=new StrategySettingsPanel(document,{
        controls:velaSettingsControls,
        onApply:async (s,inputs,props)=>{
          window.__settingsProbe.applyCount++;
          window.__settingsProbe.applied={inputs,props};
          return !window.__settingsProbe.fail;
        },onReadAfterFailure:()=>({...snapshot,propValues:{ratio:2}}),
      });
      window.__settingsProbe.panel=panel;
      host.append(panel.element);panel.open(snapshot);
    }""")
    dialog = page.locator(".quant-backtest-settings-dialog")
    fast = dialog.locator('input[data-setting-key="fast"]')
    for raw, expected in [("0", "1"), ("999", "99"), ("2.6", "3")]:
        fast.fill(raw)
        fast.press("Tab")
        assert fast.input_value() == expected, (BROWSER, "numeric blur", raw)
    fast.fill("9")
    fast.press("Tab")
    number = fast.locator("..")
    number.hover()
    number.get_by_role("button", name="Increase", exact=True).click()
    assert fast.input_value() == "10"
    up = number.get_by_role("button", name="Increase", exact=True).bounding_box()
    page.mouse.move(up["x"] + up["width"] / 2, up["y"] + up["height"] / 2)
    page.mouse.down()
    page.wait_for_timeout(550)
    page.mouse.up()
    assert int(fast.input_value()) >= 12, "Held stepper did not repeat"
    held_value = fast.input_value()
    page.wait_for_timeout(120)
    assert fast.input_value() == held_value, "Released stepper continued changing draft"

    before = dialog.bounding_box()
    header = dialog.locator(".quant-backtest-settings-header").bounding_box()
    page.mouse.move(header["x"] + 70, header["y"] + 22)
    page.mouse.down()
    page.mouse.move(header["x"] + 160, header["y"] + 72, steps=10)
    page.mouse.up()
    after = dialog.bounding_box()
    assert abs(after["x"] - before["x"] - 90) < 1
    assert abs(after["y"] - before["y"] - 50) < 1

    dialog.get_by_role("tab", name="Properties", exact=True).click()
    trigger = dialog.get_by_role("combobox", name="Default qty type", exact=True)
    trigger.click()
    menu = page.get_by_role("listbox", name="Default qty type", exact=True)
    menu.get_by_role("option", name="cash", exact=True).click()
    assert trigger.inner_text().strip() == "cash", {"browser": BROWSER, "trigger": trigger.inner_text(),
        "value": dialog.locator('select[data-setting-key="quantity"]').input_value(),
        "focus": page.evaluate("document.activeElement?.outerHTML")}
    assert dialog.locator('select[data-setting-key="quantity"]').input_value() == "cash"
    trigger.click()
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    assert trigger.inner_text().strip() == "percent_of_equity"
    trigger.click()
    page.keyboard.press("Escape")
    assert dialog.is_visible(), "Select Escape closed Settings"
    assert trigger.evaluate("e=>e===document.activeElement"), "Select Escape lost focus"
    assert trigger.get_attribute("aria-controls") is None, "Closed select references a removed listbox"
    trigger.click()
    page.locator(".quant-backtest-settings-backdrop").click(position={"x": 10, "y": 10})
    assert dialog.is_visible(), "First outside click closed Settings and its select"
    assert page.get_by_role("listbox").count() == 0

    # Legacy form consumers still update the visible label and shared draft.
    select = dialog.locator('select[data-setting-key="use_bar_magnifier"]')
    select.select_option("true")
    assert dialog.get_by_role("combobox", name="Backtest precision").inner_text().strip() == "High precision"
    dialog.locator('input[data-setting-key="enabled"]').check()
    assert page.evaluate("window.__settingsProbe.applyCount") == 0
    dialog.get_by_role("button", name="Reset defaults", exact=True).click()
    assert trigger.inner_text().strip() == "fixed"
    assert page.evaluate("window.__settingsProbe.applyCount") == 0

    # Semantic validation still rejects a misaligned decimal; only normal
    # reference min/max and integer blur normalization happen in presentation.
    ratio = dialog.locator('input[data-setting-key="ratio"]')
    ratio.fill("0.35")
    dialog.get_by_role("button", name="Ok", exact=True).click()
    assert "increments of 0.1" in dialog.locator("[role=status]").inner_text()
    assert page.evaluate("window.__settingsProbe.applyCount") == 0
    ratio.fill("0.3")
    page.evaluate("window.__settingsProbe.fail=true")
    dialog.get_by_role("button", name="Ok", exact=True).click()
    page.wait_for_function("document.querySelector('.quant-backtest-settings-status').textContent.includes('Current host values were reloaded')")
    assert ratio.input_value() == "2", "Failure did not restore authoritative host values"

    resize_viewports = (
        [(390, 844), (320, 300), (1440, 1000)] if args.scope == "full"
        else [(1024, 768), (720, 450), (1440, 1000)]
    )
    for width, height in resize_viewports:
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(80)
        bounds = dialog.bounding_box()
        assert bounds["x"] >= -1 and bounds["x"] + bounds["width"] <= width + 1
        assert bounds["y"] >= 35 and bounds["y"] + bounds["height"] <= height + 1
        if width <= 640:
            assert dialog.evaluate("e=>e.style.transform") == ""
            assert abs(bounds["height"] - (height - 36)) < 1, "Mobile Settings retained desktop Dock inset"
        assert dialog.locator("[role=status]").evaluate("e=>e.scrollWidth<=e.clientWidth+1")
    page.evaluate("window.__settingsProbe.fail=false")
    dialog.get_by_role("button", name="Ok", exact=True).click()
    dialog.wait_for(state="hidden")
    assert page.evaluate("window.__settingsProbe.applyCount") == 2
    page.evaluate("window.__settingsProbe.panel.destroy()")
    assert page.get_by_role("listbox").count() == 0
    runtime_errors = page.evaluate("window.__settingsRuntimeErrors")
    assert not page_errors and not runtime_errors, {"browser": BROWSER,
        "pageErrors": page_errors, "runtimeErrors": runtime_errors}
    dev_clients = page.evaluate("performance.getEntriesByType('resource').filter(e=>e.name.includes('/@vite/client')).map(e=>e.name)")
    assert not dev_clients, {"browser": BROWSER, "unexpectedDevClient": dev_clients}
    print(BROWSER, {"referenceNumericBlur": True, "stepHoldCleanup": True,
        "pointerDrag": True, "selectPointerKeyboardEscape": True, "selectOutside": True,
        "draftOnlyReset": True, "stepValidation": True, "hostFailureRecovery": True,
        "scope": args.scope, "resizeViewports": resize_viewports,
        "mobileResize": "passed" if args.scope == "full" else "deferred (SCOPE-07)",
        "singleApply": True, "pageErrors": page_errors,
        "runtimeErrors": runtime_errors, "devClientRequests": dev_clients})
    browser.close()
