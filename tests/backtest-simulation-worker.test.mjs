import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BacktestSimulationTaskCancelledError,
  BacktestSimulationWorkerRunner,
} from '../src/app/backtest-simulation-worker.ts';
import { simulateBacktestReference } from '../src/domain/backtest-simulation.ts';

const INPUT = Object.freeze({
  deltas: Object.freeze([10, -4, 7, -2]),
  excursions: Object.freeze({ mae: Object.freeze([3, 12, 5, 4]) }),
  initialCapital: 100,
  runs: 20,
  mode: 'resample',
  seed: 42,
  variation: 0.2,
  preserveWinLoss: true,
});

class FakeWorker {
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

  fail(error) {
    this.errorListeners.forEach((listener) => listener({ message: error.message, error }));
  }
}

test('Worker runner publishes progress and restores immutable results after transfer', async () => {
  const worker = new FakeWorker();
  const progress = [];
  const runner = new BacktestSimulationWorkerRunner({ createWorker: () => worker });
  const task = runner.run(INPUT, { onProgress: (value) => progress.push(value) });

  assert.deepEqual(worker.messages, [{ kind: 'run', requestId: 1, input: INPUT }]);
  worker.emit({
    kind: 'progress',
    requestId: 1,
    progress: { completedRuns: 10, totalRuns: 20, fraction: 0.5 },
  });
  const transferred = structuredClone(simulateBacktestReference(INPUT));
  worker.emit({ kind: 'complete', requestId: 1, result: transferred });

  const result = await task.promise;
  assert.deepEqual(result, simulateBacktestReference(INPUT));
  assert.deepEqual(progress, [{ completedRuns: 10, totalRuns: 20, fraction: 0.5 }]);
  assert.equal(Object.isFrozen(progress[0]), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.bands.p50), true);
  assert.equal(Object.isFrozen(result.streaks.recoveryDuration), true);
  assert.equal(worker.terminated, true);
  runner.destroy();
});

test('starting a new task cancels and rejects the superseded Worker task', async () => {
  const workers = [];
  const runner = new BacktestSimulationWorkerRunner({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
  const first = runner.run(INPUT);
  const firstRejection = assert.rejects(
    first.promise,
    (error) => error instanceof BacktestSimulationTaskCancelledError
      && error.reason === 'superseded'
      && error.totalRuns === 20,
  );
  const second = runner.run({ ...INPUT, seed: 43 });

  assert.equal(workers[0].terminated, true);
  // A late message from a terminated task must never settle the new task.
  workers[0].emit({
    kind: 'complete',
    requestId: first.requestId,
    result: structuredClone(simulateBacktestReference(INPUT)),
  });
  const secondResult = simulateBacktestReference({ ...INPUT, seed: 43 });
  workers[1].emit({
    kind: 'complete',
    requestId: second.requestId,
    result: structuredClone(secondResult),
  });

  await firstRejection;
  assert.deepEqual(await second.promise, secondResult);
  runner.destroy();
});

test('Worker startup failure falls back locally with the same deterministic result', async () => {
  const progress = [];
  const fallbacks = [];
  const runner = new BacktestSimulationWorkerRunner({
    createWorker: () => {
      throw new Error('worker blocked by CSP');
    },
  });
  const task = runner.run(INPUT, {
    onProgress: (value) => progress.push(value),
    onFallback: (error) => fallbacks.push(error),
  });

  assert.deepEqual(await task.promise, simulateBacktestReference(INPUT));
  assert.equal(fallbacks.length, 1);
  assert.match(fallbacks[0].message, /blocked by CSP/);
  assert.equal(progress[0].completedRuns, 0);
  assert.equal(progress.at(-1).fraction, 1);
  runner.destroy();
});

test('explicit cancellation terminates the Worker and cannot fall back', async () => {
  const worker = new FakeWorker();
  let fallbackCalls = 0;
  const runner = new BacktestSimulationWorkerRunner({ createWorker: () => worker });
  const task = runner.run(INPUT, { onFallback: () => { fallbackCalls += 1; } });
  const rejection = assert.rejects(
    task.promise,
    (error) => error instanceof BacktestSimulationTaskCancelledError
      && error.reason === 'cancelled',
  );
  task.cancel();
  worker.fail(new Error('late worker error'));

  await rejection;
  assert.equal(worker.terminated, true);
  assert.equal(fallbackCalls, 0);
  runner.destroy();
});
