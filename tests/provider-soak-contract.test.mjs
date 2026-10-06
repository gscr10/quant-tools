import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const fixture = await readFile(new URL('./fixtures/provider-smoke.html', import.meta.url), 'utf8');
const source = fixture
  .match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]
  ?.replace(/^\s*import .*?;\s*$/m, '') ?? '';
assert.ok(source, 'provider smoke fixture module must be present');

const bars = () => [
  { time: Date.now() - 900_000, open: 1, high: 2, low: 1, close: 1.5 },
  { time: Date.now(), open: 1.5, high: 2.5, low: 1.25, close: 2 },
];

function loadFixture(createWorkspaceProviders) {
  const window = {};
  vm.runInNewContext(source, {
    window,
    createWorkspaceProviders,
    setTimeout,
    clearTimeout,
    Date,
    Number,
    Math,
    Error,
    Promise,
    Object,
    String,
    console,
  }, { filename: 'provider-smoke.html' });
  return window;
}

function provider({ callback = true, historyDelay = 0, historyError = null, counters }) {
  return {
    getBars: async (_symbol, timeframe) => {
      if (historyDelay) await new Promise(resolve => setTimeout(resolve, historyDelay));
      if (historyError && timeframe === '15') throw new Error(historyError);
      return bars();
    },
    getSymbolInfo: async () => ({ type: 'futures' }),
    subscribe: (_symbol, _timeframe, onBar) => {
      counters.subscriptions += 1;
      counters.callbacks ??= [];
      counters.callbacks.push(onBar);
      if (callback) onBar(bars()[1]);
      return () => { counters.unsubscriptions += 1; };
    },
  };
}

test('recovery probe validates bars and records callbacks delivered while offline', () => {
  const counters = { subscriptions: 0, unsubscriptions: 0, callbacks: [] };
  const page = loadFixture(providerRegistry(() => provider({ counters })));
  page.beginProviderRecovery('binance');
  assert.equal(page.providerRecoveryState().bars.length, 1);
  page.setProviderRecoveryOnline(false);
  counters.callbacks[0]({ time: 3, open: 2, high: 3, low: 2, close: 2.5 });
  assert.equal(page.providerRecoveryState().offlineBars, 1);
  page.setProviderRecoveryOnline(true);
  page.endProviderRecovery();
  assert.equal(counters.subscriptions, counters.unsubscriptions);
});

function providerRegistry(makeProvider) {
  return () => ({
    binance: makeProvider,
    hyperliquid: makeProvider,
  });
}

test('soak publishes live evidence and bounded freshness fields', async () => {
  const counters = { subscriptions: 0, unsubscriptions: 0 };
  const page = loadFixture(providerRegistry(() => provider({ counters })));
  const result = await page.runProviderSoak(300);
  for (const name of ['binance', 'hyperliquid']) {
    const state = result.subscriptions[name];
    assert.ok(state.liveCallbacks >= 1);
    assert.equal(typeof state.firstLiveAt, 'number');
    assert.equal(typeof state.lastLiveAt, 'number');
    assert.ok(state.maxGapMs >= 0);
  }
  assert.equal(result.binance.live, true);
  assert.equal(result.hyperliquid.live, true);
  assert.equal(counters.subscriptions, counters.unsubscriptions);
});

test('silent subscriptions fail closed and are not hidden by round retry', async () => {
  let factoryCalls = 0;
  const counters = { subscriptions: 0, unsubscriptions: 0 };
  const page = loadFixture(providerRegistry(() => {
    factoryCalls += 1;
    return provider({ callback: false, counters });
  }));
  await assert.rejects(
    page.runProviderSoak(20),
    /no live callbacks|fresh live evidence/,
  );
  // One attempt creates spot, Hyperliquid and two futures instances. A continuity
  // failure must not silently start two replacement attempts.
  assert.equal(factoryCalls, 4);
  assert.equal(counters.subscriptions, 2);
  assert.equal(counters.subscriptions, counters.unsubscriptions);
});

test('late setup after a failed sibling cannot leak a subscription', async () => {
  const counters = { subscriptions: 0, unsubscriptions: 0 };
  const page = loadFixture(providerRegistry(() => provider({
    counters,
    historyDelay: 30,
    historyError: 'history unavailable',
  })));
  await assert.rejects(page.runProviderSoak(20), /failed after 3 attempts/);
  // The sibling history failure rejects Promise.all before the delayed setup
  // resumes. The active guard must prevent its eventual subscribe() call.
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(counters.subscriptions, 0);
  assert.equal(counters.unsubscriptions, 0);
});

async function waitForState(page, predicate, timeout = 2_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = page.providerSoakState();
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`state timeout: ${JSON.stringify(page.providerSoakState())}`);
}

test('async soak exposes bounded progress while keeping original subscriptions across network cycles', async () => {
  const counters = { subscriptions: 0, unsubscriptions: 0 };
  const page = loadFixture(providerRegistry(() => provider({ counters })));
  assert.equal(page.startProviderSoak(450), true);
  assert.throws(() => page.startProviderSoak(450), /already running/);
  await waitForState(page, state => state.startedAt !== null);
  assert.equal(page.providerSoakState().activeSubscriptions, 2);
  for (let cycle = 0; cycle < 2; cycle += 1) {
    page.setProviderSoakOnline(false);
    await new Promise(resolve => setTimeout(resolve, 10));
    page.setProviderSoakOnline(true);
    counters.callbacks.forEach(callback => callback(bars()[1]));
  }
  const state = await waitForState(page, value => value.status === 'passed');
  assert.equal(state.activeSubscriptions, 0);
  assert.equal(state.recoveryCycles.length, 2);
  for (const cycle of state.recoveryCycles) {
    assert.ok(cycle.resumed.binance >= cycle.onlineAt);
    assert.ok(cycle.resumed.hyperliquid >= cycle.onlineAt);
  }
  assert.equal(counters.subscriptions, 2);
  assert.equal(counters.unsubscriptions, 2);
  assert.ok(state.result.observedDurationMs >= 450);
  assert.equal(state.subscriptions.binance.liveCallbacks, 3);
  assert.equal(state.subscriptions.binance.bars, undefined);
});

test('offline callback and recovery without new data fail the same continuous attempt', async () => {
  for (const deliverOffline of [false, true]) {
    const counters = { subscriptions: 0, unsubscriptions: 0 };
    const page = loadFixture(providerRegistry(() => provider({ counters })));
    page.startProviderSoak(100);
    await waitForState(page, state => state.startedAt !== null);
    page.setProviderSoakOnline(false);
    if (deliverOffline) counters.callbacks[0](bars()[1]);
    page.setProviderSoakOnline(true);
    const state = await waitForState(page, value => value.status === 'failed');
    assert.match(state.error, deliverOffline ? /callback while offline/ : /did not recover/);
    assert.equal(counters.subscriptions, 2);
    assert.equal(counters.unsubscriptions, 2);
  }
});

test('cancelling an in-progress soak tears down subscriptions and counts late callbacks', async () => {
  const counters = { subscriptions: 0, unsubscriptions: 0 };
  const page = loadFixture(providerRegistry(() => provider({ counters })));
  page.startProviderSoak(100_000);
  await waitForState(page, state => state.startedAt !== null);
  page.stopProviderSoak();
  const state = await waitForState(page, value => value.status === 'failed');
  assert.match(state.error, /cancelled/);
  assert.equal(state.activeSubscriptions, 0);
  counters.callbacks[0](bars()[1]);
  assert.equal(page.providerSoakState().callbacksAfterCleanup, 1);
  assert.equal(counters.subscriptions, counters.unsubscriptions);
});

test('frequent callbacks containing stale candles do not satisfy freshness', async () => {
  const counters = { subscriptions: 0, unsubscriptions: 0 };
  const page = loadFixture(providerRegistry(() => {
    const instance = provider({ counters, callback: false });
    const subscribe = instance.subscribe;
    instance.subscribe = (...args) => {
      const unsubscribe = subscribe(...args);
      args[2]({ ...bars()[1], time: Date.now() - 3_600_000 });
      return unsubscribe;
    };
    return instance;
  }));
  await assert.rejects(page.runProviderSoak(100), /stale candles/);
  assert.equal(counters.subscriptions, 2);
  assert.equal(counters.unsubscriptions, 2);
});

test('single-provider evidence declares its scope and cannot pretend to cover omitted routes', async () => {
  const counters = { subscriptions: 0, unsubscriptions: 0 };
  const page = loadFixture(providerRegistry(() => provider({ counters })));
  const result = await page.runProviderSoak(100, 'hyperliquid');
  assert.equal(result.scope, 'hyperliquid');
  assert.equal(result.hyperliquid.live, true);
  assert.equal(result.binance, undefined);
  assert.equal(result.binanceFutures, undefined);
  assert.equal(result.futuresMetadata, 'out_of_scope');
  assert.equal(counters.subscriptions, 1);
  assert.equal(counters.unsubscriptions, 1);
  await assert.rejects(page.runProviderSoak(100, 'unknown'), /unknown provider soak scope/);
});
