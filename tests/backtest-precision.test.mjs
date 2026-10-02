import assert from 'node:assert/strict';
import test from 'node:test';

import { createBacktestReport } from '../src/domain/backtesting.ts';
import { mapSnapshotDomain } from '../src/app/backtest-controller.ts';

test('domain reports deeply freeze execution precision metadata', () => {
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
  const report = createBacktestReport({
    key: { cellId: 'cell-1', indicatorId: 'strategy-1' },
    execution: {
      barIndex: 2,
      time: 3_000,
      phase: 'idle',
      seriesKeys: [],
      precision,
    },
  });

  assert.ok(report.execution);
  assert.ok(Object.isFrozen(report.execution));
  assert.ok(Object.isFrozen(report.execution.precision));
  assert.deepEqual(report.execution.precision, precision);
  assert.throws(() => {
    report.execution.precision.coverage = 0;
  }, TypeError);
});

test('application mapping preserves applied precision and explicit fallback metadata', () => {
  const precision = {
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
  };
  const snapshot = {
    key: { cellId: 'cell-1', indicatorId: 'strategy-1' },
    revision: 4,
    epoch: 1,
    runToken: 'run-4',
    status: 'ready',
    finality: 'historical-final',
    ledgerState: 'ready',
    seriesState: 'idle',
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
    handle: { id: 'strategy-1', title: 'Precision strategy', source: 'strategy("Precision")' },
    run: null,
    context: {
      phase: 'idle',
      barIndex: 2,
      meta: { title: 'Precision strategy', overlay: true },
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
      executionPrecision: precision,
    },
    trades: [],
    execution: {
      barIndex: 2,
      time: 3_000,
      phase: 'idle',
      seriesKeys: [],
      precision,
    },
    error: null,
  };

  const report = mapSnapshotDomain(snapshot);
  assert.deepEqual(report.execution?.precision, precision);
  assert.equal(report.capabilities.executionPrecision, 'chart-ohlc');
  assert.equal(Object.isFrozen(report.execution?.precision), true);
});
