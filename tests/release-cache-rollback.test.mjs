import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Deployment contract smoke: the HTML entrypoint must always revalidate,
 * while content-addressed assets may remain immutable in a browser/CDN cache.
 * The tiny slot server intentionally models a blue/green switch and rollback
 * without depending on a particular hosting vendor.
 */
test('release slot rollback survives immutable asset cache', async () => {
  const roots = {};
  for (const [slot, marker] of [['candidate', 'c1'], ['previous', 'p1']]) {
    const root = await mkdtemp(join(tmpdir(), `quant-cache-${slot}-`));
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'index.html'), `<!doctype html><script type="module" src="/assets/app-${marker}.js"></script>\n`);
    await writeFile(join(root, 'assets', `app-${marker}.js`), `globalThis.__release=${JSON.stringify(marker)};\n`);
    roots[slot] = { root, marker };
  }

  let active = roots.candidate;
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const path = join(active.root, relative);
    try {
      const body = await (await import('node:fs/promises')).readFile(path);
      const isEntry = pathname === '/';
      response.writeHead(200, {
        'cache-control': isEntry ? 'no-store, max-age=0, must-revalidate' : 'public, max-age=31536000, immutable',
        'content-type': isEntry ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
        'x-release-slot': active.marker,
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const get = (path) => new Promise((resolve, reject) => {
    import('node:http').then(({ get: request }) => request({ host: '127.0.0.1', port, path }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ body, headers: response.headers, status: response.statusCode }));
    }).on('error', reject)).catch(reject);
  });

  try {
    const browserCache = new Map();
    const fetchWithBrowserCache = async (path) => {
      if (browserCache.has(path)) return { ...browserCache.get(path), fromCache: true };
      const result = await get(path);
      if (result.headers['cache-control']?.includes('immutable')) browserCache.set(path, result);
      return { ...result, fromCache: false };
    };

    const firstEntry = await get('/');
    assert.equal(firstEntry.status, 200);
    assert.match(firstEntry.headers['cache-control'], /no-store/);
    assert.equal(firstEntry.headers['x-release-slot'], 'c1');
    const firstAsset = await fetchWithBrowserCache('/assets/app-c1.js');
    assert.equal(firstAsset.fromCache, false);
    assert.match(firstAsset.body, /__release="c1"/);

    // Roll back the active slot. A fresh HTML request must select the prior
    // release, while the browser may still retain the old hashed asset.
    active = roots.previous;
    const rollbackEntry = await get('/');
    assert.equal(rollbackEntry.headers['cache-control'].includes('no-store'), true);
    assert.equal(rollbackEntry.headers['x-release-slot'], 'p1');
    assert.match(rollbackEntry.body, /app-p1\.js/);
    const oldAsset = await fetchWithBrowserCache('/assets/app-c1.js');
    assert.equal(oldAsset.fromCache, true);
    assert.match(oldAsset.body, /__release="c1"/);
    const rollbackAsset = await fetchWithBrowserCache('/assets/app-p1.js');
    assert.equal(rollbackAsset.fromCache, false);
    assert.match(rollbackAsset.body, /__release="p1"/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
