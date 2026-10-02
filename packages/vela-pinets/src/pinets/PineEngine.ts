import { snapshotFromCtx } from './contextSnapshot';
import { updatePineSettings } from './settingsBatch';
import type {
    ScriptingEngine,
    EngineCapabilities,
    PreparedScript,
    ExecutionHandlers,
    ExecutionSession,
} from '@luxalgo/vela/plugin';
import type { OHLCV } from '@luxalgo/vela/plugin';
import type { InputValue } from '@luxalgo/vela/plugin';
import {
    preparePine,
    indicatorFor,
    runPineStatic,
    openLiveStream,
    LowerTimeframeFetchCache,
    type LiveStreamHandle,
    type IndicatorCache,
    type PineToken,
    type PropsFilter,
    type PineExecutionRequest,
} from './runtime';
import { executionProvenance, hasCurrentBuildSentinel, PINE_EXECUTION_BUILD_INFO } from '../build-info';

/** Keep host-side error callbacks from breaking the execution scheduler. */
function notifyError(handlers: ExecutionHandlers, error: Error): void {
    try {
        handlers.onError?.(error);
    } catch {
        // Rendering/diagnostic callbacks are outside the engine boundary. A
        // throwing callback must not turn a handled provider/runtime failure
        // into an unhandled promise rejection or wedge queued runs.
    }
}

/** A failed request must still return a safe, idempotent session object. */
function inertExecutionSession(): ExecutionSession {
    return {
        getContext: () => Promise.resolve(null),
        stop: () => undefined,
        update: () => undefined,
        setVisibleRange: () => undefined,
        notifyBars: () => undefined,
    };
}

/** The prepared token plus the in-process Indicator cache (reused across re-runs/ticks). */
type PineSession = PineToken & IndicatorCache;

/** Options for {@link PineEngine}. */
export interface PineEngineOptions {
    /**
     * Host-level defaults for declaration props (`initial_capital`, `precision`, …),
     * applied BENEATH source-declared values: a script that declares the prop keeps
     * its own value; a script that omits it gets the host's default instead of the
     * Pine spec one. Folded into the props schema's `defval`s at prepare, so the
     * settings dialog opens on them and "Reset defaults" restores them.
     */
    defaultProps?: Record<string, InputValue>;
    /**
     * Which scripts publish the declaration-props schema (drives whether the
     * settings dialog shows a "Properties" tab): `'all'` (default) every script,
     * `'strategy'` only `strategy()` scripts, `'none'` no script — or an explicit
     * WHITELIST of prop keys, published in the list's order (a script owning none
     * of the listed keys gets no tab). Presentation-only: hidden props keep their
     * source/spec values, and `setProps` still applies.
     */
    props?: PropsFilter;
}

/**
 * The in-process PineTS implementation of `ScriptingEngine`. Both the static run
 * and the live stream go through the shared `runtime` — the same code the
 * worker-backed `PineWorkerEngine` runs — so this class is just the in-process
 * wiring to the port. Vela owns market data and passes bars into `execute`;
 * this engine never fetches.
 */
export class PineEngine implements ScriptingEngine {
    readonly language = 'pine';
    readonly capabilities: EngineCapabilities = { streaming: true, visibleRange: true, inputs: true, props: true };
    /** Stable identity of the local bridge + embedded PineTS build. */
    readonly buildFingerprint = PINE_EXECUTION_BUILD_INFO.buildFingerprint;
    private readonly defaultProps: Record<string, InputValue> | undefined;
    private readonly propsVisibility: PropsFilter;

    constructor(opts: PineEngineOptions = {}) {
        this.defaultProps = opts.defaultProps;
        this.propsVisibility = opts.props ?? 'all';
    }

    prepare(source: string, instanceId: string): Promise<PreparedScript> {
        // Keep parse/transpile failures on the Promise boundary. Calling
        // `Promise.resolve(preparePine(...))` evaluates preparePine before the
        // Promise is created and therefore throws synchronously for malformed
        // Pine, unlike the Worker engine and the public async contract.
        return Promise.resolve().then(() => preparePine(source, instanceId, this.defaultProps, this.propsVisibility));
    }

    execute(req: PineExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        let preparedIsCurrent = false;
        try {
            preparedIsCurrent = hasCurrentBuildSentinel(req.prepared?.token);
        } catch {
            preparedIsCurrent = false;
        }
        if (!preparedIsCurrent) {
            notifyError(handlers, new Error('PineTS build sentinel mismatch: stale or foreign PreparedScript'));
            return inertExecutionSession();
        }
        const token = req.prepared.token as PineSession;
        const precisionRequest = req;
        const getBars = req.getBars ?? ((): OHLCV[] => req.bars);
        let inputs: Record<string, InputValue> = { ...(req.inputs ?? {}) };
        let props: Record<string, InputValue> = { ...(req.props ?? {}) };
        let visibleRange = req.visibleRange;
        let stopped = false;
        const settingsKey = {};
        // One cache per execution session. It is passed only to the Bar
        // Magnifier resolver; request.security keeps its existing provider
        // fetch semantics and is intentionally not cached here.
        const lowerTimeframeFetchCache = new LowerTimeframeFetchCache();

        // ── Live streaming: one persistent context, re-executes only the forming bar per tick ──
        if (req.mode === 'live' && this.capabilities.streaming) {
            let stream: LiveStreamHandle | null = null;
            let started = false;

            const start = (): void => {
                if (stopped) return;
                started = true;
                // A stream restart (backfill completion or input/prop change)
                // may keep the same parent range while lower candles have
                // changed. Do not carry a fulfilled Bar Magnifier window into
                // the replacement stream.
                lowerTimeframeFetchCache.clear();
                stream?.stop();
                try {
                    stream = openLiveStream({
                        token,
                        cache: token,
                        prepared: req.prepared,
                        inputs,
                        props,
                        bars: getBars,
                        market: () => req.market,
                        fetchSeries: req.fetchSeries,
                        barMagnifier: precisionRequest.barMagnifier,
                        lowerTimeframeFetchCache,
                        visibleRange,
                        onModel: (m) => {
                            if (!stopped) handlers.onModel(m);
                        },
                        onAlert: (a) => {
                            if (!stopped) handlers.onAlert?.(a);
                        },
                        onWarning: (w) => {
                            if (!stopped) handlers.onWarning?.(w);
                        },
                        onError: (e) => {
                            if (!stopped) notifyError(handlers, e);
                        },
                    });
                } catch (error) {
                    // Stream setup can fail synchronously before PineTS has
                    // installed its asynchronous error event (for example an
                    // invalid runtime prop). Keep the execution session alive
                    // and expose the same host-facing error contract.
                    stream = null;
                    if (!stopped) notifyError(handlers, error instanceof Error ? error : new Error(String(error)));
                }
            };
            // Policy A: during a history backfill the stream must not start — its history
            // length is FROZEN at start() (ticks only re-feed the tail), so a stream begun
            // over a partial history would never see the rest. `'complete'` starts it.
            if (req.historyState !== 'backfill') start();

            return {
                getContext: (select) => {
                    if (stopped) return Promise.resolve(null);
                    const ctx = stream?.lastCtx() ?? null;
                    return Promise.resolve(ctx === null ? null : snapshotFromCtx(
                        ctx,
                        stopped ? 'idle' : 'streaming',
                        select,
                        executionProvenance('in-process'),
                    ));
                },
                stop: () => {
                    stopped = true;
                    stream?.stop();
                    lowerTimeframeFetchCache.clear();
                },
                update: (next, nextProps) => updatePineSettings(settingsKey, next, nextProps, (next, nextProps) => {
                    if (stopped) return;
                    inputs = { ...inputs, ...next };
                    if (nextProps) props = { ...props, ...nextProps };
                    if (started) start(); // re-stream with the new inputs/props baked in
                }),
                setVisibleRange: (range) => {
                    if (stopped) return;
                    visibleRange = range;
                    if (started) stream?.setVisibleRange(range.left, range.right); // deferred — start() applies it
                },
                notifyBars: (reason) => {
                    if (stopped) return;
                    if (reason === 'backfill') return; // partial history — keep holding
                    if (reason === 'complete') {
                        // (Re)start over the FULL history: a stream running through the
                        // backfill has its history frozen at the pre-backfill length.
                        start();
                        return;
                    }
                    if (started) stream?.markDirty();
                },
            };
        }

        // ── Static: run on demand; re-run whenever the session is poked ──
        // Policy A: while the chart's history backfill is in progress, every run is
        // HELD (state changes merge meanwhile) — the `'complete'` notification fires
        // the first run over the full history. Backfill pokes are ignored outright.
        let deferred = req.historyState === 'backfill';
        let lastCtx: unknown = null;
        let running = false;
        // Keep static evaluations FIFO, matching the Worker bridge. A run can
        // await a host-side lower-timeframe fetch; firing another run loose
        // would let the older outcome arrive last and overwrite the fresher
        // model/context. Queuing also lets the next run observe the latest
        // bars/inputs after a burst of notifications.
        let runChain = Promise.resolve();
        const runOnce = async (): Promise<void> => {
            if (stopped) return;
            running = true;
            try {
                const outcome = await runPineStatic({
                    ind: indicatorFor(token, token.source, inputs, props),
                    bars: getBars(),
                    market: req.market,
                    visibleRange,
                    prepared: req.prepared,
                    instanceId: token.instanceId,
                    inputs,
                    props,
                    fetchSeries: req.fetchSeries,
                    barMagnifier: precisionRequest.barMagnifier,
                    lowerTimeframeFetchCache,
                });
                if (stopped) return;
                lastCtx = outcome.ctx;
                running = false;
                req.prepared.reactsToViewport = outcome.reactsToViewport; // refine in place
                for (const a of outcome.alerts) handlers.onAlert?.(a);
                for (const w of outcome.warnings) handlers.onWarning?.(w);
                // A null model = the run never executed (zero bars): emit nothing — the
                // host keeps its prepared placeholder and pokes the session when bars land.
                if (outcome.model) handlers.onModel(outcome.model);
                handlers.onDone?.();
            } catch (err) {
                if (!stopped) notifyError(handlers, err instanceof Error ? err : new Error(String(err)));
            } finally {
                running = false;
            }
        };
        const scheduleRun = (): void => {
            // runOnce catches its own errors, so this chain remains usable after
            // a failed provider request. The rejection handler is defensive in
            // case a future change lets an exception escape.
            runChain = runChain.then(runOnce, runOnce);
            void runChain;
        };
        if (!deferred) scheduleRun();

        return {
            getContext: (select) =>
                Promise.resolve(stopped || lastCtx === null ? null : snapshotFromCtx(
                    lastCtx,
                    running ? 'computing' : 'idle',
                    select,
                    executionProvenance('in-process'),
                )),
            stop: () => {
                stopped = true;
                lowerTimeframeFetchCache.clear();
            },
            update: (next, nextProps) => updatePineSettings(settingsKey, next, nextProps, (next, nextProps) => {
                if (stopped) return;
                inputs = { ...inputs, ...next };
                if (nextProps) props = { ...props, ...nextProps };
                if (!deferred) scheduleRun();
            }),
            setVisibleRange: (range) => {
                if (stopped) return;
                visibleRange = range;
                if (!deferred) scheduleRun();
            },
            notifyBars: (reason) => {
                if (stopped) return;
                if (reason === 'backfill') return;
                // A forming parent bar can keep the same lower-feed request
                // range while its child candles change. Never reuse that old
                // result across a host bars notification.
                lowerTimeframeFetchCache.clear();
                if (reason === 'complete') deferred = false;
                if (!deferred) scheduleRun();
            },
        };
    }

}
