import { BacktestSimulationWorkerRunner } from '../../src/app/backtest-simulation-worker.ts';
import { createBacktestReport } from '../../src/domain/backtesting.ts';
import {
  calculateSummaryMetrics, calculatePerformanceMetrics, calculateAnalysisMetrics,
} from '../../src/domain/backtest-metrics.ts';
import { aggregateBacktestTradeCalendar } from '../../src/features/backtesting/trade-calendar.ts';
import { calculateTradeAnalysis } from '../../src/domain/trade-analysis.ts';
import { downsampleReportChartPoints } from '../../src/features/backtesting/chart-sampling.ts';
import {
  enhanceReportChart, destroyReportChart, getReportChartResourceStats, loadHighcharts,
} from '../../src/features/backtesting/highcharts-renderer.ts';
import type { BacktestTrade } from '../../src/features/backtesting/backtest-types.ts';

const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export function selectorTrace(trades: BacktestTrade[]) {
  const init = {
    key: { cellId: 'perf', indicatorId: 'selector' }, title: 'selector trace',
    status: 'ready' as const, revision: 1, finality: 'historical-final' as const,
    context: { provider: 'binance', symbol: 'BTCUSDT', timeframe: '1h', timezone: 'UTC', currency: 'USD' },
    trades: trades.map(trade => ({ ...trade, quantity: trade.size ?? 1 })),
    account: { initialCapital: 100_000, currency: 'USD' },
  };
  const samples: Array<Record<string, number>> = [];
  const cachedSamples: number[] = [];
  const factorySamples: number[] = [];
  let checksum = 0;
  let durationRows = 0;
  for (let index = -1; index < 7; index += 1) {
    // A genuinely new report per sample prevents memoized cache hits from
    // disguising the first aggregation cost of a new engine revision.
    const factoryStart = performance.now();
    const report = createBacktestReport({ ...init, revision: index + 2 });
    factorySamples.push(performance.now() - factoryStart);
    const durations: Record<string, number> = {};
    const combinedStart = performance.now();
    for (const [label, action] of [
      ['summary', () => calculateSummaryMetrics(report)],
      ['performance', () => calculatePerformanceMetrics(report)],
      ['analysis', () => calculateAnalysisMetrics(report)],
      ['tradeAnalysis', () => calculateTradeAnalysis(report)],
      ['calendar', () => aggregateBacktestTradeCalendar(trades)],
    ] as const) {
      const start = performance.now();
      const value = action();
      durations[label] = performance.now() - start;
      performance.measure(`selector-${trades.length}-${label}-${index}`, { start, end: performance.now() });
      checksum += value instanceof Map ? value.size : Object.keys(value).length;
      if ('durationPnl' in value) durationRows = value.durationPnl.length;
    }
    durations.combined = performance.now() - combinedStart;
    const cachedStart = performance.now();
    calculateSummaryMetrics(report);
    calculatePerformanceMetrics(report);
    calculateAnalysisMetrics(report);
    cachedSamples.push(performance.now() - cachedStart);
    if (index >= 0) samples.push(durations);
  }
  return {
    count: trades.length, samples, checksum, factorySamples, cachedSamples, durationRows,
    p95: Object.fromEntries(Object.keys(samples[0]).map(key => [key, percentile(samples.map(sample => sample[key]), .95)])),
    measures: performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('selector-'))
      .map(entry => ({ name: entry.name, startTime: entry.startTime, duration: entry.duration })),
  };
}

/** Actual module Workers, including the production URL rewrite, are used. */
export async function simulationLifecycle() {
  const originalWorker = window.Worker;
  const active = new Set<Worker>();
  const workerEvents: Array<{ kind: string; at: number }> = [];
  class ObservedWorker extends originalWorker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      active.add(this);
      workerEvents.push({ kind: 'create', at: performance.now() });
    }
    terminate() {
      active.delete(this);
      workerEvents.push({ kind: 'terminate', at: performance.now() });
      super.terminate();
    }
  }
  window.Worker = ObservedWorker;
  const input = {
    deltas: Array.from({ length: 2_000 }, (_, i) => i % 7 - 2),
    initialCapital: 100_000, runs: 10_000, mode: 'resample' as const, seed: 123,
  };
  const fallbackErrors: string[] = [];
  const results: Array<Record<string, unknown>> = [];
  const runner = new BacktestSimulationWorkerRunner();
  try {
    for (const kind of ['cancelled', 'superseded', 'destroyed'] as const) {
      let start = 0;
      let resolveProgress!: () => void;
      const progressReady = new Promise<void>(resolve => { resolveProgress = resolve; });
      const progress: number[] = [];
      const task = runner.run(input, {
        onProgress(event) { progress.push(event.completedRuns); if (event.completedRuns > 0) resolveProgress(); },
        onFallback(error) { fallbackErrors.push(String(error)); },
      });
      const settled = task.promise.then(
        () => ({ status: 'unexpected-success', elapsedMs: performance.now() - start }),
        error => ({ status: error.reason, elapsedMs: performance.now() - start }),
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([progressReady, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Worker progress timed out')), 10_000);
        })]);
      } finally { clearTimeout(timer); }
      start = performance.now();
      let replacement;
      if (kind === 'cancelled') task.cancel();
      if (kind === 'superseded') replacement = runner.run({ ...input, deltas: [1, -2, 3], runs: 1_000 });
      if (kind === 'destroyed') runner.destroy();
      const outcome = await settled;
      const replacementResult = replacement ? await replacement.promise : null;
      const progressAfter = progress.length;
      await new Promise(resolve => setTimeout(resolve, 75));
      results.push({ kind, ...outcome, progress, lateProgress: progress.length - progressAfter,
        activeWorkers: active.size, replacementRuns: replacementResult?.finals.length ?? null });
    }
  } finally {
    runner.destroy();
    window.Worker = originalWorker;
  }
  return { results, workerEvents, activeWorkers: active.size, fallbackErrors };
}

/** Real Highcharts range + line series, after bounded sampling. */
export async function mountRangeProbe(count: number) {
  const host = document.createElement('div');
  host.id = 'runtime-range-probe';
  Object.assign(host.style, { position: 'fixed', inset: '40px', zIndex: '10000', height: '500px', background: '#141414' });
  document.body.append(host);
  const raw = Array.from({ length: count }, (_, x) => ({ x, low: x - 20, high: x + 20 }));
  raw[Math.floor(count * .6)] = { x: Math.floor(count * .6), low: -40_000, high: 400_000 };
  const ranges = downsampleReportChartPoints(raw);
  const lines = ranges.map(point => ({ x: point.x, y: point.x }));
  await enhanceReportChart(host, {
    kind: 'line', label: 'Range + median performance', axis: 'linear', points: lines,
    tooltipMode: 'simulation-paths', valueUnit: 'currency',
    series: [
      { name: 'Median', kind: 'line', points: lines },
      { name: '5–95%', kind: 'arearange', points: ranges, enableMouseTracking: true },
    ],
  });
  const Highcharts = await loadHighcharts();
  const chart = Highcharts.charts.find(chart => chart?.container.parentElement === host)!;
  // Narrow the axis range to prove reflow retains the source extrema and all
  // shared tooltip series. This does not pretend to be a reference screenshot.
  const index = Math.floor(ranges.length / 3);
  const selected = ranges[index];
  chart.xAxis[0].setExtremes(ranges[index - 3].x, ranges[index + 3].x, true, false);
  await frames();
  const rect = host.getBoundingClientRect();
  return {
    rawCount: raw.length, renderCounts: chart.series.map(series => series.data.length),
    extremaPreserved: ranges.some(point => point.high === 400_000 && point.low === -40_000),
    selected, x: rect.left + chart.xAxis[0].toPixels(selected.x),
    y: rect.top + chart.yAxis[0].toPixels(selected.x),
    resources: getReportChartResourceStats(),
  };
}

export function unmountRangeProbe() {
  const host = document.querySelector<HTMLElement>('#runtime-range-probe');
  if (host) { destroyReportChart(host); host.remove(); }
  return getReportChartResourceStats();
}

export async function chartEarlyDestroy() {
  const before = getReportChartResourceStats();
  const host = document.createElement('div');
  document.body.append(host);
  const pending = enhanceReportChart(host, { kind: 'line', label: 'early destroy', points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] });
  destroyReportChart(host);
  host.remove();
  await pending;
  await frames();
  return { before, after: getReportChartResourceStats() };
}

export async function chartConstructionFailure() {
  const Highcharts = await loadHighcharts();
  const nativeFactory = Highcharts.chart;
  const nativeObserver = window.ResizeObserver;
  const before = { ...getReportChartResourceStats(), libraryCharts: Highcharts.charts.filter(Boolean).length };
  const host = document.createElement('div');
  document.body.append(host);
  let message = '';
  try {
    // Force the report-owned observer setup to fail after a real Chart was
    // constructed. This is the partial-construction cleanup branch.
    Highcharts.chart = function (...args: Parameters<typeof Highcharts.chart>) {
      const result = nativeFactory.apply(Highcharts, args);
      window.ResizeObserver = class {
        constructor() { throw new Error('injected report observer construction failure'); }
      } as unknown as typeof ResizeObserver;
      return result;
    } as typeof Highcharts.chart;
    await enhanceReportChart(host, { kind: 'line', label: 'constructor fault', points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] });
  } catch (error) { message = String(error); }
  finally {
    Highcharts.chart = nativeFactory;
    window.ResizeObserver = nativeObserver;
    destroyReportChart(host);
    host.remove();
  }
  return { before, after: { ...getReportChartResourceStats(), libraryCharts: Highcharts.charts.filter(Boolean).length }, message };
}
