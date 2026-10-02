import test from 'node:test';
import assert from 'node:assert/strict';
import { enableProviderProgressiveHistory, subscribeProgressiveHistoryRequests,
  supportsProgressiveHistory } from '../src/integrations/vela/provider-progressive.ts';
import { createWorkspaceProviders } from '../src/integrations/vela/provider-registry.ts';

const rows = (count, offset = 1) => Array.from({ length: count }, (_, index) => ({
  time: (index + offset) * 60_000, open: index + offset, high: index + offset + 2,
  low: index + offset - 2, close: index + offset + 1, volume: 10,
}));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function setup(getBars) {
  const provider = enableProviderProgressiveHistory({ getBars });
  const requests = [];
  const stop = subscribeProgressiveHistoryRequests(provider, request => requests.push(request));
  return { provider, requests, stop };
}

test('native progressive: first page paints before second resolves, final OHLCV equals 2000-row baseline', async () => {
  const all = rows(2000);
  const next = deferred();
  const calls = [];
  const fixture = setup(async (ticker, timeframe, range) => {
    calls.push({ ticker, timeframe, ...range });
    return calls.length === 1 ? all.slice(1000) : next.promise;
  });
  const batches = [];
  const result = fixture.provider.getBarsProgressive('BTCUSDT', '15', { limit: 2000 }, bars => batches.push(bars));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(batches, [all.slice(1000)]);
  assert.deepEqual(calls, [
    { ticker: 'BTCUSDT', timeframe: '15', limit: 1000 },
    { ticker: 'BTCUSDT', timeframe: '15', limit: 1000, to: all[1000].time - 1 },
  ]);
  next.resolve(all.slice(0, 1000));
  assert.deepEqual(await result, all);
  assert.deepEqual(batches[1], all);
  assert.deepEqual(await fixture.requests[0].result,
    { error: null, aborted: false, bars: 2000, oldestTime: all[0].time });
  fixture.stop();
});

test('native eligibility preserves unsafe aggregation, shallow/range and >5000 old path', async () => {
  for (const tf of ['1', '15', '60', 'D', 'W', 'M', '4H']) assert.equal(supportsProgressiveHistory(tf, { limit: 2000 }), true);
  for (const tf of ['45', '180', '45m', '3h', 'unknown']) assert.equal(supportsProgressiveHistory(tf, { limit: 2000 }), false);
  const fixture = setup(() => { throw Error('must not fetch'); });
  for (const range of [{ limit: 1000 }, { limit: 5001 }, { limit: 0 }, {}, { limit: NaN }, { limit: 2000, from: 1 }]) {
    assert.equal(await fixture.provider.getBarsProgressive('BTCUSDT', '15', range, () => {}), null);
  }
  assert.equal(fixture.requests.length, 0);
  fixture.stop();
});

test('no history subscriber: capability declines rather than publish unsafe completion', async () => {
  const provider = enableProviderProgressiveHistory({ getBars() { throw Error('not called'); } });
  assert.equal(await provider.getBarsProgressive('BTCUSDT', '15', { limit: 2000 }, () => {}), null);
});

for (const length of [0, 523, 1000, 1523, 2000, 2300]) {
  test(`genesis/last partial page ${length}: exact rows, bounded requests`, async () => {
    const all = rows(length);
    let calls = 0;
    const fixture = setup(async (_, __, range) => {
      calls++;
      return all.filter(bar => range.to === undefined || bar.time <= range.to).slice(-range.limit);
    });
    const actual = await fixture.provider.getBarsProgressive('BTCUSDT.P', '60', { limit: 2300, session: 'regular' }, () => {});
    assert.deepEqual(actual, all);
    // Short final pages perform one bounded genesis probe before being
    // accepted as complete. Exact page boundaries still need only the empty
    // terminating request.
    const expectedCalls = length === 0 ? 1
      : length === 2300 ? 3
        : length % 1000 === 0 ? length / 1000 + 1
          : Math.floor(length / 1000) + 2;
    assert.equal(calls, expectedCalls);
    assert.equal((await fixture.requests[0].result).error, null);
    fixture.stop();
  });
}

test('short page is not treated as genesis when an older candle probe succeeds', async () => {
  const all = rows(1800);
  const calls = [];
  const fixture = setup(async (_, __, range) => {
    calls.push({ ...range });
    // Simulate a provider that returns a short page even though older data
    // exists. The one-row probe must establish that history continues, then
    // the next ordinary page must fill the gap.
    if (calls.length === 1) return all.slice(1300);
    if (range.limit === 1) return all.filter(bar => bar.time <= range.to).slice(-1);
    return all.filter(bar => bar.time <= range.to).slice(-range.limit);
  });
  const batches = [];
  const actual = await fixture.provider.getBarsProgressive('BTCUSDT', '15', { limit: 1500 }, bars => batches.push(bars));
  assert.deepEqual(actual, all.slice(300));
  assert.equal(batches.length, 2);
  assert.equal(calls[1].limit, 1);
  assert.equal(calls[2].limit, 1000);
  assert.equal((await fixture.requests[0].result).bars, 1500);
  fixture.stop();
});

test('genesis probe errors are reported instead of publishing successful completion', async () => {
  const failure = Error('history probe unavailable');
  let calls = 0;
  const fixture = setup(async (_, __, range) => {
    calls++;
    if (calls === 1) return rows(523);
    throw failure;
  });
  const actual = await fixture.provider.getBarsProgressive('BTCUSDT', '15', { limit: 2000 }, () => {});
  assert.deepEqual(actual, rows(523));
  const outcome = await fixture.requests[0].result;
  assert.equal(outcome.error, failure);
  assert.equal(outcome.aborted, false);
  assert.equal(outcome.bars, 523);
  fixture.stop();
});

test('late page failure retains first page and settles error fact before final result', async () => {
  const failure = Error('HTTP 503');
  let calls = 0;
  const head = rows(1000, 1001);
  const fixture = setup(async () => { if (++calls === 1) return head; throw failure; });
  const order = [];
  const unsubscribe = subscribeProgressiveHistoryRequests(fixture.provider, request => {
    void request.result.then(outcome => { assert.equal(outcome.error, failure); order.push('failure'); });
  });
  const result = await fixture.provider.getBarsProgressive('BTCUSDT', '15', { limit: 2000 }, () => {});
  order.push('final');
  assert.deepEqual(result, head);
  assert.deepEqual(order, ['failure', 'final']);
  assert.equal((await fixture.requests[0].result).bars, 1000);
  unsubscribe(); fixture.stop();
});

test('aborted consumer settles promptly; late transport cannot publish or start next page', async () => {
  const pending = deferred();
  let calls = 0, batches = 0;
  const fixture = setup(() => { calls++; return pending.promise; });
  const controller = new AbortController();
  const result = fixture.provider.getBarsProgressive('BTCUSDT', '15', { limit: 2000 }, () => batches++, { signal: controller.signal });
  controller.abort();
  assert.deepEqual(await result, []);
  assert.equal((await fixture.requests[0].result).aborted, true);
  pending.resolve(rows(1000));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(batches, 0);
  fixture.stop();
});

test('abort after first batch retains prefix and stops pagination without touching another consumer', async () => {
  const all = rows(2000);
  const fixture = setup(async (_, __, range) => all.filter(bar => range.to === undefined || bar.time <= range.to).slice(-range.limit));
  const controller = new AbortController();
  const cancelled = fixture.provider.getBarsProgressive('BTCUSDT', '15', { limit: 2000 }, () => controller.abort(), { signal: controller.signal });
  const active = fixture.provider.getBarsProgressive('BTCUSDT', '15', { limit: 2000 }, () => {});
  assert.deepEqual(await cancelled, all.slice(1000));
  assert.deepEqual(await active, all);
  assert.equal((await fixture.requests[0].result).aborted, true);
  assert.equal((await fixture.requests[1].result).aborted, false);
  fixture.stop();
});

test('callbacks cannot mutate retained data; normalization deduplicates and sorts each page', async () => {
  const all = rows(2000);
  const fixture = setup(async (_, __, range) => {
    const page = all.filter(bar => range.to === undefined || bar.time <= range.to).slice(-range.limit);
    return [...page.reverse(), page[0]];
  });
  const actual = await fixture.provider.getBarsProgressive('BTCUSDT', '15', { limit: 2000 }, bars => {
    bars[0].close = -100; bars.length = 0;
  });
  assert.deepEqual(actual, all);
  fixture.stop();
});

test('pre-aborted stream sends no request; thrown callback is a failure, not successful genesis', async () => {
  let calls = 0;
  const fixture = setup(async () => { calls++; return rows(1000); });
  const controller = new AbortController(); controller.abort();
  await fixture.provider.getBarsProgressive('BTCUSDT', '15', { limit: 2000 }, () => {}, { signal: controller.signal });
  assert.equal(calls, 0);
  const failure = Error('renderer failed');
  await fixture.provider.getBarsProgressive('BTCUSDT', '15', { limit: 2000 }, () => { throw failure; });
  assert.equal((await fixture.requests[1].result).error, failure);
  fixture.stop();
});

test('bundled Binance swallowed HTTP 503 remains explicit progressive failure with visible prefix', async () => {
  const original = globalThis.fetch;
  const head = rows(1000, 1001);
  const urls = [];
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.pathname.endsWith('/ping')) return new Response('{}');
    assert.match(url.pathname, /\/klines$/);
    urls.push(url);
    if (urls.length > 1) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify(head.map(bar => [bar.time, String(bar.open), String(bar.high),
      String(bar.low), String(bar.close), String(bar.volume), bar.time + 59_999])));
  };
  const provider = enableProviderProgressiveHistory(createWorkspaceProviders().binance());
  const requests = [];
  const stop = subscribeProgressiveHistoryRequests(provider, request => requests.push(request));
  try {
    const actual = await provider.getBarsProgressive('BTCUSDT', '15', { limit: 2000 }, () => {});
    assert.deepEqual(actual, head);
    // The guarded transport retries the failing page on Binance.US. It must
    // not restart the first page or extend the requested historical boundary.
    assert.equal(urls.length, 3);
    assert.equal(urls[1].searchParams.get('endTime'), String(head[0].time - 1));
    assert.equal(urls[2].searchParams.get('endTime'), String(head[0].time - 1));
    assert.equal(urls[2].hostname, 'api.binance.us');
    assert.match(String((await requests[0].result).error), /HTTP 503/);
  } finally { stop(); globalThis.fetch = original; }
});
