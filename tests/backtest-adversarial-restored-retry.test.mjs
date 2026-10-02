import assert from 'node:assert/strict';
import test from 'node:test';
import { VelaBacktestResultsAdapter } from '../src/integrations/vela/backtest-results-adapter.ts';

class Events {
  handlers = new Map();
  on(name, callback) {
    const handlers = this.handlers.get(name) ?? new Set();
    this.handlers.set(name, handlers); handlers.add(callback);
    return () => handlers.delete(callback);
  }
  emit(name, payload) { for (const callback of this.handlers.get(name) ?? []) callback(payload); }
}
const settle = async () => { for (let index = 0; index < 12; index++) await new Promise(setImmediate); };
const key = { cellId: 'restored-review', indicatorId: 'cached-strategy' };
function payload(revision, pnl, full = true) {
  const point = { barIndex: 0, time: 1000, equity: 500 + pnl, realizedPnl: pnl,
    openPnl: 0, underwater: 0, underwaterPercent: 0, maxDrawdown: 0,
    maxDrawdownPercent: 0, benchmarkEquity: null, benchmarkPnl: null, benchmarkReturnPercent: null };
  return { phase: 'idle', meta: { title: 'Restored reviewer' }, barIndex: 0,
    strategy: { netPnl: pnl, reportRunId: 'cached-run', reportSnapshotRevision: revision, reportPointCount: 1 },
    trades: [{ id: `pnl-${pnl}`, side: 'long', qty: 1, open: false, pnl,
      entry: { time: 500, price: 100 }, exit: { time: 1000, price: 100 + pnl } }],
    ...(full ? { reportSeries: { schemaVersion: 1, runId: 'cached-run', snapshotRevision: revision, barIndex: 0, points: [point] } } : {}) };
}
async function cachedStrategy() {
  let current = payload(1, 7);
  const handle = Object.assign(new Events(), { id: key.indicatorId, visible: true,
    source: 'strategy("Restored reviewer")', inputs: [], props: [], inputValues: () => ({}), propValues: () => ({}),
    context: async () => current });
  const chart = Object.assign(new Events(), { indicators: () => [handle], historyComplete: () => new Promise(() => {}) });
  const workspace = Object.assign(new Events(), { cells: () => [{ id: key.cellId, chart }] });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  await adapter.bootstrap(); await settle();
  return { adapter, handle, chart, workspace, replace: value => { current = value; }, read: () => adapter.getSnapshot(key) };
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

for (const lateFailure of [false, true]) {
  for (const transition of ['run', 'hide-show', 'remove-readd']) {
    test(`reviewer: pending ready read cannot affect ${transition}; lateFailure=${lateFailure}`, async () => {
      const f = await cachedStrategy();
      const delayed = deferred();
      let phase = 'old';
      let first = true;
      f.handle.context = async () => {
        if (first) { first = false; return delayed.promise; }
        // The bounded retry of the obsolete read must also be harmless.
        if (phase === 'late-error') throw Error('old-ready-failure');
        return payload(10, 123);
      };
      try {
        f.handle.emit('ready'); await settle();
        if (transition === 'run') {
          f.workspace.emit('script:run', { cell: key.cellId, id: key.indicatorId,
            kind: 'strategy', cause: 'history', complete: true, forming: false,
            strategy: payload(10, 123).strategy, bar: 0, time: 1000,
            trades: async () => payload(10, 123).trades });
        } else if (transition === 'hide-show') {
          f.handle.visible = false;
          f.chart.emit('indicator:visibility', { id: key.indicatorId, visible: false });
          f.handle.visible = true;
          f.chart.emit('indicator:visibility', { id: key.indicatorId, visible: true });
        } else {
          f.chart.indicators = () => [];
          f.chart.emit('indicator:removed', { id: key.indicatorId });
          const replacement = Object.assign(new Events(), { ...f.handle, context: async () => payload(10, 123) });
          f.chart.indicators = () => [replacement];
          f.chart.emit('indicator:added', { id: key.indicatorId });
        }
        await settle();
        assert.equal(f.read().trades?.[0]?.pnl, 123);
        const before = f.read();
        phase = 'late-error';
        if (lateFailure) delayed.reject(Error('old-ready-failure')); else delayed.resolve(payload(2, 8));
        await settle();
        assert.equal(f.read().error, null);
        assert.equal(f.read().trades?.[0]?.pnl, 123);
        assert.equal(f.read().revision, before.revision);
      } finally { f.adapter.destroy(); }
    });
  }
}

test('reviewer: restored strategy Retry cannot join new trades to its previous series when full payload is absent', async () => {
  const f = await cachedStrategy();
  try {
    assert.equal(f.read().reportSeries.snapshotRevision, 1);
    assert.equal(f.read().trades[0].pnl, 7);
    f.replace(payload(2, 91, false));
    await f.adapter.retry(key); await settle();
    const result = f.read();
    assert.equal(result.status, 'error', JSON.stringify({ status: result.status,
      scalar: result.context?.strategy?.netPnl, pnl: result.trades?.[0]?.pnl,
      seriesRevision: result.reportSeries?.snapshotRevision, engineRevision: result.context?.strategy?.reportSnapshotRevision }));
    assert.equal(result.capabilities.tradeLedger, false);
  } finally { f.adapter.destroy(); }
});

test('reviewer: restored strategy Retry still accepts a matching newer complete report', async () => {
  const f = await cachedStrategy();
  try {
    f.replace(payload(2, 91));
    await f.adapter.retry(key); await settle();
    const result = f.read();
    assert.equal(result.error, null);
    assert.equal(result.reportSeries.snapshotRevision, 2);
    assert.equal(result.context.strategy.reportSnapshotRevision, 2);
    assert.equal(result.trades[0].pnl, 91);
  } finally { f.adapter.destroy(); }
});
