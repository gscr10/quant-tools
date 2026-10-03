import test from 'node:test';
import assert from 'node:assert/strict';
import { guardProviderHistory, subscribeProviderHistoryRequests } from '../src/integrations/vela/provider-history.ts';
import { enableProviderProgressiveHistory } from '../src/integrations/vela/provider-progressive.ts';
import { createWorkspaceProviders } from '../src/integrations/vela/provider-registry.ts';
import { observeWorkspaceHistory, observedWorkspaceHistory } from '../src/integrations/vela/workspace-history-observer.ts';

class Bus {
  listeners = new Map();
  on(event, fn) { const s = this.listeners.get(event) ?? new Set(); s.add(fn); this.listeners.set(event, s); return () => s.delete(fn); }
  emit(event, value) { for (const fn of this.listeners.get(event) ?? []) fn(value); }
}
function observed(provider) {
  const chart = Object.assign(new Bus(), {
    market: { symbol: 'binance:BTCUSDT', timeframe: '15', bars: 12500 },
    data: { providers: () => [{ name: 'binance' }], providerInstance: () => provider,
      resolve: (symbol) => ({ provider: 'binance', ticker: symbol.split(':').at(-1) }) },
  });
  const cell = { id: 'test', chart };
  const workspace = Object.assign(new Bus(), { cells: () => [cell] });
  const dispose = observeWorkspaceHistory(workspace);
  return { chart, dispose, read: () => observedWorkspaceHistory(workspace, cell) };
}

for (const status of [503, 429]) test(`R11 actual guarded Binance HTTP ${status} remains failure, not genesis`, async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status });
  const provider = createWorkspaceProviders({ requestTimeoutMs: 20 }).binance();
  const f = observed(provider);
  try {
    await assert.rejects(provider.getBars('BTCUSDT', '15', { to: 1000, limit: 12001 }), new RegExp(`HTTP ${status}`));
    f.chart.emit('history:complete', { reason: 'genesis', barsLoaded: 500, oldestTime: 1000 });
    assert.equal(f.read().historyReason, 'aborted');
    assert.equal(f.read().historyTarget, 12500);
    assert.match(f.read().historyError, new RegExp(`HTTP ${status}`));
    assert.equal(f.read().noData, false);
  } finally { f.dispose(); globalThis.fetch = original; }
});

for (const kind of ['binance', 'hyperliquid']) test(`R11 ${kind}: offline/timeout failures and successful empty responses stay distinct`, async () => {
  const original = globalThis.fetch;
  try {
    for (const mode of ['offline', 'timeout', 'empty']) {
      globalThis.fetch = mode === 'offline' ? async () => { throw new TypeError('offline'); }
        : mode === 'timeout' ? () => new Promise(() => {}) : async () => new Response('[]');
      const provider = createWorkspaceProviders({ requestTimeoutMs: 5 })[kind]();
      const requests = [];
      const dispose = subscribeProviderHistoryRequests(provider, request => requests.push(request));
      const promise = provider.getBars(kind === 'binance' ? 'BTCUSDT' : 'BTC', '15', { to: 1000, limit: 10 });
      if (mode === 'empty') assert.deepEqual(await promise, []);
      else await assert.rejects(promise);
      assert.equal(requests.length, 1);
      const result = await requests[0].result;
      assert.equal(result.error === null, mode === 'empty');
      dispose();
    }
  } finally { globalThis.fetch = original; }
});

test('R11 stale failed request cannot poison a new market, same-market retry, or another timeframe', async () => {
  const pending = [];
  const provider = guardProviderHistory({ getBars: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
  const f = observed(provider);
  const old = provider.getBars('BTCUSDT', '15', { to: 1000, limit: 10 });
  f.chart.emit('load:start', { symbol: 'binance:BTCUSDT', timeframe: '15' });
  const current = provider.getBars('BTCUSDT', '15', { to: 1000, limit: 10 });
  pending[0].reject(Error('old failure'));
  await assert.rejects(old);
  pending[1].resolve([]); await current;
  f.chart.emit('history:complete', { reason: 'genesis', barsLoaded: 500, oldestTime: 1 });
  assert.equal(f.read().historyReason, 'genesis');
  assert.equal(f.read().historyError, null);
  f.chart.emit('load:start', { symbol: 'binance:BTCUSDT', timeframe: '15' });
  const secondary = provider.getBars('BTCUSDT', '60', { limit: 10 });
  pending[2].reject(Error('secondary failure')); await assert.rejects(secondary);
  assert.equal(f.read().historyReason, null);
  f.dispose();
});

test('R11 failed initial load is not an empty market; a fresh successful generation can recover', async () => {
  let fail = true;
  const provider = guardProviderHistory({ getBars: async () => { if (fail) throw Error('503'); return []; } });
  const f = observed(provider);
  await assert.rejects(provider.getBars('BTCUSDT', '15', { limit: 500 }));
  f.chart.emit('load:end', { symbol: 'binance:BTCUSDT', timeframe: '15', bars: 0 });
  f.chart.emit('history:complete', { reason: 'genesis', barsLoaded: 0, oldestTime: 0 });
  assert.equal(f.read().noData, false);
  assert.equal(f.read().historyReason, 'aborted');
  fail = false;
  f.chart.emit('load:start', { symbol: 'binance:BTCUSDT', timeframe: '15' });
  await provider.getBars('BTCUSDT', '15', { limit: 500 });
  f.chart.emit('load:end', { symbol: 'binance:BTCUSDT', timeframe: '15', bars: 0 });
  f.chart.emit('history:complete', { reason: 'genesis', barsLoaded: 0, oldestTime: 0 });
  assert.equal(f.read().noData, true); assert.equal(f.read().historyReason, 'genesis');
  f.dispose();
});

test('R11 unguarded providers reject non-array and all-malformed candle payloads', async () => {
  for (const payload of [
    { malformed: true },
    [{ time: 1, open: 'bad', high: 2, low: 0, close: 1 }],
  ]) {
    const provider = guardProviderHistory({ getBars: async () => payload });
    const requests = [];
    const stop = subscribeProviderHistoryRequests(provider, request => requests.push(request));
    try {
      await assert.rejects(
        provider.getBars('BTCUSDT', '15', { limit: 10 }),
        /Invalid provider candle response/,
      );
      assert.equal(requests.length, 1);
      assert.match(String((await requests[0].result).error), /Invalid provider candle response/);
    } finally {
      stop();
    }
  }
});

test('R11 mixed candle payload keeps valid rows while isolating malformed rows', async () => {
  const provider = guardProviderHistory({ getBars: async () => [
    { time: 1_000, open: 1, high: 2, low: 0.5, close: 1.5 },
    { time: 2_000, open: 'bad', high: 2, low: 0.5, close: 1.5 },
  ] });
  const requests = [];
  const stop = subscribeProviderHistoryRequests(provider, request => requests.push(request));
  try {
    assert.deepEqual(
      await provider.getBars('BTCUSDT', '15', { limit: 10 }),
      [{ time: 1_000, open: 1, high: 2, low: 0.5, close: 1.5 }],
    );
    assert.equal(requests.length, 1);
    assert.deepEqual(await requests[0].result, { error: null, bars: 1, oldestTime: 1_000 });
  } finally {
    stop();
  }
});

test('R11 successful HTTP with an invalid candle envelope is an error, never empty history', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"unexpected":"not candles"}');
    for (const kind of ['binance', 'hyperliquid']) {
      const provider = createWorkspaceProviders()[kind]();
      await assert.rejects(provider.getBars('BTC', '15', { limit: 1 }), /expected an array/);
    }
  } finally { globalThis.fetch = original; }
});

test('malformed runtime timeframe does not throw during point-range recovery', async () => {
  const provider = guardProviderHistory({ getBars: async () => [] });
  assert.deepEqual(await provider.getBars('BTCUSDT', undefined, { from: 1_000, to: 1_000, limit: 1 }), []);
});

test('point-range recovery preserves Pine month versus minute casing', async () => {
  const requests = [];
  const provider = guardProviderHistory({ getBars: async (_symbol, timeframe, range) => {
    requests.push({ timeframe, range });
    return [];
  } });
  await provider.getBars('BTCUSDT', '15M', { from: 1_000, to: 1_000, limit: 1 });
  await provider.getBars('BTCUSDT', '15m', { from: 1_000, to: 1_000, limit: 1 });
  assert.equal(requests[1].range.to - requests[1].range.from, 15 * 30 * 24 * 60 * 60 * 1_000 - 1);
  assert.equal(requests[3].range.to - requests[3].range.from, 15 * 60 * 1_000 - 1);
});

test('R11 shared-provider failure does not invalidate independent full-depth completion', async () => {
  const provider = guardProviderHistory({ getBars: async () => { throw Error('other cell range unavailable'); } });
  const first = observed(provider), second = observed(provider);
  second.chart.market.bars = 500;
  second.chart.emit('load:start', {symbol:'binance:BTCUSDT',timeframe:'15'});
  await assert.rejects(provider.getBars('BTCUSDT','15',{to:1000,limit:12001}));
  first.chart.emit('history:complete',{reason:'genesis',barsLoaded:500,oldestTime:1000});
  second.chart.emit('history:complete',{reason:'depth',barsLoaded:500,oldestTime:1});
  assert.equal(first.read().historyReason,'aborted');
  assert.equal(second.read().historyReason,'depth');assert.equal(second.read().historyError,null);
  first.dispose();second.dispose();
});

test('R11 two cells: a different-range failure cannot contaminate a proven adjacent genesis', async () => {
  const provider = guardProviderHistory({getBars: async (_symbol,_tf,range) => {
    if (range.to === 200) throw Error('A failed'); return [];
  }});
  const first=observed(provider),second=observed(provider);
  await assert.rejects(provider.getBars('BTCUSDT','15',{from:100,to:200,limit:500}));
  await provider.getBars('BTCUSDT','15',{from:0,to:99,limit:500});
  first.chart.emit('history:complete',{reason:'genesis',barsLoaded:500,oldestTime:200});
  second.chart.emit('history:complete',{reason:'genesis',barsLoaded:1000,oldestTime:100});
  assert.equal(first.read().historyReason,'aborted');
  assert.equal(second.read().historyReason,'genesis');assert.equal(second.read().historyError,null);
  first.dispose();second.dispose();
});

test('R11 late provider failure after history:complete revises the completion instead of leaving genesis', async () => {
  let rejectRequest;
  const provider = guardProviderHistory({ getBars: () => new Promise((_, reject) => { rejectRequest = reject; }) });
  const f = observed(provider);
  const request = provider.getBars('BTCUSDT', '15', { limit: 500 });
  // Vela can publish its synthetic completion before the request observer's
  // Promise reaction runs. A late transport error must still invalidate this
  // generation instead of leaving a false no-data/genesis state.
  f.chart.emit('history:complete', { reason: 'genesis', barsLoaded: 0, oldestTime: 0 });
  rejectRequest(Error('late 503'));
  await assert.rejects(request, /late 503/);
  await Promise.resolve();
  assert.equal(f.read().historyReason, 'aborted');
  assert.match(f.read().historyError, /late 503/);
  assert.equal(f.read().noData, false);
  f.dispose();
});

test('R11 late progressive failure after history:complete revises the completion', async () => {
  let rejectRequest;
  const provider = enableProviderProgressiveHistory({
    getBars: () => new Promise((_, reject) => { rejectRequest = reject; }),
  });
  const f = observed(provider);
  const request = provider.getBarsProgressive('BTCUSDT', '15', { limit: 2_000 }, () => {});
  f.chart.emit('history:complete', { reason: 'genesis', barsLoaded: 500, oldestTime: 1000 });
  rejectRequest(Error('late progressive 503'));
  await request;
  await Promise.resolve();
  assert.equal(f.read().historyReason, 'aborted');
  assert.match(f.read().historyError, /late progressive 503/);
  f.dispose();
});
