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
scope.update(choose_port=lambda: 12345, wait_for_server=lambda _: None, run_smoke=runner)
with mock.patch.object(sys, 'argv', ['provider_smoke.py', '--duration-seconds=120', '--recovery']), \
     mock.patch.object(scope['subprocess'], 'Popen', return_value=server):
    assert main() == 0
runner.assert_called_once_with(1, recovery=True, duration_seconds=120.0)
server.terminate.assert_called_once()
server.wait.assert_called_once_with(timeout=5)
`], { encoding: 'utf8' });
  assert.equal(JSON.parse(output).roundsCompleted, 1);
});
