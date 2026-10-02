import assert from 'node:assert/strict';
import test from 'node:test';
import { VelaBacktestResultsAdapter } from '../src/integrations/vela/backtest-results-adapter.ts';

class Bus {
  events = new Map();
  on(name, fn) { const set = this.events.get(name) ?? new Set(); this.events.set(name, set); set.add(fn); return () => set.delete(fn); }
  emit(name, data) { for (const fn of this.events.get(name) ?? []) fn(data); }
}
const settle = async () => { for (let n = 0; n < 12; n++) await new Promise(setImmediate); };
const key = { cellId: 'market-review', indicatorId: 'strategy' };
const market = (symbol, timeframe = '1h') => ({ symbol, timeframe });
const context = pnl => ({ phase: 'idle', meta: { title: 'Market reviewer' },
  strategy: { initialCapital: 1000, netPnl: pnl }, trades: [{ id: `pnl-${pnl}`, side: 'long', qty: 1,
    entry: { time: 1000, price: 10 }, exit: { time: 2000, price: 10 + pnl }, pnl, open: false }] });
async function setup() {
  const handle = Object.assign(new Bus(), { id: key.indicatorId, source: 'strategy("market")', visible: true,
    inputs: [], props: [], inputValues: () => ({}), propValues: () => ({}), context: async () => context(7) });
  const chart = Object.assign(new Bus(), { market: market('AAA'), indicators: () => [handle], historyComplete: () => new Promise(() => {}) });
  const workspace = Object.assign(new Bus(), { cells: () => [{ id: key.cellId, chart }] });
  const adapter = new VelaBacktestResultsAdapter(workspace); await adapter.bootstrap();
  chart.emit('history:complete', { reason: 'depth', oldestTime: 1000, barsLoaded: 20 }); await settle();
  return { adapter, handle, chart, workspace, read: () => adapter.getSnapshot(key),
    complete: (reason = 'depth', barsLoaded = 20) => chart.emit('history:complete', { reason, oldestTime: 1000, barsLoaded }) };
}
for (const sameSymbol of [false, true]) {
  for (const historyFirst of [false, true]) {
    test(`reviewer S01 overlap sameSymbol=${sameSymbol} historyBeforeEnd=${historyFirst}`, async () => {
      const f = await setup();
      try {
        f.chart.market = market(sameSymbol ? 'AAA' : 'BBB', '5m');
        f.chart.emit('load:start', f.chart.market);
        f.chart.market = market(sameSymbol ? 'AAA' : 'CCC', '15m');
        f.handle.context = async () => context(33);
        const end = () => f.chart.emit('load:end', { ...f.chart.market, bars: 20 });
        if (historyFirst) { f.complete(); end(); } else { end(); f.complete(); }
        // History completion is not proof that the new engine run completed.
        // The identity-free legacy fixture must announce its new execution.
        assert.notEqual(f.read().status, 'ready');
        f.workspace.emit('script:run', {cell:key.cellId,id:key.indicatorId,kind:'strategy',complete:true,cause:'bars',strategy:context(33).strategy,trades:async()=>context(33).trades});
        f.chart.emit('market:changed', f.chart.market);
        f.handle.emit('ready'); await settle();
        assert.equal(f.read().history.complete, true);
        assert.equal(f.read().finality, 'historical-final');
        assert.equal(f.read().trades[0].pnl, 33);
      } finally { f.adapter.destroy(); }
    });
  }
}
for (const reject of [false, true]) {
  test(`reviewer S01 in-flight reply cannot publish during a silent requested switch, reject=${reject}`, async () => {
    const f = await setup(); let finish;
    f.handle.context = () => new Promise((ok, fail) => { finish = reject ? fail : ok; });
    try {
      const retry = f.adapter.retry(key); await settle();
      f.chart.market = market('NEW', '4h');
      const snapshots = []; const unsubscribe = f.adapter.subscribe(e => { if (e.type === 'snapshot') snapshots.push(e.snapshot); });
      if (reject) {
        f.handle.context = async () => { throw Error('superseded market'); };
        finish(Error('superseded market'));
      } else finish(context(999));
      await retry; await settle();
      assert.equal(snapshots.length, 0);
      unsubscribe();
    } finally { f.adapter.destroy(); }
  });
}
test('reviewer S01 overlapping abort is never promoted to complete finality', async () => {
  const f = await setup();
  try {
    f.chart.market = market('BBB'); f.chart.emit('load:start', f.chart.market);
    f.chart.market = market('CCC'); f.complete('aborted', 3);
    f.chart.emit('load:end', { ...f.chart.market, bars: 3 });
    f.chart.emit('market:changed', f.chart.market); await settle();
    assert.notEqual(f.read().finality, 'historical-final');
    assert.equal(f.read().history.reason, 'aborted');
  } finally { f.adapter.destroy(); }
});
test('reviewer S01 empty overlapping market leaves no current trade ledger', async () => {
  const f = await setup();
  try {
    f.chart.market = market('BBB'); f.chart.emit('load:start', f.chart.market);
    f.chart.market = market('CCC');
    f.chart.emit('load:end', { ...f.chart.market, bars: 0 });
    f.complete('genesis', 0); f.chart.emit('market:changed', f.chart.market); await settle();
    assert.equal(f.read().status, 'no-data');
    assert.equal(f.read().capabilities.tradeLedger, false, JSON.stringify({
      status: f.read().status, history: f.read().history, ledgerState: f.read().ledgerState,
      trades: f.read().trades,
    }));
  } finally { f.adapter.destroy(); }
});
