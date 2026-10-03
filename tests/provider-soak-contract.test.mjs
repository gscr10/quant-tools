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
  { time: 1, open: 1, high: 2, low: 1, close: 1.5 },
  { time: 2, open: 1.5, high: 2.5, low: 1.25, close: 2 },
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
      if (callback) onBar(bars()[1]);
      return () => { counters.unsubscriptions += 1; };
    },
  };
}

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
