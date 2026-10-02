import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BACKTEST_SIMULATION_CACHE_LIMIT_PER_REPORT,
  BacktestController,
  mapSnapshot,
  mapSnapshotDomain,
} from '../src/app/backtest-controller.ts';
import {
  linearPercentile,
  simulateBacktestReference,
  walkBacktestEquity,
} from '../src/domain/backtest-simulation.ts';
import { BacktestSimulationTaskCancelledError } from '../src/app/backtest-simulation-worker.ts';
import { BacktestStore } from '../src/features/backtesting/backtest-store.ts';

class FakeSource {
  #listeners = new Set();
  #snapshots = [];
  subscribeCount = 0;
  unsubscribeCount = 0;
  destroyed = false;

  constructor(snapshots = []) {
    this.#snapshots = [...snapshots];
  }

  async bootstrap() {}

  subscribe(listener) {
    this.subscribeCount += 1;
    this.#listeners.add(listener);
    return () => {
      this.unsubscribeCount += 1;
      this.#listeners.delete(listener);
    };
  }

  listSnapshots() {
    return [...this.#snapshots];
  }

  emit(event) {
    if (event.type === 'snapshot') {
      this.#snapshots = this.#snapshots.filter((item) => item.key.indicatorId !== event.snapshot.key.indicatorId);
      this.#snapshots.push(event.snapshot);
    }
    if (event.type === 'removed') {
      this.#snapshots = this.#snapshots.filter((item) => item.key.indicatorId !== event.key.indicatorId);
    }
    for (const listener of [...this.#listeners]) listener(event);
  }

  destroy() {
    this.destroyed = true;
  }
}

class FlakySource extends FakeSource {
  attempts = 0;

  async bootstrap() {
    this.attempts += 1;
    if (this.attempts === 1) throw new Error('temporary bootstrap failure');
  }
}

class FakeSimulationTaskRunner {
  tasks = [];
  destroyed = false;

  run(input, options = {}) {
    const requestId = this.tasks.length + 1;
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const task = {
      requestId,
      input,
      options,
      promise,
      cancelled: false,
      cancel: () => {
        if (task.cancelled) return;
        task.cancelled = true;
        reject(new BacktestSimulationTaskCancelledError(0, input.runs, 'cancelled'));
      },
      progress: (completedRuns) => options.onProgress?.({
        completedRuns,
        totalRuns: input.runs,
        fraction: completedRuns / input.runs,
      }),
      complete: () => resolve(simulateBacktestReference(input)),
      fail: (error) => reject(error),
    };
    this.tasks.push(task);
    return task;
  }

  destroy() {
    this.destroyed = true;
  }
}

function snapshot(indicatorId, overrides = {}) {
  const key = { cellId: 'cell-1', indicatorId };
  const trade = {
    id: `${indicatorId}-trade`,
    side: 'long',
    qty: 1,
    entry: { id: 'entry', time: 1_000, price: 100 },
    exit: { id: 'exit', time: 2_000, price: 110 },
    open: false,
    pnl: 10,
  };
  return {
    key,
    revision: 1,
    epoch: 0,
    runToken: `${indicatorId}:run`,
    status: 'ready',
    finality: 'historical-final',
    ledgerState: 'ready',
    ledgerRevision: overrides.revision ?? 1,
    capabilities: {
      tradeLedger: true,
      exactEquityCurve: false,
      exactDrawdownCurve: false,
      riskRatios: false,
      benchmark: false,
      rawOrders: false,
      rawFills: false,
      barIndices: false,
      individualOpenPnl: false,
      executionPrecision: 'chart-ohlc',
    },
    visible: true,
    handle: { id: indicatorId, title: `Strategy ${indicatorId}`, visible: true },
    run: {
      id: indicatorId,
      title: `Strategy ${indicatorId}`,
      kind: 'strategy',
      cause: 'history',
      first: true,
      bar: 10,
      time: 2_000,
      forming: false,
      complete: true,
      plots: {},
      vars: {},
      warnings: [],
      trades: async () => [trade],
    },
    context: {
      language: 'pine',
      phase: 'idle',
      barIndex: 10,
      meta: { title: `Strategy ${indicatorId}`, overlay: true },
      plots: {},
      variables: {},
      strategy: {
        position: 0,
        avgPrice: 0,
        equity: 1_010,
        openPnl: 0,
        netPnl: 10,
        grossProfit: 10,
        grossLoss: 0,
        wins: 1,
        losses: 0,
        even: 0,
        maxDrawdown: 0,
        maxRunup: 10,
        initialCapital: 1_000,
      },
      trades: [trade],
      warnings: [],
    },
    trades: [trade],
    error: null,
    source: 'strategy("test")',
    ...overrides,
  };
}

test('maps one Vela snapshot to an immutable UI report with explicit capabilities', () => {
  const report = mapSnapshot(snapshot('s1'), {
    getMarket: () => ({ provider: 'binance', symbol: 'BTCUSDT', timeframe: '1h', currency: 'USD' }),
    isFavorite: () => true,
  });
  assert.equal(report.strategyName, 'Strategy s1');
  assert.equal(report.status, 'ready');
  assert.equal(report.metrics.trades, 1);
  assert.equal(report.metrics.winRate, 100);
  assert.equal(report.metrics.netProfit, 10);
  assert.equal(report.capabilities.hasEquityCurve, false);
  assert.equal(report.capabilities.hasRealizedPnlCurve, true);
  assert.equal(report.cumulativePnlSource, 'realized-ledger');
  assert.deepEqual(report.cumulativePnl, [{
    x: 0,
    y: 10,
    time: 2_000,
    direction: 'long',
    tradeNumber: 1,
  }]);
  assert.equal(report.favorite, true);
  assert.equal(report.trades[0].status, 'closed');
  assert.equal(report.trades[0].number, 1);
  assert.equal(report.trades[0].netPnl, 10);
  assert.equal(report.metrics.grossLoss, 0);
  assert.equal(report.comparison.all.grossLoss, 0);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.key));
  assert.ok(Object.isFrozen(report.range) || report.range === undefined);
  assert.ok(Object.isFrozen(report.trades));
});

test('maps market identity and a settled report range for the Viewer header', () => {
  const report = mapSnapshot(snapshot('viewer-identity'), {
    getMarket: () => ({
      provider: 'binance',
      symbol: 'binance:BTCUSDT',
      displaySymbol: 'BTCUSDT',
      timeframe: '60',
      timezone: 'UTC',
    }),
  });
  assert.equal(report.provider, 'binance');
  assert.equal(report.symbol, 'binance:BTCUSDT');
  assert.equal(report.displaySymbol, 'BTCUSDT');
  assert.equal(report.timeframe, '60');
  assert.deepEqual(report.range, { from: 1_000, to: 2_000 });
});

test('publishes deep-history coverage without treating a head run as full history', () => {
  const report = mapSnapshot(snapshot('history-coverage', {
    finality: 'partial-history',
    history: {
      loaded: 500,
      target: 5_000,
      barsLoaded: 500,
      oldestTime: 100,
      complete: false,
      reason: null,
      progress: 0.1,
    },
  }));
  assert.equal(report.status, 'partial');
  assert.deepEqual(report.history, {
    loaded: 500,
    target: 5_000,
    barsLoaded: 500,
    oldestTime: 100,
    actual: { from: 100, to: null },
    effectiveStrategy: undefined,
    complete: false,
    reason: null,
    progress: 0.1,
  });
  assert.ok(Object.isFrozen(report.history));
  assert.ok(Object.isFrozen(report.history.actual));
});

test('maps the accepted exact range while a live report remains provisional', () => {
  const base = snapshot('viewer-live-range');
  const point = (barIndex, time) => ({
    barIndex,
    time,
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
  });
  const report = mapSnapshot({
    ...base,
    finality: 'live-provisional',
    seriesState: 'ready',
    reportSeries: {
      schemaVersion: 1,
      runId: base.runToken,
      snapshotRevision: base.revision,
      barIndex: 2,
      points: [point(0, 3_000), point(1, 1_000), point(2, 2_000)],
    },
  }, {
    getMarket: () => ({ provider: 'binance', symbol: 'BTCUSDT', timeframe: '1h' }),
  });

  assert.deepEqual(report.range, { from: 1_000, to: 3_000 });
});

test('keeps Performance All net profit aligned with the mark-to-market Summary KPI', () => {
  const base = snapshot('mark-to-market-comparison');
  const openTrade = {
    ...base.trades[0],
    id: 'open-trade',
    entry: { id: 'open-entry', time: 3_000, price: 110 },
    exit: null,
    open: true,
    pnl: null,
    unrealizedPnl: -2,
  };
  const report = mapSnapshot({
    ...base,
    trades: [base.trades[0], openTrade],
    context: {
      ...base.context,
      trades: [base.trades[0], openTrade],
      strategy: {
        ...base.context.strategy,
        openPnl: -2,
        netPnl: 10,
      },
    },
  });
  assert.equal(report.metrics.netProfit, 8);
  assert.equal(report.comparison.all.netProfit, 8);
  assert.equal(report.comparison.long.netProfit, 8);
});

test('assigns reference Trade numbers by exit rank instead of exposing engine IDs', () => {
  const base = snapshot('trade-numbering');
  const oldest = {
    ...base.trades[0],
    id: 'trade_19',
    side: 'short',
    exit: { id: 'exit-old', time: 2_000, price: 101 },
    pnl: 1,
  };
  const open = {
    ...base.trades[0],
    id: 'trade_19',
    entry: { id: 'entry-open', time: 3_500, price: 103 },
    exit: undefined,
    open: true,
    pnl: undefined,
  };
  const newest = {
    ...base.trades[0],
    id: 'trade_20',
    entry: { id: 'entry-new', time: 2_500, price: 102 },
    exit: { id: 'exit-new', time: 4_000, price: 104 },
    pnl: 2,
  };
  const trades = [oldest, open, newest];
  const report = mapSnapshot({
    ...base,
    trades,
    context: { ...base.context, trades },
  });

  assert.deepEqual(
    report.trades.map((trade) => ({
      id: trade.id,
      number: trade.number,
      cumulativePnl: trade.cumulativePnl,
    })),
    [
      { id: 'trade_19', number: 1, cumulativePnl: 1 },
      { id: 'trade_19', number: 0, cumulativePnl: 0 },
      { id: 'trade_20', number: 2, cumulativePnl: 3 },
    ],
  );
  // The Summary curve has a different population from the Log, but every
  // realized point still needs the same history ordinal/direction/timestamp
  // for its marker and hover label. The open sentinel never becomes a point.
  assert.deepEqual(report.cumulativePnl, [
    {
      x: 0,
      y: 1,
      time: 2_000,
      direction: 'short',
      tradeNumber: 1,
    },
    {
      x: 1,
      y: 3,
      time: 4_000,
      direction: 'long',
      tradeNumber: 2,
    },
  ]);
});

test('maps local account currency, position peaks, and exact trade bar indices', () => {
  const base = snapshot('bridge-account-fields');
  const trade = {
    ...base.trades[0],
    entryBarIndex: 4,
    exitBarIndex: 9,
  };
  const enriched = {
    ...base,
    capabilities: { ...base.capabilities, barIndices: true },
    trades: [trade],
    context: {
      ...base.context,
      strategy: {
        ...base.context.strategy,
        accountCurrency: 'EUR',
        maxContractsHeldAll: 7,
        maxContractsHeldLong: 7,
        maxContractsHeldShort: 3,
      },
      trades: [trade],
    },
  };
  const domain = mapSnapshotDomain(enriched, {
    getMarket: () => ({
      provider: 'binance',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      currency: 'USDT',
    }),
  });
  assert.equal(domain.account.currency, 'EUR');
  assert.equal(domain.account.maxContractsHeldAll, 7);
  assert.equal(domain.account.maxContractsHeldLong, 7);
  assert.equal(domain.account.maxContractsHeldShort, 3);
  assert.equal(domain.trades[0].entryBarIndex, 4);
  assert.equal(domain.trades[0].exitBarIndex, 9);
  assert.equal(domain.capabilities.barIndices, true);

  const report = mapSnapshot(enriched, {
    getMarket: () => ({
      provider: 'binance',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      currency: 'USDT',
    }),
  });
  assert.equal(report.currency, 'EUR');
  assert.equal(report.trades[0].entryBar, 4);
  assert.equal(report.trades[0].exitBar, 9);
  assert.equal(report.analysis.duration.averageBars, 6);
  assert.equal(report.analysis.duration.medianBars, 6);
  assert.equal(report.analysis.duration.maxBars, 6);

  const downgraded = mapSnapshot({
    ...enriched,
    capabilities: { ...enriched.capabilities, barIndices: false },
  });
  assert.equal(downgraded.analysis.duration.averageBars.value, null);
  assert.equal(downgraded.analysis.duration.averageBars.unavailableReason, 'not-exposed');
});

test('maps validated execution provenance into the provider-neutral domain report', () => {
  const domain = mapSnapshotDomain(snapshot('provenance', {
    provenance: {
      execution: 'worker',
      engine: {
        schemaVersion: 1,
        packageName: 'pinets',
        packageVersion: '0.9.34',
        upstreamSha: 'beacd587e83aa7ee061023f8cea66b2e887d5676',
        localPatchRevision: 'quant-tools-g8.1',
        reportSchemaVersion: 4,
        sentinel: 'pinets-local-build-v1',
        buildFingerprint: 'pinets-fingerprint',
      },
      bridge: {
        schemaVersion: 1,
        packageName: '@luxalgo/vela-pinets',
        packageVersion: '0.2.13',
        upstreamSha: 'a2a2097be8f30b4b596b13212ed4608c36c2ea26',
        localPatchRevision: 'quant-tools-g8.1',
        reportSchemaVersion: 4,
        sentinel: 'vela-pinets-local-build-v1',
        buildFingerprint: 'vela-pinets-fingerprint',
        bridgeSha: 'a2a2097be8f30b4b596b13212ed4608c36c2ea26',
        embeddedPinetsSha: 'beacd587e83aa7ee061023f8cea66b2e887d5676',
        embeddedPinetsFingerprint: 'pinets-fingerprint',
      },
      buildFingerprint: 'execution-fingerprint',
      workerFingerprint: 'execution-fingerprint|execution=worker',
      sentinel: 'vela-pinets-local-build-v1|pinets-local-build-v1',
    },
  }));

  assert.deepEqual(domain.provenance, {
    engine: {
      name: 'pinets',
      version: '0.9.34',
      sha: 'beacd587e83aa7ee061023f8cea66b2e887d5676',
    },
    bridge: {
      name: '@luxalgo/vela-pinets',
      version: '0.2.13',
      sha: 'a2a2097be8f30b4b596b13212ed4608c36c2ea26',
    },
    buildFingerprint: 'execution-fingerprint',
    workerFingerprint: 'execution-fingerprint|execution=worker',
    sentinel: 'vela-pinets-local-build-v1|pinets-local-build-v1',
  });
  assert.ok(Object.isFrozen(domain.provenance));
  assert.ok(Object.isFrozen(domain.provenance.engine));
  assert.ok(Object.isFrozen(domain.provenance.bridge));
});

test('uses bridge-published report metrics without fabricating per-bar capabilities', () => {
  const base = snapshot('engine-report-metrics');
  const report = mapSnapshot({
    ...base,
    context: {
      ...base.context,
      strategy: {
        ...base.context.strategy,
        cagr: 12.5,
        sharpe: 1.25,
        sortino: 1.75,
        maxDrawdownPercent: 4.5,
        buyAndHoldPnl: 900,
        buyAndHoldPercent: 9,
        strategyOutperformance: -890,
      },
    },
  });
  assert.equal(report.metrics.cagr, 12.5);
  assert.equal(report.metrics.sharpe, 1.25);
  assert.equal(report.metrics.sortino, 1.75);
  assert.equal(report.metrics.maxDrawdown, 0);
  assert.equal(report.metrics.maxDrawdownPercent, 4.5);
  assert.equal(report.metrics.buyAndHoldPnl, 900);
  assert.equal(report.metrics.buyAndHoldPercent, 9);
  assert.equal(report.metrics.strategyOutperformance, -890);
  assert.equal(report.capabilities.hasBenchmark, true);
  assert.equal(report.comparison.all.cagr, 12.5);
  assert.equal(report.comparison.all.maxDrawdownPercent, 4.5);
  assert.equal(report.comparison.all.buyAndHoldPnl, 900);
  assert.equal(report.comparison.all.strategyOutperformance, -890);
  // Scalar report metrics do not imply that an exact per-bar equity curve was
  // exposed; the realized-ledger provenance remains explicit.
  assert.equal(report.capabilities.hasEquityCurve, false);
  assert.equal(report.cumulativePnlSource, 'realized-ledger');
});

test('maps an accepted PineTS per-bar report without changing percentage units twice', () => {
  const base = snapshot('exact-engine-series');
  const points = [
    {
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
    },
    {
      barIndex: 1,
      time: 2_000,
      equity: 900,
      realizedPnl: 0,
      openPnl: -100,
      underwater: 100,
      underwaterPercent: 10,
      maxDrawdown: 125,
      maxDrawdownPercent: 12.5,
      benchmarkEquity: 1_050,
      benchmarkPnl: 50,
      benchmarkReturnPercent: 5,
    },
    {
      barIndex: 2,
      time: 3_000,
      equity: 1_100,
      realizedPnl: 100,
      openPnl: 0,
      underwater: 0,
      underwaterPercent: 0,
      maxDrawdown: 125,
      maxDrawdownPercent: 12.5,
      benchmarkEquity: 1_100,
      benchmarkPnl: 100,
      benchmarkReturnPercent: 10,
    },
  ];
  const exact = {
    ...base,
    runToken: 'engine-run-1',
    seriesState: 'ready',
    reportSeries: {
      schemaVersion: 1,
      runId: 'engine-run-1',
      snapshotRevision: 7,
      barIndex: 2,
      points,
    },
    capabilities: {
      ...base.capabilities,
      exactEquityCurve: true,
      exactDrawdownCurve: true,
      benchmark: true,
    },
    context: {
      ...base.context,
      strategy: {
        ...base.context.strategy,
        equity: 1_100,
        netPnl: 100,
        maxDrawdown: 125,
        maxDrawdownPercent: 12.5,
      },
    },
  };

  const domain = mapSnapshotDomain(exact);
  assert.equal(domain.runId, 'engine-run-1');
  assert.equal(domain.snapshotToken, 'engine-run-1:7');
  assert.equal(domain.equitySeries.length, 3);
  assert.equal(domain.equitySeries[1].drawdown, 100);
  assert.equal(domain.equitySeries[1].drawdownPct, 0.1);
  assert.equal(domain.equitySeries[1].maxDrawdownPct, 0.125);
  assert.equal(domain.benchmarkSeries[0].returnPct, 0.05);
  assert.equal(domain.account.maxDrawdownPct, 0.125);

  const report = mapSnapshot(exact);
  assert.equal(report.capabilities.hasEquityCurve, true);
  assert.equal(report.capabilities.hasRealizedPnlCurve, true);
  assert.equal(report.cumulativePnlSource, 'realized-ledger');
  assert.deepEqual(report.equity, [
    { x: 1_000, y: 1_000 },
    { x: 2_000, y: 900 },
    { x: 3_000, y: 1_100 },
  ]);
  assert.deepEqual(report.cumulativePnl, [
    {
      x: 0,
      y: 10,
      time: 2_000,
      direction: 'long',
      tradeNumber: 1,
    },
  ]);
  assert.equal(report.metrics.maxDrawdown, 125);
  assert.equal(report.metrics.maxDrawdownPercent, 12.5);
  assert.equal(report.metrics.buyAndHoldPnl, 100);
  assert.equal(report.metrics.buyAndHoldPercent, 10);
});

test('keeps partial engine report scalars field-scoped instead of promoting grouped capabilities', () => {
  const riskBase = snapshot('partial-engine-risk');
  const riskReport = mapSnapshot({
    ...riskBase,
    context: {
      ...riskBase.context,
      strategy: {
        ...riskBase.context.strategy,
        cagr: 12.5,
      },
    },
  });
  assert.equal(riskReport.metrics.cagr, 12.5);
  assert.equal(riskReport.comparison.all.cagr, 12.5);
  for (const key of ['sharpe', 'sortino', 'calmar']) {
    assert.equal(riskReport.metrics[key].value, null, key);
    assert.equal(riskReport.metrics[key].unavailableReason, 'not-exposed', key);
  }
  assert.equal(riskReport.capabilities.hasEquityCurve, false);

  const benchmarkBase = snapshot('partial-engine-benchmark');
  const benchmarkReport = mapSnapshot({
    ...benchmarkBase,
    context: {
      ...benchmarkBase.context,
      strategy: {
        ...benchmarkBase.context.strategy,
        buyAndHoldPnl: 100,
      },
    },
  });
  assert.equal(benchmarkReport.metrics.buyAndHoldPnl, 100);
  assert.equal(benchmarkReport.comparison.all.buyAndHoldPnl, 100);
  for (const key of ['buyAndHoldPercent']) {
    assert.equal(benchmarkReport.metrics[key].value, null, key);
    assert.equal(benchmarkReport.metrics[key].unavailableReason, 'not-exposed', key);
  }
  // A missing precomputed engine scalar does not prevent the visible formula.
  assert.equal(benchmarkReport.metrics.strategyOutperformance, -90);
  assert.equal(benchmarkReport.capabilities.hasBenchmark, false);
});

for (const side of ['long', 'short']) for (const openPnl of [-17.25, 211.07, 0]) {
  test(`R08 account-only open P&L reconciles all/directions/benchmark: ${side}/${openPnl}`, () => {
    const base = snapshot('r08');
    const trades = [
      { ...base.trades[0], id: 'closed-long', side: 'long', pnl: -1016.02 },
      { ...base.trades[0], id: 'closed-short', side: 'short', pnl: -812.95 },
      { id: 'open', side, qty: 2, entry: {time: 3000, price: 100}, exit: null, open: true, pnl: null },
    ];
    const report = mapSnapshot({ ...base, trades, context: { trades, strategy: {
      ...base.context.strategy, netPnl: -1828.97, openPnl,
      position: side === 'long' ? 2 : -2, buyAndHoldPnl: 95.12,
      buyAndHoldPercent: .9512, strategyOutperformance: -1924.09,
    } } });
    const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
    near(report.comparison.long.netProfit + report.comparison.short.netProfit, report.metrics.netProfit);
    near(report.comparison[side].netProfit, (side === 'long' ? -1016.02 : -812.95)+openPnl);
    near(report.metrics.strategyOutperformance, report.metrics.netProfit-report.metrics.buyAndHoldPnl);
    near(report.comparison.all.strategyOutperformance, report.metrics.strategyOutperformance);
  });
}

test('R08 does not invent a directional split for missing hedged valuations', () => {
  for (const openPnl of [15, 0]) {
  const base = snapshot('r08-hedged');
  const trades = ['long','short'].map(side => ({id:side,side,qty:1,entry:{time:1000,price:100},exit:null,open:true}));
  const report = mapSnapshot({...base,trades,context:{trades,strategy:{...base.context.strategy,netPnl:0,openPnl}}});
  assert.equal(report.comparison.all.netProfit,openPnl);
  assert.equal(report.comparison.long.netProfit,null);
  assert.equal(report.comparison.short.netProfit,null);
  }
});

test('blocks provisional results while deep history is still loading', () => {
  const report = mapSnapshot(snapshot('partial-history-simulation', {
    status: 'partial',
    finality: 'partial-history',
  }));
  assert.equal(report.status, 'partial');
  assert.equal(report.capabilities.canSimulate, false);
  assert.equal(report.simulation, undefined);
  assert.equal(report.simulationWarning, undefined);
  assert.equal(report.metrics.netProfit.value, null);
  assert.equal(report.metrics.netProfit.unavailableReason, 'not-exposed');
  assert.equal(report.simulationUnavailableReason, 'unsettled-ledger');
});

test('hides ledger and strategy scalars for unknown finality', async () => {
  const base = snapshot('unknown-finality-metrics');
  const report = mapSnapshot({
    ...base,
    finality: 'unknown',
    capabilities: {
      ...base.capabilities,
      exactDrawdownCurve: true,
      exactEquityCurve: true,
      riskRatios: true,
      benchmark: true,
    },
    context: {
      ...base.context,
      strategy: {
        ...base.context.strategy,
        cagr: 12.5,
        sharpe: 1.2,
        sortino: 1.5,
        maxDrawdownPercent: 8,
        buyAndHoldPnl: 50,
        buyAndHoldPercent: 5,
        strategyOutperformance: 20,
      },
    },
  });
  for (const key of [
    'netProfit',
    'maxDrawdown',
    'maxDrawdownPercent',
    'cagr',
    'sharpe',
    'sortino',
    'calmar',
    'buyAndHoldPnl',
    'buyAndHoldPercent',
    'strategyOutperformance',
  ]) {
    assert.equal(report.metrics[key].value, null, key);
    assert.equal(report.metrics[key].unavailableReason, 'not-exposed', key);
  }
  assert.equal(report.summary.realizedNet.value, null);
  assert.equal(report.summary.unrealizedNet.value, null);
  assert.equal(report.metrics.trades.value, null);
  assert.equal(report.metrics.trades.unavailableReason, 'partial-ledger');
  assert.deepEqual(report.trades, []);
  assert.equal(report.equity, undefined);
  assert.equal(report.cumulativePnl, undefined);

  const source = new FakeSource([snapshot('partial-ready-gate', {
    finality: 'partial-history',
  })]);
  const controller = new BacktestController(source);
  await controller.start();
  assert.equal(controller.updateSimulation({ method: 'shuffle', runs: 3 }), null);
  controller.destroy();
});

test('keeps unknown finality blocked but enables immutable live-provisional snapshots', async () => {
  const unknownSource = new FakeSource([snapshot('simulation-unknown', { finality: 'unknown' })]);
  const unknownController = new BacktestController(unknownSource);
  await unknownController.start();
  assert.equal(unknownController.getSnapshot()?.capabilities?.canSimulate, false);
  assert.equal(unknownController.updateSimulation({ method: 'shuffle', runs: 3 }), null);
  unknownController.destroy();

  const liveSource = new FakeSource([snapshot('simulation-live', { finality: 'live-provisional' })]);
  const liveController = new BacktestController(liveSource);
  await liveController.start();
  assert.equal(liveController.getSnapshot()?.capabilities?.canSimulate, true);
  const updated = liveController.updateSimulation({ method: 'shuffle', runs: 3 });
  assert.equal(updated?.simulation?.method, 'shuffle');
  assert.equal(updated?.simulation?.runs, 3);
  liveController.destroy();
});

test('unknown finality remains a hard Simulation gate even when a UI projection says ready', async () => {
  const source = new FakeSource([snapshot('forged-simulation-unknown', { finality: 'unknown' })]);
  const controller = new BacktestController(source);
  await controller.start();
  const key = controller.getSnapshot()?.key;
  assert.ok(key);
  const entry = controller.reportStore.get(key);
  assert.ok(entry);
  // Simulate a stale/forged projection that was marked ready by an overlay
  // reconciler. The authoritative unknown domain finality must still veto it.
  controller.reportStore.upsert(
    key,
    entry.domain,
    {
      ...entry.report,
      status: 'ready',
      capabilities: { ...entry.report.capabilities, canSimulate: true },
    },
    entry.epoch,
    entry.revision,
  );
  assert.equal(controller.updateSimulation({ method: 'shuffle', runs: 3 }), null);
  controller.destroy();
});

test('enables trade location from fill timestamps when an engine has no bar indices', () => {
  const report = mapSnapshot(snapshot('timestamp-locate'));
  // Vela 0.7 exposes StrategyFill.time but deliberately does not expose a
  // per-fill bar index. Timestamp navigation is still a supported locator.
  assert.equal(report.capabilities.canLocateTrades, true);
  assert.equal(report.trades[0].entryBar, null);
  assert.equal(report.trades[0].exitBar, null);

  const withoutTimes = snapshot('timestamp-locate-empty', {
    trades: [{
      id: 'no-time',
      side: 'long',
      qty: 1,
      entry: { id: 'entry', time: null, price: 100 },
      exit: { id: 'exit', time: null, price: 110 },
      open: false,
      pnl: 10,
    }],
  });
  // A ledger without an addressable timestamp must not render dead locate
  // controls. (The fixture's context trade is intentionally replaced too.)
  withoutTimes.context = { ...withoutTimes.context, trades: withoutTimes.trades };
  const noTimeReport = mapSnapshot(withoutTimes);
  assert.equal(noTimeReport.capabilities.canLocateTrades, false);
  assert.equal(noTimeReport.trades[0].entryTime, null);
  assert.equal(noTimeReport.trades[0].exitTime, null);
});

test('frequency and daily performance use the report display timezone', () => {
  const exit = Date.parse('2024-01-02T00:30:00.000Z');
  const trade = {
    id: 'timezone-trade',
    side: 'long',
    qty: 1,
    entry: { id: 'entry', time: exit - 3_600_000, price: 100 },
    exit: { id: 'exit', time: exit, price: 110 },
    open: false,
    pnl: 10,
  };
  const base = snapshot('timezone', { trades: [trade] });
  base.context = { ...base.context, trades: [trade] };
  const report = mapSnapshot(base, {
    getMarket: () => ({
      provider: 'binance',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      timezone: 'America/Los_Angeles',
      currency: 'USD',
    }),
  });
  // 00:30 UTC is still the previous local day in Los Angeles. Both report
  // surfaces must agree instead of frequency silently bucketing in UTC.
  assert.deepEqual(report.analysis.frequency, [{ x: '2024-01-01', y: 1 }]);
  assert.deepEqual(report.netDailyPnl, [{ x: '2024-01-01', y: 10, label: '1 trades' }]);
});

test('透传回测设置快照和最新执行位置，不把它们误当成完整曲线', () => {
  const report = mapSnapshot(snapshot('contract-fields', {
    inputs: {
      schema: [{ key: 'length', title: 'Length', type: 'int', defval: 20 }],
      values: { length: 55 },
    },
    props: {
      schema: [{ key: 'initial_capital', title: 'Initial capital', type: 'float', defval: 1000 }],
      values: { initial_capital: 2500 },
    },
    execution: {
      barIndex: 10,
      time: 2_000,
      phase: 'idle',
      seriesKeys: ['equityPlot'],
    },
  }));
  assert.equal(report.settings?.inputValues.length, 55);
  assert.equal(report.settings?.propValues.initial_capital, 2500);
  assert.equal(report.settings?.inputs[0].key, 'length');
  assert.equal(report.settings?.props[0].key, 'initial_capital');
  assert.deepEqual(report.execution, {
    barIndex: 10,
    time: 2_000,
    phase: 'idle',
    seriesKeys: ['equityPlot'],
  });
  assert.ok(Object.isFrozen(report.settings));
  assert.ok(Object.isFrozen(report.settings.inputValues));
  assert.ok(Object.isFrozen(report.execution));
  // No exact curve is implied by bounded execution metadata.
  assert.equal(report.capabilities.hasEquityCurve, false);
  assert.equal(report.capabilities.hasRealizedPnlCurve, true);
  assert.equal(report.cumulativePnlSource, 'realized-ledger');
  assert.deepEqual(report.cumulativePnl, [{
    x: 0,
    y: 10,
    time: 2_000,
    direction: 'long',
    tradeNumber: 1,
  }]);
  assert.equal(report.equity, undefined);
});

test('keeps directional metrics, analysis points, and simulation populations distinct', () => {
  const winning = snapshot('mixed').trades[0];
  const losing = {
    id: 'mixed-loss',
    side: 'short',
    qty: 2,
    entry: { id: 'short-entry', time: 3_000, price: 120 },
    exit: { id: 'short-exit', time: 4_000, price: 125 },
    open: false,
    pnl: -10,
    maxDrawdown: 12,
    maxRunup: 2,
  };
  const base = snapshot('mixed');
  const report = mapSnapshot({
    ...base,
    trades: [winning, losing],
    context: {
      ...base.context,
      trades: [winning, losing],
      strategy: {
        ...base.context.strategy,
        netPnl: 0,
        grossProfit: 10,
        grossLoss: 10,
        wins: 1,
        losses: 1,
      },
    },
  }, {
    getMarket: () => ({
      provider: 'binance',
      symbol: 'BTCUSDT',
      timeframe: '1h',
      timezone: 'UTC',
      currency: 'USD',
    }),
  });

  assert.equal(report.metrics.grossLoss, 10);
  assert.equal(report.comparison.all.grossLoss, 10);
  assert.equal(report.comparison.short.grossLoss, 10);
  assert.equal(report.comparison.long.grossLoss, 0);
  assert.equal(report.analysis.comparison.all.trades, 2);
  assert.equal(report.analysis.comparison.short.trades, 1);
  assert.ok((report.analysis?.pnlDistribution?.length ?? 0) > 0);
  assert.ok((report.analysis?.durationPnl?.length ?? 0) > 0);
  assert.ok((report.analysis?.frequency?.length ?? 0) > 0);
  assert.equal(report.simulation?.runs, 1000);
  assert.ok(report.simulation?.metrics?.probabilityOfProfit >= 0);
  assert.ok(report.simulation?.metrics?.probabilityOfProfit <= 1);
  assert.ok(Object.isFrozen(report.comparison));
  assert.ok(Object.isFrozen(report.simulation));
});

test('analysis winrate projects an open row to the reference breakeven category only', () => {
  const winning = snapshot('winrate-breakdown').trades[0];
  const current = {
    id: 'winrate-current',
    side: 'short',
    qty: 1,
    entry: { id: 'current-entry', time: 3_000, price: 120 },
    exit: null,
    open: true,
    pnl: null,
  };
  const base = snapshot('winrate-breakdown', {
    trades: [winning, current],
  });
  base.context = {
    ...base.context,
    trades: [winning, current],
    strategy: {
      ...base.context.strategy,
      position: -1,
      openPnl: -2,
    },
  };
  const report = mapSnapshot(base);
  assert.deepEqual(
    report.analysis.winRateBreakdown.map(({ x, y }) => ({ x, y })),
    [
      { x: 'Winners', y: 1 },
      { x: 'Losers', y: 0 },
      { x: 'Breakevens', y: 1 },
    ],
  );
  assert.equal(report.analysis.winRatePercent, 50);
  assert.equal(report.analysis.winRateBreakdown.some(({ x }) => x === 'Current'), false);
  assert.equal(report.analysis.comparison.all.winRate, 50);
  assert.equal(report.analysis.comparison.all.trades, 2);
  assert.equal(report.analysis.comparison.all.winningTrades, 1);
  assert.equal(report.analysis.comparison.all.breakevenTrades, 1);
  assert.equal(report.analysis.closedTradeCount, 1);
  assert.deepEqual(Object.keys(report.analysis.comparison.all), [
    'trades',
    'winningTrades',
    'losingTrades',
    'breakevenTrades',
    'winRate',
    'averageTrade',
    'averageWinner',
    'averageLoser',
    'largestWinner',
    'largestLoser',
  ]);
  assert.deepEqual(Object.keys(report.analysis.durationComparison.all), [
    'averageDurationBars',
    'averageWinningDurationBars',
    'averageLosingDurationBars',
    'averageTradesPerDay',
    'averageTradesPerWeek',
    'longestDurationBars',
    'shortestDurationBars',
    'longestWinningStreakBars',
    'longestLosingStreakBars',
  ]);
  assert.deepEqual(report.analysis.pnlReferenceLines.map(({ x }) => x), [
    'Avg Winning Trade',
    'Avg Losing Trade',
    'Avg Trade',
  ]);
  assert.deepEqual(report.analysis.pnlReferenceLines.map(({ y }) => y), [0, 0, 0]);
  assert.equal(report.metrics.winRate, 100);
});

test('analysis table and donut retain their distinct missing-delta denominators', () => {
  const winning = snapshot('analysis-denominators').trades[0];
  const missingDelta = {
    id: 'missing-delta',
    side: 'long',
    qty: 1,
    entry: { id: 'missing-entry', time: 3_000, price: 100 },
    exit: { id: 'missing-exit', time: 4_000, price: 101 },
    open: false,
    delta: null,
  };
  const base = snapshot('analysis-denominators', { trades: [winning, missingDelta] });
  base.context = { ...base.context, trades: [winning, missingDelta] };
  const report = mapSnapshot(base, {
    getMarket: () => ({ provider: 'binance', symbol: 'BTCUSDT', timeframe: '1h', timezone: 'UTC' }),
  });

  // First-table Win Rate uses all selected rows; donut center uses only the
  // finite winner/loser/breakeven counts.
  assert.equal(report.analysis.comparison.all.winRate, 50);
  assert.equal(report.analysis.winRatePercent, 100);
  assert.equal(report.analysis.comparison.all.trades, 1);
  assert.deepEqual(
    report.analysis.winRateBreakdown.map(({ x, y }) => ({ x, y })),
    [{ x: 'Winners', y: 1 }, { x: 'Losers', y: 0 }],
  );
});

test('analysis histogram references use only optional strategy aggregates', () => {
  const base = snapshot('analysis-reference-lines');
  base.context = {
    ...base.context,
    strategy: {
      ...base.context.strategy,
      averageWinningTrade: 12,
      averageLosingTrade: -4,
      averageTrade: 3,
    },
  };
  const report = mapSnapshot(base);
  assert.deepEqual(
    report.analysis.pnlReferenceLines.map(({ y }) => y),
    [12, -4, 3],
  );
});

test('maps and freezes the domain Duration vs P&L OLS trend', () => {
  const base = snapshot('analysis-trend');
  const start = Date.parse('2024-01-01T00:00:00.000Z');
  const oneHour = {
    ...base.trades[0],
    id: 'one-hour',
    entry: { id: 'one-hour-entry', time: start, price: 100 },
    exit: { id: 'one-hour-exit', time: start + 3_600_000, price: 110 },
    pnl: 10,
  };
  const threeHours = {
    ...base.trades[0],
    id: 'three-hours',
    entry: { id: 'three-hours-entry', time: start + 7_200_000, price: 100 },
    exit: { id: 'three-hours-exit', time: start + 18_000_000, price: 130 },
    pnl: 30,
  };
  const trades = [oneHour, threeHours];
  const report = mapSnapshot({
    ...base,
    trades,
    context: { ...base.context, trades },
  }, {
    getMarket: () => ({ provider: 'binance', symbol: 'BTCUSDT', timeframe: '1h', timezone: 'UTC' }),
  });

  assert.deepEqual(report.analysis.durationTrend, [{ x: 1, y: 10 }, { x: 3, y: 30 }]);
  assert.ok(Object.isFrozen(report.analysis.durationTrend));
  assert.ok(Object.isFrozen(report.analysis.durationTrend[0]));
});

test('preserves adapter terminal states instead of presenting them as ready', () => {
  for (const status of ['waiting-data', 'compiling', 'computing', 'updating', 'suspended', 'no-data', 'no-trades', 'open-only', 'partial']) {
    const report = mapSnapshot(snapshot(`status-${status}`, { status }));
    assert.equal(report.status, status);
  }
});

test('controller selects, updates, removes and destroys reports without leaking listeners', async () => {
  const source = new FakeSource([snapshot('s1')]);
  const controller = new BacktestController(source);
  const seen = [];
  const unsubscribe = controller.subscribe((report) => seen.push(report?.strategyName ?? null));
  await controller.start();
  assert.equal(source.subscribeCount, 1);
  assert.equal(controller.getActiveReport()?.strategyName, 'Strategy s1');

  source.emit({ type: 'snapshot', snapshot: snapshot('s2') });
  controller.setActive({ cellId: 'cell-1', indicatorId: 's2' });
  assert.equal(controller.getActiveReport()?.strategyName, 'Strategy s2');
  source.emit({ type: 'removed', key: { cellId: 'cell-1', indicatorId: 's2' } });
  assert.equal(controller.getActiveReport()?.strategyName, 'Strategy s1');
  assert.ok(seen.length >= 4);

  controller.destroy();
  unsubscribe();
  assert.equal(source.unsubscribeCount, 1);
  source.emit({ type: 'snapshot', snapshot: snapshot('late') });
  assert.equal(controller.getActiveReport(), null);
});

test('adapter errors do not escape to the workspace and become an error report', async () => {
  const source = new FakeSource();
  const controller = new BacktestController(source);
  const seen = [];
  controller.subscribe((report) => seen.push(report));
  await controller.start();
  source.emit({
    type: 'error',
    key: { cellId: 'cell-1', indicatorId: 'broken' },
    revision: 3,
    epoch: 1,
    error: new Error('compile failed'),
  });
  assert.equal(controller.getActiveReport()?.status, 'error');
  assert.match(controller.getActiveReport()?.error ?? '', /compile failed/);
  assert.ok(seen.length >= 2);
  controller.destroy();
});

test('maps Worker/provider error metadata to the UI report while keeping status=error', async () => {
  const source = new FakeSource();
  const controller = new BacktestController(source);
  await controller.start();
  const error = Object.assign(new Error('binance request timed out'), {
    name: 'ProviderTimeoutError',
    kind: 'provider',
    provider: 'binance',
    timeoutMs: 5_000,
    retryable: true,
  });
  source.emit({
    type: 'error',
    key: { cellId: 'cell-1', indicatorId: 'provider-failed' },
    revision: 4,
    epoch: 2,
    error,
  });
  const report = controller.getActiveReport();
  assert.equal(report?.status, 'error');
  assert.equal(report?.error, error.message);
  assert.deepEqual(report?.errorDetails, {
    message: error.message,
    name: 'ProviderTimeoutError',
    kind: 'provider',
    provider: 'binance',
    timeoutMs: 5_000,
    retryable: true,
  });
  controller.destroy();
});

test('an error event marks an existing last-good report stale without dropping its values', async () => {
  const source = new FakeSource([snapshot('error-overlay')]);
  const controller = new BacktestController(source);
  await controller.start();
  source.emit({
    type: 'error',
    key: { cellId: 'cell-1', indicatorId: 'error-overlay' },
    revision: 1,
    epoch: 0,
    error: new Error('runtime failed'),
  });
  const report = controller.getActiveReport();
  assert.equal(report?.status, 'error');
  assert.equal(report?.metrics?.netProfit, 10);
  assert.match(report?.error ?? '', /runtime failed/);
  controller.destroy();
});

test('does not promote stale or background-cell errors into the active Dock', async () => {
  const first = snapshot('active-strategy');
  const background = snapshot('background-strategy', {
    key: { cellId: 'cell-2', indicatorId: 'background-strategy' },
  });
  const source = new FakeSource([first, background]);
  const controller = new BacktestController(source);
  await controller.start();
  controller.setActiveCell('cell-1');
  assert.equal(controller.getActiveReport()?.key?.cellId, 'cell-1');

  source.emit({
    type: 'error',
    key: background.key,
    revision: 2,
    epoch: 0,
    error: new Error('background failed'),
  });
  assert.equal(controller.getActiveReport()?.key?.cellId, 'cell-1');

  // Remove the last strategy in the active cell. The Store retains the cell
  // selection and must stay empty rather than falling back to cell 2.
  source.emit({ type: 'removed', key: first.key });
  assert.equal(controller.getActiveReport(), null);

  // A late/stale background error is accepted neither as a revision update
  // nor as a new active report for the currently selected cell.
  source.emit({
    type: 'error',
    key: background.key,
    revision: 1,
    epoch: 0,
    error: new Error('stale background failure'),
  });
  assert.equal(controller.getActiveReport(), null);

  // A new error belonging to the selected cell may establish the Dock again.
  source.emit({
    type: 'error',
    key: first.key,
    revision: 1,
    epoch: 1,
    error: new Error('active cell failed'),
  });
  assert.equal(controller.getActiveReport()?.key?.cellId, 'cell-1');
  controller.destroy();
});

test('projection updates preserve the accepted revision after an error overlay', async () => {
  const source = new FakeSource([snapshot('projection-after-error')]);
  const controller = new BacktestController(source);
  const key = { cellId: 'cell-1', indicatorId: 'projection-after-error' };
  await controller.start();

  // Error events can advance the UI/Store revision while retaining the older
  // domain report for last-good values. A favorite projection must still be
  // accepted rather than being rejected as an older domain revision.
  source.emit({
    type: 'error',
    key,
    revision: 7,
    epoch: 0,
    error: new Error('temporary runtime failure'),
  });
  const favorited = controller.setFavorite(key, true);
  assert.equal(favorited?.favorite, true);
  assert.equal(controller.getSnapshot()?.favorite, true);
  assert.equal(controller.reportStore.get(key)?.revision, 7);

  // The viewer does not expose Simulation controls while an error is shown.
  // Reconcile a later ready projection at the same accepted revision to verify
  // that updateSimulation also keeps that revision instead of rolling back to
  // the domain revision (which is still 1 in this fixture).
  const entry = controller.reportStore.get(key);
  assert.ok(entry);
  controller.reportStore.upsert(
    key,
    entry.domain,
    {
      ...entry.report,
      status: 'ready',
      error: undefined,
    },
    entry.epoch,
    entry.revision,
  );
  const simulated = controller.updateSimulation({ method: 'shuffle', runs: 8 });
  assert.equal(simulated?.simulation?.runs, 8);
  assert.equal(controller.reportStore.get(key)?.revision, 7);
  controller.destroy();
});

test('does not present an unavailable ledger or exact curves as zero', () => {
  const base = snapshot('unavailable');
  const report = mapSnapshot({
    ...base,
    status: 'computing',
    ledgerState: 'idle',
    trades: null,
    capabilities: {
      ...base.capabilities,
      tradeLedger: false,
      exactEquityCurve: false,
      exactDrawdownCurve: false,
      riskRatios: false,
      benchmark: false,
    },
  });
  assert.equal(report.status, 'computing');
  assert.equal(report.metrics.trades.value, null);
  assert.equal(report.metrics.trades.unavailableReason, 'partial-ledger');
  assert.equal(report.metrics.winRate.value, null);
  assert.equal(report.metrics.netProfit, 10);
  assert.equal(report.metrics.maxDrawdown.value, null);
  assert.equal(report.metrics.sharpe.value, null);
  assert.equal(report.metrics.buyAndHoldPnl.value, null);
  assert.equal(report.capabilities.hasRealizedPnlCurve, false);
  assert.equal(report.cumulativePnlSource, undefined);
  assert.equal(report.cumulativePnl, undefined);
  assert.equal(report.equity, undefined);
  assert.equal(report.simulation, undefined);
  assert.equal(report.simulationUnavailableReason, 'unsettled-ledger');
});

test('does not expose a previous ledger while a newer computation is pending', () => {
  const base = snapshot('pending');
  const report = mapSnapshot({
    ...base,
    status: 'computing',
    ledgerState: 'ready',
    revision: 2,
    trades: base.trades,
  });
  assert.equal(report.metrics.trades.value, null);
  assert.equal(report.metrics.trades.unavailableReason, 'partial-ledger');
  assert.deepEqual(report.trades, []);
});

test('D01 terminal UI status requires the same history and revision proof as its ledger', () => {
  const base = snapshot('readiness-proof');
  for (const status of ['ready', 'no-trades', 'open-only']) {
    for (const finality of ['unknown', 'partial-history']) {
      const report = mapSnapshot({ ...base, status, finality });
      assert.equal(report.status, 'partial', `${status}/${finality}`);
      assert.equal(report.capabilities.canSimulate, false);
      assert.deepEqual(report.trades, []);
    }
    for (const ledgerRevision of [null, undefined, 0]) {
      const report = mapSnapshot({ ...base, status, ledgerRevision });
      assert.equal(report.status, 'computing', `${status}/${ledgerRevision}`);
      assert.equal(report.capabilities.canSimulate, false);
      assert.deepEqual(report.trades, []);
    }
  }
  const live = mapSnapshot({ ...base, finality: 'live-provisional' });
  assert.equal(live.status, 'ready');
  assert.equal(live.trades.length, 1);
});

test('keeps no-trades and open-only as explicit terminal states', () => {
  const base = snapshot('terminal');
  const noTrades = mapSnapshot({
    ...base,
    status: 'no-trades',
    trades: [],
    context: { ...base.context, trades: [] },
  });
  assert.equal(noTrades.status, 'no-trades');
  assert.equal(noTrades.metrics.trades, 0);
  assert.deepEqual(noTrades.trades, []);
  assert.equal(noTrades.simulationUnavailableReason, 'no-closed-trades');

  const openTrade = {
    ...base.trades[0],
    id: 'open',
    open: true,
    exit: undefined,
    pnl: undefined,
  };
  const openOnly = mapSnapshot({
    ...base,
    status: 'open-only',
    trades: [openTrade],
    context: { ...base.context, trades: [openTrade] },
  });
  assert.equal(openOnly.status, 'open-only');
  assert.equal(openOnly.metrics.trades, 0);
  assert.equal(openOnly.trades[0].status, 'open');
  assert.equal(openOnly.simulationUnavailableReason, 'no-closed-trades');

  const invalidCapital = mapSnapshot({
    ...base,
    context: {
      ...base.context,
      strategy: { ...base.context.strategy, initialCapital: 0 },
    },
  });
  assert.equal(invalidCapital.simulation, undefined);
  assert.equal(invalidCapital.simulationUnavailableReason, 'invalid-initial-capital');
});

test('controller source ownership is explicit and destroy is idempotent', async () => {
  const borrowed = new FakeSource([snapshot('borrowed')]);
  const borrowedController = new BacktestController(borrowed);
  await borrowedController.start();
  borrowedController.destroy();
  borrowedController.destroy();
  assert.equal(borrowed.destroyed, false);

  const owned = new FakeSource([snapshot('owned')]);
  const ownedController = new BacktestController(owned, { ownsSource: true });
  await Promise.all([ownedController.start(), ownedController.start()]);
  ownedController.destroy();
  ownedController.destroy();
  assert.equal(owned.destroyed, true);
  assert.equal(owned.unsubscribeCount, 1);
});

test('failed bootstrap can be retried without duplicating source subscriptions', async () => {
  const source = new FlakySource([snapshot('retry')]);
  const diagnostics = [];
  const controller = new BacktestController(source, {
    onDiagnostic: (message) => diagnostics.push(message),
  });
  await controller.start();
  assert.equal(controller.getActiveReport(), null);
  await controller.start();
  assert.equal(source.attempts, 2);
  assert.equal(source.subscribeCount, 1);
  assert.equal(controller.getActiveReport()?.strategyName, 'Strategy retry');
  assert.equal(diagnostics.length, 1);
  controller.destroy();
});

test('store rejects stale revisions and makes active subscriptions idempotent', () => {
  const store = new BacktestStore();
  const first = mapSnapshot(snapshot('store'));
  // Store tests use the real domain report from a mapped snapshot so no
  // provider details leak into this application-level contract.
  const domainReport = mapSnapshotDomain(snapshot('store'));
  assert.equal(store.upsert(first.key, domainReport, first, 2), true);
  assert.equal(store.upsert(first.key, domainReport, first, 1), false);
  const seen = [];
  const unsubscribe = store.subscribeActive((report) => seen.push(report?.runId ?? null));
  const unsubscribeAgain = unsubscribe;
  unsubscribe();
  unsubscribeAgain();
  store.destroy();
  assert.equal(store.upsert(first.key, domainReport, first, 3), false);
  assert.equal(seen.length, 1);
});

test('store keeps the active chart cell when its last strategy is removed', () => {
  const store = new BacktestStore();
  const firstSnapshot = snapshot('cell-one');
  const secondSnapshot = snapshot('cell-two', {
    key: { cellId: 'cell-2', indicatorId: 'cell-two' },
  });
  const firstReport = mapSnapshot(firstSnapshot);
  const secondReport = mapSnapshot(secondSnapshot);
  const firstDomain = mapSnapshotDomain(firstSnapshot);
  const secondDomain = mapSnapshotDomain(secondSnapshot);
  assert.equal(store.upsert(firstReport.key, firstDomain, firstReport), true);
  assert.equal(store.upsert(secondReport.key, secondDomain, secondReport), true);

  store.setActiveCell('cell-1');
  assert.equal(store.active?.cellId, 'cell-1');
  assert.equal(store.remove(firstReport.key), true);
  store.ensureActive();
  assert.equal(store.active, null);
  assert.equal(store.activeReport(), null);

  const replacementSnapshot = snapshot('cell-one-replacement', {
    key: { cellId: 'cell-1', indicatorId: 'cell-one-replacement' },
  });
  const replacement = mapSnapshot(replacementSnapshot);
  store.upsert(replacement.key, mapSnapshotDomain(replacementSnapshot), replacement);
  store.ensureActive(replacement.key);
  assert.equal(store.active?.cellId, 'cell-1');
  assert.equal(store.active?.indicatorId, 'cell-one-replacement');
  store.destroy();
});

test('background-cell snapshots do not steal an empty active chart selection', async () => {
  const source = new FakeSource([snapshot('background', {
    key: { cellId: 'cell-2', indicatorId: 'background' },
  })]);
  const controller = new BacktestController(source);
  await controller.start();
  controller.setActiveCell('cell-1');
  assert.equal(controller.getActiveReport(), null);
  source.emit({
    type: 'snapshot',
    snapshot: snapshot('background-late', {
      key: { cellId: 'cell-2', indicatorId: 'background-late' },
    }),
  });
  assert.equal(controller.getActiveReport(), null);
  source.emit({
    type: 'snapshot',
    snapshot: snapshot('active-cell', {
      key: { cellId: 'cell-1', indicatorId: 'active-cell' },
    }),
  });
  assert.equal(controller.getActiveReport()?.key?.cellId, 'cell-1');
  controller.destroy();
});

test('background-cell errors do not steal an empty active chart selection', async () => {
  const source = new FakeSource();
  const controller = new BacktestController(source);
  await controller.start();
  controller.setActiveCell('cell-1');
  source.emit({
    type: 'error',
    key: { cellId: 'cell-2', indicatorId: 'background-error' },
    revision: 1,
    epoch: 0,
    error: new Error('background compile failed'),
  });
  assert.equal(controller.getActiveReport(), null);
  source.emit({
    type: 'error',
    key: { cellId: 'cell-1', indicatorId: 'active-error' },
    revision: 1,
    epoch: 0,
    error: new Error('active compile failed'),
  });
  assert.equal(controller.getActiveReport()?.key?.cellId, 'cell-1');
  controller.destroy();
});

test('simulation updates stay local to the current immutable snapshot', async () => {
  const source = new FakeSource([snapshot('simulation')]);
  const controller = new BacktestController(source);
  await controller.start();
  const before = controller.getSnapshot();
  assert.ok(before);
  const updated = controller.updateSimulation({ method: 'shuffle', runs: 12, variationPercent: 5 });
  assert.ok(updated);
  assert.equal(updated.simulation?.runs, 12);
  assert.equal(updated.simulation?.method, 'shuffle');
  assert.equal(updated.simulation?.outcomeChartMode, 'histogram');
  assert.equal(updated.simulation?.drawdownChartMode, 'histogram');
  assert.equal(updated.simulation?.drawdownHistogram?.length > 0, true);
  assert.equal(updated.simulation?.actual?.maxDrawdown, 0);
  assert.equal(source.subscribeCount, 1);
  assert.equal(updated.runId, before.runId);
  assert.strictEqual(
    updated.trades,
    before.trades,
    'same-revision UI projections retain the immutable ledger identity',
  );
  controller.destroy();
});

test('large Simulation runs publish Worker progress and complete without blocking projections', async () => {
  const source = new FakeSource([snapshot('simulation-worker-progress')]);
  const worker = new FakeSimulationTaskRunner();
  const controller = new BacktestController(source, {
    simulationWorkerRunner: worker,
    simulationWorkerThreshold: 2_000,
  });
  await controller.start();

  const pending = controller.updateSimulation({ runs: 2_500 });
  assert.equal(worker.tasks.length, 1);
  assert.equal(worker.tasks[0].input.runs, 2_500);
  assert.equal(pending?.simulation?.runs, 1_000, 'last settled result stays visible');
  assert.deepEqual(pending?.simulationRun, {
    status: 'pending',
    requestId: 1,
    completedRuns: 0,
    totalRuns: 2_500,
    progress: 0,
    settings: {
      method: 'resample',
      runs: 2_500,
      variationPercent: 0,
      preserveWinLoss: false,
      drawdownMultiple: 2,
      drawdownUnit: 'currency',
      outcomeChartMode: 'histogram',
      drawdownChartMode: 'histogram',
    },
  });
  assert.equal(Object.isFrozen(pending?.simulationRun), true);
  assert.equal(Object.isFrozen(pending?.simulationRun?.settings), true);

  worker.tasks[0].progress(1_250);
  assert.equal(controller.getSnapshot()?.simulationRun?.progress, 0.5);
  assert.equal(controller.getSnapshot()?.simulationRun?.completedRuns, 1_250);

  const projected = controller.updateSimulation({
    drawdownMultiple: 3,
    drawdownUnit: 'percent',
    drawdownChartMode: 'cumulative',
  });
  assert.equal(worker.tasks.length, 1, 'view-only changes must not restart the Worker');
  assert.equal(projected?.simulationRun?.settings.drawdownMultiple, 3);
  assert.equal(projected?.simulationRun?.settings.drawdownUnit, 'percent');
  assert.equal(projected?.simulationRun?.settings.drawdownChartMode, 'cumulative');

  worker.tasks[0].complete();
  await new Promise((resolve) => setImmediate(resolve));
  const completed = controller.getSnapshot();
  assert.equal(completed?.simulationRun, undefined);
  assert.equal(completed?.simulation?.runs, 2_500);
  assert.equal(completed?.simulation?.drawdownMultiple, 3);
  assert.equal(completed?.simulation?.drawdownUnit, 'percent');
  assert.equal(completed?.simulation?.drawdownChartMode, 'cumulative');
  controller.destroy();
  assert.equal(worker.destroyed, false, 'borrowed runners are not torn down');
});

test('superseded Simulation Workers cannot publish stale results and failures stay local', async () => {
  const source = new FakeSource([snapshot('simulation-worker-supersede')]);
  const worker = new FakeSimulationTaskRunner();
  const diagnostics = [];
  const controller = new BacktestController(source, {
    simulationWorkerRunner: worker,
    simulationWorkerThreshold: 2_000,
    onDiagnostic: (message) => diagnostics.push(message),
  });
  await controller.start();

  controller.updateSimulation({ runs: 2_500 });
  controller.updateSimulation({ method: 'shuffle' });
  assert.equal(worker.tasks.length, 2);
  assert.equal(worker.tasks[0].cancelled, true);
  assert.equal(worker.tasks[1].input.mode, 'shuffle');

  worker.tasks[0].complete();
  worker.tasks[0].progress(2_500);
  assert.equal(controller.getSnapshot()?.simulationRun?.requestId, 2);
  worker.tasks[1].fail(new Error('worker and fallback failed'));
  await new Promise((resolve) => setImmediate(resolve));

  const failed = controller.getSnapshot();
  assert.equal(failed?.status, 'ready');
  assert.equal(failed?.simulation?.runs, 1_000, 'last good Simulation remains available');
  assert.equal(failed?.simulationRun?.status, 'error');
  assert.match(failed?.simulationRun?.message ?? '', /worker and fallback failed/);
  assert.equal(diagnostics.includes('backtest Simulation failed'), true);
  controller.destroy();
});

test('live snapshots reuse a matching Worker and restart changed populations off the main thread', async () => {
  const initial = snapshot('simulation-worker-live', { finality: 'live-provisional' });
  const source = new FakeSource([initial]);
  const worker = new FakeSimulationTaskRunner();
  const controller = new BacktestController(source, {
    simulationWorkerRunner: worker,
    simulationWorkerThreshold: 2_000,
  });
  await controller.start();

  controller.updateSimulation({ runs: 2_500 });
  assert.equal(worker.tasks.length, 1);
  source.emit({
    type: 'snapshot',
    snapshot: { ...initial, revision: 2, ledgerRevision: 2 },
  });
  assert.equal(worker.tasks.length, 1, 'unchanged population keeps the in-flight Worker');
  assert.equal(worker.tasks[0].cancelled, false);
  assert.equal(controller.getSnapshot()?.revision, 2);
  assert.equal(controller.getSnapshot()?.simulationRun?.requestId, 1);

  worker.tasks[0].complete();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getSnapshot()?.simulation?.runs, 2_500);
  assert.equal(controller.getSnapshot()?.revision, 2);

  controller.updateSimulation({ variationPercent: 10 });
  assert.equal(worker.tasks.length, 2);
  const secondTrade = {
    ...initial.trades[0],
    id: 'simulation-worker-live-trade-2',
    entry: { id: 'entry-2', time: 3_000, price: 110 },
    exit: { id: 'exit-2', time: 4_000, price: 105 },
    pnl: -5,
  };
  const changedTrades = [...initial.trades, secondTrade];
  source.emit({
    type: 'snapshot',
    snapshot: {
      ...initial,
      revision: 3,
      ledgerRevision: 3,
      trades: changedTrades,
      context: {
        ...initial.context,
        trades: changedTrades,
        strategy: {
          ...initial.context.strategy,
          netPnl: 5,
          grossLoss: 5,
          losses: 1,
        },
      },
    },
  });

  assert.equal(worker.tasks[1].cancelled, true);
  assert.equal(worker.tasks.length, 3, 'changed population starts one replacement Worker');
  assert.equal(worker.tasks[2].input.deltas.length, 2);
  assert.equal(worker.tasks[2].input.runs, 2_500);
  assert.equal(controller.getSnapshot()?.simulation?.runs, 1_000);
  assert.equal(controller.getSnapshot()?.simulationRun?.requestId, 3);
  worker.tasks[2].complete();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.getSnapshot()?.simulation?.runs, 2_500);
  assert.equal(controller.getSnapshot()?.simulation?.populationSize, 2);
  controller.destroy();
});

test('maps the exact reference Simulation result into a deeply immutable UI DTO', () => {
  const base = snapshot('reference-simulation-dto');
  const rows = [
    { id: 'win', pnl: 10, mae: 3, entryTime: 1_000, exitTime: 2_000 },
    { id: 'loss', pnl: -4, mae: undefined, entryTime: 3_000, exitTime: 4_000 },
    { id: 'win-2', pnl: 2, mae: 1, entryTime: 5_000, exitTime: 6_000 },
  ].map((row) => ({
    ...base.trades[0],
    id: row.id,
    pnl: row.pnl,
    mae: row.mae,
    entry: { id: `${row.id}-entry`, time: row.entryTime, price: 100 },
    exit: { id: `${row.id}-exit`, time: row.exitTime, price: 101 },
  }));
  const report = mapSnapshot({
    ...base,
    trades: rows,
    context: {
      ...base.context,
      trades: rows,
      strategy: {
        ...base.context.strategy,
        initialCapital: 1_000,
        netPnl: 8,
        grossProfit: 12,
        grossLoss: 4,
        wins: 2,
        losses: 1,
      },
    },
  });
  const simulation = report.simulation;
  assert.ok(simulation);
  const deltas = [10, -4, 2];
  const mae = [3, 4, 1];
  const expected = simulateBacktestReference({
    deltas,
    excursions: { mae },
    initialCapital: 1_000,
    runs: 1_000,
    mode: 'resample',
    seed: 12_648_430,
  });
  const actual = walkBacktestEquity(deltas, 1_000, { mae });
  assert.equal(simulation.populationSize, 3);
  assert.equal(simulation.usesMae, true);
  assert.deepEqual(simulation.bands, expected.bands);
  assert.equal(simulation.metrics.probabilityOfProfit, expected.probProfit);
  assert.equal(
    simulation.metrics.p95DrawdownPercent,
    linearPercentile(expected.openMaxDrawdowns, 0.95) * 100,
  );
  assert.deepEqual(
    simulation.actual.path,
    actual.path.map((y, x) => ({ x, y })),
  );
  assert.equal(simulation.actual.openMaxDrawdown, actual.openMaxDrawdownAbs);
  assert.equal(simulation.metrics.thresholdPercent, actual.openMaxDrawdown * 2 * 100);
  assert.ok(Object.isFrozen(simulation));
  assert.ok(Object.isFrozen(simulation.bands));
  assert.ok(Object.isFrozen(simulation.bands.p50));
  assert.ok(Object.isFrozen(simulation.outcomeHistogram));
  assert.ok(Object.isFrozen(simulation.outcomeHistogram[0]));
  assert.ok(Object.isFrozen(simulation.metrics));
  assert.ok(Object.isFrozen(simulation.actual));
  assert.ok(Object.isFrozen(simulation.actual.path));
  assert.ok(Object.isFrozen(simulation.streaks));
  assert.ok(Object.isFrozen(simulation.streaks.recoveryDuration));
});

test('partial Simulation view changes preserve settings and invalid numeric changes are bounded', async () => {
  const source = new FakeSource([snapshot('simulation-partial-change')]);
  const controller = new BacktestController(source);
  await controller.start();
  const configured = controller.updateSimulation({
    method: 'shuffle',
    runs: 250,
    variationPercent: 10,
    preserveWinLoss: true,
    drawdownMultiple: 3,
    drawdownUnit: 'percent',
    outcomeChartMode: 'cumulative',
  });
  assert.ok(configured?.simulation);
  const viewOnly = controller.updateSimulation({ drawdownChartMode: 'cumulative' });
  assert.equal(viewOnly?.simulation?.method, 'shuffle');
  assert.equal(viewOnly?.simulation?.runs, 250);
  assert.equal(viewOnly?.simulation?.variationPercent, 10);
  assert.equal(viewOnly?.simulation?.preserveWinLoss, true);
  assert.equal(viewOnly?.simulation?.drawdownMultiple, 3);
  assert.equal(viewOnly?.simulation?.drawdownUnit, 'percent');
  assert.equal(viewOnly?.simulation?.outcomeChartMode, 'cumulative');
  assert.equal(viewOnly?.simulation?.drawdownChartMode, 'cumulative');
  assert.equal(viewOnly?.simulation?.drawdownHistogram.at(-1)?.to <= 1, true);

  const bounded = controller.updateSimulation({ runs: Number.NaN, variationPercent: Number.NaN });
  assert.equal(bounded?.simulation?.runs, 1_000);
  assert.equal(bounded?.simulation?.variationPercent, 0);
  assert.equal(Number.isFinite(bounded?.simulation?.metrics.medianOutcome), true);
  controller.destroy();
});

test('Simulation view projections reuse one cached Monte Carlo core', async () => {
  let simulationRuns = 0;
  const source = new FakeSource([snapshot('simulation-projection-cache')]);
  const controller = new BacktestController(source, {
    simulationRunner: (input) => {
      simulationRuns += 1;
      return simulateBacktestReference(input);
    },
  });
  await controller.start();
  const initial = controller.getSnapshot()?.simulation;
  assert.ok(initial);
  assert.equal(simulationRuns, 1);

  const projected = controller.updateSimulation({
    drawdownMultiple: 3,
    outcomeChartMode: 'cumulative',
    drawdownChartMode: 'cumulative',
  })?.simulation;
  assert.ok(projected);
  assert.equal(simulationRuns, 1, 'projection-only settings must not rerun Monte Carlo');
  assert.strictEqual(projected.bands, initial.bands);
  assert.strictEqual(projected.outcomeHistogram, initial.outcomeHistogram);
  assert.strictEqual(projected.drawdownHistogram, initial.drawdownHistogram);
  assert.strictEqual(projected.actual, initial.actual);
  assert.strictEqual(projected.streaks, initial.streaks);
  assert.notStrictEqual(projected.metrics, initial.metrics);

  const percent = controller.updateSimulation({ drawdownUnit: 'percent' })?.simulation;
  assert.ok(percent);
  assert.equal(simulationRuns, 1, 'unit projection must reuse cached drawdown populations');
  assert.notStrictEqual(percent.drawdownHistogram, initial.drawdownHistogram);
  const currency = controller.updateSimulation({ drawdownUnit: 'currency' })?.simulation;
  assert.ok(currency);
  assert.equal(simulationRuns, 1);
  assert.strictEqual(currency.drawdownHistogram, initial.drawdownHistogram);

  controller.updateSimulation({ runs: 250 });
  assert.equal(simulationRuns, 2);
  controller.updateSimulation({ method: 'shuffle' });
  assert.equal(simulationRuns, 3);
  controller.updateSimulation({ variationPercent: 10 });
  assert.equal(simulationRuns, 4);
  controller.updateSimulation({ preserveWinLoss: true });
  assert.equal(simulationRuns, 5);
  controller.updateSimulation({ drawdownMultiple: 1.5, drawdownUnit: 'percent' });
  assert.equal(simulationRuns, 5);
  controller.destroy();
});

test('Simulation cache is bounded per immutable domain report', async () => {
  let simulationRuns = 0;
  const source = new FakeSource([snapshot('simulation-bounded-cache')]);
  const controller = new BacktestController(source, {
    simulationRunner: (input) => {
      simulationRuns += 1;
      return simulateBacktestReference(input);
    },
  });
  await controller.start();
  assert.equal(simulationRuns, 1);

  for (let runs = 1; runs <= BACKTEST_SIMULATION_CACHE_LIMIT_PER_REPORT; runs += 1) {
    controller.updateSimulation({ runs });
  }
  assert.equal(simulationRuns, 1 + BACKTEST_SIMULATION_CACHE_LIMIT_PER_REPORT);

  // The initial 1,000-run entry is now the least-recently-used ninth key and
  // must have been evicted from the eight-entry per-report cache.
  controller.updateSimulation({ runs: 1_000 });
  assert.equal(simulationRuns, 2 + BACKTEST_SIMULATION_CACHE_LIMIT_PER_REPORT);
  controller.updateSimulation({ drawdownChartMode: 'cumulative' });
  assert.equal(simulationRuns, 2 + BACKTEST_SIMULATION_CACHE_LIMIT_PER_REPORT);
  controller.destroy();
});

test('live revisions preserve Simulation controls and reuse an unchanged trade population', async () => {
  let simulationRuns = 0;
  const initial = snapshot('simulation-live-cache', { finality: 'live-provisional' });
  const source = new FakeSource([initial]);
  const controller = new BacktestController(source, {
    simulationRunner: (input) => {
      simulationRuns += 1;
      return simulateBacktestReference(input);
    },
  });
  await controller.start();
  assert.equal(simulationRuns, 1);

  const configured = controller.updateSimulation({
    method: 'shuffle',
    runs: 250,
    variationPercent: 10,
    preserveWinLoss: true,
    drawdownMultiple: 3,
    drawdownUnit: 'percent',
    outcomeChartMode: 'cumulative',
    drawdownChartMode: 'cumulative',
  });
  assert.ok(configured?.simulation);
  assert.equal(simulationRuns, 2);

  source.emit({
    type: 'snapshot',
    snapshot: {
      ...initial,
      revision: 2,
      ledgerRevision: 2,
      runToken: 'simulation-live-cache:run:2',
    },
  });
  const unchanged = controller.getSnapshot()?.simulation;
  assert.equal(simulationRuns, 2, 'an unchanged forming tick must reuse the Monte Carlo core');
  assert.equal(unchanged?.method, 'shuffle');
  assert.equal(unchanged?.runs, 250);
  assert.equal(unchanged?.variationPercent, 10);
  assert.equal(unchanged?.preserveWinLoss, true);
  assert.equal(unchanged?.drawdownMultiple, 3);
  assert.equal(unchanged?.drawdownUnit, 'percent');
  assert.equal(unchanged?.outcomeChartMode, 'cumulative');
  assert.equal(unchanged?.drawdownChartMode, 'cumulative');

  const changedTrade = { ...initial.trades[0], pnl: 11 };
  source.emit({
    type: 'snapshot',
    snapshot: {
      ...initial,
      revision: 3,
      ledgerRevision: 3,
      runToken: 'simulation-live-cache:run:3',
      trades: [changedTrade],
      context: {
        ...initial.context,
        strategy: {
          ...initial.context.strategy,
          equity: 1_011,
          netPnl: 11,
          grossProfit: 11,
        },
        trades: [changedTrade],
      },
    },
  });
  const changed = controller.getSnapshot()?.simulation;
  assert.equal(simulationRuns, 3, 'a changed closed-trade population must be simulated again');
  assert.equal(changed?.actual.finalPnl, 11);
  assert.equal(changed?.runs, 250);
  assert.equal(changed?.drawdownUnit, 'percent');
  controller.destroy();
});
