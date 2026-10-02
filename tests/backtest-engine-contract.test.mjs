import assert from 'node:assert/strict';
import test from 'node:test';

import { VelaBacktestResultsAdapter } from '../src/integrations/vela/backtest-results-adapter.ts';

class Emitter {
  listeners = new Map();

  on(type, listener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
    return () => set.delete(listener);
  }

  emit(type, payload) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(payload);
  }
}

class Handle extends Emitter {
  constructor(id, context) {
    super();
    this.id = id;
    this.title = 'Contract strategy';
    this.source = 'strategy("Contract strategy")';
    this.nativeType = undefined;
    this.visible = true;
    this.inputs = [{ key: 'length', title: 'Length', type: 'int', defval: 20 }];
    this.props = [{ key: 'initial_capital', title: 'Initial capital', type: 'float', defval: 1000 }];
    this.inputBag = { length: 55 };
    this.propBag = { initial_capital: 2500 };
    this.snapshot = context;
  }

  inputValues() {
    return { ...this.inputBag };
  }

  propValues() {
    return { ...this.propBag };
  }

  context() {
    return Promise.resolve(this.snapshot);
  }
}

class Chart extends Emitter {
  constructor(handle) {
    super();
    this.handle = handle;
    this.history = Promise.resolve();
  }

  indicators() {
    return this.handle ? [this.handle] : [];
  }

  historyComplete() {
    return this.history;
  }
}

class Workspace extends Emitter {
  constructor(chart) {
    super();
    this.cellValue = { id: 'cell-1', chart };
  }

  cells() {
    return [this.cellValue];
  }

  cell(id) {
    return id === this.cellValue.id ? this.cellValue : undefined;
  }
}

const strategyContext = {
  language: 'pine',
  phase: 'idle',
  barIndex: 42,
  meta: { title: 'Contract strategy', overlay: true },
  plots: { equityPlot: [{ time: 1000, value: 1000 }] },
  variables: {},
  strategy: {
    position: 1,
    avgPrice: 100,
    equity: 1010,
    openPnl: 10,
    netPnl: 10,
    grossProfit: 10,
    grossLoss: 0,
    wins: 1,
    losses: 0,
    even: 0,
    maxDrawdown: 2,
    maxRunup: 12,
    initialCapital: 1000,
  },
  trades: [],
  warnings: [],
};

const run = {
  cell: 'cell-1',
  id: 'strategy-1',
  title: 'Contract strategy',
  kind: 'strategy',
  cause: 'history',
  first: true,
  bar: 42,
  time: 2000,
  forming: false,
  complete: true,
  plots: { equityPlot: 1010 },
  vars: {},
  strategy: strategyContext.strategy,
  warnings: [],
  trades: async () => [],
  series: async (key) => key === 'equityPlot'
    ? [{ time: 1000, value: 1000 }, { time: 2000, value: 1010 }]
    : [],
};

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

test('snapshot carries public Inputs/Properties and bounded execution metadata', async () => {
  const handle = new Handle('strategy-1', strategyContext);
  const workspace = new Workspace(new Chart(handle));
  const adapter = new VelaBacktestResultsAdapter(workspace);
  await adapter.bootstrap();
  await flush();

  const snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-1' });
  assert.ok(snapshot);
  assert.deepEqual(snapshot.inputs.values, { length: 55 });
  assert.equal(snapshot.inputs.schema[0].key, 'length');
  assert.deepEqual(snapshot.props.values, { initial_capital: 2500 });
  assert.equal(snapshot.props.schema[0].key, 'initial_capital');
  assert.deepEqual(snapshot.execution, {
    barIndex: 42,
    time: null,
    phase: 'idle',
    seriesKeys: ['equityPlot'],
  });

  workspace.emit('script:run', run);
  await flush();
  const afterRun = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-1' });
  assert.equal(afterRun.execution.barIndex, 42);
  assert.equal(afterRun.execution.time, 2000);
  assert.deepEqual(afterRun.execution.seriesKeys, ['equityPlot']);
  adapter.destroy();
});

test('readSeries uses public ScriptRun.series and drops a late result', async () => {
  let resolveSeries;
  const handle = new Handle('strategy-series', strategyContext);
  const chart = new Chart(handle);
  const workspace = new Workspace(chart);
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const events = [];
  adapter.subscribe((event) => events.push(event));
  await adapter.bootstrap();
  workspace.emit('script:run', {
    ...run,
    id: 'strategy-series',
    series: async () => new Promise((resolve) => { resolveSeries = resolve; }),
  });
  await flush();

  const pending = adapter.readSeries({ cellId: 'cell-1', indicatorId: 'strategy-series' }, 'equityPlot');
  // A newer run invalidates the old read before its promise resolves.
  workspace.emit('script:run', { ...run, id: 'strategy-series', bar: 43, time: 3000 });
  resolveSeries([{ time: 1000, value: 1000 }]);
  assert.equal(await pending, null);
  assert.ok(events.some((event) => event.type === 'stale-drop' && /series resolved/.test(event.reason)));
  adapter.destroy();
});
