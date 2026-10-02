import type {
  ContextSelect,
  EngineContextSnapshot,
  IndicatorHandle,
  InputSchema,
  InputValue,
  ScriptRun,
  StrategyTrade,
  Vela,
} from '@luxalgo/vela';
import type {
  ChartCell,
  VelaWorkspace,
  WorkspaceScriptRun,
} from '@luxalgo/vela/workspace';
import { validateAuditLedgerSnapshot } from '@luxalgo/vela-pinets/audit';
import { observedWorkspaceHistory, requestedHistoryMarketKey, subscribeWorkspaceHistoryRequests } from './workspace-history-observer.ts';
import {
  BACKTEST_CONTEXT_SELECT,
  BACKTEST_SUMMARY_CONTEXT_SELECT,
  CURRENT_VELA_BACKTEST_CAPABILITIES,
  type BacktestAdapterEvent,
  type BacktestAdapterSeriesPoint,
  type BacktestAdapterTrade,
  type BacktestAdapterReportPoint,
  type BacktestAdapterReportSeries,
  type BacktestAdapterReportTail,
  type BacktestAdapterAuditLedger,
  type BacktestAdapterAuditState,
  backtestAdapterErrorOf,
  type BacktestAdapterError,
  type BacktestAdapterFinality,
  type BacktestAdapterKey,
  type BacktestAdapterLedgerState,
  type BacktestAdapterSeriesState,
  type BacktestAdapterListener,
  type BacktestAdapterExecutionState,
  type BacktestAdapterHistoryState,
  type BacktestAdapterPrecisionState,
  type BacktestAdapterParameterState,
  type BacktestAdapterProvenance,
  type BacktestAdapterSnapshot,
  type BacktestAdapterStatus,
} from './backtest-adapter-types.ts';

const KEY_SEPARATOR = '\u0000';

/**
 * `reportSeries` and `reportTail` are local Vela-PineTS extension keys. Vela
 * forwards context selections to the engine without a runtime whitelist; the
 * cast is intentionally isolated here so registry Vela remains untouched.
 */
const BACKTEST_REPORT_CONTEXT_SELECT = Object.freeze([
  ...BACKTEST_CONTEXT_SELECT,
  'reportSeries',
  'auditLedger',
]) as unknown as ContextSelect;

const BACKTEST_TAIL_CONTEXT_SELECT = Object.freeze([
  ...BACKTEST_SUMMARY_CONTEXT_SELECT,
  'trades',
  'reportTail',
  'auditLedger',
]) as unknown as ContextSelect;

type ReportContextSnapshot = EngineContextSnapshot & {
  readonly reportSeries?: unknown;
  readonly reportTail?: unknown;
  readonly auditLedger?: unknown;
};

type ReportIdentityStrategy = NonNullable<EngineContextSnapshot['strategy']> & {
  readonly reportRunId?: unknown;
  readonly reportSnapshotRevision?: unknown;
  readonly reportPointCount?: unknown;
};

type Unsubscribe = () => void;

interface ContextRead {
  readonly purpose: 'summary' | 'report';
  readonly revision: number;
  readonly epoch: number;
}

interface Entry {
  readonly key: BacktestAdapterKey;
  handle: IndicatorHandle;
  readonly cellId: string;
  readonly indicatorId: string;
  /** Monotonic key generation; never reused after remove/re-add. */
  readonly generation: number;
  epoch: number;
  revision: number;
  visible: boolean;
  run: ScriptRun | null;
  /** Engine context may still belong to the prior market while security() awaits. */
  invalidatedMarketRunId: string | null;
  awaitingMarketRun: boolean;
  context: EngineContextSnapshot | null;
  trades: readonly BacktestAdapterTrade[] | null;
  auditLedger: BacktestAdapterAuditLedger | null;
  auditState: BacktestAdapterAuditState;
  ledgerState: BacktestAdapterLedgerState;
  ledgerRevision: number | null;
  reportSeries: BacktestAdapterReportSeries | null;
  seriesState: BacktestAdapterSeriesState;
  seriesRevision: number | null;
  seriesExpectation: {
    readonly runId: string;
    readonly minSnapshotRevision: number;
  } | null;
  /** True only for the live tick read that may observe a projection gap. */
  mixedTickProjectionAllowed: boolean;
  lastPublishedSnapshot: BacktestAdapterSnapshot | null;
  ledgerInFlight: Promise<void> | null;
  /** Request identity doubles as its sequence token. Report reads own both
   * successful and failed ledger state; summary reads never supersede them. */
  summaryRead: ContextRead | null;
  reportRead: ContextRead | null;
  desiredLedger: {
    readonly epoch: number;
    readonly revision: number;
    readonly run: ScriptRun;
    readonly handle: IndicatorHandle;
    readonly binding: CellBinding;
    readonly read: ContextRead;
  } | null;
  error: Error | null;
  errorDetails: BacktestAdapterError | null;
  noData: boolean;
  /** Vela deep-history coverage, independent of ScriptRun.complete. */
  historyLoaded: number | null;
  historyTarget: number | null;
  historyBarsLoaded: number | null;
  historyOldestTime: number | null;
  historyComplete: boolean | null;
  historyReason: 'depth' | 'genesis' | 'aborted' | null;
  historyError: string | null;
}

interface CellBinding {
  readonly cell: ChartCell;
  readonly chart: Vela;
  /** Identity token for a chart instance, including cell-id reuse. */
  readonly generation: number;
  /** History belongs to a chart load, not to whichever strategies existed then. */
  loadGeneration: number;
  loadingMarket: string | null;
  marketCommitted: boolean;
  observedMarket: string | null;
  /** A settled zero-bar load is a market fact, not a strategy execution fact.
   * Keep it while indicators are hidden so showing one cannot resurrect a
   * cached report (or turn the EMPTY state into compiling). */
  noData: boolean;
  history: HistoryFacts;
  readonly disposers: Unsubscribe[];
  readonly handles: Map<string, Unsubscribe>;
  /** Coalesce Vela's synchronous added/context/ready announcement burst. */
  readonly bootstrapInFlight: Map<string, {
    readonly handle: IndicatorHandle;
    readonly task: Promise<void>;
  }>;
}

type HistoryFacts = Pick<Entry, 'historyLoaded' | 'historyTarget' | 'historyBarsLoaded'
  | 'historyOldestTime' | 'historyComplete' | 'historyReason' | 'historyError'>;

function emptyHistoryFacts(): HistoryFacts {
  return { historyLoaded: null, historyTarget: null, historyBarsLoaded: null,
    historyOldestTime: null, historyComplete: null, historyReason: null, historyError: null };
}

function historyMarketKey(event: { symbol?: string; timeframe?: string }): string | null {
  return event.symbol !== undefined && event.timeframe !== undefined
    ? JSON.stringify([event.symbol, event.timeframe]) : null;
}

export interface BacktestResultsAdapterOptions {
  /** Optional diagnostic hook. Adapter failures never escape into Vela callbacks. */
  readonly onDiagnostic?: (message: string, error?: unknown) => void;
}

/**
 * Adapts Vela's public script/context events into a small, revision-guarded stream
 * for the Backtesting feature. It deliberately does not calculate report metrics or
 * persist results; those concerns belong to the domain and application layers.
 */
export class VelaBacktestResultsAdapter {
  private readonly workspace: VelaWorkspace;
  private readonly listeners = new Set<BacktestAdapterListener>();
  private readonly entries = new Map<string, Entry>();
  private readonly cells = new Map<string, CellBinding>();
  private readonly workspaceDisposers: Unsubscribe[] = [];
  private readonly onDiagnostic?: (message: string, error?: unknown) => void;
  private bootstrapPromise: Promise<void> | null = null;
  private destroyed = false;
  private applicationEpoch = 0;
  private bindingGeneration = 0;
  private readonly keyGenerations = new Map<string, number>();
  private readonly historyRetries = new Map<CellBinding, {
    readonly token: object;
    readonly generation: number;
    readonly market: string | null;
    readonly promise: Promise<void>;
  }>();

  constructor(
    workspace: VelaWorkspace,
    options: BacktestResultsAdapterOptions = {},
  ) {
    this.workspace = workspace;
    this.onDiagnostic = options.onDiagnostic;
  }

  /**
   * Bind events before inspecting existing cells. This is important because a
   * restored workspace may finish a strategy run while bootstrap is enumerating it.
   * The method is idempotent and safe to call from app startup more than once.
   */
  bootstrap(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.bootstrapPromise) return this.bootstrapPromise;
    const bootstrap = (async () => {
      this.bindWorkspaceEvents();

      const cells = this.workspace.cells();
      cells.forEach((cell) => this.bindCell(cell));

      await Promise.all(cells.map((cell) => this.bootstrapCell(cell)));
    })();
    // A transient bind/bootstrap failure must be retryable. Keep a successful
    // promise for idempotent callers, but clear a rejected one so Controller's
    // retry path can subscribe/bootstrap again without duplicating listeners.
    this.bootstrapPromise = bootstrap.catch((error: unknown) => {
      this.bootstrapPromise = null;
      this.resetBindingsAfterBootstrapFailure();
      throw error;
    });
    return this.bootstrapPromise;
  }

  /** Alias useful to composition roots that call adapters `start()`. */
  start(): Promise<void> {
    return this.bootstrap();
  }

  /** Explicit user retry bypasses the successful startup promise cache. */
  async retry(key?: BacktestAdapterKey): Promise<void> {
    if (this.destroyed) return;
    if (!this.bootstrapPromise) await this.bootstrap();
    const entries = key ? [this.entries.get(keyOf(key))].filter((entry): entry is Entry => !!entry)
      : [...this.entries.values()].filter((entry) => !!entry.error);
    await Promise.all(entries.map(async (entry) => {
      const binding = this.cells.get(entry.cellId);
      if (!binding || !this.isHandleCurrent(binding, entry.handle)) return;
      let retry = this.historyRetries.get(binding);
      if (retry && (retry.generation !== binding.loadGeneration
        || retry.market !== requestedHistoryMarketKey(binding.chart.market))) {
        this.historyRetries.delete(binding);
        retry = undefined;
      }
      if (entry.historyReason === 'aborted' || retry) {
        if (!retry) {
          // Same bars/symbol alone is a Vela no-op. An explicit empty data
          // array requests a fresh online load through its public API; it is
          // not an offline fixture. Preserve the ORIGINAL requested depth,
          // never the truncated ledger's loaded count. Load events own reset.
          const token = {};
          const promise = (async () => {
            await binding.chart.setMarket({ bars: binding.chart.market.bars ?? entry.historyTarget ?? 500, data: [] });
            if (this.isBindingCurrent(binding) && this.historyRetries.get(binding)?.token === token) {
              await binding.chart.historyComplete();
            }
          })();
          retry = { token, generation: binding.loadGeneration,
            market: requestedHistoryMarketKey(binding.chart.market), promise };
          this.historyRetries.set(binding, retry);
        }
        try { await retry.promise; }
        finally { if (this.historyRetries.get(binding) === retry) this.historyRetries.delete(binding); }
        return;
      }
      const revision = entry.revision;
      entry.error = null;
      entry.errorDetails = null;
      entry.ledgerState = 'pending';
      entry.mixedTickProjectionAllowed = false;
      this.emitSnapshot(entry);
      if (entry.run) {
        this.requestLedger(entry, entry.run, revision, entry.handle, binding);
        await entry.ledgerInFlight;
      } else {
        await this.pullHandleContext(entry, entry.handle, revision, 'manual retry', binding);
      }
    }));
  }

  subscribe(listener: BacktestAdapterListener): Unsubscribe {
    if (this.destroyed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Convenience stream for consumers that only render snapshots. */
  subscribeSnapshots(listener: (snapshot: BacktestAdapterSnapshot) => void): Unsubscribe {
    return this.subscribe((event) => {
      if (event.type === 'snapshot') listener(event.snapshot);
    });
  }

  getSnapshot(key: BacktestAdapterKey): BacktestAdapterSnapshot | undefined {
    const entry = this.entries.get(keyOf(key));
    return entry ? this.readableSnapshotOf(entry) : undefined;
  }

  listSnapshots(): BacktestAdapterSnapshot[] {
    return [...this.entries.values()].map((entry) => this.readableSnapshotOf(entry));
  }

  /**
   * Read one explicitly plotted series through Vela's public ScriptRun API.
   *
   * PineTS does not publish an account equity curve as a separate broker
   * stream.  A strategy can, however, plot `strategy.equity` (or any other
   * value), and `run.series()` exposes that full history.  The read is tied to
   * the revision/epoch that requested it; a late result from an old run is
   * discarded instead of being attributed to the current report.
   *
   * `null` means that no current run/series exists (or that the read became
   * stale).  An empty array is a valid, settled series with no points.
   */
  async readSeries(
    key: BacktestAdapterKey,
    seriesKey: string,
  ): Promise<readonly BacktestAdapterSeriesPoint[] | null> {
    const entry = this.entries.get(keyOf(key));
    const run = entry?.run;
    if (!entry || !run || typeof run.series !== 'function' || !seriesKey.trim()) return null;
    const revision = entry.revision;
    const epoch = entry.epoch;
    const binding = this.cells.get(entry.cellId);
    const handle = entry.handle;
    try {
      const points = await run.series(seriesKey);
      if (!this.isCurrent(entry, revision, epoch, binding, handle)) {
        this.emitStale(key, revision, epoch, 'series resolved after a newer revision');
        return null;
      }
      return Object.freeze(points.map((point) => Object.freeze({
        time: point.time,
        value: typeof point.value === 'number' && Number.isFinite(point.value)
          ? point.value
          : null,
      })));
    } catch (error) {
      if (this.isCurrent(entry, revision, epoch, binding, handle)) {
        this.diagnose(`series() failed for ${seriesKey}`, error);
      } else {
        this.emitStale(key, revision, epoch, 'series rejected after a newer revision');
      }
      return null;
    }
  }

  /**
   * Stop all subscriptions and invalidate every pending context/ledger promise.
   * Vela's public API does not expose cancellation for `handle.context()` or
   * `run.trades()`, so generation checks are the cancellation boundary here.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.applicationEpoch += 1;
    while (this.workspaceDisposers.length > 0) this.workspaceDisposers.pop()?.();
    for (const binding of this.cells.values()) this.disposeCell(binding);
    this.cells.clear();
    for (const entry of this.entries.values()) entry.epoch += 1;
    this.entries.clear();
    this.listeners.clear();
  }

  private bindWorkspaceEvents(): void {
    this.workspaceDisposers.push(this.workspace.on('script:run', (run) => {
      this.handleScriptRun(run);
    }));
    this.workspaceDisposers.push(this.workspace.on('cell:created', ({ id }) => {
      const cell = this.workspace.cell(id);
      if (!cell) return;
      this.bindCell(cell);
      void this.bootstrapCell(cell);
    }));
    this.workspaceDisposers.push(this.workspace.on('cell:destroyed', ({ id }) => {
      this.disposeCellById(id);
      this.removeCellEntries(id);
    }));
    this.workspaceDisposers.push(this.workspace.on('layout:changed', () => {
      // A layout change can pool/reuse cells. Reconcile by stable cell identity.
      const live = new Set(this.workspace.cells().map((cell) => cell.id));
      this.workspace.cells().forEach((cell) => {
        const previous = this.cells.get(cell.id);
        this.bindCell(cell);
        if (this.cells.get(cell.id) !== previous) void this.bootstrapCell(cell);
      });
      for (const id of this.cells.keys()) {
        if (!live.has(id)) {
          this.disposeCellById(id);
          this.removeCellEntries(id);
        }
      }
    }));
  }

  private bindCell(cell: ChartCell): void {
    if (this.destroyed) return;
    const existing = this.cells.get(cell.id);
    if (existing?.chart === cell.chart) return;
    if (existing) {
      this.disposeCell(existing);
      // A structural workspace restore may reuse a cell id with a new Chart
      // instance. Drop the old generation before accepting events from the new
      // chart; otherwise a late ledger from the destroyed chart could be applied.
      this.removeCellEntries(cell.id);
    }

    const chart = cell.chart;
    const observed = observedWorkspaceHistory(this.workspace, cell);
    const binding: CellBinding = {
      cell,
      chart,
      generation: ++this.bindingGeneration,
      loadGeneration: 0,
      // Chart construction may start its initial load before the adapter can
      // subscribe. Adopt that requested generation so its first progress and
      // completion events are accepted even without an observed load:start.
      loadingMarket: observed?.historyEventsOpen === false ? null : requestedHistoryMarketKey(chart.market ?? {}),
      marketCommitted: observed?.marketCommitted ?? false,
      observedMarket: requestedHistoryMarketKey(chart.market ?? {}),
      noData: observed?.noData ?? false,
      history: observed ? {
        historyLoaded: observed.historyLoaded,
        historyTarget: observed.historyTarget,
        historyBarsLoaded: observed.historyBarsLoaded,
        historyOldestTime: observed.historyOldestTime,
        historyComplete: observed.historyComplete,
        historyReason: observed.historyReason,
        historyError: observed.historyError ?? null,
      } : emptyHistoryFacts(),
      disposers: [],
      handles: new Map(),
      bootstrapInFlight: new Map(),
    };

    binding.disposers.push(subscribeWorkspaceHistoryRequests(this.workspace, cell, () => {
      if (!this.isBindingCurrent(binding)) return;
      this.reconcileRequestedMarket(binding);
      this.adoptHistoryFailure(binding);
    }));

    binding.disposers.push(chart.on('indicator:added', ({ id }) => {
      if (!this.isBindingCurrent(binding)) return;
      this.bindHandle(binding, id);
      const handle = this.findHandle(chart, id);
      if (handle && this.isHandleCurrent(binding, handle)) {
        this.startBootstrapHandle(cell.id, handle, binding);
      }
    }));
    binding.disposers.push(chart.on('indicator:removed', ({ id }) => {
      if (!this.isBindingCurrent(binding)) return;
      // A chart can dispatch a queued removal after its handle has already been
      // replaced. Never let that old event delete the replacement entry.
      if (this.findHandle(chart, id)) return;
      binding.handles.get(id)?.();
      binding.handles.delete(id);
      this.removeEntry({ cellId: cell.id, indicatorId: id });
    }));
    binding.disposers.push(chart.on('indicator:visibility', ({ id, visible }) => {
      if (!this.isBindingCurrent(binding)) return;
      const handle = this.findHandle(chart, id);
      if (!handle || !this.isHandleCurrent(binding, handle)) return;
      const entry = this.entries.get(keyOf({ cellId: cell.id, indicatorId: id }));
      if (!entry) return;
      entry.visible = visible;
      if (!visible) {
        this.invalidateEntry(entry, 'hidden');
        this.emitSnapshot(entry);
      } else {
        // A hidden indicator must not make a settled empty market look like a
        // new execution.  In particular, do not pull a cached context here:
        // some engines retain the previous market's report in that context.
        if (binding.noData) {
          entry.error = null;
          entry.errorDetails = null;
          entry.noData = true;
          entry.ledgerState = 'idle';
          entry.auditLedger = null;
          entry.auditState = 'idle';
          entry.reportSeries = null;
          entry.seriesState = 'idle';
          entry.seriesRevision = null;
          entry.seriesExpectation = null;
          this.emitSnapshot(entry);
          return;
        }
        entry.error = null;
        entry.errorDetails = null;
        entry.revision += 1;
        entry.ledgerState = entry.trades ? 'ready' : 'idle';
        entry.auditLedger = null;
        entry.auditState = 'pending';
        entry.seriesState = entry.reportSeries ? 'ready' : 'idle';
        this.emitSnapshot(entry);
        void this.pullHandleContext(entry, handle, entry.revision, 'shown', binding);
      }
    }));
    binding.disposers.push(chart.on('indicator:inputs', ({ id }) => {
      if (!this.isBindingCurrent(binding)) return;
      const handle = this.findHandle(chart, id);
      if (!handle || !this.isHandleCurrent(binding, handle)) return;
      const entry = this.entries.get(keyOf({ cellId: cell.id, indicatorId: id }));
      if (!entry) return;
      entry.revision += 1;
      entry.error = null;
      entry.errorDetails = null;
      entry.ledgerState = 'pending';
      entry.reportSeries = null;
      entry.auditLedger = null;
      entry.auditState = 'pending';
      entry.seriesState = 'pending';
      entry.seriesRevision = null;
      entry.seriesExpectation = null;
      this.emitSnapshot(entry);
    }));
    binding.disposers.push(chart.on('indicator:error', ({ id, error }) => {
      if (!this.isBindingCurrent(binding)) return;
      const handle = this.findHandle(chart, id);
      if (!handle || !this.isHandleCurrent(binding, handle)) return;
      const entry = this.entries.get(keyOf({ cellId: cell.id, indicatorId: id }));
      if (!entry) return;
      entry.error = error;
      entry.errorDetails = backtestAdapterErrorOf(error);
      entry.ledgerState = entry.trades ? 'ready' : 'error';
      entry.auditLedger = null;
      entry.auditState = 'error';
      this.emit({
        type: 'error',
        key: entry.key,
        revision: entry.revision,
        epoch: entry.epoch,
        error,
        errorDetails: entry.errorDetails,
      });
      this.emitSnapshot(entry);
    }));
    binding.disposers.push(chart.on('load:start', (market) => {
      if (!this.isBindingCurrent(binding)) return;
      this.invalidateCell(cell.id, 'load-start');
      binding.loadingMarket = requestedHistoryMarketKey(chart.market ?? market);
      binding.observedMarket = requestedHistoryMarketKey(chart.market ?? market);
    }));
    binding.disposers.push(chart.on('load:end', (market) => {
      if (!this.isBindingCurrent(binding)) return;
      const eventMarket = historyMarketKey(market);
      const requestedMarket = historyMarketKey(chart.market ?? {});
      // A superseded load may finish after the winning market. Do not let its
      // bar count overwrite the current market's no-data/history facts.
      if (eventMarket !== null && requestedMarket !== null && eventMarket !== requestedMarket) return;
      this.reconcileRequestedMarket(binding, market);
      if (binding.observedMarket !== null && binding.loadingMarket !== binding.observedMarket) return;
      const { bars } = market;
      this.adoptHistoryFailure(binding);
      binding.noData = !binding.history.historyError && bars === 0;
      for (const entry of this.entriesForCell(cell.id)) {
        entry.noData = binding.noData;
        if (entry.noData) {
          entry.error = null;
          entry.errorDetails = null;
          entry.run = null;
          entry.mixedTickProjectionAllowed = false;
          entry.context = null;
          entry.trades = null;
          entry.ledgerRevision = null;
          entry.ledgerState = 'idle';
          entry.auditLedger = null;
          entry.auditState = 'idle';
          entry.reportSeries = null;
          entry.seriesState = 'idle';
          entry.seriesRevision = null;
          entry.seriesExpectation = null;
        }
        this.emitSnapshot(entry);
      }
    }));
    binding.disposers.push(chart.on('market:changed', (market) => {
      if (!this.isBindingCurrent(binding)) return;
      // Vela emits market:changed AFTER loading/reexecuting the new market.
      // load:start already invalidated the previous generation. Do not erase
      // this generation's newly observed completion on its closing notification.
      const eventMarket = historyMarketKey(market);
      const requestedEventMarket = historyMarketKey(chart.market ?? {});
      if (eventMarket !== null && requestedEventMarket !== null && eventMarket !== requestedEventMarket) return;
      const marketKey = requestedHistoryMarketKey(chart.market ?? market);
      this.reconcileRequestedMarket(binding, market);
      if (marketKey !== null && marketKey === binding.loadingMarket) {
        // Commit the requested identity, but do not confuse head paint with
        // completion of detached history backfill.
        binding.marketCommitted = true;
        // A quick head paint commits the market BEFORE detached deep
        // backfill finishes. Keep that generation open until completion.
        if (binding.history.historyComplete === true) binding.loadingMarket = null;
        return;
      }
      this.invalidateCell(cell.id, 'market-changed');
    }));
    binding.disposers.push(chart.on('history:progress', ({ loaded, target }) => {
      if (!this.isBindingCurrent(binding)) return;
      this.reconcileRequestedMarket(binding);
      const requestedMarket = requestedHistoryMarketKey(chart.market ?? {});
      if (requestedMarket !== null && binding.loadingMarket !== requestedMarket) return;
      Object.assign(binding.history, {
        historyLoaded: finiteNonNegativeInteger(loaded),
        historyTarget: finiteNonNegativeInteger(target),
        historyBarsLoaded: finiteNonNegativeInteger(loaded),
        historyComplete: false,
        historyReason: null,
      });
      for (const entry of this.entriesForCell(cell.id)) {
        // A completed head run can still be backed by a progressively
        // backfilled history.  Do not infer finality from `run.complete`:
        // that flag only describes the bars currently visible to the worker.
        // Keep a settled head ledger usable (the UI labels it partial), while
        // an actually computing run remains unavailable until the full load.
        entry.historyLoaded = finiteNonNegativeInteger(loaded);
        entry.historyTarget = finiteNonNegativeInteger(target);
        entry.historyBarsLoaded = entry.historyLoaded;
        entry.historyComplete = false;
        entry.historyReason = null;
        // Retain a settled head ledger for race/identity handling while the
        // chart backfills older candles. `statusOf()` exposes `partial` and
        // the controller gates report capabilities on finality, so retaining
        // these rows does not present them as a final backtest or cause a
        // shallow result to leak into the Dock. Once history completes the
        // current run is re-read atomically below. A genuinely incomplete run
        // has no safe ledger to retain and remains pending as before.
        if (entry.run && !entry.run.complete) {
          entry.ledgerState = 'idle';
          entry.auditLedger = null;
          entry.auditState = 'idle';
          entry.reportSeries = null;
          entry.seriesState = 'idle';
          entry.seriesRevision = null;
          entry.seriesExpectation = null;
        }
        this.emitSnapshot(entry);
      }
    }));
    binding.disposers.push(chart.on('history:complete', ({ reason, oldestTime, barsLoaded }) => {
      if (!this.isBindingCurrent(binding)) return;
      this.reconcileRequestedMarket(binding);
      const requestedMarket = requestedHistoryMarketKey(chart.market ?? {});
      if (requestedMarket !== null && binding.loadingMarket !== requestedMarket) return;
      this.adoptHistoryFailure(binding);
      const completed = observedWorkspaceHistory(this.workspace, cell);
      if (completed && !completed.historyError && completed.historyComplete === true && reason !== 'aborted') {
        binding.history.historyError = null;
        for (const entry of this.entriesForCell(cell.id)) {
          if (!entry.historyError) continue;
          entry.historyError = null;
          entry.error = null;
          entry.errorDetails = null;
        }
      }
      if (binding.history.historyError) reason = 'aborted';
      binding.history.historyBarsLoaded = finiteNonNegativeInteger(barsLoaded);
      binding.history.historyLoaded = binding.history.historyBarsLoaded ?? binding.history.historyLoaded;
      binding.history.historyTarget = completed?.historyTarget
        ?? binding.history.historyTarget ?? binding.history.historyLoaded;
      binding.history.historyOldestTime = finiteTimestamp(oldestTime);
      binding.history.historyComplete = true;
      binding.history.historyReason = reason;
      if (binding.marketCommitted) binding.loadingMarket = null;
      for (const entry of this.entriesForCell(cell.id)) {
        const needsHistoryRefresh = entry.historyComplete !== true || entry.ledgerState !== 'ready';
        entry.historyBarsLoaded = finiteNonNegativeInteger(barsLoaded);
        entry.historyLoaded = entry.historyBarsLoaded ?? entry.historyLoaded;
        entry.historyTarget = binding.history.historyTarget ?? entry.historyTarget ?? entry.historyLoaded;
        entry.historyOldestTime = finiteTimestamp(oldestTime);
        entry.historyComplete = true;
        entry.historyReason = reason;
        if (reason !== 'aborted' && (entry.noData || barsLoaded === 0)) {
          this.emitSnapshot(entry);
          continue;
        }
        // A completed head run may still have a provisional ledger. Keep the
        // rows in memory for stale-result protection, but make the public
        // snapshot computing until the history-complete refresh is accepted.
        // This avoids a ready/partial -> ready transition exposing the shallow
        // ledger for one render frame.
        if (entry.run
          && entry.run.complete
          && entry.run.cause !== 'tick'
          && needsHistoryRefresh
          && reason !== 'aborted') {
          entry.ledgerState = 'pending';
          entry.ledgerRevision = null;
          entry.auditLedger = null;
          entry.auditState = 'pending';
          entry.seriesState = entry.reportSeries ? 'pending' : 'idle';
          entry.seriesRevision = null;
          entry.seriesExpectation = null;
        } else if (!entry.run
          && needsHistoryRefresh
          && entry.context?.strategy
          && reason !== 'aborted') {
          // A restored strategy may have produced a settled context before
          // the history stream announced its deep backfill. There is no
          // ScriptRun to trigger the normal ledger request in that path, so
          // force a fresh context read after history settles; otherwise the
          // shallow head ledger would be promoted to historical-final.
          entry.ledgerState = 'pending';
          entry.ledgerRevision = null;
          entry.auditLedger = null;
          entry.auditState = 'pending';
          entry.seriesState = entry.reportSeries ? 'pending' : 'idle';
          entry.seriesRevision = null;
          entry.seriesExpectation = null;
        }
        if (reason === 'aborted' && (entry.run || entry.historyError)) {
          entry.ledgerState = 'error';
          entry.auditLedger = null;
          entry.auditState = 'error';
          entry.error ??= new Error(entry.historyError ?? 'Vela history backfill aborted');
          entry.errorDetails ??= backtestAdapterErrorOf(entry.error);
        }
        this.emitSnapshot(entry);
        // The history stream is authoritative for deep backfill completion,
        // but it is independent from ScriptRun.complete.  Re-read the
        // completed run's atomic report/ledger now so a head-only snapshot can
        // never become the final report merely because no second script:run
        // event was emitted.
        if (entry.run
          && entry.run.complete
          && entry.run.cause !== 'tick'
          && needsHistoryRefresh
          && reason !== 'aborted') {
          this.requestLedger(entry, entry.run, entry.revision, entry.handle, binding);
          continue;
        }
        // A restored strategy can be discovered while its first context is
        // still computing.  In that case bootstrap deliberately leaves the
        // ledger unresolved instead of treating an omitted `trades` field as
        // an empty ledger.  Once the full history settles, pull the context
        // again so a genuine zero-trade strategy can reach `no-trades` even
        // when no second `script:run` event is emitted by the engine.
        if (!entry.run
          && needsHistoryRefresh
          && reason !== 'aborted') {
          void this.pullHandleContext(
            entry,
            entry.handle,
            entry.revision,
            'history-complete',
            binding,
          );
        }
      }
    }));
    binding.disposers.push(chart.on('context:changed', ({ id }) => {
      if (!this.isBindingCurrent(binding)) return;
      const entry = this.entries.get(keyOf({ cellId: cell.id, indicatorId: id }));
      const handle = this.findHandle(chart, id);
      if (!handle || !this.isHandleCurrent(binding, handle)) return;
      if (!entry) {
        this.startBootstrapHandle(cell.id, handle, binding);
      } else if (entry.run) {
        void this.pullHandleContext(
          entry,
          handle,
          entry.revision,
          'context-changed',
          binding,
          // A tick recovery can observe a restarted worker before another
          // script:run. Request an explicit tail, not an unselected ledger.
          entry.run.cause === 'tick' && entry.seriesExpectation
            ? BACKTEST_TAIL_CONTEXT_SELECT : BACKTEST_SUMMARY_CONTEXT_SELECT,
        );
      } else {
        this.startBootstrapHandle(cell.id, handle, binding);
      }
    }));

    this.cells.set(cell.id, binding);
    chart.indicators().forEach((handle) => this.bindHandle(binding, handle.id));
  }

  private bindHandle(binding: CellBinding, id: string): void {
    if (binding.handles.has(id)) return;
    const handle = this.findHandle(binding.chart, id);
    if (!handle) return;
    const disposers: Unsubscribe[] = [];
    disposers.push(handle.on('ready', () => {
      if (!this.isHandleCurrent(binding, handle)) return;
      this.startBootstrapHandle(binding.cell.id, handle, binding);
    }));
    disposers.push(handle.on('error', ({ error }) => {
      if (!this.isHandleCurrent(binding, handle)) return;
      const entry = this.entries.get(keyOf({ cellId: binding.cell.id, indicatorId: id }));
      if (!entry) return;
      entry.error = error;
      entry.errorDetails = backtestAdapterErrorOf(error);
      entry.ledgerState = entry.trades ? 'ready' : 'error';
      entry.auditLedger = null;
      entry.auditState = 'error';
      this.emit({
        type: 'error',
        key: entry.key,
        revision: entry.revision,
        epoch: entry.epoch,
        error,
        errorDetails: entry.errorDetails,
      });
      this.emitSnapshot(entry);
    }));
    binding.handles.set(id, () => {
      while (disposers.length > 0) disposers.pop()?.();
    });
  }

  private async bootstrapCell(cell: ChartCell): Promise<void> {
    if (this.destroyed) return;
    const binding = this.cells.get(cell.id);
    if (!binding || binding.cell !== cell || binding.chart !== cell.chart) return;

    // `historyComplete()` is a public, non-rejecting readiness seam. It may already
    // be resolved when bootstrap runs; in that case the reason is intentionally
    // unknown because the corresponding event may have happened before subscription.
    const loadGeneration = binding.loadGeneration;
    void cell.chart.historyComplete().then(() => {
      if (!this.isBindingCurrent(binding) || loadGeneration !== binding.loadGeneration) return;
      for (const entry of this.entriesForCell(cell.id)) {
        if (entry.historyComplete === null) {
          // The readiness Promise also resolves after abort. Without the
          // reason-bearing event it proves readiness, not complete history.
          entry.historyComplete = null;
          entry.historyReason = null;
          entry.historyBarsLoaded ??= entry.historyLoaded;
          entry.historyTarget ??= entry.historyLoaded;
          this.emitSnapshot(entry);
        }
      }
    }).catch((error: unknown) => {
      this.diagnose('historyComplete() failed during bootstrap', error);
    });

    await Promise.all(binding.chart.indicators().map((handle) => this.bootstrapHandleOnce(cell.id, handle, binding)));
  }

  /**
   * Vela announces a newly mounted indicator with three synchronous signals:
   * chart `indicator:added`, chart `context:changed`, and handle `ready`.
   * They all describe the same first context, so only one async read may
   * establish the initial entry. Existing callers still receive the shared
   * promise; event callbacks diagnose an unexpected rejection instead of
   * creating an unhandled browser promise.
   */
  private bootstrapHandleOnce(
    cellId: string,
    handle: IndicatorHandle,
    binding: CellBinding,
  ): Promise<void> {
    if (this.destroyed || handle.nativeType || !this.isHandleCurrent(binding, handle)) {
      return Promise.resolve();
    }
    const existing = binding.bootstrapInFlight.get(handle.id);
    // A remove/re-add can reuse an indicator id while the old handle's context
    // promise is still pending. Coalesce only requests for the same object;
    // the replacement must get its own bootstrap task.
    if (existing?.handle === handle) return existing.task;
    const task = this.bootstrapHandle(cellId, handle, binding);
    binding.bootstrapInFlight.set(handle.id, { handle, task });
    task.then(
      () => this.clearBootstrapTask(binding, handle.id, task),
      (error: unknown) => {
        this.clearBootstrapTask(binding, handle.id, task);
        this.diagnose(`initial context bootstrap failed for ${handle.id}`, error);
      },
    );
    return task;
  }

  private startBootstrapHandle(
    cellId: string,
    handle: IndicatorHandle,
    binding: CellBinding,
  ): void {
    void this.bootstrapHandleOnce(cellId, handle, binding).catch((error: unknown) => {
      // `bootstrapCell()` intentionally propagates failures to its caller so a
      // startup retry remains possible. Event-driven retries are best effort.
      this.diagnose(`event-driven context bootstrap failed for ${handle.id}`, error);
    });
  }

  private clearBootstrapTask(
    binding: CellBinding,
    id: string,
    task: Promise<void>,
  ): void {
    if (binding.bootstrapInFlight.get(id)?.task === task) binding.bootstrapInFlight.delete(id);
  }

  private async bootstrapHandle(
    cellId: string,
    handle: IndicatorHandle,
    binding: CellBinding,
  ): Promise<void> {
    if (this.destroyed || handle.nativeType || !this.isHandleCurrent(binding, handle)) return;
    const key = { cellId, indicatorId: handle.id } satisfies BacktestAdapterKey;
    const generation = this.keyGeneration(key);
    const loadGeneration = binding.loadGeneration;
    const requestedMarket = requestedHistoryMarketKey(binding.chart.market ?? {});
    let entry = this.entries.get(keyOf(key));
    if (entry?.run) return;
    // Existing strategies participate in the same request ordering as Retry
    // before the first await. Initial discovery has no publicly retryable
    // entry yet; any run creating one during the read supersedes discovery.
    if (entry) entry.revision += 1;
    let read = entry ? this.beginContextRead(entry, 'report') : undefined;
    const stillOwnsRead = (): boolean => {
      if (this.destroyed || !this.isHandleCurrent(binding, handle)
        || this.keyGeneration(key) !== generation || binding.loadGeneration !== loadGeneration
        || requestedHistoryMarketKey(binding.chart.market ?? {}) !== requestedMarket) return false;
      if (!entry || !read) return !this.entries.has(keyOf(key));
      return !entry.run && this.isCurrent(entry, read.revision, read.epoch, binding, handle)
        && this.ownsContextRead(entry, read);
    };
    let context: EngineContextSnapshot | null;
    try {
      context = await this.readContext(handle, BACKTEST_REPORT_CONTEXT_SELECT);
      // A restored indicator can announce its handle before the worker has
      // published a context. Null is absence, unlike transport rejection.
      if (context === null) {
        await Promise.resolve();
        context = await this.readContext(handle, BACKTEST_REPORT_CONTEXT_SELECT);
      }
    } catch (error) {
      if (!stillOwnsRead()) return;
      if (!entry && isStrategyHandle(handle, null)) entry = this.ensureEntry(key, handle, binding) ?? undefined;
      if (entry) this.contextFailed(entry, error);
      return;
    }
    if (!stillOwnsRead()) {
      this.emitStale(key, read?.revision ?? 0, read?.epoch ?? this.applicationEpoch, 'bootstrap context resolved after a newer read');
      return;
    }

    const strategy = isStrategyHandle(handle, context);
    if (!strategy) {
      // A restored indicator can share an id with an earlier strategy after a code
      // change. Never leave the old report visible in that case.
      this.removeEntry(key);
      return;
    }

    if (!entry) {
      entry = this.ensureEntry(key, handle, binding) ?? undefined;
      if (entry) {
        entry.revision += 1;
        read = this.beginContextRead(entry, 'report');
      }
    }
    if (!entry || entry.generation !== generation || !this.isHandleCurrent(binding, handle)) return;
    entry.handle = handle;
    entry.visible = handle.visible;
    this.acceptContextRead(entry, context, handle, entry.revision, 'bootstrap', binding, BACKTEST_REPORT_CONTEXT_SELECT);
  }

  private handleScriptRun(run: WorkspaceScriptRun): void {
    if (this.destroyed) return;
    const key = { cellId: run.cell, indicatorId: run.id } satisfies BacktestAdapterKey;
    const binding = this.cells.get(run.cell);
    const handle = binding ? this.findHandle(binding.chart, run.id) : undefined;
    if (!binding || !handle || handle.nativeType || !this.isHandleCurrent(binding, handle)) {
      this.emitStale(key, 0, this.applicationEpoch, 'run arrived after indicator removal');
      return;
    }

    if (run.kind !== 'strategy') {
      this.removeEntry(key);
      return;
    }

    this.reconcileRequestedMarket(binding);
    const entry = this.ensureEntry(key, handle, binding);
    if (!entry || !this.isHandleCurrent(binding, handle)) return;
    // A zero-bar load is authoritative for the current market. Engines may
    // still flush a queued run from the previous market after load:end; never
    // let that event clear noData or reintroduce its ledger.
    if (binding.noData) {
      this.invalidateEntry(entry, 'run-after-empty-market');
      this.emitSnapshot(entry);
      return;
    }
    entry.handle = handle;
    entry.visible = handle.visible;
    entry.epoch = Math.max(entry.epoch, this.applicationEpoch);
    const announcedIdentity = reportIdentityFromStrategy(run.strategy);
    if (entry.awaitingMarketRun && entry.invalidatedMarketRunId !== null
      && announcedIdentity?.runId === entry.invalidatedMarketRunId) {
      this.emitStale(entry.key, entry.revision, entry.epoch, 'run belongs to the invalidated market');
      return;
    }
    entry.awaitingMarketRun = false;
    entry.revision += 1;
    entry.run = { ...run, ...detachedFrozen(run) };
    entry.mixedTickProjectionAllowed = run.cause === 'tick';
    entry.context = null;
    entry.error = null;
    entry.errorDetails = null;
    entry.noData = binding.noData;
    // Keep the last settled ledger across a provisional tick. A complete run will
    // replace it only after the matching asynchronous ledger read is accepted.
    if (run.complete && run.cause !== 'tick') {
      entry.trades = null;
      entry.ledgerState = 'pending';
      entry.ledgerRevision = null;
      entry.auditLedger = null;
      entry.auditState = 'pending';
      entry.reportSeries = null;
      entry.seriesState = 'pending';
      entry.seriesRevision = null;
      entry.seriesExpectation = null;
    } else if (entry.trades) {
      entry.ledgerState = 'pending';
      // A tick changes the broker event stream too. Keep no prior revision's
      // audit rows visible until the identity-bound tail is accepted.
      if (run.cause === 'tick') {
        entry.auditLedger = null;
        entry.auditState = 'pending';
      }
    } else {
      entry.ledgerState = 'idle';
      entry.auditLedger = null;
      entry.auditState = 'pending';
    }
    if (run.cause === 'tick') {
      entry.seriesState = entry.reportSeries ? 'pending' : 'idle';
    }
    // Keep the previously published exact curve visible while a forming-bar
    // tail is in flight. The accepted tail (or its full-series recovery) emits
    // the next revision atomically, avoiding an exact -> unavailable -> exact
    // UI flash on every market tick.
    if (run.cause !== 'tick' || (!entry.reportSeries && !entry.seriesExpectation)) {
      this.emitSnapshot(entry);
    }

    const revision = entry.revision;
    void this.pullHandleContext(
      entry,
      handle,
      revision,
      'script-run',
      binding,
      run.cause === 'tick' ? BACKTEST_TAIL_CONTEXT_SELECT : BACKTEST_SUMMARY_CONTEXT_SELECT,
    );
    if (run.complete && run.cause !== 'tick') {
      this.requestLedger(entry, run, revision, handle, binding);
    }
  }

  private requestLedger(
    entry: Entry,
    run: ScriptRun,
    revision: number,
    handle: IndicatorHandle,
    binding: CellBinding,
  ): void {
    entry.desiredLedger = { epoch: entry.epoch, revision, run, handle, binding,
      read: this.beginContextRead(entry, 'report') };
    if (entry.ledgerInFlight) return;
    entry.ledgerInFlight = this.drainLedger(entry);
    void entry.ledgerInFlight.catch((error: unknown) => {
      this.diagnose('strategy ledger request failed', error);
    });
  }

  private async drainLedger(entry: Entry): Promise<void> {
    try {
      while (!this.destroyed && entry.desiredLedger) {
        const desired = entry.desiredLedger;
        entry.desiredLedger = null;
        // The local bridge can return strategy, trades and its per-bar report
        // in one immutable context snapshot. Prefer that atomic read so an
        // equity path can never be paired with a ledger from another engine
        // evaluation. Third-party engines simply omit reportSeries and retain
        // the legacy ScriptRun.trades() fallback below.
        let reportContext: EngineContextSnapshot | null;
        try {
          reportContext = await this.readContext(
            desired.handle,
            BACKTEST_REPORT_CONTEXT_SELECT,
          );
        } catch (error) {
          if (this.isCurrent(entry, desired.revision, desired.epoch, desired.binding, desired.handle)
            && this.ownsContextRead(entry, desired.read)) this.contextFailed(entry, error);
          continue;
        }
        if (!this.isCurrent(
          entry,
          desired.revision,
          desired.epoch,
          desired.binding,
          desired.handle,
        ) || !this.ownsContextRead(entry, desired.read)) {
          this.emitStale(entry.key, desired.revision, desired.epoch, 'report context resolved after a newer revision');
          continue;
        }
        if (!canReplaceReportContext(entry, reportContext)) {
          this.contextFailed(entry, new Error('Report recovery returned a stale or mismatched engine identity'));
          continue;
        }
        const envelopeError = fullReportEnvelopeError(reportContext);
        if (envelopeError && !isMixedTickEnvelope(entry, reportContext)) {
          this.contextFailed(entry, envelopeError);
          continue;
        }
        if (isMixedTickEnvelope(entry, reportContext)) {
          acceptMixedTickEnvelope(entry, reportContext, desired.revision);
          this.emitSnapshot(entry);
          continue;
        }
        const reportSeries = reportSeriesOf(reportContext);
        const audit = auditLedgerOf(reportContext);
        entry.auditLedger = audit ?? null;
        entry.auditState = audit
          ? 'ready'
          : hasAuditPayload(reportContext) ? 'error' : 'idle';
        if (reportSeries && reportSeriesMatchesContext(reportSeries, reportContext)) {
          entry.context = reportContext;
          entry.trades = cloneTrades(reportContext?.trades ?? []);
          entry.ledgerRevision = desired.revision;
          entry.ledgerState = 'ready';
          entry.reportSeries = reportSeries;
          entry.seriesRevision = desired.revision;
          entry.seriesState = 'ready';
          entry.seriesExpectation = null;
          entry.error = null;
          entry.errorDetails = null;
          this.emitSnapshot(entry);
          continue;
        }
        if (reportIdentityOf(reportContext)) {
          // Identity-bearing local engines promise a full envelope for this
          // selection. Falling back to an unbound run.trades() would pair a
          // newer summary with an unknown ledger revision.
          this.contextFailed(entry, new Error('Full report read omitted its identity-bound series'));
          continue;
        }
        if ((reportContext as ReportContextSnapshot | null)?.reportSeries !== undefined) {
          this.contextFailed(entry, new Error('Rejected inconsistent PineTS report series'));
          continue;
        } else {
          entry.reportSeries = null;
          entry.seriesRevision = null;
          entry.seriesState = 'idle';
          entry.seriesExpectation = null;
        }

        let trades: readonly StrategyTrade[];
        try {
          trades = await desired.run.trades();
        } catch (error) {
          if (this.isCurrent(
            entry,
            desired.revision,
            desired.epoch,
            desired.binding,
            desired.handle,
          ) && this.ownsContextRead(entry, desired.read)) {
            entry.ledgerState = 'error';
            entry.error = toError(error);
            entry.errorDetails = backtestAdapterErrorOf(entry.error);
            this.emit({
              type: 'error',
              key: entry.key,
              revision: desired.revision,
              epoch: desired.epoch,
              error: entry.error,
              errorDetails: entry.errorDetails,
            });
            this.emitSnapshot(entry);
          } else {
            this.emitStale(entry.key, desired.revision, desired.epoch, 'ledger rejection');
          }
          continue;
        }

        if (!this.isCurrent(
          entry,
          desired.revision,
          desired.epoch,
          desired.binding,
          desired.handle,
        ) || !this.ownsContextRead(entry, desired.read)) {
          this.emitStale(entry.key, desired.revision, desired.epoch, 'ledger resolved after a newer revision');
          continue;
        }

        entry.trades = cloneTrades(trades);
        entry.context = reportContext;
        entry.ledgerRevision = desired.revision;
        entry.ledgerState = 'ready';
        entry.error = null;
        entry.errorDetails = null;
        this.emitSnapshot(entry);
      }
    } finally {
      entry.ledgerInFlight = null;
      // A run can arrive in the tiny window between the loop condition and the
      // finally block. Start one more drain for that desired revision.
      if (!this.destroyed && entry.desiredLedger && !entry.ledgerInFlight) {
        entry.ledgerInFlight = this.drainLedger(entry);
        void entry.ledgerInFlight.catch((error: unknown) => {
          this.diagnose('coalesced strategy ledger request failed', error);
        });
      }
    }
  }

  private async pullHandleContext(
    entry: Entry,
    handle: IndicatorHandle,
    revision: number,
    reason: string,
    binding: CellBinding,
    select: ContextSelect = BACKTEST_REPORT_CONTEXT_SELECT,
  ): Promise<void> {
    const epoch = entry.epoch;
    const readsLedger = (select as readonly string[]).includes('trades');
    const read = this.beginContextRead(entry, readsLedger ? 'report' : 'summary');
    let context: EngineContextSnapshot | null;
    try {
      context = await this.readContext(handle, select);
    } catch (error) {
      if (this.isCurrent(entry, revision, epoch, binding, handle)
        && this.ownsContextRead(entry, read)) this.contextFailed(entry, error);
      return;
    }
    if (!this.isCurrent(entry, revision, epoch, binding, handle) || !this.ownsContextRead(entry, read)) {
      this.emitStale(entry.key, revision, epoch, `${reason}: context resolved late`);
      return;
    }
    this.acceptContextRead(entry, context, handle, revision, reason, binding, select);
  }

  /** Shared acceptance for restored/bootstrap and normal report reads. */
  private acceptContextRead(
    entry: Entry,
    context: EngineContextSnapshot | null,
    handle: IndicatorHandle,
    revision: number,
    reason: string,
    binding: CellBinding,
    select: ContextSelect,
  ): void {
    const epoch = entry.epoch;
    const readsLedger = (select as readonly string[]).includes('trades');
    // A zero-bar market is authoritative even for indicators added after the
    // load. Never let a cached engine context recreate a report from the prior
    // market while the cell remains in no-data state.
    if (binding.noData || entry.noData) {
      entry.error = null;
      entry.errorDetails = null;
      entry.run = null;
      entry.mixedTickProjectionAllowed = false;
      entry.context = null;
      entry.trades = null;
      entry.ledgerState = 'idle';
      entry.ledgerRevision = null;
      entry.auditLedger = null;
      entry.auditState = 'idle';
      entry.reportSeries = null;
      entry.seriesState = 'idle';
      entry.seriesRevision = null;
      entry.seriesExpectation = null;
      this.emitSnapshot(entry);
      return;
    }
    // This is an expected engine transition, not a failed report transport.
    // A fresh read token alone cannot establish that its payload is fresh.
    if (entry.awaitingMarketRun) {
      // Another run id may belong to an intermediate, superseded market.
      // Only a current public ScriptRun event may release this market fence;
      // context() carries report identity, not requested market ownership.
      this.emitStale(entry.key, revision, epoch, `${reason}: awaiting current-market execution`);
      return;
    }
    if (!canReplaceReportContext(entry, context)) {
      this.emitStale(entry.key, revision, epoch, `${reason}: engine report identity regressed`);
      if (readsLedger) this.contextFailed(entry, new Error('Report recovery returned a stale or mismatched engine identity'));
      return;
    }
    if (!readsLedger) {
      // Projection absence is not an empty ledger. A summary is useful only
      // before a stronger report request has claimed this revision.
      entry.context = context;
      this.emitSnapshot(entry);
      return;
    }
    // Some engines expose the identity and trade ledger on a forming-bar tick
    // but temporarily omit both report projections while the exact curve is
    // being recomputed.  Once an identity-bound full series has been accepted,
    // that transition is safe to represent as a provisional ledger update:
    // retain the last exact curve, accept only same-run/newer trades, and do
    // not turn a transport/schema transition into a fatal report error.
    if (isMixedTickEnvelope(entry, context)) {
      acceptMixedTickEnvelope(entry, context, revision);
      this.emitSnapshot(entry);
      return;
    }
    if ((select as readonly string[]).includes('reportSeries')) {
      const envelopeError = fullReportEnvelopeError(context);
      if (envelopeError) {
        this.contextFailed(entry, envelopeError);
        return;
      }
    }
    entry.context = context;
    if (!entry.run && (!context?.strategy || context.phase === 'computing' || context.phase === 'streaming')) {
      // A restore may expose a transient context before its first run event.
      // It cannot prove a settled empty ledger (nor promote a partial one).
      entry.trades = null;
      entry.ledgerRevision = null;
      entry.ledgerState = context?.strategy ? 'pending' : 'idle';
      this.emitSnapshot(entry);
      return;
    }
    const audit = auditLedgerOf(context);
    entry.auditLedger = audit ?? null;
    entry.auditState = audit
      ? 'ready'
      : hasAuditPayload(context) ? 'error' : entry.auditState === 'pending' ? 'pending' : 'idle';
    let recoverFullSeries = false;
    let acceptedFullSeries = false;
    let acceptedTail = false;
    const fullSeries = reportSeriesOf(context);
    if (fullSeries && reportSeriesMatchesContext(fullSeries, context)) {
      entry.reportSeries = fullSeries;
      entry.seriesState = 'ready';
      entry.seriesRevision = revision;
      entry.seriesExpectation = null;
      acceptedFullSeries = true;
    } else if ((context as ReportContextSnapshot | null)?.reportSeries !== undefined) {
      this.contextFailed(entry, new Error('Rejected inconsistent PineTS report series'));
      return;
    }
    const tail = acceptedFullSeries ? undefined : reportTailOf(context);
    if (!acceptedFullSeries && tail && reportTailMatchesContext(tail, context)) {
      const merged = entry.reportSeries
        ? mergeReportTail(entry.reportSeries, tail, reportPointCount(context))
        : undefined;
      if (merged) {
        acceptedTail = true;
        entry.reportSeries = merged;
        entry.seriesState = 'ready';
        entry.seriesRevision = revision;
        entry.seriesExpectation = null;
      } else {
        // New run, missing baseline, a skipped bar/revision, or an empty tail:
        // a delta can no longer prove continuity. Recover through one guarded
        // full-series pull rather than remaining pending forever.
        if (!entry.reportSeries || entry.reportSeries.runId !== tail.runId) {
          entry.reportSeries = null;
        }
        entry.seriesState = 'pending';
        entry.seriesRevision = null;
        entry.seriesExpectation = {
          runId: tail.runId,
          minSnapshotRevision: tail.snapshotRevision,
        };
        recoverFullSeries = true;
      }
    } else if (!acceptedFullSeries && (context as ReportContextSnapshot | null)?.reportTail !== undefined) {
      entry.reportSeries = null;
      entry.seriesState = 'pending';
      entry.seriesRevision = null;
      const identity = reportIdentityOf(context);
      entry.seriesExpectation = identity
        ? { runId: identity.runId, minSnapshotRevision: identity.snapshotRevision }
        : null;
      this.diagnose('rejected inconsistent PineTS report tail');
      recoverFullSeries = entry.seriesExpectation !== null;
    }
    const acceptedAtomicLedger = readsLedger && (acceptedFullSeries || acceptedTail);
    if (acceptedAtomicLedger || context?.trades && entry.ledgerRevision === revision) {
      // The local bridge intentionally omits `trades` for an empty ledger.
      // A validated full/tail identity and our explicit trades selection
      // prove that absence means zero rows, not a prior revision to retain.
      entry.trades = cloneTrades(context?.trades ?? []);
      entry.ledgerRevision = revision;
      entry.ledgerState = 'ready';
    } else if (!entry.run && context?.strategy && (context.phase === 'idle' || context.phase === undefined)) {
      // Showing a previously suspended strategy can yield a settled context
      // without another script:run event (some engines restore the cached
      // session synchronously). Treat the explicitly idle strategy context as
      // the complete zero-or-more trade ledger instead of leaving the Dock in
      // `computing` forever. A computing/streaming context remains pending and
      // is still resolved by the normal run/ledger path.
      entry.trades = cloneTrades(context.trades ?? []);
      entry.ledgerRevision = revision;
      entry.ledgerState = 'ready';
    }
    if (recoverFullSeries) {
      void this.pullHandleContext(
        entry,
        handle,
        revision,
        `${reason}: full-series recovery`,
        binding,
        BACKTEST_REPORT_CONTEXT_SELECT,
      );
      return;
    }
    entry.error = null;
    entry.errorDetails = null;
    if (entry.run?.cause === 'tick' && entry.run.complete
      && entry.ledgerRevision !== revision) {
      // Ordinary engines may not publish reportSeries/reportTail, and an
      // empty ledger may be omitted from context. Neither proves that the
      // previous tick's rows remain valid. Resolve this run's async ledger
      // through the same revision/generation-guarded path as a history run.
      this.requestLedger(entry, entry.run, revision, handle, binding);
    }
    this.emitSnapshot(entry);
  }

  private async readContext(
    handle: IndicatorHandle,
    select: ContextSelect = BACKTEST_CONTEXT_SELECT,
  ): Promise<EngineContextSnapshot | null> {
    // One bounded follow-up turn handles transient worker transport failures;
    // exhausted reads remain errors, never a successful null/empty context.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return detachedFrozen(await handle.context(select));
      } catch (error) {
        this.diagnose(`context() failed for ${handle.id}`, error);
        if (attempt >= 1 || this.destroyed) throw error;
        await Promise.resolve();
      }
    }
  }

  private contextFailed(entry: Entry, failure: unknown): void {
    entry.error = toError(failure);
    entry.errorDetails = backtestAdapterErrorOf(entry.error);
    entry.ledgerState = 'error';
    entry.seriesState = 'error';
    this.emit({ type: 'error', key: entry.key, revision: entry.revision,
      epoch: entry.epoch, error: entry.error, errorDetails: entry.errorDetails });
    this.emitSnapshot(entry);
  }

  private beginContextRead(entry: Entry, purpose: ContextRead['purpose']): ContextRead {
    const read = { purpose, revision: entry.revision, epoch: entry.epoch };
    if (purpose === 'report') entry.reportRead = read;
    else entry.summaryRead = read;
    return read;
  }

  private ownsContextRead(entry: Entry, read: ContextRead): boolean {
    if (entry.revision !== read.revision || entry.epoch !== read.epoch) return false;
    if (read.purpose === 'report') return entry.reportRead === read;
    return entry.summaryRead === read
      && !(entry.reportRead?.revision === read.revision && entry.reportRead.epoch === read.epoch)
      && !(entry.ledgerState === 'ready' && entry.ledgerRevision === read.revision);
  }

  private ensureEntry(key: BacktestAdapterKey, handle: IndicatorHandle, binding: CellBinding): Entry | null {
    if (!this.isBindingCurrent(binding) || !this.isHandleCurrent(binding, handle)) return null;
    const encoded = keyOf(key);
    const existing = this.entries.get(encoded);
    if (existing) {
      if (existing.generation !== this.keyGeneration(key)) return existing;
      existing.handle = handle;
      return existing;
    }
    const entry: Entry = {
      key: { cellId: key.cellId, indicatorId: key.indicatorId },
      handle,
      cellId: key.cellId,
      indicatorId: key.indicatorId,
      generation: this.keyGeneration(key),
      epoch: this.applicationEpoch,
      revision: 0,
      visible: handle.visible,
      run: null,
      invalidatedMarketRunId: null,
      awaitingMarketRun: false,
      context: null,
      trades: null,
      auditLedger: null,
      auditState: 'idle',
      ledgerState: 'idle',
      ledgerRevision: null,
      reportSeries: null,
      seriesState: 'idle',
      seriesRevision: null,
      seriesExpectation: null,
      mixedTickProjectionAllowed: false,
      lastPublishedSnapshot: null,
      ledgerInFlight: null,
      summaryRead: null,
      reportRead: null,
      desiredLedger: null,
      error: null,
      errorDetails: null,
      noData: binding.noData,
      ...binding.history,
    };
    this.entries.set(encoded, entry);
    return entry;
  }

  private reconcileRequestedMarket(
    binding: CellBinding,
    fallback: { symbol?: string; timeframe?: string } = {},
  ): void {
    // A superseding setMarket does not necessarily emit load:start. The public
    // market getter changes immediately; reconcile BEFORE recording history,
    // including progressive completion that can arrive before load:end.
    const requested = requestedHistoryMarketKey(binding.chart.market ?? fallback);
    if (requested === null || requested === binding.observedMarket) return;
    this.invalidateCell(binding.cell.id, 'requested-market-changed');
    binding.observedMarket = requested;
    binding.loadingMarket = requested;
  }

  private adoptHistoryFailure(binding: CellBinding): void {
    const observed = observedWorkspaceHistory(this.workspace, binding.cell);
    if (!observed?.historyError) return;
    Object.assign(binding.history, { historyReason: 'aborted', historyError: observed.historyError,
      historyTarget: observed.historyTarget, historyComplete: observed.historyComplete });
    binding.noData = false;
    for (const entry of this.entriesForCell(binding.cell.id)) {
      Object.assign(entry, binding.history);
      entry.noData = false;
      this.emitSnapshot(entry);
    }
  }

  private invalidateCell(cellId: string, reason: string): void {
    const binding = this.cells.get(cellId);
    if (binding) {
      this.historyRetries.delete(binding);
      binding.loadGeneration += 1;
      binding.loadingMarket = null;
      binding.marketCommitted = false;
      binding.noData = false;
      binding.history = emptyHistoryFacts();
      binding.history.historyComplete = false;
    }
    for (const entry of this.entriesForCell(cellId)) {
      this.invalidateEntry(entry, reason);
      this.emitSnapshot(entry);
    }
  }

  private invalidateEntry(entry: Entry, _reason: string): void {
    if (_reason === 'load-start' || _reason === 'market-changed' || _reason === 'requested-market-changed') {
      entry.invalidatedMarketRunId = reportIdentityFromStrategy(entry.run?.strategy)?.runId
        ?? reportIdentityOf(entry.context)?.runId ?? entry.reportSeries?.runId ?? entry.invalidatedMarketRunId;
      entry.awaitingMarketRun = true;
    }
    entry.epoch += 1;
    entry.revision += 1;
    entry.run = null;
    entry.context = null;
    entry.trades = null;
    entry.ledgerState = 'idle';
    entry.ledgerRevision = null;
    entry.auditLedger = null;
    entry.auditState = 'idle';
    entry.reportSeries = null;
    entry.seriesState = 'idle';
    entry.seriesRevision = null;
    entry.seriesExpectation = null;
    entry.desiredLedger = null;
    entry.error = null;
    entry.errorDetails = null;
    entry.noData = this.cells.get(entry.cellId)?.noData ?? false;
    // Hiding a strategy invalidates its execution, not its chart's history.
    // Market/load invalidation already resets binding.history beforehand.
    Object.assign(entry, this.cells.get(entry.cellId)?.history ?? emptyHistoryFacts());
  }

  private removeCellEntries(cellId: string): void {
    for (const entry of this.entriesForCell(cellId)) this.removeEntry(entry.key);
  }

  private removeEntry(key: BacktestAdapterKey): void {
    const encoded = keyOf(key);
    // Advance even when no entry exists: a pending bootstrap for an instance
    // that never published its first context must not be allowed to recreate
    // the report after the indicator is removed and re-added with the same id.
    this.bumpKeyGeneration(key);
    const entry = this.entries.get(encoded);
    if (!entry) return;
    entry.epoch += 1;
    entry.desiredLedger = null;
    this.entries.delete(encoded);
    this.emit({ type: 'removed', key: entry.key });
  }

  private entriesForCell(cellId: string): Entry[] {
    return [...this.entries.values()].filter((entry) => entry.cellId === cellId);
  }

  private disposeCellById(cellId: string): void {
    const binding = this.cells.get(cellId);
    if (!binding) return;
    this.disposeCell(binding);
    this.cells.delete(cellId);
  }

  private disposeCell(binding: CellBinding): void {
    this.historyRetries.delete(binding);
    while (binding.disposers.length > 0) binding.disposers.pop()?.();
    for (const dispose of binding.handles.values()) dispose();
    binding.handles.clear();
    binding.bootstrapInFlight.clear();
  }

  private resetBindingsAfterBootstrapFailure(): void {
    this.applicationEpoch += 1;
    while (this.workspaceDisposers.length > 0) {
      try {
        this.workspaceDisposers.pop()?.();
      } catch (error) {
        this.diagnose('workspace event cleanup failed after bootstrap error', error);
      }
    }
    for (const binding of this.cells.values()) this.disposeCell(binding);
    this.cells.clear();
    for (const entry of this.entries.values()) {
      entry.epoch += 1;
      this.bumpKeyGeneration(entry.key);
      this.emit({ type: 'removed', key: entry.key });
    }
    this.entries.clear();
  }

  private findHandle(chart: Vela, id: string): IndicatorHandle | undefined {
    return chart.indicators().find((handle) => handle.id === id);
  }

  private keyGeneration(key: BacktestAdapterKey): number {
    return this.keyGenerations.get(keyOf(key)) ?? 0;
  }

  private bumpKeyGeneration(key: BacktestAdapterKey): number {
    const id = keyOf(key);
    const generation = (this.keyGenerations.get(id) ?? 0) + 1;
    this.keyGenerations.set(id, generation);
    return generation;
  }

  private isBindingCurrent(binding: CellBinding): boolean {
    return !this.destroyed && this.cells.get(binding.cell.id) === binding;
  }

  private isHandleCurrent(binding: CellBinding, handle: IndicatorHandle): boolean {
    return this.isBindingCurrent(binding)
      && this.findHandle(binding.chart, handle.id) === handle;
  }

  private isCurrent(
    entry: Entry,
    revision: number,
    epoch: number,
    binding?: CellBinding,
    handle?: IndicatorHandle,
  ): boolean {
    const currentBinding = this.cells.get(entry.cellId);
    return !this.destroyed
      && this.entries.get(keyOf(entry.key)) === entry
      && entry.revision === revision
      && entry.epoch === epoch
      && !entry.noData
      && (!currentBinding || requestedHistoryMarketKey(currentBinding.chart.market ?? {}) === null
        || requestedHistoryMarketKey(currentBinding.chart.market) === currentBinding.observedMarket)
      && this.keyGeneration(entry.key) === entry.generation
      && (!binding || currentBinding === binding)
      && (!handle || (currentBinding !== undefined && this.findHandle(currentBinding.chart, handle.id) === handle));
  }

  private emitSnapshot(entry: Entry): void {
    if (entry.historyError) {
      entry.error = new Error(entry.historyError);
      entry.errorDetails = backtestAdapterErrorOf(entry.error);
    }
    const snapshot = this.snapshotOf(entry);
    entry.lastPublishedSnapshot = snapshot;
    this.emit({ type: 'snapshot', snapshot });
  }

  private readableSnapshotOf(entry: Entry): BacktestAdapterSnapshot {
    // A live tick deliberately suppresses publication until its tail (or the
    // identity-bound full recovery) is accepted. Synchronous readers must see
    // the same last-good state as stream subscribers during that window.
    if (entry.run?.cause === 'tick'
      && entry.seriesState === 'pending'
      && entry.lastPublishedSnapshot) {
      return entry.lastPublishedSnapshot;
    }
    return this.snapshotOf(entry);
  }

  private snapshotOf(entry: Entry): BacktestAdapterSnapshot {
    const execution = executionOf(entry);
    const executionPrecision = execution.precision?.appliedPrecision ?? 'chart-ohlc';
    const currentSeries = entry.seriesState === 'ready'
      && entry.seriesRevision === entry.revision
      && entry.reportSeries !== null
      ? entry.reportSeries
      : undefined;
    const hasExactSeries = (currentSeries?.points.length ?? 0) > 0;
    const hasBenchmarkSeries = hasExactSeries
      && currentSeries!.points.some((point) => point.benchmarkEquity !== null);
    const capabilities = Object.freeze({
      ...CURRENT_VELA_BACKTEST_CAPABILITIES,
      tradeLedger: !entry.noData
        && entry.ledgerState === 'ready' && entry.ledgerRevision === entry.revision,
      executionPrecision,
      exactEquityCurve: !entry.noData && hasExactSeries,
      exactDrawdownCurve: !entry.noData && hasExactSeries,
      benchmark: !entry.noData && hasBenchmarkSeries,
      barIndices: !entry.noData && entry.ledgerState === 'ready'
        && entry.ledgerRevision === entry.revision
        && hasCompleteTradeBarIndices(entry.trades, execution.barIndex),
      rawOrders: !entry.noData && entry.auditState === 'ready',
      rawFills: !entry.noData && entry.auditState === 'ready',
    });
    return Object.freeze({
      key: Object.freeze({ ...entry.key }),
      revision: entry.revision,
      epoch: entry.epoch,
      runToken: entry.noData ? null : (currentSeries?.runId
        ?? (entry.run ? runToken(entry.key, entry.revision, entry.run) : null)),
      status: statusOf(entry),
      finality: finalityOf(entry),
      history: historyStateOf(entry),
      ledgerState: entry.ledgerState,
      ledgerRevision: entry.ledgerRevision,
      capabilities,
      visible: entry.visible,
      handle: Object.freeze({ id: entry.handle.id, title: entry.handle.title, source: entry.handle.source }),
      run: detachedFrozen(entry.run),
      context: entry.context,
      trades: capabilities.tradeLedger ? entry.trades : null,
      auditState: entry.auditState,
      ...(entry.auditLedger ? { auditLedger: entry.auditLedger } : {}),
      orders: entry.auditLedger?.orderEvents ?? Object.freeze([]),
      fills: entry.auditLedger?.fillEvents ?? Object.freeze([]),
      ...(currentSeries ? { reportSeries: currentSeries } : {}),
      seriesState: entry.seriesState,
      inputs: parameterState(entry.handle.inputs, safeValues(entry.handle, 'inputs')),
      props: parameterState(entry.handle.props, safeValues(entry.handle, 'props')),
      execution,
      provenance: provenanceOf(entry.context),
      error: entry.error ? Object.freeze(Object.assign(new Error(entry.error.message), {
        name: entry.error.name, stack: entry.error.stack,
      })) : null,
      ...(entry.errorDetails ? { errorDetails: entry.errorDetails } : {}),
      ...(entry.handle.source !== undefined ? { source: entry.handle.source } : {}),
    });
  }

  private emit(event: BacktestAdapterEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.diagnose('backtest listener failed', error);
      }
    }
  }

  private emitStale(
    key: BacktestAdapterKey,
    revision: number,
    epoch: number,
    reason: string,
  ): void {
    this.emit({ type: 'stale-drop', key, revision, epoch, reason });
  }

  private diagnose(message: string, error?: unknown): void {
    try {
      this.onDiagnostic?.(message, error);
    } catch {
      // Diagnostics are intentionally best effort and must not affect chart work.
    }
  }
}

function canReplaceReportContext(entry: Entry, context: EngineContextSnapshot | null): boolean {
  const identity = reportIdentityOf(context);
  // Every run (including ticks) announces its engine identity before
  // asynchronous context reads start. Clearing the previous report must not
  // discard that floor and allow a previous engine run back into the UI.
  const announced = reportIdentityFromStrategy(entry.run?.strategy);
  if (announced) {
    if (!identity) return false;
    if (identity.runId === announced.runId) {
      if (identity.snapshotRevision < announced.snapshotRevision) return false;
    } else {
      if (entry.run?.cause !== 'tick') return false;
      // An unannounced worker restart must first establish its identity with
      // a valid tail. Recovery may then fetch that exact run's full envelope.
      // A tick announcing a new run cannot be satisfied by the old baseline.
      const expectedRecovery = entry.seriesExpectation?.runId === identity.runId;
      const acceptedRestart = reportIdentityOf(entry.context)?.runId === identity.runId
        && entry.seriesRevision === entry.revision && entry.reportSeries?.runId === identity.runId;
      const tail = reportTailOf(context);
      if (!expectedRecovery && !acceptedRestart && (entry.reportSeries?.runId === identity.runId
        || !tail || !reportTailMatchesContext(tail, context))) return false;
    }
  }
  const reportContext = context as ReportContextSnapshot | null;
  const hasReportPayload = reportContext?.reportSeries !== undefined
    || reportContext?.reportTail !== undefined
    || reportContext?.auditLedger !== undefined;
  if (entry.seriesExpectation) {
    if (!hasReportPayload || identity === undefined) return false;
    if (identity.runId === entry.seriesExpectation.runId) {
      return identity.snapshotRevision >= entry.seriesExpectation.minSnapshotRevision;
    }
    // A worker can restart again while the full recovery for the prior live
    // run is still in flight. A valid tail is the only payload allowed to
    // supersede that expectation: it establishes the new run identity and the
    // subsequent full pull remains guarded by it. A late full response for the
    // superseded run is therefore rejected below on its identity.
    const tail = reportTailOf(context);
    return tail !== undefined && reportTailMatchesContext(tail, context);
  }
  if (!entry.reportSeries) {
    // A failed recovery must not erase the identity already observed in a
    // current context. Retry is subject to that same run/revision floor.
    const known = reportIdentityOf(entry.context);
    if (!known) return true;
    if (!identity) return false;
    if (known.runId === identity.runId) return identity.snapshotRevision >= known.snapshotRevision;
    const tail = reportTailOf(context);
    return tail !== undefined && reportTailMatchesContext(tail, context);
  }
  // While a tick delta is pending, summary-only context events are not allowed
  // to publish an intermediate snapshot that hides the retained last-good
  // series. Only the requested report payload can advance this revision.
  if (entry.seriesState === 'pending' && !hasReportPayload
    && !isMixedTickEnvelope(entry, context)) return false;
  if (identity === undefined) return false;
  if (identity.runId === entry.reportSeries.runId) {
    return identity.snapshotRevision >= entry.reportSeries.snapshotRevision;
  }
  // A tail is the only legitimate first observation of a new persistent live
  // run while the previous baseline is retained. Its identity is bound as the
  // expectation for the subsequent full recovery pull.
  const tail = reportTailOf(context);
  return tail !== undefined && reportTailMatchesContext(tail, context);
}

/**
 * A report projection is optional during a live tick for engines that publish
 * the summary/trades first and the exact curve on a later context update. This
 * compatibility path is deliberately narrow: it only retains an already
 * accepted series, requires the same run and a non-regressing revision, and is
 * never used for a history/retry read or a run without an identity.
 */
function isMixedTickEnvelope(entry: Entry, context: EngineContextSnapshot | null): boolean {
  if (!entry.mixedTickProjectionAllowed || entry.run?.cause !== 'tick' || !entry.reportSeries) return false;
  const reportContext = context as ReportContextSnapshot | null;
  if (reportContext?.reportSeries !== undefined || reportContext?.reportTail !== undefined) {
    return false;
  }
  // The transition may omit only the exact curve projection. A ledger-less
  // context cannot prove the new tick's state and must follow the normal
  // identity/envelope rejection path rather than lingering pending forever.
  if (!Array.isArray(reportContext?.trades)) return false;
  const identity = reportIdentityOf(context);
  return identity !== undefined
    && identity.runId === entry.reportSeries.runId
    && identity.snapshotRevision >= entry.reportSeries.snapshotRevision;
}

function acceptMixedTickEnvelope(
  entry: Entry,
  context: EngineContextSnapshot | null,
  revision: number,
): void {
  entry.context = context;
  if (Array.isArray(context?.trades)) {
    entry.trades = cloneTrades(context.trades);
    entry.ledgerRevision = revision;
    entry.ledgerState = 'ready';
  }
  // Keep the last exact series visible while the projection is absent. A later
  // valid tail/full context can replace it; this state is intentionally not
  // `error`, and the retained curve remains available to the UI.
  entry.seriesState = 'pending';
  entry.seriesRevision = null;
  entry.error = null;
  entry.errorDetails = null;
}

function hasAuditPayload(context: EngineContextSnapshot | null): boolean {
  return (context as ReportContextSnapshot | null)?.auditLedger !== undefined;
}

/**
 * Accept the broker audit only as one atomic, identity-bound envelope.  The
 * bridge validator rejects malformed/duplicate lifecycle rows; these checks
 * additionally bind the copy to the same execution summary and current bar
 * the adapter is accepting.  An empty pair of event arrays is still a valid
 * raw ledger: it means the strategy generated no orders/fills in this run.
 */
function auditLedgerOf(context: EngineContextSnapshot | null): BacktestAdapterAuditLedger | undefined {
  const candidate = (context as ReportContextSnapshot | null)?.auditLedger;
  if (candidate === undefined) return undefined;
  const validated = validateAuditLedgerSnapshot(candidate);
  const identity = reportIdentityOf(context);
  if (!validated || !identity
    || validated.runId !== identity.runId
    || validated.snapshotRevision !== identity.snapshotRevision
    || (typeof context?.barIndex === 'number' && validated.barIndex !== context.barIndex)
    || validated.orderEvents.some((event) => event.barIndex > validated.barIndex)
    || validated.fillEvents.some((event) => event.barIndex > validated.barIndex)) return undefined;
  return validated as BacktestAdapterAuditLedger;
}

function reportSeriesOf(context: EngineContextSnapshot | null): BacktestAdapterReportSeries | undefined {
  const candidate = (context as ReportContextSnapshot | null)?.reportSeries;
  if (!isRecord(candidate)
    || candidate.schemaVersion !== 1
    || typeof candidate.runId !== 'string'
    || candidate.runId.length === 0
    || !isPositiveInteger(candidate.snapshotRevision)
    || !isNonNegativeInteger(candidate.barIndex)
    || !Array.isArray(candidate.points)) return undefined;
  const points: BacktestAdapterReportPoint[] = [];
  let priorBarIndex = -Infinity;
  let priorTime = -Infinity;
  for (const raw of candidate.points) {
    const point = reportPointOf(raw);
    if (!point || point.barIndex <= priorBarIndex || point.time <= priorTime) return undefined;
    priorBarIndex = point.barIndex;
    priorTime = point.time;
    points.push(point);
  }
  if (points.length > 0 && candidate.barIndex !== points[points.length - 1].barIndex) return undefined;
  return Object.freeze({
    schemaVersion: 1,
    runId: candidate.runId,
    snapshotRevision: candidate.snapshotRevision,
    barIndex: candidate.barIndex,
    points: Object.freeze(points),
  });
}

function reportTailOf(context: EngineContextSnapshot | null): BacktestAdapterReportTail | undefined {
  const candidate = (context as ReportContextSnapshot | null)?.reportTail;
  if (!isRecord(candidate)
    || candidate.schemaVersion !== 1
    || typeof candidate.runId !== 'string'
    || candidate.runId.length === 0
    || !isPositiveInteger(candidate.snapshotRevision)
    || !isNonNegativeInteger(candidate.barIndex)
    || !Array.isArray(candidate.points)
    || candidate.points.length > 1) return undefined;
  const point = candidate.points.length === 0 ? undefined : reportPointOf(candidate.points[0]);
  if (candidate.points.length === 1 && !point) return undefined;
  if (point && point.barIndex !== candidate.barIndex) return undefined;
  return Object.freeze({
    schemaVersion: 1,
    runId: candidate.runId,
    snapshotRevision: candidate.snapshotRevision,
    barIndex: candidate.barIndex,
    points: Object.freeze(point ? [point] : []),
  });
}

function reportPointOf(value: unknown): BacktestAdapterReportPoint | undefined {
  if (!isRecord(value)
    || !isNonNegativeInteger(value.barIndex)
    || !isFiniteNumber(value.time)
    || !isFiniteNumber(value.equity)
    || !isFiniteNumber(value.realizedPnl)
    || !isFiniteNumber(value.openPnl)
    || !isNonNegativeFinite(value.underwater)
    || !(value.underwaterPercent === null || isNonNegativeFinite(value.underwaterPercent))
    || !isNonNegativeFinite(value.maxDrawdown)
    || !isNonNegativeFinite(value.maxDrawdownPercent)) return undefined;
  if (value.closeTime !== undefined && !isFiniteNumber(value.closeTime)) return undefined;
  const benchmark = [value.benchmarkEquity, value.benchmarkPnl, value.benchmarkReturnPercent];
  const benchmarkEmpty = benchmark.every((item) => item === null);
  const benchmarkComplete = benchmark.every(isFiniteNumber);
  if (!benchmarkEmpty && !benchmarkComplete) return undefined;
  return Object.freeze({
    barIndex: value.barIndex,
    time: value.time,
    ...(value.closeTime !== undefined ? { closeTime: value.closeTime as number } : {}),
    equity: value.equity,
    realizedPnl: value.realizedPnl,
    openPnl: value.openPnl,
    underwater: value.underwater,
    underwaterPercent: value.underwaterPercent as number | null,
    maxDrawdown: value.maxDrawdown,
    maxDrawdownPercent: value.maxDrawdownPercent,
    benchmarkEquity: value.benchmarkEquity as number | null,
    benchmarkPnl: value.benchmarkPnl as number | null,
    benchmarkReturnPercent: value.benchmarkReturnPercent as number | null,
  });
}

function reportSeriesMatchesContext(
  series: BacktestAdapterReportSeries,
  context: EngineContextSnapshot | null,
): boolean {
  const identity = reportIdentityOf(context);
  return identity !== undefined
    && identity.runId === series.runId
    && identity.snapshotRevision === series.snapshotRevision
    && identity.pointCount === series.points.length
    && (typeof context?.barIndex !== 'number' || context.barIndex === series.barIndex);
}

function reportTailMatchesContext(
  tail: BacktestAdapterReportTail,
  context: EngineContextSnapshot | null,
): boolean {
  const identity = reportIdentityOf(context);
  return identity !== undefined
    && identity.runId === tail.runId
    && identity.snapshotRevision === tail.snapshotRevision
    && (typeof context?.barIndex !== 'number' || context.barIndex === tail.barIndex);
}

function reportIdentityOf(context: EngineContextSnapshot | null): {
  readonly runId: string;
  readonly snapshotRevision: number;
  readonly pointCount: number;
} | undefined {
  return reportIdentityFromStrategy(context?.strategy);
}

function reportIdentityFromStrategy(value: unknown): {
  readonly runId: string;
  readonly snapshotRevision: number;
  readonly pointCount: number;
} | undefined {
  const strategy = value as ReportIdentityStrategy | undefined;
  if (!strategy
    || typeof strategy.reportRunId !== 'string'
    || strategy.reportRunId.length === 0
    || !isPositiveInteger(strategy.reportSnapshotRevision)
    || !isNonNegativeInteger(strategy.reportPointCount)) return undefined;
  return {
    runId: strategy.reportRunId,
    snapshotRevision: strategy.reportSnapshotRevision,
    pointCount: strategy.reportPointCount,
  };
}

function fullReportEnvelopeError(context: EngineContextSnapshot | null): Error | undefined {
  const series = reportSeriesOf(context);
  if (series && reportSeriesMatchesContext(series, context)) return undefined;
  if (reportIdentityOf(context)) return new Error('Full report read omitted its identity-bound series');
  if ((context as ReportContextSnapshot | null)?.reportSeries !== undefined) {
    return new Error('Rejected inconsistent PineTS report series');
  }
  return undefined;
}

function reportPointCount(context: EngineContextSnapshot | null): number | undefined {
  return reportIdentityOf(context)?.pointCount;
}

function mergeReportTail(
  series: BacktestAdapterReportSeries,
  tail: BacktestAdapterReportTail,
  expectedPointCount: number | undefined,
): BacktestAdapterReportSeries | undefined {
  const tailPoint = tail.points[0];
  if (tail.runId !== series.runId || tail.snapshotRevision <= series.snapshotRevision || !tailPoint) {
    return undefined;
  }
  const points = [...series.points];
  const last = points[points.length - 1];
  if (last && tailPoint.barIndex === last.barIndex && tailPoint.time === last.time) {
    points[points.length - 1] = tailPoint;
  } else if (!last || (tailPoint.barIndex > last.barIndex && tailPoint.time > last.time)) {
    points.push(tailPoint);
  } else {
    return undefined;
  }
  if (expectedPointCount !== undefined && expectedPointCount !== points.length) return undefined;
  return Object.freeze({
    schemaVersion: 1,
    runId: tail.runId,
    snapshotRevision: tail.snapshotRevision,
    barIndex: tail.barIndex,
    points: Object.freeze(points),
  });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function provenanceOf(context: EngineContextSnapshot | null): BacktestAdapterProvenance | undefined {
  const candidate = (context as (EngineContextSnapshot & { provenance?: unknown }) | null)?.provenance;
  if (!candidate || typeof candidate !== 'object') return undefined;
  const value = candidate as Record<string, unknown>;
  if (value.execution !== 'in-process' && value.execution !== 'worker') return undefined;
  const engine = buildPackageOf(value.engine);
  const bridgeBase = buildPackageOf(value.bridge);
  if (!engine || !bridgeBase || !isRecord(value.bridge)) return undefined;
  const bridgeSha = stringOf(value.bridge.bridgeSha);
  const embeddedPinetsSha = stringOf(value.bridge.embeddedPinetsSha);
  const embeddedPinetsFingerprint = stringOf(value.bridge.embeddedPinetsFingerprint);
  const buildFingerprint = stringOf(value.buildFingerprint);
  const sentinel = stringOf(value.sentinel);
  if (!bridgeSha || !embeddedPinetsSha || !embeddedPinetsFingerprint
    || !buildFingerprint || !sentinel) return undefined;
  const workerFingerprint = stringOf(value.workerFingerprint);
  // Validate the relationship, not just the shape. Otherwise individually
  // well-formed fields from different builds could be spliced into a report
  // and presented as one execution identity.
  const expectedBuildFingerprint = `${bridgeBase.buildFingerprint}|engine=${engine.buildFingerprint}`;
  const expectedSentinel = `${bridgeBase.sentinel}|${engine.sentinel}`;
  const expectedWorkerFingerprint = `${expectedBuildFingerprint}|execution=worker`;
  if (bridgeSha !== bridgeBase.upstreamSha
    || embeddedPinetsSha !== engine.upstreamSha
    || embeddedPinetsFingerprint !== engine.buildFingerprint
    || bridgeBase.reportSchemaVersion !== engine.reportSchemaVersion
    || buildFingerprint !== expectedBuildFingerprint
    || sentinel !== expectedSentinel
    || (value.execution === 'worker' && workerFingerprint !== expectedWorkerFingerprint)
    || (value.execution === 'in-process' && workerFingerprint !== undefined)) return undefined;
  return Object.freeze({
    execution: value.execution,
    engine,
    bridge: Object.freeze({
      ...bridgeBase,
      bridgeSha,
      embeddedPinetsSha,
      embeddedPinetsFingerprint,
    }),
    buildFingerprint,
    ...(workerFingerprint ? { workerFingerprint } : {}),
    sentinel,
  });
}

function buildPackageOf(value: unknown): BacktestAdapterProvenance['engine'] | undefined {
  if (!isRecord(value)) return undefined;
  const schemaVersion = value.schemaVersion;
  const packageName = stringOf(value.packageName);
  const packageVersion = stringOf(value.packageVersion);
  const upstreamSha = stringOf(value.upstreamSha);
  const localPatchRevision = stringOf(value.localPatchRevision);
  const sentinel = stringOf(value.sentinel);
  const buildFingerprint = stringOf(value.buildFingerprint);
  const reportSchemaVersion = value.reportSchemaVersion;
  if (schemaVersion !== 1 || !packageName || !packageVersion || !/^[0-9a-f]{40}$/.test(upstreamSha ?? '')
    || !localPatchRevision || !sentinel || !buildFingerprint
    || typeof reportSchemaVersion !== 'number' || !Number.isInteger(reportSchemaVersion)
    || reportSchemaVersion < 1) return undefined;
  return Object.freeze({
    schemaVersion,
    packageName,
    packageVersion,
    upstreamSha: upstreamSha as string,
    localPatchRevision,
    reportSchemaVersion,
    sentinel,
    buildFingerprint,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function keyOf(key: BacktestAdapterKey): string {
  return `${key.cellId}${KEY_SEPARATOR}${key.indicatorId}`;
}

function runToken(key: BacktestAdapterKey, revision: number, run: ScriptRun): string {
  return [
    encodeURIComponent(key.cellId),
    encodeURIComponent(key.indicatorId),
    revision,
    run.cause,
    run.bar,
    run.time,
  ].join(':');
}

function safeValues(
  handle: IndicatorHandle,
  kind: 'inputs' | 'props',
): Readonly<Record<string, InputValue>> {
  try {
    const values = kind === 'inputs' ? handle.inputValues() : handle.propValues();
    return Object.freeze({ ...values });
  } catch {
    // A handle may be in the tiny prepare/remove window while a snapshot is
    // being emitted.  An empty value bag is safer than allowing a settings
    // read to break the result stream; the schema still tells the consumer
    // which fields exist.
    return Object.freeze({});
  }
}

function parameterState(
  schema: readonly InputSchema[] | undefined,
  values: Readonly<Record<string, InputValue>>,
): BacktestAdapterParameterState {
  const copy = (schema ?? []).map((item) => Object.freeze({
    ...item,
    ...(item.options ? { options: Object.freeze([...item.options]) } : {}),
  }));
  return Object.freeze({
    schema: Object.freeze(copy),
    values,
  });
}

function executionOf(entry: Entry): BacktestAdapterExecutionState {
  const run = entry.run;
  const context = entry.context;
  const runPlots = run?.plots ? Object.keys(run.plots) : [];
  const contextPlots = context?.plots ? Object.keys(context.plots) : [];
  const seriesKeys = [...new Set([...runPlots, ...contextPlots])]
    .filter((key) => !key.startsWith('__'));
  const precision = precisionOf(context);
  return Object.freeze({
    barIndex: typeof run?.bar === 'number'
      ? run.bar
      : typeof context?.barIndex === 'number' ? context.barIndex : null,
    time: typeof run?.time === 'number' ? run.time : null,
    phase: context?.phase ?? null,
    seriesKeys: Object.freeze(seriesKeys),
    ...(precision ? { precision } : {}),
  });
}

function precisionOf(context: EngineContextSnapshot | null): BacktestAdapterPrecisionState | undefined {
  const raw = (context as (EngineContextSnapshot & { executionPrecision?: unknown }) | null)?.executionPrecision;
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const requested = value.requested;
  const applied = value.applied;
  const requestedPrecision = value.requestedPrecision;
  const appliedPrecision = value.appliedPrecision;
  const parentBars = value.parentBars;
  const lowerBars = value.lowerBars;
  const coveredParentBars = value.coveredParentBars;
  const coverage = value.coverage;
  if (typeof requested !== 'boolean' || typeof applied !== 'boolean'
    || (requestedPrecision !== 'chart-ohlc' && requestedPrecision !== 'lower-timeframe' && requestedPrecision !== 'tick')
    || (appliedPrecision !== 'chart-ohlc' && appliedPrecision !== 'lower-timeframe' && appliedPrecision !== 'tick')
    || typeof parentBars !== 'number' || !Number.isSafeInteger(parentBars) || parentBars < 0
    || typeof lowerBars !== 'number' || !Number.isSafeInteger(lowerBars) || lowerBars < 0
    || typeof coveredParentBars !== 'number' || !Number.isSafeInteger(coveredParentBars) || coveredParentBars < 0
    || typeof coverage !== 'number' || !Number.isFinite(coverage) || coverage < 0 || coverage > 1) return undefined;

  // The precision envelope is capability metadata, not a best-effort label.
  // Reject contradictory states before they reach the UI: a producer cannot
  // claim lower-timeframe/tick execution without an explicit request, and an
  // unapplied request must describe the chart-OHLC fallback.  Likewise, a
  // complete applied run must cover every parent bar.  Keeping malformed
  // metadata out of the snapshot prevents `capabilities.executionPrecision`
  // from advertising precision that the broker did not actually use.
  if (!requested && (applied || requestedPrecision !== 'chart-ohlc' || appliedPrecision !== 'chart-ohlc')) {
    return undefined;
  }
  if (requested && requestedPrecision === 'chart-ohlc') return undefined;
  if (applied && (!requested || appliedPrecision === 'chart-ohlc'
    || coveredParentBars !== parentBars || parentBars === 0 || lowerBars === 0)) {
    return undefined;
  }
  if (applied && lowerBars < coveredParentBars) return undefined;
  if (!applied && appliedPrecision !== 'chart-ohlc') return undefined;
  if (coveredParentBars > parentBars) return undefined;
  if (parentBars === 0 && coverage !== 0) return undefined;
  if (parentBars > 0 && Math.abs(coverage - coveredParentBars / parentBars) > 1e-9) return undefined;
  if (value.lowerTimeframe !== undefined
    && (typeof value.lowerTimeframe !== 'string' || value.lowerTimeframe.trim() === '')) return undefined;
  const fallbackReason = value.fallbackReason;
  if (fallbackReason !== undefined
    && (typeof fallbackReason !== 'string' || fallbackReason.trim() === '')) return undefined;
  // A fallback is only actionable when its cause is explicit. Conversely an
  // applied lower-timeframe run cannot carry a stale fallback cause. This
  // prevents the UI from presenting ambiguous precision diagnostics.
  if (requested && !applied && typeof fallbackReason !== 'string') return undefined;
  if (requested && !applied && fallbackReason === 'not-requested') return undefined;
  if (applied && fallbackReason !== undefined) return undefined;
  if (!requested && fallbackReason !== undefined && fallbackReason.trim() !== 'not-requested') return undefined;
  return Object.freeze({
    requested,
    applied,
    requestedPrecision,
    appliedPrecision,
    ...(typeof value.lowerTimeframe === 'string' ? { lowerTimeframe: value.lowerTimeframe } : {}),
    parentBars,
    lowerBars,
    coveredParentBars,
    coverage,
    ...(typeof fallbackReason === 'string' ? { fallbackReason: fallbackReason.trim() } : {}),
  });
}

function cloneTrades(trades: readonly StrategyTrade[]): readonly BacktestAdapterTrade[] {
  // The bridge promises read-only snapshots. Copy the outer collection so a future
  // engine implementation cannot mutate a report held by application selectors.
  return detachedFrozen(trades.map((source) => {
    const trade = source as BacktestAdapterTrade;
    return {
      ...trade,
      entry: { ...trade.entry },
      ...(trade.exit ? { exit: { ...trade.exit } } : {}),
    };
  }));
}

/** Detach data before freezing: never freeze the mutable engine/worker source. */
function detachedFrozen<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value) as T;
  const copy: any = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) {
    // Snapshots are data, not an engine control surface.
    if (typeof item !== 'function') copy[key] = detachedFrozen(item, seen);
  }
  return Object.freeze(copy) as T;
}

/**
 * A capability is only advertised for the accepted rows that can actually be
 * located. Empty ledgers provide no evidence, and a single malformed/missing
 * required leg downgrades the whole ledger instead of mixing exact and guessed
 * duration/navigation semantics.
 */
function hasCompleteTradeBarIndices(
  trades: readonly BacktestAdapterTrade[] | null,
  maxBarIndex: number | null,
): boolean {
  if (!trades || trades.length === 0) return false;
  const upperBound = typeof maxBarIndex === 'number'
    && Number.isSafeInteger(maxBarIndex)
    && maxBarIndex >= 0
    ? maxBarIndex
    : null;
  return trades.every((trade) => {
    const entry = trade.entryBarIndex;
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 0) return false;
    if (upperBound !== null && entry > upperBound) return false;
    if (trade.open) return true;
    const exit = trade.exitBarIndex;
    return typeof exit === 'number'
      && Number.isSafeInteger(exit)
      && exit >= entry
      && (upperBound === null || exit <= upperBound);
  });
}

function isStrategyHandle(
  handle: IndicatorHandle,
  context: EngineContextSnapshot | null,
): boolean {
  if (context?.strategy || (context?.trades?.length ?? 0) > 0) return true;
  // Vela's context has no explicit `kind` field. This source check is only a
  // bootstrap fallback for a valid zero-trade strategy. Anchor it to a Pine
  // declaration line so an ordinary indicator containing `strategy(` in a
  // comment or string cannot create a phantom Backtest Dock; runtime
  // `script:run` remains authoritative once the engine emits it.
  return /^\s*strategy\s*\(/im.test(handle.source ?? '');
}

function statusOf(entry: Entry): BacktestAdapterStatus {
  if (!entry.visible) return 'suspended';
  // Keep the last-good context/ledger attached to an error snapshot, but expose
  // the error state explicitly so a viewer cannot mistake stale data for a fresh
  // successful run.
  if (entry.error) return 'error';
  if (entry.noData) return 'no-data';
  if (entry.historyReason === 'aborted') return 'partial';
  if (!entry.run && !entry.context) return entry.historyComplete === false ? 'waiting-data' : 'compiling';
  // `ScriptRun.complete` only describes the bars currently available to the
  // engine.  During deep-history backfill expose a transient state so the
  // Dock/Viewer cannot present a shallow ledger as a finished backtest.
  if (entry.historyComplete === false) return 'partial';
  if (entry.run && !entry.run.complete) return 'partial';
  // A completed head run is not a completed backtest while Vela is still
  // backfilling older candles.  `run.complete` is scoped to the currently
  // painted window; history:progress is the authoritative signal that the
  // result can still change. Keep the report in the loading/partial state so
  // the Dock/Viewer cannot present provisional metrics or trades as final.
  if (entry.ledgerState === 'pending') return entry.run?.cause === 'inputs' ? 'updating' : 'computing';
  if (entry.trades === null) return 'computing';
  if (entry.historyComplete === null) return 'partial';
  const closed = entry.trades.filter((trade) => !trade.open);
  const open = entry.trades.filter((trade) => trade.open);
  if (closed.length === 0 && open.length > 0) return 'open-only';
  if (closed.length === 0) return 'no-trades';
  return 'ready';
}

function finalityOf(entry: Entry): BacktestAdapterFinality {
  if (entry.run && !entry.run.complete) return 'partial-history';
  if (entry.historyReason === 'aborted') return 'partial-history';
  if (entry.historyComplete === false) return 'partial-history';
  if (entry.historyComplete === null) return 'unknown';
  if (entry.run?.forming) return 'live-provisional';
  // A history-complete event can arrive before the follow-up context/ledger
  // read has been accepted. The chart range is settled, but the report is not
  // yet bound to that range; do not label the previous head values final.
  if (entry.ledgerState === 'pending' || entry.trades === null) return 'unknown';
  // `run.complete` is scoped to the currently available bars and is not a
  // proof that Vela's deep history load has settled.  Only the explicit
  // history completion signal may promote a report to historical-final.
  if (entry.historyComplete === true) return 'historical-final';
  return 'unknown';
}

function historyStateOf(entry: Entry): BacktestAdapterHistoryState {
  const loaded = entry.historyLoaded ?? entry.historyBarsLoaded;
  const target = entry.historyTarget ?? (entry.historyComplete === true ? loaded : null);
  const progress = loaded !== null && target !== null && target > 0
    ? Math.max(0, Math.min(1, loaded / target))
    : entry.historyComplete === true ? 1 : null;
  return Object.freeze({
    loaded,
    target,
    barsLoaded: entry.historyBarsLoaded,
    oldestTime: entry.historyOldestTime,
    complete: entry.historyComplete === true,
    reason: entry.historyReason,
    progress,
  });
}

function finiteNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
