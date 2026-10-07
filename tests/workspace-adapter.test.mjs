import test from 'node:test';
import assert from 'node:assert/strict';
import { getNativeIndicator } from '@luxalgo/vela';
import { focusBacktestExecution, clearBacktestExecutionFocus } from '../src/integrations/vela/backtest-chart-adapter.ts';
import { BACKTEST_EXECUTION_HIGHLIGHT_TYPE } from '../src/domain/ports/workspace-port.ts';

function setup({ unsupported = false } = {}) {
  const calls = [], listeners = new Map();
  let native;
  let failRange = false;
  const source = { id: 'strategy-1' };
  const on = (event, fn) => {
    const set = listeners.get(event) ?? new Set();
    set.add(fn); listeners.set(event, set);
    return () => set.delete(fn);
  };
  const chart = {
    market: { symbol: 'binance:BTCUSDT', timeframe: '15' },
    indicators: () => [source, ...(native ? [native] : [])],
    setVisibleRange: range => {
      if (failRange) throw new Error('Injected range failure');
      calls.push({ kind: 'range', range });
    },
    on,
    renderer: {
      supportsExternalCrosshair: true,
      setExternalCrosshair: (...args) => calls.push({ kind: 'crosshair', args }),
    },
    addNativeIndicator(type) {
      if (unsupported) throw Error('Unsupported annotation backend');
      const descriptor = getNativeIndicator(type);
      assert.equal(descriptor.legend, false);
      const instance = descriptor.create();
      native = { id: 'highlight', nativeType: type, remove() { native = null; instance.stop(); } };
      instance.start({ emit: value => calls.push({ kind: 'label', value }), setStatus() {} });
      return native;
    },
  };
  const cell = { symbol: 'binance:BTCUSDT', timeframe: '15', chart,
    history: { silently: fn => { calls.push({ kind: 'silent' }); return fn(); } },
    focus: () => calls.push({ kind: 'focus' }) };
  const workspace = { cell: id => id === 'cell-1' ? cell : undefined,
    setActiveCell: id => calls.push({ kind: 'active', id }), on };
  const input = { cellId: 'cell-1', indicatorId: source.id, symbol: cell.symbol,
    timeframe: cell.timeframe, time: Date.UTC(2024, 0, 1, 12), price: 101.25,
    tradeNumber: 7, direction: 'long', side: 'entry' };
  const emit = (name, data) => [...(listeners.get(name) ?? [])].forEach(fn => fn(data));
  return { workspace, cell, chart, calls, input, emit, listeners,
    setRangeFailure(value) { failRange = value; } };
}

test('trade location frames 60 bars and paints a transient reference label without registering a catalog entry', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { workspace, chart, calls, input } = setup();
  assert.equal(focusBacktestExecution(workspace, input), true);
  assert.deepEqual(calls.find(c => c.kind === 'range').range, {
    from: input.time - 54_000_000, to: input.time + 54_000_000,
  });
  const label = calls.find(c => c.kind === 'label').value.labels[0];
  assert.equal(label.text, 'Trade #7 · Long entry\nJan 01, 2024, 12:00');
  assert.equal(label.color, '#2962ff');
  assert.equal(label.yloc, 'abovebar');
  assert.deepEqual(calls.find(c => c.kind === 'crosshair').args, [input.time, 101.25]);
  assert.equal(getNativeIndicator(BACKTEST_EXECUTION_HIGHLIGHT_TYPE), undefined);
  t.mock.timers.tick(3999);
  assert.equal(chart.indicators().length, 2);
  t.mock.timers.tick(1);
  assert.equal(chart.indicators().length, 1);
  assert.equal(calls.filter(c => c.kind === 'silent').length, 1, 'native removal bypasses user undo');
  assert.deepEqual(calls.at(-1), { kind: 'crosshair', args: [null] });
});

test('new location replaces its old annotation and all lifecycle exits clean only owned state', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const event of ['load:start', 'market:changed', 'cell:active', 'indicator:removed', 'dispose']) {
    const { workspace, chart, calls, input, emit, listeners } = setup();
    focusBacktestExecution(workspace, input);
    focusBacktestExecution(workspace, { ...input, side: 'exit', time: input.time + 900000 });
    assert.equal(chart.indicators().length, 2);
    assert.match(calls.filter(c => c.kind === 'label').at(-1).value.labels[0].text, /Long exit/);
    if (event === 'dispose') clearBacktestExecutionFocus(workspace);
    else emit(event, { id: event === 'indicator:removed' ? input.indicatorId : 'other-cell' });
    assert.equal(chart.indicators().length, 1, event);
    assert.equal([...listeners.values()].reduce((n, set) => n + set.size, 0), 0);
    const count = calls.length;
    t.mock.timers.tick(8000);
    assert.equal(calls.length, count, 'no late timer after cleanup');
  }
});

test('failed chart navigation leaves an existing execution annotation and report lifecycle untouched', () => {
  const { workspace, chart, input, calls, setRangeFailure } = setup();
  assert.equal(focusBacktestExecution(workspace, input), true);
  const before = chart.indicators();
  setRangeFailure(true);
  assert.throws(() => focusBacktestExecution(workspace, { ...input, time: input.time + 900000 }), /range failure/);
  assert.deepEqual(chart.indicators(), before, 'a failed range must not clear the prior marker');
  assert.equal(calls.filter(call => call.kind === 'active').length, 2);
  assert.equal(calls.filter(call => call.kind === 'range').length, 1);
});

test('old requested market, missing strategy/cell and invalid time cannot navigate', () => {
  for (const change of [
    { cellId: 'missing' }, { indicatorId: 'removed' }, { symbol: 'binance:ETHUSDT' },
    { timeframe: '5' }, { time: Number.NaN }, { time: Number.MAX_VALUE },
  ]) {
    const { workspace, calls, input } = setup();
    assert.equal(focusBacktestExecution(workspace, { ...input, ...change }), false);
    assert.equal(calls.length, 0);
  }
  const { workspace, chart, calls, input } = setup();
  chart.market = { symbol: 'binance:ETHUSDT', timeframe: '5' };
  assert.equal(focusBacktestExecution(workspace, input), false);
  assert.equal(calls.length, 0, 'requested identity wins over stale shell cell');
});

test('unsupported optional annotation/crosshair still leaves viewport navigation and focus usable', () => {
  const { workspace, calls, input, chart } = setup({ unsupported: true });
  chart.renderer.supportsExternalCrosshair = false;
  assert.equal(focusBacktestExecution(workspace, input), true);
  assert.equal(calls.filter(c => c.kind === 'range').length, 1);
  assert.equal(calls.at(-1).kind, 'focus');
  assert.equal(getNativeIndicator(BACKTEST_EXECUTION_HIGHLIGHT_TYPE), undefined);
});
