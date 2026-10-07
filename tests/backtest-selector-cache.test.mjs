import assert from 'node:assert/strict';
import test from 'node:test';
import { createBacktestReport, selectTradePopulations } from '../src/domain/backtesting.ts';
import { calendarDateParts } from '../src/domain/calendar.ts';
import { calculateSummaryMetrics, calculatePerformanceMetrics, calculateAnalysisMetrics } from '../src/domain/backtest-metrics.ts';
import { calculateTradeAnalysis } from '../src/domain/trade-analysis.ts';
import { formatBacktestCurrency } from '../src/features/backtesting/backtest-format.ts';

const trade = (netPnl = 10) => ({
  id: 'trade', direction: 'long', quantity: 1,
  entryTime: Date.UTC(2026, 0, 1), exitTime: Date.UTC(2026, 0, 2),
  entryPrice: 100, exitPrice: 110, netPnl,
});
const report = (trades, revision = 1) => createBacktestReport({
  key: { cellId: 'cell', indicatorId: 'strategy' }, title: 'cache contract',
  revision, trades,
});

test('population reuse is limited to domain-owned immutable reports and respects options', () => {
  const frozen = report([trade(1e-7), { ...trade(), id: 'open', exitTime: null }]);
  const initial = selectTradePopulations(frozen.trades);
  assert.equal(selectTradePopulations(frozen.trades), initial);
  assert.ok(Object.isFrozen(initial));
  assert.ok(Object.isFrozen(initial.allTrades[0]));
  assert.equal(initial.winningTrades.length, 1);
  const broadEpsilon = selectTradePopulations(frozen.trades, { breakevenEpsilon: 1e-6, includeOpenInAnalysis: false });
  assert.equal(broadEpsilon.breakevenTrades.length, 1);
  assert.equal(broadEpsilon.analysisRows.length, 1);
  assert.equal(selectTradePopulations(frozen.trades).winningTrades.length, 1);
});

test('mutable input and shallow-frozen arrays never retain stale population results', () => {
  for (const freezeArray of [false, true]) {
    const row = trade();
    const rows = [row];
    if (freezeArray) Object.freeze(rows);
    assert.equal(selectTradePopulations(rows).winningTrades.length, 1);
    row.netPnl = -20;
    assert.equal(selectTradePopulations(rows).losingTrades.length, 1);
    row.exitTime = null;
    assert.equal(selectTradePopulations(rows).openTrades.length, 1);
  }
});

test('factory populations preserve explicit open sentinels instead of reviving a fallback exit alias', () => {
  const validExit = Date.UTC(2026, 0, 3);
  for (const exitTime of [0, '0', -1, 'invalid timestamp']) {
    for (const fallback of [{ closeTime: validExit }, { exitTimestamp: validExit }, { exit: { time: validExit } }]) {
      const frozen = report([{ ...trade(), ...fallback, exitTime }]);
      assert.equal(frozen.trades[0].exitTime, null);
      assert.equal(frozen.trades[0].exitPrice, null);
      assert.equal(frozen.trades[0].status, 'open');
      assert.equal(frozen.closedTrades.length, 0);
      assert.equal(frozen.openTrades.length, 1);
      assert.equal(frozen.openTrades[0], frozen.trades[0]);
      assert.equal(frozen.analysisRows[0], frozen.trades[0]);
      const population = selectTradePopulations(frozen.trades);
      assert.equal(population.openTrades[0], frozen.trades[0]);
      assert.equal(population.closedTrades.length, 0);
      assert.equal(population.simulationPopulation.length, 0);
      assert.equal(population.analysisRows[0], frozen.trades[0]);
      const closedOnly = selectTradePopulations(frozen.trades, { includeOpenInAnalysis: false });
      assert.equal(closedOnly.analysisRows.length, 0);
      assert.equal(closedOnly.openTrades[0], frozen.trades[0]);
    }
  }
});

test('new report identity invalidates population cache even with the same revision and run', () => {
  const first = report([trade(10)]);
  const next = report([trade(-10)]);
  assert.equal(first.revision, next.revision);
  assert.equal(selectTradePopulations(first.trades).winningTrades.length, 1);
  assert.equal(selectTradePopulations(next.trades).losingTrades.length, 1);
  assert.equal(selectTradePopulations(first.trades).winningTrades.length, 1);
});

test('metric caches retain only owned immutable report results and separate options', () => {
  const frozen = report([trade(), { ...trade(-3), id: 'second', exitTime: Date.UTC(2026, 0, 2, 0, 30) }]);
  const summary = calculateSummaryMetrics(frozen);
  assert.equal(calculateSummaryMetrics(frozen), summary);
  const initial = calculatePerformanceMetrics(frozen);
  assert.equal(calculatePerformanceMetrics(frozen), initial);
  assert.equal(calculateAnalysisMetrics(frozen), calculateAnalysisMetrics(frozen));
  assert.throws(() => { initial.equityCurve[0].equity = 999; }, TypeError);
  assert.throws(() => { initial.netDailyPnl[0].pnl = 999; }, TypeError);
  assert.throws(() => { summary.long.realizedNet = 999; }, TypeError);
  const regional = calculatePerformanceMetrics(frozen, { timezone: 'America/Los_Angeles' });
  assert.notEqual(regional.netDailyPnl[0].bucket, initial.netDailyPnl[0].bucket);
  assert.equal(calculatePerformanceMetrics(frozen).netDailyPnl[0].bucket, initial.netDailyPnl[0].bucket);
  assert.equal(calculateSummaryMetrics(frozen, { breakevenEpsilon: 100 }).winningTrades, 0);
  assert.equal(calculateSummaryMetrics(frozen).winningTrades, 1);
  const changed = { ...frozen, trades: [trade(20)] };
  assert.equal(calculateSummaryMetrics(changed).netProfit, 20);
  changed.trades[0].netPnl = -5;
  assert.equal(calculateSummaryMetrics(changed).netProfit, -5);
});

test('calendar UTC fast path agrees with Intl and leaves regional DST boundaries intact', () => {
  for (const timezone of ['UTC', 'Etc/UTC', 'GMT', 'Etc/GMT', 'America/Los_Angeles', 'Pacific/Apia', 'Asia/Kathmandu']) {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    for (const instant of ['2024-02-29T23:59:59Z', '2026-03-08T09:59:59Z', '2026-03-08T10:00:00Z',
      '2026-11-01T08:59:59Z', '2026-11-01T09:00:00Z', '2011-12-30T09:59:59Z', '2011-12-30T10:00:00Z']) {
      const time = Date.parse(instant);
      const parts = Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]));
      const actual = calendarDateParts(time, timezone);
      assert.equal(actual.key, `${parts.year}-${parts.month}-${parts.day}`, `${timezone}: ${instant}`);
      assert.equal(actual.weekday, new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))).getUTCDay());
    }
  }
  assert.equal(calendarDateParts(0), null);
  assert.equal(calendarDateParts(Number.MAX_VALUE), null);
});

test('Analysis UTC distinct buckets retain Sunday and year boundaries and open-row denominator', () => {
  const times = ['2025-12-31T23:59:59Z', '2026-01-03T00:00:00Z', '2026-01-03T23:59:59Z', '2026-01-04T00:00:00Z'];
  const rows = times.map((time, index) => ({ ...trade(), id: `closed-${index}`, entryTime: Date.parse(time) - 60_000, exitTime: Date.parse(time) }));
  rows.push({ ...trade(), id: 'open', exitTime: null });
  const metrics = calculateTradeAnalysis(report(rows));
  assert.equal(metrics.all.duration.averageTradesPerDay, 5 / 3);
  assert.equal(metrics.all.duration.averageTradesPerWeek, 5 / 2);
  assert.equal(metrics.all.pnl.breakevenTrades, 1);
});

test('reused currency formatters preserve account precision, locale and negative-zero display', () => {
  for (let repetition = 0; repetition < 3; repetition += 1) {
    assert.equal(formatBacktestCurrency(1000.25), '1,000.25');
    assert.equal(formatBacktestCurrency(1000.25, 'de-DE'), '1.000,25');
    assert.equal(formatBacktestCurrency(0.123456789), '0.1234568');
    assert.equal(formatBacktestCurrency(0.123456789, 'de-DE'), '0,1234568');
    assert.equal(formatBacktestCurrency(-0), '0.00');
    assert.equal(formatBacktestCurrency(Infinity), '—');
  }
});

test('large Analysis populations retain full duration rows and extrema without argument-stack limits', () => {
  const count = 150_000;
  const start = Date.parse('2026-01-04T00:00:00Z');
  const rows = Array.from({ length: count }, (_, index) => ({
    id: index,
    status: 'closed',
    direction: index % 2 === 0 ? 'long' : 'short',
    entryTime: start,
    exitTime: start + (index % 3 + 1) * 3_600_000,
    netPnl: index % 2 === 0 ? 2 : -1,
  }));
  // This tests the public selector with a large caller-owned population too;
  // no factory cache or abbreviated plot population can hide a stack limit.
  const metrics = calculateTradeAnalysis({ analysisRows: rows, context: { timeframe: '1h' } });
  assert.equal(metrics.all.pnl.trades, count);
  assert.equal(metrics.all.pnl.averageTrade, 0.5);
  assert.equal(metrics.all.pnl.largestWinner, 2);
  assert.equal(metrics.all.pnl.largestLoser, -1);
  assert.equal(metrics.long.pnl.trades, count / 2);
  assert.equal(metrics.short.pnl.trades, count / 2);
  assert.equal(metrics.all.duration.averageDurationBars, 2);
  assert.equal(metrics.all.duration.longestDurationBars, 3);
  assert.equal(metrics.all.duration.shortestDurationBars, 1);
  assert.equal(metrics.durationPnl.length, count);
  assert.equal(metrics.durationTrend.length, 2);
  assert.ok(Object.isFrozen(metrics.durationPnl.at(-1)));
});
