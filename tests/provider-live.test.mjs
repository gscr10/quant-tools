import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspaceProviders } from '../src/integrations/vela/provider-registry.ts';

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
