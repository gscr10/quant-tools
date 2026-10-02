import {
  simulateBacktestReferenceControlled,
} from '../domain/backtest-simulation.ts';
import type {
  BacktestSimulationWorkerRequest,
  BacktestSimulationWorkerResponse,
} from '../app/backtest-simulation-worker-protocol.ts';

interface SimulationWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: { readonly data: BacktestSimulationWorkerRequest }) => void,
  ): void;
  postMessage(message: BacktestSimulationWorkerResponse): void;
}

// Keep this entry independent from Window-only globals so it can be bundled
// as a dedicated module Worker by Vite and inspected in contract tests.
const workerScope = globalThis as unknown as SimulationWorkerScope;

workerScope.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.kind !== 'run') return;

  try {
    const result = simulateBacktestReferenceControlled(message.input, {
      onProgress: (progress) => workerScope.postMessage({
        kind: 'progress',
        requestId: message.requestId,
        progress,
      }),
    });
    workerScope.postMessage({
      kind: 'complete',
      requestId: message.requestId,
      result,
    });
  } catch (error) {
    workerScope.postMessage({
      kind: 'error',
      requestId: message.requestId,
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
