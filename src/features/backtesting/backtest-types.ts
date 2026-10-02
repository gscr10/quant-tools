/**
 * Application-facing data contracts for the backtest workbench.
 *
 * The feature deliberately owns these small, serialisable types instead of
 * importing Vela/PineTS objects.  A real adapter can feed a report here and a
 * fixture can use the same shape without booting a chart or a worker.
 */

import type {
  BacktestSettingValue,
  BacktestSettingsSnapshot,
} from '../../domain/ports/backtest-settings.ts';
import type { BacktestExecutionSnapshot } from '../../domain/ports/backtest-results.ts';
import type { BacktestDockPreferences } from '../../domain/ports/backtest-preferences.ts';

export type {
  BacktestSettingCondition,
  BacktestSettingSchema,
  BacktestSettingType,
  BacktestSettingValue,
  BacktestSettingsKey,
  BacktestSettingsSnapshot,
  BacktestSettingWhen,
} from '../../domain/ports/backtest-settings.ts';
export type { BacktestExecutionPhase, BacktestExecutionSnapshot } from '../../domain/ports/backtest-results.ts';

export type BacktestTab = 'performance' | 'analysis' | 'log' | 'simulation';

/**
 * Application-visible execution states.  The adapter keeps the terminal
 * states distinct instead of collapsing `no-data`, `open-only`, and
 * `no-trades` into a successful report; viewers can choose an appropriate
 * empty/status treatment while still retaining the last report metadata.
 */
export type BacktestStatus =
  | 'idle'
  | 'loading'
  | 'waiting-data'
  | 'compiling'
  | 'computing'
  | 'updating'
  | 'ready'
  | 'suspended'
  | 'no-data'
  | 'no-trades'
  | 'open-only'
  | 'partial'
  | 'error';

/** Structured error metadata; `error` remains the legacy display string. */
export interface BacktestErrorDetails {
  readonly message: string;
  readonly name?: string;
  readonly kind?: 'pine-runtime' | 'provider' | 'worker' | 'compile' | 'unknown';
  readonly method?: string;
  readonly code?: string;
  readonly provider?: string;
  readonly status?: number;
  readonly timeoutMs?: number;
  readonly url?: string;
  readonly retryable?: boolean;
}

export type TradeDirection = 'long' | 'short' | 'unknown';

export type TradeStatus = 'closed' | 'open';

export interface BacktestMetric {
  value: number | null;
  unit?: 'currency' | 'percent' | 'ratio' | 'count' | 'contracts' | 'duration';
  unavailableReason?:
    | 'not-exposed'
    | 'not-applicable'
    | 'insufficient-data'
    | 'partial-history'
    | 'partial-ledger'
    | 'division-by-zero';
}

export type BacktestMetricValue = number | null | BacktestMetric;

export interface BacktestPoint {
  x: number | string;
  y: number | null;
  label?: string;
  /** Optional population count shown by bucket-chart tooltips. */
  count?: number;
  /** Histogram interval boundaries. */
  from?: number;
  to?: number;
  /** Scatter tooltip metadata. */
  direction?: TradeDirection;
  time?: number | string | null;
  /** Summary tooltip numbering is one-based, independent of Trades Log IDs. */
  tradeNumber?: number;
  /** Reference series/bin color. */
  color?: string;
}

export interface BacktestTrade {
  id?: string | number;
  number?: string | number;
  direction?: TradeDirection;
  status?: TradeStatus;
  entryTime?: number | string | null;
  exitTime?: number | string | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  size?: number | null;
  netPnl?: number | null;
  mfe?: number | null;
  mae?: number | null;
  cumulativePnl?: number | null;
  entryBar?: number | null;
  exitBar?: number | null;
}

export interface BacktestComparison {
  all?: Record<string, BacktestMetricValue>;
  long?: Record<string, BacktestMetricValue>;
  short?: Record<string, BacktestMetricValue>;
}

export interface BacktestAnalysis {
  /** Canonical closed ledger rows used only for the reference page gate. */
  closedTradeCount?: number;
  pnlDistribution?: readonly BacktestPoint[];
  pnlMean?: number | null;
  /** The three dashed P&L histogram references. */
  pnlReferenceLines?: readonly BacktestPoint[];
  winRate?: BacktestComparison;
  /** Center value of the reference donut, expressed in percentage points. */
  winRatePercent?: number | null;
  /** Winner/Loser/Breakeven counts used by the reference donut. */
  winRateBreakdown?: readonly BacktestPoint[];
  durationPnl?: readonly BacktestPoint[];
  /** OLS Duration vs P&L trend represented by its two endpoints. */
  durationTrend?: readonly BacktestPoint[];
  duration?: Record<string, BacktestMetricValue>;
  frequency?: readonly BacktestPoint[];
  streaks?: Record<string, BacktestMetricValue>;
  comparison?: BacktestComparison;
  durationComparison?: BacktestComparison;
}

export type BacktestSimulationMethod = 'resample' | 'shuffle';
export type BacktestSimulationChartMode = 'histogram' | 'cumulative';
export type BacktestSimulationDrawdownUnit = 'currency' | 'percent';

export interface BacktestSimulationHistogramBin {
  readonly from: number;
  readonly to: number;
  readonly count: number;
}

export interface BacktestSimulationBands {
  readonly index: readonly number[];
  readonly p5: readonly number[];
  readonly p25: readonly number[];
  readonly p50: readonly number[];
  readonly p75: readonly number[];
  readonly p95: readonly number[];
}

export interface BacktestSimulationStreakMetric {
  readonly actual: number;
  readonly median: number;
  readonly p95: number;
}

export interface BacktestSimulationMetrics {
  /** Probability fields are ratios in [0, 1]; `*Percent` fields are percentage points. */
  readonly probabilityOfProfit: number;
  readonly medianOutcome: number;
  readonly p5Outcome: number;
  readonly p95Outcome: number;
  readonly p5Drawdown: number;
  readonly p95Drawdown: number;
  readonly p99Drawdown: number;
  readonly p5DrawdownPercent: number;
  readonly p95DrawdownPercent: number;
  readonly p99DrawdownPercent: number;
  readonly riskOfRuin: number;
  readonly drawdownProbability: number;
  readonly thresholdPercent: number;
  readonly p95LosingStreak: number;
}

export interface BacktestSimulationActual {
  readonly path: readonly BacktestPoint[];
  readonly finalPnl: number;
  readonly maxDrawdown: number;
  readonly maxDrawdownPercent: number;
  readonly openMaxDrawdown: number;
  readonly openMaxDrawdownPercent: number;
  readonly longestLosingStreak: number;
  readonly maxDrawdownDuration: number;
  readonly recoveryDuration: number;
}

export interface BacktestSimulationSettings {
  readonly method: BacktestSimulationMethod;
  readonly runs: number;
  readonly variationPercent: number;
  readonly preserveWinLoss: boolean;
  readonly drawdownMultiple: number;
  readonly drawdownUnit: BacktestSimulationDrawdownUnit;
  readonly outcomeChartMode: BacktestSimulationChartMode;
  readonly drawdownChartMode: BacktestSimulationChartMode;
}

export interface BacktestSimulationRunState {
  readonly status: 'pending' | 'error';
  readonly requestId: number;
  readonly completedRuns: number;
  readonly totalRuns: number;
  readonly progress: number;
  readonly settings: BacktestSimulationSettings;
  readonly message?: string;
}

export type BacktestSimulationUnavailableReason =
  | 'no-closed-trades'
  | 'invalid-initial-capital'
  | 'unsettled-ledger';

/**
 * Immutable UI projection of the reference Simulation result.  It deliberately
 * carries the already-computed bands, bins and statistics so the View never
 * reimplements Monte Carlo or risk formulas.
 */
export interface BacktestSimulation extends BacktestSimulationSettings {
  readonly populationSize: number;
  /** True when the ledger exposes any MAE; missing rows use the reference loss fallback. */
  readonly usesMae: boolean;
  readonly bands: BacktestSimulationBands;
  readonly outcomeHistogram: readonly BacktestSimulationHistogramBin[];
  readonly drawdownHistogram: readonly BacktestSimulationHistogramBin[];
  readonly metrics: BacktestSimulationMetrics;
  readonly actual: BacktestSimulationActual;
  readonly streaks: Readonly<{
    longestLosingStreak: BacktestSimulationStreakMetric;
    maxDrawdownDuration: BacktestSimulationStreakMetric;
    recoveryDuration: BacktestSimulationStreakMetric;
  }>;
}

export interface BacktestRange {
  from?: number | string | null;
  to?: number | string | null;
  label?: string;
}

/** Data coverage facts shown to consumers that need to distinguish a settled
 * report from a report built over the currently painted head of a deep load. */
export interface BacktestHistoryCoverage {
  readonly loaded?: number | null;
  readonly target?: number | null;
  readonly barsLoaded?: number | null;
  readonly oldestTime?: number | null;
  readonly actual?: BacktestRange;
  readonly effectiveStrategy?: BacktestRange;
  readonly complete: boolean;
  readonly reason?: string | null;
  readonly progress?: number | null;
}

export interface BacktestCapabilities {
  canLocateTrades?: boolean;
  canSimulate?: boolean;
  hasBenchmark?: boolean;
  hasEquityCurve?: boolean;
  /**
   * A realized-only cumulative P&L curve assembled from closed trade exits.
   * This is intentionally separate from `hasEquityCurve`: it does not imply
   * that the engine exposed an exact per-bar equity/drawdown series.
   */
  hasRealizedPnlCurve?: boolean;
}

export type BacktestCumulativePnlSource = 'exact-equity' | 'realized-ledger';

export interface BacktestReport {
  /** Stable revision/run identifier. It is opaque to the UI. */
  key?: { cellId: string; indicatorId: string };
  revision?: number;
  runId?: string;
  strategyName: string;
  /** Provider-neutral market identity shown in the report header. */
  provider?: string;
  symbol?: string;
  displaySymbol?: string;
  timeframe?: string;
  /** Original Pine source when the adapter can expose it (used by Favorites). */
  source?: string;
  status?: BacktestStatus;
  range?: BacktestRange;
  history?: BacktestHistoryCoverage;
  currency?: string;
  /** IANA timezone used for calendar/day buckets when exposed by the adapter. */
  timezone?: string;
  /** Inputs/Properties schema and the effective values used by the run. */
  settings?: BacktestSettingsSnapshot;
  /** Last bounded engine position; a complete equity curve remains capability-gated. */
  execution?: BacktestExecutionSnapshot;
  favorite?: boolean;
  error?: string;
  errorDetails?: BacktestErrorDetails;
  metrics?: Record<string, BacktestMetricValue>;
  summary?: Record<string, BacktestMetricValue>;
  equity?: readonly BacktestPoint[];
  cumulativePnl?: readonly BacktestPoint[];
  /** Provenance for the cumulative P&L chart; absent when no curve exists. */
  cumulativePnlSource?: BacktestCumulativePnlSource;
  /** Explicit data-quality note shown when a usable report is not historical-final. */
  simulationWarning?: string;
  netDailyPnl?: readonly BacktestPoint[];
  weekdayPerformance?: readonly BacktestPoint[];
  comparison?: BacktestComparison;
  trades?: readonly BacktestTrade[];
  analysis?: BacktestAnalysis;
  simulation?: BacktestSimulation;
  /** Present only while an off-main-thread Simulation is pending or failed. */
  simulationRun?: BacktestSimulationRunState;
  simulationUnavailableReason?: BacktestSimulationUnavailableReason;
  capabilities?: BacktestCapabilities;
}

export interface BacktestSimulationChange {
  method?: BacktestSimulationMethod;
  runs?: number;
  variationPercent?: number;
  preserveWinLoss?: boolean;
  drawdownMultiple?: number;
  drawdownUnit?: BacktestSimulationDrawdownUnit;
  outcomeChartMode?: BacktestSimulationChartMode;
  drawdownChartMode?: BacktestSimulationChartMode;
}

export interface BacktestWorkbenchPort {
  /** Return the latest immutable report. A null report means no strategy. */
  getSnapshot?: () => BacktestReport | null | undefined;
  /** Notify the workbench when a new report/revision is available. */
  subscribe?: (listener: (report: BacktestReport | null) => void) => void | (() => void);
  onTabChange?: (tab: BacktestTab) => void;
  onOpenViewer?: () => void;
  onCloseViewer?: () => void;
  /** Return the persisted state; `false` cancels the UI projection. */
  onToggleFavorite?: (report: BacktestReport) => boolean | void;
  onResize?: (height: number) => void;
  /** Persist UI-only Dock state; never called for report/result data. */
  onDockPreferencesChange?: (preferences: BacktestDockPreferences) => void;
  onTradeLocate?: (trade: BacktestTrade, side: 'entry' | 'exit') => void;
  onSimulationChange?: (change: BacktestSimulationChange) => void;
  onRetry?: () => void;
  /** Read and commit the selected strategy's Inputs/Properties settings. */
  settings?: BacktestSettingsPort;
}

export interface BacktestSettingsPort {
  read: (report: BacktestReport) => BacktestSettingsSnapshot | null;
  apply: (
    report: BacktestReport,
    inputs: Record<string, BacktestSettingValue>,
    props: Record<string, BacktestSettingValue>,
  ) => boolean | Promise<boolean>;
}

export interface BacktestWorkbenchOptions extends BacktestWorkbenchPort {
  /** Optional fixture-only snapshot used before an adapter is connected. */
  initialReport?: BacktestReport | null;
  defaultDockHeight?: number;
  minDockHeight?: number;
  maxDockHeight?: number;
  /** Restored UI-only state; malformed values are ignored by the repository. */
  dockPreferences?: BacktestDockPreferences | null;
}

export interface BacktestViewerCallbacks {
  onClose: () => void;
  onTabChange?: (tab: BacktestTab) => void;
  /** Return the persisted state; `false` cancels the UI projection. */
  onToggleFavorite?: (report: BacktestReport) => boolean | void;
  onTradeLocate?: (trade: BacktestTrade, side: 'entry' | 'exit') => void;
  onSimulationChange?: (change: BacktestSimulationChange) => void;
  onRetry?: () => void;
}
