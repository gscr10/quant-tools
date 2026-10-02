import {
  calculateAnalysisMetrics,
  calculatePerformanceMetrics,
  calculateSummaryMetrics,
  calendarDateKey,
} from '../domain/backtest-metrics.ts';
import {
  BACKTEST_SIMULATION_DEFAULT_SEED,
  buildSimulationHistogram,
  drawdownProbability,
  linearPercentile,
  ruinProbability,
  simulateBacktestReference,
  walkBacktestEquity,
  type BacktestEquityWalk,
  type BacktestSimulationInput,
  type BacktestSimulationResult,
} from '../domain/backtest-simulation.ts';
import {
  calculateTradeAnalysis,
  TRADE_ANALYSIS_COMPARISON_KEYS,
  TRADE_ANALYSIS_DURATION_KEYS,
  type TradeAnalysisResult,
} from '../domain/trade-analysis.ts';
import {
  backtestKeyId,
  createBacktestReport,
  tradeNetPnl,
  type BacktestError,
  type BacktestContext,
  type HistoryCoverage,
  type BacktestReport as DomainBacktestReport,
  type BacktestStatus as DomainBacktestStatus,
  type Trade,
} from '../domain/backtesting.ts';
import type {
  BacktestSettingSchema,
  BacktestSettingsSnapshot,
  BacktestSettingValue,
} from '../domain/ports/backtest-settings.ts';
import type { BacktestExecutionSnapshot } from '../domain/ports/backtest-results.ts';
import type {
  BacktestComparison,
  BacktestCumulativePnlSource,
  BacktestPoint,
  BacktestReport as UiBacktestReport,
  BacktestMetricValue,
  BacktestSimulation,
  BacktestSimulationChange,
  BacktestSimulationRunState,
  BacktestSimulationSettings,
  BacktestStatus as UiBacktestStatus,
  BacktestTrade,
  BacktestErrorDetails,
} from '../features/backtesting/backtest-types.ts';
import {
  BacktestStore,
  type BacktestStoreEntry,
  type BacktestStoreOptions,
} from '../features/backtesting/backtest-store.ts';
import { backtestAdapterErrorOf } from '../integrations/vela/backtest-adapter-types.ts';
import type {
  BacktestAdapterEvent,
  BacktestAdapterKey,
  BacktestAdapterParameterState,
  BacktestAdapterSnapshot,
  BacktestAdapterStatus,
  BacktestAdapterError,
} from '../integrations/vela/backtest-adapter-types.ts';
import {
  BacktestSimulationTaskCancelledError,
  BacktestSimulationWorkerRunner,
  type BacktestSimulationTask,
  type BacktestSimulationTaskRunner,
} from './backtest-simulation-worker.ts';

/**
 * Optional report fields emitted by the local Vela-PineTS bridge after a
 * settled run.  They intentionally remain structural here: the base Vela
 * package is still the registry dependency, while the local bridge may expose
 * richer fields without making every engine implement them.
 */
type AdapterStrategyState = NonNullable<
  NonNullable<BacktestAdapterSnapshot['context']>['strategy']
>;

type ReportableStrategyState = AdapterStrategyState & {
  readonly accountCurrency?: string;
  readonly maxContractsHeldAll?: number;
  readonly maxContractsHeldLong?: number;
  readonly maxContractsHeldShort?: number;
  readonly cagr?: number;
  readonly sharpe?: number;
  readonly sortino?: number;
  readonly maxDrawdownPercent?: number;
  readonly maxRunupPercent?: number;
  readonly buyAndHoldPnl?: number;
  readonly buyAndHoldPercent?: number;
  readonly strategyOutperformance?: number;
  /** Optional reference aggregate fields; never substitute ledger means. */
  readonly averageWinningTrade?: number;
  readonly averageLosingTrade?: number;
  readonly averageTrade?: number;
};

function reportableStrategy(value: AdapterStrategyState | undefined): ReportableStrategyState | undefined {
  return value as ReportableStrategyState | undefined;
}

/** A source keeps Vela behind an application-facing event boundary. */
export interface BacktestResultsSource {
  bootstrap?(): Promise<void> | void;
  retry?(key?: BacktestAdapterKey): Promise<void> | void;
  subscribe(listener: (event: BacktestAdapterEvent) => void): void | (() => void);
  listSnapshots?(): readonly BacktestAdapterSnapshot[];
  /** Optional because the controller may borrow a source owned by createApp. */
  destroy?(): void;
}

export interface BacktestMarketIdentity {
  readonly provider?: string;
  readonly symbol?: string;
  readonly displaySymbol?: string;
  readonly timeframe?: string;
  readonly timezone?: string;
  readonly currency?: string;
}

export interface BacktestControllerOptions {
  readonly getMarket?: (key: BacktestAdapterKey) => BacktestMarketIdentity | undefined;
  readonly isFavorite?: (key: BacktestAdapterKey) => boolean;
  readonly onDiagnostic?: (message: string, error?: unknown) => void;
  /**
   * Deterministic Simulation runner injection used by contract tests and by a
  * future Worker adapter. Production callers normally leave this unset.
  */
  readonly simulationRunner?: typeof simulateBacktestReference;
  /** Inject a deterministic async runner in tests; `null` forces sync-only execution. */
  readonly simulationWorkerRunner?: BacktestSimulationTaskRunner | null;
  /** Explicit runs at or above this count move off the main thread. */
  readonly simulationWorkerThreshold?: number;
  /** Defaults to true only for the browser Worker created by this controller. */
  readonly ownsSimulationWorkerRunner?: boolean;
  /**
   * A source is borrowed by default. Set this only when the controller created
   * the adapter and is its lifecycle owner; otherwise `destroy()` would tear
   * down a source still used by Workspace or another feature.
   */
  readonly ownsSource?: boolean;
}

export type BacktestReportListener = (report: UiBacktestReport | null) => void;

export const BACKTEST_SIMULATION_CACHE_LIMIT_PER_REPORT = 8;
export const BACKTEST_SIMULATION_WORKER_THRESHOLD = 2_000;

type SimulationRunner = typeof simulateBacktestReference;

interface SimulationCoreResult {
  readonly method: NonNullable<BacktestSimulationChange['method']>;
  readonly runs: number;
  readonly variationPercent: number;
  readonly preserveWinLoss: boolean;
  readonly populationSize: number;
  readonly usesMae: boolean;
  readonly result: BacktestSimulationResult;
  readonly actualWalk: BacktestEquityWalk;
  readonly actual: BacktestSimulation['actual'];
  readonly streaks: BacktestSimulation['streaks'];
  readonly outcomeHistogram: BacktestSimulation['outcomeHistogram'];
  readonly drawdownHistogramCurrency: BacktestSimulation['drawdownHistogram'];
  readonly drawdownHistogramPercent: BacktestSimulation['drawdownHistogram'];
  readonly drawdownRatios: readonly number[];
  readonly drawdownAmounts: readonly number[];
  readonly metrics: Omit<
    BacktestSimulation['metrics'],
    'drawdownProbability' | 'thresholdPercent'
  >;
}

interface SimulationPopulationCache {
  readonly initialCapital: number;
  readonly deltas: readonly number[];
  readonly mae?: readonly number[];
  readonly cores: Map<string, SimulationCoreResult>;
}

/**
 * One bounded cache per strategy population.  Vela publishes a new immutable
 * domain report for every live revision, so keying the cache by report object
 * would rerun the full Monte Carlo loop on every forming-bar update even when
 * the closed-trade population is byte-for-byte unchanged.
 */
type SimulationCache = Map<string, SimulationPopulationCache>;

interface SimulationRuntime {
  readonly runner: SimulationRunner;
  readonly cache?: SimulationCache;
}

interface PendingSimulation {
  readonly key: BacktestAdapterKey;
  domain: DomainBacktestReport;
  epoch: number;
  revision: number;
  readonly task: BacktestSimulationTask;
  readonly input: BacktestSimulationInput;
  settings: BacktestSimulationSettings;
  publishedCompletedRuns: number;
  publishedFraction: number;
}

/**
 * Application-owned report store/controller.
 *
 * The controller is deliberately independent from DOM and Vela objects.  It
 * owns one immutable UI report per `{cellId, indicatorId}`, selects the report
 * for the active chart, and makes adapter failures local to the backtest
 * feature.  A later multi-strategy viewer can consume `listReports()` without
 * changing the adapter contract.
 */
export class BacktestController {
  private readonly latestSettingsIdentity = new Map<string, { runId: string | null; epoch: number; revision: number }>();
  private readonly invalidSettings = new Map<string, {
    baseline: { runId: string | null; epoch: number; revision: number };
    expected?: { inputs: Record<string, BacktestSettingValue>; props: Record<string, BacktestSettingValue> };
    recoveryRunId?: string;
  }>();
  private readonly store: BacktestStore;
  private readonly source: BacktestResultsSource;
  private readonly options: BacktestControllerOptions;
  private sourceUnsubscribe: (() => void) | null = null;
  private sourceSubscribed = false;
  private destroyed = false;
  private started = false;
  private startPromise: Promise<void> | null = null;
  private readonly simulationCache: SimulationCache = new Map();
  private readonly simulationSettings = new Map<string, BacktestSimulationChange>();
  private readonly simulationWorker: BacktestSimulationTaskRunner | null;
  private readonly ownsSimulationWorker: boolean;
  private readonly simulationWorkerThreshold: number;
  private pendingSimulation: PendingSimulation | null = null;

  constructor(
    source: BacktestResultsSource,
    options: BacktestControllerOptions = {},
  ) {
    this.source = source;
    this.options = options;
    const canUseBrowserWorker = typeof Worker === 'function';
    this.simulationWorker = options.simulationWorkerRunner === undefined
      ? (canUseBrowserWorker ? new BacktestSimulationWorkerRunner() : null)
      : options.simulationWorkerRunner;
    this.ownsSimulationWorker = options.ownsSimulationWorkerRunner
      ?? options.simulationWorkerRunner === undefined;
    const requestedThreshold = options.simulationWorkerThreshold
      ?? BACKTEST_SIMULATION_WORKER_THRESHOLD;
    this.simulationWorkerThreshold = Number.isFinite(requestedThreshold)
      ? Math.max(1, Math.round(requestedThreshold))
      : BACKTEST_SIMULATION_WORKER_THRESHOLD;
    const storeOptions: BacktestStoreOptions = { onDiagnostic: options.onDiagnostic };
    this.store = new BacktestStore(storeOptions);
  }

  /** Exposes selectors for composition roots without exposing Vela. */
  get reportStore(): BacktestStore {
    return this.store;
  }

  /** A failed setter may persist parameters without executing them. Keep every
   * report/selector unavailable until an explicitly reapplied new run settles. */
  invalidateSettings(key: BacktestAdapterKey): void {
    const id = keyOf(key);
    const entry = this.store.get(key);
    const baseline = this.latestSettingsIdentity.get(id)
      ?? { runId: null, epoch: entry?.epoch ?? 0, revision: entry?.revision ?? 0 };
    this.invalidSettings.set(id, { baseline });
    this.cancelPendingSimulation(key);
    this.simulationCache.delete(id);
    this.publishSettingsInvalid(key, baseline.epoch, baseline.revision);
  }

  settingsNeedRecovery(key: BacktestAdapterKey): boolean {
    return this.invalidSettings.has(keyOf(key));
  }

  /** Called BEFORE the setters. Matching host parameters alone are insufficient:
   * an identity-distinct inputs run must subsequently produce a complete ledger. */
  beginSettingsRecovery(key: BacktestAdapterKey, inputs: Record<string, BacktestSettingValue>, props: Record<string, BacktestSettingValue>): void {
    const id = keyOf(key);
    const failed = this.invalidSettings.get(id);
    if (!failed) return;
    this.invalidSettings.set(id, {
      baseline: this.latestSettingsIdentity.get(id) ?? failed.baseline,
      expected: { inputs: { ...inputs }, props: { ...props } },
    });
  }

  private publishSettingsInvalid(key: BacktestAdapterKey, epoch: number, revision: number): void {
    const prior = this.store.get(key);
    const message = 'Settings may be partially applied. This report is out of date. Open strategy settings and apply them successfully to recalculate.';
    const domain = createBacktestReport({ key, revision, runId: prior?.domain.runId ?? `${keyOf(key)}:${revision}`,
      title: prior?.report.strategyName ?? 'Backtest', status: 'error', finality: 'unknown',
      error: { message }, settings: prior?.domain.settings });
    const report = freezeUiReport({ ...this.errorReport(key, message, revision),
      strategyName: prior?.report.strategyName ?? 'Backtest' });
    this.store.upsert(key, domain, report, epoch, revision);
  }

  /** Subscribe before bootstrap so a restored strategy cannot be missed. */
  async start(): Promise<void> {
    if (this.destroyed) return;
    if (this.started) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  /** Retry the selected report, independently of idempotent application start. */
  async retryActive(): Promise<void> {
    if (this.destroyed) return;
    if (!this.started) return this.start();
    try {
      await this.source.retry?.(this.getSnapshot()?.key);
    } catch (error) {
      this.diagnose('backtest retry failed', error);
    }
  }

  private async startInternal(): Promise<void> {
    try {
      if (!this.sourceSubscribed) {
        const cleanup = this.source.subscribe((event) => this.handleEvent(event));
        this.sourceSubscribed = true;
        this.sourceUnsubscribe = typeof cleanup === 'function' ? cleanup : null;
      }
      await this.source.bootstrap?.();
      if (this.destroyed) return;
      for (const snapshot of this.source.listSnapshots?.() ?? []) this.acceptSnapshot(snapshot);
      this.store.ensureActive();
      this.resumeActiveSimulation();
      this.started = true;
    } catch (error) {
      this.diagnose('backtest source bootstrap failed', error);
      this.started = false;
      // A failed adapter must not reject createApp's startup. The workspace
      // remains usable and the feature can receive a later retry/event.
    }
  }

  subscribe(listener: BacktestReportListener): () => void {
    if (this.destroyed) return () => undefined;
    return this.store.subscribeActive(listener);
  }

  /** Subscribe to one stable cell+indicator key, independent of active-cell UI. */
  subscribeKey(key: BacktestAdapterKey, listener: BacktestReportListener): () => void {
    if (this.destroyed) return () => undefined;
    const matches = (candidate: BacktestAdapterKey | undefined): boolean =>
      candidate?.cellId === key.cellId && candidate?.indicatorId === key.indicatorId;
    const unsubscribe = this.store.subscribe((event) => {
      if (event.type === 'upsert' && matches(event.entry.key)) listener(event.entry.report);
      else if (event.type === 'remove' && matches(event.key)) listener(null);
    });
    try {
      listener(this.store.getReport(key));
    } catch (error) {
      this.diagnose('backtest keyed report listener failed', error);
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      unsubscribe();
    };
  }

  getActiveReport(): UiBacktestReport | null {
    return this.store.activeReport();
  }

  getSnapshot(): UiBacktestReport | null {
    return this.getActiveReport();
  }

  listReports(): readonly UiBacktestReport[] {
    return this.store.listReports();
  }

  getReport(key: BacktestAdapterKey): UiBacktestReport | null {
    return this.store.getReport(key);
  }

  /** Select the first live strategy in a chart cell, preserving revision order. */
  setActiveCell(cellId: string): void {
    this.store.setActiveCell(cellId);
    this.resumeActiveSimulation();
  }

  setActive(key: BacktestAdapterKey | null): void {
    this.store.setActive(key);
    this.resumeActiveSimulation();
  }

  /** Update only the UI favorite projection; never re-runs the strategy. */
  setFavorite(key: BacktestAdapterKey, favorite: boolean): UiBacktestReport | null {
    if (this.destroyed) return null;
    const entry = this.store.get(key);
    if (!entry) return null;
    const report = freezeUiReport({ ...entry.report, favorite });
    // A report may be an error overlay whose UI revision is newer than the
    // domain snapshot that produced it. Preserve the Store's accepted
    // revision so a projection update is not rejected as stale.
    this.store.upsert(key, entry.domain, report, entry.epoch, entry.revision);
    return report;
  }

  /** Re-select a report after strategy removal or a workspace layout change. */
  refreshSelection(): void {
    this.store.ensureActive();
    this.resumeActiveSimulation();
  }

  /** Recompute Simulation only after an explicit UI change. */
  updateSimulation(change: BacktestSimulationChange): UiBacktestReport | null {
    if (this.destroyed) return null;
    const key = this.store.active;
    if (!key) return null;
    const entry = this.store.get(key);
    // Simulation must be derived from a settled domain report, not merely from
    // the current UI projection.  Error overlays and other projections can
    // temporarily change `report.capabilities`; conversely, a forged/stale UI
    // projection must not bypass finality and create a simulation over a ledger
    // that can still change underneath it.
    if (!entry || !simulationEligible(entry)) return null;
    const pending = this.pendingSimulation;
    const samePendingReport = pending
      && keyOf(pending.key) === keyOf(key)
      && pending.domain === entry.domain;
    const settings = resolveSimulationSettings(
      samePendingReport ? pending.settings : entry.report.simulation,
      change,
    );
    const engineSettings = normalizeSimulationEngineSettings(settings);

    // Projection-only changes while a Worker is running update the pending
    // request in place. They must not terminate/restart an identical Monte
    // Carlo core merely to switch units, threshold, or chart presentation.
    if (samePendingReport
      && simulationCoreKey(engineSettings)
        === simulationCoreKey(normalizeSimulationEngineSettings(pending.settings))) {
      pending.settings = settings;
      this.simulationSettings.set(keyOf(key), settings);
      const previous = entry.report.simulation;
      const simulation = previous
        ? toUiSimulation(entry.domain, {
            ...simulationSettingsOf(previous),
            drawdownMultiple: settings.drawdownMultiple,
            drawdownUnit: settings.drawdownUnit,
            outcomeChartMode: settings.outcomeChartMode,
            drawdownChartMode: settings.drawdownChartMode,
          }, this.simulationRuntime())
        : previous;
      const run = entry.report.simulationRun;
      const report = freezeUiReport({
        ...entry.report,
        simulation,
        simulationRun: pendingRunState(
          pending,
          run?.completedRuns ?? 0,
          run?.progress ?? 0,
        ),
      });
      this.store.upsert(key, entry.domain, report, entry.epoch, entry.revision);
      return report;
    }

    const prepared = prepareSimulationInput(entry.domain, engineSettings);
    if (!prepared) return null;
    const shouldUseWorker = this.simulationNeedsWorker(
      entry.domain,
      engineSettings,
      prepared.input,
    );

    if (shouldUseWorker) {
      return this.startSimulationTask(entry, settings, prepared.input);
    }

    this.cancelPendingSimulation();
    const simulation = toUiSimulation(entry.domain, settings, this.simulationRuntime());
    if (!simulation) return null;
    this.simulationSettings.set(keyOf(key), simulationSettingsOf(simulation));
    const report = freezeUiReport({
      ...entry.report,
      simulation,
      simulationRun: undefined,
      // A ready projection restored after an error may retain the overlay's
      // `canSimulate: false`.  A successful recomputation is authoritative and
      // repairs that derived capability for subsequent UI consumers.
      capabilities: { ...entry.report.capabilities, canSimulate: true },
    });
    // Keep the current Store revision for the same reason as favorites: a
    // simulation projection must not roll an error/stale overlay backwards.
    this.store.upsert(key, entry.domain, report, entry.epoch, entry.revision);
    return report;
  }

  private simulationNeedsWorker(
    domain: DomainBacktestReport,
    settings: ReturnType<typeof normalizeSimulationEngineSettings>,
    input: BacktestSimulationInput,
  ): boolean {
    if (this.simulationWorker === null
      || this.options.simulationRunner !== undefined
      || settings.runs < this.simulationWorkerThreshold) return false;
    const populationCache = simulationPopulationCache(
      domain,
      input.initialCapital,
      input.deltas,
      input.excursions?.mae,
      this.simulationCache,
    );
    return cachedSimulationCore(populationCache?.cores, settings) === undefined;
  }

  private resumeActiveSimulation(): void {
    if (this.destroyed) return;
    const key = this.store.active;
    if (!key) return;
    const settings = this.simulationSettings.get(keyOf(key));
    if (!settings) return;
    this.updateSimulation(settings);
  }

  private startSimulationTask(
    entry: BacktestStoreEntry,
    settings: BacktestSimulationSettings,
    input: BacktestSimulationInput,
  ): UiBacktestReport | null {
    const runner = this.simulationWorker;
    if (!runner) return null;
    this.cancelPendingSimulation();

    let pending: PendingSimulation | null = null;
    let task: BacktestSimulationTask;
    try {
      task = runner.run(input, {
        onProgress: (progress) => {
          if (!pending || this.pendingSimulation !== pending) return;
          const shouldPublish = progress.fraction >= 1
            || progress.fraction - pending.publishedFraction >= 0.05;
          if (!shouldPublish) return;
          pending.publishedCompletedRuns = progress.completedRuns;
          pending.publishedFraction = progress.fraction;
          this.publishSimulationProgress(pending, progress.completedRuns, progress.fraction);
        },
        onFallback: (error) => this.diagnose(
          'backtest Simulation Worker failed; using synchronous fallback',
          error,
        ),
      });
    } catch (error) {
      this.diagnose('backtest Simulation Worker could not start', error);
      const simulation = toUiSimulation(entry.domain, settings, this.simulationRuntime());
      if (!simulation) return null;
      this.simulationSettings.set(keyOf(entry.key), simulationSettingsOf(simulation));
      const report = freezeUiReport({
        ...entry.report,
        simulation,
        simulationRun: undefined,
      });
      this.store.upsert(entry.key, entry.domain, report, entry.epoch, entry.revision);
      return report;
    }

    pending = {
      key: entry.key,
      domain: entry.domain,
      epoch: entry.epoch,
      revision: entry.revision,
      task,
      input,
      settings,
      publishedCompletedRuns: 0,
      publishedFraction: 0,
    };
    this.pendingSimulation = pending;
    this.simulationSettings.set(keyOf(entry.key), settings);
    const report = freezeUiReport({
      ...entry.report,
      simulationRun: pendingRunState(pending, 0, 0),
      capabilities: { ...entry.report.capabilities, canSimulate: true },
    });
    this.store.upsert(entry.key, entry.domain, report, entry.epoch, entry.revision);

    void task.promise.then(
      (result) => this.completeSimulationTask(pending, result),
      (error) => this.failSimulationTask(pending, error),
    );
    return report;
  }

  private publishSimulationProgress(
    pending: PendingSimulation,
    completedRuns: number,
    fraction: number,
  ): void {
    if (this.destroyed || this.pendingSimulation !== pending) return;
    const entry = this.store.get(pending.key);
    if (!entry || entry.domain !== pending.domain
      || entry.epoch !== pending.epoch || entry.revision !== pending.revision) return;
    const report = freezeUiReport({
      ...entry.report,
      simulationRun: pendingRunState(pending, completedRuns, fraction),
    });
    this.store.upsert(pending.key, pending.domain, report, pending.epoch, pending.revision);
  }

  private completeSimulationTask(
    pending: PendingSimulation,
    result: BacktestSimulationResult,
  ): void {
    if (this.destroyed || this.pendingSimulation !== pending) return;
    const entry = this.store.get(pending.key);
    if (!entry || entry.domain !== pending.domain
      || entry.epoch !== pending.epoch || entry.revision !== pending.revision
      || !simulationEligible(entry)) {
      this.pendingSimulation = null;
      return;
    }
    const simulation = toUiSimulation(pending.domain, pending.settings, {
      runner: () => result,
      cache: this.simulationCache,
    });
    if (!simulation) {
      this.failSimulationTask(pending, new Error('Simulation population is no longer available'));
      return;
    }
    this.pendingSimulation = null;
    this.simulationSettings.set(keyOf(pending.key), simulationSettingsOf(simulation));
    const report = freezeUiReport({
      ...entry.report,
      simulation,
      simulationRun: undefined,
      capabilities: { ...entry.report.capabilities, canSimulate: true },
    });
    this.store.upsert(pending.key, pending.domain, report, pending.epoch, pending.revision);
  }

  private failSimulationTask(pending: PendingSimulation, error: unknown): void {
    if (this.destroyed || this.pendingSimulation !== pending) return;
    if (error instanceof BacktestSimulationTaskCancelledError) {
      this.pendingSimulation = null;
      return;
    }
    const entry = this.store.get(pending.key);
    this.pendingSimulation = null;
    if (!entry || entry.domain !== pending.domain
      || entry.epoch !== pending.epoch || entry.revision !== pending.revision) return;
    const message = error instanceof Error ? error.message : String(error);
    const report = freezeUiReport({
      ...entry.report,
      simulationRun: Object.freeze({
        ...pendingRunState(
          pending,
          pending.publishedCompletedRuns,
          pending.publishedFraction,
        ),
        status: 'error' as const,
        message,
      }),
    });
    this.store.upsert(pending.key, pending.domain, report, pending.epoch, pending.revision);
    this.diagnose('backtest Simulation failed', error);
  }

  private cancelPendingSimulation(key?: BacktestAdapterKey): void {
    const pending = this.pendingSimulation;
    if (!pending || (key && keyOf(key) !== keyOf(pending.key))) return;
    this.pendingSimulation = null;
    try {
      pending.task.cancel();
    } catch (error) {
      this.diagnose('backtest Simulation cancellation failed', error);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.cancelPendingSimulation();
    this.destroyed = true;
    try {
      this.sourceUnsubscribe?.();
    } catch (error) {
      this.diagnose('backtest source unsubscribe failed', error);
    }
    this.sourceUnsubscribe = null;
    this.sourceSubscribed = false;
    this.simulationCache.clear();
    this.simulationSettings.clear();
    this.invalidSettings.clear();
    this.latestSettingsIdentity.clear();
    if (this.ownsSimulationWorker) {
      try {
        this.simulationWorker?.destroy?.();
      } catch (error) {
        this.diagnose('backtest Simulation Worker teardown failed', error);
      }
    }
    this.store.destroy();
    if (this.options.ownsSource) {
      try {
        this.source.destroy?.();
      } catch (error) {
        this.diagnose('backtest source destroy failed', error);
      }
    }
  }

  private handleEvent(event: BacktestAdapterEvent): void {
    if (this.destroyed) return;
    if (event.type === 'snapshot') {
      try {
        this.acceptSnapshot(event.snapshot);
        // Do not let a background cell's late snapshot steal the Dock while
        // the user is looking at an active cell with no strategy. Before the
        // workspace emits its first active-cell selection, the first snapshot
        // is still allowed to establish an initial selection.
        if (!this.store.active
          && (this.store.activeCellId === null
            || this.store.activeCellId === event.snapshot.key.cellId)) {
          this.store.ensureActive(event.snapshot.key);
          this.resumeActiveSimulation();
        }
      } catch (error) {
        this.diagnose('backtest snapshot mapping failed', error);
      }
      return;
    }
    if (event.type === 'removed') {
      this.invalidSettings.delete(keyOf(event.key));
      this.latestSettingsIdentity.delete(keyOf(event.key));
      this.cancelPendingSimulation(event.key);
      this.simulationCache.delete(keyOf(event.key));
      this.simulationSettings.delete(keyOf(event.key));
      if (this.store.remove(event.key)) {
        this.store.ensureActive();
        this.resumeActiveSimulation();
      }
      return;
    }
    // `error` and `stale-drop` events are accompanied by a snapshot when the
    // source has one. Keep the last good report visible for stale drops, while
    // surfacing an explicit error if no report exists yet.
    if (event.type === 'error') {
      const key = event.key;
      if (this.invalidSettings.has(keyOf(key))) {
        this.publishSettingsInvalid(key, event.epoch, event.revision);
        return;
      }
      this.cancelPendingSimulation(key);
      const existing = this.store.get(key);
      let accepted = false;
      if (existing) {
        // Preserve last-good values while making the failure explicit. A later
        // snapshot at the same revision can replace this stale/error overlay.
        const report = freezeUiReport({
          ...existing.report,
          revision: event.revision,
          status: 'error',
          error: event.error.message,
          errorDetails: event.errorDetails ?? backtestAdapterErrorOf(event.error),
          capabilities: existing.report.capabilities
            ? { ...existing.report.capabilities, canSimulate: false }
            : existing.report.capabilities,
        });
        accepted = this.store.upsert(key, existing.domain, report, event.epoch, event.revision);
      } else {
        const errorDetails = event.errorDetails ?? backtestAdapterErrorOf(event.error);
        const report = this.errorReport(key, event.error.message, event.revision, errorDetails);
        const domain = createBacktestReport({
          key,
          revision: event.revision,
          runId: `${keyOf(key)}:${event.revision}`,
          status: 'error',
          finality: 'unknown',
          error: errorDetails,
        });
        accepted = this.store.upsert(key, domain, report, event.epoch, event.revision);
      }
      if (accepted && !this.store.active
        && (this.store.activeCellId === null || this.store.activeCellId === key.cellId)) {
        this.store.ensureActive(key);
      }
    }
  }

  private acceptSnapshot(snapshot: BacktestAdapterSnapshot): void {
    const settingsId = keyOf(snapshot.key);
    const identity = { runId: snapshot.reportSeries?.runId ?? snapshot.auditLedger?.runId ?? null,
      epoch: snapshot.epoch, revision: snapshot.revision };
    const latest = this.latestSettingsIdentity.get(settingsId);
    if (!latest || identity.epoch > latest.epoch
      || (identity.epoch === latest.epoch && identity.revision >= latest.revision)) {
      this.latestSettingsIdentity.set(settingsId, {
        ...identity,
        // Computing/summary-only envelopes may omit the identity. Do not
        // forget the last engine run and then accept it as a recovery run.
        runId: identity.runId ?? latest?.runId ?? null,
      });
    }
    const failed = this.invalidSettings.get(settingsId);
    if (failed) {
      const matches = (state: BacktestAdapterParameterState | undefined, expected: Record<string, BacktestSettingValue>) =>
        Object.entries(expected).every(([key, value]) => Object.is(state?.values[key]
          ?? state?.schema.find(field => field.key === key)?.defval, value));
      const newer = identity.epoch > failed.baseline.epoch
        || (identity.epoch === failed.baseline.epoch && identity.revision > failed.baseline.revision);
      const paramsMatch = failed.expected && matches(snapshot.inputs, failed.expected.inputs)
        && matches(snapshot.props, failed.expected.props);
      if (newer && paramsMatch && identity.runId && identity.runId !== failed.baseline.runId
        && snapshot.run?.cause === 'inputs') failed.recoveryRunId = identity.runId;
      const recovered = newer && paramsMatch && failed.recoveryRunId
        && identity.runId === failed.recoveryRunId
        && snapshot.seriesState === 'ready' && snapshot.ledgerState === 'ready'
        && snapshot.ledgerRevision === snapshot.revision
        && (snapshot.status === 'ready' || snapshot.status === 'no-trades' || snapshot.status === 'open-only')
        && isSettledFinality(snapshot.finality);
      if (!recovered) {
        this.publishSettingsInvalid(snapshot.key, snapshot.epoch, snapshot.revision);
        return;
      }
      this.invalidSettings.delete(settingsId);
    }
    const domain = mapSnapshotDomain(snapshot, {
      getMarket: this.options.getMarket,
    });
    const id = keyOf(snapshot.key);
    const requestedChange = this.simulationSettings.get(id);
    const requestedSettings = resolveSimulationSettings(undefined, requestedChange ?? {});
    const engineSettings = normalizeSimulationEngineSettings(requestedSettings);
    const prepared = prepareSimulationInput(domain, engineSettings);
    const needsWorker = prepared !== undefined
      && this.simulationNeedsWorker(domain, engineSettings, prepared.input);
    const priorEntry = this.store.get(snapshot.key);
    const priorPending = this.pendingSimulation
      && keyOf(this.pendingSimulation.key) === id
      ? this.pendingSimulation
      : null;
    const reusePending = needsWorker
      && prepared !== undefined
      && priorPending !== null
      && sameSimulationInput(priorPending.input, prepared.input);
    const mappingSettings = needsWorker
      ? simulationFallbackSettings(
          priorEntry?.report.simulation,
          requestedSettings,
          Math.max(1, Math.min(1_000, this.simulationWorkerThreshold - 1)),
        )
      : requestedChange;
    const report = domainToUiReport(
      domain,
      snapshot,
      this.options.isFavorite?.(snapshot.key) ?? false,
      this.simulationRuntime(),
      mappingSettings,
    );
    if (!this.store.upsert(snapshot.key, domain, report, snapshot.epoch)) return;

    if (!needsWorker || !prepared) {
      this.cancelPendingSimulation(snapshot.key);
      return;
    }

    this.simulationSettings.set(id, requestedSettings);
    const entry = this.store.get(snapshot.key);
    if (!entry) return;
    if (reusePending && priorPending) {
      const previousRun = priorEntry?.report.simulationRun;
      priorPending.domain = domain;
      priorPending.epoch = snapshot.epoch;
      priorPending.revision = domain.revision;
      priorPending.settings = requestedSettings;
      const pendingReport = freezeUiReport({
        ...entry.report,
        simulationRun: pendingRunState(
          priorPending,
          previousRun?.completedRuns ?? priorPending.publishedCompletedRuns,
          previousRun?.progress ?? priorPending.publishedFraction,
        ),
      });
      this.store.upsert(snapshot.key, domain, pendingReport, snapshot.epoch);
      return;
    }

    const active = this.store.active;
    if (priorPending || (active && keyOf(active) === id)) {
      this.startSimulationTask(entry, requestedSettings, prepared.input);
    }
  }

  private errorReport(
    key: BacktestAdapterKey,
    message: string,
    revision: number,
    errorDetails?: BacktestAdapterError,
  ): UiBacktestReport {
    return freezeUiReport({
      key,
      revision,
      runId: `${keyOf(key)}:${revision}`,
      strategyName: 'Backtest',
      status: 'error',
      error: message,
      ...(errorDetails ? { errorDetails } : {}),
      metrics: {
        trades: unavailable('count', 'not-exposed'),
        netProfit: unavailable('currency', 'not-exposed'),
      },
      capabilities: { canSimulate: false, canLocateTrades: false },
    });
  }

  private diagnose(message: string, error?: unknown): void {
    try {
      this.options.onDiagnostic?.(message, error);
    } catch {
      // Diagnostics must never affect Workspace startup or teardown.
    }
  }

  private simulationRuntime(): SimulationRuntime {
    return {
      runner: this.options.simulationRunner ?? simulateBacktestReference,
      cache: this.simulationCache,
    };
  }
}

/**
 * Return whether the authoritative domain snapshot is safe to simulate.
 *
 * Only historical-final and live-provisional reports are eligible. A
 * partial-history ledger may be complete for the currently visible bars, but
 * older bars can still add trades and change every aggregate. `unknown` is
 * likewise blocked because it provides no evidence that the ledger and
 * strategy summary belong to one accepted run.
 */
function simulationEligible(entry: {
  readonly domain: DomainBacktestReport;
  readonly report: UiBacktestReport;
}): boolean {
  return entry.report.status === 'ready'
    && entry.domain.status === 'ready'
    && entry.domain.error == null
    && isSettledFinality(entry.domain.finality)
    && entry.domain.capabilities.tradeLedger;
}

function isSettledFinality(finality: string | undefined): boolean {
  return finality === 'historical-final' || finality === 'live-provisional';
}

interface MappingOptions {
  readonly getMarket?: (key: BacktestAdapterKey) => BacktestMarketIdentity | undefined;
  readonly isFavorite?: (key: BacktestAdapterKey) => boolean;
}

export function mapSnapshot(
  snapshot: BacktestAdapterSnapshot,
  options: MappingOptions = {},
): UiBacktestReport {
  const domain = mapSnapshotDomain(snapshot, options);
  return domainToUiReport(domain, snapshot, options.isFavorite?.(snapshot.key) ?? false);
}

/** Provider-neutral domain mapping exported for Store/selector tests. */
export function mapSnapshotDomain(
  snapshot: BacktestAdapterSnapshot,
  options: Pick<MappingOptions, 'getMarket'> = {},
): DomainBacktestReport {
  const baseContext = toDomainContext(options.getMarket?.(snapshot.key));
  const context = baseContext && !baseContext.range
    ? { ...baseContext, range: inferSettledRange(snapshot) }
    : baseContext;
  const strategy = reportableStrategy(snapshot.context?.strategy ?? snapshot.run?.strategy);
  const reportSeries = snapshot.seriesState === 'ready' ? snapshot.reportSeries : undefined;
  const initialCapital = strategy?.initialCapital;
  const settledHistory = isSettledFinality(snapshot.finality);
  const ledgerAvailable = snapshot.capabilities.tradeLedger
    && settledHistory
    && snapshot.trades !== null
    && snapshot.trades !== undefined
    && (snapshot.status === 'ready'
      || snapshot.status === 'no-trades'
      || snapshot.status === 'open-only')
    && snapshot.ledgerState === 'ready'
    && snapshot.ledgerRevision === snapshot.revision;
  const title = snapshot.run?.title ?? snapshot.context?.meta.title ?? snapshot.handle?.title ?? 'Backtest';
  const domain = createBacktestReport({
    key: snapshot.key,
    revision: snapshot.revision,
    runId: snapshot.runToken ?? `${keyOf(snapshot.key)}:${snapshot.revision}`,
    snapshotToken: reportSeries
      ? `${reportSeries.runId}:${reportSeries.snapshotRevision}`
      : undefined,
    title,
    source: {
      id: snapshot.key.indicatorId,
      name: title,
      kind: snapshot.run?.kind ?? 'strategy',
    },
    status: toDomainStatus(snapshot.status),
    finality: snapshot.finality,
    forming: snapshot.run?.forming,
    context,
    settings: toSettingsSnapshot(snapshot),
    execution: toExecutionSnapshot(snapshot),
    history: historyCoverageOf(snapshot),
    account: strategy
      ? {
          initialCapital: strategy.initialCapital,
          currency: strategy.accountCurrency ?? context?.currency,
          maxContractsHeldAll: finiteOrNull(strategy.maxContractsHeldAll),
          maxContractsHeldLong: finiteOrNull(strategy.maxContractsHeldLong),
          maxContractsHeldShort: finiteOrNull(strategy.maxContractsHeldShort),
          equity: strategy.equity,
          realizedPnl: strategy.netPnl,
          unrealizedPnl: strategy.openPnl,
          grossProfit: strategy.grossProfit,
          grossLoss: strategy.grossLoss,
          maxDrawdown: strategy.maxDrawdown,
          maxDrawdownPct: finiteOrNull(strategy.maxDrawdownPercent) === null
            ? null
            : (strategy.maxDrawdownPercent as number) / 100,
          maxRunup: strategy.maxRunup,
          position: {
            side: strategy.position > 0
              ? 'long'
              : strategy.position < 0 ? 'short' : 'flat',
            quantity: Math.abs(strategy.position),
            avgPrice: strategy.avgPrice,
            unrealizedPnl: strategy.openPnl,
            realizedPnl: strategy.netPnl,
          },
        }
      : undefined,
    // A null ledger is intentionally represented as an empty *internal*
    // population only; the UI mapper gates ledger metrics with `ledgerState`
    // and never presents this as a genuine zero-trade run.
    trades: ledgerAvailable ? snapshot.trades : [],
    // Raw lifecycle rows are independent of the round-trip trade ledger. Only
    // the adapter's identity-validated audit envelope may enable either
    // capability; a missing/malformed envelope maps to empty populations.
    orders: snapshot.capabilities.rawOrders ? snapshot.orders ?? [] : [],
    fills: snapshot.capabilities.rawFills ? snapshot.fills ?? [] : [],
    equitySeries: reportSeries?.points.map((point) => ({
      time: point.time,
      equity: point.equity,
      pnl: typeof initialCapital === 'number' && Number.isFinite(initialCapital)
        ? point.equity - initialCapital
        : point.realizedPnl + point.openPnl,
      drawdown: point.underwater,
      drawdownPct: point.underwaterPercent === null
        ? undefined
        : point.underwaterPercent / 100,
      maxDrawdown: point.maxDrawdown,
      maxDrawdownPct: point.maxDrawdownPercent / 100,
      barIndex: point.barIndex,
    })),
    benchmarkSeries: reportSeries?.points.flatMap((point) => (
      point.benchmarkEquity === null
        || point.benchmarkPnl === null
        || point.benchmarkReturnPercent === null
        ? []
        : [{
            time: point.time,
            value: point.benchmarkEquity,
            pnl: point.benchmarkPnl,
            returnPct: point.benchmarkReturnPercent / 100,
            barIndex: point.barIndex,
          }]
    )),
    warnings: snapshot.context?.warnings?.map((warning) => warning.message)
      ?? snapshot.run?.warnings?.map((warning) => warning.message)
      ?? [],
    capabilities: {
      ...snapshot.capabilities,
    },
    provenance: snapshot.provenance
      ? {
          engine: {
            name: snapshot.provenance.engine.packageName,
            version: snapshot.provenance.engine.packageVersion,
            sha: snapshot.provenance.engine.upstreamSha,
          },
          bridge: {
            name: snapshot.provenance.bridge.packageName,
            version: snapshot.provenance.bridge.packageVersion,
            sha: snapshot.provenance.bridge.bridgeSha,
          },
          buildFingerprint: snapshot.provenance.buildFingerprint,
          workerFingerprint: snapshot.provenance.workerFingerprint,
          sentinel: snapshot.provenance.sentinel,
        }
      : undefined,
    error: snapshot.error || snapshot.errorDetails
      ? (snapshot.errorDetails ?? backtestAdapterErrorOf(snapshot.error))
      : null,
  });
  return domain;
}

function domainToUiReport(
  domain: DomainBacktestReport,
  snapshot: BacktestAdapterSnapshot,
  favorite: boolean,
  simulationRuntime?: SimulationRuntime,
  simulationSettings: BacktestSimulationChange = {},
): UiBacktestReport {
  const summary = calculateSummaryMetrics(domain);
  const performance = calculatePerformanceMetrics(domain);
  const analysis = calculateAnalysisMetrics(domain);
  const tradeAnalysis = calculateTradeAnalysis(domain);
  const settledHistory = isSettledFinality(snapshot.finality);
  const ledgerAvailable = snapshot.capabilities.tradeLedger
    && settledHistory
    && snapshot.trades !== null
    && snapshot.trades !== undefined
    && (snapshot.status === 'ready'
      || snapshot.status === 'no-trades'
      || snapshot.status === 'open-only')
    && snapshot.ledgerState === 'ready'
    && snapshot.ledgerRevision === snapshot.revision;
  const strategy = reportableStrategy(snapshot.context?.strategy ?? snapshot.run?.strategy);
  const strategyAvailable = strategy !== undefined;
  // A strategy state can arrive for the currently painted head while Vela is
  // still backfilling older candles. Its account values are valid for that
  // head, but are not a final backtest result and must not appear in the Dock
  // as if the requested history were complete.
  // Strategy/account scalars are only trustworthy once the accepted report is
  // bound to a settled history (or to an immutable live-provisional snapshot).
  // `unknown` is intentionally unavailable too: a missing completion signal
  // must never be treated as historical-final by a UI projection.
  // A computing/error snapshot can carry the previous bounded strategy state
  // while its ledger is being replaced. Do not let those values leak into a
  // new report until the matching settled ledger has been accepted.
  const engineReportAvailable = strategyAvailable && ledgerAvailable && settledHistory;
  const engineMaxDrawdown = engineReportAvailable ? finiteOrNull(strategy?.maxDrawdown) : null;
  const engineMaxDrawdownPercent = engineReportAvailable ? finiteOrNull(strategy?.maxDrawdownPercent) : null;
  const engineCagr = engineReportAvailable ? finiteOrNull(strategy?.cagr) : null;
  const engineSharpe = engineReportAvailable ? finiteOrNull(strategy?.sharpe) : null;
  const engineSortino = engineReportAvailable ? finiteOrNull(strategy?.sortino) : null;
  const engineBuyAndHoldPnl = engineReportAvailable ? finiteOrNull(strategy?.buyAndHoldPnl) : null;
  const engineBuyAndHoldPercent = engineReportAvailable ? finiteOrNull(strategy?.buyAndHoldPercent) : null;
  const displayedNetProfit = strategyAvailable && settledHistory
    ? finiteOrNull((strategy.netPnl ?? 0) + (strategy.openPnl ?? 0)) : null;
  const engineCalmar = engineCagr !== null
    && engineMaxDrawdownPercent !== null
    && engineMaxDrawdownPercent > 0
    ? engineCagr / engineMaxDrawdownPercent
    : null;
  const hasEngineRiskRatios = engineCagr !== null && engineSharpe !== null && engineSortino !== null;
  const hasCompleteEngineBenchmark = engineBuyAndHoldPnl !== null
    && engineBuyAndHoldPercent !== null
    && displayedNetProfit !== null;
  const riskRatiosAvailable = settledHistory && snapshot.capabilities.riskRatios;
  const benchmarkAvailable = settledHistory && snapshot.capabilities.benchmark;
  const exactDrawdownAvailable = settledHistory && snapshot.capabilities.exactDrawdownCurve;
  const exactEquityAvailable = settledHistory && snapshot.capabilities.exactEquityCurve;
  const effectiveCapabilities = {
    ...snapshot.capabilities,
    riskRatios: riskRatiosAvailable || hasEngineRiskRatios,
    // A partial scalar set remains useful field-by-field, but it does not
    // satisfy the grouped benchmark contract advertised to the Viewer.
    benchmark: benchmarkAvailable || hasCompleteEngineBenchmark,
  };
  const unavailableLedger = unavailable('count', ledgerAvailable ? undefined : 'partial-ledger');
  const unavailableRisk = unavailable('ratio', 'not-exposed');
  const unavailableDrawdown = unavailable('currency', 'not-exposed');
  const unavailableBenchmark = unavailable('currency', 'not-exposed');
  const displayedBenchmark = engineBuyAndHoldPnl !== null
    ? engineBuyAndHoldPnl : benchmarkAvailable ? performance.buyAndHoldPnl : null;
  const metrics: Record<string, BacktestMetricValue> = {
    // Account-level P&L is a bounded StrategyState field and can remain
    // visible even when the unbounded trade ledger was not exposed.
    // Summary/Dock/Viewer all use the same mark-to-market net figure.  The
    // broker's `netPnl` field is realized-only; adding openPnl here prevents
    // the three surfaces from disagreeing while a position is open.
    netProfit: strategyAvailable && settledHistory
      ? displayedNetProfit
      : unavailable('currency', 'not-exposed'),
    trades: ledgerAvailable ? summary.tradeCount : unavailableLedger,
    winRate: ledgerAvailable ? percent(summary.winRate) : unavailable('percent', 'partial-ledger'),
    grossProfit: ledgerAvailable ? summary.grossProfit : unavailable('currency', 'partial-ledger'),
    // The domain contract stores gross loss as a positive magnitude. Keep the
    // sign convention aligned with the reference report (losing rows remain
    // negative, while this aggregate is positive).
    grossLoss: ledgerAvailable ? summary.grossLoss : unavailable('currency', 'partial-ledger'),
    profitFactor: ledgerAvailable ? finiteOrNull(summary.profitFactor) : unavailable('ratio', 'partial-ledger'),
    winningTrades: ledgerAvailable ? summary.winningTrades : unavailable('count', 'partial-ledger'),
    losingTrades: ledgerAvailable ? summary.losingTrades : unavailable('count', 'partial-ledger'),
    breakevenTrades: ledgerAvailable ? summary.breakevenTrades : unavailable('count', 'partial-ledger'),
    averageTrade: ledgerAvailable ? summary.averageTrade : unavailable('currency', 'partial-ledger'),
    averageWinner: ledgerAvailable ? summary.averageWinner : unavailable('currency', 'partial-ledger'),
    averageLoser: ledgerAvailable ? summary.averageLoser : unavailable('currency', 'partial-ledger'),
    largestWinner: ledgerAvailable ? summary.largestWinner : unavailable('currency', 'partial-ledger'),
    largestLoser: ledgerAvailable ? summary.largestLoser : unavailable('currency', 'partial-ledger'),
    maxDrawdown: engineMaxDrawdown !== null
      ? engineMaxDrawdown
      : exactDrawdownAvailable ? summary.maxDrawdown : unavailableDrawdown,
    maxDrawdownPercent: engineMaxDrawdownPercent !== null
      ? engineMaxDrawdownPercent
      : exactDrawdownAvailable
        ? percent(summary.maxDrawdownPct)
        : unavailable('percent', 'not-exposed'),
    // PineTS reports CAGR and benchmark gain in percentage points. The UI
    // stores percentage metrics in the same display-unit convention, so do
    // not run these authoritative values through `percent()` a second time.
    cagr: engineCagr !== null
      ? engineCagr
      : riskRatiosAvailable
        ? percent(performance.cagr)
        : unavailable('percent', 'not-exposed'),
    sharpe: engineSharpe !== null
      ? engineSharpe
      : riskRatiosAvailable ? performance.sharpe : unavailableRisk,
    sortino: engineSortino !== null
      ? engineSortino
      : riskRatiosAvailable ? performance.sortino : unavailableRisk,
    calmar: engineCalmar !== null
      ? engineCalmar
      : effectiveCapabilities.riskRatios ? performance.calmar : unavailableRisk,
    buyAndHoldPnl: engineBuyAndHoldPnl !== null
      ? engineBuyAndHoldPnl
      : benchmarkAvailable ? performance.buyAndHoldPnl : unavailableBenchmark,
    buyAndHoldPercent: engineBuyAndHoldPercent !== null
      ? engineBuyAndHoldPercent
      : benchmarkAvailable
        ? percent(performance.buyAndHoldPct)
        : unavailable('percent', 'not-exposed'),
    // The broker's raw outperformance is realized-only. Derive the visible
    // row from the very same MTM Net Profit and benchmark displayed above.
    strategyOutperformance: displayedNetProfit !== null && displayedBenchmark !== null
      ? displayedNetProfit - displayedBenchmark
      : unavailable('currency', 'not-exposed'),
    averagePnlPerDay: ledgerAvailable
      ? performance.averagePnlPerDay.all
      : unavailable('currency', 'partial-ledger'),
    averagePnlPerWeek: ledgerAvailable
      ? performance.averagePnlPerWeek.all
      : unavailable('currency', 'partial-ledger'),
  };
  const trades = ledgerAvailable ? toUiTrades(domain.trades) : [];
  // Terminal UI states require exactly the same proof used to publish rows.
  // Neither a history-free engine report nor a mismatched ledger revision is
  // a ready report. This applies to every bar count and history depth.
  const terminal = snapshot.status === 'ready' || snapshot.status === 'no-trades'
    || snapshot.status === 'open-only';
  const status = terminal && !ledgerAvailable
    ? (settledHistory ? 'computing' : 'partial')
    : toUiStatus(snapshot.status);
  const numericMetrics = Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [key, unwrapUiMetric(value)]),
  ) as Record<string, number | null>;
  const comparison = buildPerformanceComparison(summary, performance, numericMetrics, {
    ledgerAvailable,
    capabilities: effectiveCapabilities,
  });
  const analysisComparison = ledgerAvailable
    ? buildAnalysisComparison(tradeAnalysis)
    : undefined;
  const durationComparison = ledgerAvailable
    ? buildAnalysisDurationComparison(tradeAnalysis)
    : undefined;
  const analysisPoints = ledgerAvailable ? buildAnalysisPoints(domain, tradeAnalysis) : {
    pnlDistribution: [],
    durationPnl: [],
    frequency: [],
  };
  const summaryUi = {
    ...metrics,
    realizedNet: strategyAvailable && settledHistory ? finiteOrNull(strategy.netPnl) : unavailable('currency', 'not-exposed'),
    unrealizedNet: strategyAvailable && settledHistory ? finiteOrNull(strategy.openPnl) : unavailable('currency', 'not-exposed'),
    markToMarketNet: strategyAvailable && settledHistory
      ? finiteOrNull((strategy.netPnl ?? 0) + (strategy.openPnl ?? 0))
      : unavailable('currency', 'not-exposed'),
  };
  const analysisUi = {
    closedTradeCount: ledgerAvailable ? domain.closedTrades.length : 0,
    pnlDistribution: analysisPoints.pnlDistribution,
    pnlMean: tradeAnalysis.all.pnl.averageTrade,
    pnlReferenceLines: buildPnlReferenceLines(engineReportAvailable ? strategy : undefined),
    winRatePercent: analysisDonutWinRatePercent(tradeAnalysis),
    winRateBreakdown: buildAnalysisWinRateBreakdown(tradeAnalysis),
    durationPnl: analysisPoints.durationPnl,
    durationTrend: tradeAnalysis.durationTrend.map((point) => ({ x: point.x, y: point.y })),
    frequency: analysisPoints.frequency,
    comparison: analysisComparison,
    durationComparison,
    duration: {
      average: ledgerAvailable ? analysis.averageDurationMs : unavailable('duration', 'partial-ledger'),
      median: ledgerAvailable ? analysis.medianDurationMs : unavailable('duration', 'partial-ledger'),
      max: ledgerAvailable ? analysis.maxDurationMs : unavailable('duration', 'partial-ledger'),
      averageBars: ledgerAvailable && snapshot.capabilities.barIndices
        ? analysis.averageDurationBars
        : unavailable('count', ledgerAvailable ? 'not-exposed' : 'partial-ledger'),
      medianBars: ledgerAvailable && snapshot.capabilities.barIndices
        ? analysis.medianDurationBars
        : unavailable('count', ledgerAvailable ? 'not-exposed' : 'partial-ledger'),
      maxBars: ledgerAvailable && snapshot.capabilities.barIndices
        ? analysis.maxDurationBars
        : unavailable('count', ledgerAvailable ? 'not-exposed' : 'partial-ledger'),
      averageMfe: ledgerAvailable ? analysis.averageMfe : unavailable('currency', 'partial-ledger'),
      averageMae: ledgerAvailable ? analysis.averageMae : unavailable('currency', 'partial-ledger'),
    },
    streaks: {
      maxWinning: ledgerAvailable ? analysis.maxWinningStreak : unavailable('count', 'partial-ledger'),
      maxLosing: ledgerAvailable ? analysis.maxLosingStreak : unavailable('count', 'partial-ledger'),
      currentWinning: ledgerAvailable ? analysis.currentWinningStreak : unavailable('count', 'partial-ledger'),
      currentLosing: ledgerAvailable ? analysis.currentLosingStreak : unavailable('count', 'partial-ledger'),
    },
  };
  // Simulation is a terminal-report concern.  Do not run a 1000-path Monte
  // Carlo calculation for every live tick or while history is still forming;
  // the eventual Simulation worker will refresh it on an explicit user change.
  // A progressive deep-history ledger is deliberately not eligible: even a
  // complete head ledger can gain older trades before history:complete.
  // Live-forming and unknown finality remain blocked because their ledger can
  // change underneath a simulation path.
  const simulationFinality = snapshot.finality === 'historical-final'
    || snapshot.finality === 'live-provisional';
  const simulation = ledgerAvailable && snapshot.status === 'ready' && simulationFinality
    ? toUiSimulation(domain, simulationSettings, simulationRuntime)
    : undefined;
  // Retain the presentation hook for adapters that may expose an explicitly
  // settled partial-history mode in a future version. The current gate above
  // intentionally keeps that mode unavailable, so this is normally undefined.
  const simulationWarning = simulation !== undefined && snapshot.finality === 'partial-history'
    ? 'History is still loading; simulation uses the currently available closed trades.'
    : undefined;
  const hasSimulationPopulation = domain.closedTrades.some((trade) => {
    const pnl = tradeNetPnl(trade);
    return typeof pnl === 'number' && Number.isFinite(pnl);
  });
  const initialCapital = domain.account?.initialCapital;
  const simulationUnavailableReason = simulation !== undefined
    ? undefined
    : ledgerAvailable && !hasSimulationPopulation
        ? 'no-closed-trades' as const
        : ledgerAvailable && !(typeof initialCapital === 'number'
          && Number.isFinite(initialCapital)
          && initialCapital > 0)
          ? 'invalid-initial-capital' as const
          : 'unsettled-ledger' as const;
  // The reference Summary Cumulative P&L chart is the realized trade ledger:
  // one `historical_net_profit` value index-paired with each `trades_history`
  // item.  Keep exact per-bar equity separately for risk/benchmark capability;
  // it must not change the visible cumulative-P&L chart's point population.
  const hasExactEquityCurve = exactEquityAvailable;
  const hasRealizedPnlCurve = ledgerAvailable
    && performance.cumulativePnl.length > 0;
  const cumulativePnlSource: BacktestCumulativePnlSource | undefined = hasRealizedPnlCurve
    ? 'realized-ledger'
    : undefined;
  return freezeUiReport({
    key: domain.key,
    revision: domain.revision,
    runId: domain.runId,
    strategyName: domain.title ?? snapshot.handle?.title ?? 'Backtest',
    provider: domain.context?.provider,
    symbol: domain.context?.symbol,
    displaySymbol: domain.context?.displaySymbol,
    timeframe: domain.context?.timeframe,
    source: snapshot.source ?? snapshot.handle?.source,
    status,
    range: domain.context?.range
      ? {
          from: domain.context.range.from,
          to: domain.context.range.to,
        }
      : undefined,
    history: domain.history
      ? {
          loaded: domain.history.loaded,
          target: domain.history.target,
          barsLoaded: domain.history.barsLoaded,
          oldestTime: domain.history.oldestTime,
          actual: domain.history.actual
            ? {
                from: domain.history.actual.from,
                to: domain.history.actual.to,
              }
            : undefined,
          effectiveStrategy: domain.history.effectiveStrategy
            ? {
                from: domain.history.effectiveStrategy.from,
                to: domain.history.effectiveStrategy.to,
              }
            : undefined,
          complete: domain.history.complete,
          reason: domain.history.reason,
          progress: domain.history.progress,
        }
      : undefined,
    currency: domain.account?.currency ?? domain.context?.currency,
    timezone: domain.context?.timezone,
    settings: domain.settings,
    execution: domain.execution,
    favorite,
    error: domain.error?.message,
    errorDetails: domain.error
      ? toUiErrorDetails(domain.error)
      : undefined,
    metrics,
    summary: summaryUi,
    comparison,
    analysis: analysisUi,
    equity: hasExactEquityCurve
      ? performance.equityCurve.map((point) => ({ x: point.time, y: point.equity }))
      : undefined,
    cumulativePnl: hasRealizedPnlCurve
      ? toUiCumulativePnlPoints(domain.trades, performance.cumulativePnl)
      : undefined,
    cumulativePnlSource,
    simulationWarning,
    simulationUnavailableReason,
    netDailyPnl: ledgerAvailable
      ? performance.netDailyPnl.map((row) => ({
          x: row.bucket,
          y: row.pnl,
          label: `${row.tradeCount} trades`,
        }))
      : undefined,
    weekdayPerformance: ledgerAvailable
      ? performance.weekdayPerformance.map((row) => ({
          x: row.bucket,
          y: row.pnl,
          label: `${row.tradeCount} trades`,
        }))
      : undefined,
    trades,
    simulation,
    capabilities: {
      // Timestamp navigation remains a valid fallback for engines that do not
      // expose bar indices; local PineTS rows additionally carry exact bars.
      canLocateTrades: ledgerAvailable && domain.trades.some((trade) =>
        trade.entryTime !== null || trade.exitTime !== null),
      canSimulate: snapshot.capabilities.tradeLedger && simulation !== undefined,
      hasBenchmark: effectiveCapabilities.benchmark,
      hasEquityCurve: hasExactEquityCurve,
      hasRealizedPnlCurve,
    },
  });
}

function toUiErrorDetails(error: BacktestError): BacktestErrorDetails {
  return {
    message: error.message,
    ...(error.name ? { name: error.name } : {}),
    ...(error.kind ? { kind: error.kind } : {}),
    ...(error.method ? { method: error.method } : {}),
    ...(error.code ? { code: error.code } : {}),
    ...(error.provider ? { provider: error.provider } : {}),
    ...(error.status !== undefined ? { status: error.status } : {}),
    ...(error.timeoutMs !== undefined ? { timeoutMs: error.timeoutMs } : {}),
    ...(error.url ? { url: error.url } : {}),
    ...(error.retryable !== undefined ? { retryable: error.retryable } : {}),
  };
}

type SummaryResult = ReturnType<typeof calculateSummaryMetrics>;
type PerformanceResult = ReturnType<typeof calculatePerformanceMetrics>;
type AnalysisResult = ReturnType<typeof calculateAnalysisMetrics>;

const PERFORMANCE_COMPARISON_KEYS = [
  'netProfit',
  'cagr',
  'grossProfit',
  'grossLoss',
  'profitFactor',
  'averagePnlPerDay',
  'averagePnlPerWeek',
  'maxDrawdown',
  'maxDrawdownPercent',
  'calmar',
  'sharpe',
  'sortino',
  'buyAndHoldPnl',
  'buyAndHoldPercent',
  'strategyOutperformance',
] as const;

const ANALYSIS_COMPARISON_KEYS = [
  ...TRADE_ANALYSIS_COMPARISON_KEYS,
] as const;

function kpiComparison(kpi: SummaryResult['all'] | AnalysisResult): Record<string, number | null> {
  return {
    netProfit: finiteOrNull(kpi.markToMarketNet),
    trades: finiteOrNull(kpi.tradeCount),
    winRate: percent(kpi.winRate),
    grossProfit: finiteOrNull(kpi.grossProfit),
    // Gross loss is a magnitude in both the domain and reference contracts.
    grossLoss: finiteOrNull(kpi.grossLoss),
    profitFactor: finiteOrNull(kpi.profitFactor),
    averageTrade: finiteOrNull(kpi.averageTrade),
    averageWinner: finiteOrNull(kpi.averageWinner),
    averageLoser: finiteOrNull(kpi.averageLoser),
    largestWinner: finiteOrNull(kpi.largestWinner),
    largestLoser: finiteOrNull(kpi.largestLoser),
  };
}

function buildPerformanceComparison(
  summary: SummaryResult,
  performance: PerformanceResult,
  overallMetrics: Record<string, number | null>,
  options: {
    readonly ledgerAvailable: boolean;
    readonly capabilities: BacktestAdapterSnapshot['capabilities'];
  },
): BacktestComparison {
  const result: BacktestComparison = {};
  const total = overallMetrics.netProfit;
  const directionSum = summary.long.markToMarketNet + summary.short.markToMarketNet;
  const directionsReconcile = summary.directionalValuationsAvailable && total !== null && total !== undefined
    && Math.abs(directionSum - total) <= 1e-8 * Math.max(1, Math.abs(total));
  const directions = ['all', 'long', 'short'] as const;
  directions.forEach((direction) => {
    const base = options.ledgerAvailable ? kpiComparison(summary[direction]) : emptyKpiComparison();
    // Explicit nulls are important: the viewer must not fall back to the
    // overall column and accidentally display the same value for Long/Short.
    const row: Record<string, number | null> = Object.fromEntries(
      PERFORMANCE_COMPARISON_KEYS.map((key) => [key, null]),
    );
    row.netProfit = base.netProfit;
    row.grossProfit = base.grossProfit;
    row.grossLoss = base.grossLoss;
    row.profitFactor = base.profitFactor;
    row.averagePnlPerDay = options.ledgerAvailable
      ? performance.averagePnlPerDay[direction]
      : null;
    row.averagePnlPerWeek = options.ledgerAvailable
      ? performance.averagePnlPerWeek[direction]
      : null;
    if (direction === 'all' && options.ledgerAvailable) {
      PERFORMANCE_COMPARISON_KEYS.forEach((key) => {
        row[key] = overallMetrics[key] ?? null;
      });
      // Preserve the positive gross-loss magnitude even when the overall
      // metrics object is supplied by an older caller.
      row.grossLoss = finiteOrNull(summary.grossLoss);
      row.profitFactor = finiteOrNull(summary.profitFactor);
    }
    // Directional KPI fields are meaningful for the remaining rows even when
    // the engine cannot expose directional equity/risk curves.
    if (direction !== 'all') {
      // Missing per-leg valuations must not masquerade as a complete
      // directional decomposition of the account's total return.
      row.netProfit = directionsReconcile ? base.netProfit : null;
      row.grossProfit = base.grossProfit;
      row.grossLoss = base.grossLoss;
      row.profitFactor = base.profitFactor;
    }
    if (direction !== 'all' && !options.capabilities.riskRatios) {
      row.cagr = null;
      row.calmar = null;
      row.sharpe = null;
      row.sortino = null;
    }
    if (direction !== 'all' && !options.capabilities.benchmark) {
      row.buyAndHoldPnl = null;
      row.buyAndHoldPercent = null;
      row.strategyOutperformance = null;
    }
    if (direction !== 'all' && !options.capabilities.exactDrawdownCurve) {
      row.maxDrawdown = null;
      row.maxDrawdownPercent = null;
    }
    result[direction] = row;
  });
  return result;
}

function emptyKpiComparison(): Record<string, number | null> {
  return {
    netProfit: null,
    trades: null,
    winRate: null,
    grossProfit: null,
    grossLoss: null,
    profitFactor: null,
    averageTrade: null,
    averageWinner: null,
    averageLoser: null,
    largestWinner: null,
    largestLoser: null,
  };
}

function buildAnalysisComparison(
  analysis: TradeAnalysisResult,
): BacktestComparison {
  const result: BacktestComparison = {};
  const directions = ['all', 'long', 'short'] as const;
  directions.forEach((direction) => {
    const metrics = analysis[direction].pnl;
    const values: Record<string, number | null> = Object.fromEntries(
      ANALYSIS_COMPARISON_KEYS.map((key) => [key, null]),
    );
    values.trades = metrics.trades;
    values.winningTrades = metrics.winningTrades;
    values.losingTrades = metrics.losingTrades;
    values.breakevenTrades = metrics.breakevenTrades;
    values.winRate = percent(metrics.winRate);
    values.averageTrade = metrics.averageTrade;
    values.averageWinner = metrics.averageWinner;
    values.averageLoser = metrics.averageLoser;
    values.largestWinner = metrics.largestWinner;
    values.largestLoser = metrics.largestLoser;
    result[direction] = values;
  });
  return result;
}

function buildAnalysisDurationComparison(
  analysis: TradeAnalysisResult,
): BacktestComparison {
  const result: BacktestComparison = {};
  const directions = ['all', 'long', 'short'] as const;
  directions.forEach((direction) => {
    const metrics = analysis[direction].duration;
    result[direction] = Object.fromEntries(
      TRADE_ANALYSIS_DURATION_KEYS.map((key) => [key, metrics[key]]),
    );
  });
  return result;
}

function buildAnalysisPoints(domain: DomainBacktestReport, analysis: TradeAnalysisResult): {
  readonly pnlDistribution: BacktestPoint[];
  readonly durationPnl: BacktestPoint[];
  readonly frequency: BacktestPoint[];
} {
  const frequencyMap = new Map<string, number>();
  domain.closedTrades.forEach((trade) => {
    if (trade.exitTime === null) return;
    const bucket = calendarDateKey(trade.exitTime, domain.context?.timezone);
    if (!bucket) return;
    frequencyMap.set(bucket, (frequencyMap.get(bucket) ?? 0) + 1);
  });
  return {
    pnlDistribution: analysis.pnlHistogram.map((bin) => ({
      x: bin.midpoint,
      y: bin.count,
      from: bin.from,
      to: bin.to,
      label: `${formatCompact(bin.from)} | ${formatCompact(bin.to)}`,
      color: bin.color,
    })),
    durationPnl: analysis.durationPnl.map((point) => ({
      x: point.durationBars,
      y: point.pnl,
      label: point.label,
      direction: point.direction,
      time: point.exitTime,
      color: point.color,
    })),
    frequency: [...frequencyMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([x, y]) => ({ x, y })),
  };
}

function formatCompact(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * The reference donut is count-based and has exactly three categories. Its
 * open/current compatibility row is projected to zero only by trade-analysis.
 */
function buildAnalysisWinRateBreakdown(analysis: TradeAnalysisResult): BacktestPoint[] {
  const metrics = analysis.all.pnl;
  if (metrics.trades <= 0) return [];
  const points: BacktestPoint[] = [
    {
      x: 'Winners',
      y: metrics.winningTrades,
      label: `${metrics.winningTrades} winner${metrics.winningTrades === 1 ? '' : 's'}`,
      color: '#089981',
    },
    {
      x: 'Losers',
      y: metrics.losingTrades,
      label: `${metrics.losingTrades} loser${metrics.losingTrades === 1 ? '' : 's'}`,
      color: '#f23645',
    },
  ];
  if (metrics.breakevenTrades > 0) {
    points.push({
      x: 'Breakevens',
      y: metrics.breakevenTrades,
      label: `${metrics.breakevenTrades} breakeven${metrics.breakevenTrades === 1 ? '' : 's'}`,
      color: '#ff9800',
    });
  }
  return points;
}

function analysisDonutWinRatePercent(analysis: TradeAnalysisResult): number | null {
  const metrics = analysis.all.pnl;
  const denominator = metrics.winningTrades + metrics.losingTrades + metrics.breakevenTrades;
  return denominator > 0 ? metrics.winningTrades / denominator * 100 : null;
}

function buildPnlReferenceLines(strategy: ReportableStrategyState | undefined): BacktestPoint[] {
  return [
    { x: 'Avg Winning Trade', y: finiteOrNull(strategy?.averageWinningTrade) ?? 0, color: '#089981' },
    { x: 'Avg Losing Trade', y: finiteOrNull(strategy?.averageLosingTrade) ?? 0, color: '#f23645' },
    { x: 'Avg Trade', y: finiteOrNull(strategy?.averageTrade) ?? 0, color: '#71717a' },
  ];
}

function resolveSimulationSettings(
  base: BacktestSimulationSettings | undefined,
  change: BacktestSimulationChange,
): BacktestSimulationSettings {
  const engine = normalizeSimulationEngineSettings({
    method: change.method ?? base?.method,
    runs: change.runs ?? base?.runs,
    variationPercent: change.variationPercent ?? base?.variationPercent,
    preserveWinLoss: change.preserveWinLoss ?? base?.preserveWinLoss,
  });
  const requestedMultiple = change.drawdownMultiple ?? base?.drawdownMultiple ?? 2;
  return Object.freeze({
    ...engine,
    drawdownMultiple: Number.isFinite(requestedMultiple) && requestedMultiple > 0
      ? requestedMultiple
      : 2,
    drawdownUnit: (change.drawdownUnit ?? base?.drawdownUnit) === 'percent'
      ? 'percent'
      : 'currency',
    outcomeChartMode: (change.outcomeChartMode ?? base?.outcomeChartMode) === 'cumulative'
      ? 'cumulative'
      : 'histogram',
    drawdownChartMode: (change.drawdownChartMode ?? base?.drawdownChartMode) === 'cumulative'
      ? 'cumulative'
      : 'histogram',
  });
}

function simulationFallbackSettings(
  settled: BacktestSimulation | undefined,
  requested: BacktestSimulationSettings,
  maximumRuns: number,
): BacktestSimulationSettings {
  if (settled) {
    return resolveSimulationSettings(settled, {
      runs: Math.min(maximumRuns, settled.runs),
      drawdownMultiple: requested.drawdownMultiple,
      drawdownUnit: requested.drawdownUnit,
      outcomeChartMode: requested.outcomeChartMode,
      drawdownChartMode: requested.drawdownChartMode,
    });
  }
  return resolveSimulationSettings(requested, {
    runs: Math.min(maximumRuns, requested.runs),
  });
}

function pendingRunState(
  pending: PendingSimulation,
  completedRuns: number,
  fraction: number,
): BacktestSimulationRunState {
  return Object.freeze({
    status: 'pending',
    requestId: pending.task.requestId,
    completedRuns: Math.max(0, Math.min(pending.settings.runs, Math.round(completedRuns))),
    totalRuns: pending.settings.runs,
    progress: Math.max(0, Math.min(1, fraction)),
    settings: Object.freeze({ ...pending.settings }),
  });
}

function normalizeSimulationEngineSettings(change: BacktestSimulationChange): Readonly<{
  method: NonNullable<BacktestSimulationChange['method']>;
  runs: number;
  variationPercent: number;
  preserveWinLoss: boolean;
}> {
  const requestedRuns = change.runs ?? 1000;
  const requestedVariation = change.variationPercent ?? 0;
  return Object.freeze({
    method: change.method === 'shuffle' ? 'shuffle' : 'resample',
    runs: Number.isFinite(requestedRuns)
      ? Math.max(1, Math.min(10_000, Math.round(requestedRuns)))
      : 1000,
    variationPercent: Number.isFinite(requestedVariation)
      ? Math.min(100, Math.max(0, requestedVariation))
      : 0,
    preserveWinLoss: change.preserveWinLoss ?? false,
  });
}

interface PreparedSimulationInput {
  readonly input: BacktestSimulationInput;
  readonly populationSize: number;
  readonly usesMae: boolean;
}

function prepareSimulationInput(
  domain: DomainBacktestReport,
  settings: ReturnType<typeof normalizeSimulationEngineSettings>,
): PreparedSimulationInput | undefined {
  const population = domain.closedTrades.flatMap((trade) => {
    const delta = tradeNetPnl(trade);
    return delta === null || !Number.isFinite(delta) ? [] : [{ trade, delta }];
  });
  if (population.length === 0) return undefined;
  const initialCapital = domain.account?.initialCapital;
  if (typeof initialCapital !== 'number' || !Number.isFinite(initialCapital) || initialCapital <= 0) {
    return undefined;
  }
  const deltas = Object.freeze(population.map(({ delta }) => delta));
  const usesMae = population.some(({ trade }) => (
    typeof trade.mae === 'number' && Number.isFinite(trade.mae)
  ));
  const mae = usesMae
    ? Object.freeze(population.map(({ trade, delta }) => (
        typeof trade.mae === 'number' && Number.isFinite(trade.mae)
          ? Math.abs(trade.mae)
          : Math.max(0, -delta)
      )))
    : undefined;
  return Object.freeze({
    input: Object.freeze({
      deltas,
      ...(mae ? { excursions: Object.freeze({ mae }) } : {}),
      initialCapital,
      runs: settings.runs,
      mode: settings.method,
      seed: BACKTEST_SIMULATION_DEFAULT_SEED,
      variation: settings.variationPercent / 100,
      preserveWinLoss: settings.preserveWinLoss,
    }),
    populationSize: population.length,
    usesMae,
  });
}

function sameSimulationInput(
  left: BacktestSimulationInput,
  right: BacktestSimulationInput,
): boolean {
  return left.initialCapital === right.initialCapital
    && left.runs === right.runs
    && left.mode === right.mode
    && left.seed === right.seed
    && left.variation === right.variation
    && left.preserveWinLoss === right.preserveWinLoss
    && sameNumberSequence(left.deltas, right.deltas)
    && sameNumberSequence(left.excursions?.mae, right.excursions?.mae);
}

function simulationCoreKey(settings: ReturnType<typeof normalizeSimulationEngineSettings>): string {
  return JSON.stringify([
    settings.method,
    settings.runs,
    settings.variationPercent,
    settings.preserveWinLoss,
  ]);
}

function sameNumberSequence(
  left: readonly number[] | undefined,
  right: readonly number[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

function simulationPopulationCache(
  domain: DomainBacktestReport,
  initialCapital: number,
  deltas: readonly number[],
  mae: readonly number[] | undefined,
  cache: SimulationCache | undefined,
): SimulationPopulationCache | undefined {
  if (!cache) return undefined;
  const id = keyOf(domain.key);
  const current = cache.get(id);
  if (current
    && Object.is(current.initialCapital, initialCapital)
    && sameNumberSequence(current.deltas, deltas)
    && sameNumberSequence(current.mae, mae)) return current;
  const next: SimulationPopulationCache = {
    initialCapital,
    deltas: Object.freeze([...deltas]),
    ...(mae ? { mae: Object.freeze([...mae]) } : {}),
    cores: new Map(),
  };
  cache.set(id, next);
  return next;
}

function cachedSimulationCore(
  entries: Map<string, SimulationCoreResult> | undefined,
  settings: ReturnType<typeof normalizeSimulationEngineSettings>,
): SimulationCoreResult | undefined {
  const key = simulationCoreKey(settings);
  const cached = entries?.get(key);
  if (!cached || !entries) return undefined;
  // Refresh insertion order so the bounded Map behaves as a small LRU.
  entries.delete(key);
  entries.set(key, cached);
  return cached;
}

function storeSimulationCore(
  core: SimulationCoreResult,
  entries: Map<string, SimulationCoreResult> | undefined,
): void {
  if (!entries) return;
  entries.set(simulationCoreKey(core), core);
  while (entries.size > BACKTEST_SIMULATION_CACHE_LIMIT_PER_REPORT) {
    const oldest = entries.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

function simulationSettingsOf(simulation: BacktestSimulation): BacktestSimulationChange {
  return Object.freeze({
    method: simulation.method,
    runs: simulation.runs,
    variationPercent: simulation.variationPercent,
    preserveWinLoss: simulation.preserveWinLoss,
    drawdownMultiple: simulation.drawdownMultiple,
    drawdownUnit: simulation.drawdownUnit,
    outcomeChartMode: simulation.outcomeChartMode,
    drawdownChartMode: simulation.drawdownChartMode,
  });
}

function projectUiSimulation(
  core: SimulationCoreResult,
  change: BacktestSimulationChange,
): BacktestSimulation {
  const drawdownMultiple = typeof change.drawdownMultiple === 'number'
    && Number.isFinite(change.drawdownMultiple)
    && change.drawdownMultiple > 0
    ? change.drawdownMultiple
    : 2;
  const drawdownUnit = change.drawdownUnit === 'percent' ? 'percent' : 'currency';
  const outcomeChartMode = change.outcomeChartMode === 'cumulative' ? 'cumulative' : 'histogram';
  const drawdownChartMode = change.drawdownChartMode === 'cumulative' ? 'cumulative' : 'histogram';
  const actualDrawdownRatio = core.usesMae
    ? core.actualWalk.openMaxDrawdown
    : core.actualWalk.maxDrawdown;
  const thresholdRatio = actualDrawdownRatio * drawdownMultiple;
  return Object.freeze({
    method: core.method,
    runs: core.runs,
    variationPercent: core.variationPercent,
    preserveWinLoss: core.preserveWinLoss,
    drawdownMultiple,
    drawdownUnit,
    outcomeChartMode,
    drawdownChartMode,
    populationSize: core.populationSize,
    usesMae: core.usesMae,
    bands: core.result.bands,
    outcomeHistogram: core.outcomeHistogram,
    drawdownHistogram: drawdownUnit === 'percent'
      ? core.drawdownHistogramPercent
      : core.drawdownHistogramCurrency,
    metrics: Object.freeze({
      ...core.metrics,
      drawdownProbability: drawdownProbability(core.drawdownRatios, thresholdRatio),
      thresholdPercent: thresholdRatio * 100,
    }),
    actual: core.actual,
    streaks: core.streaks,
  });
}

function toUiSimulation(
  domain: DomainBacktestReport,
  change: BacktestSimulationChange = {},
  runtime: SimulationRuntime = { runner: simulateBacktestReference },
): BacktestSimulation | undefined {
  const settings = normalizeSimulationEngineSettings(change);
  const prepared = prepareSimulationInput(domain, settings);
  if (!prepared) {
    runtime.cache?.delete(keyOf(domain.key));
    return undefined;
  }
  const { input, populationSize, usesMae } = prepared;
  const { deltas, initialCapital } = input;
  const mae = input.excursions?.mae;
  const populationCache = simulationPopulationCache(
    domain,
    initialCapital,
    deltas,
    mae,
    runtime.cache,
  );
  const cached = cachedSimulationCore(populationCache?.cores, settings);
  if (cached) return projectUiSimulation(cached, change);
  const actual = walkBacktestEquity(deltas, initialCapital, { ...(mae ? { mae } : {}) });
  const result = runtime.runner(input);
  const drawdownRatios = usesMae ? result.openMaxDrawdowns : result.maxDrawdowns;
  const drawdownAmounts = usesMae ? result.openMaxDrawdownsAbs : result.maxDrawdownsAbs;
  const streakMetric = (values: readonly number[], actualValue: number) => Object.freeze({
    actual: actualValue,
    median: Math.round(linearPercentile(values, 0.5)),
    p95: Math.round(linearPercentile(values, 0.95)),
  });
  const actualProjection = Object.freeze({
    path: Object.freeze(actual.path.map((value, index) => Object.freeze({ x: index, y: value }))),
    finalPnl: actual.final,
    maxDrawdown: actual.maxDrawdownAbs,
    maxDrawdownPercent: actual.maxDrawdown * 100,
    openMaxDrawdown: actual.openMaxDrawdownAbs,
    openMaxDrawdownPercent: actual.openMaxDrawdown * 100,
    longestLosingStreak: actual.longestLosingStreak,
    maxDrawdownDuration: actual.maxDrawdownDuration,
    recoveryDuration: actual.recoveryDuration,
  });
  const streaks = Object.freeze({
    longestLosingStreak: streakMetric(
      result.streaks.longestLosingStreak,
      actual.longestLosingStreak,
    ),
    maxDrawdownDuration: streakMetric(
      result.streaks.maxDrawdownDuration,
      actual.maxDrawdownDuration,
    ),
    recoveryDuration: streakMetric(
      result.streaks.recoveryDuration,
      actual.recoveryDuration,
    ),
  });
  const metrics = Object.freeze({
    probabilityOfProfit: result.probProfit,
    medianOutcome: result.medianFinal,
    p5Outcome: result.p5Final,
    p95Outcome: result.p95Final,
    p5Drawdown: linearPercentile(drawdownAmounts, 0.05),
    p95Drawdown: linearPercentile(drawdownAmounts, 0.95),
    p99Drawdown: linearPercentile(drawdownAmounts, 0.99),
    p5DrawdownPercent: linearPercentile(drawdownRatios, 0.05) * 100,
    p95DrawdownPercent: linearPercentile(drawdownRatios, 0.95) * 100,
    p99DrawdownPercent: linearPercentile(drawdownRatios, 0.99) * 100,
    riskOfRuin: ruinProbability(drawdownRatios),
    p95LosingStreak: Math.round(linearPercentile(result.streaks.longestLosingStreak, 0.95)),
  });
  const core = Object.freeze({
    ...settings,
    populationSize,
    usesMae,
    result,
    actualWalk: actual,
    actual: actualProjection,
    streaks,
    outcomeHistogram: buildSimulationHistogram(result.finals),
    drawdownHistogramCurrency: buildSimulationHistogram(drawdownAmounts),
    drawdownHistogramPercent: buildSimulationHistogram(drawdownRatios),
    drawdownRatios,
    drawdownAmounts,
    metrics,
  }) satisfies SimulationCoreResult;
  storeSimulationCore(core, populationCache?.cores);
  return projectUiSimulation(core, change);
}

const frozenTradeLedgers = new WeakSet<readonly BacktestTrade[]>();

function freezeUiReport(report: UiBacktestReport): UiBacktestReport {
  const freezePoints = (points: readonly BacktestPoint[] | undefined) =>
    points ? Object.freeze(points.map((point) => Object.freeze({ ...point }))) : points;
  const freezeTrades = (trades: readonly BacktestTrade[] | undefined) => {
    if (!trades || frozenTradeLedgers.has(trades)) return trades;
    const frozen = Object.freeze(trades.map((trade) => Object.freeze({ ...trade })));
    frozenTradeLedgers.add(frozen);
    return frozen;
  };
  const freezeRecord = <T extends object>(record: T | undefined): Readonly<T> | undefined => {
    if (!record) return record;
    const copy = Object.fromEntries(Object.entries(record).map(([key, value]) => [
      key,
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.freeze({ ...(value as Record<string, unknown>) })
        : value,
    ]));
    return Object.freeze(copy) as Readonly<T>;
  };
  return Object.freeze({
    ...report,
    key: report.key ? Object.freeze({ ...report.key }) : report.key,
    range: report.range ? Object.freeze({ ...report.range }) : report.range,
    history: report.history
      ? Object.freeze({
          ...report.history,
          actual: report.history.actual ? Object.freeze({ ...report.history.actual }) : report.history.actual,
          effectiveStrategy: report.history.effectiveStrategy
            ? Object.freeze({ ...report.history.effectiveStrategy })
            : report.history.effectiveStrategy,
        })
      : report.history,
    settings: report.settings
      ? Object.freeze({
          ...report.settings,
          key: Object.freeze({ ...report.settings.key }),
          inputs: Object.freeze(report.settings.inputs.map((item) => Object.freeze({
            ...item,
            ...(item.options ? { options: Object.freeze([...item.options]) } : {}),
          }))),
          props: Object.freeze(report.settings.props.map((item) => Object.freeze({
            ...item,
            ...(item.options ? { options: Object.freeze([...item.options]) } : {}),
          }))),
          inputValues: Object.freeze({ ...report.settings.inputValues }),
          propValues: Object.freeze({ ...report.settings.propValues }),
        })
      : report.settings,
    execution: report.execution
      ? Object.freeze({
          ...report.execution,
          seriesKeys: Object.freeze([...report.execution.seriesKeys]),
        })
      : report.execution,
    metrics: freezeRecord(report.metrics),
    summary: freezeRecord(report.summary),
    comparison: report.comparison
      ? Object.freeze(Object.fromEntries(Object.entries(report.comparison).map(([key, value]) => [key, freezeRecord(value)])))
      : report.comparison,
    equity: freezePoints(report.equity),
    cumulativePnl: freezePoints(report.cumulativePnl),
    netDailyPnl: freezePoints(report.netDailyPnl),
    weekdayPerformance: freezePoints(report.weekdayPerformance),
    trades: freezeTrades(report.trades),
    analysis: report.analysis
      ? Object.freeze({
          ...report.analysis,
          pnlDistribution: freezePoints(report.analysis.pnlDistribution),
          pnlReferenceLines: freezePoints(report.analysis.pnlReferenceLines),
          winRateBreakdown: freezePoints(report.analysis.winRateBreakdown),
          durationPnl: freezePoints(report.analysis.durationPnl),
          durationTrend: freezePoints(report.analysis.durationTrend),
          frequency: freezePoints(report.analysis.frequency),
          comparison: report.analysis.comparison
            ? Object.freeze(Object.fromEntries(Object.entries(report.analysis.comparison).map(([key, value]) => [key, freezeRecord(value)])))
            : report.analysis.comparison,
          durationComparison: report.analysis.durationComparison
            ? Object.freeze(Object.fromEntries(Object.entries(report.analysis.durationComparison).map(([key, value]) => [key, freezeRecord(value)])))
            : report.analysis.durationComparison,
          duration: freezeRecord(report.analysis.duration),
          streaks: freezeRecord(report.analysis.streaks),
        })
      : report.analysis,
    simulation: report.simulation
      ? Object.isFrozen(report.simulation)
        ? report.simulation
        : Object.freeze({
          ...report.simulation,
          bands: Object.freeze({
            index: Object.freeze([...report.simulation.bands.index]),
            p5: Object.freeze([...report.simulation.bands.p5]),
            p25: Object.freeze([...report.simulation.bands.p25]),
            p50: Object.freeze([...report.simulation.bands.p50]),
            p75: Object.freeze([...report.simulation.bands.p75]),
            p95: Object.freeze([...report.simulation.bands.p95]),
          }),
          outcomeHistogram: Object.freeze(report.simulation.outcomeHistogram.map((bin) => (
            Object.freeze({ ...bin })
          ))),
          drawdownHistogram: Object.freeze(report.simulation.drawdownHistogram.map((bin) => (
            Object.freeze({ ...bin })
          ))),
          metrics: Object.freeze({ ...report.simulation.metrics }),
          actual: Object.freeze({
            ...report.simulation.actual,
            path: freezePoints(report.simulation.actual.path) ?? Object.freeze([]),
          }),
          streaks: Object.freeze({
            longestLosingStreak: Object.freeze({ ...report.simulation.streaks.longestLosingStreak }),
            maxDrawdownDuration: Object.freeze({ ...report.simulation.streaks.maxDrawdownDuration }),
            recoveryDuration: Object.freeze({ ...report.simulation.streaks.recoveryDuration }),
          }),
          })
      : report.simulation,
    simulationRun: report.simulationRun
      ? Object.freeze({
          ...report.simulationRun,
          settings: Object.freeze({ ...report.simulationRun.settings }),
        })
      : report.simulationRun,
    capabilities: report.capabilities ? Object.freeze({ ...report.capabilities }) : report.capabilities,
  });
}

function toDomainContext(market: BacktestMarketIdentity | undefined): BacktestContext | undefined {
  if (!market) return undefined;
  return {
    provider: market.provider ?? 'unknown',
    symbol: market.symbol ?? 'unknown',
    displaySymbol: market.displaySymbol,
    timeframe: market.timeframe ?? 'unknown',
    timezone: market.timezone,
    currency: market.currency,
  };
}

function inferSettledRange(snapshot: BacktestAdapterSnapshot): BacktestContext['range'] | undefined {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  let count = 0;
  const include = (time: unknown): void => {
    if (typeof time !== 'number' || !Number.isFinite(time)) return;
    from = Math.min(from, time);
    to = Math.max(to, time);
    count += 1;
  };

  // An accepted atomic series is the actual data range for both settled and
  // live-provisional reports.  The latter is what the reference Viewer shows
  // while the newest bar is still updating.
  const points = snapshot.seriesState === 'ready' ? snapshot.reportSeries?.points ?? [] : [];
  points.forEach((point) => include(point.time));
  if (count >= 2) return { from, to };

  // A final ledger can still provide a bounded fallback for engines without
  // per-bar report series. Do not present trade bounds as the live data range.
  if (snapshot.finality === 'historical-final') {
    from = Number.POSITIVE_INFINITY;
    to = Number.NEGATIVE_INFINITY;
    count = 0;
    (snapshot.trades ?? []).forEach((trade) => {
      include(trade.entry?.time);
      include(trade.exit?.time);
    });
    if (count >= 2) return { from, to };
  }
  return undefined;
}

function historyCoverageOf(snapshot: BacktestAdapterSnapshot): HistoryCoverage | undefined {
  const history = snapshot.history;
  if (!history) return undefined;
  const inferred = inferSettledRange(snapshot);
  const actualFrom = history.oldestTime ?? inferred?.from ?? null;
  const actualTo = inferred?.to ?? null;
  return {
    loaded: history.loaded,
    target: history.target,
    barsLoaded: history.barsLoaded,
    oldestTime: history.oldestTime,
    actual: actualFrom !== null || actualTo !== null
      ? { from: actualFrom, to: actualTo }
      : undefined,
    effectiveStrategy: inferred,
    complete: history.complete,
    reason: history.reason ?? null,
    progress: history.progress,
  };
}

type AdapterInputSchema = BacktestAdapterParameterState['schema'][number];

/** Map Vela's InputSchema DTO without leaking the Vela package into domain/UI. */
function toSettingSchema(
  schema: readonly AdapterInputSchema[],
): readonly BacktestSettingSchema[] {
  return Object.freeze(schema.map((item) => Object.freeze({
    key: item.key,
    title: item.title,
    type: item.type,
    defval: item.defval,
    ...(item.min !== undefined ? { min: item.min } : {}),
    ...(item.max !== undefined ? { max: item.max } : {}),
    ...(item.step !== undefined ? { step: item.step } : {}),
    ...(item.options ? { options: Object.freeze([...item.options]) } : {}),
    ...(item.group !== undefined ? { group: item.group } : {}),
    ...(item.inline !== undefined ? { inline: item.inline } : {}),
    ...(item.tab !== undefined ? { tab: item.tab } : {}),
    ...(item.when !== undefined ? { when: item.when } : {}),
    ...(item.tooltip !== undefined ? { tooltip: item.tooltip } : {}),
  })));
}

function toSettingsSnapshot(
  snapshot: BacktestAdapterSnapshot,
): BacktestSettingsSnapshot | undefined {
  if (!snapshot.inputs && !snapshot.props) return undefined;
  const inputs = snapshot.inputs;
  const props = snapshot.props;
  const title = snapshot.run?.title
    ?? snapshot.context?.meta.title
    ?? snapshot.handle?.title
    ?? 'Backtest';
  return Object.freeze({
    key: { cellId: snapshot.key.cellId, indicatorId: snapshot.key.indicatorId },
    title,
    ...(snapshot.source ?? snapshot.handle?.source
      ? { source: snapshot.source ?? snapshot.handle?.source }
      : {}),
    visible: snapshot.visible,
    inputs: toSettingSchema(inputs?.schema ?? []),
    props: toSettingSchema(props?.schema ?? []),
    inputValues: Object.freeze({ ...(inputs?.values ?? {}) }) as Readonly<Record<string, BacktestSettingValue>>,
    propValues: Object.freeze({ ...(props?.values ?? {}) }) as Readonly<Record<string, BacktestSettingValue>>,
  });
}

function toExecutionSnapshot(
  snapshot: BacktestAdapterSnapshot,
): BacktestExecutionSnapshot | undefined {
  if (!snapshot.execution) return undefined;
  return Object.freeze({
    barIndex: snapshot.execution.barIndex,
    time: snapshot.execution.time,
    phase: snapshot.execution.phase,
    seriesKeys: Object.freeze([...snapshot.execution.seriesKeys]),
    ...(snapshot.execution.precision ? {
      precision: Object.freeze({
        ...snapshot.execution.precision,
      }),
    } : {}),
  });
}

function toUiTrades(
  trades: readonly Trade[],
): BacktestTrade[] {
  const indexed = trades.map((trade, sourceIndex) => ({
    trade,
    sourceIndex,
    pnl: finiteOrNull(tradeNetPnl(trade)),
    exitTime: typeof trade.exitTime === 'number' && Number.isFinite(trade.exitTime)
      ? trade.exitTime
      : 0,
  }));
  const referenceNumbers = referenceTradeNumbers(indexed);
  const cumulativeBySourceIndex = new Map<number, number>();
  let cumulative = 0;
  [...indexed]
    .sort((left, right) => left.exitTime - right.exitTime || left.sourceIndex - right.sourceIndex)
    .forEach(({ trade, sourceIndex, pnl }) => {
      // Keep an open compatibility row out of realized cumulative P&L even
      // though its reference sorting timestamp falls back to epoch zero.
      if (pnl !== null && trade.status !== 'open') cumulative += pnl;
      cumulativeBySourceIndex.set(sourceIndex, cumulative);
    });
  return indexed.map(({ trade, sourceIndex, pnl }) => {
    // The domain resolver above keeps provider aliases, gross-minus-costs and
    // price-derived P&L on one canonical UI value.
    return {
      id: trade.id,
      number: referenceNumbers.get(sourceIndex)!,
      direction: trade.direction,
      status: trade.status === 'open' ? 'open' : 'closed',
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      size: trade.quantity,
      netPnl: pnl,
      mfe: trade.mfe ?? null,
      mae: trade.mae ?? null,
      cumulativePnl: cumulativeBySourceIndex.get(sourceIndex) ?? 0,
      entryBar: trade.entryBarIndex ?? null,
      exitBar: trade.exitBarIndex ?? null,
    };
  });
}

/**
 * Keep marker metadata alongside Summary's realized values so a sampled
 * renderer can show its own chronological one-based Trade #, close timestamp,
 * and direction. The numerical values themselves remain sourced from
 * PerformanceMetrics; this helper only joins immutable ledger identity back
 * onto those values.
 */
function toUiCumulativePnlPoints(
  trades: readonly Trade[],
  points: readonly { readonly time: number; readonly cumulativePnl: number }[],
): BacktestPoint[] {
  const indexed = trades.map((trade, sourceIndex) => ({
    trade,
    sourceIndex,
    pnl: finiteOrNull(tradeNetPnl(trade)),
    exitTime: typeof trade.exitTime === 'number' && Number.isFinite(trade.exitTime)
      ? trade.exitTime
      : null,
  }));
  const historical = indexed
    .filter(({ trade, pnl, exitTime }) => trade.status !== 'open' && pnl !== null && exitTime !== null)
    .sort((left, right) => left.exitTime! - right.exitTime! || left.sourceIndex - right.sourceIndex);

  // Both selectors sort by close timestamp, then original ledger index. If a
  // third-party extension supplies an inconsistent metric stream, preserve its
  // numerical curve but omit unsafe metadata rather than attach it to a
  // different marker.
  return points.map((point, index) => {
    const historicalTrade = historical[index];
    if (!historicalTrade || historicalTrade.exitTime !== point.time) {
      return {
        x: index,
        y: point.cumulativePnl,
        time: point.time,
        tradeNumber: index + 1,
      };
    }
    return {
      // Summary's historical_net_profit is index-paired to the chronological
      // trades_history stream. Its ordinal is intentionally independent from
      // Trades Log's newest-first numbering (which includes the open #0
      // presentation sentinel and has a different non-zero population).
      x: index,
      y: point.cumulativePnl,
      time: historicalTrade.exitTime,
      direction: historicalTrade.trade.direction,
      tradeNumber: index + 1,
    };
  });
}

function referenceTradeNumbers(
  indexed: readonly {
    readonly trade: Trade;
    readonly sourceIndex: number;
    readonly exitTime: number | null;
  }[],
): Map<number, number> {
  const referenceNumbers = new Map<number, number>();
  // Summary excludes breakeven trades, but the log does not. Number the
  // actual closed population so every closed row has a unique positive ID;
  // open lots share only the explicit #0 presentation sentinel.
  const closed = indexed.filter(({ trade }) => trade.status !== 'open');
  indexed.forEach(({ trade, sourceIndex }) => {
    if (trade.status === 'open') referenceNumbers.set(sourceIndex, 0);
  });
  [...closed]
    .sort((left, right) => (right.exitTime ?? 0) - (left.exitTime ?? 0) || left.sourceIndex - right.sourceIndex)
    .forEach(({ sourceIndex }, rank) => {
      referenceNumbers.set(sourceIndex, closed.length - rank);
    });
  return referenceNumbers;
}

function keyOf(key: BacktestAdapterKey): string {
  return backtestKeyId(key);
}

function toDomainStatus(status: BacktestAdapterStatus): DomainBacktestStatus {
  switch (status) {
    case 'waiting-data': return 'waiting-data';
    case 'compiling': return 'compiling';
    case 'computing': return 'computing';
    case 'updating': return 'updating';
    case 'suspended': return 'suspended';
    case 'no-data': return 'no-data';
    case 'no-trades': return 'no-trades';
    case 'open-only': return 'open-only';
    case 'partial': return 'partial';
    case 'error': return 'error';
    case 'ready': return 'ready';
  }
}

function toUiStatus(status: BacktestAdapterStatus): UiBacktestStatus {
  switch (status) {
    case 'waiting-data': return 'waiting-data';
    case 'compiling': return 'compiling';
    case 'computing': return 'computing';
    case 'updating': return 'updating';
    case 'partial': return 'partial';
    case 'error': return 'error';
    case 'suspended': return 'suspended';
    case 'no-data': return 'no-data';
    case 'no-trades': return 'no-trades';
    case 'open-only': return 'open-only';
    case 'ready': return 'ready';
  }
}

function percent(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : value * 100;
}

function unavailable(
  unit: NonNullable<Extract<BacktestMetricValue, { unit?: unknown }>['unit']> | 'count',
  reason: 'not-exposed' | 'not-applicable' | 'insufficient-data' | 'partial-history' | 'partial-ledger' | 'division-by-zero' | undefined,
): BacktestMetricValue {
  return {
    value: null,
    unit,
    ...(reason ? { unavailableReason: reason } : {}),
  };
}

function unwrapUiMetric(value: BacktestMetricValue): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value || typeof value !== 'object') return null;
  return typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}
