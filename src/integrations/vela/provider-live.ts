import type { DataProvider, OHLCV } from '@luxalgo/vela';

type ProviderKind = 'binance' | 'hyperliquid';

type ProviderRuntime = DataProvider & {
  __quantToolsLiveGuard?: true;
  subscribe?: DataProvider['subscribe'];
};

/**
 * Keep provider callbacks inside the lifetime of the chart subscription.
 *
 * Vela's bundled providers intentionally keep their polling request alive when
 * an unsubscribe races an in-flight `getBars()`.  Their poll loop checks its
 * stopped flag only before the request, so a late response can still call the
 * chart callback after the chart has moved away.  This instance-local seam
 * preserves the upstream provider while making the callback contract strict.
 */
export function guardProviderSubscription<T extends DataProvider>(
  provider: T,
  kind: ProviderKind,
): T {
  const guarded = provider as ProviderRuntime;
  if (guarded.__quantToolsLiveGuard || typeof guarded.subscribe !== 'function') return provider;

  const upstreamSubscribe = guarded.subscribe.bind(guarded);
  Object.defineProperty(guarded, 'subscribe', {
    configurable: true,
    enumerable: false,
    value: (
      ticker: string,
      timeframe: string,
      onBar: (bar: OHLCV) => void,
      options?: { session?: string },
    ) => {
      let active = true;
      let stopped = false;

      const guardedCallback = (bar: OHLCV): void => {
        if (!active) return;
        onBar(bar);
      };

      let upstreamUnsubscribe: (() => void) | undefined;
      try {
        // Hyperliquid creates its WebSocket synchronously.  A short-lived
        // constructor seam lets us wrap `onopen` before the upstream method
        // assigns it, so an onopen event racing unsubscribe cannot recreate
        // the provider's ping interval. Binance futures has the same shape;
        // spot's async endpoint resolution is covered by guardedCallback and
        // its own `closed` check after the await.
        const invoke = () => upstreamSubscribe(
          ticker,
          timeframe,
          guardedCallback,
          options,
        );
        upstreamUnsubscribe = kind === 'hyperliquid' || kind === 'binance'
          ? withWebSocketOpenGuard(invoke, () => active)
          : invoke();
      } catch (error) {
        active = false;
        throw error;
      }

      return (): void => {
        if (stopped) return;
        stopped = true;
        // Flip the guard before touching the upstream closure.  If the
        // provider is already resolving a REST request, its late callback is
        // then harmless even if its own stopped check is incomplete.
        active = false;
        try {
          upstreamUnsubscribe?.();
        } catch {
          // Unsubscribe is a best-effort lifecycle operation.  Do not let a
          // provider teardown error escape and break the workspace destroy
          // stack; the callback guard remains effective either way.
        }
      };
    },
    writable: true,
  });
  Object.defineProperty(guarded, '__quantToolsLiveGuard', {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return provider;
}

/**
 * Run one synchronous provider subscription while wrapping every WebSocket it
 * constructs.  The global is restored immediately, so the seam is limited to
 * the provider call and cannot affect unrelated application sockets.
 */
function withWebSocketOpenGuard<T>(
  invoke: () => T,
  isActive: () => boolean,
): T {
  const native = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof native !== 'function') return invoke();

  const Wrapped = function(this: unknown, ...args: unknown[]): unknown {
    const socket = Reflect.construct(native as abstract new (...xs: unknown[]) => object, args);
    wrapOpenHandler(socket, isActive);
    return socket;
  } as unknown as typeof WebSocket;
  // Preserve `instanceof WebSocket` and any constructor statics that the
  // upstream provider might inspect while the temporary seam is installed.
  Wrapped.prototype = (native as { prototype: unknown }).prototype as WebSocket;
  try {
    Object.setPrototypeOf(Wrapped, native);
  } catch {
    // Some test doubles expose a non-extensible constructor.  The provider
    // does not require static WebSocket fields, so the fallback is harmless.
  }

  const scope = globalThis as { WebSocket?: unknown };
  scope.WebSocket = Wrapped;
  try {
    return invoke();
  } finally {
    // Avoid clobbering another caller's short-lived seam if subscriptions are
    // started re-entrantly.
    if (scope.WebSocket === Wrapped) scope.WebSocket = native;
  }
}

function findPropertyDescriptor(
  value: object | null,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  let cursor: object | null = value;
  while (cursor !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, property);
    if (descriptor) return descriptor;
    cursor = Object.getPrototypeOf(cursor) as object | null;
  }
  return undefined;
}

/** Install an active-state gate around a socket's onopen property. */
function wrapOpenHandler(socket: object, isActive: () => boolean): void {
  const descriptor = findPropertyDescriptor(socket, 'onopen');
  let current: unknown = descriptor?.get?.call(socket) ?? descriptor?.value ?? null;

  const guarded = (handler: unknown): unknown => {
    if (typeof handler !== 'function') return handler;
    return function(this: unknown, event: unknown): unknown {
      if (!isActive()) {
        try {
          (socket as { close?: () => void }).close?.();
        } catch {
          // Closing a socket that lost the unsubscribe race is best effort.
        }
        return undefined;
      }
      return (handler as (this: unknown, event: unknown) => unknown).call(this, event);
    };
  };

  try {
    Object.defineProperty(socket, 'onopen', {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get: () => current,
      set: (handler: unknown) => {
        current = guarded(handler);
        descriptor?.set?.call(socket, current);
      },
    });
  } catch {
    // A host-specific WebSocket implementation may make event properties
    // non-configurable.  The callback guard still protects chart state.
  }
}
