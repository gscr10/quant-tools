import assert from 'node:assert/strict';
import test from 'node:test';
import { VelaBacktestResultsAdapter } from '../src/integrations/vela/backtest-results-adapter.ts';
import { mapSnapshot } from '../src/app/backtest-controller.ts';
import { observeWorkspaceHistory } from '../src/integrations/vela/workspace-history-observer.ts';

class Bus {
  listeners = new Map();
  on(name, fn) { const set = this.listeners.get(name) ?? new Set(); set.add(fn); this.listeners.set(name, set); return () => set.delete(fn); }
  emit(name, data = {}) { for (const fn of this.listeners.get(name) ?? []) fn(data); }
}
const settle = async () => { for (let n = 0; n < 12; n++) await new Promise(setImmediate); };
function fixture(market) {
  const setMarketCalls = [];
  const chart = Object.assign(new Bus(), { market, handles: [], setMarketCalls,
    historyComplete: () => Promise.resolve(), indicators() { return this.handles; },
    setMarket(next) { setMarketCalls.push(next); this.market={...this.market,...next}; return Promise.resolve(); } });
  const cell = { id: 'history-cell', chart };
  const workspace = Object.assign(new Bus(), { cells: () => [cell], cell: () => cell });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const complete = reason => chart.emit('history:complete', { reason, oldestTime: 1000, barsLoaded: 12 });
  const add = async id => {
    const handle = Object.assign(new Bus(), { id, title: 'Late strategy', source: 'strategy("Late strategy")', visible: true, inputs: [], props: [], inputValues: () => ({}), propValues: () => ({}), context: async () => ({ phase: 'idle', meta: { title: 'Late strategy' }, strategy: { netPnl: 4, initialCapital: 1000 }, trades: [{ id: 'one', side: 'long', qty: 1, entry: { time: 1000, price: 100 }, exit: { time: 2000, price: 104 }, open: false, pnl: 4 }] }) });
    chart.handles.push(handle); chart.emit('indicator:added', { id }); await settle();
    return adapter.getSnapshot({ cellId: cell.id, indicatorId: id });
  };
  return { chart, adapter, complete, add, workspace, setMarketCalls };
}

for (const reason of ['depth', 'aborted']) test(`late adapter consumes cached ${reason} without reopening closed history`, async () => {
  const f = fixture({symbol:'AAA',timeframe:'60'});
  const dispose = observeWorkspaceHistory(f.workspace);
  f.complete(reason);
  f.chart.emit('market:changed', f.chart.market);
  await f.adapter.bootstrap();
  const s = await f.add('late-observer');
  assert.equal(s.history.reason, reason);
  assert.equal(s.status, reason === 'depth' ? 'ready' : 'partial');
  f.complete(reason === 'depth' ? 'aborted' : 'depth');
  assert.equal(f.adapter.getSnapshot(s.key).history.reason, reason);
  f.adapter.destroy(); dispose();
});
test('late adapter consumes cached no-data and refuses a cached engine ledger', async () => {
  const f = fixture({symbol:'EMPTY',timeframe:'60'});
  const dispose = observeWorkspaceHistory(f.workspace);
  f.chart.emit('load:end', {...f.chart.market,bars:0});
  f.chart.emit('history:complete', {reason:'depth',barsLoaded:0,oldestTime:0});
  await f.adapter.bootstrap();
  const s = await f.add('late-empty');
  assert.equal(s.status,'no-data'); assert.equal(s.trades,null); assert.equal(s.capabilities.tradeLedger,false);
  f.adapter.destroy(); dispose();
});
test('late adapter cached aborted zero bars is not successful no-data', async () => {
  const f=fixture({symbol:'AAA',timeframe:'60'});
  const dispose=observeWorkspaceHistory(f.workspace);
  f.chart.emit('history:complete',{reason:'aborted',barsLoaded:0,oldestTime:0});
  await f.adapter.bootstrap(); const s=await f.add('late-aborted-empty');
  assert.equal(s.status,'partial'); assert.equal(s.history.reason,'aborted');
  f.adapter.destroy(); dispose();
});
test('retrying an aborted cell without market bars preserves the 2000-bar startup depth', async () => {
  const f = fixture({ symbol: 'AAA', timeframe: '60' });
  const dispose = observeWorkspaceHistory(f.workspace);
  f.complete('aborted');
  await f.adapter.bootstrap();
  const snapshot = await f.add('retry-depth');
  assert.equal(snapshot.history.reason, 'aborted');
  await f.adapter.retry(snapshot.key);
  assert.equal(f.setMarketCalls.at(-1)?.bars, 2000);
  assert.deepEqual(f.setMarketCalls.at(-1)?.data, []);
  f.adapter.destroy(); dispose();
});
test('late adapter invalidates cached depth on bars-only requested change without load:start', async () => {
  const f=fixture({symbol:'AAA',timeframe:'60',bars:12});
  const dispose=observeWorkspaceHistory(f.workspace);
  f.complete('depth'); f.chart.emit('market:changed',f.chart.market);
  await f.adapter.bootstrap(); const initial=await f.add('depth-only');
  assert.equal(initial.status,'ready');
  f.chart.emit('load:end',{...f.chart.market,bars:0});
  assert.equal(f.adapter.getSnapshot(initial.key).status,'ready');
  f.chart.market={...f.chart.market,bars:24};
  f.chart.emit('history:progress',{loaded:18,target:24});
  const pending=f.adapter.getSnapshot(initial.key);
  assert.equal(pending.status,'waiting-data'); assert.equal(pending.history.loaded,18); assert.equal(pending.history.target,24);
  f.chart.emit('history:complete',{reason:'depth',barsLoaded:24,oldestTime:500});
  await settle();
  assert.equal(f.adapter.getSnapshot(initial.key).history.barsLoaded,24);
  f.adapter.destroy(); dispose();
});
test('market commit before deep completion keeps cached and adapter history open', async () => {
  const f=fixture({symbol:'AAA',timeframe:'60',bars:5000});
  const dispose=observeWorkspaceHistory(f.workspace);
  f.chart.emit('history:progress',{loaded:200,target:5000});
  f.chart.emit('market:changed',f.chart.market);
  await f.adapter.bootstrap(); const initial=await f.add('deep-commit');
  assert.equal(initial.status,'partial');
  f.chart.emit('history:progress',{loaded:4000,target:5000});
  f.chart.emit('history:complete',{reason:'depth',barsLoaded:5000,oldestTime:1});
  await settle();
  const settled=f.adapter.getSnapshot(initial.key);
  assert.equal(settled.history.barsLoaded,5000); assert.equal(settled.status,'ready');
  f.chart.emit('history:complete',{reason:'aborted',barsLoaded:0,oldestTime:0});
  assert.equal(f.adapter.getSnapshot(initial.key).history.reason,'depth');
  f.adapter.destroy(); dispose();
});
test('silent setMarket depth request immediately revokes old final report before any event', async () => {
  const f=fixture({symbol:'AAA',timeframe:'60',bars:12});
  const dispose=observeWorkspaceHistory(f.workspace);
  f.complete('depth');f.chart.emit('market:changed',f.chart.market);
  await f.adapter.bootstrap();const initial=await f.add('silent-depth');
  assert.equal(initial.status,'ready');
  const pending=f.chart.setMarket({bars:2000});
  const current=f.adapter.getSnapshot(initial.key);
  assert.equal(current.status,'waiting-data');assert.equal(current.finality,'partial-history');
  assert.equal(current.trades,null);assert.equal(current.history.complete,false);
  assert.equal(current.capabilities.tradeLedger,false);
  await pending;f.adapter.destroy();dispose();
});

for (const reason of ['depth', 'genesis', 'aborted']) {
  test(`D01 construction-started load inherits ${reason} without a load:start subscription`, async () => {
    const f = fixture({ symbol: 'BINANCE:BTCUSDT', timeframe: '15' });
    await f.adapter.bootstrap();
    // Vela starts its initial load in the constructor, before the adapter is
    // mountable. No synthetic load:start is injected for this generation.
    f.chart.emit('history:progress', { loaded: 5, target: 12 });
    f.complete(reason);
    const s = await f.add('initial-generation');
    assert.equal(s.history.reason, reason);
    assert.equal(s.history.barsLoaded, 12);
    assert.equal(s.finality, reason === 'aborted' ? 'partial-history' : 'historical-final');
    if (reason !== 'aborted') {
      assert.equal(s.status, 'ready');
      assert.equal(mapSnapshot(s).trades.length, 1);
    }
    f.adapter.destroy();
  });
}
for (const reason of ['depth', 'genesis']) {
  test(`R04 late-added strategy inherits observed ${reason} history even without a tick`, async () => {
    const f = fixture(); await f.adapter.bootstrap(); f.complete(reason); await settle();
    const snapshot = await f.add('late');
    assert.equal(snapshot.history.reason, reason);
    assert.equal(snapshot.history.barsLoaded, 12);
    assert.equal(snapshot.finality, 'historical-final');
    assert.equal(mapSnapshot(snapshot).trades.length, 1);
    f.adapter.destroy();
  });
}
test('R04 abort is inherited but never promoted to final by readiness', async () => {
  const f = fixture(); await f.adapter.bootstrap(); f.complete('aborted'); await settle();
  const s = await f.add('after-abort');
  assert.equal(s.history.reason, 'aborted');
  assert.equal(s.finality, 'partial-history');
  assert.equal(mapSnapshot(s).trades.length, 0); f.adapter.destroy();
});
for (const event of ['load:start', 'market:changed']) {
  test(`R04 ${event} discards the preceding market's cached completion`, async () => {
    const f = fixture(); await f.adapter.bootstrap(); f.complete('depth');
    f.chart.emit(event); const s = await f.add('new-market');
    assert.notEqual(s.finality, 'historical-final');
    assert.equal(s.history.reason, null);
    f.complete('genesis'); await settle();
    assert.equal(f.adapter.getSnapshot(s.key).finality, 'historical-final'); f.adapter.destroy();
  });
}
test('R04 new strategy inherits in-progress coverage, not a completed old head', async () => {
  const f = fixture(); await f.adapter.bootstrap(); f.complete('depth');
  f.chart.emit('history:progress', { loaded: 4, target: 30 });
  const s = await f.add('during-backfill');
  assert.equal(s.history.loaded, 4); assert.equal(s.history.target, 30);
  assert.equal(s.finality, 'partial-history'); f.adapter.destroy();
});
test('R04 missed completion remains unknown; a void Promise is not success evidence', async () => {
  const f = fixture(); f.complete('depth'); await f.adapter.bootstrap();
  const s = await f.add('after-subscription');
  assert.equal(s.finality, 'unknown'); f.adapter.destroy();
});
test('R04 Vela closing market:changed does not erase completion of the matching load', async () => {
  const f = fixture(); await f.adapter.bootstrap(); f.complete('depth');
  const market = { symbol: 'BTCUSDT', timeframe: '60' };
  f.chart.emit('load:start', market); f.complete('genesis');
  f.chart.emit('market:changed', market);
  const s = await f.add('after-switch');
  assert.equal(s.finality, 'historical-final');
  assert.equal(s.history.reason, 'genesis'); f.adapter.destroy();
});
test('R04 hide/show strategy preserves the same chart load coverage', async () => {
  const f = fixture(); await f.adapter.bootstrap(); f.complete('depth');
  const original = await f.add('toggle');
  f.chart.emit('indicator:visibility', { id: 'toggle', visible: false });
  f.chart.emit('indicator:visibility', { id: 'toggle', visible: true }); await settle();
  const snapshot = f.adapter.getSnapshot(original.key);
  assert.equal(snapshot.finality, 'historical-final');
  assert.equal(mapSnapshot(snapshot).trades.length, 1); f.adapter.destroy();
});

for (const sameSymbol of [false, true]) {
  for (const beforeEnd of [false, true]) {
    test(`S01 superseded requested market keeps winner history (sameSymbol=${sameSymbol}, completionBeforeEnd=${beforeEnd})`, async () => {
      const f = fixture();
      f.chart.market = { symbol: 'AAA', timeframe: '60' };
      await f.adapter.bootstrap(); f.complete('depth');
      await f.add('overlap');
      f.chart.market = { symbol: 'BBB', timeframe: '60' };
      f.chart.emit('load:start', f.chart.market);
      f.chart.market = { symbol: sameSymbol ? 'BBB' : 'CCC', timeframe: sameSymbol ? '1' : '60' };
      if (beforeEnd) f.complete('genesis');
      f.chart.emit('load:end', { ...f.chart.market, bars: 12 });
      if (!beforeEnd) f.complete('genesis');
      f.chart.emit('market:changed', f.chart.market);
      await settle();
      const s = await f.add('winner');
      assert.equal(s.history.reason, 'genesis');
      assert.equal(s.finality, 'historical-final');
      assert.equal(mapSnapshot(s).trades.length, 1);
      f.adapter.destroy();
    });
  }
}
test('S01 old context cannot publish while a superseding requested market has no events yet', async () => {
  const f = fixture(); f.chart.market = { symbol: 'AAA', timeframe: '60' };
  await f.adapter.bootstrap(); f.complete('depth');
  const s = await f.add('old-read');
  const handle = f.chart.handles[0]; const current = await handle.context();
  let resolve; handle.context = () => new Promise(r => { resolve = r; });
  f.chart.emit('indicator:visibility', { id: handle.id, visible: false });
  f.chart.emit('indicator:visibility', { id: handle.id, visible: true });
  await settle();
  f.chart.market = { symbol: 'CCC', timeframe: '60' };
  resolve(current); await settle();
  assert.notEqual(f.adapter.getSnapshot(s.key).ledgerState, 'ready');
  f.adapter.destroy();
});

test('R07 empty market keeps no-data through hide/show and rejects cached context', async () => {
  const f = fixture();
  f.chart.market = { symbol: 'EMPTY', timeframe: '60' };
  await f.adapter.bootstrap();
  f.complete('depth');
  const original = await f.add('empty-toggle');
  f.chart.emit('load:end', { symbol: 'EMPTY', timeframe: '60', bars: 0 });
  await settle();
  let snapshot = f.adapter.getSnapshot(original.key);
  assert.equal(snapshot.status, 'no-data');
  assert.equal(snapshot.trades, null);
  f.chart.emit('indicator:visibility', { id: original.key.indicatorId, visible: false });
  f.chart.emit('indicator:visibility', { id: original.key.indicatorId, visible: true });
  await settle();
  snapshot = f.adapter.getSnapshot(original.key);
  assert.equal(snapshot.status, 'no-data');
  assert.equal(snapshot.trades, null);
  assert.equal(snapshot.ledgerState, 'idle');
  assert.equal(mapSnapshot(snapshot).trades.length, 0);
  f.adapter.destroy();
});

test('R07 strategy added after EMPTY cannot publish cached report or run metadata', async () => {
  const f = fixture();
  f.chart.market = { symbol: 'EMPTY', timeframe: '60' };
  await f.adapter.bootstrap();
  f.chart.emit('load:end', { symbol: 'EMPTY', timeframe: '60', bars: 0 });
  await settle();
  const snapshot = await f.add('added-after-empty');
  assert.equal(snapshot.status, 'no-data');
  assert.equal(snapshot.ledgerState, 'idle');
  assert.equal(snapshot.capabilities.tradeLedger, false);
  assert.equal(snapshot.capabilities.exactEquityCurve, false);
  assert.equal(snapshot.trades, null);
  assert.equal(snapshot.run, null);
  assert.equal(snapshot.runToken, null);
  f.adapter.destroy();
});

test('R07 late old market/load/history events cannot overwrite the winning market', async () => {
  const f = fixture();
  f.chart.market = { symbol: 'AAA', timeframe: '60' };
  await f.adapter.bootstrap();
  f.complete('depth');
  const original = await f.add('late-old-events');

  f.chart.market = { symbol: 'BBB', timeframe: '60' };
  f.chart.emit('load:start', f.chart.market);
  f.chart.market = { symbol: 'CCC', timeframe: '60' };
  f.chart.emit('load:end', { ...f.chart.market, bars: 10 });
  f.complete('genesis');
  f.chart.emit('market:changed', f.chart.market);
  await settle();
  // The old cached context cannot prove CCC executed. Model the new strategy
  // completion explicitly before evaluating immunity to late BBB events.
  assert.notEqual(f.adapter.getSnapshot(original.key).status, 'ready');
  f.workspace.emit('script:run', {cell:original.key.cellId,id:original.key.indicatorId,kind:'strategy',complete:true,cause:'bars',strategy:{netPnl:4,initialCapital:1000},trades:async()=>(await f.chart.handles[0].context()).trades});
  await settle();
  const winner = f.adapter.getSnapshot(original.key);
  assert.equal(winner.history.reason, 'genesis');
  assert.equal(winner.status, 'ready');

  // Responses belonging to the superseded BBB request arrive after CCC won.
  f.chart.emit('load:end', { symbol: 'BBB', timeframe: '60', bars: 0 });
  f.chart.emit('history:progress', { loaded: 1, target: 99 });
  f.complete('aborted');
  await settle();
  const after = f.adapter.getSnapshot(original.key);
  assert.equal(after.history.reason, 'genesis');
  assert.equal(after.history.barsLoaded, winner.history.barsLoaded);
  assert.equal(after.status, 'ready');
  assert.equal(after.trades?.length, winner.trades?.length);
  f.adapter.destroy();
});
