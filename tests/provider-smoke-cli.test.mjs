import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const bootstrap = `
import runpy, sys, types, unittest.mock as mock
api = types.ModuleType('playwright.sync_api')
api.sync_playwright = lambda: None
sys.modules['playwright'] = types.ModuleType('playwright')
sys.modules['playwright.sync_api'] = api
module = runpy.run_path('tests/provider_smoke.py')
main = module['main']
scope = main.__globals__
`;

test('provider CLI rejects non-finite duration before starting a server', () => {
  execFileSync('python3', ['-c', bootstrap + `
for value in ['nan', 'inf', '-inf', '-1']:
    with mock.patch.object(sys, 'argv', ['provider_smoke.py', '--duration-seconds=' + value]), \
         mock.patch.object(scope['subprocess'], 'Popen') as spawn:
        try:
            main()
            raise AssertionError('invalid duration accepted: ' + value)
        except SystemExit as error:
            assert error.code == 2
        spawn.assert_not_called()
`], { stdio: 'pipe' });
});

test('duration plus recovery CLI forwards both options and cleans up server', () => {
  const output = execFileSync('python3', ['-c', bootstrap + `
server = mock.Mock()
runner = mock.Mock(return_value={'binance': {}, 'binanceFutures': {}, 'hyperliquid': {}})
evidence = mock.Mock()
scope.update(choose_port=lambda: 12345, wait_for_server=lambda _: None, run_smoke=runner,
             EvidenceWriter=mock.Mock(return_value=evidence))
with mock.patch.object(sys, 'argv', ['provider_smoke.py', '--duration-seconds=120', '--recovery']), \
     mock.patch.object(scope['subprocess'], 'Popen', return_value=server):
    assert main() == 0
runner.assert_called_once_with(1, recovery=True, duration_seconds=120.0, evidence=evidence,
                             recovery_interval_seconds=40.0, offline_seconds=3,
                             require_websocket=False, provider_scope='all')
evidence.finish.assert_called_once()
server.terminate.assert_called_once()
server.wait.assert_called_once_with(timeout=5)
`], { encoding: 'utf8' });
  assert.equal(JSON.parse(output).roundsCompleted, 1);
});

test('provider CLI validates recovery timing and WebSocket scope before starting a server', () => {
  execFileSync('python3', ['-c', bootstrap + `
invalid = [['--offline-seconds=0'], ['--offline-seconds=nan'],
           ['--recovery-interval-seconds=-1'], ['--recovery-interval-seconds=inf'],
           ['--require-websocket'], ['--provider=hyperliquid']]
for arguments in invalid:
    with mock.patch.object(sys, 'argv', ['provider_smoke.py', *arguments]), \\
         mock.patch.object(scope['subprocess'], 'Popen') as spawn:
        try:
            main()
            raise AssertionError('invalid configuration accepted')
        except SystemExit as error:
            assert error.code == 2
        spawn.assert_not_called()
`], { stdio: 'pipe' });
});

test('provider evidence survives failure with requested duration and fresh progress', () => {
  execFileSync('python3', ['-c', bootstrap + `
import tempfile, json
from pathlib import Path
with tempfile.TemporaryDirectory() as directory:
    evidence = module['EvidenceWriter'](Path(directory), 7200)
    evidence.progress({'state': {'status': 'running', 'elapsedMs': 16000,
                                'subscriptions': {'binance': {'liveCallbacks': 6}},
                                'recoveryCycles': []}})
    evidence.finish('failed', error='network unavailable')
    initial = json.loads((Path(directory) / 'run.json').read_text())
    progress = json.loads((Path(directory) / 'progress.json').read_text())
    terminal = json.loads((Path(directory) / 'result.json').read_text())
    assert initial['requestedDurationSeconds'] == 7200
    assert initial['sourceSha256']['tests/provider_smoke.py']
    assert progress['state']['elapsedMs'] == 16000
    assert terminal['status'] == 'failed'
    assert terminal['error'] == 'network unavailable'
    assert len((Path(directory) / 'progress.jsonl').read_text().splitlines()) == 1
    manifest = json.loads((Path(directory) / 'SHA256.json').read_text())
    assert manifest['files']['result.json']
    try:
        module['EvidenceWriter'](Path(directory), 7200)
        raise AssertionError('existing evidence was overwritten')
    except ValueError:
        pass
`], { stdio: 'pipe' });
});

test('duration runner rejects a short result advertised as a completed two-hour run', () => {
  execFileSync('python3', ['-c', bootstrap + `
page = mock.Mock()
state = {'status': 'passed', 'result': {'observedDurationMs': 5000},
         'elapsedMs': 5000, 'subscriptions': {}, 'recoveryCycles': []}
page.evaluate.return_value = state
session = mock.Mock()
session.send.return_value = {'metrics': []}
evidence = mock.Mock()
network = mock.Mock()
network.snapshot.return_value = {}
try:
    module['run_duration_soak'](page, 7200, False, evidence, 300, 3,
                                False, [], session, network)
    raise AssertionError('short result accepted')
except AssertionError as error:
    assert 'before the requested duration' in str(error)
assert any(call.args == ('window.stopProviderSoak()',) for call in page.evaluate.call_args_list)
evidence.write.assert_called()
`], { stdio: 'pipe' });
});

test('network evidence counts candle frames separately from connection and ping frames', () => {
  execFileSync('python3', ['-c', bootstrap + `
network = module['NetworkEvidence'](mock.Mock())
network.created({'requestId': 'first', 'url': 'wss://stream.binance.com/ws/btcusdt@kline_15m'})
network.received({'requestId': 'first', 'response': {'payloadData': '{"pong": true}'}})
assert network.snapshot()['binance']['candleFrames'] == 0
network.received({'requestId': 'first', 'response': {'payloadData': '{"k": {"c": "10"}}'}})
network.failed({'requestId': 'first'})
network.closed({'requestId': 'first'})
network.closed({'requestId': 'first'})
state = network.snapshot()['binance']
assert state == {'created': 1, 'closed': 1, 'active': 0, 'maxActive': 1,
                 'framesReceived': 2, 'candleFrames': 1, 'lastCandleConnection': 1, 'errors': 1}
`], { stdio: 'pipe' });
});
