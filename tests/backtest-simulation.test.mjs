import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BACKTEST_SIMULATION_DEFAULT_SEED,
  BACKTEST_SIMULATION_HISTOGRAM_BINS,
  BACKTEST_SIMULATION_MAX_BAND_POINTS,
  BacktestSimulationCancelledError,
  buildSimulationHistogram,
  createMulberry32,
  drawdownProbability,
  linearPercentile,
  linearPercentileSorted,
  ruinProbability,
  simulateBacktestReference,
  simulateBacktestReferenceControlled,
  walkBacktestEquity,
} from '../src/domain/backtest-simulation.ts';

const COMPLETE_EMPTY_RESULT = {
  bands: { index: [], p5: [], p25: [], p50: [], p75: [], p95: [] },
  finals: [],
  maxDrawdowns: [],
  maxDrawdownsAbs: [],
  openMaxDrawdowns: [],
  openMaxDrawdownsAbs: [],
  probProfit: 0,
  medianFinal: 0,
  p5Final: 0,
  p95Final: 0,
  p95Drawdown: 0,
  p99Drawdown: 0,
  streaks: {
    longestLosingStreak: [],
    maxDrawdownDuration: [],
    recoveryDuration: [],
  },
};

function increments(path) {
  return path.slice(1).map((value, index) => value - path[index]);
}

test('pins the reference defaults and Mulberry32 sequence', () => {
  assert.equal(BACKTEST_SIMULATION_DEFAULT_SEED, 12_648_430);
  assert.equal(BACKTEST_SIMULATION_HISTOGRAM_BINS, 30);
  assert.equal(BACKTEST_SIMULATION_MAX_BAND_POINTS, 512);

  const random = createMulberry32(12_648_430);
  assert.deepEqual(Array.from({ length: 6 }, () => random()), [
    0.021141508361324668,
    0.6661099966149777,
    0.7799714196007699,
    0.7395844468846917,
    0.10705656302161515,
    0.5010192445479333,
  ]);
});

test('is deterministic by seed without mutating deltas or excursions', () => {
  const deltas = Object.freeze([10, -4, 7, -2]);
  const mae = Object.freeze([3, 12, 5, 4]);
  const excursions = Object.freeze({ mae });
  const input = Object.freeze({
    deltas,
    excursions,
    initialCapital: 100,
    runs: 20,
    mode: 'resample',
    seed: 42,
    variation: 0.2,
    preserveWinLoss: true,
  });

  const first = simulateBacktestReference(input);
  const second = simulateBacktestReference(input);
  const differentSeed = simulateBacktestReference({ ...input, seed: 43 });

  assert.deepEqual(first, second);
  assert.notDeepEqual(first.finals, differentSeed.finals);
  assert.deepEqual(deltas, [10, -4, 7, -2]);
  assert.deepEqual(mae, [3, 12, 5, 4]);
});

test('controlled execution preserves exact results while reporting bounded progress', () => {
  const input = {
    deltas: [10, -4, 7, -2],
    excursions: { mae: [3, 12, 5, 4] },
    initialCapital: 100,
    runs: 250,
    mode: 'resample',
    seed: 42,
    variation: 0.2,
    preserveWinLoss: true,
  };
  const progress = [];
  const controlled = simulateBacktestReferenceControlled(input, {
    onProgress: (value) => progress.push(value),
  });

  assert.deepEqual(controlled, simulateBacktestReference(input));
  assert.deepEqual(progress[0], { completedRuns: 0, totalRuns: 250, fraction: 0 });
  assert.deepEqual(progress.at(-1), { completedRuns: 250, totalRuns: 250, fraction: 1 });
  assert.ok(progress.length <= 102);
  assert.ok(progress.every((value, index) => (
    Object.isFrozen(value)
    && (index === 0 || value.completedRuns > progress[index - 1].completedRuns)
  )));
});

test('controlled execution observes cancellation before publishing a stale result', () => {
  const signal = { aborted: false };
  const progress = [];
  assert.throws(
    () => simulateBacktestReferenceControlled({
      deltas: [10, -4, 7, -2],
      initialCapital: 100,
      runs: 25,
      mode: 'resample',
      seed: 42,
    }, {
      signal,
      onProgress: (value) => {
        progress.push(value);
        if (value.completedRuns >= 10) signal.aborted = true;
      },
    }),
    (error) => error instanceof BacktestSimulationCancelledError
      && error.completedRuns === 10
      && error.totalRuns === 25,
  );
  assert.equal(progress[0].completedRuns, 0);
  assert.equal(progress.at(-1).completedRuns, 10);
});

test('Resample samples with replacement and keeps MAE attached to its trade', () => {
  const result = simulateBacktestReference({
    deltas: [1, 10],
    excursions: { mae: [2, 20] },
    initialCapital: 100,
    runs: 1,
    mode: 'resample',
    seed: 0,
  });

  // Seed 0 selects source index 0 twice. Both its P&L and MAE repeat.
  assert.deepEqual(result.bands.p50, [0, 1, 2]);
  assert.deepEqual(result.finals, [2]);
  assert.deepEqual(result.openMaxDrawdownsAbs, [2]);
  assert.deepEqual(result.openMaxDrawdowns, [0.02]);
});

test('Shuffle keeps the multiset, reuses the working order, and carries MAE with each trade', () => {
  const result = simulateBacktestReference({
    deltas: [1, 2, 4, 8],
    excursions: { mae: [10, 20, 40, 80] },
    initialCapital: 100,
    runs: 3,
    mode: 'shuffle',
    seed: 0,
  });

  assert.deepEqual(result.finals, [15, 15, 15]);
  assert.deepEqual(result.bands.p50, [0, 8, 10, 11, 15]);
  assert.deepEqual(result.bands.p5, [0, 2.6, 3.7, 7.4, 15]);

  const oneRun = simulateBacktestReference({
    deltas: [20, -10, 5],
    excursions: { mae: [1, 60, 2] },
    initialCapital: 100,
    runs: 1,
    mode: 'shuffle',
    seed: 1,
  });
  assert.deepEqual(increments(oneRun.bands.p50).sort((left, right) => left - right), [-10, 5, 20]);
  // The -10 trade is shuffled last. Its MAE=60 is measured from peak 125.
  assert.deepEqual(oneRun.openMaxDrawdownsAbs, [60]);
  assert.deepEqual(oneRun.openMaxDrawdowns, [0.48]);
});

test('uses the reference Laplace variation and scales MAE by the absolute factor', () => {
  const result = simulateBacktestReference({
    deltas: [10],
    excursions: { mae: [20] },
    initialCapital: 100,
    runs: 1,
    mode: 'resample',
    seed: 0,
    variation: 0.5,
  });

  assert.deepEqual(result.finals, [-26.620208121531373]);
  assert.deepEqual(result.maxDrawdowns, [0.26620208121531375]);
  assert.deepEqual(result.openMaxDrawdownsAbs, [53.24041624306275]);
  assert.deepEqual(result.openMaxDrawdowns, [0.5324041624306275]);
});

test('preserveWinLoss restores source signs after variation and leaves zero at zero', () => {
  const base = {
    deltas: [10, -10, 0],
    initialCapital: 100,
    runs: 1,
    mode: 'shuffle',
    seed: 0,
    variation: 2,
  };
  const unbounded = simulateBacktestReference({ ...base, preserveWinLoss: false });
  const preserved = simulateBacktestReference({ ...base, preserveWinLoss: true });

  assert.deepEqual(increments(unbounded.bands.p50), [6.124344327067714, 0, 8.648457785489397]);
  assert.deepEqual(increments(preserved.bands.p50), [-6.124344327067714, 0, 8.648457785489397]);
});

test('walks cumulative net profit and reports no drawdown on an increasing path', () => {
  const walk = walkBacktestEquity([10, 0, 5], 100);
  assert.deepEqual(walk, {
    path: [0, 10, 10, 15],
    final: 15,
    maxDrawdown: 0,
    maxDrawdownAbs: 0,
    openMaxDrawdown: 0,
    openMaxDrawdownAbs: 0,
    longestLosingStreak: 0,
    maxDrawdownDuration: 0,
    recoveryDuration: 0,
    recovered: true,
  });
});

test('measures deepest drawdown duration and recovered/unrecovered recovery floors', () => {
  const recovered = walkBacktestEquity([20, -30, 5, 25], 100);
  assert.deepEqual(recovered.path, [0, 20, -10, -5, 20]);
  assert.equal(recovered.maxDrawdown, 0.25);
  assert.equal(recovered.maxDrawdownAbs, 30);
  assert.equal(recovered.maxDrawdownDuration, 1);
  assert.equal(recovered.recoveryDuration, 2);
  assert.equal(recovered.recovered, true);

  const underWater = walkBacktestEquity([20, -30, 5], 100);
  assert.equal(underWater.maxDrawdownDuration, 1);
  assert.equal(underWater.recoveryDuration, 1);
  assert.equal(underWater.recovered, false);
});

test('zero interrupts a losing streak and MAE can exceed realized drawdown', () => {
  const streak = walkBacktestEquity([-1, -2, 0, -3, -4, -5], 100);
  assert.equal(streak.longestLosingStreak, 3);

  const withMae = walkBacktestEquity([20, -10, 15], 100, { mae: [2, 40, 3] });
  assert.equal(withMae.maxDrawdown, 10 / 120);
  assert.equal(withMae.maxDrawdownAbs, 10);
  assert.equal(withMae.openMaxDrawdown, 40 / 120);
  assert.equal(withMae.openMaxDrawdownAbs, 40);
});

test('falls back per invalid MAE and ignores a length-mismatched excursion set in simulation', () => {
  const fallback = walkBacktestEquity([20, -10], 100, { mae: [1, Number.NaN] });
  const missing = walkBacktestEquity([20, -10], 100, { mae: [1] });
  assert.equal(fallback.openMaxDrawdownAbs, 10);
  assert.equal(missing.openMaxDrawdownAbs, 10);

  const mismatched = simulateBacktestReference({
    deltas: [20, -10],
    excursions: { mae: [1_000] },
    initialCapital: 100,
    runs: 1,
    mode: 'shuffle',
    seed: 0,
  });
  assert.deepEqual(mismatched.openMaxDrawdownsAbs, [10]);
});

test('keeps path and streaks but disables drawdown calculations for invalid capital', () => {
  for (const initialCapital of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
    const walk = walkBacktestEquity([5, -10, -2], initialCapital, { mae: [50, 50, 50] });
    assert.deepEqual(walk.path, [0, 5, -5, -7]);
    assert.equal(walk.final, -7);
    assert.equal(walk.longestLosingStreak, 2);
    assert.equal(walk.maxDrawdown, 0);
    assert.equal(walk.maxDrawdownAbs, 0);
    assert.equal(walk.openMaxDrawdown, 0);
    assert.equal(walk.openMaxDrawdownAbs, 0);
  }
});

test('interpolates percentiles without changing the input order', () => {
  const values = [30, 0, 20, 10];
  assert.equal(linearPercentile([], 0.5), 0);
  assert.equal(linearPercentile([7], 0.95), 7);
  assert.equal(linearPercentile(values, 0.5), 15);
  assert.equal(linearPercentile(values, 0.25), 7.5);
  assert.equal(linearPercentileSorted(new Float64Array([0, 10, 20, 30]), 0.95), 28.499999999999996);
  assert.deepEqual(values, [30, 0, 20, 10]);
});

test('builds reference histograms, including constant and right-edge cases', () => {
  assert.deepEqual(buildSimulationHistogram([], 30), []);
  assert.deepEqual(buildSimulationHistogram([1, 2], 0), []);
  assert.deepEqual(buildSimulationHistogram([1, 2], -1), []);
  assert.deepEqual(buildSimulationHistogram([5, 5, 5], 30), [{ from: 5, to: 5, count: 3 }]);
  assert.deepEqual(
    buildSimulationHistogram([100, 100 + 1e-8], 30),
    [{ from: 100, to: 100 + 1e-8, count: 2 }],
  );

  const values = Array.from({ length: 31 }, (_, index) => index);
  const histogram = buildSimulationHistogram(values);
  assert.equal(histogram.length, 30);
  assert.equal(histogram[0].count, 1);
  assert.equal(histogram.at(-1).count, 2);
  assert.equal(histogram.reduce((total, bin) => total + bin.count, 0), values.length);
  assert.deepEqual(histogram.at(-1), { from: 29, to: 30, count: 2 });
});

test('drawdown and ruin probabilities include values equal to the threshold', () => {
  assert.equal(drawdownProbability([], 0.5), 0);
  assert.equal(drawdownProbability([0.1, 0.5, 0.5, 0.9], 0.5), 0.75);
  assert.equal(ruinProbability([0.99, 1, 1.2]), 2 / 3);
});

test('produces all five path bands and caps sampled path positions at 512', () => {
  const compact = simulateBacktestReference({
    deltas: [1, 10],
    initialCapital: 100,
    runs: 5,
    mode: 'resample',
    seed: 0,
  });
  assert.deepEqual(compact.finals, [2, 2, 11, 20, 11]);
  assert.deepEqual(compact.bands, {
    index: [0, 1, 2],
    p5: [0, 1, 2],
    p25: [0, 1, 2],
    p50: [0, 1, 11],
    p75: [0, 1, 11],
    p95: [0, 8.2, 18.2],
  });

  const large = simulateBacktestReference({
    deltas: Array(600).fill(1),
    initialCapital: 1_000,
    runs: 1,
    mode: 'resample',
    seed: 0,
  });
  assert.equal(large.bands.index.length, 512);
  assert.equal(large.bands.index[0], 0);
  assert.equal(large.bands.index.at(-1), 600);
  assert.deepEqual(large.bands.p5, large.bands.index);
  assert.deepEqual(large.bands.p25, large.bands.index);
  assert.deepEqual(large.bands.p50, large.bands.index);
  assert.deepEqual(large.bands.p75, large.bands.index);
  assert.deepEqual(large.bands.p95, large.bands.index);
});

test('returns the complete reference statistics contract', () => {
  const result = simulateBacktestReference({
    deltas: [10, -20, 5],
    initialCapital: 100,
    runs: 5,
    mode: 'resample',
    seed: 0,
  });

  assert.deepEqual(result.finals, [30, -30, -60, 0, -10]);
  assert.deepEqual(result.maxDrawdowns, [0, 4 / 11, 0.6, 0.2, 4 / 21]);
  assert.deepEqual(result.maxDrawdownsAbs, [0, 40, 60, 20, 20]);
  assert.deepEqual(result.openMaxDrawdowns, result.maxDrawdowns);
  assert.deepEqual(result.openMaxDrawdownsAbs, result.maxDrawdownsAbs);
  assert.equal(result.probProfit, 0.2);
  assert.equal(result.medianFinal, -10);
  assert.equal(result.p5Final, -54);
  assert.equal(result.p95Final, 23.999999999999993);
  assert.equal(result.p95Drawdown, 0.5527272727272727);
  assert.equal(result.p99Drawdown, 0.5905454545454545);
  assert.deepEqual(result.streaks, {
    longestLosingStreak: [0, 2, 3, 1, 1],
    maxDrawdownDuration: [0, 2, 3, 1, 1],
    recoveryDuration: [0, 0, 0, 2, 1],
  });
});

test('returns a complete empty result for invalid simulation populations', () => {
  const base = {
    deltas: [1],
    initialCapital: 100,
    runs: 1,
    mode: 'resample',
    seed: 0,
  };
  assert.deepEqual(simulateBacktestReference({ ...base, deltas: [] }), COMPLETE_EMPTY_RESULT);
  assert.deepEqual(simulateBacktestReference({ ...base, runs: 0 }), COMPLETE_EMPTY_RESULT);
  assert.deepEqual(simulateBacktestReference({ ...base, runs: Number.NaN }), COMPLETE_EMPTY_RESULT);
  assert.deepEqual(simulateBacktestReference({ ...base, initialCapital: 0 }), COMPLETE_EMPTY_RESULT);
  assert.deepEqual(simulateBacktestReference({ ...base, initialCapital: Number.NaN }), COMPLETE_EMPTY_RESULT);
});

test('freezes public results, nested records, arrays, and histogram bins', () => {
  const result = simulateBacktestReference({
    deltas: [1, -2],
    initialCapital: 100,
    runs: 2,
    mode: 'shuffle',
    seed: 0,
  });
  const walk = walkBacktestEquity([1, -2], 100);
  const histogram = buildSimulationHistogram([0, 1, 2], 2);

  for (const value of [
    result,
    result.bands,
    result.bands.index,
    result.bands.p5,
    result.finals,
    result.maxDrawdowns,
    result.openMaxDrawdownsAbs,
    result.streaks,
    result.streaks.longestLosingStreak,
    walk,
    walk.path,
    histogram,
    ...histogram,
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }
});
