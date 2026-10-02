import type { DataProvider, SymbolDescriptor } from '@luxalgo/vela';
import { BinanceProvider } from '@luxalgo/vela/providers/binance';
import { HyperliquidProvider } from '@luxalgo/vela/providers/hyperliquid';
import { guardProviderHistory } from './provider-history.ts';
import { guardProviderSubscription } from './provider-live.ts';
import { guardProviderNetwork } from './provider-network.ts';
import { resolveLocalSymbolIcon } from '../../shared/asset-logos.ts';
import { enableProviderProgressiveHistory } from './provider-progressive.ts';

export interface WorkspaceProviderOptions {
  /**
   * BTC/ETH use bundled local vectors; other assets retain initials by default.
   * Keep remote crypto-icon CDN requests off by default so a local production
   * build has no hidden image dependency; hosts that deliberately accept that
   * dependency can opt in at the integration boundary.
   */
  remoteSymbolIcons?: boolean;
  /** Hard deadline for each public provider REST attempt (default 10 seconds). */
  requestTimeoutMs?: number;
  /**
   * Deadline for one symbol-index call (default 30 seconds).  This is wider
   * than every bounded REST path so ordinary cold exchange responses are not
   * mistaken for an outage.
   */
  indexTimeoutMs?: number;
  /**
   * Called once when a complete index arrives after this provider already had
   * to expose its fallback.  A workspace uses this to re-register the same
   * provider through Vela's public DataControl API and rebuild the registry's
   * one-shot symbol snapshot.
   */
  onIndexRecovered?: (
    kind: 'binance' | 'hyperliquid',
    provider: DataProvider,
  ) => void;
}

/**
 * The two bundled crypto providers always serve a well-known smoke/default
 * market.  Their upstream symbol enumeration is an optional convenience for
 * the picker; it must not be allowed to make a persisted bare symbol wait
 * forever when the enumeration endpoint is temporarily unavailable.
 */
const PROVIDER_INDEX_FALLBACKS: Record<'binance' | 'hyperliquid', readonly SymbolDescriptor[]> = {
  binance: [{ ticker: 'BTCUSDT', description: 'BTC / USDT', type: 'crypto' }],
  hyperliquid: [{ ticker: 'BTC', description: 'BTC / USD Perpetual', type: 'futures' }],
};

/**
 * Keep bare-symbol resolution finite during an exchange-index outage.  The
 * fallback is intentionally tiny and only applies to an empty/failed index;
 * successful enumeration remains byte-for-byte upstream-owned.  Explicit
 * `binance:SYMBOL`/`hyperliquid:SYMBOL` routing is unaffected.
 */
export function guardProviderIndex<T extends DataProvider>(
  provider: T,
  kind: 'binance' | 'hyperliquid',
  options: Pick<WorkspaceProviderOptions, 'indexTimeoutMs' | 'onIndexRecovered'> = {},
): T {
  const listSymbols = provider.listSymbols?.bind(provider);
  if (!listSymbols) return provider;

  const timeoutMs = normalizeIndexTimeout(options.indexTimeoutMs);
  let cachedSymbols: SymbolDescriptor[] | undefined;
  type IndexAttempt = {
    active: boolean;
    promise: Promise<SymbolDescriptor[]>;
    timedOut: boolean;
    /** The upstream cached Promise for this attempt, when the provider exposes one. */
    upstreamPromise?: Promise<unknown>;
  };
  let inFlight: IndexAttempt | null = null;
  let fallbackExposed = false;
  let recoveryNotified = false;
  let recoveryRetryStarted = false;

  const fallback = (): SymbolDescriptor[] => PROVIDER_INDEX_FALLBACKS[kind]
    .map((symbol) => ({ ...symbol }));

  const load = (): IndexAttempt => {
    if (inFlight) return inFlight;

    const attempt: IndexAttempt = {
      active: true,
      // Replaced immediately below.  Keeping the object identity stable lets
      // the completion handler clear only the matching in-flight attempt.
      promise: Promise.resolve([]),
      timedOut: false,
    };

    // Always consume the upstream rejection.  A provider may leave its own
    // index promise pending indefinitely, so callers race this shared attempt
    // against a local deadline while the rejection/late response remains
    // handled here.  Vela's bundled Binance/Hyperliquid providers cache the
    // enumeration promise on the instance; capture that identity so a failed
    // or empty attempt can clear only its own cache entry and a later explicit
    // listSymbols call (or connectivity recovery) can retry.  A timed-out but
    // still-pending attempt is deliberately preserved and may recover late.
    attempt.promise = Promise.resolve()
      .then(() => {
        // Keep the exact Promise identity returned by the provider.  Wrapping
        // it in `Promise.resolve()` would create a different identity for
        // thenables and would prevent the cache reset from matching Vela's
        // own `symbolsPromise` field.
        const upstream = listSymbols();
        attempt.upstreamPromise = upstream;
        return upstream;
      })
      .then((symbols) => {
        if (!Array.isArray(symbols) || symbols.length === 0) {
          resetProviderIndexCaches(provider, attempt.upstreamPromise);
          return [];
        }
        let normalized: SymbolDescriptor[];
        try {
          normalized = symbols.map((symbol) => ({ ...symbol }));
        } catch {
          // Treat a malformed descriptor as an unavailable index.  This keeps
          // the background attempt rejection-safe just like a network error.
          resetProviderIndexCaches(provider, attempt.upstreamPromise);
          return [];
        }
        if (attempt.active && inFlight === attempt) {
          cachedSymbols = normalized;
          if (fallbackExposed && !recoveryNotified && options.onIndexRecovered) {
            recoveryNotified = true;
            // Keep the provider promise independent from host lifecycle code.
            // The workspace callback re-checks both destruction and provider
            // identity before it uses Vela's public re-registration surface.
            queueMicrotask(() => {
              try {
                options.onIndexRecovered?.(kind, provider);
              } catch {
                // Index recovery is best effort; a host callback must not turn
                // a valid provider response into a rejected listSymbols call.
              }
            });
          }
        }
        return normalized;
      }, () => {
        resetProviderIndexCaches(provider, attempt.upstreamPromise);
        return [];
      })
      .finally(() => {
        if (inFlight === attempt) inFlight = null;
      });
    inFlight = attempt;
    return attempt;
  };

  /**
   * A timeout by itself keeps the original request alive so a merely slow
   * response can still recover the registry.  A later explicit call (the
   * workspace's `online` probe included) is the signal to supersede an attempt
   * that still has not settled.  Promise-identity cache cleanup ensures the old
   * attempt cannot clear or overwrite the replacement when it resolves later.
   */
  const supersedeTimedOutAttempt = (): void => {
    const previous = inFlight;
    if (!previous?.timedOut) return;
    previous.active = false;
    resetProviderIndexCaches(provider, previous.upstreamPromise);
    if (inFlight === previous) inFlight = null;
  };

  /**
   * The bundled providers cache their enumeration promise.  Empty/rejected
   * attempts clear that cache above; make one bounded background retry so a
   * transient outage can recover the already-settled Vela registry without a
   * page reload.  A late first attempt is never duplicated: this starts only
   * after that attempt has settled empty.
   */
  const retryRecoveryOnce = (): void => {
    if (!options.onIndexRecovered || recoveryRetryStarted || cachedSymbols) return;
    recoveryRetryStarted = true;
    queueMicrotask(() => {
      const retry = load();
      // `load()` contains both rejection handling and recovered notification.
      void retry.promise;
    });
  };

  const boundedLoad = async (): Promise<SymbolDescriptor[]> => {
    if (cachedSymbols) return cachedSymbols.map((symbol) => ({ ...symbol }));
    supersedeTimedOutAttempt();
    const attempt = load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ kind: 'timeout' }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    });
    try {
      const result = await Promise.race([
        attempt.promise.then((symbols) => ({ kind: 'upstream' as const, symbols })),
        timeout,
      ]);
      if (result.kind === 'timeout') {
        // Return a resolvable default now, but keep consuming this exact
        // attempt.  If its healthy response is merely late, `load()` caches it
        // and asks the workspace to rebuild Vela's one-shot registry snapshot.
        attempt.timedOut = true;
        fallbackExposed = true;
        void attempt.promise.then((symbols) => {
          if (symbols.length === 0) retryRecoveryOnce();
        });
        return fallback();
      }
      if (result.symbols.length > 0) {
        return result.symbols.map((symbol) => ({ ...symbol }));
      }
      fallbackExposed = true;
      retryRecoveryOnce();
      return fallback();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  Object.defineProperty(provider, 'listSymbols', {
    configurable: true,
    enumerable: false,
    value: boundedLoad,
    writable: true,
  });
  return provider;
}

/**
 * Vela's crypto providers memoize symbol enumeration (and Hyperliquid's
 * underlying `meta`/`spotMeta` requests) on each instance.  Those fields are
 * intentionally private implementation details, so this compatibility seam
 * touches them only when they are own, writable data properties and only when
 * their value is the Promise belonging to the failed/empty attempt.  Timeout
 * alone never clears these fields, so a slow healthy response remains usable;
 * a later explicit retry clears only the exact timed-out Promise it supersedes.
 */
function resetProviderIndexCaches(
  provider: DataProvider,
  expectedSymbolsPromise: Promise<unknown> | undefined,
): void {
  // Without the exact upstream identity there is no safe way to distinguish
  // an old failure from a newer retry.  Leave the provider cache untouched;
  // clearing an arbitrary current value here would reintroduce the stale
  // response race this guard is designed to prevent.
  if (expectedSymbolsPromise === undefined) return;
  const runtime = provider as DataProvider & {
    symbolsPromise?: unknown;
    metaPromise?: unknown;
    spotMetaPromise?: unknown;
  };
  const own = (key: 'symbolsPromise' | 'metaPromise' | 'spotMetaPromise'): PropertyDescriptor | undefined => {
    try {
      return Object.getOwnPropertyDescriptor(runtime, key);
    } catch {
      return undefined;
    }
  };
  const clear = (
    key: 'symbolsPromise' | 'metaPromise' | 'spotMetaPromise',
    onlyIf?: unknown,
  ): void => {
    const descriptor = own(key);
    if (!descriptor || !('value' in descriptor)) return;
    if (onlyIf !== undefined && descriptor.value !== onlyIf) return;
    // The bundled providers expose writable own fields.  Keep this defensive
    // for test doubles/host subclasses with a non-writable descriptor.
    if (descriptor.writable === false) return;
    try {
      runtime[key] = null;
    } catch {
      // A provider-specific cache is an optimization; a failed reset must not
      // turn an otherwise handled index outage into a thrown picker error.
    }
  };

  clear('symbolsPromise', expectedSymbolsPromise);
  // Hyperliquid's listSymbols() is composed from these two cached metadata
  // promises.  They are cleared only when the failed symbol attempt is the
  // current cache entry; a late stale attempt cannot touch a newer retry.
  if (expectedSymbolsPromise !== undefined) {
    const symbolsDescriptor = own('symbolsPromise');
    if (symbolsDescriptor && 'value' in symbolsDescriptor && symbolsDescriptor.value === null) {
      clear('metaPromise');
      clear('spotMetaPromise');
    }
  }
}

function normalizeIndexTimeout(value: number | undefined): number {
  if (!Number.isFinite(value) || (value as number) <= 0) return 30_000;
  return Math.max(1, Math.floor(value as number));
}

function prepareProvider<T extends DataProvider>(
  provider: T,
  kind: 'binance' | 'hyperliquid',
  options: WorkspaceProviderOptions,
): T {
  // Keep all compatibility seams instance-local.  The 30s index budget is
  // intentionally wider than the bounded network path; it prevents a hung
  // provider from parking a bare symbol without truncating normal cold loads.
  const guarded = guardProviderIndex(
    guardProviderSubscription(
      guardProviderHistory(guardProviderNetwork(provider, kind, options)),
      kind,
    ),
    kind,
    options,
  );
  if (kind === 'binance') enableProviderProgressiveHistory(guarded);
  if (options.remoteSymbolIcons === true) return guarded;
  // Do not mutate Vela's prototype.  The instance is freshly created for one
  // workspace registration, so an own non-enumerable override is sufficient
  // and preserves the upstream constructor/capability shape for diagnostics.
  Object.defineProperty(guarded, 'resolveSymbolIcon', {
    configurable: true,
    enumerable: false,
    value: resolveLocalSymbolIcon,
    writable: true,
  });
  return guarded;
}

export function createWorkspaceProviders(options: WorkspaceProviderOptions = {}) {
  return {
    // Vela's provider classes stay upstream-owned; this per-instance seam
    // repairs ranged-history boundaries without changing live subscriptions.
    binance: () => prepareProvider(new BinanceProvider(), 'binance', options),
    hyperliquid: () => prepareProvider(new HyperliquidProvider(), 'hyperliquid', options),
  };
}
