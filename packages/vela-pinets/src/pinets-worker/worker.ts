import { preparePine, indicatorFor, runPineStatic, openLiveStream, LowerTimeframeFetchCache, type IndicatorCache, type PineToken, type LiveStreamHandle, type PineBarMagnifierOptions } from '../pinets/runtime';
import { snapshotFromCtx } from '../pinets/contextSnapshot';
import type { OHLCV } from '@luxalgo/vela/plugin';
import type { InputValue } from '@luxalgo/vela/plugin';
import type { PreparedScript, ExecutionMarket, VisibleBarRange, FetchSeries } from '@luxalgo/vela/plugin';
import type { MainToWorker, WorkerToMain } from './protocol';
import { errorFromWorker, errorMessage, serializeWorkerError } from './error-envelope';
import { executionProvenance } from '../build-info';

/**
 * The worker entry: runs the shared PineTS `runtime` off the main thread. Built as
 * a self-contained IIFE bundle (`vela.pinets-worker.global.js`) and spawned by
 * `PineWorkerEngine`. Two session kinds:
 * - **static**: each `execute`/`update`/`setVisibleRange`/`notifyBars` triggers a
 *   fresh full run and posts the neutral model back;
 * - **live**: ONE persistent `pine.stream(...)` context polls a worker-local bar
 *   array that `bars` messages keep current — a tick sends one bar across and
 *   PineTS re-executes only the forming bar (true incremental streaming).
 */

/** Minimal worker-global surface (avoids needing the "webworker" tsconfig lib). */
interface WorkerScope {
    postMessage(message: unknown): void;
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}
const ctx = self as unknown as WorkerScope;
const post = (msg: WorkerToMain): void => ctx.postMessage(msg);

function postSessionError(sessionId: number, error: unknown): void {
    const metadata = serializeWorkerError(error);
    post({
        kind: 'error',
        sessionId,
        message: errorMessage(error),
        ...(metadata ? { error: metadata } : {}),
    });
}

interface Session {
    id: number;
    mode: 'static' | 'live';
    prepared: PreparedScript;
    market: ExecutionMarket;
    bars: OHLCV[];
    inputs: Record<string, InputValue>;
    props: Record<string, InputValue>;
    barMagnifier?: PineBarMagnifierOptions;
    visibleRange?: VisibleBarRange;
    cache: IndicatorCache;
    /** Session-scoped cache for Bar Magnifier lower-timeframe windows. */
    lowerTimeframeFetchCache: LowerTimeframeFetchCache;
    /**
     * Keep one gateway closure for the lifetime of the session.  The lower-feed
     * cache uses the gateway identity as part of its key; rebuilding this
     * closure for every static run would make an unchanged provider look new
     * and defeat legitimate cross-run reuse.
     */
    fetchSeries: FetchSeries;
    stopped: boolean;
    /** Raw context of the most recent evaluation (static run or streamed tick). */
    lastCtx: unknown;
    /**
     * The chart's history backfill is still in progress (policy A): hold every run —
     * merging state changes meanwhile — until history completes. For a STATIC session
     * the first `notifyBars` releases it (the main thread posts one only for
     * `'complete'`/ticks, never for backfill chunks), and skipped runs still ack with
     * `done` so the main thread's pending-run bookkeeping balances. For a LIVE session
     * the `restart: true` bars message (the 'complete' snapshot) starts the stream.
     */
    deferred: boolean;
    /** Serializes a STATIC session's runs FIFO — see {@link enqueueRun}. */
    chain: Promise<void>;
    /** LIVE only: the persistent stream handle; null until started (deferred) and after stop. */
    stream: LiveStreamHandle | null;
}

const sessions = new Map<number, Session>();
interface PendingFetch {
    readonly sessionId: number;
    readonly resolve: (bars: OHLCV[]) => void;
    readonly reject: (err: Error) => void;
}

const pendingFetch = new Map<number, PendingFetch>();
let fetchReqId = 0;

/**
 * Build a session-scoped worker-side `fetchSeries` gateway. The provider's
 * network/cache still lives on the main thread, so a secondary fetch
 * (request.security) round-trips there; the runtime's separate lower-feed
 * cache can coalesce Bar Magnifier requests before that round-trip. Keeping
 * the session id in this closure prevents concurrent chart cells from
 * accidentally borrowing one another's provider callback. PineTS awaits the
 * provider's getMarketData, so awaiting this round-trip is fine.
 *
 * A provider request is normally awaited by PineTS, but a stop can race an
 * expression that has already scheduled a secondary request without keeping
 * the returned promise. Resolve cancellation with an empty feed instead of
 * rejecting: this lets every consumer settle without turning teardown into
 * an unhandled-rejection event. The owning session is stopped, so the result
 * is discarded before any model/error is published.
 */
const cancelledFetch = (): Promise<OHLCV[]> => Promise.resolve([]);

const fetchSeriesFor = (sessionId: number): FetchSeries => (symbol, timeframe, range) => {
    const session = sessions.get(sessionId);
    if (!session || session.stopped) return cancelledFetch();
    const pending = new Promise<OHLCV[]>((resolve, reject) => {
        // The session can be stopped between the guard above and this
        // callback running (for example, after an awaited runtime step).
        const current = sessions.get(sessionId);
        if (!current || current.stopped) {
            resolve([]);
            return;
        }
        const reqId = ++fetchReqId;
        pendingFetch.set(reqId, { sessionId, resolve, reject });
        try {
            post({ kind: 'fetchSeries', sessionId, reqId, symbol, timeframe, range });
        } catch (error) {
            pendingFetch.delete(reqId);
            reject(error instanceof Error ? error : new Error(String(error)));
        }
    });
    // A defensive noop handler prevents a provider-post failure from becoming
    // an unhandled rejection if the runtime abandons this request during
    // teardown. Awaiting callers still receive the original rejection.
    void pending.catch(() => undefined);
    return pending;
};

/** Settle provider requests that can no longer receive a response after stop. */
function settlePendingFetches(sessionId: number): void {
    for (const [reqId, pending] of pendingFetch) {
        if (pending.sessionId !== sessionId) continue;
        pendingFetch.delete(reqId);
        pending.resolve([]);
    }
}

/**
 * Enqueue a run on the session's FIFO chain instead of firing it loose. A run that awaits a
 * secondary fetch (request.security round-trips to the main thread) yields the event loop, so
 * two loose runs for the same session could complete OUT OF ORDER — the stale model would then
 * land last and overwrite the fresher one. Serializing per session makes the last-posted model
 * always the most recent. `runSession` never rejects (it posts `error` instead), so the chain
 * can't wedge.
 */
function enqueueRun(s: Session): void {
    s.chain = s.chain.then(() => runSession(s));
}

/** Reconcile one delta bar into a live session's local array (the applyBar pattern). */
function applyWorkerBar(s: Session, bar: OHLCV): void {
    const last = s.bars[s.bars.length - 1];
    if (last && bar.time === last.time) s.bars[s.bars.length - 1] = bar;
    else if (!last || bar.time > last.time) s.bars.push(bar);
    // older than the tip → stale duplicate from a tail overlap, drop
}

/**
 * (Re)start a live session's persistent stream over its CURRENT local array. PineTS
 * re-executes only the forming/new bars per poll from here on; the provider's
 * signature dedupe makes quiet polls free. Never starts on an empty array (the
 * stream would throw reading its last candle).
 */
function startStream(s: Session): void {
    s.stream?.stop();
    s.stream = null;
    // A restart (input change, completed backfill, or explicit full snapshot)
    // invalidates requests owned by the previous stream. Settle them before
    // opening the replacement so a slow provider cannot retain promises or
    // feed stale data into the new stream.
    // The same parent range can still contain revised lower candles, so the
    // session cache must be reset along with the stream itself.
    s.lowerTimeframeFetchCache.clear();
    settlePendingFetches(s.id);
    if (s.stopped || s.bars.length === 0) return;
    s.stream = openLiveStream({
        token: s.prepared.token as PineToken,
        cache: s.cache,
        prepared: s.prepared,
        inputs: s.inputs,
        props: s.props,
        bars: () => s.bars,
        market: () => s.market,
        fetchSeries: s.fetchSeries,
        barMagnifier: s.barMagnifier,
        lowerTimeframeFetchCache: s.lowerTimeframeFetchCache,
        visibleRange: s.visibleRange,
        onModel: (model) => {
            if (!s.stopped) post({ kind: 'model', sessionId: s.id, model });
        },
        onAlert: (alert) => {
            if (!s.stopped) post({ kind: 'alert', sessionId: s.id, alert });
        },
        onWarning: (warning) => {
            if (!s.stopped) post({ kind: 'warning', sessionId: s.id, warning });
        },
        onError: (e) => {
            if (!s.stopped) postSessionError(s.id, e);
        },
    });
}

/** Start/restart a live stream without letting a synchronous setup failure
 * escape the worker message dispatcher.  Most runtime failures arrive through
 * `onError`, but malformed props or a host-specific stream constructor can
 * still throw before the callback is installed; turn those into the same
 * structured session error envelope. */
function tryStartStream(s: Session): void {
    try {
        startStream(s);
    } catch (error) {
        if (!s.stopped) postSessionError(s.id, error);
    }
}

async function runSession(s: Session): Promise<void> {
    if (s.stopped) return;
    try {
        const token = s.prepared.token as PineToken;
        const outcome = await runPineStatic({
            ind: indicatorFor(s.cache, token.source, s.inputs, s.props),
            bars: s.bars,
            market: s.market,
            visibleRange: s.visibleRange,
            prepared: s.prepared,
            instanceId: token.instanceId,
            inputs: s.inputs,
            props: s.props,
            fetchSeries: s.fetchSeries,
            barMagnifier: s.barMagnifier,
            lowerTimeframeFetchCache: s.lowerTimeframeFetchCache,
        });
        if (s.stopped) return;
        post({ kind: 'reactsToViewport', sessionId: s.id, value: outcome.reactsToViewport });
        for (const a of outcome.alerts) post({ kind: 'alert', sessionId: s.id, alert: a });
        for (const w of outcome.warnings) post({ kind: 'warning', sessionId: s.id, warning: w });
        s.lastCtx = outcome.ctx;
        // A null model = the run never executed (zero bars): post no model, but still
        // ack with 'done' so the main thread's pending-run bookkeeping balances.
        if (outcome.model) post({ kind: 'model', sessionId: s.id, model: outcome.model });
        post({ kind: 'done', sessionId: s.id });
    } catch (err) {
        if (!s.stopped) {
            postSessionError(s.id, err);
        }
    }
}

ctx.addEventListener('message', (event) => {
    const msg = event.data as MainToWorker;
    switch (msg.kind) {
        case 'prepare':
            try {
                post({ kind: 'prepared', reqId: msg.reqId, prepared: preparePine(msg.source, msg.instanceId, msg.defaultProps, msg.propsVisibility) });
            } catch (err) {
                const errorDetails = serializeWorkerError(err);
                post({
                    kind: 'prepared',
                    reqId: msg.reqId,
                    error: errorMessage(err),
                    ...(errorDetails ? { errorDetails } : {}),
                });
            }
            return;
        case 'execute': {
            const previous = sessions.get(msg.sessionId);
            if (previous) {
                // Session ids are expected to be unique, but a host restart
                // can replay an execute frame. Tear down the superseded
                // stream/request set before replacing it.
                previous.stopped = true;
                previous.stream?.stop();
                previous.lowerTimeframeFetchCache.clear();
                settlePendingFetches(previous.id);
            }
            const s: Session = {
                id: msg.sessionId,
                mode: msg.mode ?? 'static',
                prepared: msg.prepared,
                market: msg.market,
                bars: msg.bars,
                inputs: msg.inputs,
                props: msg.props ?? {},
                barMagnifier: msg.barMagnifier,
                visibleRange: msg.visibleRange,
                cache: {},
                lowerTimeframeFetchCache: new LowerTimeframeFetchCache(),
                fetchSeries: fetchSeriesFor(msg.sessionId),
                stopped: false,
                deferred: msg.historyState === 'backfill',
                chain: Promise.resolve(),
                stream: null,
                lastCtx: null,
            };
            sessions.set(s.id, s);
            if (s.mode === 'live') {
                if (!s.deferred) tryStartStream(s); // deferred streams start on the 'complete' restart snapshot
                return; // live sessions never ack — the main thread doesn't count their runs
            }
            if (s.deferred) post({ kind: 'done', sessionId: s.id }); // held run, acked
            else enqueueRun(s);
            return;
        }
        case 'update': {
            const s = sessions.get(msg.sessionId);
            if (!s) return;
            s.inputs = { ...s.inputs, ...msg.inputs };
            if (msg.props) s.props = { ...s.props, ...msg.props };
            if (s.mode === 'live') {
                if (!s.deferred) tryStartStream(s); // re-stream with the merged inputs/props baked in
                return;
            }
            // Only the precision property changes the lower-feed contract.
            // Ordinary input updates should retain a fulfilled window so a
            // strategy edit does not trigger a second identical provider
            // request; toggling the magnifier must still force a fresh run.
            if (Object.prototype.hasOwnProperty.call(msg.props ?? {}, 'use_bar_magnifier')) {
                s.lowerTimeframeFetchCache.clear();
            }
            if (s.deferred) post({ kind: 'done', sessionId: s.id }); // merged; the deferred first run picks it up
            else enqueueRun(s);
            return;
        }
        case 'setVisibleRange': {
            const s = sessions.get(msg.sessionId);
            if (!s) return;
            s.visibleRange = msg.range;
            if (s.mode === 'live') {
                // Defensive — live mode excludes viewport-dependent scripts, but honor it.
                s.stream?.setVisibleRange(msg.range.left, msg.range.right);
                return;
            }
            if (s.deferred) post({ kind: 'done', sessionId: s.id }); // merged; the deferred first run picks it up
            else enqueueRun(s);
            return;
        }
        case 'notifyBars': {
            const s = sessions.get(msg.sessionId);
            if (!s || s.mode === 'live') return; // live bars travel via 'bars' deltas, never full snapshots
            s.bars = msg.bars;
            // A forming parent can keep the same lower-feed window while its
            // child candles change. The old fulfilled promise must not leak
            // into this fresh static evaluation.
            s.lowerTimeframeFetchCache.clear();
            s.deferred = false; // only 'complete'/tick notifications reach the worker — run now
            enqueueRun(s);
            return;
        }
        case 'bars': {
            const s = sessions.get(msg.sessionId);
            if (!s || s.mode !== 'live') return;
            if (msg.restart) {
                // Full snapshot: history completed (or a restart) — stream over the whole depth.
                s.bars = msg.bars;
                s.deferred = false;
                tryStartStream(s);
                return;
            }
            // Tail delta: the stream's own poll notices via the provider signature — no poke needed.
            for (const b of msg.bars) applyWorkerBar(s, b);
            return;
        }
        case 'getContext': {
            const s = sessions.get(msg.sessionId);
            const ctx = s ? (s.mode === 'live' ? (s.stream?.lastCtx() ?? null) : s.lastCtx) : null;
            const phase = !s || s.stopped ? 'idle' : s.mode === 'live' ? 'streaming' : 'idle';
            post({ kind: 'contextResult', reqId: msg.reqId, snapshot: ctx == null ? null : snapshotFromCtx(
                ctx,
                phase,
                msg.select,
                executionProvenance('worker'),
            ) });
            return;
        }
        case 'stop': {
            const s = sessions.get(msg.sessionId);
            if (s) {
                s.stopped = true;
                s.stream?.stop(); // null-safe: a deferred live session never started
                s.lowerTimeframeFetchCache.clear();
            }
            settlePendingFetches(msg.sessionId);
            sessions.delete(msg.sessionId);
            return;
        }
        case 'fetchSeriesResult': {
            const p = pendingFetch.get(msg.reqId);
            if (!p) return;
            pendingFetch.delete(msg.reqId);
            if (msg.error) {
                // Provider failures may carry timeout/status/provider metadata
                // through the fetch gateway.  Preserve it before the runtime
                // catches and forwards the error as a session failure.
                p.reject(errorFromWorker(msg.error, msg.errorDetails));
            }
            else p.resolve(msg.bars ?? []);
            return;
        }
    }
});
