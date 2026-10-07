import assert from 'node:assert/strict';
import test from 'node:test';

import { createBacktestReport } from '../src/domain/backtesting.ts';
import {
  analysisTradePnl,
  calculateTradeAnalysis,
  createDurationTrend,
  createTradeAnalysisHistogram,
  scatterDurationBars,
  timeframeMinutes,
  timestampDurationBars,
  TRADE_ANALYSIS_COMPARISON_KEYS,
  TRADE_ANALYSIS_DURATION_KEYS,
  TRADE_ANALYSIS_LOSS_COLOR,
  TRADE_ANALYSIS_PROFIT_COLOR,
} from '../src/domain/trade-analysis.ts';

const HOUR = 60 * 60 * 1_000;
const SUNDAY = Date.parse('2024-01-07T00:00:00.000Z');

function trade(id, direction, pnl, entryHours, exitHours, extra = {}) {
  return {
    id,
    direction,
    quantity: 1,
    entryTime: SUNDAY + entryHours * HOUR,
    entryPrice: 100,
    exitTime: exitHours === null ? null : SUNDAY + exitHours * HOUR,
    exitPrice: exitHours === null ? null : 100 + (pnl ?? 0),
    netPnl: pnl,
    ...extra,
  };
}

function referenceReport() {
  return createBacktestReport({
    key: { cellId: 'analysis', indicatorId: 'reference-contract' },
    status: 'ready',
    finality: 'historical-final',
    context: { provider: 'binance', symbol: 'BTCUSDT', timeframe: '1h' },
    capabilities: { tradeLedger: true, barIndices: true },
    trades: [
      trade('long-win', 'long', 10, 0, 2, {
        duration_bars: 9,
        entryBarIndex: 0,
        exitBarIndex: 0,
      }),
      trade('long-even', 'long', 0, 2, 3, {
        entryBarIndex: 10,
        exitBarIndex: 12,
      }),
      trade('short-loss', 'short', -5, 24, 27),
      trade('short-win', 'short', 20, 28, 32, {
        entryBarIndex: 20,
        exitBarIndex: 24,
      }),
      trade('unknown-pnl', 'short', null, 48, 50, { entryPrice: null, exitPrice: null }),
      trade('current', 'short', -999, 51, null, { open: true, unrealizedPnl: -999 }),
    ],
  });
}

test('freezes Trades Analysis keys and the open-row compatibility projection', () => {
  assert.deepEqual(TRADE_ANALYSIS_COMPARISON_KEYS, [
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
  assert.deepEqual(TRADE_ANALYSIS_DURATION_KEYS, [
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

  const report = referenceReport();
  const current = report.openTrades[0];
  assert.equal(analysisTradePnl(current), 0);
  assert.equal(current.status, 'open');
  assert.equal(current.exitTime, null);
  assert.equal(report.closedTrades.length, 5);
  assert.equal(report.analysisRows.length, 6);

  const analysis = calculateTradeAnalysis(report);
  assert.deepEqual(analysis.all.pnl, {
    trades: 5,
    winningTrades: 2,
    losingTrades: 1,
    breakevenTrades: 2,
    winRate: 2 / 6,
    averageTrade: 25 / 6,
    averageWinner: 15,
    averageLoser: -5,
    largestWinner: 20,
    largestLoser: -5,
  });
  assert.deepEqual(analysis.long.pnl, {
    trades: 2,
    winningTrades: 1,
    losingTrades: 0,
    breakevenTrades: 1,
    winRate: 1 / 2,
    averageTrade: 5,
    averageWinner: 10,
    averageLoser: null,
    largestWinner: 10,
    largestLoser: null,
  });
  assert.deepEqual(analysis.short.pnl, {
    trades: 3,
    winningTrades: 1,
    losingTrades: 1,
    breakevenTrades: 1,
    winRate: 1 / 4,
    averageTrade: 15 / 4,
    averageWinner: 20,
    averageLoser: -5,
    largestWinner: 20,
    largestLoser: -5,
  });
});

test('duration table uses timestamp/timeframe fallback, UTC buckets, and bar-summed streaks', () => {
  const analysis = calculateTradeAnalysis(referenceReport());
  assert.deepEqual(analysis.all.duration, {
    averageDurationBars: 12 / 5,
    averageWinningDurationBars: 3,
    averageLosingDurationBars: 3,
    averageTradesPerDay: 2,
    averageTradesPerWeek: 6,
    longestDurationBars: 4,
    shortestDurationBars: 1,
    longestWinningStreakBars: 4,
    // The 1-bar breakeven followed by the 3-bar loss is one losing streak.
    longestLosingStreakBars: 4,
  });
  assert.deepEqual(analysis.long.duration, {
    averageDurationBars: 1.5,
    averageWinningDurationBars: 2,
    averageLosingDurationBars: null,
    averageTradesPerDay: 2,
    averageTradesPerWeek: 2,
    longestDurationBars: 2,
    shortestDurationBars: 1,
    longestWinningStreakBars: 2,
    longestLosingStreakBars: 1,
  });
  assert.equal(analysis.short.duration.averageTradesPerDay, 4 / 2);
  assert.equal(analysis.short.duration.averageTradesPerWeek, 4);
  assert.equal(analysis.short.duration.longestWinningStreakBars, 4);
  assert.equal(analysis.short.duration.longestLosingStreakBars, 3);
});

test('scatter duration uses only duration_bars then the reference timestamp fallback', () => {
  const report = referenceReport();
  const [explicit, indexed, fallback] = report.trades;
  assert.equal(scatterDurationBars(explicit, report), 9);
  assert.equal(scatterDurationBars(indexed, report), 1);
  assert.equal(scatterDurationBars(fallback, report), 3);

  // The table path never consumes duration_bars or exact indices.
  assert.equal(timestampDurationBars(explicit, '1h'), 2);
  assert.equal(timestampDurationBars(indexed, '1h'), 1);
  assert.equal(timestampDurationBars(report.openTrades[0], '1h'), null);

  const points = calculateTradeAnalysis(report).durationPnl;
  assert.deepEqual(points.map(({ durationBars, pnl, direction }) => ({ durationBars, pnl, direction })), [
    { durationBars: 9, pnl: 10, direction: 'long' },
    { durationBars: 1, pnl: 0, direction: 'long' },
    { durationBars: 3, pnl: -5, direction: 'short' },
    { durationBars: 4, pnl: 20, direction: 'short' },
  ]);
  assert.equal(points[0].color, TRADE_ANALYSIS_PROFIT_COLOR);
  assert.equal(points[2].color, TRADE_ANALYSIS_LOSS_COLOR);
  const trend = calculateTradeAnalysis(report).durationTrend;
  assert.deepEqual(trend.map(({ x }) => x), [1, 9]);
  assert.ok(Math.abs(trend[0].y - 235 / 139) < 1e-12);
  assert.ok(Math.abs(trend[1].y - 1795 / 139) < 1e-12);
  assert.deepEqual(points.map(({ label }) => label), ['Trade', 'Trade', 'Trade', 'Trade']);
});

test('duration trend is finite OLS and rejects underdetermined x populations', () => {
  assert.deepEqual(createDurationTrend([
    { durationBars: 1, pnl: 1 },
    { durationBars: 2, pnl: 3 },
    { durationBars: 3, pnl: 5 },
  ]), [{ x: 1, y: 1 }, { x: 3, y: 5 }]);
  assert.deepEqual(createDurationTrend([{ durationBars: 1, pnl: 1 }]), []);
  assert.deepEqual(createDurationTrend([
    { durationBars: 2, pnl: -1 },
    { durationBars: 2, pnl: 4 },
  ]), []);
});

test('keeps all-winning and all-losing direction populations explicit', () => {
  const makeReport = (pnls) => createBacktestReport({
    key: { cellId: 'analysis', indicatorId: pnls[0] > 0 ? 'all-win' : 'all-loss' },
    status: 'ready',
    finality: 'historical-final',
    context: { provider: 'binance', symbol: 'BTCUSDT', timeframe: '1h' },
    trades: pnls.map((pnl, index) => trade(
      `trade-${index}`,
      index % 2 === 0 ? 'long' : 'short',
      pnl,
      index * 2,
      index * 2 + 1,
    )),
  });
  const allWin = calculateTradeAnalysis(makeReport([3, 5])).all.pnl;
  assert.deepEqual({
    trades: allWin.trades,
    winners: allWin.winningTrades,
    losers: allWin.losingTrades,
    breakevens: allWin.breakevenTrades,
    winRate: allWin.winRate,
    averageLoser: allWin.averageLoser,
  }, {
    trades: 2,
    winners: 2,
    losers: 0,
    breakevens: 0,
    winRate: 1,
    averageLoser: null,
  });
  const allLoss = calculateTradeAnalysis(makeReport([-3, -5])).all.pnl;
  assert.deepEqual({
    trades: allLoss.trades,
    winners: allLoss.winningTrades,
    losers: allLoss.losingTrades,
    breakevens: allLoss.breakevenTrades,
    winRate: allLoss.winRate,
    averageWinner: allLoss.averageWinner,
  }, {
    trades: 2,
    winners: 0,
    losers: 2,
    breakevens: 0,
    winRate: 0,
    averageWinner: null,
  });
});

test('parses supported timeframe forms and accepts captured second timestamps', () => {
  assert.equal(timeframeMinutes('60'), 60);
  assert.equal(timeframeMinutes('1h'), 60);
  assert.equal(timeframeMinutes('1D'), 1_440);
  assert.equal(timeframeMinutes('1W'), 10_080);
  assert.equal(timeframeMinutes('1M'), 43_200);
  assert.equal(timeframeMinutes('D'), 1_440);
  assert.equal(timeframeMinutes('W'), 10_080);
  assert.equal(timeframeMinutes('M'), 43_200);
  assert.equal(timeframeMinutes('30S'), 0.5);
  assert.equal(timeframeMinutes('garbage'), null);

  const secondsTrade = {
    ...trade('seconds', 'long', 1, 0, 1),
    entryTime: 1_704_585_600,
    exitTime: 1_704_589_200,
  };
  assert.equal(timestampDurationBars(secondsTrade, '1h'), 1);
});

test('accepts captured delta, position, and opened/closed timestamp fields in Analysis only', () => {
  const report = createBacktestReport({
    key: { cellId: 'captured', indicatorId: 'aliases' },
    status: 'ready',
    finality: 'historical-final',
    context: { provider: 'reference', symbol: 'BTCUSDT', timeframe: '1h' },
    trades: [{
      id: 'captured-row',
      position: 'short',
      quantity: 1,
      openedTimestamp: 1_704_585_600,
      closedTimestamp: 1_704_589_200,
      delta: -7,
    }],
  });
  // The generic domain stays untouched; only the Analysis projection knows
  // about fields captured from the reference UI payload.
  assert.equal(report.openTrades.length, 1);
  const analysis = calculateTradeAnalysis(report);
  assert.equal(analysis.short.pnl.trades, 1);
  assert.equal(analysis.short.pnl.losingTrades, 1);
  assert.equal(analysis.short.pnl.averageLoser, -7);
  assert.equal(analysis.short.duration.averageDurationBars, 1);
  assert.deepEqual(
    analysis.durationPnl.map(({ durationBars, pnl, direction, exitTime }) => ({ durationBars, pnl, direction, exitTime })),
    [{ durationBars: 1, pnl: -7, direction: 'short', exitTime: 1_704_589_200 }],
  );
});

test('prefers explicit delta on open rows and accepts captured snake-case timestamps', () => {
  const report = createBacktestReport({
    key: { cellId: 'captured', indicatorId: 'snake-aliases' },
    status: 'ready',
    finality: 'historical-final',
    context: { provider: 'reference', symbol: 'BTCUSDT', timeframe: '1h' },
    trades: [{
      id: 'captured-open-row',
      position: 'long',
      quantity: 1,
      opened_at_timestamp: 1_704_585_600,
      closed_at_timestamp: 1_704_589_200,
      open: true,
      delta: 7,
    }],
  });
  const [captured] = report.trades;
  assert.equal(analysisTradePnl(captured), 7);
  assert.equal(timestampDurationBars(captured, '1h'), 1);
  assert.deepEqual(
    calculateTradeAnalysis(report).durationPnl.map(({ durationBars, pnl }) => ({ durationBars, pnl })),
    [{ durationBars: 1, pnl: 7 }],
  );
});

test('uses the captured zero-anchored histogram boundaries and colors', () => {
  const bins = createTradeAnalysisHistogram([-10, -5, 0, 5, 10]);
  assert.equal(bins.length, 4);
  assert.deepEqual(bins.map(({ count }) => count), [1, 1, 2, 1]);
  assert.ok(Math.abs(bins[0].from - (-40 / 3)) < 1e-12);
  assert.ok(Math.abs(bins.at(-1).to - (40 / 3)) < 1e-12);
  assert.deepEqual(bins.map(({ color }) => color), [
    TRADE_ANALYSIS_LOSS_COLOR,
    TRADE_ANALYSIS_LOSS_COLOR,
    TRADE_ANALYSIS_PROFIT_COLOR,
    TRADE_ANALYSIS_PROFIT_COLOR,
  ]);

  const equal = createTradeAnalysisHistogram([5, 5, 5, 5]);
  assert.equal(equal.reduce((total, bin) => total + bin.count, 0), 4);
  assert.equal(equal.length, 2);
  assert.equal(equal[1].count, 4);
});

test('near-equal real engine P&Ls cannot create an unbounded histogram or stall report mapping', () => {
  const values = Array.from({ length: 60 }, (_, index) =>
    index % 2 ? 0.06000000000005912 : 0.060000000000002274);
  for (const population of [values, values.map(value => -value), [1e9, 1e9 + 1], [-Number.MAX_VALUE, Number.MAX_VALUE]]) {
    const bins = createTradeAnalysisHistogram(population);
    assert.ok(bins.length > 0 && bins.length <= 256);
    assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), population.length);
    assert.ok(bins.every(bin => [bin.from, bin.to, bin.midpoint].every(Number.isFinite)));
    assert.ok(bins[0].from <= Math.min(...population));
    assert.ok(bins.at(-1).to >= Math.max(...population));
  }
});
