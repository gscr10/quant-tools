import type { DataProvider, OHLCV } from '@luxalgo/vela';

type ProviderKind = 'binance' | 'hyperliquid';

type ProviderRuntime = DataProvider & {
  __quantToolsLiveGuard?: true;
  subscribe?: DataProvider['subscribe'];
  spotWsBase?: (...args: unknown[]) => Promise<string>;
};

// Subscriptions may be opened re-entrantly (for example two workspace cells
// changing markets together). Keep nested temporary constructors composable:
// a later lease can restore past an already-released outer wrapper, and a
// released outer wrapper becomes a transparent pass-through for the lease
// still alive inside it.
const releasedWebSocketWrappers = new WeakSet<object>();
const webSocketWrapperParents = new WeakMap<object, unknown>();

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
  // Binance resolves the spot WebSocket host asynchronously. Keep a small
  // provider-local pending counter so a subscription that is torn down during
  // that await cannot release the constructor guard before `new WebSocket()`
  // runs. The wrapper is installed once on this provider instance and has no
  // effect on the public provider contract.
  let pendingSpotWs = 0;
  const pendingSpotWsReleases = new Set<() => void>();
  if (kind === 'binance' && typeof guarded.spotWsBase === 'function') {
    const upstreamSpotWsBase = guarded.spotWsBase;
    Object.defineProperty(guarded, 'spotWsBase', {
      configurable: true,
      enumerable: false,
      value: async function (this: unknown, ...args: unknown[]): Promise<string> {
        pendingSpotWs += 1;
        try {
          return await upstreamSpotWsBase.apply(this, args);
        } finally {
          pendingSpotWs = Math.max(0, pendingSpotWs - 1);
          if (pendingSpotWs === 0) {
            // The caller's `await spotWsBase()` continuation runs after this
            // promise settles. Defer release by one task so that continuation
            // (which creates the socket) is still covered by the constructor
            // guard, including deliberately adversarial provider doubles.
            setTimeout(() => {
              if (pendingSpotWs !== 0) return;
              for (const release of [...pendingSpotWsReleases]) release();
              pendingSpotWsReleases.clear();
            }, 0);
          }
        }
      },
      writable: true,
    });
  }
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
      let releaseWebSocketGuard: (() => void) | undefined;
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
        if (kind === 'hyperliquid' || kind === 'binance') {
          const guardedSubscription = withWebSocketOpenGuard(invoke, () => active);
          upstreamUnsubscribe = guardedSubscription.value;
          let releaseRequested = false;
          let released = false;
          const releaseNow = (): void => {
            if (released) return;
            released = true;
            pendingSpotWsReleases.delete(releaseNow);
            guardedSubscription.release();
          };
          releaseWebSocketGuard = () => {
            if (releaseRequested) return;
            releaseRequested = true;
            if (pendingSpotWs === 0) releaseNow();
            else pendingSpotWsReleases.add(releaseNow);
          };
        } else {
          upstreamUnsubscribe = invoke();
        }
      } catch (error) {
        active = false;
        releaseWebSocketGuard?.();
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
        } finally {
          // Keep the constructor guard installed until the provider's own
          // unsubscribe has cancelled asynchronous first-connect/reconnect
          // work.  Releasing it at the end of subscribe() misses Binance's
          // awaited spot endpoint and every later Vela reconnect socket.
          releaseWebSocketGuard?.();
          releaseWebSocketGuard = undefined;
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
): { value: T; release: () => void } {
  const native = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof native !== 'function') return { value: invoke(), release: () => {} };

  const Wrapped = function(this: unknown, ...args: unknown[]): unknown {
    const socket = Reflect.construct(native as abstract new (...xs: unknown[]) => object, args);
    if (!releasedWebSocketWrappers.has(Wrapped)) wrapOpenHandler(socket, isActive);
    return socket;
  } as unknown as typeof WebSocket;
  webSocketWrapperParents.set(Wrapped, native);
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
  // Preserve a still-active outer lease.  Nested subscriptions temporarily
  // replace the constructor, and an inner provider failure must unwind to the
  // constructor that was active immediately before this lease—not blindly to
  // the native constructor, which would disable the outer lifecycle guard.
  const previousWebSocket = scope.WebSocket;
  scope.WebSocket = Wrapped;
  try {
    const value = invoke();
    let released = false;
    return {
      value,
      release: () => {
        if (released) return;
        released = true;
        releasedWebSocketWrappers.add(Wrapped);
        if (scope.WebSocket !== Wrapped) return;
        // Skip wrappers whose lease was released before this nested lease.
        // Their constructor is now transparent, so restoring to the first
        // non-released parent preserves the currently active outer seam.
        let target: unknown = native;
        while (target && typeof target === 'function' && releasedWebSocketWrappers.has(target)) {
          target = webSocketWrapperParents.get(target);
        }
        if (target) scope.WebSocket = target;
      },
    };
  } catch (error) {
    if (scope.WebSocket === Wrapped) scope.WebSocket = previousWebSocket;
    throw error;
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
