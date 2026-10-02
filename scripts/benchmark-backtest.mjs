import os from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';

import { downsampleReportChartPoints } from '../src/features/backtesting/chart-sampling.ts';
import { sortBacktestTrades } from '../src/features/backtesting/trade-log.ts';

const ITERATIONS = 7;
const COUNTS = [1_000, 10_000, 100_000];

function percentile(values, p) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[Math.max(0, index)];
}

function measure(label, count, operation) {
  const samples = [];
  // The first run includes allocation/JIT noise; keep it as a warmup and
  // report only the repeated measurements used by the budget check.
  operation();
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const startedAt = performance.now();
    operation();
    samples.push(performance.now() - startedAt);
  }
  return {
    operation: label,
    count,
    iterations: ITERATIONS,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    maxMs: Math.max(...samples),
  };
}

const measurements = [];
for (const count of COUNTS) {
  const trades = Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    netPnl: (index % 101) - 50,
    entryTime: index,
  }));
  const points = Array.from({ length: count }, (_, index) => ({
    x: index,
    y: Math.sin(index / 37) * 10 + (index === Math.floor(count * 0.73) ? 10_000 : 0),
  }));
  measurements.push(measure('trade-sort', count, () => {
    sortBacktestTrades(trades, { key: 'number', direction: -1 });
  }));
  measurements.push(measure('chart-downsample', count, () => {
    downsampleReportChartPoints(points, 2_000);
  }));
}

const output = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  cpu: os.cpus()[0]?.model ?? 'unknown',
  measurements,
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
