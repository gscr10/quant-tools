#!/usr/bin/env python3
"""Exercise production UI preferences with actual Pine/Simulation Workers.

Only exchange transport is controlled; reports and all application state flow
through the real production entry. No injected report or screenshot baseline.
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

from e2e_app import (install_fixed_clock, install_mock_market_data,
                     install_offline_guard, MOCK_WEBSOCKET_SCRIPT)
from e2e_production_a11y import continuous_klines


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--browser', choices=['chromium', 'firefox'], default='chromium')
    parser.add_argument('--lifecycle-url', help='Optional dev lifecycle host for same-task destroy/queued favorite sync')
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    checks = []
    errors = []
    blocked = []
    requests = []

    def check(name, actual, expected):
        checks.append({'name': name, 'actual': actual, 'expected': expected,
                       'passed': actual == expected})

    with sync_playwright() as playwright:
        browser = getattr(playwright, args.browser).launch(headless=True)
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 1000},
                                          locale='en-US', timezone_id='UTC')
            install_fixed_clock(context)
            context.add_init_script(MOCK_WEBSOCKET_SCRIPT)
            install_offline_guard(context, blocked)
            install_mock_market_data(context, requests)
            context.route('**/klines?*', lambda route: route.fulfill(
                status=200, content_type='application/json',
                body=json.dumps(continuous_klines(route.request.url))))
            page = context.new_page()
            page.set_default_timeout(20000)
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(args.url, wait_until='domcontentloaded')
            page.locator('button:visible', has_text='Indicators').first.click()
            page.locator('.quant-indicator-category[data-section="built-ins"]').click()
            page.locator('.quant-indicator-row', has_text='SMA Cross (strategy)').locator('.quant-indicator-main').click()
            dock = page.locator('.quant-backtest-dock')
            open_viewer = dock.locator('[aria-label="Open backtest viewer"]')
            open_viewer.wait_for(state='visible')
            page.wait_for_function("document.querySelector('.quant-backtest-dock .quant-backtest-chart-host') !== null")
            handle = page.locator('[aria-label="Resize backtest summary"]')
            rect = handle.bounding_box()
            page.mouse.move(rect['x'] + rect['width']/2, rect['y'] + 4)
            page.mouse.down()
            page.mouse.move(rect['x'] + rect['width']/2, rect['y'] - 99, steps=12)
            page.mouse.up()
            page.wait_for_function("Math.round(document.querySelector('.quant-backtest-dock').getBoundingClientRect().height) === 383")
            check('dock resized to 383px', round(dock.bounding_box()['height']), 383)
            dock.locator('[aria-label="Collapse backtest summary"]').click()
            page.wait_for_function("Math.round(document.querySelector('.quant-backtest-dock').getBoundingClientRect().height) === 45")
            check('dock collapsed to 45px with summary and Viewer entry', round(dock.bounding_box()['height']), 45)
            check('collapsed Viewer entry stays reachable', open_viewer.is_visible(), True)
            check('collapsed strategy identity stays visible', dock.locator('.quant-backtest-dock-title').is_visible(), True)
            page.reload(wait_until='domcontentloaded')
            dock.locator('[aria-label="Expand backtest summary"]').wait_for(state='visible')
            check('collapsed state survives reload', round(dock.bounding_box()['height']), 45)
            dock.locator('[aria-label="Expand backtest summary"]').click()
            page.wait_for_function("Math.round(document.querySelector('.quant-backtest-dock').getBoundingClientRect().height) === 383")
            check('expanded height survives reload', round(dock.bounding_box()['height']), 383)
            page.reload(wait_until='domcontentloaded')
            open_viewer.wait_for(state='visible')
            check('expanded state survives reload', round(dock.bounding_box()['height']), 383)
            open_viewer.click()
            page.locator('.quant-backtest-performance').wait_for(state='visible')
            page.wait_for_function("document.querySelectorAll('#quant-backtest-panel .highcharts-root').length >= 3")
            # Let the actual Worker settle the final progressive history page
            # before testing projection-only changes and chart identity.
            page.wait_for_timeout(3000)
            panel = page.locator('#quant-backtest-panel')
            page.evaluate("""() => {
              const panel=document.querySelector('#quant-backtest-panel');
              window.__uiStateScrollTrace=[];
              const record=event=>window.__uiStateScrollTrace.push({event,at:performance.now(),
                tab:document.querySelector('.quant-backtest-tab.active')?.textContent,
                top:panel.scrollTop,height:panel.scrollHeight,text:panel.innerText.slice(0,100),
                focus:document.activeElement?.id});
              panel.addEventListener('scroll',()=>record('scroll'));
              new MutationObserver(()=>record('replace')).observe(panel,{childList:true});
            }""")
            tab = lambda name: page.locator('#quant-backtest-tab-' + name)
            top = lambda: panel.evaluate('(node) => node.scrollTop')

            def shared_tab(name):
                previous = top()
                tab(name).click()
                extent = panel.evaluate('(node) => Math.max(0, node.scrollHeight - node.clientHeight)')
                actual, expected = top(), min(previous, extent)
                checks.append({'name': 'shared scroll clamps to current ' + name + ' content',
                               'actual': actual, 'expected': expected, 'extent': extent,
                               'toleranceCssPx': 0.5, 'passed': abs(actual - expected) <= 0.5})

            def wheel(distance):
                page.wait_for_function('document.querySelector("#quant-backtest-panel").scrollHeight > document.querySelector("#quant-backtest-panel").clientHeight && !document.querySelector("#quant-backtest-panel .quant-backtest-spinner")')
                page.wait_for_timeout(100)
                rect = panel.bounding_box()
                # Use the panel gutter, not a nested overflow:auto table or a
                # chart plot which can consume or delay wheel propagation.
                page.mouse.move(rect['x'] + 8, rect['y'] + 100)
                before_scroll = top()
                page.mouse.wheel(0, distance)
                page.wait_for_function('(before) => document.querySelector("#quant-backtest-panel").scrollTop > before', arg=before_scroll)
                page.wait_for_timeout(150)

            check('Viewer opens Performance', tab('performance').get_attribute('aria-selected'), 'true')
            check('Viewer starts at top', top(), 0)
            wheel(280)
            performance_scroll = top()
            check('Performance scroll moved by wheel', performance_scroll > 0, True)
            tab('performance').click()
            check('same Performance tab keeps current scroll', top(), performance_scroll)
            tab('performance').click()
            check('repeated same Performance tab keeps current scroll', top(), performance_scroll)
            shared_tab('log')
            wheel(330)
            log_scroll = top()
            check('Trades Log scroll moved by wheel', log_scroll > 0, True)
            tab('log').click()
            check('same Trades Log tab keeps current scroll', top(), log_scroll)
            shared_tab('performance')
            shared_tab('log')
            page.locator('.quant-backtest-viewer [aria-label="Return to chart"]').click()
            open_viewer.click()
            check('reopen defaults to Performance', tab('performance').get_attribute('aria-selected'), 'true')
            check('reopen resets Performance scroll', top(), 0)
            tab('log').click()
            check('reopen clears old Trades Log scroll', top(), 0)
            tab('performance').click()
            page.wait_for_timeout(1000)
            wheel(250)
            favorite_scroll = top()
            page.evaluate("window.__uiStateChart = document.querySelector('#quant-backtest-panel .highcharts-root')")
            star = page.locator('.quant-backtest-favorite')
            check('favorite initially off', star.get_attribute('aria-pressed'), 'false')
            star.click()
            page.wait_for_timeout(200)
            check('Viewer favorite toggles immediately', star.get_attribute('aria-pressed'), 'true')
            check('favorite preserves Performance scroll', top(), favorite_scroll)
            check('favorite preserves chart instance', page.evaluate("window.__uiStateChart === document.querySelector('#quant-backtest-panel .highcharts-root')"), True)
            page.screenshot(path=str(output/'favorite-after-viewer-toggle.png'))
            (output/'scroll-trace.json').write_text(json.dumps(page.evaluate('window.__uiStateScrollTrace'), indent=2))

            def indicators(section):
                page.locator('.quant-backtest-viewer [aria-label="Return to chart"]').click()
                page.locator('button:visible', has_text='Indicators').first.click()
                page.locator('.quant-indicator-category[data-section="' + section + '"]').click()

            indicators('favorites')
            row = page.locator('.quant-indicator-row', has_text='SMA Cross')
            check('Viewer favorite appears in indicator list', row.count(), 1)
            row.locator('[aria-label="Remove from favorites"]').click()
            page.keyboard.press('Escape')
            open_viewer.click()
            check('indicator removal synchronizes Viewer', star.get_attribute('aria-pressed'), 'false')
            page.reload(wait_until='domcontentloaded')
            open_viewer.click()
            page.locator('.quant-backtest-performance').wait_for(state='visible')
            page.wait_for_timeout(1000)
            check('removed favorite survives reload', star.get_attribute('aria-pressed'), 'false')
            indicators('on-chart')
            row = page.locator('.quant-indicator-row', has_text='SMA Cross')
            row.locator('[aria-label="Add to favorites"]').click()
            page.keyboard.press('Escape')
            open_viewer.click()
            check('indicator addition synchronizes Viewer', star.get_attribute('aria-pressed'), 'true')
            page.reload(wait_until='domcontentloaded')
            open_viewer.click()
            page.locator('.quant-backtest-performance').wait_for(state='visible')
            page.wait_for_timeout(1000)
            check('added favorite survives reload', star.get_attribute('aria-pressed'), 'true')
            page.screenshot(path=str(output/'final-viewer.png'))

            page.locator('.quant-backtest-viewer [aria-label="Return to chart"]').click()
            page.locator('[aria-label^="Layout —"]').click()
            page.locator('.vela-lp-sq[data-r="0"][data-c="1"]').click()
            page.locator('.vela-cell[data-cell-id="c2"]').click()
            page.locator('button:visible', has_text='Indicators').first.click()
            page.locator('.quant-indicator-category[data-section="built-ins"]').click()
            page.locator('.quant-indicator-row', has_text='SMA Cross (strategy)').locator('.quant-indicator-main').click()
            open_viewer.click()
            page.locator('.quant-backtest-performance').wait_for(state='visible')
            page.wait_for_timeout(1000)
            check('new cell inherits saved favorite', star.get_attribute('aria-pressed'), 'true')
            star.click()
            check('second cell removal updates active Viewer', star.get_attribute('aria-pressed'), 'false')
            page.locator('.quant-backtest-viewer [aria-label="Return to chart"]').click()
            page.locator('.vela-cell[data-cell-id="c1"]').click()
            open_viewer.click()
            check('background first cell favorite synchronized', star.get_attribute('aria-pressed'), 'false')
            indicators('on-chart')
            page.locator('.quant-indicator-row', has_text='SMA Cross').locator('[aria-label="Add to favorites"]').click()
            page.keyboard.press('Escape')
            page.locator('.vela-cell[data-cell-id="c2"]').click()
            open_viewer.click()
            check('list addition synchronizes background second cell', star.get_attribute('aria-pressed'), 'true')

            if args.lifecycle_url:
                saved_state = page.evaluate('Object.fromEntries(Object.entries(localStorage))')
                context.add_init_script('if (location.pathname.endsWith("/tests/fixtures/lifecycle.html")) {'
                                        + 'for (const [key,value] of Object.entries('
                                        + json.dumps(saved_state) + ')) localStorage.setItem(key,value);}')
                page.goto(args.lifecycle_url, wait_until='domcontentloaded')
                open_viewer.click()
                page.locator('.quant-backtest-performance').wait_for(state='visible')
                page.wait_for_timeout(1000)
                # click() and destroy happen in one task, before the shared
                # favorites subscriber's queued microtask can run.
                page.evaluate("""() => {
                  document.querySelector('.quant-backtest-favorite').click();
                  window.destroyQuantApp();
                  window.destroyQuantApp();
                }""")
                page.wait_for_timeout(200)
                check('queued favorite sync after destroy leaves no Workbench', page.locator('#backtest-workbench').count(), 0)
                page.evaluate('window.mountQuantApp()')
                open_viewer.click()
                page.locator('.quant-backtest-performance').wait_for(state='visible')
                check('remount uses persisted favorite after queued teardown', star.get_attribute('aria-pressed'), 'false')
                page.evaluate('window.destroyQuantApp()')
                check('final explicit destroy removes Workbench', page.locator('#backtest-workbench').count(), 0)
        except Exception as error:
            checks.append({'name': 'scenario execution', 'passed': False, 'error': str(error)})
            if 'page' in locals():
                page.screenshot(path=str(output/'failure.png'))
        finally:
            browser.close()
    check('page errors', errors, [])
    check('unexpected external requests', blocked, [])
    result = {'browser': args.browser, 'checks': checks, 'errors': errors, 'blocked': blocked, 'requests': requests}
    (output/'results.json').write_text(json.dumps(result, indent=2) + '\n')
    failed = [item for item in checks if not item['passed']]
    print(json.dumps({'checks': len(checks), 'failed': failed}, indent=2))
    return int(bool(failed))


if __name__ == '__main__':
    raise SystemExit(main())
