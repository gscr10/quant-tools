import type {
    ScriptingEngine,
    EngineCapabilities,
    PreparedScript,
    ExecutionRequest,
    ExecutionHandlers,
    ExecutionSession,
} from '@luxalgo/vela/plugin';
import type { OHLCV } from '@luxalgo/vela/plugin';
import type { BarRange } from '@luxalgo/vela/plugin';
import type { InputValue } from '@luxalgo/vela/plugin';
import type { MainToWorker, WorkerErrorEvent, WorkerToMain, WorkerLike } from './protocol';
import { errorFromWorker, serializeWorkerError } from './error-envelope';
import {
    barMagnifierRequested,
    materializeBarMagnifierRequest,
} from '../pinets/bar-magnifier-request';
import type { PropsFilter, PineExecutionRequest } from '../pinets/runtime';
import workerCode from 'inline-worker:./worker.ts';
import { updatePineSettings } from '../pinets/settingsBatch';
import { hasCurrentBuildSentinel, PINE_EXECUTION_BUILD_INFO } from '../build-info';
import {
    validateAuditLedgerSnapshot,
    type PineContextSnapshot,
} from '../pinets/contextSnapshot';

export interface PineWorkerOptions {
    /**
     * Override the worker source. By default the worker is inlined into the bundle
     * and spawned from a Blob URL (no separate file, no URL to configure); set this
     * to load a hosted worker file instead — e.g. under a CSP that blocks `blob:`.
     */
    workerUrl?: string;
    /** Worker factory — tests inject a fake; defaults to the inlined Blob worker. */
    createWorker?: () => WorkerLike;
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
 * Spawn the worker. Default: a Blob URL of the build-time-inlined worker source.
 * Pass `workerUrl` to load a hosted file instead.
 */
function spawnWorker(workerUrl?: string): WorkerLike {
    if (workerUrl) return new Worker(workerUrl);
    const url = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));
    const worker = new Worker(url) as unknown as WorkerLike;
    URL.revokeObjectURL(url); // the Worker keeps the blob alive after construction
    return worker;
}

interface SessionEntry {
    handlers: ExecutionHandlers;
    req: PineExecutionRequest;
    /** Session kind — LIVE sessions hold a persistent in-worker stream and bypass the run bookkeeping. */
    mode: 'static' | 'live';
    /** Worker runs in flight for this session (STATIC only: execute/update/setVisibleRange/notifyBars each trigger one). */
    pendingRuns: number;
    /** Bars changed while a run was in flight — re-run once (with a fresh snapshot) when it lands. STATIC only. */
    dirtyBars: boolean;
    /** LIVE only: newest bar time already shipped — a tick sends just the bars at/after it. */
    lastSentTime: number;
}

interface ContextWaiter {
    readonly sessionId: number;
    readonly resolve: (snapshot: PineContextSnapshot | null) => void;
}

function inertExecutionSession(): ExecutionSession {
    return {
        getContext: () => Promise.resolve(null),
        stop: () => undefined,
        update: () => undefined,
        setVisibleRange: () => undefined,
        notifyBars: () => undefined,
    };
}

/** Normalize browser Worker error/messageerror payloads into a stable Error. */
function workerError(event: WorkerErrorEvent, fallback: string): Error {
    if (event.error instanceof Error) return event.error;
    if (typeof event.error === 'string' && event.error.trim()) return new Error(event.error);
    // Errors crossing a realm (or a DOMException from structured-clone
    // failure) may not satisfy `instanceof Error`, while still exposing a
    // useful message.
    if (event.error && typeof event.error === 'object' && 'message' in event.error) {
        const message = (event.error as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) return new Error(message);
    }
    if (typeof event.message === 'string' && event.message.trim()) return new Error(event.message);
    return new Error(fallback);
}

function thrownError(error: unknown, fallback = 'PineTS worker unavailable'): Error {
    return error instanceof Error ? error : new Error(typeof error === 'string' ? error : fallback);
}

function notifyError(handlers: ExecutionHandlers, error: Error): void {
    try {
        handlers.onError?.(error);
    } catch {
        // Host callbacks must not break worker teardown or prevent other
        // sessions from being notified. The callback owns its own logging.
    }
}

/**
 * A worker-backed PineTS engine: identical Pine semantics to `PineEngine`, but the
 * transpile + execution run on a Web Worker, keeping the main thread responsive.
 * Implements the same `ScriptingEngine` port, so the orchestrator never learns a
 * worker exists. Secondary fetches (request.security) round-trip back to the main
 * thread, where the cache + network live.
 *
 * Live charts stream: the worker holds ONE persistent PineTS streaming context per
 * live session, so a tick ships only the forming bar (a tiny `bars` delta) and the
 * script re-executes incrementally — never a full snapshot + full re-run per tick.
 * Static sessions (non-live charts, viewport-dependent scripts) run per poke with
 * the pending-run coalescing below; live messages NEVER enter that bookkeeping —
 * a live session acks nothing, so counting it would jam the coalescing forever.
 */
export class PineWorkerEngine implements ScriptingEngine {
    readonly language = 'pine';
    readonly capabilities: EngineCapabilities = { streaming: true, visibleRange: true, inputs: true, props: true };
    /** Stable identity of the local bridge + embedded PineTS build. */
    readonly buildFingerprint = PINE_EXECUTION_BUILD_INFO.buildFingerprint;

    private worker: WorkerLike | null = null;
    private readonly spawn: () => WorkerLike;
    private readonly defaultProps: Record<string, InputValue> | undefined;
    private readonly propsVisibility: PropsFilter | undefined;
    private readonly prepares = new Map<number, { resolve: (p: PreparedScript) => void; reject: (e: Error) => void }>();
    private readonly sessions = new Map<number, SessionEntry>();
    private reqId = 0;
    private readonly contextWaits = new Map<number, ContextWaiter>();
    private sessionId = 0;

    constructor(opts: PineWorkerOptions = {}) {
        this.spawn = opts.createWorker ?? ((): WorkerLike => spawnWorker(opts.workerUrl));
        this.defaultProps = opts.defaultProps;
        this.propsVisibility = opts.props;
    }

    prepare(source: string, instanceId: string): Promise<PreparedScript> {
        const reqId = ++this.reqId;
        return new Promise<PreparedScript>((resolve, reject) => {
            this.prepares.set(reqId, { resolve, reject });
            try {
                this.post({
                    kind: 'prepare',
                    reqId,
                    source,
                    instanceId,
                    ...(this.defaultProps ? { defaultProps: this.defaultProps } : {}),
                    ...(this.propsVisibility ? { propsVisibility: this.propsVisibility } : {}),
                });
            } catch (error) {
                this.prepares.delete(reqId);
                reject(thrownError(error, String(error)));
            }
        });
    }

    execute(req: PineExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        if (!hasCurrentBuildSentinel(req.prepared.token)) {
            const error = new Error('PineTS build sentinel mismatch: stale or foreign PreparedScript');
            notifyError(handlers, error);
            return inertExecutionSession();
        }
        const sessionId = ++this.sessionId;
        // Materialize the cutoff before crossing the Worker boundary. The
        // worker's Date realm must not disagree with the host snapshot and
        // mark otherwise-complete child candles as forming.
        const precisionRequest = materializeBarMagnifierRequest(req);
        // Vela requests live execution for the whole workspace. A magnified
        // strategy must use the static queue so its lower timeframe can be
        // fetched and validated against one parent snapshot.
        const mode: 'static' | 'live' = req.mode === 'live' && !barMagnifierRequested(req) ? 'live' : 'static';
        let bars: OHLCV[];
        try {
            bars = this.barsOf(req);
            if (!Array.isArray(bars)) throw new Error('PineTS execution bars must be an array');
        } catch (error) {
            // A host feed can throw synchronously while the chart is being
            // torn down. Keep execute() total: report the failure through the
            // normal callback and return a safe inert session instead of
            // leaving callers with no way to stop/update it.
            notifyError(handlers, thrownError(error, 'PineTS bars unavailable'));
            return inertExecutionSession();
        }
        const entry: SessionEntry = { handlers, req, mode, pendingRuns: 0, dirtyBars: false, lastSentTime: bars[bars.length - 1]?.time ?? 0 };
        this.sessions.set(sessionId, entry);
        const msg: MainToWorker = {
            kind: 'execute',
            sessionId,
            prepared: req.prepared,
            market: req.market,
            bars,
            inputs: { ...(req.inputs ?? {}) },
            ...(req.props ? { props: { ...req.props } } : {}),
            visibleRange: req.visibleRange,
            mode,
            historyState: req.historyState,
            ...(precisionRequest.barMagnifier ? { barMagnifier: precisionRequest.barMagnifier } : {}),
        };
        // Live messages never enter the pending-run bookkeeping — the stream acks nothing.
        let stopped = false;
        const active = (): boolean => !stopped && this.sessions.get(sessionId) === entry;
        try {
            if (mode === 'live') this.post(msg);
            else this.postRun(entry, msg);
        } catch (error) {
            // A worker can disappear between construction and the first frame
            // (browser shutdown, CSP/HMR teardown). Do not leave a dead entry
            // in the session map or return a proxy whose pending calls can
            // never settle.
            stopped = true;
            // `post()` normally invalidates the worker and removes this entry
            // before throwing. Notify here only when the failure happened
            // before a worker was installed (for example, a throwing factory),
            // otherwise the fatal-worker path would report the same error
            // twice to this session.
            if (this.sessions.get(sessionId) === entry) {
                this.sessions.delete(sessionId);
                notifyError(handlers, thrownError(error, String(error)));
            }
            return inertExecutionSession();
        }
        return {
            getContext: (select) => {
                if (!active()) return Promise.resolve(null);
                return new Promise<PineContextSnapshot | null>((resolve) => {
                    const reqId = ++this.reqId;
                    this.contextWaits.set(reqId, { sessionId, resolve });
                    if (!this.postIfWorker({ kind: 'getContext', sessionId, reqId, select })) {
                        this.contextWaits.delete(reqId);
                        resolve(null);
                    }
                });
            },
            stop: () => {
                if (stopped) return;
                stopped = true;
                if (this.sessions.get(sessionId) !== entry) return;
                this.resolveContextWaits(sessionId);
                this.sessions.delete(sessionId);
                // Do not lazily spawn a new worker merely to stop a session
                // after the engine has already been terminated.
                this.postIfWorker({ kind: 'stop', sessionId });
            },
            update: (inputs, props) => updatePineSettings(entry, inputs, props, (inputs, props) => {
                if (!active()) return;
                const msg: MainToWorker = { kind: 'update', sessionId, inputs, ...(props ? { props } : {}) };
                // A Worker can fail between any two chart events.  Session
                // mutators are a void host contract; a post failure is already
                // reported through onError by invalidateWorker and must not
                // escape as an uncaught exception from Vela's event handler.
                if (mode === 'live') this.postIfWorker(msg);
                else this.postRun(entry, msg);
            }),
            setVisibleRange: (range) => {
                if (!active()) return;
                if (mode === 'live') this.postIfWorker({ kind: 'setVisibleRange', sessionId, range });
                else this.postRun(entry, { kind: 'setVisibleRange', sessionId, range });
            },
            notifyBars: (reason) => this.notifyBars(sessionId, reason),
        };
    }

    /**
     * Coalesced bar-change notification: shipping a full bars snapshot + a complete re-run per
     * tick is wasteful when ticks burst (a gap heal, a fast market) — while ANY run is in flight
     * for the session, just mark it dirty and re-run ONCE (with a fresh snapshot) when the run
     * lands. The worker can't read the live bars array, hence the snapshot per posted run.
     *
     * `'backfill'` notifications never cross to the worker at all: every posted run ships a
     * FRESH full snapshot anyway, so intermediate partial-history snapshots buy nothing — the
     * worker sees the deepened history on the `'complete'` (or next tick) run. This also keeps
     * the pending-run bookkeeping honest (a posted-but-skipped run would jam the coalescing).
     */
    private notifyBars(sessionId: number, reason?: 'backfill' | 'complete'): void {
        if (reason === 'backfill') return;
        const s = this.sessions.get(sessionId);
        if (!s) return;
        if (s.mode === 'live') {
            const bars = this.safeBarsOf(s);
            if (bars === null) return;
            if (reason === 'complete') {
                // Backfill finished: (re)start the stream over the FULL history in one snapshot.
                if (this.postIfWorker({ kind: 'bars', sessionId, bars, restart: true })) {
                    s.lastSentTime = bars[bars.length - 1]?.time ?? 0;
                }
                return;
            }
            // A tick: ship only the bars at/after the last sent one (>= — the forming bar
            // keeps its open time across updates; a heal's whole range arrives the same way).
            const tail = bars.filter((b) => b.time >= s.lastSentTime);
            if (tail.length === 0) return;
            if (this.postIfWorker({ kind: 'bars', sessionId, bars: tail })) {
                s.lastSentTime = tail[tail.length - 1]!.time;
            }
            return;
        }
        if (s.pendingRuns > 0) {
            s.dirtyBars = true;
            return;
        }
        const bars = this.safeBarsOf(s);
        if (bars === null) return;
        this.postRun(s, { kind: 'notifyBars', sessionId, bars });
    }

    /** Post a message that triggers exactly one worker run (acked by one `done`/`error`). */
    private postRun(entry: SessionEntry, msg: MainToWorker): void {
        entry.pendingRuns += 1;
        try {
            this.post(msg);
        } catch {
            // `post()` invalidates the worker and emits the structured error to
            // every affected session.  Do not rethrow through a chart event or
            // a completion callback; the session is inactive after invalidation.
        }
    }

    /** A worker run finished (`done` or `error`): flush a coalesced bar notification, if any. */
    private runFinished(sessionId: number): void {
        const s = this.sessions.get(sessionId);
        if (!s || s.mode === 'live') return; // a live stream's 'error' is not a run ack
        s.pendingRuns = Math.max(0, s.pendingRuns - 1);
        if (s.pendingRuns === 0 && s.dirtyBars) {
            s.dirtyBars = false;
            const bars = this.safeBarsOf(s);
            if (bars !== null) this.postRun(s, { kind: 'notifyBars', sessionId, bars });
        }
    }

    /**
     * Terminate the worker and invalidate every proxy owned by this engine.
     * Pending prepare/context promises must settle here; otherwise a page
     * destroy or HMR cycle leaves callers awaiting a response from a worker
     * that can no longer deliver one.  Session methods become no-ops until a
     * new prepare/execute call lazily creates a fresh worker.
     */
    terminate(): void {
        const worker = this.worker;
        this.worker = null;
        this.clearState(new Error('PineTS worker terminated'));
        try {
            worker?.terminate();
        } catch {
            // The worker may already have exited; state is cleared regardless.
        }
    }

    /** Settle every caller that was waiting on the worker before invalidation. */
    private clearState(error: Error, notifySessions = false): void {
        // Detach the old generation before invoking any user callback. A
        // callback is allowed to immediately prepare/execute a replacement
        // worker; clearing the live maps first prevents that new state from
        // being mistaken for the failed generation and removed below.
        const sessions = [...this.sessions.values()];
        const prepares = [...this.prepares.values()];
        const contextWaits = [...this.contextWaits.values()];
        this.sessions.clear();
        this.prepares.clear();
        this.contextWaits.clear();

        for (const pending of prepares) pending.reject(error);
        for (const waiter of contextWaits) waiter.resolve(null);

        if (notifySessions) {
            // A real Worker can fail without delivering a protocol `error`
            // frame (syntax error in the bundle, CSP violation, OOM, or a
            // structured-clone failure). Notify each live chart session before
            // dropping the map so Vela can leave its loading state and expose a
            // normal indicator error. A user callback must not prevent the
            // remaining sessions and pending promises from being settled.
            for (const entry of sessions) notifyError(entry.handlers, error);
        }
    }

    private barsOf(req: ExecutionRequest): OHLCV[] {
        return (req.getBars ?? ((): OHLCV[] => req.bars))();
    }

    /**
     * Read the host-owned bars defensively after a session has started.  A
     * chart can be torn down (or a provider can fail) between two Vela events;
     * `ExecutionSession` mutators are void and must report that failure through
     * the normal error callback instead of throwing out of the chart event.
     */
    private safeBarsOf(entry: SessionEntry): OHLCV[] | null {
        try {
            const bars = this.barsOf(entry.req);
            if (!Array.isArray(bars)) throw new Error('PineTS execution bars must be an array');
            return bars;
        } catch (error) {
            notifyError(entry.handlers, thrownError(error, 'PineTS bars unavailable'));
            return null;
        }
    }

    private workerInstance(): WorkerLike {
        if (!this.worker) {
            const worker = this.spawn();
            this.worker = worker;
            try {
                worker.addEventListener('message', (e) => this.onMessage(e.data as WorkerToMain));
                // `error` and `messageerror` are browser events, not protocol
                // messages. Without these listeners a crashed/invalid Worker
                // leaves every prepare/run/context Promise pending forever.
                worker.addEventListener('error', (event) => {
                    this.invalidateWorker(worker, workerError(event, 'PineTS worker failed'));
                });
                worker.addEventListener('messageerror', (event) => {
                    this.invalidateWorker(worker, workerError(event, 'PineTS worker message failed'));
                });
            } catch (error) {
                // A partially constructed Worker (or a strict test double)
                // may throw while listeners are installed. Do not cache it.
                if (this.worker === worker) this.worker = null;
                try {
                    worker.terminate();
                } catch {
                    // best effort; preserve the original construction error
                }
                throw error;
            }
        }
        return this.worker;
    }

    private post(msg: MainToWorker): void {
        const worker = this.workerInstance();
        try {
            worker.postMessage(msg);
        } catch (error) {
            this.invalidateWorker(worker, thrownError(error, String(error)));
            throw error;
        }
    }

    /** Post only to an existing worker; never resurrect one during teardown. */
    private postIfWorker(msg: MainToWorker): boolean {
        const worker = this.worker;
        if (!worker) return false;
        try {
            worker.postMessage(msg);
            return true;
        } catch (error) {
            this.invalidateWorker(worker, thrownError(error));
            return false;
        }
    }

    private invalidateWorker(worker: WorkerLike, error = new Error('PineTS worker unavailable')): void {
        if (this.worker !== worker) return;
        this.worker = null;
        this.clearState(error, true);
        try {
            worker.terminate();
        } catch {
            // A browser may already have torn the worker down; the bridge is
            // invalidated regardless, so a future call can spawn cleanly.
        }
    }

    private resolveContextWaits(sessionId: number): void {
        for (const [reqId, waiter] of this.contextWaits) {
            if (waiter.sessionId !== sessionId) continue;
            this.contextWaits.delete(reqId);
            waiter.resolve(null);
        }
    }

    private onMessage(msg: WorkerToMain): void {
        switch (msg.kind) {
            case 'prepared': {
                const p = this.prepares.get(msg.reqId);
                if (!p) return;
                this.prepares.delete(msg.reqId);
                if (msg.error) p.reject(errorFromWorker(msg.error, msg.errorDetails));
                else if (msg.prepared && hasCurrentBuildSentinel(msg.prepared.token)) p.resolve(msg.prepared);
                else p.reject(new Error('PineTS build sentinel mismatch: stale or foreign Worker bundle'));
                return;
            }
            case 'model':
                {
                    const entry = this.sessions.get(msg.sessionId);
                    if (!entry) return;
                    // Renderer callbacks are supplied by the host and may
                    // throw (for example when a chart has been torn down in
                    // the same task as a late Worker frame).  Let the error
                    // follow the normal host error channel instead of
                    // escaping the Worker message listener and leaving the
                    // browser with an uncaught exception.
                    try {
                        entry.handlers.onModel(msg.model);
                    } catch (error) {
                        notifyError(entry.handlers, thrownError(error, 'PineTS model handler failed'));
                    }
                }
                return;
            case 'alert':
                {
                    const entry = this.sessions.get(msg.sessionId);
                    if (!entry) return;
                    try {
                        entry.handlers.onAlert?.(msg.alert);
                    } catch (error) {
                        notifyError(entry.handlers, thrownError(error, 'PineTS alert handler failed'));
                    }
                }
                return;
            case 'warning':
                {
                    const entry = this.sessions.get(msg.sessionId);
                    if (!entry) return;
                    try {
                        entry.handlers.onWarning?.(msg.warning);
                    } catch (error) {
                        notifyError(entry.handlers, thrownError(error, 'PineTS warning handler failed'));
                    }
                }
                return;
            case 'error':
                // Error callbacks belong to the host boundary and may throw
                // (for example a UI adapter can fail while rendering the
                // diagnostic). Keep protocol bookkeeping in a finally-like
                // path so one callback cannot strand the session's pending
                // run counter and block every later notifyBars/update.
                {
                    const entry = this.sessions.get(msg.sessionId);
                    if (entry) notifyError(entry.handlers, errorFromWorker(msg.message, msg.error));
                }
                this.runFinished(msg.sessionId);
                return;
            case 'done':
                {
                    const entry = this.sessions.get(msg.sessionId);
                    if (entry) {
                        try {
                            entry.handlers.onDone?.();
                        } catch (error) {
                            notifyError(entry.handlers, thrownError(error, 'PineTS completion handler failed'));
                        }
                    }
                }
                this.runFinished(msg.sessionId);
                return;
            case 'reactsToViewport': {
                const s = this.sessions.get(msg.sessionId);
                if (s) s.req.prepared.reactsToViewport = msg.value; // refine in place, like PineEngine
                return;
            }
            case 'fetchSeries':
                // A worker can host several chart cells at once. Route the
                // request through the originating session's gateway instead
                // of selecting whichever callback happened to be registered
                // first in the shared worker.
                void this.serveFetch(msg.sessionId, msg.reqId, msg.symbol, msg.timeframe, msg.range);
                return;
            case 'contextResult': {
                const waiter = this.contextWaits.get(msg.reqId);
                this.contextWaits.delete(msg.reqId);
                // A malformed/old Worker bundle can legally reach this
                // protocol boundary with an omitted or primitive snapshot.
                // Do not resolve `getContext()` with `undefined` (the public
                // contract is snapshot-or-null), and do not let validation of
                // an experimental field strand the caller.
                if (msg.snapshot == null || typeof msg.snapshot !== 'object' || Array.isArray(msg.snapshot)) {
                    waiter?.resolve(null);
                    return;
                }
                // Structured cloning across the Worker boundary removes the
                // frozen bits applied by snapshotFromCtx. Re-apply the same
                // validation/freeze boundary in the main realm so in-process
                // and Worker context reads expose identical audit envelopes.
                if (msg.snapshot?.auditLedger) {
                    const auditLedger = validateAuditLedgerSnapshot(msg.snapshot.auditLedger);
                    if (!auditLedger) {
                        // Never pass a malformed experimental stream to a
                        // host. Keep the rest of the ordinary context intact.
                        const { auditLedger: discardedAuditLedger, ...withoutAudit } = msg.snapshot;
                        // Keep the destructuring explicit so a malformed
                        // experimental field is dropped without mutating the
                        // structured-cloned snapshot object.
                        void discardedAuditLedger;
                        waiter?.resolve(withoutAudit);
                        return;
                    }
                    waiter?.resolve({ ...msg.snapshot, auditLedger });
                    return;
                }
                waiter?.resolve(msg.snapshot);
                return;
            }
        }
    }

    /**
     * Answer a worker's secondary-fetch request via the originating session's
     * gateway. Session callbacks are intentionally not interchangeable: two
     * cells may use different providers, symbols, auth scopes, or caches even
     * when their requested `(symbol, timeframe)` happens to match.
     */
    private async serveFetch(sessionId: number, reqId: number, symbol: string, timeframe: string, range: BarRange): Promise<void> {
        const entry = this.sessions.get(sessionId);
        if (!entry) return;
        const fetchSeries = entry.req.fetchSeries;
        if (!fetchSeries) {
            // A live session without a secondary-feed gateway still needs an
            // explicit empty response so the worker-side request can settle.
            // `postIfWorker()` is deliberate: a late request must never
            // resurrect an engine that was already terminated.
            this.postIfWorker({ kind: 'fetchSeriesResult', reqId, bars: [] });
            return;
        }
        try {
            const bars = await fetchSeries(symbol, timeframe, range);
            // A host provider can resolve after ExecutionSession.stop() or
            // PineWorkerEngine.terminate(). Drop that response rather than
            // sending it to a stale/new worker (or reviving a terminated one).
            if (this.sessions.get(sessionId) !== entry) return;
            this.postIfWorker({ kind: 'fetchSeriesResult', reqId, bars });
        } catch (err) {
            if (this.sessions.get(sessionId) !== entry) return;
            const message = err instanceof Error ? err.message : String(err);
            const errorDetails = serializeWorkerError(err);
            this.postIfWorker({
                kind: 'fetchSeriesResult',
                reqId,
                error: message,
                ...(errorDetails ? { errorDetails } : {}),
            });
        }
    }
}
