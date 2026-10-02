import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBacktestReport,
  normalizeExitTime,
  normalizeFill,
  normalizeOrder,
  normalizeTrade,
  selectTradePopulations,
} from '../src/domain/backtesting.ts';
import {
  calculateAnalysisMetrics,
  calculatePerformanceMetrics,
  calculateSummaryMetrics,
  formatMetricValue,
  metric,
  MAX_SIMULATION_RUNS,
  runSimulation,
  SimulationCancelledError,
} from '../src/domain/backtest-metrics.ts';

const closed = (id, pnl, direction = 'long', at = id * 1000) => ({
  id,
  direction,
  quantity: 1,
  entryTime: at - 500,
  entryPrice: 100,
  exitTime: at,
  exitPrice: 100 + pnl,
  netPnl: pnl,
});

test('normalizes every documented open-exit sentinel to null', () => {
  for (const value of [0, '0', 'epoch', '1970-01-01', 'N/A', 'open', null, undefined]) {
    assert.equal(normalizeExitTime(value), null, String(value));
  }
  assert.equal(normalizeExitTime('2024-01-01T00:00:00.000Z'), Date.parse('2024-01-01T00:00:00.000Z'));
  const trade = normalizeTrade({
    id: 0,
    direction: 'long',
    quantity: 1,
    entryTime: 1,
    entryPrice: 100,
    exitTime: 'N/A',
    exitPrice: 101,
    pnl: -2,
    unrealizedPnl: -2,
  });
  assert.equal(trade.exitTime, null);
  assert.equal(trade.exitPrice, null);
  assert.equal(trade.status, 'open');
});

test('maps Vela StrategyTrade entry/exit shape without treating an open exit as epoch', () => {
  const trade = normalizeTrade({
    id: 'vela-1',
    side: 'short',
    qty: 2,
    entry: { id: 'entry-order', time: 1000, price: 100 },
    open: true,
    pnl: undefined,
    maxDrawdown: 3,
    maxRunup: 8,
  });
  assert.equal(trade.direction, 'short');
  assert.equal(trade.quantity, 2);
  assert.equal(trade.entryTime, 1000);
  assert.equal(trade.exitTime, null);
  assert.equal(trade.entryOrderId, 'entry-order');
  assert.equal(trade.mae, 3);
  assert.equal(trade.mfe, 8);
});

test('normalizes local and provider bar-index aliases without inventing reversal links', () => {
  const local = normalizeTrade({
    id: 'local-bars',
    side: 'long',
    qty: 1,
    entry: { id: 'entry', time: 1_000, price: 100 },
    entryBarIndex: 2,
    exit: { id: 'exit', time: 2_000, price: 110 },
    exitBarIndex: 6,
    open: false,
  });
  assert.equal(local.entryBarIndex, 2);
  assert.equal(local.exitBarIndex, 6);
  assert.equal(local.reversalOfTradeId, null);

  const aliased = normalizeTrade({
    id: 'provider-bars',
    side: 'short',
    qty: 1,
    entry: { id: 'entry', time: 3_000, price: 120, barIndex: 8 },
    exit: { id: 'exit', time: 4_000, price: 115, barIndex: 10 },
    open: false,
    reversalOfTradeId: 'prior-trade',
  });
  assert.equal(aliased.entryBarIndex, 8);
  assert.equal(aliased.exitBarIndex, 10);
  assert.equal(aliased.reversalOfTradeId, 'prior-trade');

  const snakeCase = normalizeTrade({
    id: 'snake-bars',
    side: 'long',
    qty: 1,
    entryTime: 5_000,
    entryPrice: 100,
    exitTime: 6_000,
    exitPrice: 101,
    entry_bar_index: 12,
    exit_bar_index: 13,
  });
  assert.equal(snakeCase.entryBarIndex, 12);
  assert.equal(snakeCase.exitBarIndex, 13);
});

test('bar-duration analysis requires a complete exact-index capability and valid ordering', () => {
  const trades = [
    { ...closed(1, 10), entryBarIndex: 2, exitBarIndex: 5 },
    { ...closed(2, -4), entryBarIndex: 7, exitBarIndex: 11 },
  ];
  const withoutCapability = createBacktestReport({
    key: { cellId: 'cell-bars', indicatorId: 'strategy-bars-off' },
    status: 'ready',
    finality: 'historical-final',
    trades,
    capabilities: { barIndices: false },
  });
  const unavailable = calculateAnalysisMetrics(withoutCapability);
  assert.equal(unavailable.averageDurationBars, null);
  assert.equal(unavailable.medianDurationBars, null);
  assert.equal(unavailable.maxDurationBars, null);

  const exact = createBacktestReport({
    key: { cellId: 'cell-bars', indicatorId: 'strategy-bars-on' },
    status: 'ready',
    finality: 'historical-final',
    trades,
    capabilities: { barIndices: true },
  });
  const available = calculateAnalysisMetrics(exact);
  assert.equal(available.averageDurationBars, 4.5);
  assert.equal(available.medianDurationBars, 4.5);
  assert.equal(available.maxDurationBars, 5);

  const sameBar = createBacktestReport({
    key: { cellId: 'cell-bars', indicatorId: 'strategy-bars-same-bar' },
    status: 'ready',
    finality: 'historical-final',
    trades: [{ ...closed(3, 2), entryBarIndex: 12, exitBarIndex: 12 }],
    capabilities: { barIndices: true },
  });
  const sameBarAnalysis = calculateAnalysisMetrics(sameBar);
  assert.equal(sameBarAnalysis.averageDurationBars, 1);
  assert.equal(sameBarAnalysis.medianDurationBars, 1);
  assert.equal(sameBarAnalysis.maxDurationBars, 1);

  for (const [id, invalid] of [
    ['missing', { ...trades[1], exitBarIndex: null }],
    ['negative', { ...trades[1], entryBarIndex: -1 }],
    ['fractional', { ...trades[1], exitBarIndex: 11.5 }],
    ['reversed', { ...trades[1], entryBarIndex: 12 }],
  ]) {
    const report = createBacktestReport({
      key: { cellId: 'cell-bars', indicatorId: `strategy-bars-${id}` },
      status: 'ready',
      finality: 'historical-final',
      trades: [trades[0], invalid],
      capabilities: { barIndices: true },
    });
    const analysis = calculateAnalysisMetrics(report);
    assert.equal(analysis.averageDurationBars, null, id);
    assert.equal(analysis.medianDurationBars, null, id);
    assert.equal(analysis.maxDurationBars, null, id);
  }
});

test('normalizes raw order and fill ledgers without importing provider types', () => {
  const order = normalizeOrder({ id: 'o1', side: 'short', qty: 2, timestamp: 1234, orderType: 'market' });
  assert.deepEqual(
    { id: order.id, side: order.side, quantity: order.quantity, time: order.time, type: order.type },
    { id: 'o1', side: 'sell', quantity: 2, time: 1234, type: 'market' },
  );
  const fill = normalizeFill({ id: 'f1', orderId: 'o1', side: 'buy', qty: 2, price: 101, time: 1234 });
  assert.deepEqual(
    { id: fill.id, orderId: fill.orderId, quantity: fill.quantity, price: fill.price },
    { id: 'f1', orderId: 'o1', quantity: 2, price: 101 },
  );
});

test('population selectors keep open rows out of closed and simulation populations', () => {
  const trades = [
    closed(1, 10),
    closed(2, -5, 'short'),
    { id: 3, direction: 'long', quantity: 1, entryTime: 3000, entryPrice: 100, exitTime: 0, pnl: -1, unrealizedPnl: -1 },
  ];
  const populations = selectTradePopulations(trades);
  assert.equal(populations.closedTrades.length, 2);
  assert.equal(populations.openTrades.length, 1);
  assert.equal(populations.analysisRows.length, 3);
  assert.equal(populations.simulationPopulation.length, 2);
  assert.equal(populations.winningTrades.length, 1);
  assert.equal(populations.losingTrades.length, 1);
});

test('summary uses closed denominator while mark-to-market includes open P&L', () => {
  const report = createBacktestReport({
    key: { cellId: 'cell-a', indicatorId: 'strategy-a' },
    status: 'ready',
    finality: 'historical-final',
    account: { initialCapital: 1000 },
    trades: [
      closed(1, 100),
      closed(2, -50),
      { id: 3, direction: 'long', quantity: 1, entryTime: 2500, entryPrice: 100, exitTime: 'N/A', exitPrice: 0, unrealizedPnl: -10 },
    ],
  });
  const summary = calculateSummaryMetrics(report);
  assert.equal(summary.tradeCount, 2);
  assert.equal(summary.winningTrades, 1);
  assert.equal(summary.losingTrades, 1);
  assert.equal(summary.winRate, 0.5);
  assert.equal(summary.realizedNet, 50);
  assert.equal(summary.unrealizedNet, -10);
  assert.equal(summary.netProfit, 40);
  const analysis = calculateAnalysisMetrics(report);
  assert.equal(analysis.rowCount, 3);
  assert.equal(analysis.openRows, 1);
  assert.equal(analysis.analysisWinRate, 1 / 3);
});

test('strategy outperformance is an account-currency amount, not a percentage delta', () => {
  const report = createBacktestReport({
    key: { cellId: 'cell-a', indicatorId: 'strategy-benchmark' },
    status: 'ready',
    finality: 'historical-final',
    account: { initialCapital: 1_000 },
    bars: [
      { time: 1_000, open: 100, high: 100, low: 100, close: 100 },
      { time: 2_000, open: 110, high: 110, low: 110, close: 110 },
    ],
    trades: [closed(1, 50)],
  });
  const performance = calculatePerformanceMetrics(report);
  // Buy-and-hold is +10% / +100 currency; the strategy realized +50, so
  // outperformance is -50 currency. It must not be -5 percentage points.
  assert.ok(Math.abs(performance.buyAndHoldPnl - 100) < 1e-9);
  assert.ok(Math.abs(performance.buyAndHoldPct - 0.1) < 1e-12);
  assert.ok(Math.abs(performance.strategyOutperformance + 50) < 1e-9);
});

test('R08 domain uses account open P&L for the proven direction and benchmark formula', () => {
  const report = createBacktestReport({key:{cellId:'r08',indicatorId:'account-open'},status:'ready',
    finality:'historical-final',account:{initialCapital:1000,unrealizedPnl:25},
    bars:[{time:1000,open:100,high:100,low:100,close:100},{time:2000,open:110,high:110,low:110,close:110}],
    trades:[closed(1,50,'long'),closed(2,-20,'short'),{id:3,direction:'short',quantity:1,entryTime:1500,entryPrice:100,exitTime:null}],
  });
  const p = calculatePerformanceMetrics(report);
  assert.equal(p.long.markToMarketNet,50);
  assert.equal(p.short.markToMarketNet,5);
  assert.equal(p.all.markToMarketNet,55);
  assert.ok(Math.abs(p.strategyOutperformance-(p.netProfit-p.buyAndHoldPnl))<1e-8);
});

test('R08 attributes verified open entry fees once without changing closed-trade statistics', () => {
  for (const direction of ['long', 'short']) {
    const report = createBacktestReport({key:{cellId:'fees',indicatorId:direction}, status:'ready',
      account:{realizedPnl:29.5,unrealizedPnl:25},
      trades:[closed(1,50,'long'),closed(2,-20,'short'),
        {id:3,direction,quantity:1,entryTime:1500,entryPrice:100,exitTime:null,commission:.5}],
    });
    const p = calculateSummaryMetrics(report);
    assert.equal(p.realizedNet,30);
    assert.equal(p.netProfit,54.5);
    assert.equal(p.long.markToMarketNet+p.short.markToMarketNet,54.5);
    assert.equal(p[direction].markToMarketNet,(direction==='long'?50:-20)+24.5);
    assert.equal(p.grossProfit,50);
    assert.equal(p.grossLoss,20);
  }
});

test('performance exposes direction-specific daily and weekly averages and fixed weekday buckets', () => {
  const report = createBacktestReport({
    key: { cellId: 'cell-a', indicatorId: 'bucket-averages' },
    status: 'ready',
    finality: 'historical-final',
    context: { provider: 'binance', symbol: 'BTCUSDT', timeframe: '1h', timezone: 'UTC' },
    account: { initialCapital: 1_000 },
    trades: [
      closed(1, 10, 'long', Date.parse('2024-01-01T12:00:00Z')),
      closed(2, -5, 'short', Date.parse('2024-01-02T12:00:00Z')),
      closed(3, 20, 'long', Date.parse('2024-01-02T18:00:00Z')),
    ],
  });
  const performance = calculatePerformanceMetrics(report);
  assert.deepEqual(performance.averagePnlPerDay, { all: 12.5, long: 15, short: -5 });
  assert.deepEqual(performance.averagePnlPerWeek, { all: 25, long: 30, short: -5 });
  assert.deepEqual(performance.weekdayPerformance.map((row) => row.bucket), [
    'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
  ]);
  assert.equal(performance.weekdayPerformance.length, 7);
});

test('keeps authoritative close underwater and fill-anchored benchmark points', () => {
  const report = createBacktestReport({
    key: { cellId: 'cell-a', indicatorId: 'strategy-engine-series' },
    status: 'ready',
    finality: 'historical-final',
    account: { initialCapital: 1_000, maxDrawdown: 175, maxDrawdownPct: 0.175 },
    equitySeries: [
      { time: 1_000, equity: 1_000, pnl: 0, drawdown: 0, drawdownPct: 0 },
      // Deliberately differs from the simple close-equity peak calculation
      // (which would be 100 / 10%) so the assertion detects recomputation.
      { time: 2_000, equity: 900, pnl: -100, drawdown: 125, drawdownPct: 0.125 },
      { time: 3_000, equity: 1_100, pnl: 100, drawdown: 5, drawdownPct: 0.0045 },
    ],
    benchmarkSeries: [
      // The first emitted close is already +5% from the actual entry fill.
      { time: 2_000, value: 1_050, pnl: 50, returnPct: 0.05 },
      { time: 3_000, value: 1_100, pnl: 100, returnPct: 0.1 },
    ],
    capabilities: {
      exactEquityCurve: true,
      exactDrawdownCurve: true,
      benchmark: true,
    },
  });
  const performance = calculatePerformanceMetrics(report);

  assert.equal(performance.drawdownCurve[1].drawdown, 125);
  assert.equal(performance.drawdownCurve[1].drawdownPct, 0.125);
  assert.equal(performance.drawdownCurve[2].drawdown, 5);
  assert.equal(performance.buyAndHoldPnl, 100);
  assert.equal(performance.buyAndHoldPct, 0.1);
});

test('keeps the Summary cumulative P&L ledger separate from exact per-bar equity', () => {
  const report = createBacktestReport({
    key: { cellId: 'cell-a', indicatorId: 'summary-realized-ledger' },
    status: 'ready',
    finality: 'historical-final',
    account: { initialCapital: 1_000 },
    // The per-bar stream intentionally has more points and different
    // mark-to-market movement than the realized exit ledger.
    equitySeries: [
      { time: 1_000, equity: 1_000, pnl: 0 },
      { time: 2_000, equity: 950, pnl: -50 },
      { time: 3_000, equity: 1_025, pnl: 25 },
      { time: 4_000, equity: 1_010, pnl: 10 },
    ],
    capabilities: { exactEquityCurve: true },
    trades: [
      // Deliberately unsorted input and a breakeven: the curve preserves all
      // closed ledger rows, while Summary trade count has its own population.
      closed('late', 10, 'long', 4_000),
      closed('even', 0, 'short', 2_000),
      closed('mid', 25, 'long', 3_000),
    ],
  });
  const performance = calculatePerformanceMetrics(report);

  assert.equal(performance.equityCurve.length, 4);
  assert.deepEqual(performance.cumulativePnl, [
    { time: 2_000, cumulativePnl: 0 },
    { time: 3_000, cumulativePnl: 25 },
    { time: 4_000, cumulativePnl: 35 },
  ]);
});

test('summary excludes breakeven rows from realized trade and win-rate populations', () => {
  const report = createBacktestReport({
    key: { cellId: 'cell-a', indicatorId: 'strategy-a' },
    status: 'ready',
    finality: 'historical-final',
    trades: [closed(1, 10), closed(2, 0), closed(3, -5)],
  });
  const summary = calculateSummaryMetrics(report);
  assert.equal(summary.tradeCount, 2);
  assert.equal(summary.winRate, 0.5);
  const allEven = createBacktestReport({
    key: { cellId: 'cell-a', indicatorId: 'strategy-b' },
    status: 'ready',
    finality: 'historical-final',
    trades: [closed(1, 0)],
  });
  assert.equal(calculateSummaryMetrics(allEven).tradeCount, 0);
  assert.equal(calculateSummaryMetrics(allEven).winRate, null);
});

test('freezes the observed 13 closed / 14 analysis-row population split', () => {
  const ledger = [
    ...Array.from({ length: 8 }, (_, index) => closed(index + 1, 100, index % 2 ? 'short' : 'long')),
    ...Array.from({ length: 5 }, (_, index) => closed(index + 9, -40, index % 2 ? 'short' : 'long')),
    { id: 14, direction: 'long', quantity: 1, entryTime: 20_000, entryPrice: 100, exitTime: 'N/A', exitPrice: 0, unrealizedPnl: -360.81 },
  ];
  const report = createBacktestReport({
    key: { cellId: 'cell-fixture', indicatorId: 'strategy-fixture' },
    status: 'ready',
    finality: 'historical-final',
    account: { initialCapital: 100_000 },
    trades: ledger,
  });
  const populations = selectTradePopulations(report.trades);
  assert.equal(populations.closedTrades.length, 13);
  assert.equal(populations.analysisRows.length, 14);
  assert.equal(populations.simulationPopulation.length, 13);
  const summary = calculateSummaryMetrics(report);
  assert.equal(summary.tradeCount, 13);
  assert.equal(summary.winRate, 8 / 13);
  const analysis = calculateAnalysisMetrics(report);
  assert.equal(analysis.rowCount, 14);
  assert.equal(analysis.analysisWinRate, 8 / 14);
});

test('shuffle is deterministic and preserves realized total without variation', () => {
  const report = createBacktestReport({
    key: { cellId: 'cell-a', indicatorId: 'strategy-a' },
    status: 'ready',
    finality: 'historical-final',
    trades: [closed(1, 100), closed(2, -50), closed(3, 20)],
  });
  const first = runSimulation(report, { mode: 'shuffle', runs: 20, seed: 'fixed' });
  const second = runSimulation(report, { mode: 'shuffle', runs: 20, seed: 'fixed' });
  assert.deepEqual(first.endingPnls, second.endingPnls);
  assert.deepEqual(new Set(first.endingPnls), new Set([70]));
  assert.equal(first.populationSize, 3);
});

test('preserve win/loss keeps breakeven trades flat', () => {
  const report = createBacktestReport({
    key: { cellId: 'cell-a', indicatorId: 'strategy-a' },
    status: 'ready',
    finality: 'historical-final',
    trades: [closed(1, 100), closed(2, 0), closed(3, -50)],
  });
  const simulation = runSimulation(report, {
    mode: 'resample',
    preserveWinLoss: true,
    runs: 20,
    seed: 'preserve-breakeven',
  });
  assert.equal(simulation.populationSize, 3);
  for (const path of simulation.paths) {
    // Every path is emitted in source-trade order under preserve mode; the
    // middle trade is breakeven and must remain flat rather than become a win.
    assert.equal(path.values[1] - path.values[0], 0);
    assert.ok(path.values[0] > 0);
    assert.ok(path.values[2] < path.values[1]);
  }
});

test('simulation reports progress and supports cooperative cancellation', () => {
  const report = createBacktestReport({
    key: { cellId: 'cell-a', indicatorId: 'strategy-a' },
    status: 'ready',
    finality: 'historical-final',
    trades: [closed(1, 100), closed(2, -50), closed(3, 20)],
  });
  const signal = { aborted: false };
  const progress = [];
  assert.throws(
    () => runSimulation(report, {
      runs: 25,
      seed: 'cancel-progress',
      signal,
      onProgress: (value) => {
        progress.push(value);
        if (value.completedRuns >= 10) signal.aborted = true;
      },
    }),
    (error) => error instanceof SimulationCancelledError
      && error.completedRuns === 10
      && error.totalRuns === 25,
  );
  assert.equal(progress[0].completedRuns, 0);
  assert.equal(progress[0].fraction, 0);
  assert.equal(progress.at(-1).completedRuns, 10);
  assert.equal(progress.at(-1).fraction, 0.4);
});

test('simulation bounds invalid and oversized run counts before allocation', () => {
  const report = createBacktestReport({
    key: { cellId: 'cell-a', indicatorId: 'strategy-a' },
    status: 'ready',
    finality: 'historical-final',
    trades: [closed(1, 100)],
  });
  assert.equal(runSimulation(report, { runs: Number.NaN }).config.runs, 1000);
  assert.equal(runSimulation(report, { runs: Number.POSITIVE_INFINITY }).config.runs, 1000);
  assert.equal(runSimulation(report, { runs: 0 }).config.runs, 1);
  assert.equal(runSimulation(report, { runs: MAX_SIMULATION_RUNS + 1 }).config.runs, MAX_SIMULATION_RUNS);
});

test('percentage drawdown thresholds stay unavailable without initial capital', () => {
  const report = createBacktestReport({
    key: { cellId: 'cell-a', indicatorId: 'strategy-a' },
    status: 'ready',
    finality: 'historical-final',
    trades: [closed(1, 100), closed(2, -50)],
  });
  const simulation = runSimulation(report, {
    mode: 'shuffle',
    runs: 8,
    drawdownThreshold: 10,
    drawdownThresholdUnit: 'percent',
    seed: 'percent-without-capital',
  });
  assert.equal(simulation.thresholdBreachProbability, null);
});

test('unavailable metrics have an explicit reason and stable em dash formatting', () => {
  assert.deepEqual(metric(null, 'ratio', 'derived', 'insufficient-data'), {
    value: null,
    unit: 'ratio',
    source: 'derived',
    unavailableReason: 'insufficient-data',
  });
  assert.equal(formatMetricValue(null), '—');
  assert.equal(formatMetricValue(-0), '0');
  assert.equal(formatMetricValue(Infinity), '∞');
});

test('createBacktestReport defensively clones and freezes nested report data', () => {
  const context = { strategy: { netPnl: 1 } };
  const bars = [{ time: 1, open: 1, high: 2, low: 0, close: 1 }];
  const trades = [{ id: 't1', direction: 'long', quantity: 1, entryTime: 1, entryPrice: 1, exitTime: 2, exitPrice: 2, netPnl: 1 }];
  const report = createBacktestReport({
    key: { cellId: 'c', indicatorId: 'i' }, title: 'x', source: 'test',
    context, bars, trades,
  });
  assert.notEqual(report.context, context);
  assert.equal(Object.isFrozen(report.context), true);
  assert.equal(Object.isFrozen(report.bars), true);
  assert.equal(Object.isFrozen(report.bars[0]), true);
  assert.equal(Object.isFrozen(report.trades[0].entry), true);
  context.strategy.netPnl = 99;
  bars[0].close = 99;
  trades[0].netPnl = 99;
  assert.equal(report.context.strategy.netPnl, 1);
  assert.equal(report.bars[0].close, 1);
  assert.equal(report.trades[0].netPnl, 1);
});
