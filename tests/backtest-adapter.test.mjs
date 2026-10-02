import assert from 'node:assert/strict';
import test from 'node:test';

import { VelaBacktestResultsAdapter } from '../src/integrations/vela/backtest-results-adapter.ts';

class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class Emitter {
  #listeners = new Map();

  on(type, listener) {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
    return () => listeners.delete(listener);
  }

  emit(type, payload = {}) {
    for (const listener of [...(this.#listeners.get(type) ?? [])]) listener(payload);
  }

  // Capture the listener set at dispatch time. This models a browser/worker
  // event already queued while the chart binding is being replaced; invoking
  // the returned function after replacement must not mutate the new binding.
  defer(type, payload = {}) {
    const listeners = [...(this.#listeners.get(type) ?? [])];
    return () => {
      for (const listener of listeners) listener(payload);
    };
  }
}

class FakeHandle extends Emitter {
  constructor(id, title, context) {
    super();
    this.id = id;
    this.title = title;
    this.source = `strategy("${title}")`;
    this.nativeType = undefined;
    this.inputs = [];
    this.props = [];
    this.visible = true;
    this.contextDeferred = context;
    this.contextCalls = 0;
  }

  context() {
    this.contextCalls += 1;
    return this.contextDeferred.promise;
  }
}

class SequenceHandle extends FakeHandle {
  constructor(id, title, contexts) {
    // The base class only needs a deferred-like value for construction; this
    // subclass returns the supplied snapshots in order so a test can model a
    // worker moving from `computing` to an idle, settled context.
    super(id, title, new Deferred());
    this.contexts = [...contexts];
    this.contextCalls = 0;
  }

  context() {
    const index = Math.min(this.contextCalls, this.contexts.length - 1);
    this.contextCalls += 1;
    return Promise.resolve(this.contexts[index] ?? null);
  }
}

class RoutedContextHandle extends FakeHandle {
  constructor(id, title, { full, summary, tail }) {
    super(id, title, new Deferred());
    this.full = full;
    this.summary = summary ?? full;
    this.tail = tail ?? summary ?? full;
    this.contextCalls = 0;
  }

  context(select = []) {
    this.contextCalls += 1;
    if (select.includes('reportSeries')) return Promise.resolve(this.full);
    if (select.includes('reportTail')) return Promise.resolve(this.tail);
    return Promise.resolve(this.summary);
  }
}

class DeferredBootstrapHandle extends RoutedContextHandle {
  constructor(id, title, contexts, firstFull) {
    super(id, title, contexts);
    this.firstFull = firstFull;
    this.waitingForBootstrap = true;
  }

  context(select = []) {
    this.contextCalls += 1;
    if (select.includes('reportSeries')) {
      if (this.waitingForBootstrap) {
        this.waitingForBootstrap = false;
        return this.firstFull.promise;
      }
      return Promise.resolve(this.full);
    }
    if (select.includes('reportTail')) return Promise.resolve(this.tail);
    return Promise.resolve(this.summary);
  }
}

class FakeChart extends Emitter {
  constructor(handle, history = new Deferred()) {
    super();
    this.handles = handle ? [handle] : [];
    this.history = history;
  }

  indicators() {
    return this.handles;
  }

  historyComplete() {
    return this.history.promise;
  }
}

class FakeWorkspace extends Emitter {
  constructor(cell) {
    super();
    this.currentCells = [cell];
  }

  cells() {
    return this.currentCells;
  }

  cell(id) {
    return this.currentCells.find((candidate) => candidate.id === id);
  }
}

function strategyContext(title) {
  return {
    meta: { title, overlay: true },
    strategy: {
      position: 0,
      avgPrice: 0,
      equity: 1_000,
      openPnl: 0,
      netPnl: 0,
      grossProfit: 0,
      grossLoss: 0,
      wins: 0,
      losses: 0,
      even: 0,
      maxDrawdown: 0,
      maxRunup: 0,
      initialCapital: 1_000,
    },
    trades: [],
    warnings: [],
  };
}

function workerProvenance(overrides = {}) {
  return {
    execution: 'worker',
    engine: {
      schemaVersion: 1,
      packageName: 'pinets',
      packageVersion: '0.9.34',
      upstreamSha: 'beacd587e83aa7ee061023f8cea66b2e887d5676',
      localPatchRevision: 'quant-tools-g8.1',
      reportSchemaVersion: 4,
      sentinel: 'pinets-local-build-v1',
      buildFingerprint: 'pinets-test-fingerprint',
    },
    bridge: {
      schemaVersion: 1,
      packageName: '@luxalgo/vela-pinets',
      packageVersion: '0.2.13',
      upstreamSha: 'a2a2097be8f30b4b596b13212ed4608c36c2ea26',
      localPatchRevision: 'quant-tools-g8.1',
      reportSchemaVersion: 4,
      sentinel: 'vela-pinets-local-build-v1',
      buildFingerprint: 'vela-pinets-test-fingerprint',
      bridgeSha: 'a2a2097be8f30b4b596b13212ed4608c36c2ea26',
      embeddedPinetsSha: 'beacd587e83aa7ee061023f8cea66b2e887d5676',
      embeddedPinetsFingerprint: 'pinets-test-fingerprint',
    },
    buildFingerprint: 'vela-pinets-test-fingerprint|engine=pinets-test-fingerprint',
    workerFingerprint: 'vela-pinets-test-fingerprint|engine=pinets-test-fingerprint|execution=worker',
    sentinel: 'vela-pinets-local-build-v1|pinets-local-build-v1',
    ...overrides,
  };
}

function reportPoint(overrides = {}) {
  return {
    barIndex: 0,
    time: 1_000,
    equity: 1_000,
    realizedPnl: 0,
    openPnl: 0,
    underwater: 0,
    underwaterPercent: 0,
    maxDrawdown: 0,
    maxDrawdownPercent: 0,
    benchmarkEquity: null,
    benchmarkPnl: null,
    benchmarkReturnPercent: null,
    ...overrides,
  };
}

function reportContext(runId = 'engine-run-1', revision = 1, points = [reportPoint()]) {
  const context = strategyContext('Series strategy');
  return {
    ...context,
    phase: 'idle',
    barIndex: points.at(-1)?.barIndex ?? -1,
    strategy: {
      ...context.strategy,
      reportRunId: runId,
      reportSnapshotRevision: revision,
      reportPointCount: points.length,
    },
    reportSeries: {
      schemaVersion: 1,
      runId,
      snapshotRevision: revision,
      barIndex: points.at(-1)?.barIndex ?? -1,
      points,
    },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function bootstrapContext(context, id = 'strategy-provenance') {
  const contextDeferred = new Deferred();
  const history = new Deferred();
  const handle = new FakeHandle(id, 'Provenance strategy', contextDeferred);
  const chart = new FakeChart(handle, history);
  const workspace = new FakeWorkspace({ id: 'cell-1', chart });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const bootstrap = adapter.bootstrap();
  contextDeferred.resolve(context);
  history.resolve();
  await bootstrap;
  await flush();
  const snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: id });
  adapter.destroy();
  return snapshot;
}

test('extracts a validated Worker build provenance from the engine context', async () => {
  const provenance = workerProvenance();
  const snapshot = await bootstrapContext({
    ...strategyContext('Provenance strategy'),
    provenance,
  });

  assert.ok(snapshot);
  assert.deepEqual(snapshot.provenance, provenance);
  assert.equal(snapshot.provenance.execution, 'worker');
  assert.equal(snapshot.provenance.engine.upstreamSha, provenance.engine.upstreamSha);
  assert.equal(snapshot.provenance.bridge.embeddedPinetsSha, provenance.engine.upstreamSha);
  assert.equal(snapshot.provenance.workerFingerprint, provenance.workerFingerprint);
  assert.ok(Object.isFrozen(snapshot.provenance));
  assert.ok(Object.isFrozen(snapshot.provenance.engine));
  assert.ok(Object.isFrozen(snapshot.provenance.bridge));
});

test('publishes identity-bound PineTS audit orders/fills and enables raw capabilities', async () => {
  const context = reportContext('audit-run', 4, [reportPoint({ barIndex: 3, time: 4_000 })]);
  context.auditLedger = {
    schemaVersion: 1,
    runId: 'audit-run',
    snapshotRevision: 4,
    barIndex: 3,
    sequence: 4,
    orderEvents: [
      {
        eventId: 'event-1', orderId: 'order-1', sourceOrderId: 'L', kind: 'created',
        barIndex: 1, time: 2_000, direction: 1, qty: 2, orderType: 'market', category: 'entry',
        requestedQty: 2, cumulativeFillQty: 0, remainingQty: 2, fillSequence: 0, isPartial: true,
      },
      {
        eventId: 'event-2', orderId: 'order-1', sourceOrderId: 'L', kind: 'filled',
        barIndex: 2, time: 3_000, direction: 1, qty: 2, orderType: 'market', category: 'entry',
        fillPrice: 101, fillQty: 2, tradeIds: ['trade-1'], requestedQty: 2,
        cumulativeFillQty: 2, remainingQty: 0, fillSequence: 1, isPartial: false,
      },
    ],
    fillEvents: [
      {
        fillId: 'fill-1', orderId: 'order-1', sourceOrderId: 'L', barIndex: 2, time: 3_000,
        direction: 1, qty: 2, price: 101, orderType: 'market', category: 'entry', tradeIds: ['trade-1'],
        requestedQty: 2, cumulativeQty: 2, remainingQty: 0, fillSequence: 1, isPartial: false,
      },
    ],
  };
  const snapshot = await bootstrapContext(context, 'audit-strategy');
  assert.ok(snapshot);
  assert.equal(snapshot.auditState, 'ready');
  assert.equal(snapshot.capabilities.rawOrders, true);
  assert.equal(snapshot.capabilities.rawFills, true);
  assert.equal(snapshot.orders.length, 2);
  assert.equal(snapshot.fills.length, 1);
  assert.equal(snapshot.orders[1].parentOrderIds, undefined);
  assert.ok(Object.isFrozen(snapshot.auditLedger));
});

test('rejects an audit envelope from another run and never reuses it as raw capability', async () => {
  const context = reportContext('current-run', 2, [reportPoint({ barIndex: 1, time: 2_000 })]);
  context.auditLedger = {
    schemaVersion: 1,
    runId: 'stale-run',
    snapshotRevision: 1,
    barIndex: 1,
    sequence: 0,
    orderEvents: [],
    fillEvents: [],
  };
  const snapshot = await bootstrapContext(context, 'stale-audit-strategy');
  assert.ok(snapshot);
  assert.equal(snapshot.auditState, 'error');
  assert.equal(snapshot.capabilities.rawOrders, false);
  assert.equal(snapshot.capabilities.rawFills, false);
  assert.deepEqual(snapshot.orders, []);
  assert.deepEqual(snapshot.fills, []);
});

test('preserves Pine runtime/provider error metadata in adapter snapshots and events', async () => {
  const contextDeferred = new Deferred();
  const history = new Deferred();
  const handle = new FakeHandle('error-strategy', 'Error strategy', contextDeferred);
  const chart = new FakeChart(handle, history);
  const workspace = new FakeWorkspace({ id: 'cell-1', chart });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const events = [];
  adapter.subscribe((event) => events.push(event));
  const boot = adapter.bootstrap();
  contextDeferred.resolve(strategyContext('Error strategy'));
  history.resolve();
  await boot;
  await flush();

  const error = Object.assign(new Error('Array index 4 is out of bounds'), {
    name: 'PineRuntimeError',
    method: 'array.get',
    kind: 'pine-runtime',
  });
  chart.emit('indicator:error', { id: handle.id, error });
  const snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.equal(snapshot?.status, 'error');
  assert.deepEqual(snapshot?.errorDetails, {
    message: error.message,
    name: 'PineRuntimeError',
    kind: 'pine-runtime',
    method: 'array.get',
  });
  const event = events.find((candidate) => candidate.type === 'error');
  assert.deepEqual(event?.errorDetails, snapshot?.errorDetails);
  adapter.destroy();
});

test('accepts only truthful execution precision envelopes and exposes fallback state', async () => {
  const precision = {
    requested: true,
    applied: true,
    requestedPrecision: 'lower-timeframe',
    appliedPrecision: 'lower-timeframe',
    lowerTimeframe: '10',
    parentBars: 3,
    lowerBars: 18,
    coveredParentBars: 3,
    coverage: 1,
  };
  const applied = await bootstrapContext({
    ...strategyContext('Magnified strategy'),
    executionPrecision: precision,
  }, 'precision-applied');
  assert.ok(applied);
  assert.deepEqual(applied.execution.precision, precision);
  assert.equal(applied.capabilities.executionPrecision, 'lower-timeframe');
  assert.ok(Object.isFrozen(applied.execution.precision));

  const fallback = await bootstrapContext({
    ...strategyContext('Fallback strategy'),
    executionPrecision: {
      requested: true,
      applied: false,
      requestedPrecision: 'lower-timeframe',
      appliedPrecision: 'chart-ohlc',
      lowerTimeframe: '10',
      parentBars: 3,
      lowerBars: 0,
      coveredParentBars: 0,
      coverage: 0,
      fallbackReason: 'lower-data-empty',
    },
  }, 'precision-fallback');
  assert.ok(fallback);
  assert.equal(fallback.execution.precision.fallbackReason, 'lower-data-empty');
  assert.equal(fallback.capabilities.executionPrecision, 'chart-ohlc');

  const malformed = await bootstrapContext({
    ...strategyContext('Malformed precision strategy'),
    executionPrecision: {
      ...precision,
      applied: false,
      appliedPrecision: 'lower-timeframe',
    },
  }, 'precision-malformed');
  assert.ok(malformed);
  assert.equal(malformed.execution.precision, undefined);
  assert.equal(malformed.capabilities.executionPrecision, 'chart-ohlc');

  const missingReason = await bootstrapContext({
    ...strategyContext('Missing fallback reason strategy'),
    executionPrecision: {
      requested: true,
      applied: false,
      requestedPrecision: 'lower-timeframe',
      appliedPrecision: 'chart-ohlc',
      lowerTimeframe: '10',
      parentBars: 3,
      lowerBars: 0,
      coveredParentBars: 0,
      coverage: 0,
    },
  }, 'precision-missing-reason');
  assert.ok(missingReason);
  assert.equal(missingReason.execution.precision, undefined);

  const staleReason = await bootstrapContext({
    ...strategyContext('Applied stale reason strategy'),
    executionPrecision: {
      ...precision,
      fallbackReason: 'lower-data-empty',
    },
  }, 'precision-stale-reason');
  assert.ok(staleReason);
  assert.equal(staleReason.execution.precision, undefined);
});

test('advertises bar indices only for a complete accepted ledger revision', async () => {
  const complete = strategyContext('Indexed strategy');
  complete.phase = 'idle';
  complete.barIndex = 10;
  complete.trades = [{
    id: 'indexed-trade',
    side: 'long',
    qty: 1,
    entry: { id: 'entry', time: 1_000, price: 100 },
    entryBarIndex: 3,
    exit: { id: 'exit', time: 2_000, price: 110 },
    exitBarIndex: 7,
    open: false,
    pnl: 10,
  }];
  const accepted = await bootstrapContext(complete, 'indexed-ledger');
  assert.ok(accepted);
  assert.equal(accepted.ledgerState, 'ready');
  assert.equal(accepted.capabilities.barIndices, true);
  assert.equal(accepted.trades[0].entryBarIndex, 3);
  assert.equal(accepted.trades[0].exitBarIndex, 7);

  for (const [id, trade] of [
    ['missing-exit-index', { ...complete.trades[0], exitBarIndex: undefined }],
    ['fractional-entry-index', { ...complete.trades[0], entryBarIndex: 3.5 }],
    ['negative-entry-index', { ...complete.trades[0], entryBarIndex: -1 }],
    ['reversed-index-order', { ...complete.trades[0], entryBarIndex: 8 }],
    ['beyond-current-index', { ...complete.trades[0], exitBarIndex: 11 }],
  ]) {
    const malformed = { ...complete, trades: [trade] };
    const snapshot = await bootstrapContext(malformed, id);
    assert.ok(snapshot);
    assert.equal(snapshot.capabilities.barIndices, false, id);
  }
  const empty = await bootstrapContext({ ...complete, trades: [] }, 'empty-indexed-ledger');
  assert.ok(empty);
  assert.equal(empty.capabilities.barIndices, false);
});

test('does not carry an exact bar-index capability across a newer live revision', async () => {
  const context = strategyContext('Live indexed strategy');
  context.phase = 'idle';
  context.trades = [{
    id: 'live-indexed-trade',
    side: 'long',
    qty: 1,
    entry: { id: 'entry', time: 1_000, price: 100 },
    entryBarIndex: 2,
    exit: { id: 'exit', time: 2_000, price: 110 },
    exitBarIndex: 4,
    open: false,
    pnl: 10,
  }];
  const history = new Deferred();
  const handle = new RoutedContextHandle('live-indexed-ledger', 'Live indexed strategy', {
    full: context,
    summary: { ...context, phase: 'streaming' },
    tail: { ...context, phase: 'streaming' },
  });
  const chart = new FakeChart(handle, history);
  const workspace = new FakeWorkspace({ id: 'cell-1', chart });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const bootstrap = adapter.bootstrap();
  history.resolve();
  await bootstrap;
  await flush();
  assert.equal(
    adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id }).capabilities.barIndices,
    true,
  );

  workspace.emit('script:run', {
    cell: 'cell-1',
    id: handle.id,
    title: 'Live indexed strategy',
    kind: 'strategy',
    cause: 'tick',
    first: false,
    bar: 5,
    time: 3_000,
    forming: true,
    complete: false,
    strategy: context.strategy,
    warnings: [],
    trades: async () => context.trades,
  });
  await flush();
  assert.equal(
    adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id }).capabilities.barIndices,
    false,
  );
  adapter.destroy();
});

test('rejects incomplete or malformed Worker build provenance', async () => {
  const missingWorkerFingerprint = workerProvenance({ workerFingerprint: undefined });
  const malformedEngineSha = workerProvenance({
    engine: {
      ...workerProvenance().engine,
      upstreamSha: 'not-a-commit-sha',
    },
  });
  const mismatchedEmbeddedFingerprint = workerProvenance({
    bridge: {
      ...workerProvenance().bridge,
      embeddedPinetsFingerprint: 'different-engine-fingerprint',
    },
  });
  const mismatchedCombinedSentinel = workerProvenance({
    sentinel: 'vela-pinets-local-build-v1|old-pinets-sentinel',
  });

  for (const [id, provenance] of [
    ['missing-worker-fingerprint', missingWorkerFingerprint],
    ['malformed-engine-sha', malformedEngineSha],
    ['mismatched-embedded-fingerprint', mismatchedEmbeddedFingerprint],
    ['mismatched-combined-sentinel', mismatchedCombinedSentinel],
  ]) {
    const snapshot = await bootstrapContext({
      ...strategyContext('Invalid provenance strategy'),
      provenance,
    }, id);
    assert.ok(snapshot);
    assert.equal(snapshot.provenance, undefined, id);
  }
});

test('accepts a validated atomic PineTS report series and freezes every point', async () => {
  const points = [
    reportPoint(),
    reportPoint({
      barIndex: 1,
      time: 2_000,
      equity: 950,
      openPnl: -50,
      underwater: 50,
      underwaterPercent: 5,
      maxDrawdown: 75,
      maxDrawdownPercent: 7.5,
      benchmarkEquity: 1_020,
      benchmarkPnl: 20,
      benchmarkReturnPercent: 2,
    }),
  ];
  const snapshot = await bootstrapContext(reportContext('engine-run-series', 3, points), 'strategy-series');

  assert.ok(snapshot);
  assert.equal(snapshot.seriesState, 'ready');
  assert.equal(snapshot.runToken, 'engine-run-series');
  assert.equal(snapshot.capabilities.exactEquityCurve, true);
  assert.equal(snapshot.capabilities.exactDrawdownCurve, true);
  assert.equal(snapshot.capabilities.benchmark, true);
  assert.equal(snapshot.reportSeries.snapshotRevision, 3);
  assert.deepEqual(snapshot.reportSeries.points, points);
  assert.ok(Object.isFrozen(snapshot.reportSeries));
  assert.ok(Object.isFrozen(snapshot.reportSeries.points));
  assert.ok(Object.isFrozen(snapshot.reportSeries.points[0]));
});

test('rejects a series whose engine identity does not match its strategy snapshot', async () => {
  const context = reportContext('engine-run-series', 3, [reportPoint()]);
  context.strategy.reportSnapshotRevision = 4;
  const snapshot = await bootstrapContext(context, 'strategy-series-mismatch');

  assert.ok(snapshot);
  assert.equal(snapshot.reportSeries, undefined);
  assert.equal(snapshot.capabilities.exactEquityCurve, false);
  assert.equal(snapshot.capabilities.exactDrawdownCurve, false);
});

test('replaces the forming tail only when run identity and revision advance', async () => {
  const points = [
    reportPoint(),
    reportPoint({ barIndex: 1, time: 2_000, equity: 1_010 }),
  ];
  const full = reportContext('live-run-1', 1, points);
  const tailPoint = reportPoint({
    barIndex: 1,
    time: 2_000,
    equity: 990,
    openPnl: -10,
    underwater: 10,
    underwaterPercent: 1,
    maxDrawdown: 12,
    maxDrawdownPercent: 1.2,
  });
  const tail = {
    ...full,
    phase: 'streaming',
    strategy: {
      ...full.strategy,
      equity: 990,
      openPnl: -10,
      reportSnapshotRevision: 2,
    },
    reportSeries: undefined,
    reportTail: {
      schemaVersion: 1,
      runId: 'live-run-1',
      snapshotRevision: 2,
      barIndex: 1,
      points: [tailPoint],
    },
  };
  const history = new Deferred();
  const handle = new RoutedContextHandle('strategy-live-series', 'Series strategy', {
    full,
    summary: full,
    tail,
  });
  const chart = new FakeChart(handle, history);
  const workspace = new FakeWorkspace({ id: 'cell-1', chart });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const boot = adapter.bootstrap();
  history.resolve();
  await boot;
  await flush();

  workspace.emit('script:run', {
    cell: 'cell-1',
    id: handle.id,
    title: 'Series strategy',
    kind: 'strategy',
    cause: 'tick',
    first: false,
    bar: 1,
    time: 2_000,
    forming: true,
    complete: false,
    strategy: tail.strategy,
    warnings: [],
    trades: async () => [],
  });
  await flush();

  const snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.ok(snapshot);
  assert.equal(snapshot.seriesState, 'ready');
  assert.equal(snapshot.reportSeries.snapshotRevision, 2);
  assert.equal(snapshot.reportSeries.points.length, 2);
  assert.equal(snapshot.reportSeries.points[1].equity, 990);
  assert.equal(snapshot.capabilities.exactEquityCurve, true);
  adapter.destroy();
});

test('recovers a full series when a live tail starts a new engine run', async () => {
  const oldFull = reportContext('live-run-old', 1, [reportPoint()]);
  const newPoints = [
    reportPoint({ equity: 1_000 }),
    reportPoint({ barIndex: 1, time: 2_000, equity: 1_025, realizedPnl: 25 }),
  ];
  const newFull = reportContext('live-run-new', 2, newPoints);
  const newTail = {
    ...newFull,
    phase: 'streaming',
    reportSeries: undefined,
    reportTail: {
      schemaVersion: 1,
      runId: 'live-run-new',
      snapshotRevision: 2,
      barIndex: 1,
      points: [newPoints[1]],
    },
  };
  const history = new Deferred();
  const handle = new RoutedContextHandle('strategy-new-live-run', 'Series strategy', {
    full: oldFull,
    summary: oldFull,
    tail: newTail,
  });
  const chart = new FakeChart(handle, history);
  const workspace = new FakeWorkspace({ id: 'cell-1', chart });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const emitted = [];
  adapter.subscribe((event) => {
    if (event.type === 'snapshot') emitted.push(event.snapshot);
  });
  const boot = adapter.bootstrap();
  history.resolve();
  await boot;
  await flush();
  emitted.length = 0;

  // The recovery full-select must observe the new run, not the bootstrap one.
  handle.full = newFull;
  handle.summary = newTail;
  workspace.emit('script:run', {
    cell: 'cell-1',
    id: handle.id,
    title: 'Series strategy',
    kind: 'strategy',
    cause: 'tick',
    first: false,
    bar: 1,
    time: 2_000,
    forming: true,
    complete: false,
    strategy: newTail.strategy,
    warnings: [],
    trades: async () => [],
  });
  for (let i = 0; i < 5; i += 1) await flush();

  const snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.ok(snapshot);
  assert.equal(snapshot.seriesState, 'ready');
  assert.equal(snapshot.runToken, 'live-run-new');
  assert.equal(snapshot.reportSeries.points.length, 2);
  assert.equal(snapshot.reportSeries.points[1].equity, 1_025);
  assert.ok(emitted.length > 0);
  assert.equal(emitted.some((item) => item.capabilities.exactEquityCurve === false), false);
  adapter.destroy();
});

test('binds full-series recovery to the tail run identity and rejects a stale full response', async () => {
  const oldFull = reportContext('live-run-old', 1, [reportPoint()]);
  const point2 = reportPoint({ barIndex: 1, time: 2_000, equity: 1_020, realizedPnl: 20 });
  const newFull = reportContext('live-run-new', 3, [reportPoint(), point2]);
  const tailFor = (revision) => ({
    ...newFull,
    phase: 'streaming',
    strategy: {
      ...newFull.strategy,
      reportSnapshotRevision: revision,
    },
    reportSeries: undefined,
    reportTail: {
      schemaVersion: 1,
      runId: 'live-run-new',
      snapshotRevision: revision,
      barIndex: 1,
      points: [point2],
    },
  });
  const history = new Deferred();
  const handle = new RoutedContextHandle('strategy-stale-full', 'Series strategy', {
    full: oldFull,
    summary: oldFull,
    tail: tailFor(2),
  });
  const chart = new FakeChart(handle, history);
  const workspace = new FakeWorkspace({ id: 'cell-1', chart });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const emitted = [];
  adapter.subscribe((event) => {
    if (event.type === 'snapshot') emitted.push(event.snapshot);
  });
  const boot = adapter.bootstrap();
  history.resolve();
  await boot;
  await flush();
  emitted.length = 0;

  const emitTick = (revision) => workspace.emit('script:run', {
    cell: 'cell-1',
    id: handle.id,
    title: 'Series strategy',
    kind: 'strategy',
    cause: 'tick',
    first: false,
    bar: 1,
    time: 2_000,
    forming: true,
    complete: false,
    strategy: tailFor(revision).strategy,
    warnings: [],
    trades: async () => [],
  });

  // Recovery sees an internally consistent, but older, full snapshot. It must
  // not be promoted back to ready merely because the application revision is
  // still current.
  emitTick(2);
  for (let i = 0; i < 5; i += 1) await flush();
  let snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.ok(snapshot);
  assert.equal(snapshot.status, 'error');
  assert.match(snapshot.error.message, /engine identity/);
  assert.equal(snapshot.capabilities.tradeLedger, false);

  // A later delta retries recovery; now the matching full context may commit.
  handle.tail = tailFor(3);
  handle.full = newFull;
  emitTick(3);
  for (let i = 0; i < 5; i += 1) await flush();
  snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.equal(snapshot.reportSeries.runId, 'live-run-new');
  assert.equal(snapshot.reportSeries.snapshotRevision, 3);
  assert.equal(snapshot.capabilities.exactEquityCurve, true);
  adapter.destroy();
});

test('lets a current valid tail supersede an in-flight recovery for an older live run', async () => {
  const oldFull = reportContext('live-run-old', 1, [reportPoint()]);
  const pointA = reportPoint({ barIndex: 1, time: 2_000, equity: 1_010, realizedPnl: 10 });
  const pointB = reportPoint({ barIndex: 1, time: 2_000, equity: 1_030, realizedPnl: 30 });
  const fullA = reportContext('live-run-a', 2, [reportPoint(), pointA]);
  const fullB = reportContext('live-run-b', 1, [reportPoint(), pointB]);
  const tailOf = (full, point) => ({
    ...full,
    phase: 'streaming',
    reportSeries: undefined,
    reportTail: {
      schemaVersion: 1,
      runId: full.strategy.reportRunId,
      snapshotRevision: full.strategy.reportSnapshotRevision,
      barIndex: point.barIndex,
      points: [point],
    },
  });
  const tailA = tailOf(fullA, pointA);
  const tailB = tailOf(fullB, pointB);
  const recoveryA = new Deferred();
  const history = new Deferred();
  const handle = new RoutedContextHandle('strategy-restarted-recovery', 'Series strategy', {
    full: oldFull,
    summary: oldFull,
    tail: tailA,
  });
  const chart = new FakeChart(handle, history);
  const workspace = new FakeWorkspace({ id: 'cell-1', chart });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const emitted = [];
  adapter.subscribe((event) => {
    if (event.type === 'snapshot') emitted.push(event.snapshot);
  });
  const boot = adapter.bootstrap();
  history.resolve();
  await boot;
  await flush();
  emitted.length = 0;

  // Run A's tail binds the recovery, whose full response remains in flight.
  handle.full = recoveryA.promise;
  workspace.emit('script:run', {
    cell: 'cell-1',
    id: handle.id,
    title: 'Series strategy',
    kind: 'strategy',
    cause: 'tick',
    first: false,
    bar: 1,
    time: 2_000,
    forming: true,
    complete: false,
    strategy: tailA.strategy,
    warnings: [],
    trades: async () => [],
  });
  for (let i = 0; i < 3; i += 1) await flush();
  assert.equal(emitted.length, 0);

  // The same application revision observes a valid tail from restarted run B.
  // It must replace A's expectation and recover B instead of waiting forever.
  handle.summary = tailB;
  handle.tail = tailB;
  handle.full = fullB;
  chart.emit('context:changed', { id: handle.id });
  for (let i = 0; i < 4; i += 1) await flush();
  let snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.equal(snapshot.reportSeries.runId, 'live-run-b');
  assert.equal(snapshot.reportSeries.snapshotRevision, 1);

  // A's delayed full response is internally valid but no longer owns the
  // expectation, so it cannot overwrite or publish after B has committed.
  recoveryA.resolve(fullA);
  for (let i = 0; i < 4; i += 1) await flush();
  snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.equal(snapshot.reportSeries.runId, 'live-run-b');
  assert.equal(emitted.some((item) => item.reportSeries?.runId === 'live-run-a'), false);
  adapter.destroy();
});

test('prefers an atomic full series when a context also carries a tail', async () => {
  const initialPoints = [
    reportPoint(),
    reportPoint({ barIndex: 1, time: 2_000, equity: 1_010, realizedPnl: 10 }),
  ];
  const nextPoints = [
    reportPoint(),
    reportPoint({ barIndex: 1, time: 2_000, equity: 1_025, realizedPnl: 25 }),
  ];
  const initial = reportContext('live-run-combined', 1, initialPoints);
  const next = reportContext('live-run-combined', 2, nextPoints);
  const combined = {
    ...next,
    phase: 'streaming',
    reportTail: {
      schemaVersion: 1,
      runId: 'live-run-combined',
      snapshotRevision: 2,
      barIndex: 1,
      points: [reportPoint({ barIndex: 1, time: 2_000, equity: 777, realizedPnl: -223 })],
    },
  };
  const history = new Deferred();
  const handle = new RoutedContextHandle('strategy-full-and-tail', 'Series strategy', {
    full: initial,
    summary: initial,
    tail: combined,
  });
  const chart = new FakeChart(handle, history);
  const workspace = new FakeWorkspace({ id: 'cell-1', chart });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const boot = adapter.bootstrap();
  history.resolve();
  await boot;
  await flush();
  const callsBeforeTick = handle.contextCalls;

  workspace.emit('script:run', {
    cell: 'cell-1',
    id: handle.id,
    title: 'Series strategy',
    kind: 'strategy',
    cause: 'tick',
    first: false,
    bar: 1,
    time: 2_000,
    forming: true,
    complete: false,
    strategy: combined.strategy,
    warnings: [],
    trades: async () => [],
  });
  for (let i = 0; i < 4; i += 1) await flush();

  const snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.equal(snapshot.reportSeries.snapshotRevision, 2);
  assert.equal(snapshot.reportSeries.points[1].equity, 1_025);
  assert.equal(snapshot.seriesState, 'ready');
  assert.equal(handle.contextCalls, callsBeforeTick + 1);
  adapter.destroy();
});

test('does not publish a summary-only context while a live tail is pending', async () => {
  const points = [
    reportPoint(),
    reportPoint({ barIndex: 1, time: 2_000, equity: 1_010 }),
  ];
  const full = reportContext('live-run-pending', 1, points);
  const nextPoint = reportPoint({ barIndex: 1, time: 2_000, equity: 1_015, realizedPnl: 15 });
  const next = {
    ...full,
    phase: 'streaming',
    strategy: {
      ...full.strategy,
      equity: 1_015,
      netPnl: 15,
      reportSnapshotRevision: 2,
    },
    reportSeries: undefined,
    reportTail: {
      schemaVersion: 1,
      runId: 'live-run-pending',
      snapshotRevision: 2,
      barIndex: 1,
      points: [nextPoint],
    },
  };
  const tailDeferred = new Deferred();
  const history = new Deferred();
  const handle = new RoutedContextHandle('strategy-pending-tail', 'Series strategy', {
    full,
    summary: { ...full, reportSeries: undefined },
    tail: tailDeferred.promise,
  });
  const chart = new FakeChart(handle, history);
  const workspace = new FakeWorkspace({ id: 'cell-1', chart });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const emitted = [];
  adapter.subscribe((event) => {
    if (event.type === 'snapshot') emitted.push(event.snapshot);
  });
  const boot = adapter.bootstrap();
  history.resolve();
  await boot;
  await flush();
  const published = emitted.at(-1);
  assert.ok(published);
  emitted.length = 0;

  workspace.emit('script:run', {
    cell: 'cell-1',
    id: handle.id,
    title: 'Series strategy',
    kind: 'strategy',
    cause: 'tick',
    first: false,
    bar: 1,
    time: 2_000,
    forming: true,
    complete: false,
    strategy: next.strategy,
    warnings: [],
    trades: async () => [],
  });
  chart.emit('context:changed', { id: handle.id });
  await flush();
  assert.equal(emitted.length, 0);
  assert.strictEqual(
    adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id }),
    published,
  );
  assert.strictEqual(adapter.listSnapshots()[0], published);
  assert.equal(published.capabilities.exactEquityCurve, true);

  tailDeferred.resolve(next);
  for (let i = 0; i < 4; i += 1) await flush();
  assert.ok(emitted.length > 0);
  assert.equal(emitted.every((item) => item.capabilities.exactEquityCurve), true);
  assert.equal(emitted.at(-1).reportSeries.snapshotRevision, 2);
  adapter.destroy();
});

test('does not let an older bootstrap or summary context replace an accepted atomic report', async () => {
  const oldContext = reportContext('engine-run-old', 1, [reportPoint({ equity: 900 })]);
  const newPoints = [
    reportPoint(),
    reportPoint({ barIndex: 1, time: 2_000, equity: 1_050, realizedPnl: 50 }),
  ];
  const newContext = reportContext('engine-run-new', 1, newPoints);
  const firstFull = new Deferred();
  const history = new Deferred();
  const handle = new DeferredBootstrapHandle(
    'strategy-bootstrap-race',
    'Series strategy',
    { full: newContext, summary: newContext, tail: newContext },
    firstFull,
  );
  const chart = new FakeChart(handle, history);
  const workspace = new FakeWorkspace({ id: 'cell-1', chart });
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const boot = adapter.bootstrap();
  await flush();

  workspace.emit('script:run', {
    cell: 'cell-1',
    id: handle.id,
    title: 'Series strategy',
    kind: 'strategy',
    cause: 'history',
    first: true,
    bar: 1,
    time: 2_000,
    forming: false,
    complete: true,
    strategy: newContext.strategy,
    warnings: [],
    trades: async () => [],
  });
  for (let i = 0; i < 4; i += 1) await flush();

  firstFull.resolve(oldContext);
  history.resolve();
  await boot;
  await flush();
  let snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.ok(snapshot);
  assert.equal(snapshot.reportSeries.runId, 'engine-run-new');
  assert.equal(snapshot.context.strategy.reportRunId, 'engine-run-new');

  // A same-application-revision context event can still resolve an older
  // engine snapshot. Identity monotonicity must reject that overwrite.
  handle.summary = oldContext;
  chart.emit('context:changed', { id: handle.id });
  await flush();
  snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.equal(snapshot.reportSeries.runId, 'engine-run-new');
  assert.equal(snapshot.context.strategy.reportRunId, 'engine-run-new');
  adapter.destroy();
});

test('drops context from an old chart/handle generation after same-key recreation', async () => {
  const oldContext = new Deferred();
  const newContext = new Deferred();
  const oldHistory = new Deferred();
  const newHistory = new Deferred();
  const oldHandle = new FakeHandle('strategy-1', 'Old strategy', oldContext);
  const newHandle = new FakeHandle('strategy-1', 'New strategy', newContext);
  const oldChart = new FakeChart(oldHandle, oldHistory);
  const cell = { id: 'cell-1', chart: oldChart };
  const workspace = new FakeWorkspace(cell);
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const snapshots = [];
  adapter.subscribe((event) => {
    if (event.type === 'snapshot') snapshots.push(event.snapshot);
  });

  const initialBootstrap = adapter.bootstrap();
  await flush();

  // Layout restoration can reuse a cell id with a completely new Chart.
  const newChart = new FakeChart(newHandle, newHistory);
  cell.chart = newChart;
  workspace.emit('layout:changed');
  await flush();

  oldContext.resolve(strategyContext('Old strategy'));
  oldHistory.resolve();
  await flush();
  assert.equal(adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-1' }), undefined);

  newContext.resolve(strategyContext('New strategy'));
  newHistory.resolve();
  await initialBootstrap;
  await flush();

  const snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-1' });
  assert.ok(snapshot);
  assert.equal(snapshot.handle.title, newHandle.title);
  assert.equal(snapshot.handle.context, undefined);
  assert.equal(snapshot.context.meta.title, 'New strategy');
  assert.equal(snapshots.some((item) => item.handle === oldHandle), false);
  adapter.destroy();
});

test('drops a late context after an indicator is removed and re-added with the same id', async () => {
  const oldContext = new Deferred();
  const newContext = new Deferred();
  const chart = new FakeChart(null);
  const cell = { id: 'cell-1', chart };
  const workspace = new FakeWorkspace(cell);
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const oldHandle = new FakeHandle('strategy-1', 'Old strategy', oldContext);
  const newHandle = new FakeHandle('strategy-1', 'New strategy', newContext);
  chart.handles = [oldHandle];
  adapter.bootstrap();
  await flush();

  chart.handles = [];
  chart.emit('indicator:removed', { id: oldHandle.id });
  chart.handles = [newHandle];
  chart.emit('indicator:added', { id: newHandle.id });
  await flush();

  oldContext.resolve(strategyContext('Old strategy'));
  await flush();
  assert.equal(adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-1' }), undefined);

  newContext.resolve(strategyContext('New strategy'));
  await flush();
  const snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-1' });
  assert.ok(snapshot);
  assert.equal(snapshot.handle.title, newHandle.title);
  assert.equal(snapshot.handle.context, undefined);
  assert.equal(snapshot.context.meta.title, 'New strategy');
  adapter.destroy();
});

test('ignores queued events from a replaced chart binding and handle generation', async () => {
  const oldContext = new Deferred();
  const newContext = new Deferred();
  const oldHistory = new Deferred();
  const newHistory = new Deferred();
  const oldHandle = new FakeHandle('strategy-1', 'Old strategy', oldContext);
  const newHandle = new FakeHandle('strategy-1', 'New strategy', newContext);
  const oldChart = new FakeChart(oldHandle, oldHistory);
  const cell = { id: 'cell-1', chart: oldChart };
  const workspace = new FakeWorkspace(cell);
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const events = [];
  adapter.subscribe((event) => events.push(event));

  const bootstrap = adapter.bootstrap();
  await flush();
  oldContext.resolve(strategyContext('Old strategy'));
  oldHistory.resolve();
  await bootstrap;
  await flush();
  assert.equal(adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-1' }).handle.title, oldHandle.title);

  // Capture callbacks before replacing the chart. They represent events which
  // were already queued by the old chart/worker when the layout was restored.
  const staleChartError = oldChart.defer('indicator:error', {
    id: 'strategy-1',
    error: new Error('stale chart error'),
  });
  const staleContextChanged = oldChart.defer('context:changed', { id: 'strategy-1' });
  const staleHandleError = oldHandle.defer('error', { error: new Error('stale handle error') });
  const staleRemoved = oldChart.defer('indicator:removed', { id: 'strategy-1' });
  const oldContextCalls = oldHandle.contextCalls;

  const newChart = new FakeChart(newHandle, newHistory);
  cell.chart = newChart;
  workspace.emit('layout:changed');
  await flush();
  newContext.resolve(strategyContext('New strategy'));
  newHistory.resolve();
  await flush();
  const before = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-1' });
  assert.ok(before);
  assert.equal(before.handle.title, newHandle.title);

  staleChartError();
  staleContextChanged();
  staleHandleError();
  // The old chart has completed its removal by the time the queued callback
  // runs. With no binding guard this would remove the new same-key entry.
  oldChart.handles = [];
  staleRemoved();
  await flush();

  const after = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-1' });
  assert.ok(after);
  assert.equal(after.handle.title, newHandle.title);
  assert.notEqual(after.status, 'error');
  assert.equal(oldHandle.contextCalls, oldContextCalls);
  assert.equal(events.some((event) => event.type === 'error' && /stale/.test(event.error?.message ?? '')), false);
  adapter.destroy();
});

test('does not classify a computing context with omitted trades as no-trades', async () => {
  const history = new Deferred();
  const computing = {
    ...strategyContext('Computing strategy'),
    phase: 'computing',
    // A live worker may omit the unbounded ledger while this context is still
    // being assembled.  It must not be interpreted as a settled empty array.
    trades: undefined,
  };
  const settled = {
    ...strategyContext('Computing strategy'),
    phase: 'idle',
    trades: [],
  };
  const handle = new SequenceHandle('strategy-computing', 'Computing strategy', [computing, settled]);
  const chart = new FakeChart(handle, history);
  const cell = { id: 'cell-1', chart };
  const workspace = new FakeWorkspace(cell);
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const snapshots = [];
  adapter.subscribe((event) => {
    if (event.type === 'snapshot') snapshots.push(event.snapshot);
  });

  const boot = adapter.bootstrap();
  await flush();
  const pending = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-computing' });
  assert.ok(pending);
  assert.equal(pending.status, 'computing');
  assert.equal(pending.trades, null);
  assert.equal(pending.ledgerState, 'pending');

  history.resolve();
  await boot;
  await flush();
  chart.emit('history:complete', { reason: 'depth' });
  await flush();
  const complete = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-computing' });
  assert.ok(complete);
  assert.equal(complete.status, 'no-trades');
  assert.deepEqual(complete.trades, []);
  assert.ok(snapshots.some((item) => item.status === 'computing'));
  adapter.destroy();
});

test('keeps a settled head ledger partial until the chart history load completes', async () => {
  const history = new Deferred();
  const context = new Deferred();
  const handle = new FakeHandle('strategy-partial-history', 'SMA Cross', context);
  const chart = new FakeChart(handle, history);
  const cell = { id: 'cell-1', chart };
  const workspace = new FakeWorkspace(cell);
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const headContext = { ...strategyContext('SMA Cross'), trades: undefined };
  const trade = {
    id: 'sma-trade',
    side: 'long',
    qty: 1,
    entry: { id: 'entry', time: 1_000, price: 100 },
    exit: { id: 'exit', time: 2_000, price: 110 },
    open: false,
    pnl: 10,
  };

  const snapshots = [];
  adapter.subscribe((event) => {
    if (event.type === 'snapshot') snapshots.push(event.snapshot);
  });
  const boot = adapter.bootstrap();
  context.resolve(headContext);
  await boot;
  await flush();

  // Vela can expose a complete run/ledger for the currently painted head while
  // older BTCUSDT candles continue to backfill.  `run.complete` alone must not
  // promote that report to historical-final.
  workspace.emit('script:run', {
    cell: 'cell-1',
    id: 'strategy-partial-history',
    title: 'SMA Cross',
    kind: 'strategy',
    cause: 'history',
    first: true,
    bar: 499,
    time: 2_000,
    forming: false,
    complete: true,
    strategy: headContext.strategy,
    warnings: [],
    trades: async () => [trade],
  });
  await flush();
  let snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-partial-history' });
  assert.ok(snapshot);
  assert.equal(snapshot.status, 'partial');
  assert.equal(snapshot.ledgerState, 'ready');
  assert.equal(snapshot.finality, 'unknown');

  chart.emit('history:progress', { loaded: 500, target: 5_000 });
  await flush();
  snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-partial-history' });
  assert.ok(snapshot);
  // The head ledger remains retained for identity/race handling, but the
  // public result must stay partial while older candles can still add trades.
  // Consumers therefore cannot render the provisional ledger as final.
  assert.equal(snapshot.status, 'partial');
  assert.equal(snapshot.ledgerState, 'ready');
  assert.equal(snapshot.finality, 'partial-history');
  assert.deepEqual(snapshot.history, {
    loaded: 500,
    target: 5_000,
    barsLoaded: 500,
    oldestTime: null,
    complete: false,
    reason: null,
    progress: 0.1,
  });

  chart.emit('history:complete', {
    reason: 'depth',
    oldestTime: -1_798_000,
    barsLoaded: 5_000,
  });
  history.resolve();
  await flush();
  snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-partial-history' });
  assert.ok(snapshot);
  assert.equal(snapshot.finality, 'historical-final');
  assert.deepEqual(snapshot.history, {
    loaded: 5_000,
    target: 5_000,
    barsLoaded: 5_000,
    oldestTime: -1_798_000,
    complete: true,
    reason: 'depth',
    progress: 1,
  });
  assert.ok(snapshots.some((item) => item.finality === 'partial-history'));
  adapter.destroy();
});

test('refreshes a restored settled context after deep history completes', async () => {
  const history = new Deferred();
  const headTrade = {
    id: 'head-trade',
    side: 'long',
    qty: 1,
    entry: { id: 'head-entry', time: 1_000, price: 100 },
    exit: { id: 'head-exit', time: 2_000, price: 101 },
    open: false,
    pnl: 1,
  };
  const deepTrade = {
    ...headTrade,
    id: 'deep-trade',
    entry: { id: 'deep-entry', time: 500, price: 90 },
    exit: { id: 'deep-exit', time: 750, price: 95 },
    pnl: 5,
  };
  const head = { ...strategyContext('Restored strategy'), trades: [headTrade], phase: 'idle' };
  const deep = { ...strategyContext('Restored strategy'), trades: [deepTrade], phase: 'idle' };
  const handle = new SequenceHandle('strategy-restored-history', 'Restored strategy', [head, deep]);
  const chart = new FakeChart(handle, history);
  const cell = { id: 'cell-1', chart };
  const workspace = new FakeWorkspace(cell);
  const adapter = new VelaBacktestResultsAdapter(workspace);

  const boot = adapter.bootstrap();
  await boot;
  await flush();
  let snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.equal(snapshot?.status, 'partial');
  assert.deepEqual(snapshot?.trades.map((trade) => trade.id), ['head-trade']);

  chart.emit('history:progress', { loaded: 500, target: 5_000 });
  await flush();
  snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.equal(snapshot?.status, 'partial');

  chart.emit('history:complete', { reason: 'depth', barsLoaded: 5_000 });
  // The refresh is asynchronous; no shallow ledger may be reported as final
  // in the interval between the completion event and the fresh context read.
  snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.equal(snapshot?.status, 'computing');
  assert.equal(snapshot?.finality, 'unknown');
  await flush();
  snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.equal(snapshot?.status, 'ready');
  assert.deepEqual(snapshot?.trades.map((trade) => trade.id), ['deep-trade']);
  assert.equal(snapshot?.finality, 'historical-final');
  adapter.destroy();
});

test('keeps an aborted history completion partial without a script run', async () => {
  const history = new Deferred();
  const context = new Deferred();
  const handle = new FakeHandle('strategy-aborted-history', 'Aborted history', context);
  const chart = new FakeChart(handle, history);
  const cell = { id: 'cell-1', chart };
  const workspace = new FakeWorkspace(cell);
  const adapter = new VelaBacktestResultsAdapter(workspace);

  const boot = adapter.bootstrap();
  context.resolve({ ...strategyContext('Aborted history'), phase: 'idle' });
  await boot;
  await flush();
  chart.emit('history:complete', { reason: 'aborted', barsLoaded: 250 });
  await flush();

  const snapshot = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: handle.id });
  assert.equal(snapshot?.status, 'partial');
  assert.equal(snapshot?.finality, 'partial-history');
  assert.equal(snapshot?.history.reason, 'aborted');
  adapter.destroy();
});

test('coalesces Vela added/context/ready announcement burst into one bootstrap', async () => {
  const context = new Deferred();
  const history = new Deferred();
  const handle = new FakeHandle('strategy-1', 'Burst strategy', context);
  const chart = new FakeChart(null, history);
  const cell = { id: 'cell-1', chart };
  const workspace = new FakeWorkspace(cell);
  const adapter = new VelaBacktestResultsAdapter(workspace);
  const snapshots = [];
  adapter.subscribe((event) => {
    if (event.type === 'snapshot') snapshots.push(event.snapshot);
  });

  const bootstrap = adapter.bootstrap();
  history.resolve();
  await bootstrap;

  chart.handles = [handle];
  chart.emit('history:complete', {reason: 'depth', barsLoaded: 1, oldestTime: 1000});
  // Vela's announce() emits these synchronously in this order.
  chart.emit('indicator:added', { id: handle.id });
  chart.emit('context:changed', { id: handle.id });
  handle.emit('ready');
  context.resolve(strategyContext('Burst strategy'));
  // The adapter attaches a cleanup continuation to the shared promise; allow
  // the context resolution, snapshot emission, and cleanup to settle.
  for (let i = 0; i < 4; i += 1) await flush();

  const report = adapter.getSnapshot({ cellId: 'cell-1', indicatorId: 'strategy-1' });
  assert.ok(report);
  assert.equal(report.revision, 1);
  assert.equal(report.status, 'no-trades');
  assert.equal(snapshots.filter((item) => item.key.indicatorId === 'strategy-1').length, 1);
  assert.equal(handle.contextCalls, 1);
  adapter.destroy();
});

test('R10 history completion cannot bootstrap the previous market execution while the engine awaits security data', async () => {
  const old = reportContext('market-AAA');
  const handle = new RoutedContextHandle('market-strategy', 'Market strategy', {full: old});
  const chart = new FakeChart(handle);
  chart.market = {symbol: 'audit:AAA', timeframe: '15', bars: 800};
  const workspace = new FakeWorkspace({id: 'cell-1', chart});
  const adapter = new VelaBacktestResultsAdapter(workspace);
  await adapter.bootstrap();
  chart.emit('history:complete', {reason: 'depth', barsLoaded: 800});
  for (let i = 0; i < 4; i++) await flush();
  const key = {cellId:'cell-1', indicatorId:handle.id};
  assert.equal(adapter.getSnapshot(key).context.strategy.reportRunId, 'market-AAA');

  chart.market = {symbol: 'audit:BBB', timeframe: '15', bars: 500};
  chart.emit('load:start', chart.market);
  chart.emit('history:complete', {reason: 'depth', barsLoaded: 500});
  for (let i = 0; i < 4; i++) await flush();
  assert.equal(adapter.getSnapshot(key).context, null);
  assert.notEqual(adapter.getSnapshot(key).ledgerState, 'ready');
  // Even a queued old run must not remove the market-execution fence.
  workspace.emit('script:run', {cell:'cell-1', id:handle.id, kind:'strategy', complete:true, cause:'bars', strategy:old.strategy});
  for (let i = 0; i < 4; i++) await flush();
  assert.equal(adapter.getSnapshot(key).context, null);

  const current = reportContext('market-BBB');
  handle.full = handle.summary = current;
  workspace.emit('script:run', {cell:'cell-1', id:handle.id, kind:'strategy', complete:true, cause:'bars', strategy:current.strategy});
  for (let i = 0; i < 8; i++) await flush();
  assert.equal(adapter.getSnapshot(key).context.strategy.reportRunId, 'market-BBB');
  assert.equal(adapter.getSnapshot(key).ledgerState, 'ready');
  adapter.destroy();
});
