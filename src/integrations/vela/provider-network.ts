import type { DataProvider } from '@luxalgo/vela';

// Browser chart requests can traverse a local proxy or a cold exchange edge.
// Five seconds caused intermittent empty Hyperliquid snapshots even though
// the endpoint recovered on the same page shortly afterwards.  Keep the
// request bounded, but give a normal history request one 10s budget.  Symbol
// enumeration gets a wider independent deadline at the registry boundary, so
// ordinary cold index responses are not truncated by picker fallback policy.
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const BINANCE_GLOBAL_HOST = 'api.binance.com';
const BINANCE_US_HOST = 'api.binance.us';
const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
const MAX_METADATA_CACHE_ENTRIES = 64;

type ProviderKind = 'binance' | 'hyperliquid';

interface ProviderNetworkGuardOptions {
  requestTimeoutMs?: number;
  /** Successful exchange metadata cache lifetime; disabled when non-positive. */
  metadataCacheTtlMs?: number;
}

type ProviderRuntime = DataProvider & {
  __quantToolsNetworkGuard?: true;
  json?: (url: string) => Promise<unknown>;
  post?: (body: unknown) => Promise<unknown>;
  /** Vela Binance's private-but-runtime-visible spot endpoint seam. */
  spotBase?: () => Promise<string>;
  spotBaseUrl?: string | null;
  spotBaseProbe?: Promise<string> | null;
};

/**
 * Serialize the small JSON request bodies used by the Hyperliquid provider in
 * a deterministic way.  The provider frequently creates equivalent objects
 * at different call sites (for example `{ type, coin, interval }` versus the
 * same keys in another insertion order); those requests should share one
 * in-flight transport.  This is intentionally not a response cache: entries
 * live only until their request settles.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

function requestKey(provider: ProviderKind, url: string, body?: unknown): string {
  return `${provider}|${url}|${body === undefined ? '' : canonicalJson(body)}`;
}

function metadataCacheTtlMs(value: number | undefined): number {
  if (value === undefined) return 5 * 60_000;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(1_000, Math.floor(value));
}

function isBinanceMetadataUrl(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith('/exchangeInfo');
  } catch {
    return false;
  }
}

function isHyperliquidMetadataBody(body: unknown): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const type = (body as Record<string, unknown>).type;
  return type === 'meta' || type === 'spotMeta';
}

/**
 * Share only concurrent work for one provider instance.  The map is scoped to
 * the guarded instance, so a Binance request can never satisfy a Hyperliquid
 * request or a request from another cell/provider.  Failed requests are
 * removed just like successful ones, allowing the next caller to retry.
 */
function inFlightRequest<T>(
  requests: Map<string, Promise<T>>,
  completed: Map<string, { value: T; expiresAt: number }>,
  key: string,
  cacheTtlMs: number,
  cacheable: boolean,
  operation: () => Promise<T>,
): Promise<T> {
  if (cacheable && cacheTtlMs > 0) {
    const cached = completed.get(key);
    if (cached) {
      if (cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
      completed.delete(key);
    }
  }
  const existing = requests.get(key);
  if (existing) return existing;

  const request = operation();
  requests.set(key, request);
  const clear = (): void => {
    if (requests.get(key) === request) requests.delete(key);
  };
  if (cacheable && cacheTtlMs > 0) {
    request.then((value) => {
      if (completed.size >= MAX_METADATA_CACHE_ENTRIES && !completed.has(key)) {
        const oldest = completed.keys().next().value;
        if (oldest !== undefined) completed.delete(oldest);
      }
      completed.set(key, { value, expiresAt: Date.now() + cacheTtlMs });
    }, () => {
      completed.delete(key);
    });
  }
  // Do not replace the returned promise with `finally()`: that would create a
  // second rejection path which callers could accidentally leave unhandled.
  request.then(clear, clear);
  return request;
}

class ProviderHttpError extends Error {
  readonly provider: ProviderKind;
  readonly status: number;
  readonly url: string;

  constructor(
    provider: ProviderKind,
    status: number,
    url: string,
  ) {
    super(`${provider} HTTP ${status} for ${url}`);
    this.name = 'ProviderHttpError';
    this.provider = provider;
    this.status = status;
    this.url = url;
  }
}

class ProviderTimeoutError extends Error {
  readonly provider: ProviderKind;
  readonly timeoutMs: number;
  readonly url: string;

  constructor(
    provider: ProviderKind,
    timeoutMs: number,
    url: string,
  ) {
    super(`${provider} request timed out after ${timeoutMs}ms for ${url}`);
    this.name = 'ProviderTimeoutError';
    this.provider = provider;
    this.timeoutMs = timeoutMs;
    this.url = url;
  }
}

function requestTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.max(1, Math.floor(value));
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ProviderTimeoutError || error instanceof TypeError) return true;
  if (!(error instanceof ProviderHttpError)) return false;
  return error.status === 408
    || error.status === 425
    || error.status === 429
    || error.status >= 500;
}

function isSameEndpointRetryable(error: unknown): boolean {
  // Repeating a request that consumed the full deadline only doubles a known
  // outage.  Same-endpoint recovery is reserved for quick transport failures
  // and retryable HTTP responses; spot can still switch to its independent US
  // mirror after a timeout.
  return !(error instanceof ProviderTimeoutError) && isRetryable(error);
}

/**
 * Fetch and decode one public provider response within a hard deadline.
 *
 * The race is intentional in addition to AbortController: browsers abort their
 * native fetch, while the race also keeps the workspace responsive if a proxy or
 * test double fails to observe the signal.  The losing fetch promise remains
 * handled by Promise.race, so a late rejection cannot become unhandled.
 */
async function fetchJson(
  provider: ProviderKind,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = globalThis.fetch(url, { ...init, signal: controller.signal }).then(async (response) => {
    if (!response.ok) throw new ProviderHttpError(provider, response.status, url);
    return response.json() as Promise<unknown>;
  });
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new ProviderTimeoutError(provider, timeoutMs, url);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function binanceMirror(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === BINANCE_GLOBAL_HOST) {
      parsed.hostname = BINANCE_US_HOST;
    } else if (parsed.hostname === BINANCE_US_HOST) {
      parsed.hostname = BINANCE_GLOBAL_HOST;
    } else {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

async function fetchBinanceJson(
  url: string,
  timeoutMs: number,
  onSuccess: (url: string) => void,
): Promise<unknown> {
  try {
    const result = await fetchJson('binance', url, {}, timeoutMs);
    onSuccess(url);
    return result;
  } catch (error) {
    const mirror = binanceMirror(url);
    if (mirror === null) {
      if (!isSameEndpointRetryable(error)) throw error;
    } else if (!(error instanceof ProviderHttpError) && !isRetryable(error)) {
      throw error;
    }
    // The two spot hosts do not expose identical markets and Binance global
    // can answer 403/451 in regions served by Binance.US.  Conversely, the US
    // host answers 400 for global-only symbols.  Vela's original spot probe
    // treats any non-ok response as a reason to try the other host, so retain
    // that behavior here instead of restricting mirror failover to 5xx/429.
    // Spot has a genuinely independent public mirror.  Futures does not, so a
    // single same-endpoint retry is the least surprising transient recovery.
    const retryUrl = mirror ?? url;
    const result = await fetchJson('binance', retryUrl, {}, timeoutMs);
    onSuccess(retryUrl);
    return result;
  }
}

/** Remember a successful spot host without touching Vela's prototype. */
function rememberBinanceEndpoint(provider: ProviderRuntime, url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === BINANCE_GLOBAL_HOST) {
      provider.spotBaseUrl = `https://${BINANCE_GLOBAL_HOST}/api/v3`;
      provider.spotBaseProbe = null;
    } else if (parsed.hostname === BINANCE_US_HOST) {
      provider.spotBaseUrl = `https://${BINANCE_US_HOST}/api/v3`;
      provider.spotBaseProbe = null;
    }
  } catch {
    // A non-URL (or a non-spot URL) is a futures/third-party seam; leave the
    // cached spot endpoint unchanged.
  }
}

/**
 * Vela 0.7.7 resolves a Binance spot base before calling its `json()` method.
 * The upstream resolver performs a separate `/ping` probe, which doubles the
 * outage latency before the real request.  Return the normal global base
 * immediately; the guarded `json()` below performs the actual bounded
 * global↔US request and therefore remains the single source of endpoint
 * health.  The original provider prototype is left untouched.
 */
function guardBinanceSpotBase(provider: ProviderRuntime): void {
  if (typeof provider.spotBase !== 'function') return;
  Object.defineProperty(provider, 'spotBase', {
    configurable: true,
    enumerable: false,
    value: async (): Promise<string> => {
      if (provider.spotBaseUrl) return provider.spotBaseUrl;
      return `https://${BINANCE_GLOBAL_HOST}/api/v3`;
    },
    writable: true,
  });
}

async function postHyperliquid(body: unknown, timeoutMs: number): Promise<unknown> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  try {
    return await fetchJson('hyperliquid', HYPERLIQUID_INFO_URL, init, timeoutMs);
  } catch (error) {
    if (!isSameEndpointRetryable(error)) throw error;
    // All /info requests used here are read-only snapshots.  Retry once so a
    // transient connection reset does not permanently empty Vela's cached index.
    return fetchJson('hyperliquid', HYPERLIQUID_INFO_URL, init, timeoutMs);
  }
}

/**
 * Add bounded REST requests to Vela's bundled providers without replacing their
 * history, symbol enumeration, metadata, or WebSocket implementations.
 *
 * Vela 0.7.7 routes all Binance REST JSON through `json()` and all Hyperliquid
 * REST calls through `post()`.  Installing an own, non-enumerable method keeps
 * provider identity/capabilities intact and confines the compatibility seam to
 * the two provider instances owned by this workspace.
 */
export function guardProviderNetwork<T extends DataProvider>(
  provider: T,
  kind: ProviderKind,
  options: ProviderNetworkGuardOptions = {},
): T {
  const guarded = provider as ProviderRuntime;
  if (guarded.__quantToolsNetworkGuard) return provider;
  const timeoutMs = requestTimeoutMs(options.requestTimeoutMs);
  const inFlight = new Map<string, Promise<unknown>>();
  const completed = new Map<string, { value: unknown; expiresAt: number }>();
  const metadataTtlMs = metadataCacheTtlMs(options.metadataCacheTtlMs);

  if (kind === 'binance') {
    guardBinanceSpotBase(guarded);
    Object.defineProperty(guarded, 'json', {
      configurable: true,
      enumerable: false,
      value: (url: string) => inFlightRequest(
        inFlight,
        completed,
        requestKey('binance', url),
        metadataTtlMs,
        isBinanceMetadataUrl(url),
        () => fetchBinanceJson(
          url,
          timeoutMs,
          (successfulUrl) => rememberBinanceEndpoint(guarded, successfulUrl),
        ),
      ),
      writable: true,
    });
  } else {
    Object.defineProperty(guarded, 'post', {
      configurable: true,
      enumerable: false,
      value: (body: unknown) => inFlightRequest(
        inFlight,
        completed,
        requestKey('hyperliquid', HYPERLIQUID_INFO_URL, body),
        metadataTtlMs,
        isHyperliquidMetadataBody(body),
        () => postHyperliquid(body, timeoutMs),
      ),
      writable: true,
    });
  }

  Object.defineProperty(guarded, '__quantToolsNetworkGuard', {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return provider;
}
