import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installDateRangePolicy,
  rangeBarsForTimeframe,
} from './range-switch-policy.ts';

const preset = (id, bars = 0) => ({
  id,
  preset: id === '7D' ? '1W' : id,
  bars,
});

test('date-range chips calculate depth at the selected chart timeframe', () => {
  assert.equal(rangeBarsForTimeframe(preset('1D'), '1', Date.UTC(2026, 0, 2)), 1_442);
  assert.equal(rangeBarsForTimeframe(preset('7D'), '5', Date.UTC(2026, 0, 8)), 2_018);
  assert.equal(rangeBarsForTimeframe(preset('7D'), '1', Date.UTC(2026, 0, 8)), 10_082);
  assert.equal(rangeBarsForTimeframe(preset('1M'), '60', Date.UTC(2026, 1, 1)), 722);
  assert.equal(rangeBarsForTimeframe(preset('ALL', 5_000), '15'), 5_000);
});

test('YTD uses the current UTC year and keeps the requested resolution', () => {
  const now = Date.UTC(2026, 6, 1);
  const expected = Math.ceil((now - Date.UTC(2026, 0, 1)) / (60 * 60 * 1_000)) + 2;
  assert.equal(rangeBarsForTimeframe(preset('YTD'), '60', now), expected);
});

test('every bottom shortcut remains a date window at the selected timeframe', () => {
  const now = Date.UTC(2026, 9, 7);
  const timeframe = '5';
  for (const id of ['1D', '7D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'ALL']) {
    const request = { ...preset(id), tf: id === '1D' ? '1' : id === '7D' ? '5' : 'W' };
    const bars = rangeBarsForTimeframe(request, timeframe, now);
    assert.ok(bars === undefined || bars > 0, `${id} must produce a finite positive depth`);
  }
  // The native Vela preset carries a finer `tf`; the application policy uses
  // the selected topbar resolution instead of letting that field switch it.
  assert.equal(rangeBarsForTimeframe({ ...preset('1D'), tf: '1' }, timeframe, now), 290);
});

function makeCell(timeframe = '15', bars = 2_000) {
  const calls = [];
  const frames = [];
  const chart = {
    market: { timeframe, bars, offline: false },
    setVisibleRangePreset: (value) => frames.push(value),
    setMarket: (next) => {
      calls.push(next);
      Object.assign(chart.market, next);
      return Promise.resolve();
    },
  };
  return {
    id: 'main',
    chart,
    timeframe,
    activeRangeId: null,
    calls,
    frames,
    applyRange() { throw new Error('original should be replaced'); },
  };
}

function makeWorkspace(cell) {
  const listeners = new Map();
  return {
    cells: () => [cell],
    cell: () => cell,
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return () => listeners.set(event, list.filter((entry) => entry !== listener));
    },
  };
}

const waitForRangeDrain = () => new Promise(resolve => setTimeout(resolve, 80));

test('range click preserves topbar timeframe and frames after a depth-only fetch', async () => {
  const cell = makeCell('1', 2_000);
  const workspace = makeWorkspace(cell);
  const dispose = installDateRangePolicy(workspace);
  cell.applyRange(preset('7D'));
  await waitForRangeDrain();
  assert.equal(cell.timeframe, '1');
  assert.equal(cell.chart.market.timeframe, '1');
  assert.equal(cell.calls.length, 1);
  assert.equal(cell.calls[0].timeframe, undefined);
  assert.equal(cell.calls[0].bars, 10_082);
  assert.equal(cell.calls[0].visibleRange, '1W');
  assert.deepEqual(cell.frames, ['1W']);
  assert.equal(cell.activeRangeId, '7D');
  dispose();
});

test('a range within loaded history does not reload or alter timeframe', () => {
  const cell = makeCell('60', 2_000);
  const workspace = makeWorkspace(cell);
  const dispose = installDateRangePolicy(workspace);
  cell.applyRange(preset('1D'));
  assert.deepEqual(cell.calls, []);
  assert.deepEqual(cell.frames, ['1D']);
  assert.equal(cell.chart.market.timeframe, '60');
  dispose();
});

test('offline data is framed in place without a provider reload', () => {
  const cell = makeCell('1', 100);
  cell.chart.market.offline = true;
  const workspace = makeWorkspace(cell);
  const dispose = installDateRangePolicy(workspace);
  cell.applyRange(preset('7D'));
  assert.deepEqual(cell.calls, []);
  assert.deepEqual(cell.frames, ['1W']);
  dispose();
});

test('rapid range clicks coalesce to the latest request and keep one load in flight', async () => {
  const calls = [];
  const frames = [];
  const resolvers = [];
  const chart = {
    market: { timeframe: '1', bars: 2_000, offline: false },
    setVisibleRangePreset: value => frames.push(value),
    setMarket: next => {
      calls.push(next);
      Object.assign(chart.market, next);
      return new Promise(resolve => resolvers.push(resolve));
    },
  };
  const cell = {
    id: 'main', chart, timeframe: '1', activeRangeId: null,
    applyRange() { throw new Error('original should be replaced'); },
  };
  const dispose = installDateRangePolicy(makeWorkspace(cell));

  // These are synchronous click-equivalents from the native bottom bar. The
  // debounce starts only the final 3M request, so an accidental 5Y click
  // cannot launch a multi-million-bar 1m load before the final choice.
  cell.applyRange(preset('7D'));
  cell.applyRange(preset('5Y'));
  cell.applyRange(preset('3M'));
  await waitForRangeDrain();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].visibleRange, '3M');
  assert.equal(calls[0].bars, rangeBarsForTimeframe(preset('3M'), '1'));
  assert.equal(resolvers.length, 1);

  // A later in-range click supersedes the pending operation and is re-framed
  // when the old load settles; the stale promise cannot reclaim its preset.
  cell.applyRange(preset('1D'));
  assert.deepEqual(frames, ['1D']);
  resolvers.shift()();
  await waitForRangeDrain();
  assert.deepEqual(frames, ['1D']);
  assert.equal(cell.activeRangeId, '1D');
  dispose();
});

test('destroyed cells are unbound before the next layout and do not stay retained', () => {
  const first = makeCell('15', 2_000);
  const second = makeCell('15', 2_000);
  let cells = [first];
  const listeners = new Map();
  const workspace = {
    cells: () => cells,
    cell: id => cells.find(candidate => candidate.id === id),
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return () => listeners.set(event, list.filter(entry => entry !== listener));
    },
  };
  const originalFirst = first.applyRange;
  const originalSecond = second.applyRange;
  const dispose = installDateRangePolicy(workspace);
  const wrappedFirst = first.applyRange;
  assert.notEqual(wrappedFirst, originalFirst);

  cells = [];
  listeners.get('cell:destroyed').forEach(listener => listener({ id: first.id }));
  assert.equal(first.applyRange, originalFirst);

  cells = [second];
  listeners.get('layout:changed').forEach(listener => listener());
  assert.notEqual(second.applyRange, originalSecond);
  dispose();
  assert.equal(second.applyRange, originalSecond);
});

test('an identity switch cancels an in-flight range frame', async () => {
  const calls = [];
  const frames = [];
  const listeners = new Map();
  let release;
  const chart = {
    market: { symbol: 'BTCUSDT', timeframe: '15', bars: 2_000, offline: false },
    on(event, listener) {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
    setVisibleRangePreset: value => frames.push(value),
    setMarket: next => {
      calls.push(next);
      return new Promise(resolve => { release = resolve; });
    },
  };
  const cell = {
    id: 'main', chart, timeframe: '15', activeRangeId: null,
    applyRange() { throw new Error('original should be replaced'); },
  };
  const dispose = installDateRangePolicy(makeWorkspace(cell));
  cell.applyRange(preset('5Y'));
  await waitForRangeDrain();
  assert.equal(calls.length, 1);

  // Simulate a topbar identity switch while the old range request is still
  // awaiting history. Its late completion must not reclaim the old viewport.
  chart.market.timeframe = '1';
  listeners.get('market:changed')?.({ symbol: 'BTCUSDT', timeframe: '1', prev: { symbol: 'BTCUSDT', timeframe: '15' } });
  release();
  await waitForRangeDrain();
  assert.deepEqual(frames, []);
  assert.equal(cell.activeRangeId, null);
  dispose();
});
