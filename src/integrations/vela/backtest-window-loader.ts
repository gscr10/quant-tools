import { MultiProviderFeed, timeframeToMs, type BarRange, type DataProvider, type OHLCV, type Vela } from '@luxalgo/vela';
import { reloadOnlineHistory } from './online-history-reload.ts';
import { assertHistoryContinuous } from './history-continuity.ts';
import { hasContinuousHistory, normalizeProviderBars, providerHistoryCalendar } from './provider-history.ts';

/** Explicit dates are a new engine dataset, never a projection of old trades. */
export interface BacktestWindowMarketRequest {
  readonly mode: 'window' | 'default';
  readonly from?: number;
  readonly to?: number;
  readonly defaultBars?: number;
  /** An undersized cap is an error, never a silently truncated report. */
  readonly limit?: number;
}

export interface BacktestWindowMarketIdentity {
  readonly symbol: string;
  readonly timeframe: string;
  readonly session?: string;
}

export interface BacktestWindowMarketResult {
  readonly requestId: number;
  readonly applied: boolean;
  readonly stale: boolean;
  readonly bars: number;
  readonly from?: number;
  readonly to?: number;
}

export interface BacktestWindowMarketLoaderOptions {
  /** Includes reloads requested through the topbar market controls. */
  readonly onPending?: (request: BacktestWindowMarketRequest, identity: BacktestWindowMarketIdentity) => void;
  /** Synchronous gate immediately before the dataset emits new engine events. */
  readonly onCommit?: (request: BacktestWindowMarketRequest) => void;
  readonly onSettled?: (result: BacktestWindowMarketResult) => void;
  /** Current failures only; superseded work produces no error callback. */
  readonly onError?: (error: unknown) => void;
}

export interface BacktestWindowMarketLoader {
  apply(request: BacktestWindowMarketRequest): Promise<BacktestWindowMarketResult>;
  cancel(): void;
  destroy(): void;
}

type ChartWithData = Pick<Vela, 'market' | 'data' | 'setMarket'> & { on?: Vela['on'] };
type MarketSwitch = Parameters<Vela['setMarket']>[0];
type Identity = BacktestWindowMarketIdentity;
const PAGE_SIZE = 1_000;

const STATIC_WINDOW_STATE = Symbol.for('quant-tools.backtest.static-window-feed.v2');
type StaticWindowState = {
  readonly data: WeakMap<OHLCV[], { info: Awaited<ReturnType<NonNullable<DataProvider['getSymbolInfo']>>> }>;
  readonly feeds: WeakMap<object, WeakSet<OHLCV[]>>;
};
const staticWindows = (() => {
  const root = globalThis as unknown as Record<symbol, StaticWindowState | undefined>;
  const prior = root[STATIC_WINDOW_STATE];
  if (prior && prior.feeds instanceof WeakMap) return prior;
  const state: StaticWindowState = { data: new WeakMap(), feeds: new WeakMap() };
  const load = MultiProviderFeed.prototype.load;
  const loadProgressive = MultiProviderFeed.prototype.loadProgressive;
  const subscribe = MultiProviderFeed.prototype.subscribe;
  const symbolInfo = MultiProviderFeed.prototype.symbolInfo;
  // Vela's generic inline-data demos synthesize random live ticks. Actual
  // historical backtests must never receive invented candles; this applies
  // only to data arrays created by this loader and leaves demo/online feeds
  // untouched. The WeakMap cannot retain a destroyed window's candle array.
  MultiProviderFeed.prototype.subscribe = function (cfg, onBar) {
    const feedData = state.feeds.get(this);
    if (cfg.data && feedData?.has(cfg.data)) return () => {};
    return subscribe.call(this, cfg, onBar);
  };
  MultiProviderFeed.prototype.load = async function (cfg) {
    if (cfg.data && state.data.has(cfg.data)) {
      let feedData = state.feeds.get(this);
      if (!feedData) { feedData = new WeakSet(); state.feeds.set(this, feedData); }
      feedData.add(cfg.data);
    }
    return load.call(this, cfg);
  };
  MultiProviderFeed.prototype.loadProgressive = async function (cfg, onBatch, opts) {
    if (cfg.data && state.data.has(cfg.data)) {
      let feedData = state.feeds.get(this);
      if (!feedData) { feedData = new WeakSet(); state.feeds.set(this, feedData); }
      feedData.add(cfg.data);
    }
    return loadProgressive.call(this, cfg, onBatch, opts);
  };
  MultiProviderFeed.prototype.symbolInfo = function (cfg) {
    const window = cfg.data && state.data.get(cfg.data);
    return window ? window.info : symbolInfo.call(this, cfg);
  };
  root[STATIC_WINDOW_STATE] = state;
  return state;
})();

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positiveInteger(value: unknown, fallback: number): number {
  return finite(value) && value > 0 ? Math.max(1, Math.trunc(value)) : fallback;
}

function marketIdentity(chart: ChartWithData): Identity | null {
  const market = chart.market;
  if (!market || typeof market.symbol !== 'string' || typeof market.timeframe !== 'string') return null;
  return { symbol: market.symbol, timeframe: market.timeframe, session: market.session };
}

function resolveRoute(chart: ChartWithData, symbol: string): { provider: string; ticker: string } {
  const resolved = chart.data.resolve?.(symbol);
  if (resolved) return resolved;
  const separator = symbol.indexOf(':');
  if (separator > 0) return { provider: symbol.slice(0, separator).toLowerCase(), ticker: symbol.slice(separator + 1) };
  throw new Error(`No data provider currently resolves ${symbol}.`);
}

function sameIdentity(a: Identity | null, b: Identity): boolean {
  return a?.symbol === b.symbol && a.timeframe === b.timeframe && a.session === b.session;
}

function result(requestId: number, applied: boolean, bars: number, range: BacktestWindowMarketRequest): BacktestWindowMarketResult {
  return { requestId, applied, stale: !applied, bars,
    ...(range.from === undefined ? {} : { from: range.from }),
    ...(range.to === undefined ? {} : { to: range.to }) };
}

/** Calendar-month bounds must not be approximated by a fixed 30-day duration. */
function adjacentTime(time: number, direction: -1 | 1, timeframe: string, provider: DataProvider): number {
  const month = /^(?:(\d+)M|M)$/.exec(timeframe);
  if (month && providerHistoryCalendar(provider) === 'utc-month') {
    const date = new Date(time);
    date.setUTCMonth(date.getUTCMonth() + direction * Number(month[1] ?? 1));
    return date.getTime();
  }
  return time + direction * resolutionMilliseconds(timeframe);
}

function resolutionMilliseconds(timeframe: string): number {
  const month = /^(?:(\d+)M|M)$/.exec(timeframe);
  return month ? Number(month[1] ?? 1) * 30 * 86_400_000 : timeframeToMs(timeframe);
}

/**
 * Vela `bars` means newest tail depth. Explicit dates are fetched from the
 * public provider and executed as static candles. A public setMarket wrapper
 * keeps those dates while subsequent topbar switches change the resolution.
 */
export function createBacktestWindowMarketLoader(
  chart: ChartWithData,
  options: BacktestWindowMarketLoaderOptions = {},
): BacktestWindowMarketLoader {
  let generation = 0;
  let destroyed = false;
  let selected: BacktestWindowMarketRequest | null = null;
  let requestedIdentity: Identity | null = null;
  let ownCall = false;
  let committing: { requestId: number; identity: Identity } | null = null;
  const originalSetMarket = chart.setMarket;
  const current = (requestId: number): boolean => !destroyed && generation === requestId;
  const stale = (requestId: number, request: BacktestWindowMarketRequest, bars = 0) => result(requestId, false, bars, request);
  const callOriginal = (next: MarketSwitch): Promise<void> => {
    ownCall = true;
    try { return originalSetMarket.call(chart, next); }
    finally { ownCall = false; }
  };

  const execute = async (request: BacktestWindowMarketRequest, identity: Identity): Promise<BacktestWindowMarketResult> => {
    if (destroyed) return stale(generation, request);
    const requestId = ++generation;
    requestedIdentity = identity;
    selected = request.mode === 'window' ? Object.freeze({ ...request }) : null;
    try {
      options.onPending?.(request, identity);
      if (!current(requestId)) return stale(requestId, request);
      if (request.mode === 'default') {
        const count = positiveInteger(request.defaultBars, 2_000);
        options.onCommit?.(request);
        if (!current(requestId)) return stale(requestId, request);
        committing = { requestId, identity };
        // Force a rerun even when symbol and bars are unchanged. Vela's empty
        // data path explicitly loads from the online feed in this application.
        ownCall = true;
        let reload: Promise<void>;
        try { reload = reloadOnlineHistory(chart as Vela, count, {
          symbol: identity.symbol, timeframe: identity.timeframe,
          ...(identity.session === undefined ? {} : { session: identity.session as MarketSwitch['session'] }),
        }); }
        finally { ownCall = false; }
        await reload;
        if (!current(requestId)) return stale(requestId, request);
        const outcome = result(requestId, true, count, request);
        options.onSettled?.(outcome);
        return outcome;
      }
      if (!finite(request.from) || !finite(request.to) || request.from >= request.to) {
        throw new Error('A backtest window needs a valid start date before its end date.');
      }
      const from = request.from, to = request.to;
      const route = resolveRoute(chart, identity.symbol);
      const provider = chart.data.providerInstance(route.provider);
      if (!provider) throw new Error(`Data provider ${route.provider} is unavailable.`);
      const duration = resolutionMilliseconds(identity.timeframe);
      if (!finite(duration) || duration <= 0) throw new Error(`Unsupported backtest timeframe: ${identity.timeframe}.`);
      const estimateDuration = /^(?:\d+)?M$/.test(identity.timeframe) ? duration * 28 / 30 : duration;
      const budget = positiveInteger(request.limit, Math.ceil((to - from) / estimateDuration) + 2);
      const byTime = new Map<number, OHLCV>();
      let cursor = to;
      while (cursor >= from) {
        if (!current(requestId)) return stale(requestId, request, byTime.size);
        const remaining = budget - byTime.size;
        if (remaining <= 0) throw new Error('Backtest window exceeds its candle budget. Choose a shorter range.');
        // No `from` here: Binance's native ranged API walks forward from that
        // boundary, while its `to + limit` API returns the requested tail.
        // Tail paging therefore works consistently for both native providers.
        const range: BarRange = { to: cursor, limit: Math.min(PAGE_SIZE, remaining),
          ...(identity.session === undefined ? {} : { session: identity.session }) };
        const received = await provider.getBars(route.ticker, identity.timeframe, range);
        if (!current(requestId)) return stale(requestId, request, byTime.size);
        if (!Array.isArray(received)) throw new Error('Data provider returned an invalid backtest candle response.');
        const page = normalizeProviderBars(received, range);
        if (!page.length) {
          if (received.length) throw new Error('Data provider did not respect the requested backtest dates.');
          break;
        }
        const oldest = page[0]!.time;
        for (const bar of page) if (bar.time >= from) byTime.set(bar.time, bar);
        cursor = oldest - 1;
        if (hasContinuousHistory(provider)
          && adjacentTime(oldest, -1, identity.timeframe, provider) < from) break;
        // A short response is not proof of coverage. Keep walking until the
        // lower date is reached or the provider explicitly returns empty.
      }
      let bars = [...byTime.values()].sort((a, b) => a.time - b.time);
      if (!bars.length) throw new Error('The selected backtest window returned no candles.');
      if (hasContinuousHistory(provider)) {
        const completeBars = bars.filter((bar) => {
          const end = adjacentTime(bar.time, 1, identity.timeframe, provider);
          return bar.time >= from && end <= to + 1;
        });
        if (!completeBars.length) throw new Error('The selected backtest window contains no complete candles.');
        bars = completeBars;
        assertHistoryContinuous(bars, identity.timeframe, providerHistoryCalendar(provider));
        const first = bars[0]!.time;
        if (adjacentTime(first, -1, identity.timeframe, provider) >= from) {
          throw new Error(`The data provider cannot cover the selected window before ${new Date(first).toISOString()}.`);
        }
        const last = bars.at(-1)!.time;
        const lastClose = adjacentTime(last, 1, identity.timeframe, provider);
        // Only another fully closed candle before the end would be missing.
        // A preset ending now or a weekly/monthly cutoff may legitimately end
        // inside the next candle, whose future OHLC must not enter this run.
        if (adjacentTime(lastClose, 1, identity.timeframe, provider) <= to + 1) {
          throw new Error(`The data provider cannot cover the selected window through ${new Date(to).toISOString()}.`);
        }
      }
      if (!current(requestId)) return stale(requestId, request, bars.length);
      // Preserve the instrument metadata that Vela normally omits for demo
      // inline data (currency, tick size, futures/spot classification).
      const info = await chart.data.symbolInfo?.(identity.symbol);
      if (!current(requestId)) return stale(requestId, request, bars.length);
      staticWindows.data.set(bars, { info });
      options.onCommit?.(request);
      if (!current(requestId)) return stale(requestId, request, bars.length);
      committing = { requestId, identity };
      await callOriginal({ symbol: identity.symbol, timeframe: identity.timeframe,
        ...(identity.session === undefined ? {} : { session: identity.session as MarketSwitch['session'] }),
        data: bars, bars: bars.length, visibleRange: { from, to } });
      if (!current(requestId)) return stale(requestId, request, bars.length);
      const outcome = result(requestId, true, bars.length, request);
      options.onSettled?.(outcome);
      return outcome;
    } catch (error) {
      if (!current(requestId)) return stale(requestId, request);
      options.onError?.(error);
      throw error;
    } finally {
      if (committing?.requestId === requestId) committing = null;
    }
  };

  const wrapped: Vela['setMarket'] = function (next: MarketSwitch): Promise<void> {
    if (ownCall || destroyed) return originalSetMarket.call(chart, next);
    const base = requestedIdentity ?? marketIdentity(chart);
    const identity = base ? { symbol: next.symbol ?? base.symbol, timeframe: next.timeframe ?? base.timeframe,
      session: next.session ?? base.session } : null;
    if (selected && identity && next.data === undefined
      && (!sameIdentity(base, identity) || !sameIdentity(marketIdentity(chart), identity))) {
      // Native toolbar callers fire-and-forget setMarket. onError owns the
      // visible recovery state; do not turn a handled provider outage into an
      // unhandled browser Promise rejection on those callers.
      return execute(selected, identity).then(() => undefined, () => undefined);
    }
    if (selected && next.data === undefined) {
      // Depth/range chips are viewport actions while a fixed calculation
      // window is active. They cannot cancel its pending provider load or
      // silently expand the engine's dataset outside the selected dates.
      return originalSetMarket.call(chart, next.visibleRange === undefined
        ? {} : { visibleRange: next.visibleRange });
    }
    generation += 1;
    requestedIdentity = identity;
    if (next.data !== undefined) selected = null;
    return originalSetMarket.call(chart, next);
  };
  chart.setMarket = wrapped;
  const offMarket = typeof chart.on === 'function' ? chart.on('market:changed', () => {
    const identity = marketIdentity(chart);
    if (committing && sameIdentity(identity, committing.identity)) return;
    if (requestedIdentity && sameIdentity(identity, requestedIdentity)) return;
    generation += 1;
    requestedIdentity = identity;
  }) : () => {};

  return {
    apply(request) {
      const identity = requestedIdentity ?? marketIdentity(chart);
      if (!identity) return Promise.reject(new Error('Chart market is not ready.'));
      return execute(request, identity);
    },
    cancel() { generation += 1; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      selected = null;
      offMarket();
      if (chart.setMarket === wrapped) chart.setMarket = originalSetMarket;
    },
  };
}
