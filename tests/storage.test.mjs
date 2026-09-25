import test from 'node:test';
import assert from 'node:assert/strict';

const SCRIPTS_KEY = 'vela-pine:scripts:v1';
const EDITOR_KEY = 'vela-pine:editor:v1';
const LAYOUT_KEY = 'vela-pine:layout:v1';
const INDICATOR_FAVORITES_KEY = 'vela-pine:indicator-favorites:v1';
const WORKSPACE_TEMPLATES_KEY = 'vela-pine:workspace-templates:v1';

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

async function storageModule(name, values = {}) {
  globalThis.localStorage = new MemoryStorage(values);
  return import(`../src/storage.ts?test=${name}`);
}

test('ignores malformed and duplicate saved-script entries', async () => {
  const storage = await storageModule('malformed-scripts', {
    [SCRIPTS_KEY]: JSON.stringify([
      { name: ' Alpha ', script: 'first', savedAt: 12, favorite: true },
      { name: 'Alpha', script: 'duplicate', savedAt: 13 },
      { name: '', script: 'missing-name', savedAt: 14 },
      { name: 'missing-script', savedAt: 15 },
      null,
    ]),
  });

  assert.deepEqual(storage.listScripts(), [
    { name: 'Alpha', script: 'first', savedAt: 12, favorite: true },
  ]);
});

test('treats corrupt JSON as empty storage', async () => {
  const storage = await storageModule('corrupt-json', {
    [SCRIPTS_KEY]: '{not-json',
    [EDITOR_KEY]: '[also-not-an-editor]',
    [LAYOUT_KEY]: 'null',
  });

  assert.deepEqual(storage.listScripts(), []);
  assert.equal(storage.loadEditorSnapshot(), null);
  assert.deepEqual(storage.loadLayout(), []);
});

test('rename stores current editor content and keeps favorite state', async () => {
  const storage = await storageModule('rename');
  storage.saveScript('Old', 'saved content');
  storage.toggleFavorite('Old');
  storage.renameScript('Old', 'New', 'unsaved editor content');

  const scripts = storage.listScripts();
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].name, 'New');
  assert.equal(scripts[0].script, 'unsaved editor content');
  assert.equal(scripts[0].favorite, true);
  assert.ok(scripts[0].savedAt > 0);
});

test('keeps an in-memory copy when localStorage writes fail', async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded'); },
  };
  const storage = await import('../src/storage.ts?test=storage-fallback');
  storage.saveScript('Draft', 'plot(close)');

  assert.equal(storage.listScripts()[0].script, 'plot(close)');
});

test('validates restored editor and layout data', async () => {
  const storage = await storageModule('restore-validation', {
    [EDITOR_KEY]: JSON.stringify({ script: 'plot(close)', name: 'Recovered' }),
    [LAYOUT_KEY]: JSON.stringify([
      { source: 'plot(close)' },
      { source: 'plot(open)', visible: false, savedName: 'Saved' },
      { source: 42, visible: true },
      null,
    ]),
  });

  assert.deepEqual(storage.loadEditorSnapshot(), { script: 'plot(close)', name: 'Recovered' });
  assert.deepEqual(storage.loadLayout(), [
    { source: 'plot(close)', visible: true, savedName: null },
    { source: 'plot(open)', visible: false, savedName: 'Saved' },
  ]);
});

test('stores native and script indicator favorites without duplicates', async () => {
  const storage = await storageModule('indicator-favorites', {
    [INDICATOR_FAVORITES_KEY]: JSON.stringify([
      { key: 'native:rsi', kind: 'native', name: 'RSI', nativeType: 'rsi', savedAt: 1 },
      { key: 'native:rsi', kind: 'native', name: 'duplicate', nativeType: 'rsi', savedAt: 2 },
      { key: '', kind: 'script', name: 'broken', script: 'plot(close)', savedAt: 3 },
    ]),
  });

  assert.deepEqual(storage.listIndicatorFavorites(), [
    { key: 'native:rsi', kind: 'native', name: 'RSI', nativeType: 'rsi', savedAt: 1 },
  ]);

  storage.toggleIndicatorFavorite({
    key: 'script:ema',
    kind: 'script',
    name: 'EMA',
    script: 'plot(ta.ema(close, 20))',
    language: 'pine',
    savedAt: 0,
  });
  assert.equal(storage.listIndicatorFavorites().length, 2);
  storage.toggleIndicatorFavorite({
    key: 'native:rsi',
    kind: 'native',
    name: 'RSI',
    nativeType: 'rsi',
    savedAt: 0,
  });
  assert.deepEqual(storage.listIndicatorFavorites().map((item) => item.key), ['script:ema']);
});

test('saves, replaces, and deletes named workspace templates', async () => {
  const storage = await storageModule('workspace-templates', {
    [WORKSPACE_TEMPLATES_KEY]: JSON.stringify([
      { name: 'Alpha', state: { version: 1, layout: '1' }, savedAt: 1 },
      { name: 'Alpha', state: { version: 1, layout: '4' }, savedAt: 2 },
      { name: '', state: {}, savedAt: 3 },
    ]),
  });

  assert.deepEqual(storage.listWorkspaceTemplates(), [
    { name: 'Alpha', state: { version: 1, layout: '1' }, savedAt: 1 },
  ]);
  storage.saveWorkspaceTemplate('Alpha', { version: 1, layout: '2h' });
  assert.deepEqual(storage.listWorkspaceTemplates()[0].state, { version: 1, layout: '2h' });
  storage.deleteWorkspaceTemplate('Alpha');
  assert.deepEqual(storage.listWorkspaceTemplates(), []);
});
