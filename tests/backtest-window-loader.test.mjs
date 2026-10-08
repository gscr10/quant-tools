import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiProviderFeed } from '@luxalgo/vela';
import { createBacktestWindowMarketLoader } from '../src/integrations/vela/backtest-window-loader.ts';
import { isOnlineHistoryReload } from '../src/integrations/vela/online-history-reload.ts';

const bars = (from, to) => [
  { time: from, open: 1, high: 2, low: 0, close: 1.5, volume: 2 },
  { time: to, open: 1.5, high: 2.5, low: 1, close: 2, volume: 3 },
];

function tail(rows, range) {
  return rows.filter(bar => (range.from === undefined || bar.time >= range.from)
    && (range.to === undefined || bar.time <= range.to)).slice(-(range.limit ?? rows.length));
}

function fakeChart(provider, options = {}) {
  const listeners = new Set();
  const calls = [];
  const onlineReloadCalls = [];
  const chart = {
    market: { symbol: 'binance:BTCUSDT', provider: 'binance', timeframe: '15', offline: false },
    data: { providerInstance: () => provider },
    on(event, listener) {
      if (event === 'market:changed') listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async setMarket(next) {
      calls.push(next);
      onlineReloadCalls.push(isOnlineHistoryReload(chart));
      if (next.data !== undefined) chart.market = { ...chart.market, ...next, offline: true };
      else chart.market = { ...chart.market, ...next, offline: false };
      for (const listener of listeners) listener({ symbol: chart.market.symbol, timeframe: chart.market.timeframe });
    },
  };
  if (options.market) chart.market = { ...chart.market, ...options.market };
  return {
    chart,
    calls,
    onlineReloadCalls,
    emit(event) {
      chart.market = { ...chart.market, ...event };
      listeners.forEach(listener => listener(event));
    },
  };
}

test('custom request fetches the provider tail and executes only the requested dates', async () => {
  const requests = [];
  const { chart, calls } = fakeChart({
    async getBars(ticker, timeframe, range) {
      requests.push({ ticker, timeframe, range });
      return tail(bars(1_000, 2_000), range);
    },
  });
  const loader = createBacktestWindowMarketLoader(chart);
  const result = await loader.apply({ mode: 'window', from: 1_000, to: 2_000, limit: 2 });
  assert.equal(result.applied, true);
  assert.deepEqual(requests, [{ ticker: 'BTCUSDT', timeframe: '15', range: { to: 2_000, limit: 2 } }]);
  assert.equal(calls[0].data.length, 2);
  assert.deepEqual(calls[0].visibleRange, { from: 1_000, to: 2_000 });
  assert.equal(chart.market.offline, true);
  loader.destroy();
});

test('a late older request cannot replace the newer date window', async () => {
  const gates = [];
  const { chart, calls } = fakeChart({
    getBars(_ticker, _timeframe, range) {
      return new Promise(resolve => gates.push(() => resolve(tail([...bars(1, 2), ...bars(3, 4)], range))));
    },
  });
  const loader = createBacktestWindowMarketLoader(chart);
  const first = loader.apply({ mode: 'window', from: 1, to: 2, limit: 2 });
  const second = loader.apply({ mode: 'window', from: 3, to: 4, limit: 2 });
  gates[0]();
  const firstResult = await first;
  assert.equal(firstResult.stale, true);
  assert.equal(calls.length, 0);
  gates[1]();
  const secondResult = await second;
  assert.equal(secondResult.applied, true);
  assert.deepEqual(calls[0].visibleRange, { from: 3, to: 4 });
  loader.destroy();
});

test('an external market switch invalidates the latest in-flight request', async () => {
  let release;
  const { chart, emit } = fakeChart({
    getBars(_ticker, _timeframe, range) {
      return new Promise(resolve => { release = () => resolve(tail(bars(10, 20), range)); });
    },
  });
  const loader = createBacktestWindowMarketLoader(chart);
  const pending = loader.apply({ mode: 'window', from: 10, to: 20, limit: 2 });
  emit({ symbol: 'binance:ETHUSDT', timeframe: '15' });
  release();
  const outcome = await pending;
  assert.equal(outcome.stale, true);
  loader.destroy();
});

test('default returns to provider mode with 2,000 bars', async () => {
  const { chart, calls, onlineReloadCalls } = fakeChart({ getBars: async () => [] }, { market: { offline: true } });
  const loader = createBacktestWindowMarketLoader(chart);
  const result = await loader.apply({ mode: 'default' });
  assert.equal(result.applied, true);
  assert.equal(calls.at(-1).bars, 2_000);
  assert.deepEqual(calls.at(-1).data, []);
  assert.equal(onlineReloadCalls.at(-1), true);
  assert.equal(chart.market.bars, 2_000);
  // The app's explicit online marker owns the distinction between Vela's
  // force-rerun [] and a caller-supplied genuinely offline empty dataset.
  assert.equal(isOnlineHistoryReload(chart), false);
  loader.destroy();
});

test('a late failure from an older request cannot fail the newer window', async () => {
  const pending = [];
  const { chart, calls } = fakeChart({
    getBars(_ticker, _timeframe, range) {
      return new Promise((resolve, reject) => pending.push({
        resolve: () => resolve(tail([...bars(1, 2), ...bars(3, 4)], range)), reject,
      }));
    },
  });
  const loader = createBacktestWindowMarketLoader(chart);
  const first = loader.apply({ mode: 'window', from: 1, to: 2, limit: 2 });
  const second = loader.apply({ mode: 'window', from: 3, to: 4, limit: 2 });
  pending[1].resolve();
  assert.equal((await second).applied, true);
  pending[0].reject(new Error('late stale HTTP 503'));
  const stale = await first;
  assert.equal(stale.stale, true);
  assert.equal(stale.applied, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].visibleRange, { from: 3, to: 4 });
  loader.destroy();
});

test('a current provider failure rejects so the workbench can offer recovery', async () => {
  const { chart, calls } = fakeChart({
    getBars: async () => { throw new Error('current HTTP 503'); },
  });
  const loader = createBacktestWindowMarketLoader(chart);
  await assert.rejects(
    loader.apply({ mode: 'window', from: 1, to: 2, limit: 2 }),
    /current HTTP 503/,
  );
  assert.equal(calls.length, 0);
  loader.destroy();
});

test('callbacks publish pending and commit before a current dataset can settle', async () => {
  const events = [];
  const { chart } = fakeChart({
    async getBars(_ticker, _timeframe, range) {
      events.push('fetch');
      return tail(bars(1, 2), range);
    },
  });
  const loader = createBacktestWindowMarketLoader(chart, {
    onPending: (request, identity) => events.push(['pending', request.from, identity.timeframe]),
    onCommit: request => events.push(['commit', request.from]),
    onSettled: outcome => events.push(['settled', outcome.applied]),
    onError: error => events.push(['error', error.message]),
  });
  await loader.apply({ mode: 'window', from: 1, to: 2, limit: 2 });
  assert.deepEqual(events, [
    ['pending', 1, '15'], 'fetch', ['commit', 1], ['settled', true],
  ]);
  loader.destroy();
});

test('current provider errors call onError but superseded errors stay silent', async () => {
  const pending = [];
  const errors = [];
  const { chart } = fakeChart({
    getBars() { return new Promise((_resolve, reject) => pending.push(reject)); },
  });
  const loader = createBacktestWindowMarketLoader(chart, {
    onError: error => errors.push(error.message),
  });
  const old = loader.apply({ mode: 'window', from: 1, to: 2, limit: 2 });
  const current = loader.apply({ mode: 'window', from: 3, to: 4, limit: 2 });
  pending[0](new Error('old 503'));
  assert.equal((await old).stale, true);
  assert.deepEqual(errors, []);
  pending[1](new Error('current 503'));
  await assert.rejects(current, /current 503/);
  assert.deepEqual(errors, ['current 503']);
  loader.destroy();
});

for (const timeframe of ['1', '5', '60', '1D', '1W', '1M']) {
  test(`selected dates survive a topbar switch to ${timeframe}`, async () => {
    const requests = [];
    const { chart, calls } = fakeChart({
      async getBars(ticker, tf, range) {
        requests.push({ ticker, timeframe: tf, to: range.to });
        return tail(bars(1, 2), range);
      },
    });
    const originalSetMarket = chart.setMarket;
    const loader = createBacktestWindowMarketLoader(chart);
    await loader.apply({ mode: 'window', from: 1, to: 2, limit: 2 });
    await chart.setMarket({ timeframe });
    assert.deepEqual(requests, [
      { ticker: 'BTCUSDT', timeframe: '15', to: 2 },
      { ticker: 'BTCUSDT', timeframe, to: 2 },
    ]);
    assert.equal(chart.market.timeframe, timeframe);
    assert.deepEqual(calls.at(-1).visibleRange, { from: 1, to: 2 });
    assert.equal(calls.at(-1).data.length, 2);
    loader.destroy();
    assert.equal(chart.setMarket, originalSetMarket);
  });
}

test('destroyed loader drops late data and removes its public wrapper', async () => {
  let release;
  const { chart, calls } = fakeChart({
    getBars(_ticker, _tf, range) {
      return new Promise(resolve => { release = () => resolve(tail(bars(1, 2), range)); });
    },
  });
  const originalSetMarket = chart.setMarket;
  const loader = createBacktestWindowMarketLoader(chart);
  const pending = loader.apply({ mode: 'window', from: 1, to: 2, limit: 2 });
  loader.destroy();
  release();
  assert.equal((await pending).stale, true);
  assert.equal(calls.length, 0);
  assert.equal(chart.setMarket, originalSetMarket);
});

test('bare symbols use the data registry and deep windows page through short responses', async () => {
  const step = 60_000;
  const rows = Array.from({ length: 3_501 }, (_, index) => ({
    time: index * step, open: 1, high: 2, low: 0, close: 1,
  }));
  const requests = [];
  const provider = {
    __quantToolsContinuousHistory: true,
    async getBars(ticker, timeframe, range) {
      requests.push({ ticker, timeframe, ...range });
      // An exchange-side cap can be lower than our page size. A short page
      // must not be interpreted as the beginning of the listing's history.
      return tail(rows, { ...range, limit: Math.min(range.limit, 400) });
    },
  };
  const { chart, calls } = fakeChart(provider, { market: { symbol: 'BTCUSDT', provider: undefined, timeframe: '1' } });
  chart.data.resolve = () => ({ provider: 'binance', ticker: 'BTCUSDT' });
  const loader = createBacktestWindowMarketLoader(chart);
  const outcome = await loader.apply({ mode: 'window', from: 500 * step, to: 3_501 * step - 1 });
  assert.equal(outcome.bars, 3_001);
  assert.equal(calls[0].data[0].time, 500 * step);
  assert.equal(calls[0].data.at(-1).time, 3_500 * step);
  assert.ok(requests.length > 4);
  assert.ok(requests.every(request => request.limit <= 1_000));
  loader.destroy();
});

for (const side of ['prefix', 'suffix', 'internal']) {
  test(`continuous provider cannot certify missing ${side} as a full window`, async () => {
    const step = 60_000;
    let rows = Array.from({ length: 100 }, (_, index) => ({ time: index * step, open: 1, high: 2, low: 0, close: 1 }));
    if (side === 'prefix') rows = rows.slice(10);
    if (side === 'suffix') rows = rows.slice(0, -10);
    if (side === 'internal') rows = rows.filter((_, index) => index !== 50);
    const provider = { __quantToolsContinuousHistory: true,
      getBars: async (_symbol, _tf, range) => tail(rows, range) };
    const { chart, calls } = fakeChart(provider, { market: { timeframe: '1' } });
    const loader = createBacktestWindowMarketLoader(chart);
    await assert.rejects(loader.apply({ mode: 'window', from: 0, to: 99 * step }), /complete selected window|cannot cover|unresolved.*gap/);
    assert.equal(calls.length, 0);
    loader.destroy();
  });
}

test('calendar monthly coverage accepts a full year without a 30-day boundary assumption', async () => {
  const rows = Array.from({ length: 12 }, (_, month) => ({
    time: Date.UTC(2025, month, 1), open: 1, high: 2, low: 0, close: 1,
  }));
  const provider = { __quantToolsContinuousHistory: true, __quantToolsHistoryCalendar: 'utc-month',
    getBars: async (_symbol, _tf, range) => tail(rows, range) };
  const { chart, calls } = fakeChart(provider, { market: { timeframe: '1M' } });
  const loader = createBacktestWindowMarketLoader(chart);
  const outcome = await loader.apply({ mode: 'window', from: Date.UTC(2025, 0, 1), to: Date.UTC(2026, 0, 1) - 1 });
  assert.equal(outcome.bars, 12);
  assert.equal(calls[0].data.length, 12);
  loader.destroy();
});

for (const timeframe of ['1', 'W']) {
  test(`a cutoff inside a ${timeframe} candle excludes its future OHLC without reporting a false short tail`, async () => {
    const step = timeframe === 'W' ? 7 * 86_400_000 : 60_000;
    const rows = Array.from({ length: 10 }, (_, index) => ({ time: index * step, open: 1, high: 2, low: 0, close: 1 }));
    const provider = { __quantToolsContinuousHistory: true,
      getBars: async (_symbol, _tf, range) => tail(rows, range) };
    const { chart, calls } = fakeChart(provider, { market: { timeframe } });
    const loader = createBacktestWindowMarketLoader(chart);
    const outcome = await loader.apply({ mode: 'window', from: 0, to: 8.5 * step });
    assert.equal(outcome.bars, 8);
    assert.equal(calls[0].data.at(-1).time, 7 * step);
    loader.destroy();
  });
}

test('monthly windows ending mid-month omit the unfinished month and retain leap-day coverage', async () => {
  const rows = Array.from({ length: 4 }, (_, month) => ({
    time: Date.UTC(2024, month, 1), open: 1, high: 2, low: 0, close: 1,
  }));
  const provider = { __quantToolsContinuousHistory: true, __quantToolsHistoryCalendar: 'utc-month',
    getBars: async (_symbol, _tf, range) => tail(rows, range) };
  const { chart, calls } = fakeChart(provider, { market: { timeframe: 'M' } });
  const loader = createBacktestWindowMarketLoader(chart);
  const outcome = await loader.apply({ mode: 'window', from: Date.UTC(2024, 0, 1), to: Date.UTC(2024, 2, 15) });
  assert.equal(outcome.bars, 2);
  assert.deepEqual(calls[0].data.map(bar => bar.time), [Date.UTC(2024, 0, 1), Date.UTC(2024, 1, 1)]);
  loader.destroy();
});

test('a cutoff inside the next candle does not excuse a missing fully closed candle', async () => {
  const step = 60_000;
  const rows = Array.from({ length: 7 }, (_, index) => ({ time: index * step, open: 1, high: 2, low: 0, close: 1 }));
  const provider = { __quantToolsContinuousHistory: true,
    getBars: async (_symbol, _tf, range) => tail(rows, range) };
  const { chart, calls } = fakeChart(provider, { market: { timeframe: '1' } });
  const loader = createBacktestWindowMarketLoader(chart);
  await assert.rejects(loader.apply({ mode: 'window', from: 0, to: 8.5 * step }), /cannot cover/);
  assert.equal(calls.length, 0);
  loader.destroy();
});

test('real feeds isolate two static windows from same-market online subscriptions and demo ticks', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const callbacks = new Set();
  const provider = {
    listSymbols: async () => [{ ticker: 'BTCUSDT', type: 'crypto' }],
    getBars: async (_ticker, _timeframe, range) => tail(bars(1_000, 2_000), range),
    subscribe(_ticker, _timeframe, callback) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
  };
  const feedA = new MultiProviderFeed(), feedB = new MultiProviderFeed();
  await Promise.all([feedA.registerProvider('binance', provider), feedB.registerProvider('binance', provider)]);
  const a = fakeChart(provider), b = fakeChart(provider);
  const loaderA = createBacktestWindowMarketLoader(a.chart), loaderB = createBacktestWindowMarketLoader(b.chart);
  const cleanups = [];
  t.after(() => { cleanups.forEach(stop => stop()); loaderA.destroy(); loaderB.destroy(); });
  const window = { mode: 'window', from: 1_000, to: 2_000, limit: 2 };
  await loaderA.apply(window);
  const staticA = { ...a.chart.market, ...a.calls.at(-1) };
  await feedA.load(staticA);
  const staticTicks = [];
  cleanups.push(feedA.subscribe(staticA, bar => staticTicks.push(bar)));

  // A's fixed window must not block a new online subscription with the same
  // symbol/timeframe in B. Count an actual provider-delivered candle.
  const onlineB = { symbol: 'binance:BTCUSDT', timeframe: '15', bars: 2 };
  await feedB.load(onlineB);
  const onlineTicks = [];
  const stopOnline = feedB.subscribe(onlineB, bar => onlineTicks.push(bar));
  cleanups.push(stopOnline);
  callbacks.forEach(callback => callback(bars(1_000, 2_000)[1]));
  assert.equal(onlineTicks.length, 1);
  stopOnline();

  await loaderB.apply(window);
  const staticB = { ...b.chart.market, ...b.calls.at(-1) };
  await feedB.loadProgressive(staticB, () => {});
  cleanups.push(feedB.subscribe(staticB, bar => staticTicks.push(bar)));
  t.mock.timers.tick(2_000);
  assert.deepEqual(staticTicks, []);
  await loaderA.apply({ mode: 'default' });
  loaderA.destroy();
  // Re-subscribing B after A leaves is the case a global identity Set breaks.
  cleanups.push(feedB.subscribe(staticB, bar => staticTicks.push(bar)));
  t.mock.timers.tick(2_000);
  assert.deepEqual(staticTicks, []);

  // An unrelated inline demo on the same feed must still get Vela's own
  // simulated ticks. This also proves the test clock exercises that path.
  const demo = { ...staticB, data: staticB.data.map(bar => ({ ...bar })) };
  await feedB.load(demo);
  const demoTicks = [];
  cleanups.push(feedB.subscribe(demo, bar => demoTicks.push(bar)));
  t.mock.timers.tick(2_000);
  assert.ok(demoTicks.length > 0);
  assert.deepEqual(staticTicks, []);
});
