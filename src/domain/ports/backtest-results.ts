/**
 * Bounded execution metadata exposed by a scripting engine.
 *
 * This is deliberately separate from the unbounded trade/equity series.  A
 * report can always identify the last computed bar without pretending that a
 * complete per-bar equity curve, broker order stream, or fill stream exists.
 */
export type BacktestExecutionPhase = 'idle' | 'computing' | 'streaming';

export interface BacktestExecutionSnapshot {
  /** Last computed bar index in the engine's input history, when available. */
  readonly barIndex: number | null;
  /** Open time of the last ScriptRun bar, when available. */
  readonly time: number | null;
  readonly phase: BacktestExecutionPhase | null;
  /** Named plots which can be requested from the adapter's series reader. */
  readonly seriesKeys: readonly string[];
  /** Actual broker precision and explicit Bar Magnifier fallback metadata. */
  readonly precision?: {
    readonly requested: boolean;
    readonly applied: boolean;
    readonly requestedPrecision: 'chart-ohlc' | 'lower-timeframe' | 'tick';
    readonly appliedPrecision: 'chart-ohlc' | 'lower-timeframe' | 'tick';
    readonly lowerTimeframe?: string;
    readonly parentBars: number;
    readonly lowerBars: number;
    readonly coveredParentBars: number;
    readonly coverage: number;
    readonly fallbackReason?: string;
  };
}
