import test from 'node:test';
import assert from 'node:assert/strict';
import { BarStore, MultiProviderFeed } from '@luxalgo/vela';
import { guardProviderHistory } from '../src/integrations/vela/provider-history.ts';
import { installVelaHistoryResilience } from '../src/integrations/vela/history-resilience.ts';

installVelaHistoryResilience();

const STEP = 60_000;
const CFG = { symbol: 'binance:BTCUSDT', timeframe: '1' };
const KEY = 'binance|BTCUSDT|1';
const rows = count => Array.from({ length: count }, (_, index) => ({
  time: index * STEP, open: 100 + index, high: 102 + index,
  low: 99 + index, close: 101 + index, volume: 10,
}));
const slice = (all, range) => {
  const bounded = all.filter(bar => (range.from === undefined || bar.time >= range.from)
    && (range.to === undefined || bar.time <= range.to));
  return range.limit === undefined ? bounded : bounded.slice(-range.limit);
};
async function setup(getBars, kind = 'binance') {
  const store = new BarStore();
  const feed = new MultiProviderFeed(store);
  const calls = [];
  const provider = guardProviderHistory({
    async getBars(ticker, timeframe, range) {
      calls.push({ ticker, timeframe, ...range });
      return getBars(ticker, timeframe, range);
    },
  }, kind ?? undefined);
  await feed.registerProvider('binance', provider);
  return { feed, store, calls };
}

test('real registry/cache keeps a failed single-page range uncached and refetches on retry', async () => {
  const all = rows(500);
  const failure = new Error('HTTP 503');
  let failed = true;
  const { feed, store, calls } = await setup((_, __, range) => {
    if (failed) throw failure;
    return slice(all, range);
  });
  const range = { from: 0, to: all.at(-1).time, limit: all.length };
  await assert.rejects(feed.loadRange(CFG, range), error => error === failure);
  assert.equal(store.get(KEY), undefined);
  assert.equal(store.coveredFromOf(KEY), undefined);
  const failedCalls = calls.length;
  failed = false;
  assert.deepEqual(await feed.loadRange(CFG, range), all);
  assert.ok(calls.length > failedCalls);
  const recoveredCalls = calls.length;
  assert.deepEqual(await feed.loadRange(CFG, { from: 0, to: all[99].time, limit: 100 }), all.slice(0, 100));
  assert.equal(calls.length, recoveredCalls);
  feed.destroy();
});

test('real registry/cache does not commit successful pages preceding a persistent deep failure', async () => {
  const all = rows(25_001);
  let failed = true;
  const failure = new Error('request timeout');
  const { feed, store, calls } = await setup((_, __, range) => {
    if (failed && range.to < all[15_001].time) throw failure;
    return slice(all, range);
  });
  const range = { from: 0, to: all.at(-1).time, limit: all.length };
  await assert.rejects(feed.loadRange(CFG, range), error => error === failure);
  assert.equal(calls.length, 2);
  assert.equal(store.get(KEY), undefined);
  assert.equal(store.coveredFromOf(KEY), undefined);
  failed = false;
  const before = calls.length;
  assert.deepEqual(await feed.loadRange(CFG, range), all);
  assert.equal(calls.length - before, 3);
  assert.equal(store.coveredFromOf(KEY), 0);
  assert.deepEqual(store.get(KEY), all.slice(0, -1));
  feed.destroy();
});

test('a count-limited tail does not mark its earlier requested lower bound as fetched', async () => {
  const all = rows(1000);
  const { feed, store, calls } = await setup((_, __, range) => slice(all, range));
  const partial = await feed.loadRange(CFG, { from: 0, to: all.at(-1).time, limit: 100 });
  assert.deepEqual(partial, all.slice(-100));
  assert.equal(store.coveredFromOf(KEY), all[900].time);
  const before = calls.length;
  assert.deepEqual(await feed.loadRange(CFG, { from: 0, to: all[800].time, limit: 801 }), all.slice(0, 801));
  assert.ok(calls.length > before, 'the unrequested early history must be fetched');
  feed.destroy();
});

test('individually continuous large pages repair their missing join before cache coverage', async () => {
  const all = rows(20_005);
  const { feed, store, calls } = await setup((_, __, range) => {
    const candidates = range.from === undefined
      ? all.filter(bar => bar.time < 10_000 * STEP || bar.time >= 10_005 * STEP)
      : all;
    return slice(candidates, range);
  });
  const received = await feed.loadRange(CFG, { from: 0, to: all.at(-1).time, limit: all.length });
  assert.deepEqual(received, all);
  assert.ok(calls.some(call => call.from === 10_000 * STEP && call.to === 10_004 * STEP && call.limit === 5));
  assert.equal(store.coveredFromOf(KEY), 0);
  feed.destroy();
});

test('an unresolved join never enters cache and later recovery actually fetches all missing candles', async () => {
  const all = rows(20_005);
  let missing = true;
  const { feed, store, calls } = await setup((_, __, range) => slice(
    missing ? all.filter(bar => bar.time < 10_000 * STEP || bar.time >= 10_005 * STEP) : all,
    range,
  ));
  const range = { from: 0, to: all.at(-1).time, limit: all.length };
  await assert.rejects(feed.loadRange(CFG, range), { name: 'HistoryGapError' });
  assert.equal(store.get(KEY), undefined);
  assert.equal(store.coveredFromOf(KEY), undefined);
  assert.ok(calls.length <= 4, 'persistent holes must have a bounded repair budget');
  const failedCalls = calls.length;
  missing = false;
  assert.deepEqual(await feed.loadRange(CFG, range), all);
  assert.ok(calls.length > failedCalls);
  assert.deepEqual(store.get(KEY), all.slice(0, -1));
  feed.destroy();
});

test('a previously poisoned cached range is invalidated without touching another cell series', async () => {
  const all = rows(1000);
  const { feed, store, calls } = await setup((_, __, range) => slice(all, range));
  store.merge(KEY, [...all.slice(0, 400), ...all.slice(405)]);
  store.markCovered(KEY, 0);
  const otherKey = 'binance|ETHUSDT|5';
  const otherBars = rows(10);
  store.merge(otherKey, otherBars);
  store.markCovered(otherKey, 0);
  assert.deepEqual(await feed.loadRange(CFG, { from: 0, to: all[800].time, limit: 801 }), all.slice(0, 801));
  assert.ok(calls.length > 0, 'historical cache hit must not bypass continuity validation');
  assert.deepEqual(store.get(otherKey), otherBars);
  assert.equal(store.coveredFromOf(otherKey), 0);
  feed.destroy();
});

test('separate old and new requested windows do not create false coverage across their unrequested join', async () => {
  const all = rows(1000);
  const { feed, store, calls } = await setup((_, __, range) => slice(all, range));
  await feed.loadRange(CFG, { from: all[800].time, to: all.at(-1).time, limit: 200 });
  assert.deepEqual(await feed.loadRange(CFG, { from: 0, to: all[99].time, limit: 100 }), all.slice(0, 100));
  assert.equal(store.coveredFromOf(KEY), undefined);
  const before = calls.length;
  assert.deepEqual(await feed.loadRange(CFG, { from: 0, to: all.at(-1).time, limit: all.length }), all);
  assert.ok(calls.length > before);
  assert.equal(store.coveredFromOf(KEY), 0);
  feed.destroy();
});

test('confirmed listing boundary and entirely empty markets terminate without retry loops', async () => {
  const listed = rows(300).slice(100);
  const { feed, store, calls } = await setup((_, __, range) => slice(listed, range));
  assert.deepEqual(await feed.loadRange(CFG, { from: 0, to: listed.at(-1).time, limit: 20_000 }), listed);
  assert.equal(calls.length, 2, 'one real page and one confirmed pre-listing empty page');
  assert.equal(store.coveredFromOf(KEY), 0);
  feed.destroy();
  const empty = await setup(() => []);
  assert.deepEqual(await empty.feed.loadRange(CFG, { from: 0, to: 1000 * STEP, limit: 20_000 }), []);
  assert.equal(empty.calls.length, 1);
  empty.feed.destroy();
});

test('session-based custom feeds retain legitimate calendar gaps', async () => {
  const day = 86_400_000;
  const all = rows(6).map((bar, index) => ({ ...bar, time: [0, 1, 2, 5, 6, 7][index] * day }));
  const { feed, store } = await setup((_, __, range) => slice(all, range), null);
  const cfg = { ...CFG, timeframe: 'D', session: 'regular' };
  assert.deepEqual(await feed.loadRange(cfg, { from: 0, to: all.at(-1).time, limit: 6 }), all);
  assert.deepEqual(store.get('binance|BTCUSDT|D'), all.slice(0, -1));
  feed.destroy();
});

test('Hyperliquid 30-day monthly history remains continuous through cache validation and hits', async () => {
  const month=30*86_400_000,start=Date.UTC(2026,0,7);
  const all=rows(6).map((bar,index)=>({...bar,time:start+index*month}));
  const {feed,store,calls}=await setup((_,__,range)=>slice(all,range),'hyperliquid');
  const cfg={symbol:'binance:BTC',timeframe:'M'};
  // Registry route name is deliberately not used to infer the venue calendar.
  assert.deepEqual(await feed.loadRange(cfg,{from:start,to:all.at(-1).time,limit:6}),all);
  const count=calls.length;
  assert.deepEqual(await feed.loadRange(cfg,{from:start,to:all[3].time,limit:4}),all.slice(0,4));
  assert.equal(calls.length,count,'valid month cache must not be evicted as a February gap');
  assert.deepEqual(store.get('binance|BTC|M'),all.slice(0,-1));
  feed.destroy();
});
