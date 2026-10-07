import {
  CachingDataFeed,
  timeframeToMs,
  type BarRange,
  type DataProvider,
  type MarketConfig,
  type OHLCV,
} from '@luxalgo/vela';
import { assertHistoryContinuous, historyGaps, repairHistoryGaps, type HistoryCalendar } from './history-continuity.ts';

const PAGE_BARS = 10_000;
const SINGLE_FETCH_BARS = PAGE_BARS + 1;
const EMPTY_PAGE_RETRIES = 3;
const EMPTY_PAGE_RETRY_DELAY_MS = 40;

export interface ResilientPagedRange {
  readonly bars: OHLCV[];
  /** The oldest boundary actually proven by a successful page. */
  readonly coveredDownTo?: number;
}

type PageLoader = (range: BarRange) => Promise<OHLCV[]>;
interface PageOptions {
  /** A guarded provider preserves rejection, so [] proves an empty window. */
  readonly emptyIsBoundary?: boolean;
  /** Only continuous crypto calendars, never arbitrary custom/session feeds. */
  readonly continuous?: boolean;
  readonly calendar?: HistoryCalendar;
}

function estimateBars(range: BarRange, tfMs: number): number {
  if (range.limit != null) return range.limit;
  if (range.from == null) return PAGE_BARS;
  const span = Math.max(0, (range.to ?? Date.now()) - range.from);
  return Math.ceil(span / tfMs * 1.1) + 2;
}

function mergePage(
  target: Map<number, OHLCV>,
  page: readonly OHLCV[],
  cursor: number,
  from?: number,
): { readonly oldest: number; readonly accepted: number } {
  let oldest = Infinity;
  let accepted = 0;
  for (const bar of page) {
    if (bar.time <= cursor && (from == null || bar.time >= from)) {
      if (bar.time < oldest) oldest = bar.time;
      if (!target.has(bar.time)) accepted += 1;
      target.set(bar.time, bar);
    }
  }
  return { oldest, accepted };
}

function sortedBars(byTime: Map<number, OHLCV>): OHLCV[] {
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function boundedResult(bars: OHLCV[], range: BarRange, coveredDownTo?: number): ResilientPagedRange {
  if (range.limit != null && bars.length >= range.limit) {
    const bounded = bars.slice(-range.limit);
    // A count-satisfied tail says nothing about an earlier requested from.
    // This applies to small ranges too, not just multi-page walks.
    return { bars: bounded, coveredDownTo: bounded[0]?.time ?? coveredDownTo };
  }
  return { bars, coveredDownTo };
}

/**
 * Walk a large range without treating an empty failed page as a covered page.
 * Vela 0.7.7's RegistryFetchFeed converts provider rejection to `[]`, and its
 * stock CachingDataFeed then advances by one whole page. This helper retries
 * that same cursor and, if it still cannot be read, reports coverage only down
 * to the last successful page so a later load can repair the missing window.
 */
export async function fetchPagedRangeResilient(
  range: BarRange,
  timeframe: string,
  loadPage: PageLoader,
  options: PageOptions = {},
): Promise<ResilientPagedRange> {
  const tfMs = timeframeToMs(timeframe);
  const estimate = estimateBars(range, tfMs);
  if (estimate <= SINGLE_FETCH_BARS) {
    // Let the final transport failure escape.  Returning an empty page here
    // would make CachingDataFeed's fallback (`range.from`) mark the whole
    // single-page request as covered, which is exactly the permanent-hole
    // behavior this integration boundary is intended to prevent.
    let bars = await loadPage({ ...range, limit: range.limit ?? estimate });
    if (options.continuous) bars = await repairHistoryGaps(bars, timeframe, loadPage, options.calendar);
    return boundedResult(bars, range, range.from ?? bars[0]?.time);
  }

  const byTime = new Map<number, OHLCV>();
  let cursor = range.to ?? Date.now();
  let lastSuccessfulOldest: number | undefined;
  let emptyAtCursor = 0;

  for (;;) {
    if (range.from != null && cursor < range.from) break;
    const want = range.limit != null ? range.limit - byTime.size : PAGE_BARS;
    if (want <= 0) break;

    // Guarded providers already perform bounded transport retries. A final
    // rejection must escape before Vela merges or marks ANY of this range.
    const page = await loadPage({ to: cursor, limit: Math.min(PAGE_BARS, want) });

    if (page.length === 0) {
      if (options.emptyIsBoundary) {
        const bars = sortedBars(byTime);
        return boundedResult(bars, range, range.from ?? bars[0]?.time);
      }
      emptyAtCursor += 1;
      if (emptyAtCursor < EMPTY_PAGE_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, EMPTY_PAGE_RETRY_DELAY_MS * emptyAtCursor));
        continue;
      }
      // Keep the cache honest. `loadRange` will mark this boundary rather than
      // the requested `from`, so the failed page is eligible for a later retry.
      return {
        bars: sortedBars(byTime),
        // No successful page means no lower boundary has been proven. In
        // particular, never use `range.to` here: that would make a failed
        // newest page look covered and could hide the hole behind an older
        // cached series. Vela may still write its fallback watermark, but an
        // empty result has no newly merged bars and the next request remains
        // eligible for a fresh fetch.
        coveredDownTo: lastSuccessfulOldest,
      };
    }

    // Rows before the requested lower boundary prove that the walk has
    // reached it, even when the last page contributes no in-range rows.
    const reachedFrom = range.from != null && page.some(bar => bar.time < range.from! && bar.time <= cursor);
    const merged = mergePage(byTime, page, cursor, range.from);
    if (options.continuous && merged.accepted > 0) {
      const repaired = await repairHistoryGaps(sortedBars(byTime), timeframe, loadPage, options.calendar);
      for (const bar of repaired) byTime.set(bar.time, bar);
    }
    if (reachedFrom) return boundedResult(sortedBars(byTime), range, range.from);
    // A non-empty response with no row at or before the cursor is a provider
    // no-progress response, not proof that the requested history is covered.
    // Treat it like an empty failed page so a transient out-of-window response
    // cannot permanently mark a hole in Vela's cache.
    if (merged.accepted === 0 || !Number.isFinite(merged.oldest)) {
      emptyAtCursor += 1;
      if (emptyAtCursor < EMPTY_PAGE_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, EMPTY_PAGE_RETRY_DELAY_MS * emptyAtCursor));
        continue;
      }
      if (options.emptyIsBoundary) {
        throw new Error('History provider returned no rows in the requested page after bounded retries');
      }
      return {
        bars: sortedBars(byTime),
        coveredDownTo: lastSuccessfulOldest,
      };
    }
    emptyAtCursor = 0;
    lastSuccessfulOldest = merged.oldest;
    if (merged.oldest - 1 >= cursor) break;
    cursor = merged.oldest - 1;
  }

  const bars = sortedBars(byTime);
  const walkedOut = range.from != null && cursor < range.from;
  return boundedResult(bars, range, walkedOut ? range.from : bars[0]?.time);
}

type InternalFeed = {
  inner: {
    loadRange?: (cfg: MarketConfig, range: BarRange) => Promise<OHLCV[]>;
    registry?: { get(name: string): DataProvider | undefined };
  };
  store?: {
    get(key: string): OHLCV[] | undefined;
    series?: Map<string, OHLCV[]>;
    coveredFrom?: Map<string, number>;
  };
  fetchRange: (cfg: MarketConfig, range: BarRange) => Promise<ResilientPagedRange>;
};

type HistoryProvider = DataProvider & {
  __quantToolsHistoryGuard?: true;
  __quantToolsContinuousHistory?: true;
  __quantToolsHistoryCalendar?: HistoryCalendar;
};

/**
 * A guarded provider may legitimately confirm that a symbol has no candles in
 * the requested window. Throwing this private boundary through Vela's cache
 * path keeps that result attached to the load invocation that requested it;
 * the checked load wrapper converts it back to `[]` after clearing Vela's
 * fallback watermark. A shared feed/key marker cannot do that safely when an
 * empty request and a successful request overlap.
 */
class EmptyHistoryBoundary extends Error {
  readonly key: string;

  constructor(key: string) {
    super('History provider confirmed an empty window');
    this.name = 'EmptyHistoryBoundary';
    this.key = key;
  }
}

/** Vela's registry seam is deliberately feature-detected and restricted to
 * our guarded instances. Calling getBars here avoids RegistryFetchFeed's
 * safeBars catch, which otherwise makes a failed range look like valid []. */
function guardedRoute(feed: InternalFeed, cfg: MarketConfig): {
  provider: HistoryProvider; ticker: string; key: string;
} | null {
  if (cfg.data?.length) return null;
  const match = /^([A-Za-z0-9_.]+):(.+)$/.exec((cfg.symbol ?? '').trim());
  if (!match || typeof feed.inner?.registry?.get !== 'function') return null;
  const name = match[1]!.toLowerCase();
  const provider = feed.inner.registry.get(name) as HistoryProvider | undefined;
  if (!provider?.__quantToolsHistoryGuard) return null;
  const ticker = match[2]!;
  const key = `${name}|${ticker}|${cfg.timeframe ?? '60'}${cfg.session && cfg.session !== 'regular' ? `|${cfg.session}` : ''}`;
  return { provider, ticker, key };
}

/** BarStore has one coverage watermark, not an interval set. It cannot safely
 * hold two disjoint islands under that watermark. Evict this series only;
 * another cell/symbol/timeframe must retain its healthy cached history. */
function dropDiscontinuousCache(feed: InternalFeed, cfg: MarketConfig, key: string, calendar?: HistoryCalendar): void {
  const store = feed.store;
  const cached = store?.get(key);
  if (!cached || !historyGaps(cached, cfg.timeframe ?? '60', calendar).length) return;
  if (!(store?.series instanceof Map) || !(store.coveredFrom instanceof Map)) {
    throw new Error('Vela history cache cannot invalidate unconfirmed candle coverage');
  }
  store.series.delete(key);
  store.coveredFrom.delete(key);
}

// Vite HMR re-evaluates this module while retaining the Vela package
// prototype. A module-local flag would then wrap `fetchRange`/`load*` again on
// every edit, so keep the install sentinel on the runtime global instead.
const INSTALL_STATE_KEY = Symbol.for('quant-tools.vela.history-resilience.install.v1');
type InstallState = { installed: boolean; prototype?: object };
const installState = (() => {
  const runtime = globalThis as unknown as Record<symbol, unknown>;
  const existing = runtime[INSTALL_STATE_KEY];
  if (existing && typeof existing === 'object' && 'installed' in existing) {
    return existing as InstallState;
  }
  const created: InstallState = { installed: false };
  Object.defineProperty(runtime, INSTALL_STATE_KEY, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: created,
  });
  return created;
})();
/** Install the narrow integration patch before VelaWorkspace creates feeds. */
export function installVelaHistoryResilience(): void {
  const prototype = CachingDataFeed.prototype as unknown as InternalFeed;
  // A normal Vite HMR reload keeps the dependency prototype, while a full
  // dependency reload may replace it. Reinstall only for that new runtime;
  // this keeps the guard correct in both cases without stacking wrappers.
  if (installState.installed && installState.prototype === prototype) return;
  const original = prototype.fetchRange;
  if (typeof original !== 'function') return;
  installState.installed = true;
  installState.prototype = prototype;
  Object.defineProperty(prototype, 'fetchRange', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: function patchedFetchRange(this: InternalFeed, cfg: MarketConfig, range: BarRange) {
      if (!this.inner?.loadRange) return original.call(this, cfg, range);
      const route = guardedRoute(this, cfg);
      const result = fetchPagedRangeResilient(
        range,
        cfg.timeframe ?? '60',
        route
          ? pageRange => route.provider.getBars(route.ticker, cfg.timeframe ?? '60', { ...pageRange, session: cfg.session })
          : pageRange => this.inner.loadRange!(cfg, pageRange),
        { emptyIsBoundary: route !== null, continuous: route?.provider.__quantToolsContinuousHistory === true,
          calendar: route?.provider.__quantToolsHistoryCalendar },
      );
      if (!route) return result;
      return result.then((rangeResult) => {
        if (rangeResult.bars.length === 0) throw new EmptyHistoryBoundary(route.key);
        return rangeResult;
      });
    },
  });

  // The original cache can answer a historical hit without fetchRange, or
  // merge a newly requested disjoint window with another cached island.
  // Validate both sides of those paths as well as pages fetched this time.
  for (const method of ['load', 'loadRange', 'loadProgressive'] as const) {
    const runtime = CachingDataFeed.prototype as unknown as Record<string, (this: InternalFeed, cfg: MarketConfig, ...args: unknown[]) => Promise<OHLCV[] | null>>;
    const load = runtime[method];
    if (typeof load !== 'function') continue;
    Object.defineProperty(runtime, method, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: async function checkedLoad(this: InternalFeed, cfg: MarketConfig, ...args: unknown[]) {
        const route = guardedRoute(this, cfg);
        if (!route?.provider.__quantToolsContinuousHistory) return load.call(this, cfg, ...args);
        const calendar = route.provider.__quantToolsHistoryCalendar;
        dropDiscontinuousCache(this, cfg, route.key, calendar);
        let bars: OHLCV[] | null;
        try {
          bars = await load.call(this, cfg, ...args);
        } catch (error) {
          if (error instanceof EmptyHistoryBoundary && error.key === route.key) {
            // The sentinel belongs to this exact load call, so a concurrent
            // successful load cannot consume or invalidate its result.
            this.store?.coveredFrom?.delete(route.key);
            bars = [];
          } else {
            throw error;
          }
        }
        dropDiscontinuousCache(this, cfg, route.key, calendar);
        if (bars) assertHistoryContinuous(bars, cfg.timeframe ?? '60', calendar);
        return bars;
      },
    });
  }
}
