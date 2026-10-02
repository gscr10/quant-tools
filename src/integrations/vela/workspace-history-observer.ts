import type { BarRange, Vela } from '@luxalgo/vela';
import type { ChartCell, VelaWorkspace } from '@luxalgo/vela/workspace';
import { subscribeProviderHistoryRequests } from './provider-history.ts';

/** Reason-bearing facts observed during the workspace lifetime, not inferred
 * from historyComplete(): that void promise also resolves after abort. */
export interface ObservedWorkspaceHistory {
  readonly generation: number;
  readonly noData: boolean;
  readonly historyLoaded: number | null;
  readonly historyTarget: number | null;
  readonly historyBarsLoaded: number | null;
  readonly historyOldestTime: number | null;
  readonly historyComplete: boolean | null;
  readonly historyReason: 'depth' | 'genesis' | 'aborted' | null;
  readonly historyError?: string | null;
}

interface RecordState {
  chart: Vela;
  market: string | null;
  accepting: boolean;
  committed: boolean;
  facts: ObservedWorkspaceHistory;
  requests: Set<() => void>;
  responses: Array<{ range: Readonly<BarRange>; error: string | null; bars: number; oldestTime: number | null }>;
  dispose: () => void;
}
const observers = new WeakMap<VelaWorkspace, Map<string, RecordState>>();
export function requestedHistoryMarketKey(market: Partial<Vela['market']>): string | null {
  if (market.symbol === undefined || market.timeframe === undefined) return null;
  return JSON.stringify([market.symbol, market.timeframe, market.provider, market.session, market.bars, market.offline]);
}
function identity(chart: Vela): string | null { return requestedHistoryMarketKey(chart.market ?? {}); }
function empty(generation: number): ObservedWorkspaceHistory {
  return { generation, noData: false, historyLoaded: null, historyTarget: null,
    historyBarsLoaded: null, historyOldestTime: null, historyComplete: null, historyReason: null };
}
function count(n: number): number | null {
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/** Installs before createWorkspace returns. No timers, polling or market reloads.
 * Caller owns the disposer and must invoke it before destroying the workspace. */
export function observeWorkspaceHistory(workspace: VelaWorkspace): () => void {
  if (observers.has(workspace)) throw new Error('Workspace history observer already installed');
  const records = new Map<string, RecordState>();
  observers.set(workspace, records);
  const removers: Array<() => void> = [];
  let disposed = false;
  const remove = (id: string): void => { records.get(id)?.dispose(); records.delete(id); };
  const bind = (cell: ChartCell): void => {
    if (records.get(cell.id)?.chart === cell.chart) return;
    remove(cell.id);
    const chart = cell.chart;
    const listeners: Array<() => void> = [];
    const state: RecordState = { chart, market: identity(chart), accepting: true, committed: false, facts: empty(0),
      requests: new Set(), responses: [],
      dispose: () => { while (listeners.length) listeners.pop()?.(); state.requests.clear(); state.responses.length = 0; } };
    records.set(cell.id, state);
    const current = (): boolean => !disposed && records.get(cell.id) === state;
    const reset = (): void => {
      state.market = identity(chart); state.accepting = true; state.committed = false;
      state.facts = { ...empty(state.facts.generation + 1), historyComplete: false };
      state.responses.length = 0;
    };
    const reconcile = (): void => { if (state.market !== identity(chart)) reset(); };
    // Depth-only setMarket can await the first older-range response without
    // emitting ANY Vela event. Observe that public request boundary, preserving
    // its receiver, return Promise and errors. No synthetic Vela events or
    // implicit reloads are introduced. Ordinary eventful switches reconcile
    // synchronously first; the adapter's idempotent reconciliation then no-ops.
    const setMarket = chart.setMarket;
    const ownSetMarket = Object.getOwnPropertyDescriptor(chart, 'setMarket');
    if (typeof setMarket === 'function') {
      const wrapped: Vela['setMarket'] = function (this: Vela, next) {
        const before = identity(chart);
        try {
          return setMarket.call(this, next);
        } finally {
          if (this === chart && current() && before !== identity(chart)) {
            reconcile();
            for (const listener of [...state.requests]) {
              try { listener(); } catch { /* consumers cannot alter market execution */ }
            }
          }
        }
      };
      chart.setMarket = wrapped;
      listeners.push(() => {
        // A later integration may own another wrapper; do not clobber it.
        if (chart.setMarket !== wrapped) return;
        if (ownSetMarket) Object.defineProperty(chart, 'setMarket', ownSetMarket);
        else Reflect.deleteProperty(chart, 'setMarket');
      });
    }
    const matches = (event: { symbol?: string; timeframe?: string }): boolean => {
      const market = chart.market;
      return (event.symbol === undefined || event.symbol === market.symbol)
        && (event.timeframe === undefined || event.timeframe === market.timeframe);
    };
    // The upstream network/feed layers turn rejected requests into []. Retain
    // request-local failure proof before their synthetic genesis event arrives.
    // Capture the market generation at START, not when an old request rejects.
    // A late failure from another cell/market/secondary timeframe cannot poison
    // this chart's history. No module-global transport-error flag is involved.
    for (const info of chart.data?.providers?.() ?? []) {
      const provider = chart.data.providerInstance(info.name);
      if (!provider) continue;
      listeners.push(subscribeProviderHistoryRequests(provider, request => {
        if (!current()) return;
        const resolved = chart.data.resolve(chart.market.symbol ?? '');
        if (!resolved || resolved.provider !== info.name || resolved.ticker !== request.ticker
          || (chart.market.timeframe ?? '60') !== request.timeframe) return;
        reconcile();
        if (!state.accepting) return;
        const generation = state.facts.generation;
        const market = state.market;
        void request.result.then(({ error, bars, oldestTime }) => {
          if (!current() || !state.accepting || generation !== state.facts.generation
            || market !== identity(chart)) return;
          // Provider instances are shared across cells. Do NOT broadcast this
          // result as a chart failure. A completion's exact oldest boundary
          // below establishes which request facts apply to that cell.
          state.responses.push({ range: request.range,
            error: error === null ? null : error instanceof Error ? error.message : String(error), bars, oldestTime });
        });
      }));
    }
    listeners.push(chart.on('load:start', (event) => {
      if (current() && matches(event)) reset();
    }));
    listeners.push(chart.on('load:end', (event) => {
      if (!current() || !matches(event)) return;
      reconcile(); if (!state.accepting) return;
      state.facts = { ...state.facts, noData: !state.facts.historyError && event.bars === 0 };
    }));
    listeners.push(chart.on('history:progress', (event) => {
      if (!current()) return;
      reconcile(); if (!state.accepting) return;
      state.facts = { ...state.facts, historyLoaded: count(event.loaded), historyBarsLoaded: count(event.loaded),
        historyTarget: count(event.target), historyComplete: false, historyReason: null };
    }));
    listeners.push(chart.on('history:complete', (event) => {
      if (!current()) return;
      reconcile(); if (!state.accepting) return;
      const bars = count(event.barsLoaded);
      const boundary = event.oldestTime;
      const relevant = state.responses.filter(response => {
        if ((bars ?? 0) === 0) return response.range.from === undefined && response.range.to === undefined;
        return (response.range.to === boundary || response.range.to === boundary - 1)
          && (response.range.from === undefined || response.range.from < boundary);
      });
      // Successful exhaustion at THIS exact oldest boundary is independent
      // proof even if a different cell's range failed. Generic success/empty
      // responses elsewhere, or the newest result alone, prove nothing here.
      const exhausted = relevant.some(response => response.error === null
        && (response.bars === 0 || ((response.oldestTime ?? -Infinity) >= boundary
          && (response.range.limit ?? Infinity) > response.bars)));
      const failure = relevant.find(response => response.error !== null)?.error ?? null;
      const failed = failure !== null && !exhausted && (bars ?? 0) < (chart.market.bars ?? 500);
      state.facts = { ...state.facts, historyLoaded: bars, historyBarsLoaded: bars,
        noData: failed ? false : state.facts.noData,
        historyTarget: state.facts.historyTarget ?? count(chart.market.bars ?? 500),
        historyOldestTime: Number.isFinite(event.oldestTime) ? event.oldestTime : null,
        historyComplete: true, historyReason: failed ? 'aborted' : event.reason,
        historyError: failed ? failure : null };
      if (state.committed) state.accepting = false;
    }));
    listeners.push(chart.on('market:changed', (event) => {
      if (!current() || !matches(event)) return;
      reconcile(); state.committed = true;
      if (state.facts.historyComplete === true) state.accepting = false;
    }));
  };
  const reconcileCells = (): void => {
    if (disposed) return;
    const live = workspace.cells();
    for (const id of records.keys()) if (!live.some(cell => cell.id === id)) remove(id);
    live.forEach(bind);
  };
  reconcileCells();
  removers.push(workspace.on('cell:created', reconcileCells));
  removers.push(workspace.on('cell:destroyed', ({ id }) => remove(id)));
  removers.push(workspace.on('layout:changed', reconcileCells));
  return () => {
    if (disposed) return;
    disposed = true;
    while (removers.length) removers.pop()?.();
    for (const id of records.keys()) remove(id);
    observers.delete(workspace);
  };
}

/** Internal integration signal for requested identity changes without Vela
 * events (notably depth-only backfill). It carries no fabricated history. */
export function subscribeWorkspaceHistoryRequests(
  workspace: VelaWorkspace,
  cell: ChartCell,
  listener: () => void,
): () => void {
  const state = observers.get(workspace)?.get(cell.id);
  if (!state || state.chart !== cell.chart) return () => {};
  state.requests.add(listener);
  return () => state.requests.delete(listener);
}

/** A changed requested identity invalidates even before Vela emits events. */
export function observedWorkspaceHistory(workspace: VelaWorkspace, cell: ChartCell): (ObservedWorkspaceHistory & { readonly historyEventsOpen: boolean; readonly marketCommitted: boolean }) | null {
  const state = observers.get(workspace)?.get(cell.id);
  if (!state) return null;
  // A removed cell facade throws when its chart getter is read. It may still
  // be retained by a consumer while the same id belongs to a replacement.
  try {
    return state.chart === cell.chart && state.market === identity(cell.chart)
      ? Object.freeze({ ...state.facts, historyEventsOpen: state.accepting, marketCommitted: state.committed }) : null;
  } catch {
    return null;
  }
}
