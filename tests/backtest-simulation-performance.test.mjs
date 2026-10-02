import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import {
  BacktestSimulationTaskCancelledError,
  BacktestSimulationWorkerRunner,
} from '../src/app/backtest-simulation-worker.ts';
import {
  BACKTEST_SIMULATION_MAX_BAND_POINTS,
  simulateBacktestReference,
} from '../src/domain/backtest-simulation.ts';

const LARGE_TRADE_COUNT = 600;
const LARGE_DELTAS = Object.freeze(Array.from(
  { length: LARGE_TRADE_COUNT },
  (_, index) => (((index * 37) % 29) - 14) * 0.75,
));
const LARGE_MAE = Object.freeze(LARGE_DELTAS.map(
  (delta, index) => Math.max(0, -delta) + (index % 7) * 0.2,
));

const RUN_SIZED_RESULT_KEYS = Object.freeze([
  'finals',
  'maxDrawdowns',
  'maxDrawdownsAbs',
  'openMaxDrawdowns',
  'openMaxDrawdownsAbs',
]);
const RUN_SIZED_STREAK_KEYS = Object.freeze([
  'longestLosingStreak',
  'maxDrawdownDuration',
  'recoveryDuration',
]);
const BAND_KEYS = Object.freeze(['index', 'p5', 'p25', 'p50', 'p75', 'p95']);

function largeInput(runs) {
  return Object.freeze({
    deltas: LARGE_DELTAS,
    excursions: Object.freeze({ mae: LARGE_MAE }),
    initialCapital: 100_000,
    runs,
    mode: 'resample',
    seed: 12_648_430,
    variation: 0.08,
    preserveWinLoss: true,
  });
}

function assertBoundedResult(result, runs) {
  for (const key of RUN_SIZED_RESULT_KEYS) assert.equal(result[key].length, runs, key);
  for (const key of RUN_SIZED_STREAK_KEYS) assert.equal(result.streaks[key].length, runs, key);

  const bandPoints = result.bands.index.length;
  assert.equal(bandPoints, BACKTEST_SIMULATION_MAX_BAND_POINTS);
  for (const key of BAND_KEYS) assert.equal(result.bands[key].length, bandPoints, key);
  assert.equal(result.bands.index[0], 0);
  assert.equal(result.bands.index.at(-1), LARGE_TRADE_COUNT);
  assert.ok(result.bands.index.every((value, index, values) => (
    index === 0 || value > values[index - 1]
  )));

  // Eight public vectors scale with the population. Bands scale only with the
  // capped path sample, never with every trade in every run.
  const runSizedValues = RUN_SIZED_RESULT_KEYS.reduce(
    (total, key) => total + result[key].length,
    0,
  ) + RUN_SIZED_STREAK_KEYS.reduce(
    (total, key) => total + result.streaks[key].length,
    0,
  );
  const retainedBandValues = BAND_KEYS.reduce(
    (total, key) => total + result.bands[key].length,
    0,
  );
  assert.equal(runSizedValues, runs * 8);
  assert.equal(retainedBandValues, BACKTEST_SIMULATION_MAX_BAND_POINTS * 6);

  // The implementation stores one Float64 value per run and sampled path
  // point while calculating percentiles: 39.0625 MiB at the supported 10k
  // upper bound. Keep this deterministic arithmetic contract in the test
  // instead of asserting noisy process-wide heap/RSS measurements.
  const bandWorkspaceBytes = runs
    * BACKTEST_SIMULATION_MAX_BAND_POINTS
    * Float64Array.BYTES_PER_ELEMENT;
  assert.ok(bandWorkspaceBytes <= 40 * 1024 * 1024);
}

test('1k and 10k simulation populations complete within bounded result and band storage', {
  timeout: 30_000,
}, () => {
  for (const runs of [1_000, 10_000]) {
    const startedAt = performance.now();
    const result = simulateBacktestReference(largeInput(runs));
    const elapsedMs = performance.now() - startedAt;

    assertBoundedResult(result, runs);
    assert.ok(result.finals.every(Number.isFinite));
    assert.ok(elapsedMs < 20_000, `${runs} runs took ${elapsedMs.toFixed(1)} ms`);
  }
});

class ControlledWorker {
  messages = [];
  messageListeners = [];
  errorListeners = [];
  terminated = false;

  postMessage(message) {
    this.messages.push(message);
  }

  addEventListener(type, listener) {
    if (type === 'message') this.messageListeners.push(listener);
    else this.errorListeners.push(listener);
  }

  terminate() {
    this.terminated = true;
  }

  emit(message) {
    this.messageListeners.forEach((listener) => listener({ data: message }));
  }
}

test('superseded Workers cannot publish stale progress or completion', async () => {
  const workers = [];
  const firstProgress = [];
  const secondProgress = [];
  const runner = new BacktestSimulationWorkerRunner({
    createWorker: () => {
      const worker = new ControlledWorker();
      workers.push(worker);
      return worker;
    },
  });

  const first = runner.run(largeInput(10_000), {
    onProgress: (progress) => firstProgress.push(progress.completedRuns),
  });
  workers[0].emit({
    kind: 'progress',
    requestId: first.requestId,
    progress: { completedRuns: 100, totalRuns: 10_000, fraction: 0.01 },
  });
  const firstRejection = assert.rejects(
    first.promise,
    (error) => error instanceof BacktestSimulationTaskCancelledError
      && error.reason === 'superseded'
      && error.completedRuns === 100
      && error.totalRuns === 10_000,
  );

  const secondInput = Object.freeze({
    deltas: Object.freeze([3, -1, 2]),
    initialCapital: 100,
    runs: 2,
    mode: 'shuffle',
    seed: 43,
  });
  const second = runner.run(secondInput, {
    onProgress: (progress) => secondProgress.push(progress.completedRuns),
  });
  let secondSettled = false;
  void second.promise.then(() => { secondSettled = true; });

  assert.equal(workers[0].terminated, true);
  workers[0].emit({
    kind: 'progress',
    requestId: first.requestId,
    progress: { completedRuns: 10_000, totalRuns: 10_000, fraction: 1 },
  });
  workers[0].emit({
    kind: 'complete',
    requestId: first.requestId,
    result: structuredClone(simulateBacktestReference(largeInput(1_000))),
  });
  await Promise.resolve();

  assert.deepEqual(firstProgress, [100]);
  assert.deepEqual(secondProgress, []);
  assert.equal(secondSettled, false);

  const secondResult = simulateBacktestReference(secondInput);
  workers[1].emit({
    kind: 'complete',
    requestId: second.requestId,
    result: structuredClone(secondResult),
  });

  await firstRejection;
  assert.deepEqual(await second.promise, secondResult);
  runner.destroy();
});
