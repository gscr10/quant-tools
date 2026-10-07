import test from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const bootstrap = `
import asyncio, runpy, sys, types, unittest.mock as mock
api = types.ModuleType('playwright.async_api')
api.async_playwright = lambda: None
sys.modules['playwright'] = types.ModuleType('playwright')
sys.modules['playwright.async_api'] = api
module = runpy.run_path('tests/startup_loading.py')
`;

test('real startup samples do not install routing or accumulate context init scripts', () => {
  execFileSync('python3', ['-c', bootstrap + `
from pathlib import Path
args = types.SimpleNamespace(real_provider=True, preview=True, hot=True,
    browser='firefox', symbol='binance:BTCUSDT', bars=2000, storage_fault='none',
    output=Path('/unused'), label='contract')
context = mock.Mock()
context.add_init_script = mock.AsyncMock()
context.route = mock.AsyncMock()
context.close = mock.AsyncMock()
page = mock.Mock()
for name in ['goto', 'wait_for_selector', 'wait_for_function', 'wait_for_timeout', 'screenshot', 'close']:
    setattr(page, name, mock.AsyncMock())
page.keyboard.press = mock.AsyncMock()
page.locator.return_value.click = mock.AsyncMock()
page.evaluate = mock.AsyncMock(side_effect=lambda script: 7 if script == 'performance.now()' else {
    'resources': [{'name': 'http://localhost/assets/app-abc.js', 'transfer': 0, 'encoded': 20}],
    'canvasCount': 1, 'candlePaint': 10})
context.new_page = mock.AsyncMock(return_value=page)
browser = mock.Mock()
browser.new_context = mock.AsyncMock(return_value=context)
async def check():
    shared = await module['create_context'](browser, args)
    first = await module['sample'](browser, args, 'http://localhost', 0, shared)
    second = await module['sample'](browser, args, 'http://localhost', 1, shared)
    assert first['cachePhase'] == 'prime' and second['cachePhase'] == 'warm'
    assert not first['requestRouting'] and not second['requestRouting']
    assert second['cacheEvidence']['verified']
    page.evaluate = mock.AsyncMock(side_effect=lambda script: 7 if script == 'performance.now()' else {
        'resources': [{'name': 'http://localhost/assets/app-abc.js', 'transfer': 300, 'encoded': 20}],
        'canvasCount': 1, 'candlePaint': 10})
    uncached = await module['sample'](browser, args, 'http://localhost', 2, shared)
    assert 'did not prove' in uncached['failure']
    context.route.assert_not_called()
    context.add_init_script.assert_awaited_once()
    script = context.add_init_script.call_args.args[0]
    assert script.index('window.__STARTUP_REAL_PROVIDER__=true') < script.index('const a = window.__startup')
    context.close.assert_not_called()
    assert page.close.await_count == 3
    assert not page.wait_for_function.call_args_list[0].args[0].startswith('window.__startup.events')
asyncio.run(check())
`], { stdio: 'pipe' });
});

test('startup cache evidence requires a cached same-origin production JS or CSS resource', () => {
  execFileSync('python3', ['-c', bootstrap + `
cache = module['cache_evidence']
base = 'http://localhost:1234'
def resource(path, transfer=0, encoded=100):
    return {'name': base+path, 'transfer': transfer, 'encoded': encoded}
for rows in [[], [resource('/assets/main-a.js', transfer=400)],
             [resource('/assets/main-a.js', encoded=0)], [resource('/logo.svg')],
             [{'name':'https://exchange.example/assets/main-a.js','transfer':0,'encoded':100}]]:
    assert not cache(rows, {}, base)['verified'], rows
assert cache([resource('/assets/main-a.js')], {}, base)['verified']
assert cache([], {'1': {'url': base+'/assets/main-a.js','servedFromCache': True}}, base)['verified']
assert not cache([], {'1': {'servedFromCache': True}}, base)['verified']
assert not cache([], {'1': {'url':base+'/assets/main-a.js','fromServiceWorker': True}}, base)['verified']
`], { stdio: 'pipe' });
});

test('startup CLI rejects pretend hot modes before opening a server', () => {
  execFileSync('python3', ['-c', bootstrap + `
main=module['main']
for arguments in [['--hot'], ['--hot','--real-provider','--samples=2'],
                  ['--hot','--real-provider','--preview','--samples=1'], ['--samples=0'],
                  ['--complete-report'], ['--complete-report','--real-provider','--preview'],
                  ['--complete-report','--real-provider','--preview','--symbol=binance:BTCUSDT','--bars=500']]:
    with mock.patch.object(sys,'argv',['startup_loading.py',*arguments]), \\
         mock.patch.object(main.__globals__['subprocess'],'Popen') as spawn:
        try:
            main()
            raise AssertionError('invalid hot mode was accepted')
        except SystemExit as error:
            assert error.code == 2
        spawn.assert_not_called()
`], { stdio: 'pipe' });
});

test('full startup milestone requires completed continuous history, ledger and matching report identity', () => {
  const script = execFileSync('python3', ['-c', bootstrap + "print(module['REPORT_OBSERVE'])"], { encoding: 'utf8' });
  const calls = [];
  class Worker {
    addEventListener(kind, listener) { this.listener = listener; }
    postMessage(message) { calls.push(message); }
    receive(message) { this.listener({ data: message }); }
  }
  const window = { __startup: {}, __STARTUP_EXPECTED_BARS__: 3 };
  let clock = 0;
  vm.runInNewContext(script, { window, Worker, performance: { now: () => ++clock } });
  const worker = new Worker();
  const bars = [0, 900000, 1800000].map(time => ({ time }));
  const execute = { kind: 'execute', sessionId: 1, historyState: 'backfill', bars, market: { timeframe: '15' } };
  worker.postMessage(execute);
  assert.equal(calls[0], execute, 'transport receives the original payload without substitution');
  worker.postMessage({ kind: 'getContext', sessionId: 1, reqId: 4 });
  const snapshot = {
    barIndex: 2,
    strategy: { reportRunId: 'run', reportSnapshotRevision: 2, wins: 1, losses: 0, even: 0 },
    trades: [{ open: false }, { open: true }],
    reportSeries: { runId: 'run', snapshotRevision: 2, points: bars },
  };
  const reply = () => worker.receive({ kind: 'contextResult', reqId: 4, snapshot });
  reply();
  assert.equal(window.__startup.report.engineReady, null, 'partial history cannot satisfy complete readiness');
  worker.postMessage({ kind: 'bars', sessionId: 1, restart: true, bars: [bars[0], bars[2], { time: 2700000 }] });
  reply();
  assert.equal(window.__startup.report.historyComplete, null, 'bar count alone does not prove gap-free history');
  worker.postMessage({ kind: 'bars', sessionId: 1, restart: true, bars });
  snapshot.reportSeries.snapshotRevision = 1;
  reply();
  assert.equal(window.__startup.report.engineReady, null, 'mixed revisions are not a complete report');
  snapshot.reportSeries.snapshotRevision = 2;
  snapshot.trades = [{ open: true }];
  reply();
  assert.equal(window.__startup.report.engineReady, null, 'missing closed ledger is rejected');
  snapshot.trades = [{ open: false }, { open: true }];
  snapshot.reportSeries.points = bars.map(b => ({ time: b.time + 900000 }));
  reply();
  assert.equal(window.__startup.report.engineReady, null, 'same count but another history window is rejected');
  snapshot.reportSeries.points = bars;
  reply();
  assert.equal(window.__startup.report.engineReady.identityConsistent, true);
  assert.equal(window.__startup.report.engineReady.closedTrades, 1);
  assert.equal(window.__startup.report.engineReady.openTrades, 1);
});
