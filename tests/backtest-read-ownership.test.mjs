import assert from 'node:assert/strict';
import test from 'node:test';
import { VelaBacktestResultsAdapter } from '../src/integrations/vela/backtest-results-adapter.ts';

class Bus {
  listeners = new Map();
  on(name, fn) { const set = this.listeners.get(name) ?? new Set(); set.add(fn); this.listeners.set(name, set); return () => set.delete(fn); }
  emit(name, value) { for (const fn of [...(this.listeners.get(name) ?? [])]) fn(value); }
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; };
const flush = async () => { for (let n = 0; n < 16; n++) await new Promise(setImmediate); };
const key = { cellId: 'read-cell', indicatorId: 'read-strategy' };
function atomic(revision, pnl, { runId = 'engine', empty = false, tail = false } = {}) {
  const p = { barIndex: 0, time: 1000, equity: 1000 + pnl, realizedPnl: pnl, openPnl: 0,
    underwater: 0, underwaterPercent: 0, maxDrawdown: 0, maxDrawdownPercent: 0,
    benchmarkEquity: null, benchmarkPnl: null, benchmarkReturnPercent: null };
  return { phase: 'idle', meta: { title: 'Read audit' }, barIndex: 0,
    strategy: { netPnl: pnl, reportRunId: runId, reportSnapshotRevision: revision, reportPointCount: 1 },
    ...(!empty ? { trades: [{ id: `lot-${pnl}`, side: 'long', qty: 1, open: false, pnl,
      entry: { time: 1, price: 10 }, exit: { time: 2, price: 10 + pnl } }] } : {}),
    [tail ? 'reportTail' : 'reportSeries']: { schemaVersion: 1, runId, snapshotRevision: revision, barIndex: 0, points: [p] } };
}
const projection = (value, select) => Object.fromEntries(Object.entries(value).filter(([k]) => ['phase', 'barIndex'].includes(k) || select.includes(k)));
async function setup() {
  const handle = Object.assign(new Bus(), { id: key.indicatorId, source: 'strategy("Read audit")', visible: true, inputs: [], props: [], inputValues: () => ({}), propValues: () => ({}) });
  let read = (select) => projection(atomic(1, 10), select);
  handle.context = async (select) => read(select);
  const chart = Object.assign(new Bus(), { indicators: () => [handle], historyComplete: () => new Promise(() => {}) });
  const cell = { id: key.cellId, chart };
  const workspace = Object.assign(new Bus(), { cells: () => [cell] });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const boot = adapter.bootstrap();
  chart.emit('history:complete', {reason: 'depth', barsLoaded: 1, oldestTime: 1000});
  await boot; await flush();
  return { adapter, chart, handle, read: (fn) => { read = fn; }, snap: () => adapter.getSnapshot(key),
    run: (cause = 'inputs', strategy = { netPnl: 20 }) => workspace.emit('script:run', { cell: key.cellId, id: key.indicatorId, kind: 'strategy', cause,
      bar: 0, time: 1000, complete: true, forming: cause === 'tick', strategy, trades: async () => [] }) };
}

for (const cause of ['inputs', 'history']) {
  for (const oldRun of [true, false]) {
    test(`R03: ${cause} announced identity rejects ${oldRun ? 'previous run' : 'previous snapshot'} after report reset`, async () => {
      const x = await setup();
      const current = atomic(4, 44, { runId: 'announced-run' });
      const stale = atomic(1, 10, { runId: oldRun ? 'engine' : 'announced-run' });
      x.read(select => projection(stale, select));
      x.run(cause, current.strategy); await flush();
      assert.equal(x.snap().status, 'error');
      assert.equal(x.snap().capabilities.tradeLedger, false);
      assert.equal(x.snap().reportSeries, undefined);
      x.read(select => projection(current, select));
      await x.adapter.retry(key); await flush();
      assert.equal(x.snap().status, 'ready');
      assert.equal(x.snap().trades[0].pnl, 44);
      x.adapter.destroy();
    });
  }
}

test('R01: summary-only reads cannot erase the accepted ledger or audit context', async () => {
  const x = await setup(); x.run(); await flush(); const before = x.snap();
  let selection;
  x.read(select => { selection = select; return projection(atomic(1, 10), select); });
  x.chart.emit('context:changed', { id: key.indicatorId }); await flush();
  assert.equal(selection.includes('trades'), false);
  assert.deepEqual(x.snap().trades, before.trades);
  assert.equal(x.snap().status, before.status); x.adapter.destroy();
});

for (const empty of [false, true]) {
  test(`R01: explicit atomic tail population empty=${empty} survives a later summary`, async () => {
    const x = await setup(); const tail = atomic(2, empty ? 0 : 44, { tail: true, empty });
    x.read(select => projection(tail, select)); x.run('tick'); await flush();
    assert.equal(x.snap().trades.length, empty ? 0 : 1);
    const before = x.snap(); x.chart.emit('context:changed', { id: key.indicatorId }); await flush();
    assert.deepEqual(x.snap().trades, before.trades);
    x.read(select => projection(atomic(3, 55, { tail: true }), select));
    x.run('tick'); await flush(); assert.equal(x.snap().trades[0].pnl, 55); x.adapter.destroy();
  });
}

for (const order of ['summary-first', 'full-first']) {
  for (const fullFails of [false, true]) {
    for (const summaryFails of [false, true]) {
      test(`R02: ${order}; full fails=${fullFails}; summary fails=${summaryFails}`, async () => {
        const x = await setup(); const full = deferred(), summary = deferred();
        x.read(select => select.includes('reportSeries') ? full.promise : summary.promise);
        x.run(); await flush();
        const finishFull = () => fullFails ? full.reject(Error('authoritative full failure')) : full.resolve(atomic(2, 20));
        const finishSummary = () => summaryFails ? summary.reject(Error('summary failure')) : summary.resolve(projection(atomic(2, 20), ['meta', 'strategy']));
        if (order === 'summary-first') { finishSummary(); await flush(); finishFull(); }
        else { finishFull(); await flush(); finishSummary(); }
        await flush(); const result = x.snap();
        assert.equal(result.error?.message ?? null, fullFails ? 'authoritative full failure' : null);
        assert.equal(result.ledgerState, fullFails ? 'error' : 'ready');
        assert.equal(result.trades?.[0]?.pnl ?? null, fullFails ? null : 20);
        x.adapter.destroy();
      });
    }
  }
}

test('R03: retry rejects the old engine identity and then accepts the matching recovery', async () => {
  const x = await setup();
  const tail = atomic(2, 66, { runId: 'restarted', tail: true });
  x.read(select => select.includes('reportSeries') ? Promise.reject(Error('recovery failed')) : projection(tail, select));
  x.run('tick'); await flush(); assert.equal(x.snap().status, 'error');
  x.read(select => projection(atomic(1, 10), select));
  await x.adapter.retry(key); await flush();
  assert.equal(x.snap().status, 'error');
  assert.equal(x.snap().context.strategy.reportRunId, 'restarted');
  assert.equal(x.snap().capabilities.tradeLedger, false);
  x.read(select => projection(atomic(3, 66, { runId: 'restarted' }), select));
  await x.adapter.retry(key); await flush();
  assert.equal(x.snap().status, 'ready');
  assert.equal(x.snap().context.strategy.reportRunId, 'restarted');
  assert.equal(x.snap().trades[0].pnl, 66); x.adapter.destroy();
});

test('R03: same-run older snapshot and missing full identity payload are both rejected', async () => {
  const x = await setup();
  x.read(select => projection(atomic(4, 40, { tail: true }), select)); x.run('tick'); await flush();
  assert.equal(x.snap().trades[0].pnl, 40);
  for (const invalid of [atomic(2, 20), projection(atomic(5, 50), ['meta', 'strategy', 'trades'])]) {
    x.read(select => projection(invalid, select)); await x.adapter.retry(key); await flush();
    assert.equal(x.snap().status, 'error'); assert.equal(x.snap().capabilities.tradeLedger, false);
    assert.equal(x.snap().context.strategy.reportSnapshotRevision, 4);
  }
  x.read(select => projection(atomic(6, 60), select)); await x.adapter.retry(key); await flush();
  assert.equal(x.snap().trades[0].pnl, 60); x.adapter.destroy();
});

for (const staleRejects of [false, true]) {
  test(`R02: superseded full read cannot publish success or failure; rejects=${staleRejects}`, async () => {
    const x = await setup(); const first = deferred(); let fullCalls = 0;
    x.read(select => select.includes('reportSeries')
      ? (++fullCalls <= (staleRejects ? 2 : 1) ? first.promise : atomic(3, 33))
      : projection(atomic(2, 20), select));
    x.run(); await flush(); const retry = x.adapter.retry(key);
    if (staleRejects) first.reject(Error('superseded full failure')); else first.resolve(atomic(2, 20));
    await retry; await flush();
    assert.equal(x.snap().error, null); assert.equal(x.snap().trades[0].pnl, 33); x.adapter.destroy();
  });
}

for (const action of ['destroy', 'market', 'remove']) {
  test(`R02: delayed report errors cannot publish after ${action}`, async () => {
    const x = await setup(); const full = deferred(); let events = 0;
    x.adapter.subscribe(() => events++);
    x.read(select => select.includes('reportSeries') ? full.promise : projection(atomic(2, 20), select));
    x.run(); await flush();
    if (action === 'destroy') x.adapter.destroy();
    else if (action === 'market') x.chart.emit('load:start', { symbol: 'other', timeframe: '1h', firstLoad: false });
    else { x.chart.indicators = () => []; x.chart.emit('indicator:removed', { id: key.indicatorId }); }
    const before = events; full.reject(Error('late failure')); await flush();
    assert.equal(events, before); x.adapter.destroy();
  });
}
