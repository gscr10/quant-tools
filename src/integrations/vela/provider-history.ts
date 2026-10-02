import type { BarRange, DataProvider, OHLCV } from '@luxalgo/vela';

/**
 * Validate and copy a Vela bar range before it reaches a third-party provider.
 *
 * Vela's range contract is inclusive on both open-time bounds and treats
 * `limit` as a maximum row count.  The bundled Binance/Hyperliquid adapters
 * predate the equal-bound case and one of them ignores `limit` on ranged
 * requests.  Keeping this normalization at the integration boundary lets us
 * retain the upstream provider classes while making their observable output
 * conform to Vela's data contract.
 */
export function normalizeProviderRange(range: BarRange | undefined): BarRange | null {
  const input = range ?? {};
  const from = input.from;
  const to = input.to;
  const limit = input.limit;

  // Epoch milliseconds may legally be before 1970 for a generic feed; only
  // reject non-finite bounds here.  Binance/Hyperliquid naturally return
  // positive timestamps, but this helper should not add a venue-specific rule.
  if (from !== undefined && !Number.isFinite(from)) return null;
  if (to !== undefined && !Number.isFinite(to)) return null;
  if (from !== undefined && to !== undefined && from > to) return null;
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) return null;

  const normalizedLimit = limit === undefined ? undefined : Math.floor(limit);
  if (normalizedLimit !== undefined && normalizedLimit <= 0) return null;

  return {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(normalizedLimit === undefined ? {} : { limit: normalizedLimit }),
    ...(input.session === undefined ? {} : { session: input.session }),
  };
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Return the width of one provider candle in milliseconds.  Vela passes the
 * canonical minute spellings (`"15"`, `"60"`) to providers, but accepting the
 * human spellings here keeps the integration safe for direct callers too.
 * Unknown resolutions deliberately return `undefined`; a point retry should
 * never turn into an unbounded request merely because a new provider added a
 * resolution this adapter does not know yet.
 */
function timeframeDurationMs(timeframe: unknown): number | undefined {
  // Provider calls are typed, but this is an integration boundary and can be
  // reached from JavaScript/Vela runtime values. Invalid timeframe input must
  // not turn the point-range recovery path into an incidental TypeError.
  if (typeof timeframe !== 'string') return undefined;
  const value = timeframe.trim();
  const upper = value.toUpperCase();
  // `m` = minute but `M` = month in Pine/Vela, so month detection must remain
  // case-sensitive.  Day/week spellings are unambiguous and can be folded.
  if (value === 'M' || value === '1M' || value.toLowerCase() === '1mo') {
    return 30 * 24 * 60 * 60 * 1_000;
  }
  if (upper === 'D' || upper === '1D') return 24 * 60 * 60 * 1_000;
  if (upper === 'W' || upper === '1W') return 7 * 24 * 60 * 60 * 1_000;

  // Keep the original suffix case: Pine/Vela use lower-case `m` for minutes
  // while `M` denotes a month.  The canonical provider form (`"15"`) has no
  // suffix and is handled as minutes below.
  const match = /^(\d+(?:\.\d+)?)(m(?:in(?:ute)?s?)?|h(?:r|ours?)?|d(?:ays?)?|w(?:eeks?)?)?$/i.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = (match[2] ?? 'm').toLowerCase();
  const multiplier = unit.startsWith('h')
    ? 60 * 60 * 1_000
    : unit.startsWith('d')
      ? 24 * 60 * 60 * 1_000
      : unit.startsWith('w')
        ? 7 * 24 * 60 * 60 * 1_000
        : 60 * 1_000;
  const duration = amount * multiplier;
  return Number.isSafeInteger(duration) ? duration : undefined;
}

/**
 * Normalize an upstream provider response to Vela's OHLCV contract.
 * Invalid rows are ignored locally, duplicate open times use the newest row,
 * and the result is always ascending and bounded by the requested range.
 */
export function normalizeProviderBars(
  bars: readonly OHLCV[] | unknown,
  range: BarRange,
): OHLCV[] {
  if (!Array.isArray(bars)) return [];
  const boundedRange = normalizeProviderRange(range);
  if (boundedRange === null) return [];

  const byTime = new Map<number, OHLCV>();
  for (const candidate of bars) {
    if (candidate === null || typeof candidate !== 'object') continue;
    const row = candidate as Partial<OHLCV>;
    if (!validNumber(row.time)
      || !validNumber(row.open)
      || !validNumber(row.high)
      || !validNumber(row.low)
      || !validNumber(row.close)) {
      continue;
    }
    if (boundedRange.from !== undefined && row.time < boundedRange.from) continue;
    if (boundedRange.to !== undefined && row.time > boundedRange.to) continue;

    // Volume is optional.  An invalid optional value should not poison an
    // otherwise valid candle; omit it and let the chart treat it as unknown.
    const normalized: OHLCV = {
      time: row.time,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      ...(validNumber(row.volume) ? { volume: row.volume } : {}),
    };
    byTime.set(normalized.time, normalized);
  }

  let result = [...byTime.values()].sort((a, b) => a.time - b.time);
  if (boundedRange.limit !== undefined) {
    // A ranged request is a bounded tail request in Vela's cache and
    // request.security paths.  Keep the newest rows when a source returned
    // more than requested, matching the fixture/provider contract.
    result = result.slice(-boundedRange.limit);
  }
  return result;
}

type GuardedProvider = DataProvider & { __quantToolsHistoryGuard?: true };

export interface ProviderHistoryRequest {
  readonly ticker: string;
  readonly timeframe: string;
  readonly range: Readonly<BarRange>;
  readonly result: Promise<{ readonly error: unknown | null; readonly bars: number; readonly oldestTime: number | null }>;
}
const historyListeners = new WeakMap<DataProvider, Set<(request: ProviderHistoryRequest) => void>>();

/** Preserve transport failures even when the upstream provider/feed turns them
 * into []. The Promise is per invocation, never a mutable provider-wide flag. */
export function subscribeProviderHistoryRequests(
  provider: DataProvider,
  listener: (request: ProviderHistoryRequest) => void,
): () => void {
  const listeners = historyListeners.get(provider) ?? new Set();
  historyListeners.set(provider, listeners);
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) historyListeners.delete(provider); };
}

/**
 * Apply the contract guard to one provider instance at the Vela integration
 * boundary.  This intentionally mutates only the freshly-created instance;
 * the upstream package and its prototype remain untouched.  As a result all
 * optional capabilities (`info`, symbol enumeration, WebSocket subscription,
 * etc.) retain their original implementations and the instance still reports
 * the upstream constructor name to existing workspace diagnostics.
 */
export function guardProviderHistory<T extends DataProvider>(provider: T): T {
  const guarded = provider as GuardedProvider;
  if (guarded.__quantToolsHistoryGuard) return provider;

  const upstreamGetBars = provider.getBars;
  const guardedGetBars = async (ticker: string, timeframe: string, requestedRange: BarRange) => {
    const range = normalizeProviderRange(requestedRange);
    if (range === null) return [];

    let settle!: (result: { error: unknown | null; bars: number; oldestTime: number | null }) => void;
    const result = new Promise<{ error: unknown | null; bars: number; oldestTime: number | null }>(resolve => { settle = resolve; });
    const request = Object.freeze({ ticker, timeframe, range: Object.freeze({ ...range }), result });
    for (const listener of historyListeners.get(provider) ?? []) {
      try { listener(request); } catch { /* observers cannot alter provider execution */ }
    }
    let transportError: unknown | null = null;
    // The bundled providers swallow json()/post() failures. Give THIS call a
    // receiver with request-local transport wrappers, retaining the instance
    // as its prototype (and all symbol/cache/subscription capabilities). Never
    // temporarily overwrite a shared method: concurrent ranges must not share
    // error ownership. Only guarded bundled transports need this seam.
    const runtime = provider as DataProvider & { __quantToolsNetworkGuard?: true; json?: (...args: unknown[]) => Promise<unknown>; post?: (...args: unknown[]) => Promise<unknown> };
    const receiver = runtime.__quantToolsNetworkGuard ? Object.create(provider) as typeof runtime : provider;
    if (receiver !== provider) {
      for (const method of ['json', 'post'] as const) {
        const transport = runtime[method];
        if (!transport) continue;
        Object.defineProperty(receiver, method, { value: async (...args: unknown[]) => {
          try {
            const payload = await transport.apply(provider, args);
            const candleRequest = method === 'json'
              ? typeof args[0] === 'string' && /\/klines(?:\?|$)/.test(args[0])
              : (args[0] as { type?: string } | undefined)?.type === 'candleSnapshot';
            if (candleRequest && !Array.isArray(payload)) throw new Error('Invalid provider candle response: expected an array');
            if (candleRequest && (payload as unknown[]).some(row => {
              const values = method === 'json'
                ? Array.isArray(row) && row.length >= 5 ? row.slice(0, 5) : null
                : row && typeof row === 'object'
                  ? ['t', 'o', 'h', 'l', 'c'].map(key => (row as Record<string, unknown>)[key]) : null;
              return !values || values.some(value => value === null || value === '' || !Number.isFinite(Number(value)));
            })) throw new Error('Invalid provider candle response: malformed OHLC row');
            return payload;
          }
          catch (error) { transportError = error; throw error; }
        } });
      }
    }

    try {
      let bars = await upstreamGetBars.call(receiver, ticker, timeframe, range);
      if (transportError !== null) throw transportError;
      let normalized = normalizeProviderBars(bars, range);

    // Binance's forward paginator uses `while (cursor < to)`, so a point
    // range (`from === to`) can incorrectly return no row.  Retry once with a
    // single-candle upper bound, then apply the exact inclusive filter locally.
    // Keeping the upper bound narrow is important for Hyperliquid: deleting it
    // would ask candleSnapshot for `from..now` (up to its ~5000-candle cap) just
    // to recover one point.
      if (range.from !== undefined
        && range.to !== undefined
        && range.from === range.to
        && normalized.length === 0) {
        const duration = timeframeDurationMs(timeframe);
        if (duration !== undefined) {
          const pointEnd = range.from <= Number.MAX_SAFE_INTEGER - duration + 1
            ? range.from + duration - 1
            : range.from;
          const pointRetry = { ...range, to: pointEnd, limit: 1 };
          bars = await upstreamGetBars.call(receiver, ticker, timeframe, pointRetry);
          if (transportError !== null) throw transportError;
          normalized = normalizeProviderBars(bars, range);
        }
      }
      settle({ error: null, bars: normalized.length, oldestTime: normalized[0]?.time ?? null });
      return normalized;
    } catch (error) {
      settle({ error, bars: 0, oldestTime: null });
      throw error;
    }
  };
  // Keep the same non-enumerable method shape as a prototype method.  Some
  // host diagnostics spread provider instances while building capability
  // snapshots; the guard must not leak an implementation detail there.
  Object.defineProperty(guarded, 'getBars', {
    configurable: true,
    enumerable: false,
    value: guardedGetBars,
    writable: true,
  });
  Object.defineProperty(guarded, '__quantToolsHistoryGuard', {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return provider;
}
