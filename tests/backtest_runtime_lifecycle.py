#!/usr/bin/env python3
"""Real Vite HMR and bounded production lifecycle resource audit.

Uses deterministic provider HTTP responses to isolate resource ownership; this
is not live-provider, heap-leak, or long-duration acceptance. Production uses
a separately built entry importing the unchanged real createApp composition
root; it does not add test hooks to the shipped application or root dist/.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright
from e2e_app import install_mock_market_data, install_offline_guard

ROOT = Path(__file__).resolve().parents[1]
CONFIG = 'tests/vite-runtime-lifecycle.config.ts'
FIXTURE = '/tests/fixtures/runtime-lifecycle.html'

RESOURCE_AUDIT = r"""
(() => {
  const audit = { workerCreated: 0, workerTerminated: 0, messages: 0,
    socketsCreated: 0, socketsClosed: 0, intervals: new Set(), frames: new Set(),
    workers: new Set(), observers: new Map(), blobs: new Set() };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args); audit.workerCreated++; audit.workers.add(this);
      this.addEventListener('message', () => audit.messages++);
    }
    terminate() {
      if (audit.workers.delete(this)) audit.workerTerminated++;
      return super.terminate();
    }
  };
  const NativeObserver = window.ResizeObserver;
  window.ResizeObserver = class extends NativeObserver {
    constructor(callback) { super(callback); audit.observers.set(this, new Set()); }
    observe(target, options) { audit.observers.get(this).add(target); return super.observe(target, options); }
    unobserve(target) { audit.observers.get(this).delete(target); return super.unobserve(target); }
    disconnect() { audit.observers.get(this).clear(); return super.disconnect(); }
  };
  const createURL = URL.createObjectURL.bind(URL), revokeURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob) => { const url = createURL(blob); audit.blobs.add(url); return url; };
  URL.revokeObjectURL = (url) => { audit.blobs.delete(url); return revokeURL(url); };
  const interval = window.setInterval.bind(window), clear = window.clearInterval.bind(window);
  window.setInterval = (...args) => { const id = interval(...args); audit.intervals.add(id); return id; };
  window.clearInterval = (id) => { audit.intervals.delete(id); return clear(id); };
  const frame = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    const id = frame((time) => { audit.frames.delete(id); callback(time); });
    audit.frames.add(id); return id;
  };
  window.cancelAnimationFrame = (id) => { audit.frames.delete(id); return cancel(id); };
  const NativeSocket = window.WebSocket;
  class MarketSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) {
      super(); this.url = url; this.readyState = 0; audit.socketsCreated++;
      queueMicrotask(() => { if (this.readyState !== 0) return; this.readyState = 1;
        const event = new Event('open'); this.dispatchEvent(event); this.onopen?.(event); });
    }
    send() {}
    close() { if (this.readyState === 3) return; this.readyState = 3; audit.socketsClosed++;
      const event = new Event('close'); this.dispatchEvent(event); this.onclose?.(event); }
  }
  window.WebSocket = new Proxy(NativeSocket, { construct(Target, args) {
    return /^wss:\/\//.test(String(args[0])) ? new MarketSocket(args[0]) : new Target(...args);
  }});
  window.__runtimeResourceAudit = () => ({
    workerCreated: audit.workerCreated, workerTerminated: audit.workerTerminated,
    workers: audit.workers.size, messages: audit.messages,
    sockets: audit.socketsCreated - audit.socketsClosed,
    observerTargets: [...audit.observers.values()].reduce((sum, targets) => sum + targets.size, 0),
    intervals: audit.intervals.size, frames: audit.frames.size, blobs: audit.blobs.size,
    canvases: document.querySelectorAll('canvas').length,
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    workbenches: document.querySelectorAll('#backtest-workbench').length,
    favorites: document.querySelectorAll('#vela-action-quant-favorites').length,
    mounts: window.__runtimeLifecycle?.mounts ?? null,
    destroys: window.__runtimeLifecycle?.destroys ?? null,
    hotDisposals: window.__runtimeLifecycle?.hotDisposals ?? null,
  });
  window.__runtimeDocumentId = crypto.randomUUID();
})();
"""


def free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


def server(out, mode, dist=None):
    port = free_port()
    command = ['./node_modules/.bin/vite']
    if mode == 'production':
        command += ['preview', '--outDir', str(dist)]
    command += ['--config', CONFIG, '--host', '127.0.0.1', '--port', str(port), '--strictPort']
    log = (out / f'{mode}-server.log').open('w')
    process = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f'http://127.0.0.1:{port}'
    try:
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f'{mode} Vite exited: {process.returncode}')
            try:
                with urlopen(base + FIXTURE, timeout=1) as response:
                    if response.status == 200:
                        return process, log, base
            except OSError:
                time.sleep(0.1)
        raise TimeoutError(f'{mode} Vite not ready')
    except Exception:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=15)
        log.close()
        raise


def source_hashes():
    paths = set()
    for relative in ('src', 'packages/pinets/src', 'packages/vela-pinets/src'):
        paths.update(path for path in (ROOT / relative).rglob('*') if path.is_file())
    paths.update(ROOT / relative for relative in
                 ('tests/backtest_runtime_lifecycle.py', CONFIG,
                  'tests/fixtures/runtime-lifecycle.html', 'tests/fixtures/runtime-lifecycle.ts'))
    return {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(paths)}


def clean_state(page, *, dev):
    # One Vite heartbeat interval is allowed only in dev; every application
    # Worker/socket/observer/RAF/blob/DOM surface must be released.
    keys = ['workers', 'sockets', 'observerTargets', 'frames', 'blobs',
            'canvases', 'dialogs', 'workbenches', 'favorites']
    page.wait_for_function("""keys => keys.every(key => window.__runtimeResourceAudit()[key] === 0)""", arg=keys, timeout=15000)
    state = page.evaluate('window.__runtimeResourceAudit()')
    assert state['intervals'] == (1 if dev else 0), state
    return state


def exercise(page):
    page.wait_for_selector('#vela-action-quant-favorites')
    page.evaluate('window.__runtimeLifecycle.addStrategy()')
    dock = page.locator('.quant-backtest-dock')
    dock.wait_for(state='visible', timeout=60000)
    page.wait_for_function("""() => {
      const dock = document.querySelector('.quant-backtest-dock');
      return dock && !dock.textContent.includes('Computing') && dock.querySelector('[aria-label="Open backtest viewer"]');
    }""", timeout=60000)
    dock.locator('[aria-label="Open backtest viewer"]').click()
    page.locator('.quant-backtest-viewer').wait_for(state='visible')
    page.locator('.quant-backtest-tab', has_text='Trades Log').click()
    page.locator('.quant-backtest-tab', has_text='Performance').click()
    # Leave a modal open so destroy must release modal and chart resources.
    page.keyboard.press('Escape')
    page.locator('.quant-backtest-viewer').wait_for(state='hidden')
    page.locator('[aria-label="Open strategy settings"]:visible').first.click()
    page.locator('.quant-backtest-settings').wait_for(state='visible')
    state = page.evaluate('window.__runtimeResourceAudit()')
    assert state['workers'] >= 1 and state['workbenches'] == 1 and state['favorites'] == 1, state
    return state


def run_case(browser, base, *, dev, cycles):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.add_init_script(RESOURCE_AUDIT)
    requests, blocked, errors, console_errors, ws_frames = [], [], [], [], []
    install_offline_guard(context, blocked)
    install_mock_market_data(context, requests)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
    page.on('websocket', lambda ws: ws.on('framereceived', lambda frame: ws_frames.append(str(frame))))
    page.goto(base + FIXTURE)
    records = []
    for cycle in range(cycles):
        if cycle:
            page.evaluate('window.__runtimeLifecycle.mount()')
        before = exercise(page)
        if dev:
            with urlopen(Request(base + '/__runtime_lifecycle_change?kind=host', method='POST')) as response:
                assert response.status == 202
            page.wait_for_function('(n) => window.__runtimeLifecycle.mounts === n', arg=before['mounts'] + 1)
            page.wait_for_selector('#vela-action-quant-favorites')
            after_hot = page.evaluate('window.__runtimeResourceAudit()')
            assert after_hot['hotDisposals'] == cycle + 1, after_hot
            assert after_hot['favorites'] == 1 and after_hot['workbenches'] == 1, after_hot
        else:
            after_hot = None
        page.evaluate('window.__runtimeLifecycle.destroy()')
        after = clean_state(page, dev=dev)
        messages = after['messages']
        page.wait_for_timeout(250)
        assert page.evaluate('window.__runtimeResourceAudit().messages') == messages
        records.append({'cycle': cycle + 1, 'mounted': before, 'afterHot': after_hot, 'destroyed': after})
    assert not errors and not blocked, {'errors': errors, 'blocked': blocked}
    if dev:
        assert any('js-update' in item for item in ws_frames), ws_frames[-5:]
    else:
        assert not ws_frames, ws_frames
    root_updates = None
    if dev:
        # Cover the unmodified real root entry too. It accepts CSS updates;
        # main.ts changes intentionally produce a full document reload.
        worker_events = {'created': 0, 'closed': 0}
        def worker_created(worker):
            worker_events['created'] += 1
            worker.on('close', lambda _: worker_events.__setitem__('closed', worker_events['closed'] + 1))
        page.on('worker', worker_created)
        page.goto(base + '/')
        page.locator('.quant-backtest-dock-title', has_text='Lifecycle audit').wait_for(timeout=60000)
        page.wait_for_function('window.__runtimeResourceAudit().workers === 1')
        document_id = page.evaluate('window.__runtimeDocumentId')
        page.locator('[aria-label="Open strategy settings"]:visible').click()
        page.locator('.quant-backtest-settings').wait_for(state='visible')
        with urlopen(Request(base + '/__runtime_lifecycle_change?kind=css', method='POST')) as response:
            assert response.status == 202
        page.wait_for_timeout(300)
        assert page.evaluate('window.__runtimeDocumentId') == document_id
        assert page.locator('.quant-backtest-settings').is_visible()
        # CSS imported from JS is a js-update to /src/style.css in Vite 8;
        # link-tag stylesheets instead receive css-update messages.
        assert any('"path":"/src/style.css"' in item for item in ws_frames), ws_frames[-5:]
        css_resources = page.evaluate('window.__runtimeResourceAudit()')
        with urlopen(Request(base + '/__runtime_lifecycle_change?kind=main', method='POST')) as response:
            assert response.status == 202
        page.wait_for_function('(oldId) => typeof window.__runtimeDocumentId === "string" && window.__runtimeDocumentId !== oldId', arg=document_id)
        page.locator('.quant-backtest-dock-title', has_text='Lifecycle audit').wait_for(timeout=60000)
        page.wait_for_function('window.__runtimeResourceAudit().workers === 1')
        assert any('full-reload' in item for item in ws_frames), ws_frames[-5:]
        assert worker_events == {'created': 2, 'closed': 1}, worker_events
        root_resources = page.evaluate('window.__runtimeResourceAudit()')
        assert root_resources['favorites'] == 1 and root_resources['workbenches'] == 1
        root_updates = {'cssPreservedDocumentAndModal': True, 'scriptReloadedDocument': True,
                        'strategyRestored': True, 'workerEvents': dict(worker_events),
                        'afterCss': css_resources, 'afterReload': root_resources}
        assert not errors and not blocked, {'errors': errors, 'blocked': blocked}
    context.close()
    expected_cancellation = [message for message in console_errors
                             if 'Pine engine has been disposed' in message or 'Pine engine loading cancelled' in message]
    unexpected_console = [message for message in console_errors if message not in expected_cancellation]
    assert not unexpected_console, unexpected_console
    return {'cycles': records, 'errors': errors, 'blocked': blocked,
            'consoleCancellationMessages': expected_cancellation,
            'unexpectedConsoleErrors': unexpected_console,
            'marketRequests': len(requests), 'viteUpdateFrames': len(ws_frames),
            'rootEntryUpdates': root_updates,
            'scope': 'real createApp/Worker/DOM, deterministic HTTP and market sockets; bounded duration'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cycles', type=int, default=20)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)
    dist = out / 'dist'
    processes = []
    hashes = source_hashes()
    (out / 'source-sha256.json').write_text(json.dumps(hashes, indent=2))
    result = {'status': 'running', 'started': time.time(),
              'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'sourceFiles': len(hashes)}
    try:
        with (out / 'production-build.log').open('w') as log:
            subprocess.run(['./node_modules/.bin/vite', 'build', '--config', CONFIG,
                            '--outDir', str(dist)], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
        with sync_playwright() as playwright:
            options = {'headless': True}
            if os.getenv('CHROMIUM_EXECUTABLE'):
                options['executable_path'] = os.environ['CHROMIUM_EXECUTABLE']
            browser = playwright.chromium.launch(**options)
            try:
                for mode in ('dev', 'production'):
                    process, log, base = server(out, mode, dist)
                    processes.append((process, log))
                    result[mode] = run_case(browser, base, dev=mode == 'dev', cycles=3 if mode == 'dev' else args.cycles)
            finally:
                browser.close()
        assert source_hashes() == hashes, 'business sources or probe changed during verification'
        result['sourcesUnchanged'] = True
        result['status'] = 'passed'
    except Exception as error:
        result['status'] = 'failed'
        result['error'] = repr(error)
        raise
    finally:
        result['durationSeconds'] = round(time.time() - result['started'], 2)
        for process, log in processes:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=15)
            log.close()
        result['testServersStopped'] = all(process.poll() is not None for process, _ in processes)
        (out / 'result.json').write_text(json.dumps(result, indent=2))
        manifest = {str(path.relative_to(out)): hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in out.rglob('*') if path.is_file() and path.name != 'SHA256.json'}
        (out / 'SHA256.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps({'status': result['status'], 'durationSeconds': result['durationSeconds'], 'output': str(out)}))


if __name__ == '__main__':
    main()
