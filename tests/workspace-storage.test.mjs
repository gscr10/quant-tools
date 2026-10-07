import test from 'node:test';
import assert from 'node:assert/strict';
import { createMigratingWorkspaceStorage, migrateWorkspaceState, WORKSPACE_HISTORY_BARS } from '../src/integrations/storage/workspace-storage.ts';
import { WORKSPACE_DEFAULTS } from '../src/config/workspace-options.ts';
import { BACKTEST_EXECUTION_HIGHLIGHT_TYPE } from '../src/domain/ports/workspace-port.ts';

test('autosave strips only the dedicated transient execution annotation and preserves all user indicator records', () => {
  const values = new Map();
  const store = createMigratingWorkspaceStorage({ getItem: k => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) });
  const user = ['volume', { type: 'sma', inputs: { length: 9 } },
    { name: BACKTEST_EXECUTION_HIGHLIGHT_TYPE }, 'quant-backtest-execution-highlight-user'];
  const state = { charts: [{ bars: 2000, indicators: [...user,
    BACKTEST_EXECUTION_HIGHLIGHT_TYPE, { type: BACKTEST_EXECUTION_HIGHLIGHT_TYPE }] },
    { bars: 2000, indicators: { natives: ['volume', BACKTEST_EXECUTION_HIGHLIGHT_TYPE],
      scripts: [{ name: BACKTEST_EXECUTION_HIGHLIGHT_TYPE }], removedNatives: [] } }],
    cells: { other: { bars: 2000, indicators: ['volume', BACKTEST_EXECUTION_HIGHLIGHT_TYPE] } },
    ext: { text: BACKTEST_EXECUTION_HIGHLIGHT_TYPE } };
  store.set('workspace', JSON.stringify(state));
  const saved = JSON.parse(values.get('workspace'));
  assert.deepEqual(saved.charts[0].indicators, user);
  assert.deepEqual(saved.cells.other.indicators, ['volume']);
  assert.deepEqual(saved.charts[1].indicators, { natives: ['volume'],
    scripts: [{ name: BACKTEST_EXECUTION_HIGHLIGHT_TYPE }], removedNatives: [] });
  assert.deepEqual(saved.ext, state.ext);
  assert.equal(state.charts[0].indicators.length, user.length + 2, 'caller input untouched');
  values.set('workspace', JSON.stringify(state));
  assert.deepEqual(JSON.parse(store.get('workspace')), saved, 'old accidental persisted marker is also stripped on read');
});

test('history migration shares its default with new workspace and preserves user fields', () => {
  assert.equal(WORKSPACE_HISTORY_BARS, WORKSPACE_DEFAULTS.bars);
  const state = { version: 1, charts: [undefined, 500, 2000, 7000].map(bars => ({
    bars, symbol: 'hyperliquid:BTC', timeframe: '45',
    rendererConfig: { bars: { upColor: 'red' } }, ext: { script: 'plot(close)' },
  })) };
  const raw = JSON.stringify(state);
  const result = JSON.parse(migrateWorkspaceState(raw));
  assert.deepEqual(result.charts.map(c => c.bars), [2000, 2000, 2000, 7000]);
  result.charts.forEach((c, i) => {
    const original = JSON.parse(raw).charts[i];
    delete c.bars; delete original.bars;
    assert.deepEqual(c, original);
  });
  for (const raw of ['{', 'null', '[]', '{"unknown":true}']) assert.equal(migrateWorkspaceState(raw), raw);
});

test('history migration repairs malformed chart budgets without touching renderer bars', () => {
  const state = {
    version: 1,
    charts: [
      { id: 'missing' },
      { id: 'null', bars: null },
      { id: 'text', bars: '500' },
      { id: 'negative', bars: -1 },
      { id: 'boolean', bars: false },
      { id: 'fractional', bars: 2000.5 },
      { id: 'fractional-large', bars: 3000.75 },
      { id: 'large', bars: 3000 },
      { id: 'renderer', rendererConfig: { bars: { upColor: 'red' } } },
    ],
  };
  const migrated = JSON.parse(migrateWorkspaceState(JSON.stringify(state)));
  assert.deepEqual(migrated.charts.map((chart) => chart.bars), [
    2000, 2000, 2000, 2000, 2000, 2000, 3000, 3000, 2000,
  ]);
  assert.deepEqual(migrated.charts.at(-1).rendererConfig.bars, { upColor: 'red' });
  assert.equal(migrateWorkspaceState(JSON.stringify({ charts: [{ bars: 99 }] }), 2000.9),
    JSON.stringify({ charts: [{ bars: 2000 }] }));
  assert.equal(migrateWorkspaceState(JSON.stringify({ charts: [{ bars: 99 }] }), 0.5),
    JSON.stringify({ charts: [{ bars: 99 }] }));
});

test('workspace creation and operation survive localStorage getter security errors', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('SecurityError'); } });
  try {
    const store = createMigratingWorkspaceStorage();
    assert.equal(store.get('x'), null);
    store.set('x', '{"charts":[{"bars":500}]}');
    assert.equal(JSON.parse(store.get('x')).charts[0].bars, 2000);
    store.remove('x');
    assert.equal(store.get('x'), null);
  } finally {
    if (old) Object.defineProperty(globalThis, 'localStorage', old);
    else delete globalThis.localStorage;
  }
});

test('failed writes and removal do not resurrect stored stale state; healthy reads remain current', () => {
  let fail = true;
  const values = new Map([['x', '{"charts":[{"bars":500}]}']]);
  let writes = 0;
  const backend = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { writes++; if (fail) throw Error('quota'); values.set(key, value); },
    removeItem(key) { if (fail) throw Error('blocked'); values.delete(key); },
  };
  const store = createMigratingWorkspaceStorage(backend);
  assert.equal(JSON.parse(store.get('x')).charts[0].bars, 2000);
  assert.equal(JSON.parse(store.get('x')).charts[0].bars, 2000);
  assert.equal(writes, 1);
  store.remove('x'); assert.equal(store.get('x'), null);
  fail = false;
  store.set('x', '{"charts":[{"bars":3000}]}');
  values.set('x', '{"charts":[{"bars":4000}]}');
  assert.equal(JSON.parse(store.get('x')).charts[0].bars, 4000);
});

test('read failures do not prevent the workspace from booting', () => {
  const store = createMigratingWorkspaceStorage({ getItem() { throw Error('blocked'); } });
  assert.equal(store.get('workspace'), null);
});

test('runtime storage boundary rejects non-string host values', () => {
  const store = createMigratingWorkspaceStorage({
    getItem() { return 42; },
    setItem() { throw Error('quota'); },
    removeItem() { throw Error('blocked'); },
  });
  assert.equal(store.get('workspace'), null);
  store.set('workspace', /** @type {any} */ ({ charts: [] }));
  assert.equal(store.get('workspace'), null);
});
