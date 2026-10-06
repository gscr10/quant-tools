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

// The bundled providers detect a stream that never emits its first candle,
// and reconnect after `close`, but an already-open socket can still become
// silent without firing either signal.  Once a live callback has established
// the stream, bound the silence window so a half-open connection is replaced
// before the workspace consumes stale market data.  Twelve seconds is shorter
// than the upstream stream-stall watchdog and leaves enough margin below the
// provider soak continuity gate for a fresh socket handshake.
const LIVE_SILENCE_TIMEOUT_MS = 12_000;
const LIVE_RECONNECT_RETRY_MS = 2_000;

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

      // A browser can go offline while a WebSocket remains OPEN (or while a
      // proxy silently blackholes it).  The upstream providers reconnect on
      // `close`, but cannot observe that half-open state.  Tear down the
      // current lease on `offline` and create a fresh upstream subscription
      // on `online`.  Each start receives a generation token so a late event
      // from the old socket cannot publish into the newly resumed stream.
      let generation = 0;
      let currentUnsubscribe: (() => void) | undefined;
      let currentRelease: (() => void) | undefined;
      let pausedOffline = false;
      let silenceTimer: ReturnType<typeof setTimeout> | undefined;

      const clearSilenceWatchdog = (): void => {
        if (silenceTimer === undefined) return;
        clearTimeout(silenceTimer);
        silenceTimer = undefined;
      };

      const armSilenceWatchdog = (token: number): void => {
        clearSilenceWatchdog();
        silenceTimer = setTimeout(() => {
          silenceTimer = undefined;
          if (!active || stopped || pausedOffline || token !== generation) return;
          // Invalidate the old generation before asking the provider to open a
          // new lease.  Any callback queued by the silent socket is therefore
          // ignored even when its close event is delivered later.
          stopCurrent();
          retryCurrentStart();
        }, LIVE_SILENCE_TIMEOUT_MS);
      };

      const stopCurrent = (): void => {
        generation += 1;
        clearSilenceWatchdog();
        const unsubscribe = currentUnsubscribe;
        const release = currentRelease;
        currentUnsubscribe = undefined;
        currentRelease = undefined;
        try {
          unsubscribe?.();
        } catch {
          // Provider teardown is best effort; generation invalidation above
          // still makes any late callback harmless.
        } finally {
          release?.();
        }
      };

      const startCurrent = (): void => {
        if (!active || stopped || pausedOffline) return;
        const token = ++generation;
        const guardedCallback = (bar: OHLCV): void => {
          if (!active || stopped || token !== generation) return;
          onBar(bar);
          if (active && !stopped && token === generation && !pausedOffline) {
            armSilenceWatchdog(token);
          }
        };
        const invoke = () => upstreamSubscribe(
          ticker,
          timeframe,
          guardedCallback,
          options,
        );
        let upstreamUnsubscribe: (() => void) | undefined;
        let releaseWebSocketGuard: (() => void) | undefined;
        try {
          // Hyperliquid creates its WebSocket synchronously. A short-lived
          // constructor seam lets us wrap `onopen` before the upstream method
          // assigns it; Binance spot's awaited endpoint remains covered by
          // the pending constructor lease below.
          if (kind === 'hyperliquid' || kind === 'binance') {
            const guardedSubscription = withWebSocketOpenGuard(invoke, () => (
              active && !stopped && token === generation && !pausedOffline
            ));
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
          releaseWebSocketGuard?.();
          if (token === generation) generation += 1;
          throw error;
        }
        // A synchronous offline event may have raced the provider call. Do
        // not retain a just-created socket in that case.
        if (!active || stopped || token !== generation || pausedOffline) {
          try { upstreamUnsubscribe?.(); } catch { /* best effort */ }
          releaseWebSocketGuard?.();
          return;
        }
        currentUnsubscribe = upstreamUnsubscribe;
        currentRelease = releaseWebSocketGuard;
        // A socket can open successfully yet never publish a first candle
        // (for example when the exchange stream is half-open or the
        // subscription acknowledgement is lost).  Arm the same bounded
        // watchdog immediately after the lease is installed so this state
        // cannot wait forever for the first callback.  Each received bar
        // re-arms it from guardedCallback, preserving the idle-stream check.
        armSilenceWatchdog(token);
      };

      const retryCurrentStart = (): void => {
        if (!active || stopped || pausedOffline) return;
        try {
          startCurrent();
        } catch {
          // A transient constructor failure must not strand the lease. Retry
          // with a bounded delay while preserving the generation gate.
          if (!active || stopped || pausedOffline) return;
          silenceTimer = setTimeout(() => {
            silenceTimer = undefined;
            retryCurrentStart();
          }, LIVE_RECONNECT_RETRY_MS);
        }
      };

      const eventTarget = globalThis as typeof globalThis & {
        addEventListener?: (type: string, listener: () => void) => void;
        removeEventListener?: (type: string, listener: () => void) => void;
      };
      const onOffline = (): void => {
        if (!active || stopped || pausedOffline) return;
        pausedOffline = true;
        stopCurrent();
      };
      const onOnline = (): void => {
        if (!active || stopped || !pausedOffline) return;
        // startCurrent intentionally refuses to create a lease while paused;
        // clear the gate for this attempt and restore it only if construction
        // fails, allowing a later online event to retry.
        pausedOffline = false;
        try {
          startCurrent();
        } catch {
          // Retain pausedOffline=true so a subsequent online notification can
          // retry. No error escapes the browser event handler.
          pausedOffline = true;
        }
      };
      eventTarget.addEventListener?.('offline', onOffline);
      eventTarget.addEventListener?.('online', onOnline);
      try {
        startCurrent();
      } catch (error) {
        active = false;
        eventTarget.removeEventListener?.('offline', onOffline);
        eventTarget.removeEventListener?.('online', onOnline);
        throw error;
      }

      return (): void => {
        if (stopped) return;
        stopped = true;
        // Flip the guard before touching the upstream closure.  If the
        // provider is already resolving a REST request, its late callback is
        // then harmless even if its own stopped check is incomplete.
        active = false;
        eventTarget.removeEventListener?.('offline', onOffline);
        eventTarget.removeEventListener?.('online', onOnline);
        stopCurrent();
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
