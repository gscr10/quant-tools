import test from 'node:test';
import assert from 'node:assert/strict';
import { observeWorkspaceHistory, observedWorkspaceHistory, subscribeWorkspaceHistoryRequests } from '../src/integrations/vela/workspace-history-observer.ts';

class Bus {
  listeners = new Map();
  on(event, fn) { const set = this.listeners.get(event) ?? new Set(); set.add(fn); this.listeners.set(event, set); return () => set.delete(fn); }
  emit(event, data) { for (const fn of this.listeners.get(event) ?? []) fn(data); }
  count() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
}
function setup(setMarket) {
  const chart = Object.assign(new Bus(), { setMarket, market: {symbol: 'AAA', timeframe: '60', bars: 36, offline: true} });
  const cell = {id: 'a', chart}; const cells = [cell];
  const workspace = Object.assign(new Bus(), {cells: () => cells});
  const dispose = observeWorkspaceHistory(workspace);
  return {chart, cell, cells, workspace, dispose, read: () => observedWorkspaceHistory(workspace, cell)};
}
for (const reason of ['depth', 'genesis', 'aborted']) test(`history observer retains reason-bearing ${reason}`, () => {
  const f = setup();
  f.chart.emit('history:complete', {reason, oldestTime: 1, barsLoaded: 36});
  assert.equal(f.read().historyReason, reason);
  assert.equal(f.read().historyBarsLoaded, 36);
  assert.equal(Object.isFrozen(f.read()), true);
  f.dispose(); assert.equal(f.chart.count(), 0); assert.equal(f.workspace.count(), 0); assert.equal(f.read(), null);
});
test('history observer rejects old market end and closed-generation anonymous events', () => {
  const f = setup(); f.chart.market = {...f.chart.market, symbol:'BBB'};
  assert.equal(f.read(), null);
  f.chart.emit('load:start', f.chart.market);
  f.chart.market = {...f.chart.market, symbol:'CCC'};
  f.chart.emit('history:complete', {reason:'depth', oldestTime:1,barsLoaded:36});
  f.chart.emit('load:end', {...f.chart.market, bars:36});
  f.chart.emit('market:changed', f.chart.market);
  f.chart.emit('load:end', {symbol:'BBB',timeframe:'60',bars:0});
  f.chart.emit('history:complete', {reason:'aborted',oldestTime:0,barsLoaded:0});
  assert.equal(f.read().historyReason, 'depth'); assert.equal(f.read().noData, false);
  f.dispose();
});
test('history observer invalidates depth and chart replacements and owns new-cell teardown', () => {
  const f = setup(); f.chart.emit('history:complete', {reason:'depth',oldestTime:1,barsLoaded:36});
  f.chart.market.bars = 100; assert.equal(f.read(), null);
  f.chart.emit('history:progress', {loaded:36,target:100});
  assert.equal(f.read().historyComplete, false);
  const next = Object.assign(new Bus(), {market:{...f.chart.market}});
  f.cell.chart = next; f.workspace.emit('layout:changed');
  assert.equal(f.chart.count(), 0); assert.equal(f.read().historyReason, null);
  next.emit('load:end', {...next.market,bars:0}); assert.equal(f.read().noData,true);
  f.workspace.emit('cell:destroyed', {id:'a'}); assert.equal(next.count(),0); assert.equal(f.read(),null);
  f.dispose();
});
test('destroyed cell getter is not accessed after observer teardown', () => {
  const f=setup(); f.dispose();
  Object.defineProperty(f.cell,'chart',{get(){throw Error('destroyed');}});
  assert.equal(f.read(),null);
});
test('silent depth request invalidates synchronously, preserves Promise and restores owned method', async () => {
  const pending=Promise.resolve();
  function original(next){this.market={...this.market,...next};return pending;}
  const f=setup(original);
  f.chart.emit('history:complete',{reason:'depth',barsLoaded:36,oldestTime:1});
  f.chart.emit('market:changed',f.chart.market);
  let calls=0; const unsubscribe=subscribeWorkspaceHistoryRequests(f.workspace,f.cell,()=>calls++);
  assert.equal(f.chart.setMarket({bars:2000}),pending);
  assert.equal(calls,1);assert.equal(f.read().historyComplete,false);assert.equal(f.read().historyBarsLoaded,null);
  assert.equal(f.chart.setMarket({bars:2000}),pending);assert.equal(calls,1);
  unsubscribe();f.chart.setMarket({bars:3000});assert.equal(calls,1);
  f.dispose();assert.equal(f.chart.setMarket,original);
  await pending;
});
test('later method owner survives observer teardown and rejected Promise is unchanged', async () => {
  const failure=Promise.reject(Error('expected market failure'));
  function original(){return failure;}
  const f=setup(original), wrapped=f.chart.setMarket;
  function later(next){return wrapped.call(this,next);}
  f.chart.setMarket=later;
  assert.equal(f.chart.setMarket({bars:2000}),failure);
  await assert.rejects(failure,/expected market failure/);
  f.dispose();assert.equal(f.chart.setMarket,later);
});
