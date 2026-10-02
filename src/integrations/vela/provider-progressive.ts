import type { BarRange, DataProvider, OHLCV } from '@luxalgo/vela';
import { normalizeProviderBars, normalizeProviderRange } from './provider-history.ts';

const NATIVE = new Set([
  '1', '3', '5', '15', '30', '60', '120', '240', '360', '480', '720', 'D', 'W', 'M',
  '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h',
  '1d', '1w', '1mo', '1D', '1W', '4H',
]);

export interface ProgressiveHistoryResult {
  readonly error: unknown | null;
  readonly aborted: boolean;
  readonly bars: number;
  readonly oldestTime: number | null;
}

export interface ProgressiveHistoryRequest {
  readonly ticker: string;
  readonly timeframe: string;
  readonly range: Readonly<BarRange>;
  readonly result: Promise<ProgressiveHistoryResult>;
}

const listeners = new WeakMap<DataProvider, Set<(request: ProgressiveHistoryRequest) => void>>();

/** Subscribe before enabling this capability. Feed completion alone is not proof
 * of success: Vela 0.7.7 catches provider rejection and substitutes an empty list. */
export function subscribeProgressiveHistoryRequests(
  provider: DataProvider,
  listener: (request: ProgressiveHistoryRequest) => void,
): () => void {
  const entries = listeners.get(provider) ?? new Set();
  listeners.set(provider, entries);
  entries.add(listener);
  return () => { entries.delete(listener); if (!entries.size) listeners.delete(provider); };
}

/** The native list deliberately mirrors the pinned Binance adapter. Aggregated
 * resolutions, ranged loads and deep-history orchestration retain the old path. */
export function supportsProgressiveHistory(timeframe: string, range: BarRange): boolean {
  const normalized = normalizeProviderRange(range);
  return normalized !== null && normalized.from === undefined
    && normalized.limit !== undefined && normalized.limit > 1_000 && normalized.limit <= 5_000
    && NATIVE.has(timeframe);
}

/** Do not cancel a shared transport. Stop awaiting it, consume its eventual
 * rejection, and suppress subsequent pages/publication for this consumer only. */
async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | undefined> {
  if (!signal) return promise;
  if (signal.aborted) { void promise.catch(() => {}); return undefined; }
  let remove = () => {};
  const aborted = new Promise<undefined>((resolve) => {
    const abort = () => resolve(undefined);
    signal.addEventListener('abort', abort, { once: true });
    remove = () => signal.removeEventListener('abort', abort);
  });
  try { return await Promise.race([promise, aborted]); }
  finally { remove(); }
}

/** Install only on the Binance instance AFTER network/history guards. This
 * adds no global cache, does not touch prototypes, and keeps getBars unchanged.
 *
 * Safety prerequisite: the workspace must consume request.result and forbid
 * ready/Simulation on error or abort BEFORE Vela's final history event. Errors
 * return the confirmed prefix, so the already-painted chart is not cleared by
 * ProviderFeed's catch-to-[] behavior. They never imply successful genesis.
 */
export function enableProviderProgressiveHistory<T extends DataProvider>(provider: T): T {
  if (provider.getBarsProgressive) return provider;
  const getBars = provider.getBars.bind(provider);
  const progressive = async (
    ticker: string,
    timeframe: string,
    requested: BarRange,
    onBatch: (bars: OHLCV[]) => void,
    opts?: { signal?: AbortSignal },
  ): Promise<OHLCV[] | null> => {
    // The public .d.ts omits null, but ProviderFeed/CachedDataFeed explicitly
    // propagate it as "not served". Returning it preserves deep loadRange,
    // aggregation and single-page paths without duplicating upstream logic.
    if (!supportsProgressiveHistory(timeframe, requested) || !listeners.get(provider)?.size) return null;
    const range = normalizeProviderRange(requested)!;
    let settle!: (result: ProgressiveHistoryResult) => void;
    const result = new Promise<ProgressiveHistoryResult>((resolve) => { settle = resolve; });
    const request = Object.freeze({ ticker, timeframe, range: Object.freeze({ ...range }), result });
    for (const listener of listeners.get(provider) ?? []) {
      try { listener(request); } catch { /* diagnostics cannot alter the load */ }
    }
    let confirmed: OHLCV[] = [];
    let error: unknown | null = null;
    const signal = opts?.signal;
    let cursor = range.to;
    try {
      while (!signal?.aborted && confirmed.length < range.limit!) {
        const size = Math.min(1_000, range.limit! - confirmed.length);
        const pageRange: BarRange = { ...range, limit: size, ...(cursor === undefined ? {} : { to: cursor }) };
        const received = await abortable(getBars(ticker, timeframe, pageRange), signal);
        if (received === undefined || signal?.aborted) break;
        const page = normalizeProviderBars(received, pageRange);
        if (page.length === 0) {
          // An empty *valid* response proves genesis. A non-empty response
          // that normalizes to empty means the provider ignored the requested
          // boundary or returned unusable rows; treating that as genesis
          // would silently publish an incomplete history.
          if (Array.isArray(received) && received.length > 0) {
            error = new Error('progressive history response made no usable progress');
          }
          break;
        }
        // A faulty gateway can ignore `to` and return the same page forever.
        // The cursor would still decrement from that repeated oldest candle,
        // so checking only cursor movement is insufficient and can leave the
        // startup request spinning until the browser aborts it.  Every page
        // after the first must be strictly older than the confirmed prefix;
        // otherwise publish the confirmed prefix with an explicit error and
        // never claim complete history or enable Simulation.
        const previousOldest = confirmed[0]?.time;
        if (previousOldest !== undefined && page[page.length - 1]!.time >= previousOldest) {
          error = new Error('progressive history made no chronological progress');
          break;
        }
        // Existing recent candles win by construction; each earlier request
        // is strictly older, preventing overlap from replacing a forming bar.
        confirmed = [...page, ...confirmed];
        cursor = page[0]!.time - 1;
        // Give callbacks copies: a renderer must not mutate the pagination
        // cursor, next callback, or final returned data through a shared array.
        onBatch(confirmed.map(bar => ({ ...bar })));
        if (page.length < size) {
          // A short page is not, by itself, proof that the provider reached
          // genesis.  Binance/Hyperliquid normally use a short page for
          // genesis, but a proxy, rate limiter, or a provider-side page cap
          // can also return a partial answer while older candles exist.  A
          // one-row probe keeps that distinction explicit without exposing a
          // probe candle (or a second callback) to the chart.  If the probe
          // succeeds, the regular page request below fills the whole gap;
          // if it fails, the request is an error rather than false history
          // completion.  The probe is still abortable and never starts after
          // this consumer has been cancelled.
          const probeRange: BarRange = { ...range, limit: 1, to: cursor };
          const probeReceived = await abortable(getBars(ticker, timeframe, probeRange), signal);
          if (probeReceived === undefined || signal?.aborted) break;
          const probe = normalizeProviderBars(probeReceived, probeRange);
          if (probe.length === 0) {
            if (Array.isArray(probeReceived) && probeReceived.length > 0) {
              error = new Error('progressive history probe made no usable progress');
            }
            break;
          }
          // Older data exists. Continue with a normal-sized page at the same
          // cursor; do not append the probe because doing so would leave a
          // hole between it and the already-confirmed prefix.
        }
      }
    } catch (caught) {
      error = caught;
    } finally {
      settle(Object.freeze({ error, aborted: signal?.aborted ?? false,
        bars: confirmed.length, oldestTime: confirmed[0]?.time ?? null }));
    }
    return confirmed;
  };
  Object.defineProperty(provider, 'getBarsProgressive', {
    configurable: true, writable: true,
    value: progressive as NonNullable<DataProvider['getBarsProgressive']>,
  });
  return provider;
}
