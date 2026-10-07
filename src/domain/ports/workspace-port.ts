import type {
  NativeIndicatorIdentity,
  WorkspaceIndicatorItem,
} from '../indicators.ts';

/** Transient chart annotation; never a saved user indicator. */
export const BACKTEST_EXECUTION_HIGHLIGHT_TYPE = 'quant-backtest-execution-highlight';

export interface BacktestExecutionFocus {
  readonly cellId: string;
  readonly indicatorId: string;
  readonly barIndex?: number | null;
  readonly time: number;
  readonly price?: number | null;
  readonly side: 'entry' | 'exit';
  readonly symbol?: string;
  readonly timeframe?: string;
  readonly tradeNumber?: string | number;
  readonly direction?: 'long' | 'short' | 'unknown';
}

export interface WorkspacePort {
  readonly root: HTMLElement;
  getState(): unknown;
  applyState(state: unknown): void;
  openPanel(id: string): void;
  toast(message: string, kind?: 'info' | 'success' | 'error'): void;
  downloadScreenshot(): void;
  closeChartDialogs(): void;
  addScriptIndicator(name: string, script: string, language?: string): void;
  addNativeIndicator(nativeType: string): void;
  getOnChartIndicators(): WorkspaceIndicatorItem[];
  getBuiltInIndicators(): WorkspaceIndicatorItem[];
  resolveScriptIndicatorName(id: string, title: string, source: string): string;
  resolveNativeIndicator(id: string, title: string): NativeIndicatorIdentity | undefined;
  /**
   * Focus a backtest execution through the public chart seam.  The adapter is
   * responsible for activation, viewport framing, external crosshair and
   * focus restoration; feature code never reaches into Vela internals.
   */
  focusBacktestExecution(input: BacktestExecutionFocus): boolean;
}
