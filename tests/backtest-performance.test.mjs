import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { downsampleReportChartPoints, nearestReportChartPoint } from '../src/features/backtesting/chart-sampling.ts';
import {
  getBacktestTradeWindow,
  MAX_BACKTEST_TRADE_PAGE_SIZE,
  sortBacktestTradeEntries,
  sortBacktestTrades,
} from '../src/features/backtesting/trade-log.ts';

test('chart sampler bounds 100k points while retaining endpoints and extrema', () => {
  const points = Array.from({ length: 100_000 }, (_, index) => ({
    x: index,
    y: Math.sin(index / 37) * 10 + (index === 50_123 ? 10_000 : 0),
  }));
  const startedAt = performance.now();
  const sampled = downsampleReportChartPoints(points, 2_000);
  const elapsedMs = performance.now() - startedAt;

  assert.ok(sampled.length <= 2_000);
  assert.deepEqual(sampled[0], points[0]);
  assert.deepEqual(sampled.at(-1), points.at(-1));
  assert.ok(sampled.some((point) => point.x === 50_123), 'bucket extrema must retain the spike');
  assert.ok(elapsedMs < 500, `100k-point sampling took ${elapsedMs.toFixed(1)} ms`);
});

test('raw tooltip lookup remains available after chart downsampling', () => {
  const points = Array.from({ length: 10_000 }, (_, index) => ({ x: index, y: index * 2 }));
  const sampled = downsampleReportChartPoints(points, 100);
  assert.ok(sampled.length <= 100);
  assert.deepEqual(nearestReportChartPoint(points, 4_321), points[4_321]);
  assert.deepEqual(nearestReportChartPoint(points, 4_321.4), points[4_321]);
});

test('chart sampler treats malformed point budgets as a bounded no-op', () => {
  const points = [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }];
  assert.deepEqual(downsampleReportChartPoints(points, Number.NaN), points);
  assert.deepEqual(downsampleReportChartPoints(points, Number.POSITIVE_INFINITY), points);
  assert.deepEqual(downsampleReportChartPoints(points, 2), points);
});

test('100k trade sorting stays bounded and does not require 100k rendered rows', async () => {
  const trades = Array.from({ length: 100_000 }, (_, index) => ({
    number: index + 1,
    netPnl: (index % 101) - 50,
    entryTime: index,
  }));
  const startedAt = performance.now();
  const sorted = sortBacktestTrades(trades, { key: 'number', direction: -1 });
  const elapsedMs = performance.now() - startedAt;
  assert.equal(sorted.length, trades.length);
  assert.equal(sorted[0].number, 100_000);
  assert.equal(sorted.at(-1).number, 1);
  assert.ok(elapsedMs < 5_000, `100k trade sort took ${elapsedMs.toFixed(1)} ms`);

  const viewer = await readFile(new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url), 'utf8');
  const workbench = await readFile(new URL('../src/features/backtesting/backtest-workbench.ts', import.meta.url), 'utf8');
  assert.match(viewer, /TRADES_PAGE_SIZE = 200/);
  assert.match(viewer, /getBacktestTradeWindow\(sorted, this\.tradePage, TRADES_PAGE_SIZE\)/);
  assert.match(viewer, /table\.dataset\.renderedTradeCount/);
  assert.match(viewer, /table\.dataset\.tradeWindowStart/);
  assert.match(viewer, /aria-rowindex="\$\{tradeWindow\.start \+ index \+ 2\}/);
  assert.match(viewer, /data-trade-source-index="\$\{sourceIndex\}/);
  assert.match(viewer, /body\.addEventListener\('click'/);
  assert.match(viewer, /data-trade-locate/);
  assert.doesNotMatch(viewer, /pageTrades = sorted\.slice/);
  assert.match(viewer, /renderTradePagination/);
  assert.match(viewer, /sortBacktestTradeEntries/);
  assert.doesNotMatch(viewer, /new Map<BacktestTrade, number>/);
  assert.match(workbench, /MAX_DOCK_RENDER_POINTS = 2_000/);
  assert.match(workbench, /tooltipPoints: points/);
  assert.match(workbench, /host\.dataset\.rawPointCount/);
  assert.match(workbench, /host\.dataset\.renderPointCount/);
  assert.doesNotMatch(workbench, /Math\.min\(0, \.\.\.numeric\)/);
  assert.doesNotMatch(workbench, /Math\.max\(0, \.\.\.numeric\)/);
  assert.match(viewer, /dataset\.rawPointCount/);
  assert.match(viewer, /dataset\.renderPointCount/);
  assert.match(viewer, /function reportPerformanceKpiSignature\(report: BacktestReport \| null\)/);
  assert.match(viewer, /performanceKpisUnchanged/);
  assert.match(viewer, /terminalStatusChanged/);
  assert.match(viewer, /runChanged/);
  assert.match(viewer, /updateTransientPerformance\(\)/);
  assert.match(viewer, /updateReportChartPoints\(/);
});

test('live forming-bar repeats do not rebuild the backtest chart surface', async () => {
  const workbench = await readFile(new URL('../src/features/backtesting/backtest-workbench.ts', import.meta.url), 'utf8');
  assert.match(workbench, /function reportSurfaceSignature\(report: BacktestReport \| null\)/);
  assert.match(workbench, /if \(signature === this\.lastSurfaceSignature\) return;/);
  assert.match(workbench, /this\.lastSurfaceSignature = signature;/);
});

test('production E2E direct preview invocation refuses stale dist assets', async () => {
  const runner = await readFile(new URL('./e2e_app.py', import.meta.url), 'utf8');
  assert.match(runner, /def preview_build_is_current\(\)/);
  assert.match(runner, /def ensure_preview_build\(\)/);
  assert.match(runner, /if SERVER_SCRIPT == "preview":\n\s+ensure_preview_build\(\)/);
  assert.match(runner, /Production dist\/ is missing or stale; running npm run build/);
});

test('paged sorting carries source indices without object-identity maps', () => {
  const shared = { netPnl: 1 };
  const trades = [shared, { netPnl: 2 }, shared];
  const entries = sortBacktestTradeEntries(trades, { key: 'number', direction: -1 });
  assert.deepEqual(entries.map((entry) => entry.sourceIndex), [2, 1, 0]);
  assert.deepEqual(entries.map((entry) => entry.trade), [shared, trades[1], shared]);
});

test('large ledger window clamps DOM rows and preserves sorted/source coordinates', () => {
  const sorted = Array.from({ length: 100_000 }, (_, sourceIndex) => ({
    trade: { number: sourceIndex + 1 },
    sourceIndex,
  }));

  const last = getBacktestTradeWindow(sorted, 999_999, 100_000);
  assert.equal(last.pageSize, MAX_BACKTEST_TRADE_PAGE_SIZE);
  assert.equal(last.page, 499);
  assert.equal(last.totalPages, 500);
  assert.equal(last.start, 99_800);
  assert.equal(last.end, 100_000);
  assert.equal(last.entries.length, MAX_BACKTEST_TRADE_PAGE_SIZE);
  assert.equal(last.entries[0].sourceIndex, 99_800);
  assert.equal(last.entries.at(-1)?.sourceIndex, 99_999);

  const first = getBacktestTradeWindow(sorted, -4, Number.NaN);
  assert.equal(first.page, 0);
  assert.equal(first.pageSize, MAX_BACKTEST_TRADE_PAGE_SIZE);
  assert.equal(first.start, 0);
  assert.equal(first.end, MAX_BACKTEST_TRADE_PAGE_SIZE);
  assert.equal(first.entries.length, MAX_BACKTEST_TRADE_PAGE_SIZE);
});

test('Highcharts resource accounting is explicit and cleanup decrements chart/observer counters', async () => {
  const renderer = await readFile(new URL('../src/features/backtesting/highcharts-renderer.ts', import.meta.url), 'utf8');
  assert.match(renderer, /getReportChartResourceStats/);
  assert.match(renderer, /contentRect\.width/);
  assert.match(renderer, /lastWidth/);
  assert.match(renderer, /reflow -> notification loop/);
  assert.match(renderer, /export function updateReportChart\(/);
  assert.match(renderer, /export function updateReportChartPoints\(/);
  assert.match(renderer, /chartSeries\.setData\(data, false, false, false\)/);
  assert.match(renderer, /activeChartCount \+= 1/);
  assert.match(renderer, /activeChartCount = Math\.max\(0, activeChartCount - 1\)/);
  assert.match(renderer, /activeObserverCount = Math\.max\(0, activeObserverCount - 1\)/);
});

test('browser performance gate covers DOM, chart, drag, heap, and 10k Simulation signals', async () => {
  const runner = await readFile(new URL('./backtest_performance.py', import.meta.url), 'utf8');
  const fixture = await readFile(new URL('./fixtures/backtest-performance.html', import.meta.url), 'utf8');
  assert.match(runner, /10_000, 100_000/);
  assert.match(runner, /Runtime\.getHeapUsage/);
  assert.match(runner, /PerformanceObserver/);
  assert.match(runner, /__quantPerfProbe/);
  assert.match(runner, /afterResources/);
  assert.match(runner, /pageTransitionP95Ms/);
  assert.match(runner, /runSimulation\(\{ runs: 10_000 \}\)/);
  assert.match(runner, /Runtime\.getHeapUsage/);
  assert.match(fixture, /count = Number\.isSafeInteger/);
  assert.match(fixture, /rawPointCount/);
  assert.match(fixture, /tableRows/);
  assert.match(fixture, /getReportChartResourceStats/);
  assert.match(fixture, /liveUpdate: \(netProfit, tailValue, status/);
  assert.match(fixture, /liveMetricOnly: \(netProfit, status/);
  assert.match(fixture, /newRunSameData: \(\)/);
  assert.match(fixture, /terminalError: \(message/);
  const simulationFixture = await readFile(new URL('./fixtures/backtest-simulation.html', import.meta.url), 'utf8');
  assert.match(simulationFixture, /runSimulation: \(change\)/);
  assert.match(simulationFixture, /simulationRuntime/);
});
