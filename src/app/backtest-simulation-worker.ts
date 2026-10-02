import {
  BacktestSimulationCancelledError,
  simulateBacktestReferenceControlled,
  type BacktestSimulationExecutionOptions,
  type BacktestSimulationInput,
  type BacktestSimulationProgress,
  type BacktestSimulationResult,
} from '../domain/backtest-simulation.ts';
import type {
  BacktestSimulationWorkerRequest,
  BacktestSimulationWorkerResponse,
} from './backtest-simulation-worker-protocol.ts';

export interface BacktestSimulationWorkerLike {
  postMessage(message: BacktestSimulationWorkerRequest): void;
  addEventListener(
    type: 'message',
    listener: (event: { readonly data: BacktestSimulationWorkerResponse }) => void,
  ): void;
  addEventListener(
    type: 'error',
    listener: (event: { readonly message?: string; readonly error?: unknown }) => void,
  ): void;
  terminate(): void;
}

export interface BacktestSimulationTaskOptions {
  readonly onProgress?: (progress: BacktestSimulationProgress) => void;
  /** Called once when Worker creation/execution fails and the local fallback takes over. */
  readonly onFallback?: (error: unknown) => void;
}

export type BacktestSimulationCancellationReason = 'cancelled' | 'superseded' | 'destroyed';

export class BacktestSimulationTaskCancelledError extends BacktestSimulationCancelledError {
  readonly reason: BacktestSimulationCancellationReason;

  constructor(
    completedRuns: number,
    totalRuns: number,
    reason: BacktestSimulationCancellationReason,
  ) {
    super(completedRuns, totalRuns);
    this.name = 'BacktestSimulationTaskCancelledError';
    this.reason = reason;
  }
}

export interface BacktestSimulationTask {
  readonly requestId: number;
  readonly promise: Promise<BacktestSimulationResult>;
  cancel(): void;
}

export interface BacktestSimulationTaskRunner {
  run(
    input: BacktestSimulationInput,
    options?: BacktestSimulationTaskOptions,
  ): BacktestSimulationTask;
  destroy?(): void;
}

export interface BacktestSimulationWorkerRunnerOptions {
  readonly createWorker?: () => BacktestSimulationWorkerLike;
  readonly fallbackRunner?: (
    input: BacktestSimulationInput,
    options?: BacktestSimulationExecutionOptions,
  ) => BacktestSimulationResult;
}

interface ActiveTask {
  readonly requestId: number;
  readonly input: BacktestSimulationInput;
  readonly options: BacktestSimulationTaskOptions;
  readonly signal: { aborted: boolean };
  readonly resolve: (result: BacktestSimulationResult) => void;
  readonly reject: (error: unknown) => void;
  worker: BacktestSimulationWorkerLike | null;
  completedRuns: number;
  settled: boolean;
  fallbackStarted: boolean;
}

function createBrowserWorker(): BacktestSimulationWorkerLike {
  return new Worker(
    new URL('../workers/backtest-simulation.worker.ts', import.meta.url),
    { type: 'module', name: 'quant-backtest-simulation' },
  ) as unknown as BacktestSimulationWorkerLike;
}

function freezeNumbers(values: readonly number[]): readonly number[] {
  return Object.freeze([...values]);
}

/** Restore the domain's immutable result contract after structured cloning. */
function freezeTransferredResult(result: BacktestSimulationResult): BacktestSimulationResult {
  return Object.freeze({
    ...result,
    bands: Object.freeze({
      index: freezeNumbers(result.bands.index),
      p5: freezeNumbers(result.bands.p5),
      p25: freezeNumbers(result.bands.p25),
      p50: freezeNumbers(result.bands.p50),
      p75: freezeNumbers(result.bands.p75),
      p95: freezeNumbers(result.bands.p95),
    }),
    finals: freezeNumbers(result.finals),
    maxDrawdowns: freezeNumbers(result.maxDrawdowns),
    maxDrawdownsAbs: freezeNumbers(result.maxDrawdownsAbs),
    openMaxDrawdowns: freezeNumbers(result.openMaxDrawdowns),
    openMaxDrawdownsAbs: freezeNumbers(result.openMaxDrawdownsAbs),
    streaks: Object.freeze({
      longestLosingStreak: freezeNumbers(result.streaks.longestLosingStreak),
      maxDrawdownDuration: freezeNumbers(result.streaks.maxDrawdownDuration),
      recoveryDuration: freezeNumbers(result.streaks.recoveryDuration),
    }),
  });
}

/**
 * Owns one local Simulation Worker. Starting another task atomically cancels
 * the prior task, which prevents stale results from replacing newer settings.
 */
export class BacktestSimulationWorkerRunner implements BacktestSimulationTaskRunner {
  private readonly createWorker: () => BacktestSimulationWorkerLike;
  private readonly fallbackRunner: NonNullable<BacktestSimulationWorkerRunnerOptions['fallbackRunner']>;
  private sequence = 0;
  private active: ActiveTask | null = null;
  private destroyed = false;

  constructor(options: BacktestSimulationWorkerRunnerOptions = {}) {
    this.createWorker = options.createWorker ?? createBrowserWorker;
    this.fallbackRunner = options.fallbackRunner ?? simulateBacktestReferenceControlled;
  }

  run(
    input: BacktestSimulationInput,
    options: BacktestSimulationTaskOptions = {},
  ): BacktestSimulationTask {
    if (this.destroyed) throw new Error('BacktestSimulationWorkerRunner has been destroyed');
    this.cancelActive('superseded');

    const requestId = ++this.sequence;
    let resolvePromise!: (result: BacktestSimulationResult) => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<BacktestSimulationResult>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const active: ActiveTask = {
      requestId,
      input,
      options,
      signal: { aborted: false },
      resolve: resolvePromise,
      reject: rejectPromise,
      worker: null,
      completedRuns: 0,
      settled: false,
      fallbackStarted: false,
    };
    this.active = active;

    try {
      const worker = this.createWorker();
      active.worker = worker;
      worker.addEventListener('message', (event) => this.receive(active, event.data));
      worker.addEventListener('error', (event) => {
        this.startFallback(active, event.error ?? new Error(event.message || 'Simulation Worker failed'));
      });
      worker.postMessage({ kind: 'run', requestId, input });
    } catch (error) {
      this.startFallback(active, error);
    }

    return Object.freeze({
      requestId,
      promise,
      cancel: () => this.cancel(active, 'cancelled'),
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelActive('destroyed');
  }

  private receive(active: ActiveTask, message: BacktestSimulationWorkerResponse): void {
    if (!this.isCurrent(active) || message.requestId !== active.requestId) return;
    if (message.kind === 'progress') {
      active.completedRuns = message.progress.completedRuns;
      try {
        active.options.onProgress?.(Object.freeze({ ...message.progress }));
      } catch (error) {
        this.fail(active, error);
      }
      return;
    }
    if (message.kind === 'error') {
      const error = new Error(message.message);
      error.name = message.name;
      this.startFallback(active, error);
      return;
    }
    this.complete(active, freezeTransferredResult(message.result));
  }

  private startFallback(active: ActiveTask, workerError: unknown): void {
    if (!this.isCurrent(active) || active.fallbackStarted) return;
    active.fallbackStarted = true;
    active.worker?.terminate();
    active.worker = null;
    try {
      active.options.onFallback?.(workerError);
    } catch {
      // Diagnostics must not turn a recoverable Worker failure into a UI failure.
    }
    queueMicrotask(() => {
      if (!this.isCurrent(active)) return;
      try {
        const result = this.fallbackRunner(active.input, {
          signal: active.signal,
          onProgress: (progress) => {
            active.completedRuns = progress.completedRuns;
            active.options.onProgress?.(progress);
          },
        });
        this.complete(active, result);
      } catch (error) {
        this.fail(active, error);
      }
    });
  }

  private complete(active: ActiveTask, result: BacktestSimulationResult): void {
    if (!this.isCurrent(active)) return;
    active.settled = true;
    active.worker?.terminate();
    active.worker = null;
    this.active = null;
    active.resolve(result);
  }

  private fail(active: ActiveTask, error: unknown): void {
    if (!this.isCurrent(active)) return;
    active.settled = true;
    active.worker?.terminate();
    active.worker = null;
    this.active = null;
    active.reject(error);
  }

  private cancelActive(reason: BacktestSimulationCancellationReason): void {
    if (this.active) this.cancel(this.active, reason);
  }

  private cancel(active: ActiveTask, reason: BacktestSimulationCancellationReason): void {
    if (!this.isCurrent(active)) return;
    active.signal.aborted = true;
    active.settled = true;
    active.worker?.terminate();
    active.worker = null;
    this.active = null;
    active.reject(new BacktestSimulationTaskCancelledError(
      active.completedRuns,
      active.input.runs,
      reason,
    ));
  }

  private isCurrent(active: ActiveTask): boolean {
    return !active.settled && this.active === active;
  }
}
