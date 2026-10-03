import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

const run = promisify(execFile);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

test('wait-for-http retries non-ready responses and exits on the expected status', async () => {
  let calls = 0;
  const server = createServer((_request, response) => {
    calls += 1;
    response.writeHead(calls < 3 ? 503 : 200).end();
  });
  const port = await listen(server);
  try {
    const result = await run(process.execPath, [
      'scripts/wait-for-http.mjs', '--url', `http://127.0.0.1:${port}/`,
      '--timeout-ms', '2000', '--interval-ms', '5',
    ], { cwd: process.cwd() });
    assert.match(result.stdout, /"ok":true/);
    assert.ok(calls >= 3);
  } finally {
    await close(server);
  }
});

test('wait-for-http fails with the last observed status instead of sleeping forever', async () => {
  const server = createServer((_request, response) => response.writeHead(503).end());
  const port = await listen(server);
  try {
    await assert.rejects(
      run(process.execPath, [
        'scripts/wait-for-http.mjs', '--url', `http://127.0.0.1:${port}/`,
        // Leave enough time for a fresh Node child to start under the full
        // repository test load; the assertion is about the final HTTP status,
        // not about racing process startup against a 500ms deadline.
        // Starting a fresh Node child can exceed two seconds when the full
        // repository suite is running in parallel. Keep the assertion focused
        // on the final HTTP status rather than process-startup scheduling.
        // The child process can spend several seconds starting while the
        // complete repository suite is running.  Keep the production script's
        // timeout semantics under test, but leave startup scheduling headroom
        // so the assertion observes the server's final HTTP 503.
        '--timeout-ms', '15000', '--interval-ms', '10',
      ], { cwd: process.cwd() }),
      error => error?.code === 1 && /HTTP 503/.test(String(error?.stderr)),
    );
  } finally {
    await close(server);
  }
});
