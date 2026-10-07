#!/usr/bin/env python3
"""Real Hyperliquid candles through a bounded, controllable CONNECT blackhole.

The relay withholds encrypted bytes; it does not replace WebSocket, synthesize
market responses or dispatch browser connectivity events. All fault windows
are intentional transport injection, not an observed exchange outage.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import selectors
import socket
import socketserver
import subprocess
import threading
import time
from urllib.request import urlopen

from playwright.sync_api import sync_playwright
from e2e_provider_recovery import BOOTSTRAP, gc_resources, wait_state
from provider_smoke import NetworkEvidence

ROOT = Path(__file__).resolve().parents[1]
MARKET_HOST = 'api.hyperliquid.xyz'


def read_headers(sock):
    data = bytearray()
    while not data.endswith(b'\r\n\r\n'):
        part = sock.recv(1)
        if not part or len(data) > 16384:
            raise ConnectionError('CONNECT headers incomplete or oversized')
        data.extend(part)
    return bytes(data)


class Relay(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, upstream):
        self.upstream = upstream
        self.blocked = threading.Event()
        self.stopping = threading.Event()
        self.lock = threading.Lock()
        self.stats = dict(created=0, closed=0, marketCreated=0, marketClosed=0,
                          withheldBytes=0, forwardedBytes=0, peakBufferedBytes=0)
        super().__init__(('127.0.0.1', 0), Tunnel)

    def add(self, **values):
        with self.lock:
            for key, value in values.items():
                self.stats[key] += value

    def snapshot(self):
        with self.lock:
            return dict(self.stats, active=self.stats['created'] - self.stats['closed'],
                        marketActive=self.stats['marketCreated'] - self.stats['marketClosed'],
                        faultActive=self.blocked.is_set())


class Tunnel(socketserver.BaseRequestHandler):
    def handle(self):
        relay = self.server
        relay.add(created=1)
        upstream = None
        market = False
        try:
            self.request.settimeout(10)
            headers = read_headers(self.request)
            method, target, _ = headers.split(b'\r\n', 1)[0].decode('ascii').split(' ', 2)
            if method != 'CONNECT':
                self.request.sendall(b'HTTP/1.1 405 Method Not Allowed\r\n\r\n')
                return
            host, port = target.rsplit(':', 1)
            market = host == MARKET_HOST
            if market:
                relay.add(marketCreated=1)
            destination = relay.upstream or (host, int(port))
            upstream = socket.create_connection(destination, timeout=10)
            if relay.upstream:
                upstream.sendall(f'CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n'.encode())
                response = read_headers(upstream)
                if response.split(b' ', 2)[1] != b'200':
                    self.request.sendall(b'HTTP/1.1 502 Bad Gateway\r\n\r\n')
                    return
            self.request.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n')
            self.request.setblocking(False)
            upstream.setblocking(False)
            pending = {self.request: bytearray(), upstream: bytearray()}
            peer = {self.request: upstream, upstream: self.request}
            with selectors.DefaultSelector() as poll:
                poll.register(self.request, selectors.EVENT_READ)
                poll.register(upstream, selectors.EVENT_READ)
                while not relay.stopping.is_set():
                    holding = market and relay.blocked.is_set()
                    for sock in pending:
                        events = selectors.EVENT_READ
                        if pending[sock] and not holding:
                            events |= selectors.EVENT_WRITE
                        poll.modify(sock, events)
                    for key, mask in poll.select(timeout=.1):
                        sock = key.fileobj
                        if mask & selectors.EVENT_READ:
                            try:
                                data = sock.recv(65536)
                            except BlockingIOError:
                                continue
                            if not data:
                                return
                            pending[peer[sock]].extend(data)
                            if holding:
                                relay.add(withheldBytes=len(data))
                            buffered = sum(map(len, pending.values()))
                            with relay.lock:
                                relay.stats['peakBufferedBytes'] = max(relay.stats['peakBufferedBytes'], buffered)
                            if buffered > 2 * 1024 * 1024:
                                raise ConnectionError('bounded relay buffer exceeded')
                        if mask & selectors.EVENT_WRITE and pending[sock]:
                            try:
                                sent = sock.send(pending[sock])
                            except BlockingIOError:
                                continue
                            del pending[sock][:sent]
                            relay.add(forwardedBytes=sent)
        except (OSError, ValueError):
            # Peer resets and cancelled handshakes are expected during the
            # fault. Business recovery and resource assertions gate success.
            pass
        finally:
            if upstream is not None:
                upstream.close()
            self.request.close()
            relay.add(closed=1, marketClosed=int(market))


def run_case(browser, base, engine, relay, out, fault_seconds):
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    cdp = page.context.new_cdp_session(page)
    network = NetworkEvidence(cdp)
    page.route('**/__real_provider_recovery__', lambda route: route.fulfill(
        content_type='text/html', body='<html><body style="margin:0"><div id="chart" style="height:720px"></div><div id="report"></div></body></html>'))
    result = dict(engine=engine, samples=[], pageErrors=errors,
                  fault='CONNECT relay holds actual TLS bytes; navigator stays online')
    try:
        page.goto(base + '/__real_provider_recovery__')
        page.evaluate(BOOTSTRAP, engine)
        before = wait_state(page, lambda s: s['report'] and s['report']['status'] == 'ready'
                            and len(s['report']['trades']) == 2 and s['counters']['callbacks'] > 0,
                            'real history and live candles')
        page.evaluate('window.realProviderRecovery.openViewer()')
        result['before'] = before
        result['resourcesBefore'] = gc_resources(cdp)
        previous_connections = network.snapshot()['hyperliquid']['created']
        relay_before = relay.snapshot()
        start = time.monotonic()
        relay.blocked.set()
        stable = None
        while time.monotonic() - start < fault_seconds:
            page.wait_for_timeout(1000)
            state = page.evaluate('window.realProviderRecovery.state()')
            elapsed = time.monotonic() - start
            assert state['navigatorOnline'], 'test accidentally used browser offline mode'
            assert state['report']['status'] == 'ready' and len(state['report']['trades']) == 2, state
            assert state['report']['runId'] == before['report']['runId'], 'unexpected history rerun'
            if elapsed >= 3:
                if stable is None:
                    stable = state
                assert state['counters']['callbacks'] == stable['counters']['callbacks'], 'market bytes escaped blackhole'
                assert state['report']['revision'] == stable['report']['revision'], 'report advanced without candle'
                assert state['report']['trades'] == stable['report']['trades'], 'frozen ledger mutated'
            result['samples'].append(dict(elapsed=elapsed, counters=state['counters'],
                                          revision=state['report']['revision'], relay=relay.snapshot()))
            if len(result['samples']) % 15 == 0:
                print(json.dumps(dict(engine=engine, holdingSeconds=round(elapsed), relay=relay.snapshot())), flush=True)
        end = page.evaluate('window.realProviderRecovery.state()')
        assert network.snapshot()['hyperliquid']['created'] - previous_connections >= 2, 'watchdog did not replace sockets'
        assert relay.snapshot()['withheldBytes'] > relay_before['withheldBytes'], 'no real transport bytes withheld'
        result['faultDurationSeconds'] = time.monotonic() - start
        result['held'] = end
        relay.blocked.clear()
        recovered = wait_state(page, lambda s: s['report']['status'] == 'ready'
                               and s['counters']['callbacks'] > end['counters']['callbacks']
                               and s['report']['revision'] > end['report']['revision']
                               and network.snapshot()['hyperliquid']['lastCandleConnection'] > previous_connections,
                               'fresh socket and report after blackhole', timeout=90)
        result['recoverySeconds'] = time.monotonic() - start - result['faultDurationSeconds']
        assert recovered['report']['runId'] == before['report']['runId'], 'history reran on transport recovery'
        assert len(recovered['report']['trades']) == 2 and recovered['report']['canSimulate'], 'settled ledger lost'
        assert not recovered['connectivityEvents'], 'unexpected online/offline event'
        raw = page.evaluate('window.realProviderRecovery.context()')
        assert len(raw['trades']) == 2
        result.update(recovered=recovered, raw=raw, network=network.snapshot(), resourcesRecovered=gc_resources(cdp))
        page.screenshot(path=str(out / f'{engine}.png'))
        result['beforeDestroy'] = page.evaluate('window.realProviderRecovery.state()')
        page.evaluate('window.realProviderRecovery.destroy()')
        page.wait_for_timeout(3500)
        final = page.evaluate('window.realProviderRecovery.state()')
        result['destroyed'] = final
        assert final['counters']['subscriptions'] == final['counters']['unsubscriptions'], 'subscription leak'
        assert final['counters']['lateCallbacks'] == 0, 'late callback'
        assert final['counters']['runEvents'] == result['beforeDestroy']['counters']['runEvents'], 'run after destroy'
        assert network.snapshot()['hyperliquid']['active'] == 0, 'socket leak'
        assert not errors, errors
        result['status'] = 'passed'
    except Exception as error:
        result.update(status='failed', error=str(error))
        try:
            result['failureState'] = page.evaluate('window.realProviderRecovery?.state()')
            page.screenshot(path=str(out / f'{engine}-failure.png'))
        except Exception:
            pass
        raise
    finally:
        relay.blocked.clear()
        (out / f'{engine}.json').write_text(json.dumps(result, indent=2))
        page.close()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--fault-seconds', type=int, default=45)
    parser.add_argument('--upstream-proxy', help='Optional local HTTP CONNECT proxy, host:port')
    args = parser.parse_args()
    if args.fault_seconds < 30 or args.fault_seconds > 180:
        parser.error('fault-seconds must be between 30 and 180')
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    inputs = [Path(__file__), ROOT / 'tests/e2e_provider_recovery.py',
              ROOT / 'src/integrations/vela/provider-live.ts', ROOT / 'packages/vela-pinets/dist/index.js']
    hashes = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
    upstream = None
    if args.upstream_proxy:
        host, port = args.upstream_proxy.rsplit(':', 1)
        upstream = host, int(port)
    relay = Relay(upstream)
    relay_thread = threading.Thread(target=relay.serve_forever, daemon=True)
    relay_thread.start()
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    try:
        with (out / 'server.log').open('w') as log:
            server = subprocess.Popen(['node', 'node_modules/vite/bin/vite.js', '--config',
                'tests/vite-provider.config.ts', '--host', '127.0.0.1', '--port', str(port), '--strictPort'],
                cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
            try:
                deadline = time.monotonic() + 45
                while time.monotonic() < deadline:
                    if server.poll() is not None:
                        raise RuntimeError('Vite exited')
                    try:
                        if urlopen(base, timeout=.5).status == 200:
                            break
                    except OSError:
                        time.sleep(.1)
                else:
                    raise TimeoutError('Vite startup')
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(headless=True, proxy={
                        'server': f'http://127.0.0.1:{relay.server_address[1]}', 'bypass': 'localhost,127.0.0.1'})
                    try:
                        results = [run_case(browser, base, engine, relay, out, args.fault_seconds)
                                   for engine in ('PineEngine', 'PineWorkerEngine')]
                    finally:
                        browser.close()
                deadline = time.monotonic() + 10
                while relay.snapshot()['active'] and time.monotonic() < deadline:
                    time.sleep(.1)
                assert relay.snapshot()['active'] == 0, relay.snapshot()
                assert hashes == {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}, 'inputs changed during run'
                (out / 'results.json').write_text(json.dumps(dict(status='passed', cases=results,
                    relay=relay.snapshot(), inputHashes=hashes, upstreamProxy=args.upstream_proxy), indent=2))
                print(json.dumps(dict(status='passed', cases=len(results), relay=relay.snapshot())), flush=True)
            finally:
                server.terminate()
                server.wait(timeout=10)
    finally:
        relay.blocked.clear()
        relay.stopping.set()
        relay.shutdown()
        relay.server_close()
        relay_thread.join(timeout=5)
        (out / 'SHA256.json').write_text(json.dumps({str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(out.rglob('*')) if p.is_file() and p.name != 'SHA256.json'}, indent=2))


if __name__ == '__main__':
    main()
