import test from 'node:test';
import assert from 'node:assert/strict';
import { BinanceProvider } from '@luxalgo/vela/providers/binance';
import { HyperliquidProvider } from '@luxalgo/vela/providers/hyperliquid';

import {
  guardProviderHistory,
  normalizeProviderBars,
  normalizeProviderRange,
} from './provider-history.ts';
import { createWorkspaceProviders } from './provider-registry.ts';

test('provider range normalization keeps an inclusive point range', () => {
  assert.deepEqual(
    normalizeProviderRange({ from: 1_000, to: 1_000, limit: 1 }),
    { from: 1_000, to: 1_000, limit: 1 },
  );
  assert.equal(normalizeProviderRange({ from: 2_000, to: 1_000 }), null);
  assert.equal(normalizeProviderRange({ limit: 0 }), null);
  assert.equal(normalizeProviderRange({ limit: 0.5 }), null);
  assert.equal(normalizeProviderRange({ limit: Number.NaN }), null);
});

test('bar normalization bounds, deduplicates, sorts, and limits history', () => {
  const result = normalizeProviderBars([
    { time: 3_000, open: 3, high: 3, low: 3, close: 3, volume: 3 },
    { time: 1_000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    // Latest duplicate wins, even when the provider returns rows out of order.
    { time: 2_000, open: 2, high: 2, low: 2, close: 2, volume: 2 },
    { time: 2_000, open: 20, high: 20, low: 20, close: 20, volume: 20 },
    { time: 4_000, open: 4, high: 4, low: 4, close: 4, volume: 4 },
    { time: 5_000, open: Number.NaN, high: 5, low: 5, close: 5 },
    { time: 6_000, open: 6, high: 6, low: 6, close: 6, volume: Number.NaN },
  ], { from: 1_000, to: 4_000, limit: 2 });

  assert.deepEqual(result, [
    { time: 3_000, open: 3, high: 3, low: 3, close: 3, volume: 3 },
    { time: 4_000, open: 4, high: 4, low: 4, close: 4, volume: 4 },
  ]);

  const point = normalizeProviderBars([
    { time: 9_999, open: 1, high: 1, low: 1, close: 1 },
    { time: 10_000, open: 2, high: 2, low: 2, close: 2 },
  ], { from: 10_000, to: 10_000, limit: 1 });
  assert.deepEqual(point, [{ time: 10_000, open: 2, high: 2, low: 2, close: 2 }]);
});

test('history guard repairs point ranges without changing provider identity', async () => {
  class FakeProvider {
    calls = [];

    async getBars(_ticker, _timeframe, range) {
      this.calls.push({ ...range });
      // Model Binance's zero-width forward-pagination bug.
      if (range.from !== undefined && range.to === range.from) return [];
      return [
        { time: 300, open: 3, high: 3, low: 3, close: 3 },
        { time: 100, open: 1, high: 1, low: 1, close: 1 },
        { time: 200, open: 2, high: 2, low: 2, close: 2 },
      ];
    }
  }

  const provider = guardProviderHistory(new FakeProvider());
  assert.equal(provider.constructor.name, 'FakeProvider');
  await assert.doesNotReject(async () => {
    const bars = await provider.getBars('BTCUSDT', '60', { from: 200, to: 200, limit: 1 });
    assert.deepEqual(bars, [{ time: 200, open: 2, high: 2, low: 2, close: 2 }]);
  });
  assert.deepEqual(provider.calls, [
    { from: 200, to: 200, limit: 1 },
    { from: 200, to: 3_600_199, limit: 1 },
  ]);

  const limited = await provider.getBars('BTCUSDT', '60', { from: 100, to: 300, limit: 2 });
  assert.deepEqual(limited.map((bar) => bar.time), [200, 300]);
  const callCount = provider.calls.length;
  assert.deepEqual(await provider.getBars('BTCUSDT', '60', { from: 300, to: 100 }), []);
  assert.equal(provider.calls.length, callCount);
});

test('point-range recovery keeps the Hyperliquid request window to one candle', async () => {
  class FakeProvider {
    calls = [];

    async getBars(_ticker, _timeframe, range) {
      this.calls.push({ ...range });
      if (range.from === range.to) return [];
      return [{ time: 200, open: 2, high: 2, low: 2, close: 2 }];
    }
  }

  const provider = guardProviderHistory(new FakeProvider());
  const bars = await provider.getBars('BTC', '15', { from: 200, to: 200, limit: 1 });
  assert.deepEqual(bars.map((bar) => bar.time), [200]);
  assert.deepEqual(provider.calls, [
    { from: 200, to: 200, limit: 1 },
    { from: 200, to: 900_199, limit: 1 },
  ]);
});

test('history guard retries a transient page failure before exposing it to Vela', async () => {
  let attempts = 0;
  class FlakyProvider {
    __quantToolsNetworkGuard = true;

    async getBars() {
      attempts += 1;
      if (attempts === 1) throw new Error('HTTP 503');
      return [{ time: 60_000, open: 1, high: 2, low: 1, close: 2 }];
    }
  }

  const provider = new FlakyProvider();
  const bars = await guardProviderHistory(provider).getBars('BTCUSDT', '1m', { limit: 1 });
  assert.deepEqual(bars, [{ time: 60_000, open: 1, high: 2, low: 1, close: 2 }]);
  assert.equal(attempts, 2);
});

test('history guard re-fetches an intraday page gap without fabricating candles', async () => {
  class GappedProvider {
    calls = [];

    async getBars(_ticker, _timeframe, range) {
      this.calls.push({ ...range });
      if (range.from === 120_000 && range.to === 120_000) {
        return [{ time: 120_000, open: 2, high: 3, low: 2, close: 3 }];
      }
      return [
        { time: 60_000, open: 1, high: 2, low: 1, close: 2 },
        { time: 180_000, open: 3, high: 4, low: 3, close: 4 },
      ];
    }
  }

  const provider = new GappedProvider();
  const bars = await guardProviderHistory(provider).getBars('BTCUSDT', '1m', { limit: 3 });
  assert.deepEqual(bars.map((bar) => bar.time), [60_000, 120_000, 180_000]);
  assert.deepEqual(provider.calls[1], { from: 120_000, to: 120_000, limit: 1 });
});

test('history guard expands equal-bound gap repair for forward paginators', async () => {
  const calls = [];
  const provider = guardProviderHistory({
    async getBars(_ticker, _timeframe, range) {
      calls.push({ ...range });
      if (range.from === 60_000 && range.to === 60_000) return [];
      if (range.from === 60_000 && range.to === 119_999) {
        return [{ time: 60_000, open: 1, high: 2, low: 1, close: 2 }];
      }
      return [
        { time: 0, open: 1, high: 2, low: 1, close: 2 },
        { time: 120_000, open: 3, high: 4, low: 3, close: 4 },
      ];
    },
  });
  const bars = await provider.getBars('BTCUSDT', '1m', { limit: 3 });
  assert.deepEqual(bars.map((bar) => bar.time), [0, 60_000, 120_000]);
  assert.deepEqual(calls.slice(-2), [
    { from: 60_000, to: 60_000, limit: 1 },
    { from: 60_000, to: 119_999, limit: 1 },
  ]);
});

test('history guard applies the same gap repair after a 15m timeframe switch', async () => {
  const step = 15 * 60_000;
  let repaired = false;
  const provider = guardProviderHistory({
    async getBars(_ticker, _timeframe, range) {
      if (range.from === step && range.to === step && !repaired) {
        repaired = true;
        return [{ time: step, open: 2, high: 3, low: 2, close: 3 }];
      }
      return [
        { time: 0, open: 1, high: 2, low: 1, close: 2 },
        { time: step * 2, open: 3, high: 4, low: 3, close: 4 },
      ];
    },
  });
  const bars = await provider.getBars('BTCUSDT', '15', { limit: 3 });
  assert.deepEqual(bars.map(bar => bar.time), [0, step, step * 2]);
});

test('history guard leaves a confirmed unresolved gap visible instead of inventing a bar', async () => {
  class SparseProvider {
    async getBars() {
      return [
        { time: 60_000, open: 1, high: 2, low: 1, close: 2 },
        { time: 180_000, open: 3, high: 4, low: 3, close: 4 },
      ];
    }
  }

  const bars = await guardProviderHistory(new SparseProvider()).getBars('BTCUSDT', '1m', { limit: 2 });
  assert.deepEqual(bars.map((bar) => bar.time), [60_000, 180_000]);
});

test('custom providers without a continuous venue contract preserve 2h and 4h session gaps', async () => {
  // Generic third-party providers may contain legitimate closed sessions.
  // The registered Binance/Hyperliquid paths instead declare continuous
  // crypto calendars and are validated at all supported resolutions.
  for (const [timeframe, step] of [
    ['2h', 2 * 60 * 60 * 1_000],
    ['4h', 4 * 60 * 60 * 1_000],
  ]) {
    let calls = 0;
    const provider = guardProviderHistory({
      async getBars() {
        calls += 1;
        return [
          { time: 0, open: 1, high: 2, low: 1, close: 2 },
          // Deliberately omit the middle candle. No repair request is expected
          // for this out-of-scope resolution.
          { time: step * 2, open: 3, high: 4, low: 3, close: 4 },
        ];
      },
    });
    const bars = await provider.getBars('BTCUSDT', timeframe, { limit: 2 });
    assert.deepEqual(bars.map((bar) => bar.time), [0, step * 2]);
    assert.equal(calls, 1, `${timeframe} must not fan out gap repair requests`);
  }
});

test('point-range duration preserves Pine minute/month case semantics', async () => {
  class FakeProvider {
    calls = [];

    async getBars(_ticker, _timeframe, range) {
      this.calls.push({ ...range });
      if (range.from === range.to) return [];
      return [{ time: 1_000, open: 1, high: 1, low: 1, close: 1 }];
    }
  }

  const minute = new FakeProvider();
  await guardProviderHistory(minute).getBars('BTC', '1m', { from: 1_000, to: 1_000, limit: 1 });
  assert.equal(minute.calls[1].to, 60_999);

  const month = new FakeProvider();
  await guardProviderHistory(month).getBars('BTC', '1M', { from: 1_000, to: 1_000, limit: 1 });
  assert.equal(month.calls[1].to, 2_592_000_999);
});

test('guarded Binance and Hyperliquid adapters satisfy the real OHLCV boundary offline', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const point = 1_700_000_000_000;
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const target = String(url);
      if (target.endsWith('/ping')) return { ok: true, json: async () => ({}) };
      if (target.includes('/klines')) {
        return {
          ok: true,
          json: async () => [[
            point, '1', '2', '0.5', '1.5', '10', point + 3_599_999,
            '0', '1', '0', '0', '0',
          ]],
        };
      }
      throw new Error(`unexpected Binance request: ${target}`);
    };
    const binance = guardProviderHistory(new BinanceProvider());
    assert.deepEqual(
      await binance.getBars('BTCUSDT', '60', { from: point, to: point, limit: 1 }),
      [{ time: point, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }],
    );
    assert.equal(calls.filter(({ url }) => url.includes('/klines')).length, 1);

    const hyperCalls = [];
    globalThis.fetch = async (url, options = {}) => {
      hyperCalls.push({ url: String(url), options });
      return {
        ok: true,
        json: async () => Array.from({ length: 4 }, (_, index) => ({
          t: point + index * 3_600_000,
          o: '1', h: '2', l: '0.5', c: String(index + 1), v: '10', s: 'BTC',
        })),
      };
    };
    const hyperliquid = guardProviderHistory(new HyperliquidProvider());
    const ranged = await hyperliquid.getBars('BTC', '60', {
      from: point,
      to: point + 3 * 3_600_000,
      limit: 2,
    });
    assert.deepEqual(ranged.map((bar) => bar.time), [point + 2 * 3_600_000, point + 3 * 3_600_000]);
    assert.equal(hyperCalls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('workspace providers use self-contained local BTC/ETH icons without the remote CDN', () => {
  const providers = createWorkspaceProviders();
  const symbol = { ticker: 'BTCUSDT', provider: 'binance' };
  const binance = providers.binance();
  const hyperliquid = providers.hyperliquid();
  const btc = binance.resolveSymbolIcon?.(symbol);
  assert.match(btc, /^data:image\/svg\+xml/);
  assert.equal(hyperliquid.resolveSymbolIcon?.({ ticker: 'BTC' }), btc);
  const eth = binance.resolveSymbolIcon?.({ ticker: 'ETHUSDT' });
  assert.match(eth, /^data:image\/svg\+xml/);
  assert.equal(hyperliquid.resolveSymbolIcon?.({ ticker: 'ETH' }), eth);
  for (const ticker of ['ETHFIUSDT', 'BTCDOMUSDT', 'BTCSTUSDT', 'SOLUSDT']) {
    assert.equal(binance.resolveSymbolIcon?.({ ticker }), undefined);
  }
});

test('hosts may explicitly opt into the upstream remote symbol-icon resolver', () => {
  const providers = createWorkspaceProviders({ remoteSymbolIcons: true });
  const symbol = { ticker: 'BTCUSDT', provider: 'binance' };
  const icon = providers.binance().resolveSymbolIcon?.(symbol);
  assert.equal(typeof icon, 'string');
  assert.match(icon, /^https?:\/\//);
});

test('Hyperliquid monthly history clamps pre-epoch count windows', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_input, init = {}) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const provider = createWorkspaceProviders({ requestTimeoutMs: 20 }).hyperliquid();
    assert.deepEqual(await provider.getBars('BTC', 'M', { limit: 2_000 }), []);
    const candle = requests.find(request => request.type === 'candleSnapshot');
    assert.ok(candle);
    assert.ok(candle.req.startTime >= 0);
    assert.equal(candle.req.interval, '1M');
  } finally {
    globalThis.fetch = original;
  }
});
