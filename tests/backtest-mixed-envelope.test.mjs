import assert from 'node:assert/strict';
import test from 'node:test';

import { VelaBacktestResultsAdapter } from '../src/integrations/vela/backtest-results-adapter.ts';

class Bus {
  #listeners = new Map();
  on(name, listener) {
    const listeners = this.#listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(name, listeners);
    return () => listeners.delete(listener);
  }
  emit(name, payload = {}) {
    for (const listener of [...(this.#listeners.get(name) ?? [])]) listener(payload);
  }
}

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise(setImmediate);
};

const point = (revision, pnl) => ({
  barIndex: 0,
  time: 1,
  equity: 100 + pnl,
  realizedPnl: pnl,
  openPnl: 0,
  underwater: 0,
  underwaterPercent: 0,
  maxDrawdown: 0,
  maxDrawdownPercent: 0,
  benchmarkEquity: null,
  benchmarkPnl: null,
  benchmarkReturnPercent: null,
});

const full = (revision, pnl) => ({
  phase: 'idle',
  barIndex: 0,
  strategy: {
    netPnl: pnl,
    reportRunId: 'mixed-run',
    reportSnapshotRevision: revision,
    reportPointCount: 1,
  },
  trades: [{
    id: `trade-${pnl}`,
    side: 'long',
    qty: 1,
    pnl,
    open: false,
    entry: { time: 1, price: 10 },
    exit: { time: 2, price: 10 + pnl },
  }],
  reportSeries: {
    schemaVersion: 1,
    runId: 'mixed-run',
    snapshotRevision: revision,
    barIndex: 0,
    points: [point(revision, pnl)],
  },
});

function fixture() {
  let current = full(1, 1);
  const handle = Object.assign(new Bus(), {
    id: 's',
    title: 'Mixed envelope',
    source: 'strategy("Mixed envelope")',
    visible: true,
    inputs: [],
    props: [],
    inputValues: () => ({}),
    propValues: () => ({}),
    context: async () => current,
  });
  const chart = Object.assign(new Bus(), {
    indicators: () => [handle],
    historyComplete: () => Promise.resolve(),
  });
  const cell = { id: 'c', chart };
  chart.historyComplete = () => {
    queueMicrotask(() => chart.emit('history:complete', {reason: 'depth', barsLoaded: 2, oldestTime: 1000}));
    return Promise.resolve();
  };
  const workspace = Object.assign(new Bus(), { cells: () => [cell] });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  return {
    adapter,
    workspace,
    setContext: (next) => { current = next; },
    snapshot: () => adapter.getSnapshot({ cellId: 'c', indicatorId: 's' }),
  };
}

test('R-06: identityful tick without report projection retains the last exact series', async () => {
  const f = fixture();
  await f.adapter.bootstrap();
  await flush();
  const before = f.snapshot();
  assert.equal(before.status, 'ready');
  assert.equal(before.seriesState, 'ready');

  const mixed = {
    phase: 'streaming',
    barIndex: 0,
    strategy: {
      netPnl: 2,
      reportRunId: 'mixed-run',
      reportSnapshotRevision: 2,
      reportPointCount: 1,
    },
    // Deliberately omit reportSeries and reportTail: this is the transitional
    // envelope observed from an engine that publishes trades before its curve.
    trades: [{
      id: 'trade-2', side: 'long', qty: 1, pnl: 2, open: false,
      entry: { time: 1, price: 10 }, exit: { time: 2, price: 12 },
    }],
  };
  f.setContext(mixed);
  f.workspace.emit('script:run', {
    cell: 'c', id: 's', kind: 'strategy', cause: 'tick', complete: true,
    forming: false, bar: 0, time: 1, strategy: mixed.strategy,
    trades: async () => mixed.trades,
  });
  await flush();
  const during = f.snapshot();
  assert.equal(during.status, 'ready');
  assert.equal(during.error, null);
  assert.equal(during.trades[0].pnl, 2);
  assert.equal(during.seriesState, 'pending');
  assert.equal(during.capabilities.exactEquityCurve, false);

  const next = full(2, 2);
  f.setContext(next);
  f.workspace.emit('script:run', {
    cell: 'c', id: 's', kind: 'strategy', cause: 'tick', complete: true,
    forming: false, bar: 0, time: 1, strategy: next.strategy,
    trades: async () => next.trades,
  });
  await flush();
  const after = f.snapshot();
  assert.equal(after.status, 'ready');
  assert.equal(after.error, null);
  assert.equal(after.seriesState, 'ready');
  assert.equal(after.reportSeries.points[0].equity, 102);
  f.adapter.destroy();
});

test('R-06: mixed envelope with a regressed identity remains rejected', async () => {
  const f = fixture();
  await f.adapter.bootstrap();
  await flush();
  const stale = {
    phase: 'streaming',
    barIndex: 0,
    strategy: {
      netPnl: 0,
      reportRunId: 'mixed-run',
      reportSnapshotRevision: 0,
      reportPointCount: 1,
    },
    trades: [],
  };
  f.setContext(stale);
  f.workspace.emit('script:run', {
    cell: 'c', id: 's', kind: 'strategy', cause: 'tick', complete: true,
    forming: false, bar: 0, time: 1, strategy: stale.strategy,
    trades: async () => [],
  });
  await flush();
  const snapshot = f.snapshot();
  assert.equal(snapshot.status, 'error');
  assert.equal(snapshot.capabilities.tradeLedger, false);
  f.adapter.destroy();
});
