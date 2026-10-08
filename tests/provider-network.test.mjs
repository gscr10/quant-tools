import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiProviderFeed } from '@luxalgo/vela';

import {
  createWorkspaceProviders,
  guardProviderIndex,
} from '../src/integrations/vela/provider-registry.ts';

const POINT = 1_700_000_000_000;

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  };
}

function stalledFetch(signal, observedSignals) {
  observedSignals.push(signal);
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

test('workspace defaults bound provider network and symbol-index paths', () => {
  const providers = createWorkspaceProviders();
  const binance = providers.binance();
  const hyperliquid = providers.hyperliquid();
  const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  // All overrides are own, non-enumerable methods on these fresh instances;
  // the upstream prototypes and provider identities remain untouched.
  assert.equal(owns(binance, 'json'), true);
  assert.equal(owns(binance, 'listSymbols'), true);
  assert.equal(owns(hyperliquid, 'post'), true);
  assert.equal(owns(hyperliquid, 'listSymbols'), true);
  assert.equal(binance.__quantToolsNetworkGuard, true);
  assert.equal(hyperliquid.__quantToolsNetworkGuard, true);
});

test('Binance aggregates 45m and 180m from aligned native candles with exact newest-tail limits', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const makeRows = (step, count) => {
    const bucket = step * 3;
    const start = POINT - (POINT % bucket);
    return Array.from({ length: count }, (_, index) => {
      const time = start + index * step;
      const open = index + 1;
      return [time, String(open), String(open + 10), String(open - 1), String(open + 5), String(100 + index), time + step - 1];
    });
  };
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      const interval = url.searchParams.get('interval');
      if (interval === '15m') return jsonResponse(makeRows(15 * 60_000, 18));
      if (interval === '1h') return jsonResponse(makeRows(60 * 60_000, 18));
      throw new Error(`unexpected interval: ${interval}`);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 100 }).binance();
    const fortyFive = await provider.getBars('BTCUSDT', '45', { limit: 5 });
    const oneEighty = await provider.getBars('BTCUSDT', '180', { limit: 5 });

    assert.equal(fortyFive.length, 5);
    assert.equal(oneEighty.length, 5);
    // 18 native candles form 6 buckets; limit=5 must retain the newest five,
    // rather than returning the first five or leaking the extra source row.
    assert.equal(fortyFive[0].open, 4);
    assert.equal(fortyFive.at(-1).close, 23);
    assert.equal(oneEighty[0].open, 4);
    assert.equal(oneEighty.at(-1).close, 23);
    assert.deepEqual(calls.map((value) => new URL(value).searchParams.get('interval')), ['15m', '1h']);
    assert.equal(new URL(calls[0]).searchParams.get('limit'), '18');
    assert.equal(new URL(calls[1]).searchParams.get('limit'), '18');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance shares one in-flight JSON request but does not cache the settled response', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let release;
  let settled = false;
  try {
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      if (settled) return jsonResponse({ ok: true });
      await new Promise((resolve) => { release = resolve; });
      settled = true;
      return jsonResponse({ ok: true });
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 100 }).binance();
    const url = 'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=1';
    const first = provider.json(url);
    const second = provider.json(url);
    assert.equal(calls.length, 1, 'concurrent identical requests should share transport');
    release();
    assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);

    const third = provider.json(url);
    release();
    await third;
    assert.equal(calls.length, 2, 'settled responses must not become a long-lived cache');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance metadata responses use a bounded TTL cache and expire cleanly', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const calls = [];
  let now = 10_000;
  Date.now = () => now;
  try {
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return jsonResponse({ symbols: [{ symbol: `BTCUSDT${calls.length}` }] });
    };
    const provider = createWorkspaceProviders({ metadataCacheTtlMs: 1_000 }).binance();
    const url = 'https://api.binance.com/api/v3/exchangeInfo?symbol=BTCUSDT';
    assert.deepEqual(await provider.json(url), { symbols: [{ symbol: 'BTCUSDT1' }] });
    assert.deepEqual(await provider.json(url), { symbols: [{ symbol: 'BTCUSDT1' }] });
    assert.equal(calls.length, 1);
    now += 1_001;
    assert.deepEqual(await provider.json(url), { symbols: [{ symbol: 'BTCUSDT2' }] });
    assert.equal(calls.length, 2);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});

test('metadata TTL cache isolates callers from mutable nested symbol snapshots', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return jsonResponse({ symbols: [{ symbol: 'BTCUSDT', filters: [{ minQty: '0.001' }] }] });
    };
    const provider = createWorkspaceProviders({ metadataCacheTtlMs: 10_000 }).binance();
    const url = 'https://api.binance.com/api/v3/exchangeInfo';
    const first = provider.json(url);
    const second = provider.json(url);
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls.length, 1, 'concurrent metadata reads should share one transport');
    a.symbols[0].filters[0].minQty = '999';
    a.symbols.push({ symbol: 'INJECTED' });
    assert.equal(b.symbols[0].filters[0].minQty, '0.001');
    assert.equal(b.symbols.length, 1);

    const cached = await provider.json(url);
    assert.equal(cached.symbols[0].filters[0].minQty, '0.001');
    assert.equal(cached.symbols.length, 1);
    assert.equal(calls.length, 1, 'the unmodified cached snapshot should still be reusable');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('metadata cache fails closed when a response cannot be cloned', async () => {
  const originalFetch = globalThis.fetch;
  const originalClone = globalThis.structuredClone;
  let calls = 0;
  try {
    // Force both clone paths to fail: JSON cannot serialize BigInt and the
    // host clone seam is deliberately unavailable/broken.
    globalThis.structuredClone = () => { throw new Error('clone unavailable'); };
    globalThis.fetch = async () => {
      calls += 1;
      return jsonResponse({ symbols: [{ symbol: 'BTCUSDT', opaque: 1n }] });
    };
    const provider = createWorkspaceProviders({ metadataCacheTtlMs: 10_000 }).binance();
    const url = 'https://api.binance.com/api/v3/exchangeInfo';
    await assert.rejects(provider.json(url), /Provider JSON payload could not be safely cloned/);
    await assert.rejects(provider.json(url), /Provider JSON payload could not be safely cloned/);
    assert.equal(calls, 2, 'uncloneable metadata must not enter the TTL cache');
  } finally {
    globalThis.structuredClone = originalClone;
    globalThis.fetch = originalFetch;
  }
});

test('metadata cache can be disabled without changing request semantics', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return jsonResponse({ symbols: [{ symbol: `BTCUSDT${calls.length}` }] });
    };
    const provider = createWorkspaceProviders({ metadataCacheTtlMs: 0 }).binance();
    const url = 'https://api.binance.com/api/v3/exchangeInfo?symbol=BTCUSDT';
    await provider.json(url);
    await provider.json(url);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('disabling metadata TTL still isolates concurrent consumers', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let release;
  try {
    globalThis.fetch = async () => {
      calls.push(true);
      await new Promise((resolve) => { release = resolve; });
      return jsonResponse({ symbols: [{ symbol: 'BTCUSDT', filters: [{ minQty: '0.001' }] }] });
    };
    const provider = createWorkspaceProviders({ metadataCacheTtlMs: 0 }).binance();
    const url = 'https://api.binance.com/api/v3/exchangeInfo';
    const first = provider.json(url);
    const second = provider.json(url);
    assert.equal(calls.length, 1, 'concurrent metadata reads should still deduplicate transport');
    release();
    const [a, b] = await Promise.all([first, second]);
    a.symbols[0].filters[0].minQty = '999';
    assert.equal(b.symbols[0].filters[0].minQty, '0.001');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('concurrent non-metadata JSON responses are isolated per consumer', async () => {
  const originalFetch = globalThis.fetch;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  try {
    globalThis.fetch = async () => {
      await pending;
      return jsonResponse([[1_700_000_000_000, '1', '2', '0', '1.5', '10']]);
    };
    const provider = createWorkspaceProviders({ metadataCacheTtlMs: 0 }).binance();
    const url = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=1';
    const first = provider.json(url);
    const second = provider.json(url);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.notStrictEqual(a, b);
    assert.notStrictEqual(a[0], b[0]);
    a[0][1] = 'mutated';
    a.push(['extra']);
    assert.equal(b[0][1], '1');
    assert.equal(b.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uncloneable non-metadata JSON fails closed and can retry', async () => {
  const originalFetch = globalThis.fetch;
  const originalClone = globalThis.structuredClone;
  let calls = 0;
  try {
    globalThis.structuredClone = () => { throw new Error('clone unavailable'); };
    globalThis.fetch = async () => {
      calls += 1;
      return jsonResponse([[POINT, 1n, 2, 0, 1, 10]]);
    };
    const provider = createWorkspaceProviders({ metadataCacheTtlMs: 0 }).binance();
    const url = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=1';
    await assert.rejects(provider.json(url), /Provider JSON payload could not be safely cloned/);
    await assert.rejects(provider.json(url), /Provider JSON payload could not be safely cloned/);
    assert.equal(calls, 2, 'a failed payload clone must clear in-flight state for retry');
  } finally {
    globalThis.structuredClone = originalClone;
    globalThis.fetch = originalFetch;
  }
});

test('Binance request dedupe is scoped by URL and failed requests can retry', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let phase = 0;
  let release;
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (phase === 0 && url === firstUrl) {
        await new Promise((resolve) => { release = resolve; });
        return jsonResponse({ error: true }, 400);
      }
      return jsonResponse({ url });
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 100 }).binance();
    const firstUrl = 'https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=BTCUSDT';
    const secondUrl = 'https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=ETHUSDT';
    const failedOne = provider.json(firstUrl);
    const failedTwo = provider.json(firstUrl);
    const different = provider.json(secondUrl);
    assert.equal(calls.length, 2, 'different URLs must not share a request');
    release();
    await assert.rejects(failedOne, /HTTP 400/);
    await assert.rejects(failedTwo, /HTTP 400/);
    assert.deepEqual(await different, { url: secondUrl });

    phase = 1;
    assert.deepEqual(await provider.json(firstUrl), { url: firstUrl });
    assert.equal(calls.filter((url) => url === firstUrl).length, 2,
      'a failed request must be removed so a later caller can retry');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Hyperliquid shares semantically identical concurrent POST bodies', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let release;
  try {
    globalThis.fetch = async (input, init = {}) => {
      calls.push({ url: String(input), body: init.body });
      await new Promise((resolve) => { release = resolve; });
      return jsonResponse([{ ok: true }]);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 100 }).hyperliquid();
    const first = provider.post({ type: 'meta', coin: 'BTC', nested: { z: 1, a: true } });
    const second = provider.post({ nested: { a: true, z: 1 }, coin: 'BTC', type: 'meta' });
    assert.equal(calls.length, 1, 'equivalent bodies should share one Hyperliquid POST');
    release();
    assert.deepEqual(await Promise.all([first, second]), [[{ ok: true }], [{ ok: true }]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('concurrent Hyperliquid JSON responses are isolated per consumer', async () => {
  const originalFetch = globalThis.fetch;
  let release;
  try {
    globalThis.fetch = async () => {
      await new Promise((resolve) => { release = resolve; });
      return jsonResponse({ universe: [{ name: 'BTC', szDecimals: 5 }], nested: { active: true } });
    };
    const provider = createWorkspaceProviders({ requestTimeoutMs: 100 }).hyperliquid();
    const first = provider.post({ type: 'meta' });
    const second = provider.post({ type: 'meta' });
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.notStrictEqual(a, b);
    a.universe[0].name = 'MUTATED';
    a.nested.active = false;
    assert.equal(b.universe[0].name, 'BTC');
    assert.equal(b.nested.active, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('identical requests on separate provider instances never share transport', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return jsonResponse({ ok: true });
    };
    const first = createWorkspaceProviders({ requestTimeoutMs: 100 }).binance();
    const second = createWorkspaceProviders({ requestTimeoutMs: 100 }).binance();
    const url = 'https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=BTCUSDT';
    await Promise.all([first.json(url), second.json(url)]);
    assert.equal(calls.length, 2, 'provider instances must have isolated in-flight maps');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance aborts a stalled global request and recovers through the US mirror', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const signals = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/ping')) return jsonResponse({});
      if (url.startsWith('https://api.binance.com/api/v3/klines')) {
        return stalledFetch(init.signal, signals);
      }
      if (url.startsWith('https://api.binance.us/api/v3/klines')) {
        return jsonResponse([[
          POINT, '1', '2', '0.5', '1.5', '10', POINT + 899_999,
          '0', '1', '0', '0', '0',
        ]]);
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 20 }).binance();
    const bars = await provider.getBars('BTCUSDT', '15', { limit: 1 });

    assert.equal(provider.constructor.name, 'BinanceProvider');
    assert.deepEqual(bars, [{
      time: POINT,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 10,
    }]);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].aborted, true);
    const mirror = calls.find((url) => url.startsWith('https://api.binance.us/api/v3/klines'));
    assert.ok(mirror, calls);
    assert.match(mirror, /symbol=BTCUSDT/);
    assert.match(mirror, /interval=15m/);
    assert.match(mirror, /limit=1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance remembers the mirror that served the first successful request', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const kline = [[
    POINT, '1', '2', '0.5', '1.5', '10', POINT + 899_999,
    '0', '1', '0', '0', '0',
  ]];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://api.binance.com/api/v3/klines')) {
        return stalledFetch(init.signal, []);
      }
      if (url.startsWith('https://api.binance.us/api/v3/klines')) {
        return jsonResponse(kline);
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 15 }).binance();
    assert.equal((await provider.getBars('BTCUSDT', '15', { limit: 1 })).length, 1);
    assert.equal((await provider.getBars('BTCUSDT', '15', { limit: 1 })).length, 1);

    assert.deepEqual(calls.map((url) => new URL(url).hostname), [
      'api.binance.com',
      'api.binance.us',
      'api.binance.us',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance falls back to the US host when global access is region blocked', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const kline = [[
    POINT, '1', '2', '0.5', '1.5', '10', POINT + 899_999,
    '0', '1', '0', '0', '0',
  ]];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://api.binance.com/api/v3/klines')) {
        return jsonResponse({ code: 0, msg: 'Service unavailable from a restricted location' }, 451);
      }
      if (url.startsWith('https://api.binance.us/api/v3/klines')) {
        return jsonResponse(kline);
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 15 }).binance();
    assert.equal((await provider.getBars('BTCUSDT', '15', { limit: 1 })).length, 1);
    assert.deepEqual(calls.map((url) => new URL(url).hostname), [
      'api.binance.com',
      'api.binance.us',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance invalidates a cached mirror when a symbol is unavailable and recovers globally', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let phase = 0;
  const kline = [[
    POINT, '1', '2', '0.5', '1.5', '10', POINT + 899_999,
    '0', '1', '0', '0', '0',
  ]];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://api.binance.com/api/v3/klines')) {
        if (phase === 0) throw new TypeError('global route unavailable');
        return jsonResponse(kline);
      }
      if (url.startsWith('https://api.binance.us/api/v3/klines')) {
        if (phase === 1) return jsonResponse({ code: -1121, msg: 'Invalid symbol.' }, 400);
        return jsonResponse(kline);
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 15 }).binance();
    // Seed the cached US endpoint after global transport failure.
    assert.equal((await provider.getBars('BTCUSDT', '15', { limit: 1 })).length, 1);
    phase = 1;
    // The cached US endpoint fails, so this request must recover globally.
    assert.equal((await provider.getBars('BTCUSDT', '15', { limit: 1 })).length, 1);
    phase = 2;
    // The successful global fallback is now cached and should be used directly.
    assert.equal((await provider.getBars('BTCUSDT', '15', { limit: 1 })).length, 1);

    assert.deepEqual(calls.map((url) => new URL(url).hostname), [
      'api.binance.com',
      'api.binance.us',
      'api.binance.us',
      'api.binance.com',
      'api.binance.com',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance futures falls back from a region-blocked fapi host to the web edge', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const kline = [[
    POINT, '1', '2', '0.5', '1.5', '10', POINT + 3_599_999,
    '0', '1', '0', '0', '0',
  ]];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://fapi.binance.com/fapi/v1/klines')) {
        return jsonResponse({ code: 0, msg: 'restricted' }, 451);
      }
      if (url.startsWith('https://www.binance.com/fapi/v1/klines')) {
        return jsonResponse(kline);
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 15 }).binance();
    assert.equal((await provider.getBars('BTCUSDT.P', '60', { limit: 1 })).length, 1);
    assert.equal((await provider.getBars('BTCUSDT.P', '240', { limit: 1 })).length, 1);
    assert.deepEqual(calls.map((url) => [new URL(url).hostname, new URL(url).searchParams.get('interval')]), [
      ['fapi.binance.com', '1h'],
      ['www.binance.com', '1h'],
      ['www.binance.com', '4h'],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance futures keeps the dedicated fapi host when its first request succeeds', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const kline = [[
    POINT, '1', '2', '0.5', '1.5', '10', POINT + 3_599_999,
    '0', '1', '0', '0', '0',
  ]];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://fapi.binance.com/fapi/v1/klines')) return jsonResponse(kline);
      throw new Error(`unexpected request: ${url}`);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 15 }).binance();
    assert.equal((await provider.getBars('BTCUSDT.P', '60', { limit: 1 })).length, 1);
    assert.equal((await provider.getBars('BTCUSDT.P', '240', { limit: 1 })).length, 1);
    assert.deepEqual(calls.map((url) => new URL(url).hostname), [
      'fapi.binance.com',
      'fapi.binance.com',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance futures shares one fapi-to-web-edge fallback for concurrent 1h requests', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let release;
  const kline = [[
    POINT, '1', '2', '0.5', '1.5', '10', POINT + 3_599_999,
    '0', '1', '0', '0', '0',
  ]];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://fapi.binance.com/fapi/v1/klines')) {
        return jsonResponse({ code: 0, msg: 'restricted' }, 451);
      }
      if (url.startsWith('https://www.binance.com/fapi/v1/klines')) {
        await new Promise((resolve) => { release = resolve; });
        return jsonResponse(kline);
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 100 }).binance();
    const first = provider.getBars('BTCUSDT.P', '60', { limit: 1 });
    const second = provider.getBars('BTCUSDT.P', '60', { limit: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    release?.();
    const [one, two] = await Promise.all([first, second]);
    assert.equal(one.length, 1);
    assert.equal(two.length, 1);
    assert.deepEqual(calls.map((url) => new URL(url).hostname), [
      'fapi.binance.com',
      'www.binance.com',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance futures preserves a terminal 400 without probing the web edge', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      return jsonResponse({ code: -1121, msg: 'Invalid symbol.' }, 400);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 15 }).binance();
    await assert.rejects(provider.getBars('DOESNOTEXIST.P', '60', { limit: 1 }), /HTTP 400/);
    assert.deepEqual(calls.map((url) => new URL(url).hostname), ['fapi.binance.com']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance futures surfaces web-edge failure after a region-blocked fapi response', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      return jsonResponse({ code: 0, msg: 'restricted' }, 451);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 15 }).binance();
    await assert.rejects(provider.getBars('BTCUSDT.P', '240', { limit: 1 }), /HTTP 451/);
    assert.deepEqual(calls.map((url) => new URL(url).hostname), [
      'fapi.binance.com',
      'www.binance.com',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance futures forgets a web edge that fails after being cached', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let phase = 0;
  const kline = [[
    POINT, '1', '2', '0.5', '1.5', '10', POINT + 3_599_999,
    '0', '1', '0', '0', '0',
  ]];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      const host = new URL(url).hostname;
      if (host === 'fapi.binance.com') {
        if (phase === 2) return jsonResponse(kline);
        return jsonResponse({ code: 0, msg: 'restricted' }, 451);
      }
      if (host === 'www.binance.com') {
        if (phase === 1) return jsonResponse({ code: 0, msg: 'restricted' }, 451);
        return jsonResponse(kline);
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 15 }).binance();
    assert.equal((await provider.getBars('BTCUSDT.P', '60', { limit: 1 })).length, 1);
    phase = 1;
    await assert.rejects(provider.getBars('BTCUSDT.P', '60', { limit: 1 }), /HTTP 451/);
    phase = 2;
    assert.equal((await provider.getBars('BTCUSDT.P', '60', { limit: 1 })).length, 1);
    assert.deepEqual(calls.map((url) => new URL(url).hostname), [
      'fapi.binance.com',
      'www.binance.com',
      'www.binance.com',
      'fapi.binance.com',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance spot endpoint probing is bounded before the first history request', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const signals = [];
  try {
    globalThis.fetch = (input, init = {}) => {
      calls.push(String(input));
      signals.push(init.signal);
      return stalledFetch(init.signal, []);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 20 }).binance();
    const started = performance.now();
    await assert.rejects(provider.getBars('BTCUSDT', '15', { limit: 1 }), /timed out/);
    const elapsed = performance.now() - started;

    assert.deepEqual(calls, [
      'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=1',
      'https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=1',
    ]);
    assert.ok(signals.every((signal) => signal?.aborted));
    assert.ok(elapsed < 500, `bounded spot load took ${elapsed}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Hyperliquid aborts a stalled snapshot without doubling the outage wait', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const signals = [];
  try {
    globalThis.fetch = (input, init = {}) => {
      calls.push({ url: String(input), init });
      return stalledFetch(init.signal, signals);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 20 }).hyperliquid();
    const started = performance.now();
    await assert.rejects(provider.getBars('BTC', '15', { limit: 1 }), /timed out/);
    const elapsed = performance.now() - started;

    assert.equal(provider.constructor.name, 'HyperliquidProvider');
    assert.equal(calls.length, 1);
    assert.ok(calls.every(({ url }) => url === 'https://api.hyperliquid.xyz/info'));
    assert.ok(calls.every(({ init }) => init.method === 'POST'));
    assert.ok(calls.every(({ init }) => JSON.parse(init.body).type === 'candleSnapshot'));
    assert.ok(signals.every((signal) => signal.aborted));
    assert.ok(elapsed < 1_000, `stalled provider took ${elapsed}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Hyperliquid retries one quick transient transport failure', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      calls.push({ url: String(input), init });
      if (calls.length === 1) throw new TypeError('connection reset');
      return jsonResponse([{
        t: POINT,
        o: '1',
        h: '2',
        l: '0.5',
        c: '1.5',
        v: '10',
        s: 'BTC',
      }]);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 20 }).hyperliquid();
    const bars = await provider.getBars('BTC', '15', { limit: 1 });

    assert.equal(calls.length, 2);
    assert.deepEqual(bars, [{
      time: POINT,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 10,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider index fallback keeps a bare default symbol resolvable after enumeration failure', async () => {
  const failing = {
    getBars: async () => [],
    listSymbols: async () => {
      throw new Error('exchange index unavailable');
    },
  };
  const guarded = guardProviderIndex(failing, 'binance');
  assert.deepEqual(await guarded.listSymbols(), [{
    ticker: 'BTCUSDT',
    description: 'BTC / USDT',
    type: 'crypto',
  }]);

  const empty = guardProviderIndex({
    getBars: async () => [],
    listSymbols: async () => [],
  }, 'hyperliquid');
  assert.deepEqual(await empty.listSymbols(), [{
    ticker: 'BTC',
    description: 'BTC / USD Perpetual',
    type: 'futures',
  }]);

  const healthy = guardProviderIndex({
    getBars: async () => [],
    listSymbols: async () => [{ ticker: 'ETHUSDT', type: 'crypto' }],
  }, 'binance');
  assert.deepEqual(await healthy.listSymbols(), [{ ticker: 'ETHUSDT', type: 'crypto' }]);
});

test('provider metadata index is reused within its TTL and refreshed after expiry', async () => {
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  let calls = 0;
  const provider = guardProviderIndex({
    getBars: async () => [],
    listSymbols: async () => [{ ticker: `ETH${++calls}`, type: 'crypto' }],
  }, 'binance', { metadataCacheTtlMs: 1_000 });
  try {
    assert.deepEqual(await provider.listSymbols(), [{ ticker: 'ETH1', type: 'crypto' }]);
    assert.deepEqual(await provider.listSymbols(), [{ ticker: 'ETH1', type: 'crypto' }]);
    assert.equal(calls, 1);
    now += 1_001;
    assert.deepEqual(await provider.listSymbols(), [{ ticker: 'ETH2', type: 'crypto' }]);
    assert.equal(calls, 2);
  } finally {
    Date.now = originalNow;
  }
});

test('provider metadata index cache can be disabled without stale picker results', async () => {
  let calls = 0;
  const provider = guardProviderIndex({
    getBars: async () => [],
    listSymbols: async () => [{ ticker: `ETH${++calls}`, type: 'crypto' }],
  }, 'binance', { metadataCacheTtlMs: 0 });

  assert.deepEqual(await provider.listSymbols(), [{ ticker: 'ETH1', type: 'crypto' }]);
  assert.deepEqual(await provider.listSymbols(), [{ ticker: 'ETH2', type: 'crypto' }]);
  assert.equal(calls, 2);
});

test('provider metadata cache is instance-local and failed indexes are never cached', async () => {
  let calls = 0;
  const create = () => ({
    getBars: async () => [],
    listSymbols: async () => {
      calls += 1;
      if (calls === 1) throw new Error('metadata unavailable');
      return [{ ticker: 'ETHUSDT', type: 'crypto' }];
    },
  });
  const first = guardProviderIndex(create(), 'binance');
  assert.deepEqual(await first.listSymbols(), [{ ticker: 'BTCUSDT', description: 'BTC / USDT', type: 'crypto' }]);
  assert.deepEqual(await first.listSymbols(), [{ ticker: 'ETHUSDT', type: 'crypto' }]);
  const second = guardProviderIndex(create(), 'binance');
  assert.deepEqual(await second.listSymbols(), [{ ticker: 'ETHUSDT', type: 'crypto' }]);
  assert.equal(calls, 3);
});

test('provider index returns the default symbol before a stalled exchange index settles', async () => {
  const stalled = {
    getBars: async () => [],
    listSymbols: () => new Promise(() => {}),
  };
  const started = performance.now();
  const guarded = guardProviderIndex(stalled, 'binance', { indexTimeoutMs: 20 });
  const symbols = await guarded.listSymbols();
  const elapsed = performance.now() - started;

  assert.deepEqual(symbols, [{
    ticker: 'BTCUSDT',
    description: 'BTC / USDT',
    type: 'crypto',
  }]);
  assert.ok(elapsed < 500, `stalled index took ${elapsed}ms`);
});

test('provider index promotes a late healthy result and notifies recovery once', async () => {
  let calls = 0;
  let releaseFirst;
  const firstResult = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const provider = {
    getBars: async () => [],
    listSymbols: () => {
      calls += 1;
      return firstResult;
    },
  };
  let recovered = 0;
  let recoveredProvider;

  const guarded = guardProviderIndex(provider, 'binance', {
    indexTimeoutMs: 20,
    onIndexRecovered: (kind, value) => {
      assert.equal(kind, 'binance');
      recovered += 1;
      recoveredProvider = value;
    },
  });
  assert.deepEqual(await guarded.listSymbols(), [{
    ticker: 'BTCUSDT',
    description: 'BTC / USDT',
    type: 'crypto',
  }]);

  releaseFirst([{ ticker: 'ETHUSDT', description: 'ETH / USDT', type: 'crypto' }]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(await guarded.listSymbols(), [{
    ticker: 'ETHUSDT',
    description: 'ETH / USDT',
    type: 'crypto',
  }]);
  assert.equal(calls, 1, 'a merely slow response must not be duplicated');
  assert.equal(recovered, 1);
  assert.equal(recoveredProvider, guarded);
});

test('an explicit retry supersedes a timed-out index that never settles', async () => {
  let calls = 0;
  const never = new Promise(() => {});
  const provider = {
    symbolsPromise: null,
    getBars: async () => [],
    listSymbols() {
      if (!this.symbolsPromise) {
        calls += 1;
        this.symbolsPromise = calls === 1
          ? never
          : Promise.resolve([{ ticker: 'ETHUSDT', description: 'ETH / USDT', type: 'crypto' }]);
      }
      return this.symbolsPromise;
    },
  };
  let recovered = 0;
  const guarded = guardProviderIndex(provider, 'binance', {
    indexTimeoutMs: 20,
    onIndexRecovered: () => {
      recovered += 1;
    },
  });

  assert.equal((await guarded.listSymbols())[0].ticker, 'BTCUSDT');
  // Models the workspace's public `online` probe.  It must start a new
  // upstream attempt instead of racing the permanently pending Promise again.
  assert.equal((await guarded.listSymbols())[0].ticker, 'ETHUSDT');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);
  assert.equal(recovered, 1);
});

test('a superseded timed-out index cannot overwrite its newer successful retry', async () => {
  let calls = 0;
  let releaseOld;
  const old = new Promise((resolve) => {
    releaseOld = resolve;
  });
  const provider = {
    symbolsPromise: null,
    getBars: async () => [],
    listSymbols() {
      if (!this.symbolsPromise) {
        calls += 1;
        this.symbolsPromise = calls === 1
          ? old
          : Promise.resolve([{ ticker: 'ETHUSDT', description: 'ETH / USDT', type: 'crypto' }]);
      }
      return this.symbolsPromise;
    },
  };
  let recovered = 0;
  const guarded = guardProviderIndex(provider, 'binance', {
    indexTimeoutMs: 20,
    onIndexRecovered: () => {
      recovered += 1;
    },
  });

  assert.equal((await guarded.listSymbols())[0].ticker, 'BTCUSDT');
  assert.equal((await guarded.listSymbols())[0].ticker, 'ETHUSDT');
  releaseOld([{ ticker: 'STALE', description: 'Stale old index', type: 'crypto' }]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal((await guarded.listSymbols())[0].ticker, 'ETHUSDT');
  assert.equal(calls, 2);
  assert.equal(recovered, 1);
});

test('provider index clears a cached rejected promise before retrying', async () => {
  let calls = 0;
  const provider = {
    symbolsPromise: null,
    listSymbols() {
      if (!this.symbolsPromise) {
        calls += 1;
        this.symbolsPromise = calls === 1
          ? Promise.reject(new Error('enumeration unavailable'))
          : Promise.resolve([{ ticker: 'ETHUSDT', description: 'ETH / USDT', type: 'crypto' }]);
      }
      return this.symbolsPromise;
    },
    getBars: async () => [],
  };
  const guarded = guardProviderIndex(provider, 'binance', { indexTimeoutMs: 20 });

  assert.deepEqual(await guarded.listSymbols(), [{
    ticker: 'BTCUSDT',
    description: 'BTC / USDT',
    type: 'crypto',
  }]);
  assert.deepEqual(await guarded.listSymbols(), [{
    ticker: 'ETHUSDT',
    description: 'ETH / USDT',
    type: 'crypto',
  }]);
  assert.equal(calls, 2);
});

test('provider index clears Binance-like empty cache and preserves a later success', async () => {
  let calls = 0;
  const provider = {
    symbolsPromise: null,
    listSymbols() {
      if (!this.symbolsPromise) {
        calls += 1;
        this.symbolsPromise = Promise.resolve(calls === 1
          ? []
          : [{ ticker: 'ETHUSDT', description: 'ETH / USDT', type: 'crypto' }]);
      }
      return this.symbolsPromise;
    },
    getBars: async () => [],
  };
  const guarded = guardProviderIndex(provider, 'binance', { indexTimeoutMs: 20 });

  assert.equal((await guarded.listSymbols())[0].ticker, 'BTCUSDT');
  assert.equal((await guarded.listSymbols())[0].ticker, 'ETHUSDT');
  // A successful non-empty result is retained; it must not trigger another
  // upstream request on subsequent picker opens.
  assert.equal((await guarded.listSymbols())[0].ticker, 'ETHUSDT');
  assert.equal(calls, 2);
});

test('provider index starts a fresh recovery episode after a later outage', async () => {
  let calls = 0;
  const recovered = [];
  const provider = guardProviderIndex({
    listSymbols: async () => {
      calls += 1;
      if (calls === 2 || calls === 4) throw new Error('temporary index outage');
      return [{ ticker: calls === 1 ? 'ETHUSDT' : 'BTCUSDT', type: 'crypto' }];
    },
    getBars: async () => [],
  }, 'binance', {
    metadataCacheTtlMs: 0,
    onIndexRecovered: (_kind, value) => recovered.push(value),
  });

  assert.equal((await provider.listSymbols())[0].ticker, 'ETHUSDT');
  assert.equal((await provider.listSymbols())[0].ticker, 'BTCUSDT');
  await new Promise((resolve) => setTimeout(resolve, 0));
  // The second call entered fallback and the queued retry recovered it.
  assert.equal(recovered.length, 1);

  assert.equal((await provider.listSymbols())[0].ticker, 'BTCUSDT');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await provider.listSymbols())[0].ticker, 'BTCUSDT');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(recovered.length, 2, 'a later outage must re-register recovery');
});

test('provider index rejects malformed descriptors instead of indexing an empty ticker', async () => {
  const provider = guardProviderIndex({
    listSymbols: async () => [{ description: 'missing ticker' }],
    getBars: async () => [],
  }, 'hyperliquid', { onIndexRecovered: () => {} });

  assert.deepEqual(await provider.listSymbols(), [{
    ticker: 'BTC', description: 'BTC / USD Perpetual', type: 'futures',
  }]);
});

test('provider index trims descriptor ticker boundaries without changing spaced symbols', async () => {
  const provider = guardProviderIndex({
    listSymbols: async () => [
      { ticker: '  BTCUSDT  ', type: 'crypto' },
      { ticker: 'Nasdaq 100', type: 'index' },
    ],
    getBars: async () => [],
  }, 'binance', { metadataCacheTtlMs: 0 });

  assert.deepEqual(await provider.listSymbols(), [
    { ticker: 'BTCUSDT', type: 'crypto' },
    { ticker: 'Nasdaq 100', type: 'index' },
  ]);
});

test('provider index without a recovery callback can recover after a later outage', async () => {
  let calls = 0;
  const provider = guardProviderIndex({
    listSymbols: async () => {
      calls += 1;
      if (calls === 2) throw new Error('temporary index outage');
      return [{ ticker: calls === 1 ? 'ETHUSDT' : 'BTCUSDT', type: 'crypto' }];
    },
    getBars: async () => [],
  }, 'binance', { metadataCacheTtlMs: 0 });

  assert.equal((await provider.listSymbols())[0].ticker, 'ETHUSDT');
  assert.equal((await provider.listSymbols())[0].ticker, 'BTCUSDT');
  assert.equal((await provider.listSymbols())[0].ticker, 'BTCUSDT');
});

test('provider index keeps a late Hyperliquid metadata result and notifies recovery', async () => {
  let calls = 0;
  let releaseFirst;
  const first = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const provider = {
    symbolsPromise: null,
    metaPromise: null,
    spotMetaPromise: null,
    listSymbols() {
      if (!this.symbolsPromise) {
        calls += 1;
        this.metaPromise = calls === 1 ? first : Promise.resolve({});
        this.spotMetaPromise = calls === 1 ? first : Promise.resolve({});
        this.symbolsPromise = calls === 1
          ? first
          : Promise.resolve([{ ticker: 'ETH', description: 'ETH / USD Perpetual', type: 'futures' }]);
      }
      return this.symbolsPromise;
    },
    getBars: async () => [],
  };
  let recovered = 0;
  const guarded = guardProviderIndex(provider, 'hyperliquid', {
    indexTimeoutMs: 20,
    onIndexRecovered: () => {
      recovered += 1;
    },
  });

  assert.deepEqual(await guarded.listSymbols(), [{
    ticker: 'BTC',
    description: 'BTC / USD Perpetual',
    type: 'futures',
  }]);
  releaseFirst([{ ticker: 'ETH', description: 'ETH / USD Perpetual', type: 'futures' }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await guarded.listSymbols())[0].ticker, 'ETH');
  assert.equal(calls, 1);
  assert.equal(recovered, 1);
});

test('late provider recovery rebuilds the Vela registry through public re-registration', async () => {
  let release;
  const slowSymbols = new Promise((resolve) => {
    release = resolve;
  });
  const provider = {
    getBars: async () => [],
    listSymbols: () => slowSymbols,
  };
  const feed = new MultiProviderFeed();
  let resolveRecovery;
  const recoveryDone = new Promise((resolve) => {
    resolveRecovery = resolve;
  });
  const guarded = guardProviderIndex(provider, 'binance', {
    indexTimeoutMs: 20,
    onIndexRecovered: (kind, recoveredProvider) => {
      void feed.registerProvider(kind, recoveredProvider).then(resolveRecovery);
    },
  });

  await feed.registerProvider('binance', guarded);
  assert.deepEqual(feed.resolveSymbol('BTCUSDT'), {
    provider: 'binance',
    ticker: 'BTCUSDT',
  });
  assert.equal(feed.resolveSymbol('ETHUSDT'), null);

  release([{ ticker: 'ETHUSDT', description: 'ETH / USDT', type: 'crypto' }]);
  await recoveryDone;
  assert.deepEqual(feed.resolveSymbol('ETHUSDT'), {
    provider: 'binance',
    ticker: 'ETHUSDT',
  });
  feed.destroy();
});

test('an explicit connectivity retry can recover after startup and background attempts fail', async () => {
  let calls = 0;
  const provider = {
    symbolsPromise: null,
    getBars: async () => [],
    listSymbols() {
      if (!this.symbolsPromise) {
        calls += 1;
        this.symbolsPromise = Promise.resolve(calls < 3
          ? []
          : [{ ticker: 'ETHUSDT', description: 'ETH / USDT', type: 'crypto' }]);
      }
      return this.symbolsPromise;
    },
  };
  let recovered = 0;
  const guarded = guardProviderIndex(provider, 'binance', {
    indexTimeoutMs: 20,
    onIndexRecovered: () => {
      recovered += 1;
    },
  });

  assert.equal((await guarded.listSymbols())[0].ticker, 'BTCUSDT');
  // The guard's single bounded background retry consumes attempt two.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);

  // This is the same public listSymbols probe used by the workspace `online`
  // listener; success promotes the full cache and triggers registry refresh.
  assert.equal((await guarded.listSymbols())[0].ticker, 'ETHUSDT');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 3);
  assert.equal(recovered, 1);
});

test('bundled Binance listSymbols retries after its rejected cache settles', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let phase = 0;
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (phase === 0) throw new TypeError('exchange unavailable');
      if (url.includes('/exchangeInfo')) {
        if (url.includes('fapi.binance.com')) {
          return jsonResponse({ symbols: [{
            symbol: 'BTCUSDT',
            contractType: 'PERPETUAL',
            status: 'TRADING',
            baseAsset: 'BTC',
            quoteAsset: 'USDT',
          }, {
            symbol: 'XAUUSDT',
            contractType: 'TRADIFI_PERPETUAL',
            status: 'TRADING',
            baseAsset: 'XAU',
            quoteAsset: 'USDT',
          }] });
        }
        return jsonResponse({ symbols: [{
          symbol: 'ETHUSDT',
          status: 'TRADING',
          baseAsset: 'ETH',
          quoteAsset: 'USDT',
        }] });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 10, indexTimeoutMs: 100 }).binance();
    assert.deepEqual(await provider.listSymbols(), [{
      ticker: 'BTCUSDT',
      description: 'BTC / USDT',
      type: 'crypto',
    }]);
    const failedCalls = calls.length;

    phase = 1;
    const symbols = await provider.listSymbols();
    assert.deepEqual(symbols, [
      { ticker: 'ETHUSDT', description: 'ETH / USDT', type: 'crypto' },
      { ticker: 'BTCUSDT.P', description: 'BTC / USDT Perpetual', type: 'futures' },
      { ticker: 'XAUUSDT.P', description: 'XAU / USDT Perpetual', type: 'futures' },
    ]);
    assert.ok(calls.length > failedCalls, 'a failed cached enumeration must be retried');
    const successfulCalls = calls.length;
    assert.deepEqual(await provider.listSymbols(), symbols);
    assert.equal(calls.length, successfulCalls, 'successful enumeration remains cached');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Binance exposes TradFi perpetual metadata through the futures symbol info path', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://fapi.binance.com/fapi/v1/exchangeInfo') {
        return jsonResponse({ symbols: [{
          symbol: 'XAUUSDT',
          contractType: 'TRADIFI_PERPETUAL',
          status: 'TRADING',
          baseAsset: 'XAU',
          quoteAsset: 'USDT',
          filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }],
        }] });
      }
      throw new Error(`unexpected request: ${url}`);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 100 }).binance();
    const info = await provider.getSymbolInfo('XAUUSDT.P');

    assert.deepEqual(info, {
      ticker: 'XAUUSDT.P',
      tickerid: 'BINANCE:XAUUSDT.P',
      prefix: 'BINANCE',
      description: 'XAU / USDT Perpetual',
      type: 'futures',
      basecurrency: 'XAU',
      currency: 'USDT',
      mintick: 0.01,
      pricescale: 100,
      timezone: 'Etc/UTC',
      session: '24x7',
    });
    assert.deepEqual(calls, ['https://fapi.binance.com/fapi/v1/exchangeInfo']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bundled Hyperliquid listSymbols retries after cached meta promises fail', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let phase = 0;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, body: JSON.parse(init.body) });
      if (phase === 0) throw new TypeError('info unavailable');
      const type = JSON.parse(init.body).type;
      if (type === 'meta') {
        return jsonResponse({ universe: [{ name: 'BTC', isDelisted: false }] });
      }
      if (type === 'spotMeta') return jsonResponse({ universe: [], tokens: [] });
      throw new Error(`unexpected request type: ${type}`);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 10, indexTimeoutMs: 100 }).hyperliquid();
    assert.deepEqual(await provider.listSymbols(), [{
      ticker: 'BTC',
      description: 'BTC / USD Perpetual',
      type: 'futures',
    }]);
    const failedCalls = calls.length;

    phase = 1;
    assert.deepEqual(await provider.listSymbols(), [{
      ticker: 'BTC',
      description: 'BTC / USD Perpetual',
      type: 'futures',
    }]);
    assert.ok(calls.length > failedCalls, 'failed meta/spotMeta caches must be retried');
    const successfulCalls = calls.length;
    await provider.listSymbols();
    assert.equal(calls.length, successfulCalls, 'successful metadata remains cached');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Vela feed reaches getBars instead of parking a bare symbol after index failure', async () => {
  const calls = [];
  const provider = guardProviderIndex({
    getBars: async (...args) => {
      calls.push(args);
      return [];
    },
    listSymbols: async () => {
      throw new Error('exchange index unavailable');
    },
  }, 'binance');
  const feed = new MultiProviderFeed();
  await feed.registerProvider('binance', provider);

  const bars = await Promise.race([
    feed.load({ symbol: 'BTCUSDT', timeframe: '15', bars: 1 }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('bare symbol stayed parked')), 250)),
  ]);

  assert.deepEqual(bars, []);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['BTCUSDT', '15', { limit: 1, session: undefined }]);
  feed.destroy();
});

test('multi-provider symbol search keeps venue ownership and explicit routing', async () => {
  const requests = [];
  const feed = new MultiProviderFeed();
  await feed.registerProvider('binance', guardProviderIndex({
    listSymbols: async () => [
      { ticker: 'BTCUSDT', description: 'BTC / USDT', type: 'crypto' },
      { ticker: 'ETHUSDT', description: 'ETH / USDT', type: 'crypto' },
    ],
    getBars: async (ticker) => {
      requests.push(`binance:${ticker}`);
      return [];
    },
  }, 'binance'));
  await feed.registerProvider('hyperliquid', guardProviderIndex({
    listSymbols: async () => [{ ticker: 'BTC', description: 'BTC / USD Perpetual', type: 'futures' }],
    getBars: async (ticker) => {
      requests.push(`hyperliquid:${ticker}`);
      return [];
    },
  }, 'hyperliquid'));

  const pool = feed.symbols();
  assert.deepEqual(pool.map((symbol) => `${symbol.provider}:${symbol.ticker}`), [
    'binance:BTCUSDT', 'binance:ETHUSDT', 'hyperliquid:BTC',
  ]);
  assert.equal(feed.resolveSymbol('BTCUSDT')?.provider, 'binance');
  assert.equal(feed.resolveSymbol('BTC')?.provider, 'hyperliquid');
  assert.equal(feed.resolveSymbol('binance:ETHUSDT')?.provider, 'binance');
  assert.equal(feed.resolveSymbol('hyperliquid:BTC')?.provider, 'hyperliquid');

  await feed.load({ symbol: 'binance:ETHUSDT', timeframe: '15', bars: 1 });
  await feed.load({ symbol: 'hyperliquid:BTC', timeframe: '15', bars: 1 });
  assert.deepEqual(requests, ['binance:ETHUSDT', 'hyperliquid:BTC']);
  feed.destroy();
});
