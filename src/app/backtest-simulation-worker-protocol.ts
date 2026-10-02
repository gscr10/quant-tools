import type {
  BacktestSimulationInput,
  BacktestSimulationProgress,
  BacktestSimulationResult,
} from '../domain/backtest-simulation.ts';

/** Structured-clone-only protocol for the local Monte Carlo Worker. */
export type BacktestSimulationWorkerRequest = Readonly<{
  kind: 'run';
  requestId: number;
  input: BacktestSimulationInput;
}>;

export type BacktestSimulationWorkerResponse =
  | Readonly<{
      kind: 'progress';
      requestId: number;
      progress: BacktestSimulationProgress;
    }>
  | Readonly<{
      kind: 'complete';
      requestId: number;
      result: BacktestSimulationResult;
    }>
  | Readonly<{
      kind: 'error';
      requestId: number;
      name: string;
      message: string;
    }>;
