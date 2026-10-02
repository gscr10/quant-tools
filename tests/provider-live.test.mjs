import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspaceProviders } from '../src/integrations/vela/provider-registry.ts';
import { guardProviderSubscription } from '../src/integrations/vela/provider-live.ts';

const POINT = 1_700_000_000_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  };
}

test('provider polling drops a bar that resolves after unsubscribe', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalWebSocket = globalThis.WebSocket;

  try {
    // Force the provider's no-WebSocket polling path and make its first poll
    // immediate. Network latency remains real enough to race unsubscribe.
    globalThis.WebSocket = undefined;
    let firstPoll = true;
    let activeProvider = 'hyperliquid';
    globalThis.setTimeout = (callback, timeout, ...args) => originalSetTimeout(
      callback,
      timeout === 3_000 && firstPoll ? (firstPoll = false, 0) : timeout,
      ...args,
    );
    globalThis.fetch = async () => new Promise((resolve) => originalSetTimeout(() => {
      const body = activeProvider === 'hyperliquid'
        ? [{ t: POINT, o: '1', h: '2', l: '0.5', c: '1.5', v: '1', s: 'BTC' }]
        : [[POINT, '1', '2', '0.5', '1.5', '1', POINT + 60_000, '0', '1', '0', '0', '0']];
      resolve(jsonResponse(body));
    }, 40));

    for (const [kind, ticker, makeProvider] of [
      ['hyperliquid', 'BTC', (providers) => providers.hyperliquid()],
      ['binance', 'BTCUSDT', (providers) => providers.binance()],
    ]) {
      activeProvider = kind;
      firstPoll = true;
      const provider = makeProvider(createWorkspaceProviders({ requestTimeoutMs: 1_000 }));
      let callbacks = 0;
      const unsubscribe = provider.subscribe(ticker, '45', () => {
        callbacks += 1;
      });
      await delay(5);
      unsubscribe();
      await delay(80);
      assert.equal(callbacks, 0, `${kind} delivered after unsubscribe`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('Hyperliquid late onopen cannot recreate a ping interval after unsubscribe', () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  let socket;
  let intervalCount = 0;
  let clearedCount = 0;

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.closed = false;
      socket = this;
    }

    send(message) {
      this.sent.push(message);
    }

    close() {
      this.closed = true;
    }
  }

  try {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.setInterval = () => {
      intervalCount += 1;
      return { intervalCount };
    };
    globalThis.clearInterval = () => {
      clearedCount += 1;
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 1_000 }).hyperliquid();
    const unsubscribe = provider.subscribe('BTC', '15', () => {});
    unsubscribe();

    // Simulate a browser handshake completing after chart teardown.
    socket.onopen?.({ type: 'open' });
    assert.deepEqual(socket.sent, []);
    assert.equal(intervalCount, 0);
    assert.equal(clearedCount, 0);
    assert.equal(socket.closed, true);
  } finally {
    globalThis.WebSocket = originalWebSocket;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('Hyperliquid active onopen still subscribes and is cleaned up once', () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  let socket;
  let intervalHandle;
  let cleared;

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      socket = this;
    }

    send(message) {
      this.sent.push(message);
    }

    close() {
      this.closed = true;
    }
  }

  try {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.setInterval = () => {
      intervalHandle = {};
      return intervalHandle;
    };
    globalThis.clearInterval = (handle) => {
      cleared = handle;
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 1_000 }).hyperliquid();
    const unsubscribe = provider.subscribe('BTC', '15', () => {});
    socket.onopen?.({ type: 'open' });

    assert.equal(socket.sent.length, 1);
    assert.match(socket.sent[0], /"type":"candle"/);
    assert.equal(intervalHandle !== undefined, true);

    unsubscribe();
    assert.equal(cleared, intervalHandle);
  } finally {
    globalThis.WebSocket = originalWebSocket;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('Binance async first socket remains guarded until unsubscribe', async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Set();
  let socket;
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.closed = false;
      socket = this;
    }
    close() { this.closed = true; }
  }

  try {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.setTimeout = (callback, timeout, ...args) => {
      const handle = originalSetTimeout(() => {
        timers.delete(handle);
        callback(...args);
      }, timeout);
      timers.add(handle);
      return handle;
    };
    globalThis.clearTimeout = (handle) => {
      timers.delete(handle);
      return originalClearTimeout(handle);
    };
    const provider = createWorkspaceProviders({ requestTimeoutMs: 1_000 }).binance();
    const unsubscribe = provider.subscribe('BTCUSDT', '15', () => {});
    // Binance resolves the spot endpoint asynchronously before constructing
    // its first socket. The constructor seam must remain installed across
    // that await, otherwise a late first socket escapes lifecycle guarding.
    assert.notEqual(globalThis.WebSocket, originalWebSocket);
    for (let attempt = 0; attempt < 20 && !socket; attempt += 1) {
      await new Promise((resolve) => originalSetTimeout(resolve, 0));
    }
    assert.ok(socket);
    unsubscribe();
    assert.equal(globalThis.WebSocket, FakeWebSocket);
    assert.equal(socket.closed, true);
  } finally {
    for (const handle of timers) originalClearTimeout(handle);
    globalThis.WebSocket = originalWebSocket;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('Hyperliquid reconnect socket is guarded when unsubscribe races reconnect', async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalSetInterval = globalThis.setInterval;
  const sockets = [];
  let intervalCount = 0;

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.closed = false;
      sockets.push(this);
    }
    send(message) { this.sent.push(message); }
    close() { this.closed = true; }
  }

  try {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.setTimeout = (callback, timeout, ...args) => {
      // Keep the reconnect deterministic, while preventing the provider's
      // 15s silent-stream watchdog from keeping this unit test alive.
      if (timeout === 15_000) return { cancelled: false };
      return originalSetTimeout(callback, timeout === 2_000 ? 0 : timeout, ...args);
    };
    globalThis.clearTimeout = (handle) => {
      if (handle && typeof handle === 'object' && 'cancelled' in handle) {
        handle.cancelled = true;
        return;
      }
      return originalClearTimeout(handle);
    };
    globalThis.setInterval = () => {
      intervalCount += 1;
      return { intervalCount };
    };

    const provider = createWorkspaceProviders({ requestTimeoutMs: 1_000 }).hyperliquid();
    const unsubscribe = provider.subscribe('BTC', '15', () => {});
    assert.equal(sockets.length, 1);
    sockets[0].onclose?.();
    await new Promise((resolve) => originalSetTimeout(resolve, 5));
    assert.equal(sockets.length, 2);

    unsubscribe();
    sockets[1].onopen?.({ type: 'open' });
    assert.deepEqual(sockets[1].sent, []);
    assert.equal(intervalCount, 0);
    assert.equal(sockets[1].closed, true);
  } finally {
    globalThis.WebSocket = originalWebSocket;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.setInterval = originalSetInterval;
  }
});

test('Binance delayed spot endpoint keeps a late socket guarded after unsubscribe', async () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalSetTimeout = globalThis.setTimeout;
  let resolveEndpoint;
  let socket;
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.closed = false;
      socket = this;
    }
    close() { this.closed = true; }
  }
  const provider = {
    spotWsBase: () => new Promise((resolve) => { resolveEndpoint = resolve; }),
    subscribe(_ticker, _timeframe, _onBar) {
      void (async () => {
        await this.spotWsBase();
        // Deliberately omit the upstream closed check: this models the
        // adversarial await/constructor ordering the guard must contain.
        const ws = new WebSocket('wss://late.example');
        ws.onopen = () => { throw new Error('late onopen escaped guard'); };
      })();
      return () => {};
    },
  };

  try {
    globalThis.WebSocket = FakeWebSocket;
    const guarded = guardProviderSubscription(provider, 'binance');
    const unsubscribe = guarded.subscribe('BTCUSDT', '15', () => {});
    await Promise.resolve();
    unsubscribe();
    assert.notEqual(globalThis.WebSocket, FakeWebSocket);
    resolveEndpoint('wss://stream.example');
    await new Promise((resolve) => originalSetTimeout(resolve, 0));
    await new Promise((resolve) => originalSetTimeout(resolve, 0));
    assert.ok(socket);
    socket.onopen?.({ type: 'open' });
    assert.equal(socket.closed, true);
    assert.equal(globalThis.WebSocket, FakeWebSocket);
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test('nested live subscriptions restore the native WebSocket in release order', () => {
  const originalWebSocket = globalThis.WebSocket;
  const sockets = [];
  class FakeWebSocket {
    constructor(url) { this.url = url; sockets.push(this); }
    close() { this.closed = true; }
  }
  const provider = {
    subscribe(_ticker, _timeframe, _onBar) {
      const ws = new WebSocket('wss://nested.example');
      ws.onopen = () => {};
      return () => ws.close();
    },
  };
  try {
    globalThis.WebSocket = FakeWebSocket;
    const guarded = guardProviderSubscription(provider, 'hyperliquid');
    const first = guarded.subscribe('A', '15', () => {});
    const second = guarded.subscribe('B', '15', () => {});
    assert.equal(sockets.length, 2);
    first();
    // The second lease remains installed while the first lease is gone.
    assert.notEqual(globalThis.WebSocket, FakeWebSocket);
    second();
    assert.equal(globalThis.WebSocket, FakeWebSocket);
    first(); second();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});
