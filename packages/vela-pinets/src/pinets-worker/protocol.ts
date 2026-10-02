import type { OHLCV } from '@luxalgo/vela/plugin';
import type { InputValue } from '@luxalgo/vela/plugin';
import type { IndicatorModel } from '@luxalgo/vela/plugin';
import type { BarRange } from '@luxalgo/vela/plugin';
import type { PreparedScript, ExecutionMarket, VisibleBarRange, EngineAlert, EngineWarning, ContextSelect } from '@luxalgo/vela/plugin';
import type { PropsFilter, PineBarMagnifierOptions } from '../pinets/runtime';
import type { PineContextSnapshot } from '../pinets/contextSnapshot';

/**
 * The message protocol between `PineWorkerEngine` (main thread) and `worker.ts`
 * (worker thread). Everything here is structured-clone-serializable — notably the
 * neutral `IndicatorModel`, which is plain data, so results cross for free.
 *
 * Functions in the port (`getBars`, `fetchSeries`, handlers) don't cross the wire:
 * bars are shipped as data, handler callbacks become worker→main messages, and a
 * `fetchSeries` call becomes a request/response pair (the worker asks, the main
 * thread — which owns the provider cache + network — answers). Runtime-level
 * session caches may coalesce selected requests before they cross this wire.
 */

export type MainToWorker =
    | { kind: 'prepare'; reqId: number; source: string; instanceId: string; defaultProps?: Record<string, InputValue>; propsVisibility?: PropsFilter }
    | { kind: 'execute'; sessionId: number; prepared: PreparedScript; market: ExecutionMarket; bars: OHLCV[]; inputs: Record<string, InputValue>; props?: Record<string, InputValue>; visibleRange?: VisibleBarRange; mode?: 'static' | 'live'; historyState?: 'backfill' | 'complete'; barMagnifier?: PineBarMagnifierOptions }
    | { kind: 'update'; sessionId: number; inputs: Record<string, InputValue>; props?: Record<string, InputValue> }
    | { kind: 'setVisibleRange'; sessionId: number; range: VisibleBarRange }
    | { kind: 'notifyBars'; sessionId: number; bars: OHLCV[] }
    /**
     * LIVE sessions only — bar delta for the worker-local array the streaming
     * provider polls. Normally the TAIL (the forming bar + anything newer since
     * the last send); with `restart: true` a FULL snapshot that (re)starts the
     * stream over it (history backfill completed / inputs changed).
     */
    | { kind: 'bars'; sessionId: number; bars: OHLCV[]; restart?: boolean }
    | { kind: 'getContext'; sessionId: number; reqId: number; select?: ContextSelect }
    | { kind: 'stop'; sessionId: number }
    | {
        kind: 'fetchSeriesResult';
        reqId: number;
        bars?: OHLCV[];
        /** Kept as a string for compatibility with older worker bundles. */
        error?: string;
        /** Optional clone-safe diagnostics for provider failures. */
        errorDetails?: WorkerRuntimeError;
    };

/**
 * Structured runtime-error metadata that survives the Worker boundary.
 *
 * `Error` objects are not a stable wire type: browser structured cloning can
 * drop custom fields (and in some browsers even the name). Keep the original
 * message for backwards compatibility, while carrying the Pine method/name
 * when the engine provides them. Hosts may ignore this optional envelope.
 */
export interface WorkerRuntimeError {
    readonly name?: string;
    readonly method?: string;
    /** Stable coarse category for host/UI error mapping. */
    readonly kind?: 'pine-runtime' | 'provider' | 'worker' | 'compile' | 'unknown';
    readonly code?: string;
    readonly provider?: string;
    readonly status?: number;
    readonly timeoutMs?: number;
    readonly url?: string;
    readonly retryable?: boolean;
}

export type WorkerToMain =
    | { kind: 'prepared'; reqId: number; prepared?: PreparedScript; error?: string; errorDetails?: WorkerRuntimeError }
    | { kind: 'model'; sessionId: number; model: IndicatorModel }
    | { kind: 'alert'; sessionId: number; alert: EngineAlert }
    | { kind: 'warning'; sessionId: number; warning: EngineWarning }
    | { kind: 'error'; sessionId: number; message: string; error?: WorkerRuntimeError }
    | { kind: 'done'; sessionId: number }
    | { kind: 'reactsToViewport'; sessionId: number; value: boolean }
    | { kind: 'contextResult'; reqId: number; snapshot: PineContextSnapshot | null }
    | {
        kind: 'fetchSeries';
        /** The worker session whose provider/cache gateway owns this request. */
        sessionId: number;
        reqId: number;
        symbol: string;
        timeframe: string;
        range: BarRange;
    };

/** Minimal Worker surface the proxy needs — the real `Worker` satisfies it; tests inject a fake. */
export interface WorkerErrorEvent {
    /** Browser `ErrorEvent.error`; may be absent for a `messageerror`. */
    readonly error?: unknown;
    /** Browser `ErrorEvent.message`; not guaranteed on `messageerror`. */
    readonly message?: string;
}

export interface WorkerLike {
    postMessage(message: unknown): void;
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
    /** Runtime failures must settle the proxy instead of leaving runs pending. */
    addEventListener(type: 'error' | 'messageerror', listener: (event: WorkerErrorEvent) => void): void;
    terminate(): void;
}
