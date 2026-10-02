import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const KEY = 'quant-tools:backtest-dock:v1';

class MemoryStorage {
  #values;

  constructor(values = {}) {
    this.#values = new Map(Object.entries(values));
  }

  getItem(key) {
    return this.#values.get(key) ?? null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }
}

async function repositoryModule(name, values = {}) {
  globalThis.localStorage = new MemoryStorage(values);
  return import(`../src/integrations/storage/backtest-preferences-repository.ts?test=${name}`);
}

test('backtest Dock preferences restore only the versioned UI shape', async () => {
  const repository = await repositoryModule('valid', {
    [KEY]: JSON.stringify({ version: 1, height: 344, collapsed: true }),
  });

  assert.deepEqual(repository.loadBacktestDockPreferences(), {
    version: 1,
    height: 344,
    collapsed: true,
  });

  repository.saveBacktestDockPreferences({ version: 1, height: 216, collapsed: false });
  assert.deepEqual(repository.loadBacktestDockPreferences(), {
    version: 1,
    height: 216,
    collapsed: false,
  });
});

test('malformed, old-version, and non-finite Dock preferences fall back to null', async () => {
  const repository = await repositoryModule('invalid', {
    [KEY]: JSON.stringify({ version: 2, height: 344, collapsed: true }),
  });
  assert.equal(repository.loadBacktestDockPreferences(), null);

  for (const value of [
    null,
    { version: 1, height: 0, collapsed: false },
    { version: 1, height: '280', collapsed: false },
    { version: 1, height: Number.NaN, collapsed: false },
    { version: 1, height: 280, collapsed: 'false' },
  ]) {
    globalThis.localStorage = new MemoryStorage({ [KEY]: JSON.stringify(value) });
    assert.equal(repository.loadBacktestDockPreferences(), null);
  }
});

test('invalid saves are ignored and do not write report-like payloads', async () => {
  const repository = await repositoryModule('save-validation');
  repository.saveBacktestDockPreferences({ version: 1, height: 280, collapsed: false });
  repository.saveBacktestDockPreferences({ version: 2, height: 999, collapsed: true });
  assert.deepEqual(repository.loadBacktestDockPreferences(), {
    version: 1,
    height: 280,
    collapsed: false,
  });

  const source = await readFile(
    new URL('../src/integrations/storage/backtest-preferences-repository.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /trades|equity|report|strategy/i);
});

test('Workbench persists Dock state only through the explicit preference seam', async () => {
  const source = await readFile(
    new URL('../src/features/backtesting/backtest-workbench.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /onDockPreferencesChange/);
  assert.match(source, /dockPreferences\?\.height/);
  assert.match(source, /dockPreferences\?\.collapsed/);
  assert.match(source, /persistDockPreferences\(\)/);
  assert.match(source, /private persistDockPreferences\(\): void \{\s*if \(this\.destroyed\) return;/s);
  // Restore/clamping and lifecycle layout notifications must not write state.
  assert.match(source, /private clampDockToViewport\(\): void \{\s*this\.setDockHeight\(this\.dockHeight\);/s);
  assert.doesNotMatch(source, /onResize\?\.\(0\)[\s\S]{0,120}onDockPreferencesChange/);
});
