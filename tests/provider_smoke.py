#!/usr/bin/env python3
"""Real-network smoke test for the Vela Binance and Hyperliquid providers.

QUANT_PROVIDER_PROXY optionally sets the browser proxy (e.g. http://127.0.0.1:9981).
Loopback Vite traffic bypasses it; REST and WebSocket use the same browser route.
"""

from __future__ import annotations

import json
import math
import os
import argparse
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import subprocess
import sys
import time
import socket
import tempfile
from urllib.request import urlopen

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HOST = "127.0.0.1"
PORT = int(os.environ.get("QUANT_PROVIDER_PORT", "4179"))
URL = f"http://{HOST}:{PORT}/tests/fixtures/provider-smoke.html"


class EvidenceWriter:
    def __init__(self, directory: Path | None, duration_seconds: float) -> None:
        self.directory = directory
        self.started = time.monotonic()
        self.duration_seconds = duration_seconds
        if directory is not None:
            directory.mkdir(parents=True, exist_ok=True)
            if (directory / "run.json").exists():
                raise ValueError(f"evidence directory already contains a run: {directory}")
            self.write("run.json", {
                "pid": os.getpid(), "startedAt": datetime.now(timezone.utc).isoformat(),
                "requestedDurationSeconds": duration_seconds, "status": "running",
                "explicitBrowserProxy": bool(os.environ.get("QUANT_PROVIDER_PROXY")),
                "sourceSha256": {
                    str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in [Path(__file__).resolve(), ROOT / "tests/fixtures/provider-smoke.html",
                                 *sorted((ROOT / "src/integrations/vela").glob("provider-*.ts"))]
                },
            })

    def write(self, name: str, value: dict[str, object]) -> None:
        if self.directory is None:
            return
        target = self.directory / name
        temporary = target.with_suffix(target.suffix + ".tmp")
        temporary.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n")
        temporary.replace(target)

    def progress(self, value: dict[str, object]) -> None:
        sample = {
            "sampledAt": datetime.now(timezone.utc).isoformat(),
            "processElapsedSeconds": round(time.monotonic() - self.started, 3), **value,
        }
        self.write("progress.json", sample)
        if self.directory is not None:
            with (self.directory / "progress.jsonl").open("a") as output:
                output.write(json.dumps(sample, sort_keys=True) + "\n")
                output.flush()
        state = sample.get("state", {})
        print(json.dumps({
            "providerSoak": state.get("status", "starting"),
            "elapsedSeconds": round(state.get("elapsedMs", 0) / 1000, 1),
            "requestedSeconds": self.duration_seconds,
            "callbacks": {name: data.get("liveCallbacks", 0)
                          for name, data in state.get("subscriptions", {}).items()},
            "recoveryCycles": len(state.get("recoveryCycles", [])),
        }), file=sys.stderr, flush=True)

    def finish(self, status: str, **values: object) -> None:
        self.write("result.json", {
            "status": status, "finishedAt": datetime.now(timezone.utc).isoformat(),
            "requestedDurationSeconds": self.duration_seconds,
            "processElapsedSeconds": round(time.monotonic() - self.started, 3), **values,
        })
        if self.directory is not None:
            self.write("SHA256.json", {
                "algorithm": "sha256",
                "files": {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in sorted(self.directory.iterdir())
                          if path.is_file() and path.name != 'SHA256.json'},
            })


class NetworkEvidence:
    def __init__(self, session) -> None:
        self.sockets: dict[str, dict[str, object]] = {}
        self.providers = {
            name: {"created": 0, "closed": 0, "active": 0, "maxActive": 0,
                   "framesReceived": 0, "candleFrames": 0, "lastCandleConnection": 0, "errors": 0}
            for name in ("binance", "hyperliquid")
        }
        session.on("Network.webSocketCreated", self.created)
        session.on("Network.webSocketClosed", self.closed)
        session.on("Network.webSocketFrameReceived", self.received)
        session.on("Network.webSocketFrameError", self.failed)
        session.send("Network.enable")
        session.send("Performance.enable")

    def created(self, event) -> None:
        address = event.get("url", "")
        provider = "binance" if "binance." in address else "hyperliquid" if "hyperliquid." in address else None
        if provider is None:
            return
        counters = self.providers[provider]
        counters["created"] += 1
        self.sockets[event["requestId"]] = {"provider": provider, "closed": False,
                                             "sequence": counters["created"]}
        counters["active"] += 1
        counters["maxActive"] = max(counters["maxActive"], counters["active"])

    def closed(self, event) -> None:
        socket_state = self.sockets.get(event["requestId"])
        if socket_state is None or socket_state["closed"]:
            return
        socket_state["closed"] = True
        counters = self.providers[socket_state["provider"]]
        counters["closed"] += 1
        counters["active"] -= 1

    def received(self, event) -> None:
        socket_state = self.sockets.get(event["requestId"])
        if socket_state is None:
            return
        counters = self.providers[socket_state["provider"]]
        counters["framesReceived"] += 1
        try:
            payload = json.loads(event.get("response", {}).get("payloadData", ""))
        except (ValueError, TypeError):
            return
        if isinstance(payload, dict) and (payload.get("k") or payload.get("channel") == "candle"):
            counters["candleFrames"] += 1
            counters["lastCandleConnection"] = socket_state["sequence"]

    def failed(self, event) -> None:
        socket_state = self.sockets.get(event["requestId"])
        if socket_state is not None:
            self.providers[socket_state["provider"]]["errors"] += 1

    def snapshot(self) -> dict[str, object]:
        return {name: dict(counters) for name, counters in self.providers.items()}


def browser_resources(session) -> dict[str, float]:
    metrics = session.send("Performance.getMetrics")["metrics"]
    names = {"JSHeapUsedSize", "JSHeapTotalSize", "Documents", "Nodes", "JSEventListeners"}
    return {metric["name"]: metric["value"] for metric in metrics if metric["name"] in names}


def run_duration_soak(page, duration_seconds: float, recovery: bool, evidence: EvidenceWriter,
                      recovery_interval_seconds: float, offline_seconds: float,
                      require_websocket: bool, page_errors: list[str], session,
                      network: NetworkEvidence, provider_scope: str = 'all') -> dict[str, object]:
    page.evaluate("args => window.startProviderSoak(args.durationMs, args.scope)",
                  {"durationMs": round(duration_seconds * 1000), "scope": provider_scope})
    provider_names = ('binance', 'hyperliquid') if provider_scope == 'all' else (provider_scope,)
    deadline = time.monotonic() + duration_seconds + 240
    next_progress = 0.0
    next_recovery = recovery_interval_seconds
    offline_started = None
    resources = []
    transport_recovery = []
    last_state = {}
    try:
        while time.monotonic() < deadline:
            state = page.evaluate("window.providerSoakState()")
            last_state = state
            now = time.monotonic()
            current_cycle = transport_recovery[-1] if transport_recovery else None
            if current_cycle is not None and current_cycle['onlineAt'] is not None:
                for name in provider_names:
                    if network.snapshot()[name]['lastCandleConnection'] > current_cycle['previousConnections'][name]:
                        current_cycle['resumedAt'].setdefault(name, datetime.now(timezone.utc).isoformat())
            if now >= next_progress or state["status"] in ("passed", "failed"):
                sample = browser_resources(session)
                resources.append(sample)
                evidence.progress({"state": state, "resources": sample, "websockets": network.snapshot(),
                                   "transportRecovery": transport_recovery})
                next_progress = now + 15
            if page_errors:
                raise AssertionError(page_errors)
            if state["status"] == "failed":
                raise AssertionError(state["error"])
            if state["status"] == "passed":
                result = state["result"]
                if result.get("observedDurationMs", 0) < duration_seconds * 1000:
                    raise AssertionError("soak completed before the requested duration")
                if recovery and not state["recoveryCycles"]:
                    raise AssertionError("soak completed without a scheduled offline/online cycle")
                # CDP reports Network.webSocketClosed asynchronously.  The
                # provider contract requires unsubscribe to close every
                # socket, but a fixed two-second sample can race the final
                # close event (especially after a long run with many
                # reconnects).  Wait for quiescence with a bounded deadline
                # and still fail closed if a socket remains active.
                teardown_started = time.monotonic()
                close_deadline = teardown_started + 10.0
                cleanup = page.evaluate("window.providerSoakState()")
                sockets = network.snapshot()
                while any(counters["active"] for counters in sockets.values()) and time.monotonic() < close_deadline:
                    page.wait_for_timeout(250)
                    cleanup = page.evaluate("window.providerSoakState()")
                    sockets = network.snapshot()
                teardown_wait_ms = round((time.monotonic() - teardown_started) * 1000)
                cleanup = page.evaluate("window.providerSoakState()")
                if cleanup["activeSubscriptions"] or cleanup["callbacksAfterCleanup"] or cleanup["cleanupErrors"]:
                    raise AssertionError(f"soak subscription cleanup failed: {cleanup}")
                if any(counters["active"] for counters in sockets.values()):
                    raise AssertionError(f"WebSockets remained active after unsubscribe: {sockets}")
                if require_websocket and any(sockets[name]["candleFrames"] == 0 for name in provider_names):
                    raise AssertionError(f"missing actual WebSocket candle evidence: {sockets}")
                if require_websocket and any(name not in cycle['resumedAt'] for cycle in transport_recovery for name in provider_names):
                    raise AssertionError(f"WebSocket candle stream did not resume after each outage: {transport_recovery}")
                result.update({
                    "websockets": sockets,
                    "transportRecovery": transport_recovery,
                    "cleanup": {key: cleanup[key] for key in ("activeSubscriptions", "callbacksAfterCleanup", "cleanupErrors")},
                    "teardownWaitMs": teardown_wait_ms,
                    "resources": {"first": resources[0], "last": browser_resources(session),
                                  "maxHeapUsedBytes": max(sample.get("JSHeapUsedSize", 0) for sample in resources),
                                  "samples": len(resources)},
                    "requireWebsocket": require_websocket,
                })
                return result
            elapsed = state.get("elapsedMs", 0) / 1000
            if require_websocket and elapsed > 60 and any(network.snapshot()[name]['candleFrames'] == 0 for name in provider_names):
                raise AssertionError(f"no actual WebSocket candle frames within 60 seconds: {network.snapshot()}")
            live_ready = all(provider.get("liveCallbacks", 0) > 0 for provider in state.get("subscriptions", {}).values())
            if offline_started is not None and now - offline_started >= offline_seconds:
                current_cycle['onlineAt'] = datetime.now(timezone.utc).isoformat()
                page.evaluate("window.setProviderSoakOnline(true)")
                page.context.set_offline(False)
                page.wait_for_function("navigator.onLine === true")
                offline_started = None
                next_recovery += recovery_interval_seconds
                evidence.progress({"event": "online", "state": page.evaluate("window.providerSoakState()"),
                                   "websockets": network.snapshot()})
            elif recovery and offline_started is None and state.get("startedAt") is not None and live_ready:
                recovered = current_cycle is None or not require_websocket or all(name in current_cycle['resumedAt'] for name in provider_names)
                if recovered and elapsed >= next_recovery and duration_seconds - elapsed > offline_seconds + 20:
                    transport_recovery.append({
                        'offlineAt': datetime.now(timezone.utc).isoformat(), 'onlineAt': None,
                        'previousConnections': {name: network.snapshot()[name]['created'] for name in provider_names},
                        'resumedAt': {},
                    })
                    page.context.set_offline(True)
                    page.wait_for_function("navigator.onLine === false")
                    page.evaluate("window.setProviderSoakOnline(false)")
                    offline_started = time.monotonic()
                    evidence.progress({"event": "offline", "state": page.evaluate("window.providerSoakState()"),
                                       "websockets": network.snapshot()})
            page.wait_for_timeout(500)
        raise TimeoutError("soak exceeded its requested duration and bounded setup allowance")
    except Exception as error:
        evidence.progress({"state": last_state, "error": str(error), "websockets": network.snapshot(),
                           "transportRecovery": transport_recovery})
        raise
    finally:
        try:
            if offline_started is not None:
                page.context.set_offline(False)
            page.evaluate("window.stopProviderSoak()")
            page.wait_for_timeout(500)
            evidence.write("cleanup.json", {
                "state": page.evaluate("window.providerSoakState()"),
                "resources": browser_resources(session), "websockets": network.snapshot(),
            })
        except Exception as cleanup_error:
            evidence.write("cleanup.json", {"error": str(cleanup_error)})


def wait_for_server(process: subprocess.Popen[str]) -> None:
    startup_timeout = float(os.environ.get("QUANT_E2E_STARTUP_TIMEOUT", "90"))
    deadline = time.monotonic() + max(5.0, startup_timeout)
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(
                f"Vite exited before becoming ready ({process.returncode})\n{output}"
            )
        try:
            with urlopen(URL, timeout=0.5) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError("Timed out waiting for the Vite provider-smoke server")


def wait_for_recovery_bar(page, minimum: int, timeout_ms: int = 90_000) -> list[dict[str, object]]:
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        state = page.evaluate("window.providerRecoveryState()")
        if state.get("error"):
            raise AssertionError(state["error"])
        bars = state.get("bars", [])
        if len(bars) >= minimum:
            return bars
        time.sleep(0.25)
    raise TimeoutError(f"provider recovery did not deliver bar {minimum} within {timeout_ms}ms")


def run_smoke(rounds: int = 1, recovery: bool = False, duration_seconds: float = 0,
              evidence: EvidenceWriter | None = None, recovery_interval_seconds: float = 300,
              offline_seconds: float = 3, require_websocket: bool = False,
              provider_scope: str = 'all') -> dict[str, object]:
    executable = os.environ.get("CHROMIUM_EXECUTABLE")
    if not executable:
        mac_chromium = "/Applications/Chromium.app/Contents/MacOS/Chromium"
        if Path(mac_chromium).exists():
            executable = mac_chromium

    with sync_playwright() as playwright:
        launch_options: dict[str, object] = {"headless": True}
        if executable:
            launch_options["executable_path"] = executable
        if proxy_server := os.environ.get("QUANT_PROVIDER_PROXY"):
            launch_options["proxy"] = {"server": proxy_server, "bypass": "127.0.0.1,localhost"}
        browser = playwright.chromium.launch(**launch_options)
        page = browser.new_page()
        page.set_default_timeout(45_000)
        page_errors: list[str] = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        session = page.context.new_cdp_session(page)
        network = NetworkEvidence(session)
        response = page.goto(URL, wait_until="domcontentloaded", timeout=30_000)
        assert response is not None and response.status == 200
        page.wait_for_function("window.providerSmokeReady === true")
        if duration_seconds:
            result = run_duration_soak(
                page, duration_seconds, recovery, evidence or EvidenceWriter(None, duration_seconds),
                recovery_interval_seconds, offline_seconds, require_websocket, page_errors, session, network, provider_scope,
            )
            result["roundsCompleted"] = 1
            result["durationSeconds"] = duration_seconds
        else:
            result = page.evaluate("rounds => window.runProviderSmoke(rounds)", rounds)
        if recovery and not duration_seconds:
            recovery_results = {}
            for provider_name in ("binance", "hyperliquid"):
                page.evaluate("name => window.beginProviderRecovery(name)", provider_name)
                before = wait_for_recovery_bar(page, 1)
                page.evaluate("window.setProviderRecoveryOnline(false)")
                page.context.set_offline(True)
                time.sleep(1.0)
                offline_state = page.evaluate("window.providerRecoveryState()")
                page.context.set_offline(False)
                page.evaluate("window.setProviderRecoveryOnline(true)")
                after = wait_for_recovery_bar(page, len(before) + 1)
                page.evaluate("window.endProviderRecovery()")
                if offline_state.get("offlineBars", 0):
                    raise AssertionError(
                        f"{provider_name} delivered {offline_state['offlineBars']} bars while offline"
                    )
                recovery_results[provider_name] = {
                    "initialBars": len(before),
                    "resumedBars": len(after),
                    "offlineBars": offline_state.get("offlineBars", 0),
                    "resumed": True,
                }
            result["networkRecovery"] = recovery_results
        browser.close()
        if page_errors:
            raise AssertionError(page_errors)
        return result


def choose_port() -> int:
    requested = os.environ.get("QUANT_PROVIDER_PORT")
    if requested:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind((HOST, PORT))
        return PORT
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((HOST, 0))
        return int(probe.getsockname()[1])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rounds', type=int, default=int(os.environ.get('QUANT_PROVIDER_SMOKE_ROUNDS', '1')))
    parser.add_argument('--recovery', action='store_true', help='toggle the real browser offline/online state')
    parser.add_argument('--duration-seconds', type=float, default=float(os.environ.get('QUANT_PROVIDER_SMOKE_DURATION_SECONDS', '0')))
    parser.add_argument('--output-dir', type=Path, help='save durable progress and final evidence')
    parser.add_argument('--recovery-interval-seconds', type=float, default=None)
    parser.add_argument('--offline-seconds', type=float, default=3)
    parser.add_argument('--require-websocket', action='store_true', help='require real candle frames, not polling fallback only')
    parser.add_argument('--provider', choices=('all', 'binance', 'hyperliquid'), default='all',
                        help='diagnose one provider in duration mode; cannot close the full provider gate')
    args = parser.parse_args()
    if args.rounds < 1:
        parser.error('--rounds must be positive')
    if not math.isfinite(args.duration_seconds) or args.duration_seconds < 0:
        parser.error('--duration-seconds must be finite and non-negative')
    for option in ('recovery_interval_seconds', 'offline_seconds'):
        value = getattr(args, option)
        if value is not None and (not math.isfinite(value) or value <= 0):
            parser.error(f'--{option.replace("_", "-")} must be finite and positive')
    if args.require_websocket and not args.duration_seconds:
        parser.error('--require-websocket requires --duration-seconds')
    if args.provider != 'all' and not args.duration_seconds:
        parser.error('--provider requires --duration-seconds')
    output_dir = args.output_dir
    if output_dir is None and args.duration_seconds:
        output_dir = ROOT / 'audit-evidence' / f'provider-soak-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{os.getpid()}'
    evidence = EvidenceWriter(output_dir, args.duration_seconds)
    global PORT, URL
    PORT = choose_port()
    URL = f"http://{HOST}:{PORT}/tests/fixtures/provider-smoke.html"
    server_log = tempfile.TemporaryFile(mode="w+")
    server = subprocess.Popen(
        [
            "node",
            str(ROOT / "node_modules/vite/bin/vite.js"),
            "--host",
            HOST,
            "--port",
            str(PORT),
            "--strictPort",
            "--config",
            "tests/vite-provider.config.ts",
        ],
        cwd=ROOT,
        stdout=server_log,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        wait_for_server(server)
        if args.duration_seconds:
            # A duration gate is one continuous browser/page lease. Repeating
            # short smoke processes would only test cold-start connections and
            # could never prove that a mounted subscription survives the soak.
            started = time.monotonic()
            result = run_smoke(
                1, recovery=args.recovery, duration_seconds=args.duration_seconds, evidence=evidence,
                recovery_interval_seconds=args.recovery_interval_seconds or min(300, args.duration_seconds / 3),
                offline_seconds=args.offline_seconds, require_websocket=args.require_websocket,
                provider_scope=args.provider,
            )
            result["roundsCompleted"] = 1
            result["durationSeconds"] = round(time.monotonic() - started, 3)
        else:
            result = run_smoke(args.rounds, args.recovery)
        required = {'binance', 'binanceFutures', 'hyperliquid'} if args.provider == 'all' else {args.provider}
        missing = required.difference(result)
        if missing:
            raise AssertionError(f'provider smoke omitted routes: {sorted(missing)}')
        expected_rounds = args.rounds if not args.duration_seconds else int(result.get("roundsCompleted", 0))
        if result.get('roundsCompleted') != expected_rounds:
            raise AssertionError(f"provider smoke completed {result.get('roundsCompleted')} rounds, expected {args.rounds}")
        evidence.finish('passed', result=result)
        print(json.dumps(result, sort_keys=True), flush=True)
        return 0
    except Exception as error:
        evidence.finish('failed', error=str(error))
        server_log.flush()
        server_log.seek(0)
        print(server_log.read()[-8000:], file=sys.stderr)
        raise
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)
        server_log.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - smoke runner must report all failures.
        print(f"Provider smoke failed: {error}", file=sys.stderr)
        raise
