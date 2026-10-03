import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  canonicalStorageEntry,
  reconcileStorageSnapshots,
} from '../scripts/storage-reconciliation.mjs';

const execFileAsync = promisify(execFile);

test('schema-aware storage reconciliation ignores runtime timestamps but catches user changes', () => {
  const before = {
    local: {
      'vela-pine:scripts:v1': JSON.stringify([
        { name: 'Alpha', script: 'plot(close)', savedAt: 100 },
      ]),
      'quant-tools:workspace:v2': JSON.stringify({
        version: 1,
        revision: 2,
        charts: [{ id: 'c1', symbol: 'BTCUSDT' }],
      }),
    },
    session: {},
  };
  const after = {
    local: {
      'vela-pine:scripts:v1': JSON.stringify([
        { savedAt: 200, script: 'plot(close)', name: 'Alpha' },
      ]),
      'quant-tools:workspace:v2': JSON.stringify({
        charts: [{ symbol: 'BTCUSDT', id: 'c1' }],
        revision: 9,
        version: 1,
      }),
    },
    session: {},
  };
  const equal = reconcileStorageSnapshots(before, after);
  assert.equal(equal.equal, true);
  assert.deepEqual(equal.changed, []);
  assert.ok(equal.volatileFieldsRemoved >= 2);

  const changed = reconcileStorageSnapshots(before, {
    ...after,
    local: {
      ...after.local,
      'vela-pine:scripts:v1': JSON.stringify([
        { name: 'Alpha', script: 'plot(open)', savedAt: 300 },
      ]),
    },
  });
  assert.equal(changed.equal, false);
  assert.deepEqual(changed.changed.map((entry) => entry.key), ['vela-pine:scripts:v1']);
  assert.equal(changed.changed[0].before.rawBytes > 0, true);
  assert.equal(Object.prototype.hasOwnProperty.call(changed.changed[0], 'value'), false);
});

test('storage reconciliation preserves raw and canonical digests without exposing values', () => {
  const entry = canonicalStorageEntry('vela-pine:workspace-templates:v1', JSON.stringify([{
    savedAt: 42,
    name: 'private',
    state: { b: 2, a: 1 },
  }]));
  assert.equal(entry.schema, 'templates');
  assert.equal(entry.parsedJson, true);
  assert.equal(entry.volatileFieldsRemoved, 1);
  assert.notEqual(entry.rawSha256, entry.canonicalSha256);
  assert.equal('name' in entry, false);
});

test('reconciliation does not erase nested user fields that merely share savedAt', () => {
  const before = JSON.stringify([{ name: 'Template', savedAt: 1, state: { savedAt: 10 } }]);
  const after = JSON.stringify([{ name: 'Template', savedAt: 2, state: { savedAt: 11 } }]);
  const report = reconcileStorageSnapshots(
    { local: { 'vela-pine:workspace-templates:v1': before }, session: {} },
    { local: { 'vela-pine:workspace-templates:v1': after }, session: {} },
  );
  assert.equal(report.equal, false);
  assert.deepEqual(report.changed.map((entry) => entry.key), ['vela-pine:workspace-templates:v1']);
});

test('workspace canonicalization only removes runtime fields at document root', () => {
  const before = JSON.stringify({ version: 1, revision: 1, charts: [{ id: 'c1', ext: { revision: 10 } }] });
  const after = JSON.stringify({ version: 1, revision: 2, charts: [{ id: 'c1', ext: { revision: 11 } }] });
  const report = reconcileStorageSnapshots(
    { local: { 'quant-tools:workspace:v2': before }, session: {} },
    { local: { 'quant-tools:workspace:v2': after }, session: {} },
  );
  assert.equal(report.equal, false);
});

test('unknown or non-JSON storage entries block a clean reconciliation', () => {
  const report = reconcileStorageSnapshots(
    { local: { 'vendor:opaque': 'not-json' }, session: {} },
    { local: { 'vendor:opaque': 'not-json' }, session: {} },
  );
  assert.equal(report.equal, false);
  assert.deepEqual(report.issues.map((issue) => issue.reason), ['unknown-key', 'invalid-json', 'unknown-key', 'invalid-json']);
});

test('malformed storage envelopes cannot be mistaken for an unchanged snapshot', () => {
  const cases = [
    [{}, {}],
    [{ local: {} }, { local: {}, session: {} }],
    [{ local: [], session: {} }, { local: {}, session: {} }],
    [{ local: { 'vela-pine:scripts:v1': 42 }, session: {} }, { local: {}, session: {} }],
  ];
  for (const [before, after] of cases) {
    const report = reconcileStorageSnapshots(before, after);
    assert.equal(report.equal, false);
    assert.ok(report.issues.some((issue) => issue.reason.startsWith('invalid-') || issue.reason === 'missing-storage'));
  }
});

async function runNode(script, args, cwd) {
  return execFileAsync(process.execPath, [script, ...args], { cwd });
}

test('release manifest help is explicit and does not emit a JSON artifact', async () => {
  const script = new URL('../scripts/release-manifest.mjs', import.meta.url);
  const { stdout } = await runNode(script.pathname, ['--help'], process.cwd());
  assert.match(stdout, /Usage: npm run release:manifest/);
  assert.doesNotMatch(stdout, /"schemaVersion"/);
});

test('release manifest and verifier reject dist symbolic links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quant-release-symlink-'));
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n');
  await writeFile(join(root, 'outside.js'), 'globalThis.__outside=true;\n');
  await symlink('../outside.js', join(root, 'dist', 'app.js'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });

  const manifestScript = new URL('../scripts/release-manifest.mjs', import.meta.url);
  await assert.rejects(
    runNode(manifestScript.pathname, ['--root', root, '--require-clean', '--require-dist'], root),
    (error) => error?.code === 1 && /symbolic link/.test(String(error?.stderr ?? error?.message)),
  );

  // A verifier must independently reject a symlink even if an older or
  // externally produced manifest omitted it from the expected file set.
  const manifestPath = `${root}.manifest.json`;
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    manifestKind: 'release',
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    branch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
    gitStatus: [],
    node: process.version,
    npm: null,
    packageLock: null,
    dist: { present: true, root: 'dist', files: [], bytes: 0 },
  }));
  const verifierScript = new URL('../scripts/verify-release-manifest.mjs', import.meta.url);
  const verified = await runNode(verifierScript.pathname, ['--root', root, '--manifest', manifestPath, '--require-clean', '--json'], root).catch((error) => error);
  assert.equal(verified.code, 1);
  assert.match(String(verified.stdout ?? verified.stderr ?? verified.message), /symbolic link|dist file set differs/i);
});

test('release manifest rejects a symbolic-link dist root and package lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quant-release-root-symlink-'));
  const outside = await mkdtemp(join(tmpdir(), 'quant-release-root-outside-'));
  await mkdir(join(outside, 'dist'), { recursive: true });
  await writeFile(join(outside, 'dist', 'index.html'), '<!doctype html>\n');
  await symlink(join(outside, 'dist'), join(root, 'dist'));
  await symlink(join(outside, 'missing-package-lock.json'), join(root, 'package-lock.json'));

  const script = new URL('../scripts/release-manifest.mjs', import.meta.url);
  await assert.rejects(
    runNode(script.pathname, ['--root', root, '--require-dist'], root),
    error => error?.code === 1 && /dist|symbolic link/.test(String(error?.stderr ?? error?.message)),
  );

  // The dist root is a separate boundary; after replacing it with a regular
  // directory, the package-lock symlink must still fail rather than being
  // silently treated as an absent optional lockfile.
  await (await import('node:fs/promises')).rm(join(root, 'dist'), { recursive: true, force: true });
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist', 'index.html'), '<!doctype html>\n');
  await assert.rejects(
    runNode(script.pathname, ['--root', root, '--require-dist'], root),
    error => error?.code === 1 && /symbolic link|package-lock/.test(String(error?.stderr ?? error?.message)),
  );
});

test('verifier rejects a non-release manifest even when file digests match', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quant-release-kind-'));
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n');
  await writeFile(join(root, 'dist', 'index.html'), '<!doctype html>\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });

  const manifestScript = new URL('../scripts/release-manifest.mjs', import.meta.url);
  const { stdout } = await runNode(manifestScript.pathname, ['--root', root, '--require-clean', '--require-dist'], root);
  const manifest = JSON.parse(stdout);
  manifest.manifestKind = 'diagnostic';
  const manifestPath = `${root}.manifest.json`;
  await writeFile(manifestPath, JSON.stringify(manifest));
  const verifierScript = new URL('../scripts/verify-release-manifest.mjs', import.meta.url);
  const result = await runNode(verifierScript.pathname, ['--root', root, '--manifest', manifestPath, '--require-clean', '--json'], root).catch((error) => error);
  assert.equal(result.code, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((check) => check.check === 'manifestKind').ok, false);
});

function httpGet(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = import('node:http').then(({ get }) => get(
      { host: '127.0.0.1', port, path: pathname, headers: { 'cache-control': 'no-cache' } },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body }));
      },
    ));
    request.catch(reject);
  });
}

function httpGetMeta(port, pathname) {
  return new Promise((resolve, reject) => {
    import('node:http').then(({ get }) => get(
      { host: '127.0.0.1', port, path: pathname, headers: { 'cache-control': 'no-cache' } },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({
          status: response.statusCode,
          body,
          headers: response.headers,
        }));
      },
    )).catch(reject);
  });
}

test('release cache contract keeps the entrypoint revalidatable and hashed assets immutable', async () => {
  let active = 'candidate';
  const builds = {
    candidate: {
      index: '<script src="/assets/app-candidate.js"></script>\n',
      asset: 'candidate\n',
    },
    previous: {
      index: '<script src="/assets/app-previous.js"></script>\n',
      asset: 'previous\n',
    },
  };
  const server = createServer((request, response) => {
    const build = builds[active];
    if (request.url === '/index.html') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache, no-store, must-revalidate',
      });
      response.end(build.index);
      return;
    }
    const assetName = request.url?.match(/^\/assets\/(app-(?:candidate|previous)\.js)$/)?.[1];
    if (assetName) {
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'public, max-age=31536000, immutable',
      });
      response.end(assetName.includes(active) ? build.asset : builds[assetName.includes('candidate') ? 'candidate' : 'previous'].asset);
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  try {
    const index = await httpGetMeta(port, '/index.html');
    assert.equal(index.status, 200);
    assert.match(index.headers['cache-control'], /no-cache/);
    assert.match(index.body, /app-candidate\.js/);

    const candidate = await httpGetMeta(port, '/assets/app-candidate.js');
    assert.equal(candidate.status, 200);
    assert.match(candidate.headers['cache-control'], /immutable/);

    active = 'previous';
    const rolledBack = await httpGetMeta(port, '/index.html');
    assert.match(rolledBack.body, /app-previous\.js/);
    const oldAsset = await httpGetMeta(port, '/assets/app-candidate.js');
    assert.equal(oldAsset.status, 200);
    assert.equal(oldAsset.body, 'candidate\n');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('release manifest can target an older checkout and verifier rejects tampered dist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quant-release-manifest-'));
  await mkdir(join(root, 'dist', 'assets'), { recursive: true });
  await writeFile(join(root, 'package-lock.json'), '{"name":"fixture","lockfileVersion":3}\n');
  await writeFile(join(root, 'dist', 'index.html'), '<!doctype html>\n');
  await writeFile(join(root, 'dist', 'assets', 'app.js'), 'console.log("ok");\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });

  const script = new URL('../scripts/release-manifest.mjs', import.meta.url);
  const { stdout } = await runNode(script.pathname, ['--root', root, '--require-clean', '--require-dist'], root);
  // Keep the artifact outside the checkout: writing it inside would make a
  // clean release checkout dirty and invalidate the very manifest being
  // verified.
  const manifestPath = `${root}.manifest.json`;
  await writeFile(manifestPath, stdout);
  const verifier = new URL('../scripts/verify-release-manifest.mjs', import.meta.url);
  const verified = await runNode(verifier.pathname, ['--root', root, '--manifest', manifestPath, '--require-clean'], root);
  const report = JSON.parse(verified.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.checks.find((check) => check.check === 'dist-file-set').ok, true);

  await writeFile(join(root, 'dist', 'assets', 'app.js'), 'tampered\n');
  await assert.rejects(
    runNode(verifier.pathname, ['--root', root, '--manifest', manifestPath, '--require-clean'], root),
    (error) => error?.code === 1,
  );
  const tampered = await readFile(join(root, 'dist', 'assets', 'app.js'), 'utf8');
  assert.equal(tampered, 'tampered\n');
});

test('candidate and previous manifests support a same-slot rollback with storage recovery', async () => {
  const manifestScript = new URL('../scripts/release-manifest.mjs', import.meta.url);
  const verifierScript = new URL('../scripts/verify-release-manifest.mjs', import.meta.url);

  async function createReleaseRoot(label, marker) {
    const root = await mkdtemp(join(tmpdir(), `quant-release-${label}-`));
    await mkdir(join(root, 'dist', 'assets'), { recursive: true });
    await writeFile(join(root, 'package-lock.json'), `{"name":"fixture-${label}","lockfileVersion":3}\n`);
    await writeFile(join(root, 'dist', 'index.html'), `<!doctype html><meta name="build" content="${marker}">\n`);
    await writeFile(join(root, 'dist', 'assets', 'app.js'), `globalThis.__build=${JSON.stringify(marker)};\n`);
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', marker], { cwd: root });

    const { stdout: manifestText } = await runNode(
      manifestScript.pathname,
      ['--root', root, '--require-clean', '--require-dist'],
      root,
    );
    const manifestPath = `${root}.manifest.json`;
    await writeFile(manifestPath, manifestText);
    const { stdout: verifyText } = await runNode(
      verifierScript.pathname,
      ['--root', root, '--manifest', manifestPath, '--require-clean', '--json'],
      root,
    );
    const verification = JSON.parse(verifyText);
    assert.equal(verification.ok, true, `${label} manifest should verify`);
    return { root, marker };
  }

  const candidate = await createReleaseRoot('candidate', 'candidate-build');
  const previous = await createReleaseRoot('previous', 'previous-build');
  let active = candidate;
  const server = createServer(async (request, response) => {
    if (request.url !== '/assets/app.js') {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    const body = await readFile(join(active.root, 'dist', 'assets', 'app.js'));
    response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    response.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  try {
    assert.deepEqual(await httpGet(port, '/assets/app.js'), {
      status: 200,
      body: 'globalThis.__build="candidate-build";\n',
    });
    active = previous;
    assert.deepEqual(await httpGet(port, '/assets/app.js'), {
      status: 200,
      body: 'globalThis.__build="previous-build";\n',
    });
    active = candidate;
    assert.deepEqual(await httpGet(port, '/assets/app.js'), {
      status: 200,
      body: 'globalThis.__build="candidate-build";\n',
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const before = {
    local: {
      'quant-tools:workspace:v2': JSON.stringify({
        version: 1,
        revision: 4,
        charts: [{ id: 'main', symbol: 'binance:BTCUSDT', bars: 2000 }],
        panels: { backtest: true },
      }),
      'vela-pine:scripts:v1': JSON.stringify([{ name: 'SMA', script: 'plot(close)', savedAt: 1 }]),
    },
    session: {},
  };
  const after = {
    local: {
      'quant-tools:workspace:v2': JSON.stringify({
        version: 1,
        revision: 99,
        charts: [{ id: 'main', symbol: 'binance:BTCUSDT', bars: 2000 }],
        panels: { backtest: true },
      }),
      'vela-pine:scripts:v1': JSON.stringify([{ name: 'SMA', script: 'plot(close)', savedAt: 100 }]),
    },
    session: {},
  };
  const storage = reconcileStorageSnapshots(before, after);
  assert.equal(storage.equal, true);
  assert.deepEqual(storage.changed, []);
  assert.deepEqual(storage.issues, []);
});
