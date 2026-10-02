import assert from 'node:assert/strict';
import test from 'node:test';
import { VelaBacktestResultsAdapter } from '../src/integrations/vela/backtest-results-adapter.ts';
import { BacktestController, mapSnapshot } from '../src/app/backtest-controller.ts';

class Bus {
  listeners = new Map();
  on(name, fn) { const set = this.listeners.get(name) ?? new Set(); set.add(fn); this.listeners.set(name, set); return () => set.delete(fn); }
  emit(name, payload) { for (const fn of [...(this.listeners.get(name) ?? [])]) fn(payload); }
}
const flush = async () => { for (let i = 0; i < 15; i++) await new Promise(setImmediate); };
function fixture() {
  const row = { id: 'lot', side: 'long', qty: 1, entry: { time: 1000, price: 100 }, exit: { time: 2000, price: 110 }, pnl: 10, open: false };
  let value = { phase: 'idle', meta: { title: 'Fresh audit' }, strategy: { netPnl: 10 }, trades: [row] };
  let fail = false;
  const handle = Object.assign(new Bus(), { id: 's', title: 'Fresh audit', source: 'strategy("Fresh audit")', visible: true, inputs: [], props: [], inputValues: () => ({}), propValues: () => ({}), context: async () => { if (fail) throw Error('independent transport failure'); return value; } });
  const chart = Object.assign(new Bus(), { indicators: () => [handle], historyComplete: () => Promise.resolve() });
  chart.historyComplete = () => {
    queueMicrotask(() => chart.emit('history:complete', {reason: 'depth', barsLoaded: 13, oldestTime: 1000}));
    return Promise.resolve();
  };
  const cell = { id: 'c', chart };
  const workspace = Object.assign(new Bus(), { cells: () => [cell], cell: () => cell });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  return { adapter, chart, row, handle, context: value, setValue: (next) => value = next, fail: () => fail = true,
    tick: (overrides = {}) => workspace.emit('script:run', { cell: 'c', id: 's', kind: 'strategy', title: 'Fresh audit', cause: 'tick', bar: 12, complete: true, forming: true, strategy: { netPnl: 99 }, trades: async () => [row], ...overrides }),
    snapshot: () => adapter.getSnapshot({ cellId: 'c', indicatorId: 's' }) };
}
test('independent F01: a summary-only forming tick cannot advertise an older ledger', async () => {
  const f = fixture(); await f.adapter.bootstrap(); await flush();
  f.setValue({ phase: 'streaming', meta: {}, strategy: { netPnl: 99 } });
  f.tick({ trades: () => new Promise(() => {}) }); await flush();
  assert.equal(f.snapshot().capabilities.tradeLedger, false);
  assert.equal(f.snapshot().trades, null);
  f.adapter.destroy();
});
test('independent F01: a plain engine tick refreshes its ledger without exact report curves', async () => {
  const f = fixture(); await f.adapter.bootstrap(); await flush();
  const current = { ...f.row, id: 'fresh-lot', pnl: 99 };
  f.setValue({ phase: 'streaming', meta: {}, strategy: { netPnl: 99 }, trades: [current] });
  f.tick({ trades: async () => [current] }); await flush();
  assert.equal(f.snapshot().ledgerState, 'ready');
  assert.equal(f.snapshot().ledgerRevision, f.snapshot().revision);
  assert.equal(f.snapshot().trades[0].id, 'fresh-lot');
  assert.equal(f.snapshot().capabilities.exactEquityCurve, false);
  f.adapter.destroy();
});
test('independent F01: a tick with omitted context trades recovers an authoritative empty ledger', async () => {
  const f = fixture(); await f.adapter.bootstrap(); await flush();
  f.setValue({ phase: 'streaming', meta: {}, strategy: { netPnl: 0 } });
  f.tick({ strategy: { netPnl: 0 }, trades: async () => [] }); await flush();
  assert.equal(f.snapshot().status, 'no-trades');
  assert.equal(f.snapshot().capabilities.tradeLedger, true);
  assert.deepEqual(f.snapshot().trades, []); f.adapter.destroy();
});
test('independent F01: delayed tick ledger is discarded after a newer tick', async () => {
  const f = fixture(); await f.adapter.bootstrap(); await flush(); let release;
  f.setValue({ phase: 'streaming', meta: {}, strategy: { netPnl: 1 } });
  f.tick({ trades: () => new Promise(resolve => { release = resolve; }) }); await flush();
  assert.equal(typeof release, 'function');
  f.setValue({ phase: 'streaming', meta: {}, strategy: { netPnl: 2 } });
  f.tick({ trades: async () => [{ ...f.row, id: 'latest', pnl: 2 }] }); await flush();
  release([{ ...f.row, id: 'stale', pnl: 1 }]); await flush();
  assert.equal(f.snapshot().ledgerRevision, f.snapshot().revision);
  assert.equal(f.snapshot().trades[0].id, 'latest'); f.adapter.destroy();
});
test('independent F01: bridge empty-trades omission plus valid tail clears the prior ledger atomically', async () => {
  const f = fixture();
  const point = { barIndex: 0, time: 1000, equity: 1000, realizedPnl: 0, openPnl: 0,
    underwater: 0, underwaterPercent: 0, maxDrawdown: 0, maxDrawdownPercent: 0,
    benchmarkEquity: null, benchmarkPnl: null, benchmarkReturnPercent: null };
  const initial = { ...f.context, barIndex: 0,
    strategy: { netPnl: 10, reportRunId: 'atomic', reportSnapshotRevision: 1, reportPointCount: 1 },
    reportSeries: { schemaVersion: 1, runId: 'atomic', snapshotRevision: 1, barIndex: 0, points: [point] } };
  f.setValue(initial); await f.adapter.bootstrap(); await flush();
  const tail = { phase: 'streaming', meta: {}, barIndex: 0,
    strategy: { netPnl: 0, reportRunId: 'atomic', reportSnapshotRevision: 2, reportPointCount: 1 },
    reportTail: { schemaVersion: 1, runId: 'atomic', snapshotRevision: 2, barIndex: 0, points: [point] } };
  f.setValue(tail); let ledgerCalls = 0;
  f.tick({ bar: 0, strategy: tail.strategy, trades: async () => { ledgerCalls++; throw Error('tail must be sufficient'); } });
  await flush();
  assert.equal(f.snapshot().status, 'no-trades');
  assert.equal(f.snapshot().capabilities.tradeLedger, true);
  assert.equal(f.snapshot().ledgerRevision, f.snapshot().revision);
  assert.deepEqual(f.snapshot().trades, []);
  assert.equal(ledgerCalls, 0); f.adapter.destroy();
});
test('independent F02: rejection produces visible error, never an empty successful result', async () => {
  const f = fixture(); await f.adapter.bootstrap(); await flush(); f.fail(); f.tick(); await flush();
  assert.equal(f.snapshot().status, 'error');
  assert.match(f.snapshot().error.message, /transport failure/); f.adapter.destroy();
});
test('independent F05: snapshot data cannot mutate engine or future consumers', async () => {
  const f = fixture(); await f.adapter.bootstrap(); await flush(); const s = f.snapshot();
  assert.equal(Object.isFrozen(s.context.strategy), true);
  assert.equal(Object.isFrozen(s.trades[0].entry), true);
  f.context.strategy.netPnl = 777; f.row.entry.price = 999;
  assert.equal(f.snapshot().context.strategy.netPnl, 10);
  assert.equal(s.trades[0].entry.price, 100);
  assert.equal(s.handle.setInputs, undefined); f.adapter.destroy();
});
test('independent F10: readiness without a completion reason cannot prove full history', async () => {
  const f = fixture(); let release;
  f.chart.historyComplete = () => new Promise(resolve => { release = resolve; });
  await f.adapter.bootstrap(); await flush(); release(); await flush();
  assert.notEqual(f.snapshot().finality, 'historical-final'); f.adapter.destroy();
});
test('independent F02: bootstrap rejection is visible and a new context can recover', async () => {
  const f = fixture(); f.fail(); await f.adapter.bootstrap(); await flush();
  assert.equal(f.snapshot().status, 'error');
  assert.match(f.snapshot().error.message, /transport failure/);
  f.handle.context = async () => f.context;
  f.handle.emit('ready'); await flush();
  assert.equal(f.snapshot().error, null);
  assert.equal(f.snapshot().trades[0].id, 'lot'); f.adapter.destroy();
});
test('independent F02: history refresh rejection cannot promote stale head data', async () => {
  const f = fixture(); await f.adapter.bootstrap(); await flush(); f.fail();
  f.chart.emit('history:progress', { loaded: 13, target: 100 });
  f.chart.emit('history:complete', { reason: 'depth', barsLoaded: 100, oldestTime: 1000 }); await flush();
  assert.equal(f.snapshot().status, 'error');
  assert.equal(f.snapshot().capabilities.tradeLedger, false); f.adapter.destroy();
});
test('independent F02: a late rejection after destroy publishes no error', async () => {
  const f = fixture(); await f.adapter.bootstrap(); await flush(); let reject;
  f.handle.context = () => new Promise((_, fail) => { reject = fail; });
  const events = []; f.adapter.subscribe(e => events.push(e)); f.tick();
  f.adapter.destroy(); const count = events.length; reject(Error('late')); await flush();
  assert.equal(events.length, count);
});
test('independent F02: explicit controller retry bypasses cached start and recovers the selected report', async () => {
  const f = fixture(); const controller = new BacktestController(f.adapter);
  await controller.start(); await flush(); f.fail(); f.tick(); await flush();
  assert.equal(controller.getSnapshot().status, 'error');
  f.handle.context = async () => f.context;
  await controller.retryActive(); await flush();
  assert.notEqual(controller.getSnapshot().status, 'error');
  assert.equal(f.snapshot().error, null);
  assert.equal(f.snapshot().capabilities.tradeLedger, true);
  controller.destroy(); f.adapter.destroy();
});
test('independent F01: controller rejects mismatched or absent revision proof', async () => {
  const f = fixture(); await f.adapter.bootstrap(); await flush(); const original = f.snapshot();
  for (const ledgerRevision of [undefined, null, original.revision - 1]) {
    const mapped = mapSnapshot({ ...original, finality: 'historical-final', status: 'ready', ledgerRevision });
    assert.equal(mapped.trades.length, 0);
  }
  f.adapter.destroy();
});
