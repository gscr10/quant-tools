import test from 'node:test';
import assert from 'node:assert/strict';
import { BarStore, CachingDataFeed } from '@luxalgo/vela';

import {
  fetchPagedRangeResilient,
  installVelaHistoryResilience,
} from './history-resilience.ts';

const STEP = 60_000;

function barsFrom(count) {
  return Array.from({ length: count }, (_, index) => ({
    time: index * STEP,
    open: index,
    high: index + 1,
    low: index,
    close: index + 0.5,
  }));
}

test('large history retries the same cursor instead of skipping a failed page', async () => {
  const all = barsFrom(12_001);
  const calls = [];
  let failedOnce = false;
  const result = await fetchPagedRangeResilient(
    { from: 0, to: all.at(-1).time, limit: all.length },
    '1',
    async (range) => {
      calls.push({ ...range });
      if (calls.length === 2 && !failedOnce) {
        failedOnce = true;
        return [];
      }
      return all.filter((bar) => bar.time <= range.to).slice(-range.limit);
    },
  );

  assert.equal(result.bars.length, all.length);
  assert.equal(new Set(result.bars.map((bar) => bar.time)).size, all.length);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1], calls[2]);
});

test('persistent failed page reports only the successful prefix as covered', async () => {
  const all = barsFrom(12_001);
  let calls = 0;
  const result = await fetchPagedRangeResilient(
    { from: 0, to: all.at(-1).time, limit: all.length },
    '1',
    async (range) => {
      calls += 1;
      if (calls >= 2) return [];
      return all.filter((bar) => bar.time <= range.to).slice(-range.limit);
    },
  );

  assert.equal(result.bars.length, 10_000);
  assert.ok(result.coveredDownTo > 0);
  assert.ok(result.coveredDownTo < all.at(-1).time);
});

test('failed newest page does not claim the requested range is covered', async () => {
  const all = barsFrom(12_001);
  const result = await fetchPagedRangeResilient(
    { from: 0, to: all.at(-1).time, limit: all.length },
    '1',
    async () => [],
  );

  assert.deepEqual(result.bars, []);
  assert.equal(result.coveredDownTo, undefined);
});

test('non-progressing page is retried and does not claim the missing range', async () => {
  const all = barsFrom(12_001);
  let calls = 0;
  const result = await fetchPagedRangeResilient(
    { from: 0, to: all.at(-1).time, limit: all.length },
    '1',
    async (range) => {
      calls += 1;
      if (calls >= 2) {
        // Simulate a gateway returning a valid page from the wrong window.
        return all.slice(-1);
      }
      return all.filter((bar) => bar.time <= range.to).slice(-range.limit);
    },
  );

  assert.equal(result.bars.length, 10_000);
  assert.equal(calls, 4); // first page, then three same-cursor retries
  assert.ok(result.coveredDownTo > 0);
  assert.ok(result.coveredDownTo < all.at(-1).time);
});

test('Vela feed patch preserves the missing range for a later retry', async () => {
  installVelaHistoryResilience();
  const all = barsFrom(12_001);
  let calls = 0;
  let failing = true;
  const inner = {
    async load() { return []; },
    async loadRange(_cfg, range) {
      calls += 1;
      if (failing && calls >= 2) return [];
      return all.filter((bar) => bar.time <= range.to).slice(-range.limit);
    },
  };
  const feed = new CachingDataFeed(inner, new BarStore());
  const bars = await feed.loadRange(
    { symbol: 'binance:BTCUSDT', timeframe: '1' },
    { from: 0, to: all.at(-1).time, limit: all.length },
  );
  assert.equal(bars.length, 10_000);
  // A failed second page must not be reported as covering the requested zero.
  // The next request can therefore ask Vela for the missing head again.
  assert.ok(bars[0].time > 0);

  const beforeRecovery = calls;
  failing = false;
  const recovered = await feed.loadRange(
    { symbol: 'binance:BTCUSDT', timeframe: '1' },
    { from: 0, to: all.at(-1).time, limit: all.length },
  );
  assert.ok(calls > beforeRecovery, 'the failed window must really be re-requested');
  assert.deepEqual(recovered, all);
  const beforeCacheHit = calls;
  assert.deepEqual(await feed.loadRange(
    { symbol: 'binance:BTCUSDT', timeframe: '1' },
    { from: 0, to: all[999].time, limit: 1000 },
  ), all.slice(0, 1000));
  assert.equal(calls, beforeCacheHit, 'a successfully repaired historical range is cacheable');
});

test('an empty newest page cannot make an older cached island look complete', async () => {
  installVelaHistoryResilience();
  const store = new BarStore();
  const key = 'binance|BTCUSDT|1';
  const cached = barsFrom(100).map((bar, index) => ({ ...bar, time: 11_901 * STEP + index * STEP }));
  store.merge(key, cached);
  store.markCovered(key, cached[0].time);
  let calls = 0;
  const provider = {
    __quantToolsHistoryGuard: true,
    __quantToolsContinuousHistory: true,
    __quantToolsHistoryCalendar: 'utc-month',
    async getBars() { calls += 1; return []; },
  };
  const inner = {
    registry: { get(name) { return name === 'binance' ? provider : undefined; } },
    async load() { return []; },
    async loadRange() { throw new Error('unrouted provider load'); },
  };
  const feed = new CachingDataFeed(inner, store);
  const range = { from: 0, to: cached.at(-1).time + STEP, limit: 2_000 };
  const first = await feed.loadRange({ symbol: 'binance:BTCUSDT', timeframe: '1' }, range);
  assert.deepEqual(first, [], 'failed newest page must not return stale cached bars');
  assert.equal(store.coveredFromOf(key), undefined, 'failed newest page must clear its fallback watermark');
  const before = calls;
  await feed.loadRange({ symbol: 'binance:BTCUSDT', timeframe: '1' }, range);
  assert.ok(calls > before, 'the same failed range remains retryable');
});

test('overlapping empty and successful loads keep their own results', async () => {
  installVelaHistoryResilience();
  const all = barsFrom(2_000);
  const store = new BarStore();
  let calls = 0;
  let releaseFirst;
  const first = new Promise(resolve => { releaseFirst = resolve; });
  const provider = {
    __quantToolsHistoryGuard: true,
    __quantToolsContinuousHistory: true,
    __quantToolsHistoryCalendar: 'utc-month',
    async getBars(_ticker, _timeframe, range) {
      calls += 1;
      if (calls === 1) {
        await first;
        return [];
      }
      return all.filter(bar => bar.time <= range.to).slice(-range.limit);
    },
  };
  const inner = {
    registry: { get(name) { return name === 'binance' ? provider : undefined; } },
    async load() { return []; },
    async loadRange() { throw new Error('unrouted provider load'); },
  };
  const feed = new CachingDataFeed(inner, store);
  const cfg = { symbol: 'binance:BTCUSDT', timeframe: '1' };
  const range = { from: all[0].time, to: all.at(-1).time, limit: all.length };
  const emptyLoad = feed.loadRange(cfg, range);
  const successfulLoad = feed.loadRange(cfg, range);
  releaseFirst();
  const [empty, successful] = await Promise.all([emptyLoad, successfulLoad]);
  assert.deepEqual(empty, [], 'the confirmed empty request should stay empty');
  assert.equal(successful.length, all.length, 'the overlapping successful request must survive');
  assert.deepEqual(successful, all);
  assert.ok(calls >= 2);
});

test('history resilience stays idempotent across an HMR-style module reload', async () => {
  installVelaHistoryResilience();
  const methods = ['fetchRange', 'load', 'loadRange', 'loadProgressive'];
  const before = Object.fromEntries(methods.map(method => [method, CachingDataFeed.prototype[method]]));
  const reloaded = await import(`./history-resilience.ts?hmr=${Date.now()}`);
  reloaded.installVelaHistoryResilience();
  for (const method of methods) {
    assert.strictEqual(CachingDataFeed.prototype[method], before[method], `${method} must not be wrapped twice`);
  }
});
