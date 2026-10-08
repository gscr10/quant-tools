import test from 'node:test';
import assert from 'node:assert/strict';
import { isOnlineHistoryReload, reloadOnlineHistory } from '../src/integrations/vela/online-history-reload.ts';
import {
  installDefaultTimeframeSwitchPolicy,
  normalizeDefaultMarketSwitch,
} from '../src/integrations/vela/timeframe-switch-policy.ts';

function chart(symbol = 'binance:BTCUSDT', timeframe = '60') {
  const value = {
    symbol,
    timeframe,
    bars: 50_000,
    session: undefined,
    offline: false,
  };
  const calls = [];
  const frames = [];
  const listeners = new Set();
  const result = {
    calls,
    frames,
    on(_event,listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setVisibleRangePreset(preset) { frames.push(preset); for (const listener of listeners) listener({from:1,to:2}); },
    userViewport() { for (const listener of listeners) listener({from:1,to:2}); },
    get market() { return value; },
    setMarket(next) {
      calls.push(next);
      Object.assign(value, next);
      return Promise.resolve();
    },
  };
  return result;
}

function workspace(initial) {
  const listeners = new Map();
  const cells = [...initial];
  const api = {
    cells: () => cells,
    cell: (id) => cells.find((cell) => cell.id === id),
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return () => listeners.set(event, list.filter((entry) => entry !== listener));
    },
    emit(event, payload) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
    },
    add(cell) { cells.push(cell); api.emit('cell:created', { id: cell.id }); },
    remove(id) {
      const index = cells.findIndex((cell) => cell.id === id);
      if (index >= 0) cells.splice(index, 1);
      api.emit('cell:destroyed', { id });
    },
  };
  return api;
}

test('ordinary timeframe switches reset to latest default depth and frame ALL', () => {
  const current = { symbol: 'binance:BTCUSDT', timeframe: '60', session: undefined, offline: false };
  assert.deepEqual(
    normalizeDefaultMarketSwitch(current, { timeframe: '1' }, 2_000),
    { timeframe: '1', bars: 2_000, visibleRange: 'ALL' },
  );
  assert.deepEqual(
    normalizeDefaultMarketSwitch(current, { symbol: 'hyperliquid:BTC' }, 2_000),
    { symbol: 'hyperliquid:BTC', bars: 2_000, visibleRange: 'ALL' },
  );
  for (const timeframe of ['1', '5', '15', '30', '60', '120', '240', 'D', 'W', 'M']) {
    if (timeframe === current.timeframe) continue;
    assert.deepEqual(
      normalizeDefaultMarketSwitch(current, { timeframe }, 2_000),
      { timeframe, bars: 2_000, visibleRange: 'ALL' },
    );
  }
});

test('depth-only requests and explicit range requests remain user controlled', () => {
  const current = { symbol: 'binance:BTCUSDT', timeframe: '60', session: undefined, offline: false, bars: 2_000 };
  const depth = { bars: 50_000 };
  const range = { timeframe: '1', bars: 20_000, visibleRange: '3M' };
  assert.strictEqual(normalizeDefaultMarketSwitch(current, depth, 2_000), depth);
  assert.strictEqual(normalizeDefaultMarketSwitch(current, range, 2_000), range);
  // A host may combine an identity switch and an explicit depth request. The
  // default-depth policy must not overwrite that request merely because no
  // visibleRange preset was included.
  const switchedDepth = { timeframe: '1', bars: 4_000 };
  assert.strictEqual(normalizeDefaultMarketSwitch(current, switchedDepth, 2_000), switchedDepth);
  // Vela echoes the currently loaded depth from a topbar timeframe change;
  // that echo is not an explicit request to carry deep history forward.
  assert.deepEqual(
    normalizeDefaultMarketSwitch({ ...current, bars: 6_000 }, { timeframe: '1', bars: 6_000 }, 2_000),
    { timeframe: '1', bars: 2_000, visibleRange: 'ALL' },
  );
  const offline = { timeframe: '1', data: [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }], bars: 1 };
  assert.strictEqual(normalizeDefaultMarketSwitch(current, offline, 2_000), offline);
});

test('initial market assignment is safe when Vela has not exposed a market yet', () => {
  assert.deepEqual(
    normalizeDefaultMarketSwitch(undefined, { symbol: 'binance:BTCUSDT', timeframe: '1' }, 2_000),
    { symbol: 'binance:BTCUSDT', timeframe: '1', bars: 2_000, visibleRange: 'ALL' },
  );
  assert.deepEqual(
    normalizeDefaultMarketSwitch(undefined, { bars: 20_000 }, 2_000),
    { bars: 20_000 },
  );
});

test('offline timeframe changes keep their finite data and explicit depth', () => {
  const offline = { symbol: 'BTCUSDT', timeframe: '60', offline: true };
  const next = { timeframe: '1', bars: 37 };
  assert.strictEqual(normalizeDefaultMarketSwitch(offline, next, 2_000), next);
  assert.deepEqual(normalizeDefaultMarketSwitch(offline, { symbol: 'binance:BTCUSDT' }, 2_000), {
    symbol: 'binance:BTCUSDT', bars: 2_000, visibleRange: 'ALL',
  });
});

test('invalid and sub-unit default depths never create an empty history budget', () => {
  const current = { symbol: 'binance:BTCUSDT', timeframe: '60' };
  for (const depth of [NaN, Infinity, -1, 0]) {
    assert.equal(normalizeDefaultMarketSwitch(current, { timeframe: '1' }, depth).bars, 2_000);
  }
  assert.equal(normalizeDefaultMarketSwitch(current, { timeframe: '1' }, 0.5).bars, 1);
});

test('policy covers existing and later cells without affecting explicit deep history', async () => {
  const first = chart();
  const ws = workspace([{ id: 'main', chart: first }]);
  const dispose = installDefaultTimeframeSwitchPolicy(ws, 2_000);

  await first.setMarket({ timeframe: '1' });
  assert.deepEqual(first.calls.at(-1), { timeframe: '1', bars: 2_000, visibleRange: 'ALL' });

  await first.setMarket({ bars: 20_000 });
  assert.deepEqual(first.calls.at(-1), { bars: 20_000 });

  await first.setMarket({ timeframe: '5', bars: 20_000, visibleRange: '3M' });
  assert.deepEqual(first.calls.at(-1), { timeframe: '5', bars: 20_000, visibleRange: '3M' });

  const second = chart('binance:ETHUSDT', '15');
  ws.add({ id: 'second', chart: second });
  await second.setMarket({ timeframe: 'D' });
  assert.deepEqual(second.calls.at(-1), { timeframe: 'D', bars: 2_000, visibleRange: 'ALL' });

  ws.remove('second');
  dispose();
  await first.setMarket({ timeframe: '15' });
  assert.deepEqual(first.calls.at(-1), { timeframe: '15' });
});

test('default fitted view follows resize until user navigation or explicit depth takes ownership', async () => {
  const previous = globalThis.ResizeObserver;
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  const value = chart();
  const ws = workspace([{id:'main',chart:value,host:{}}]);
  let dispose;
  try {
    dispose = installDefaultTimeframeSwitchPolicy(ws,2000);
    observers[0].callback();
    assert.equal(value.frames.length,0,'cold/restored view is unchanged');
    await value.setMarket({timeframe:'1'});
    assert.equal(value.frames.length,1);
    observers[0].callback();
    assert.equal(value.frames.length,2,'resize retains the default full view');
    value.userViewport();
    observers[0].callback();
    assert.equal(value.frames.length,2,'resize preserves user zoom/pan');
    await value.setMarket({timeframe:'5'});
    await value.setMarket({bars:12500});
    observers[0].callback();
    assert.equal(value.frames.length,3,'explicit history preserves its prior view');
    dispose();
    assert.equal(observers[0].disconnected,true);
  } finally {
    dispose?.();
    if (previous) globalThis.ResizeObserver=previous;
    else delete globalThis.ResizeObserver;
  }
});

test('late completion after a newer explicit view or disposal cannot refit the chart', async () => {
  const value=chart();
  const pending=[];
  value.setMarket = next => { value.calls.push(next); return new Promise(resolve=>pending.push(resolve)); };
  const ws=workspace([{id:'main',chart:value}]);
  const dispose=installDefaultTimeframeSwitchPolicy(ws,2000);
  const first=value.setMarket({timeframe:'1'});
  const explicit=value.setMarket({timeframe:'5',visibleRange:'1D'});
  pending[1]();await explicit;
  pending[0]();await first;
  assert.deepEqual(value.frames,[]);
  const last=value.setMarket({timeframe:'15'});
  dispose();pending[2]();await last;
  assert.deepEqual(value.frames,[]);
});

test('empty-data online Retry does not become a finite offline exception on the next switch', async () => {
  const value = chart();
  value.setMarket = next => {
    value.calls.push(next);
    const differentSymbol = next.symbol !== undefined && next.symbol !== value.market.symbol;
    Object.assign(value.market, next);
    if (next.data !== undefined) value.market.offline = true;
    else if (differentSymbol) value.market.offline = false;
    return Promise.resolve();
  };
  const ws = workspace([{ id: 'main', chart: value }]);
  const dispose = installDefaultTimeframeSwitchPolicy(ws, 2_000);
  await reloadOnlineHistory(value, 4_000);
  assert.equal(isOnlineHistoryReload(value), false, 'intent is scoped to the call');
  assert.equal(value.market.offline, true, 'Vela exposes [] as offline metadata');
  await value.setMarket({ symbol: value.market.symbol });
  await value.setMarket({ timeframe: '1' });
  assert.deepEqual(value.calls.at(-1), { timeframe: '1', bars: 2_000, visibleRange: 'ALL' });
  // The successful identity switch consumes the retry marker. A later
  // timeframe change must therefore keep Vela's explicit offline contract
  // instead of treating every future switch as an online retry.
  await value.setMarket({ timeframe: '5' });
  assert.deepEqual(value.calls.at(-1), { timeframe: '5' });
  await value.setMarket({ data: [], bars: 37 });
  await value.setMarket({ timeframe: '15' });
  assert.deepEqual(value.calls.at(-1), { timeframe: '15' }, 'unmarked inline EMPTY stays offline');
  await value.setMarket({ data: [{ time: 1 }], bars: 37 });
  await value.setMarket({ timeframe: '5' });
  assert.deepEqual(value.calls.at(-1), { timeframe: '5' }, 'real inline data stays finite');
  dispose();
});

test('online reload intent is cell scoped and cleared after a synchronous failure', () => {
  const other = chart();
  const broken = chart();
  broken.setMarket = () => {
    assert.equal(isOnlineHistoryReload(broken), true);
    assert.equal(isOnlineHistoryReload(other), false);
    throw new Error('controlled failure');
  };
  assert.throws(() => reloadOnlineHistory(broken, 2_000), /controlled failure/);
  assert.equal(isOnlineHistoryReload(broken), false);
});
