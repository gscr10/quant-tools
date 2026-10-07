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
  return new Promise(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
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
        // Allow the local response to be processed under the parallel suite's
        // load. A later timed-out attempt must not erase this observed status.
        '--timeout-ms', '15000', '--interval-ms', '10',
      ], { cwd: process.cwd() }),
      error => error?.code === 1 && /last observed response: HTTP 503/.test(String(error?.stderr)),
    );
  } finally {
    await close(server);
  }
});

test('wait-for-http preserves an observed 503 when the next response hangs until timeout', async () => {
  let calls = 0;
  const server = createServer((_request, response) => {
    calls += 1;
    if (calls === 1) response.writeHead(503).end();
    // Every subsequent request remains open without sending headers. This
    // explicitly forces the transport-timeout path after an observed 503;
    // it does not depend on a coincidental request/deadline race.
  });
  const port = await listen(server);
  try {
    await assert.rejects(run(process.execPath, [
      'scripts/wait-for-http.mjs', '--url', `http://127.0.0.1:${port}/`,
      '--timeout-ms', '3000', '--interval-ms', '5',
    ], { cwd: process.cwd() }), error => {
      assert.equal(error.code, 1);
      assert.ok(calls >= 2, 'the hanging request must follow a completed 503 response');
      assert.match(error.stderr, /last observed response: HTTP 503/);
      assert.match(error.stderr, /last failure: request timeout/);
      return true;
    });
  } finally {
    await close(server);
  }
});

test('wait-for-http does not invent an HTTP response when every connection hangs', async () => {
  let calls = 0;
  const server = createServer(() => { calls += 1; });
  const port = await listen(server);
  try {
    await assert.rejects(run(process.execPath, [
      'scripts/wait-for-http.mjs', '--url', `http://127.0.0.1:${port}/`,
      '--timeout-ms', '3000', '--interval-ms', '5',
    ], { cwd: process.cwd() }), error => {
      assert.equal(error.code, 1);
      assert.ok(calls >= 1);
      assert.match(error.stderr, /last observed response: none/);
      assert.match(error.stderr, /last failure: request timeout/);
      return true;
    });
  } finally {
    await close(server);
  }
});
