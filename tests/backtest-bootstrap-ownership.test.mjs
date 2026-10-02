import assert from 'node:assert/strict';
import test from 'node:test';
import { VelaBacktestResultsAdapter } from '../src/integrations/vela/backtest-results-adapter.ts';

class Events {
  listeners = new Map();
  on(name, fn) { const list = this.listeners.get(name) ?? new Set(); list.add(fn); this.listeners.set(name, list); return () => list.delete(fn); }
  emit(name, value = {}) { for (const fn of [...(this.listeners.get(name) ?? [])]) fn(value); }
}
const flush = async () => { for (let n = 0; n < 16; n++) await new Promise(setImmediate); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; };
const key = { cellId: 'bootstrap-cell', indicatorId: 'restored' };
function report(revision, { runId = 'initial', tail = false, envelope = true, identity = true, phase = 'idle' } = {}) {
  return { phase, barIndex: 0, strategy: { netPnl: revision, ...(identity ? {
    reportRunId: runId, reportSnapshotRevision: revision, reportPointCount: 1,
  } : {}) }, trades: [{ id: `trade-${revision}`, side: 'long', qty: 1, open: false, pnl: revision,
    entry: { time: 1, price: 10 }, exit: { time: 2, price: 10 + revision } }],
  ...(envelope ? { [tail ? 'reportTail' : 'reportSeries']: { schemaVersion: 1, runId, snapshotRevision: revision,
    barIndex: 0, points: [{ barIndex: 0, time: 1000, equity: 1000 + revision, realizedPnl: revision, openPnl: 0,
      underwater: 0, underwaterPercent: 0, maxDrawdown: 0, maxDrawdownPercent: 0,
      benchmarkEquity: null, benchmarkPnl: null, benchmarkReturnPercent: null }] } } : {}) };
}
const select = (value, keys) => Object.fromEntries(Object.entries(value).filter(([k]) => keys.includes(k) || ['phase', 'barIndex'].includes(k)));
async function setup(initial = report(1)) {
  let reader = keys => select(initial, keys);
  const handle = Object.assign(new Events(), { id: key.indicatorId, visible: true, source: 'strategy("Bootstrap")',
    inputs: [], props: [], inputValues: () => ({}), propValues: () => ({}), context: async keys => reader(keys) });
  const chart = Object.assign(new Events(), { indicators: () => [handle], historyComplete: () => new Promise(() => {}) });
  const workspace = Object.assign(new Events(), { cells: () => [{ id: key.cellId, chart }] });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const boot = adapter.bootstrap();
  chart.emit('history:complete', {reason: 'depth', barsLoaded: 1, oldestTime: 1000});
  await boot; await flush();
  return { adapter, chart, read: fn => { reader = fn; }, snapshot: () => adapter.getSnapshot(key),
    changed: () => chart.emit('context:changed', { id: key.indicatorId }),
    run: value => workspace.emit('script:run', { cell: key.cellId, id: key.indicatorId, kind: 'strategy', cause: 'tick',
      complete: true, forming: true, bar: 0, time: 1000, strategy: value.strategy, trades: async () => value.trades }) };
}

for (const first of ['bootstrap', 'retry']) {
  for (const bootstrapFails of [false, true]) {
    for (const retryFails of [false, true]) {
      test(`S03: ${first} finishes first; bootstrap failure=${bootstrapFails}; retry failure=${retryFails}`, async () => {
        const x = await setup(report(20));
        try {
          const old = deferred(), fresh = deferred(); let calls = 0;
          x.read(() => ++calls === 1 ? old.promise : calls === 2 ? fresh.promise : Promise.reject(Error('controlled failure')));
          x.changed(); await flush(); const retry = x.adapter.retry(key); await flush();
          const finishOld = () => bootstrapFails ? old.reject(Error('controlled failure')) : old.resolve(report(21));
          const finishFresh = () => retryFails ? fresh.reject(Error('controlled failure')) : fresh.resolve(report(22));
          if (first === 'bootstrap') { finishOld(); await flush(); finishFresh(); }
          else { finishFresh(); await flush(); finishOld(); }
          await retry; await flush(); const result = x.snapshot();
          assert.equal(result.status, retryFails ? 'error' : 'ready');
          assert.equal(result.context.strategy.reportSnapshotRevision, retryFails ? 20 : 22);
          assert.equal(result.capabilities.tradeLedger, !retryFails);
          assert.equal(result.error?.message ?? null, retryFails ? 'controlled failure' : null);
        } finally { x.adapter.destroy(); }
      });
    }
  }
}

test('S03: bootstrap refresh cannot regress its accepted engine identity', async () => {
  const x = await setup(report(40));
  try {
    x.read(keys => select(report(2), keys)); x.changed(); await flush();
    assert.equal(x.snapshot().status, 'error');
    assert.equal(x.snapshot().context.strategy.reportSnapshotRevision, 40);
    x.read(keys => select(report(41), keys)); x.changed(); await flush();
    assert.equal(x.snapshot().status, 'ready'); assert.equal(x.snapshot().trades[0].pnl, 41);
  } finally { x.adapter.destroy(); }
});

for (const initial of [true, false]) {
  test(`S03: missing envelope rejected on ${initial ? 'initial bootstrap' : 'restored bootstrap refresh'}`, async () => {
    const x = await setup(report(1, { envelope: !initial }));
    try {
      if (!initial) { x.read(keys => select(report(2, { envelope: false }), keys)); x.changed(); await flush(); }
      assert.equal(x.snapshot().status, 'error');
      assert.equal(x.snapshot().capabilities.tradeLedger, false);
      x.read(keys => select(report(3), keys)); await x.adapter.retry(key); await flush();
      assert.equal(x.snapshot().status, 'ready'); assert.equal(x.snapshot().trades[0].pnl, 3);
    } finally { x.adapter.destroy(); }
  });
}

for (const tail of [false, true]) {
  test(`S02: tick revision floor rejects old ${tail ? 'tail' : 'full'} and accepts matching report`, async () => {
    const x = await setup();
    try {
      x.read(() => report(1, { tail })); x.run(report(10)); await flush();
      assert.equal(x.snapshot().status, 'error'); assert.equal(x.snapshot().capabilities.tradeLedger, false);
      x.read(keys => select(report(10, { tail: !keys.includes('reportSeries') }), keys));
      x.run(report(10)); await flush();
      assert.equal(x.snapshot().status, 'ready'); assert.equal(x.snapshot().trades[0].pnl, 10);
    } finally { x.adapter.destroy(); }
  });
}

for (const announced of [true, false]) {
  test(`S02: ${announced ? 'announced' : 'tail-discovered'} worker restart recovers matching full series`, async () => {
    const x = await setup();
    try {
      const next = report(2, { runId: 'restarted' });
      x.read(keys => select(report(2, { runId: 'restarted', tail: !keys.includes('reportSeries') }), keys));
      x.run(announced ? next : report(1)); await flush();
      assert.equal(x.snapshot().status, 'ready'); assert.equal(x.snapshot().reportSeries.runId, 'restarted');
      assert.equal(x.snapshot().trades[0].pnl, 2);
      await x.adapter.retry(key); await flush();
      assert.equal(x.snapshot().status, 'ready'); assert.equal(x.snapshot().reportSeries.runId, 'restarted');
    } finally { x.adapter.destroy(); }
  });
}

test('S02: newly announced tick run rejects its old baseline even when a valid old tail returns', async () => {
  const x = await setup();
  try {
    x.read(keys => select(report(2, { tail: !keys.includes('reportSeries') }), keys));
    x.run(report(1, { runId: 'new-run' })); await flush();
    assert.equal(x.snapshot().status, 'error'); assert.equal(x.snapshot().capabilities.tradeLedger, false);
  } finally { x.adapter.destroy(); }
});

test('S02/S03: metadata-free third-party bootstrap, refresh and tick remain supported', async () => {
  const legacy = n => report(n, { identity: false, envelope: false });
  const x = await setup(legacy(1));
  try {
    assert.equal(x.snapshot().status, 'ready');
    x.read(keys => select(legacy(2), keys)); x.changed(); await flush();
    assert.equal(x.snapshot().trades[0].pnl, 2);
    x.read(keys => select(legacy(3), keys)); x.run(legacy(3)); await flush();
    assert.equal(x.snapshot().status, 'ready'); assert.equal(x.snapshot().trades[0].pnl, 3);
  } finally { x.adapter.destroy(); }
});

for (const change of ['symbol', 'timeframe', 'unchanged']) {
  for (const fails of [false, true]) {
    test(`S03: initial discovery ${fails ? 'failure' : 'success'} observes silent market ${change}`, async () => {
      const pending = deferred();
      const handle = Object.assign(new Events(), { id: key.indicatorId, visible: true, source: 'strategy("Initial market")',
        inputs: [], props: [], inputValues: () => ({}), propValues: () => ({}), context: async () => pending.promise });
      const chart = Object.assign(new Events(), { market: { symbol: 'AAA', timeframe: '1' },
        indicators: () => [handle], historyComplete: () => new Promise(() => {}) });
      const workspace = Object.assign(new Events(), { cells: () => [{ id: key.cellId, chart }] });
      const adapter = new VelaBacktestResultsAdapter(workspace);
      try {
        const boot = adapter.bootstrap();
        chart.emit('history:complete', {reason: 'depth', barsLoaded: 1, oldestTime: 1000});
        await flush();
        assert.equal(adapter.getSnapshot(key), undefined);
        // setMarket changes the getter synchronously, but a superseding load
        // can suppress load:start. No event is emitted in this fault window.
        if (change === 'symbol') chart.market = { symbol: 'BBB', timeframe: '1' };
        if (change === 'timeframe') chart.market = { symbol: 'AAA', timeframe: '5' };
        if (fails) pending.reject(Error('old-market read failed')); else pending.resolve(report(7));
        await boot; await flush();
        const result = adapter.getSnapshot(key);
        if (change !== 'unchanged') assert.equal(result, undefined);
        else {
          assert.equal(result.status, fails ? 'error' : 'ready');
          if (!fails) assert.equal(result.trades[0].pnl, 7);
        }
      } finally { adapter.destroy(); }
    });
  }
}
