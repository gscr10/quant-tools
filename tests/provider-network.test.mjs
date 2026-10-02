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
    const url = 'https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=BTCUSDT';
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

test('Binance does not mirror a non-retryable futures response to a spot host', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      return jsonResponse({ code: 0, msg: 'restricted' }, 451);
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 15 }).binance();
    await assert.rejects(provider.getBars('BTCUSDT.P', '15', { limit: 1 }), /HTTP 451/);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0]).hostname, 'fapi.binance.com');
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
    ]);
    assert.ok(calls.length > failedCalls, 'a failed cached enumeration must be retried');
    const successfulCalls = calls.length;
    assert.deepEqual(await provider.listSymbols(), symbols);
    assert.equal(calls.length, successfulCalls, 'successful enumeration remains cached');
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
