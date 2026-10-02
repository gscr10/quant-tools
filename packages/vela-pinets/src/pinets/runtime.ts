import { PineTS, Indicator } from 'pinets';
import type { BarMagnifierInput, BarMagnifierFallbackReason, BarMagnifierStatus } from 'pinets';
import type {
    PreparedScript,
    ExecutionMarket,
    ExecutionRequest,
    VisibleBarRange,
    FetchSeries,
    EngineAlert,
    EngineWarning,
} from '@luxalgo/vela/plugin';
import type { OHLCV } from '@luxalgo/vela/plugin';
import type { InputValue, InputSchema } from '@luxalgo/vela/plugin';
import type { IndicatorModel } from '@luxalgo/vela/plugin';
import { normalizeContext, declarationExecuted } from './normalizeContext';
import { toScene } from './toScene';
import { mapInputs } from './inputsMeta';
import { mapProps, applyProps } from './propsMeta';
import { ensurePineTablePatch } from './tablePatch';
import { ensurePineMarkerPatch } from './markerPatch';
import { PINE_EXECUTION_BUILD_INFO } from '../build-info';
import { nextReportRunId, stampReportIdentity } from './reportSeries';

/**
 * The transport-agnostic PineTS runtime: parse a script, run it once over bars,
 * and map the PineTS context to the neutral model. Shared by the in-process
 * `PineEngine` and the worker-backed `PineWorkerEngine` — neither the bars source
 * nor `fetchSeries` care whether they're in-process or across a worker boundary,
 * so the same code runs in both. This (with the `pinets/` mapper) is the only PineTS
 * coupling; everything above it is neutral.
 */

/** One static run's neutral result. */
export interface PineRunResult {
    /**
     * The neutral model — or null when the run never executed the script body (zero
     * bars: empty initial load, unresolved symbol). Such a run carries no declaration,
     * so mapping it would fabricate default metadata (`title: "Indicator"`,
     * `overlay: false`) that contradicts the static scan and would strand the
     * indicator's pane routing in the host. Callers emit NOTHING for a null model and
     * let the session re-run when bars arrive.
     */
    model: IndicatorModel | null;
    alerts: EngineAlert[];
    warnings: EngineWarning[];
    reactsToViewport: boolean;
    /** The raw run context — engines derive read-only snapshots from it (never exposed live). */
    ctx: unknown;
}

/** Optional precision envelope understood by the local PineTS fork. */
export interface PineBarMagnifierOptions extends BarMagnifierInput {
    /** The host may provide validated child bars directly (useful offline/tests). */
    readonly status?: BarMagnifierStatus;
}

/**
 * Public execution request understood by the local bridge. Vela's base
 * request intentionally has no engine-specific fields; this extension lets
 * direct Pine engine callers request Bar Magnifier precision without a cast
 * while remaining assignable to the generic ScriptingEngine port.
 */
export interface PineExecutionRequest extends ExecutionRequest {
    readonly barMagnifier?: PineBarMagnifierOptions;
}

/** A reusable PineTS Indicator instance, recreated only when the input-set changes. */
export interface IndicatorCache {
    lastKey?: string;
    lastInd?: InstanceType<typeof Indicator>;
}

/**
 * Bounds for the execution-session lower-timeframe cache.
 *
 * The cache is intentionally session-scoped: a provider gateway can close over
 * credentials or a venue, so a process-wide cache would risk leaking one chart
 * cell's candles into another. `ttlMs` is measured from a successful response,
 * not from the first request; touching an entry does not extend its lifetime.
 * A zero TTL disables fulfilled-result retention while still coalescing calls
 * that are concurrently in flight. `now` is injectable for deterministic tests.
 */
export interface LowerTimeframeFetchCacheOptions {
    readonly maxEntries?: number;
    readonly ttlMs?: number;
    readonly now?: () => number;
}

type LowerTimeframeFetchRange = Parameters<FetchSeries>[2];

interface LowerTimeframeCacheEntry {
    readonly promise: Promise<OHLCV[]>;
    readonly providerId: number;
    readonly symbol: string;
    readonly timeframe: string;
    /** Set only after a non-empty successful response. `undefined` = pending. */
    expiresAt?: number;
}

/**
 * A small, execution-session cache for Bar Magnifier's lower-timeframe feed.
 *
 * The provider gateway is intentionally *not* wrapped globally: two chart
 * cells can use different providers/auth scopes, and request.security has its
 * own refresh semantics.  Engines create one instance per execution session
 * and pass it only to {@link resolveBarMagnifier}.  Entries retain the
 * in-flight promise, so concurrent runs for the same window share one fetch;
 * rejected, empty, or malformed results are removed immediately and can be
 * retried.
 */
export class LowerTimeframeFetchCache {
    static readonly DEFAULT_MAX_ENTRIES = 8;
    /**
     * Lower feeds are historical windows, but a forming candle can change.
     * The host also clears the session cache on bar/restart notifications; this
     * finite TTL protects callers that do not emit those notifications.
     */
    static readonly DEFAULT_TTL_MS = 30_000;

    private readonly maxEntries: number;
    private readonly ttlMs: number;
    private readonly now: () => number;
    private readonly entries = new Map<string, LowerTimeframeCacheEntry>();
    /**
     * A gateway function is the runtime's provider identity: it closes over
     * the venue/account/auth scope used for the request. Weak keys keep that
     * identity out of the serialized window key without retaining gateways
     * after their owning session has released them.
     */
    private readonly providerIds = new WeakMap<FetchSeries, number>();
    private nextProviderId = 0;

    constructor(options?: LowerTimeframeFetchCacheOptions);
    /** Backward-compatible shorthand retained for existing engine callers. */
    constructor(maxEntries?: number, ttlMs?: number);
    constructor(
        optionsOrMaxEntries: LowerTimeframeFetchCacheOptions | number = {},
        positionalTtlMs?: number,
    ) {
        const options: LowerTimeframeFetchCacheOptions = typeof optionsOrMaxEntries === 'number'
            ? { maxEntries: optionsOrMaxEntries, ...(positionalTtlMs === undefined ? {} : { ttlMs: positionalTtlMs }) }
            : optionsOrMaxEntries;
        // A bad host option must not turn the cache into an unbounded map.  A
        // zero budget is a useful explicit opt-out for tests/diagnostics.
        this.maxEntries = normalizeNonNegativeInteger(options.maxEntries, LowerTimeframeFetchCache.DEFAULT_MAX_ENTRIES);
        // Infinity is a deliberate opt-out for long-lived offline sessions;
        // finite defaults still ensure normal chart sessions eventually refresh.
        this.ttlMs = options.ttlMs === Infinity
            ? Infinity
            : normalizeNonNegativeNumber(options.ttlMs, LowerTimeframeFetchCache.DEFAULT_TTL_MS);
        this.now = typeof options.now === 'function' ? options.now : Date.now;
    }

    /** Number of currently retained windows (including in-flight requests). */
    get size(): number {
        this.evictExpired();
        return this.entries.size;
    }

    /** Drop all retained windows when an execution session is stopped. */
    clear(): void {
        this.entries.clear();
    }

    /**
     * Invalidate every window belonging to one provider gateway.
     *
     * This is useful when a provider changes account/venue state without
     * replacing the callback identity. Pending requests are not cancelled —
     * their eventual results are simply no longer retained.
     */
    invalidateProvider(fetchSeries: FetchSeries): number {
        this.evictExpired();
        const providerId = this.providerIds.get(fetchSeries);
        if (providerId === undefined) return 0;
        return this.removeEntries((entry) => entry.providerId === providerId);
    }

    /** Invalidate one exact lower-feed window and return whether it was present. */
    invalidateWindow(
        fetchSeries: FetchSeries,
        symbol: string,
        timeframe: string,
        range: LowerTimeframeFetchRange,
    ): boolean {
        this.evictExpired();
        const providerId = this.providerIds.get(fetchSeries);
        if (providerId === undefined) return false;
        return this.entries.delete(lowerTimeframeFetchKey(providerId, symbol, timeframe, range));
    }

    /**
     * Fetch one lower-timeframe window, reusing an in-flight or fulfilled
     * request with the same provider key.  `fetchSeries` is deliberately a
     * parameter rather than a constructor dependency so the cache remains a
     * transport-neutral runtime primitive (in-process and Worker use the same
     * implementation).
     */
    fetch(
        fetchSeries: FetchSeries,
        symbol: string,
        timeframe: string,
        range: LowerTimeframeFetchRange,
    ): Promise<OHLCV[]> {
        // Snapshot the small range object before the provider call is queued;
        // callers are free to reuse/mutate their request object after this
        // method returns, but the key and the actual fetch must stay aligned.
        const requestRange = { ...range };
        if (this.maxEntries <= 0) return Promise.resolve().then(() => fetchSeries(symbol, timeframe, requestRange));

        this.evictExpired();
        const key = lowerTimeframeFetchKey(this.providerId(fetchSeries), symbol, timeframe, requestRange);
        const existing = this.entries.get(key);
        if (existing) {
            // Touch the entry for a small LRU rather than evicting a hot
            // window while longer histories introduce new ranges.
            this.entries.delete(key);
            this.entries.set(key, existing);
            return existing.promise;
        }

        // Keep the promise identity so an evicted/failed older request cannot
        // delete a newer request that happens to reuse the same key. The
        // handlers run in a later microtask, after `promise` is initialized.
        const providerId = this.providerId(fetchSeries);
        const promise = Promise.resolve()
            .then(() => fetchSeries(symbol, timeframe, requestRange))
            .then((bars) => {
                // FetchSeries is typed as OHLCV[], but a gateway failure in a
                // host integration has historically surfaced as undefined.
                // Preserve that caller-visible fallback while refusing to
                // retain a malformed result in the cache.
                // An empty lower feed is the transport's "no data" result in
                // practice.  Treat it like a failed fetch for caching purposes:
                // a later backfill/retry in the same execution session must be
                // able to observe newly available child candles.
                if (!Array.isArray(bars) || bars.length === 0) {
                    if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
                } else if (this.entries.get(key)?.promise === promise) {
                    // TTL starts when usable data arrives. A pending request is
                    // never expired solely because the provider was slow.
                    if (this.ttlMs === 0) this.entries.delete(key);
                    else this.entries.get(key)!.expiresAt = this.ttlMs === Infinity
                        ? Infinity
                        : this.now() + this.ttlMs;
                }
                return bars;
            }, (error: unknown) => {
                if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
                throw error;
            });
        this.entries.set(key, { promise, providerId, symbol, timeframe });
        this.trim();
        return promise;
    }

    private providerId(fetchSeries: FetchSeries): number {
        const existing = this.providerIds.get(fetchSeries);
        if (existing !== undefined) return existing;
        const id = ++this.nextProviderId;
        this.providerIds.set(fetchSeries, id);
        return id;
    }

    private trim(): void {
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.entries.delete(oldest);
        }
    }

    private evictExpired(): void {
        if (this.ttlMs === Infinity || this.entries.size === 0) return;
        const now = this.now();
        for (const [key, entry] of this.entries) {
            // Pending entries have no expiry. They remain deduplicated even if
            // the provider takes longer than the configured TTL.
            if (entry.expiresAt !== undefined && now >= entry.expiresAt) this.entries.delete(key);
        }
    }

    private removeEntries(predicate: (entry: LowerTimeframeCacheEntry) => boolean): number {
        let removed = 0;
        for (const [key, entry] of this.entries) {
            if (!predicate(entry)) continue;
            this.entries.delete(key);
            removed += 1;
        }
        return removed;
    }
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isFinite(value)
        ? Math.max(0, Math.floor(value))
        : fallback;
}

function normalizeNonNegativeNumber(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isFinite(value)
        ? Math.max(0, value)
        : fallback;
}

/** Stable, explicit key for every range field accepted by FetchSeries. */
function lowerTimeframeFetchKey(
    providerId: number,
    symbol: string,
    timeframe: string,
    range: Parameters<FetchSeries>[2],
): string {
    // JSON preserves the distinction between the four range positions and
    // avoids delimiter collisions in symbols/timeframes. `undefined` is
    // intentionally represented as null: Vela's gateway treats omitted and
    // undefined bounds identically, while an explicit numeric bound remains
    // distinct.
    return JSON.stringify([
        providerId,
        symbol,
        timeframe,
        range.from ?? null,
        range.to ?? null,
        range.limit ?? null,
        range.session ?? null,
    ]);
}

/** The serializable identity of a prepared script (safe to cross a worker boundary). */
export interface PineToken {
    source: string;
    instanceId: string;
    /**
     * The declaration's `overlay` when the AST scan resolved it to a literal (named or
     * positional); absent for a computed/variable value. Carried on the token so
     * {@link pineCtxToModel} can pin every computed model's pane routing to the
     * DECLARATION — the runtime context is a lossy source for it (see there).
     */
    declaredOverlay?: boolean;
    /** Build identity copied into PreparedScript so a Worker cannot silently
     * execute a stale inlined PineTS bundle. */
    build: typeof PINE_EXECUTION_BUILD_INFO;
}

/**
 * Which scripts publish a declaration-props schema (the settings dialog's
 * "Properties" tab): every script, only `strategy()` scripts, or none.
 * Presentation-only — hidden props keep their source/spec values at run time,
 * and programmatic `setProps` overrides still apply.
 */
export type PropsVisibility = 'all' | 'strategy' | 'none';

/**
 * What the engines' `props` option accepts: a visibility mode, or an explicit
 * WHITELIST of prop keys — only those entries are published, in the LIST's
 * order, so the host controls both the subset and the layout of the Properties
 * tab. A script owning none of the whitelisted keys (e.g. an `indicator()`
 * under a strategy-only list) publishes no schema and gets no tab at all.
 */
export type PropsFilter = PropsVisibility | readonly string[];

/** The props schema `prepare` publishes under a filter (see {@link PropsFilter}). */
function propsFor(scanned: InstanceType<typeof Indicator>, defaultProps: Record<string, InputValue> | undefined, filter: PropsFilter): InputSchema[] {
    if (filter === 'none') return [];
    if (filter === 'strategy' && scanned.getDeclarationType() !== 'strategy') return [];
    const all = mapProps(scanned, defaultProps);
    if (typeof filter === 'string') return all;
    const byKey = new Map(all.map((p) => [p.key, p]));
    return filter.map((key) => byKey.get(key)).filter((p): p is InputSchema => p !== undefined);
}

/** Parse a Pine source: inputs + declaration-props schemas + metadata + viewport-dependence.
 *  No market data. `defaultProps` = the engine's configured prop defaults, folded into the
 *  props schema's effective `defval`s (beneath source-declared values); `propsVisibility`
 *  gates which scripts publish the schema — and which entries (default: every script,
 *  every mutable prop). */
export function preparePine(source: string, instanceId: string, defaultProps?: Record<string, InputValue>, propsVisibility: PropsFilter = 'all'): PreparedScript {
    // The public engine port is typed as `string`, but hosts can still cross
    // the boundary from JavaScript, structured-clone payloads, or a stale
    // editor cell.  `Indicator.from()` currently coerces `null`/other values
    // instead of rejecting them, which would make a malformed prepare appear
    // successful and diverge from the Worker protocol's error response.  Keep
    // the validation here, shared by both engines, so PineEngine's Promise
    // boundary and the worker's try/catch expose the same asynchronous error.
    if (typeof source !== 'string') {
        throw new TypeError('Pine source must be a string');
    }
    const scanned = Indicator.from(source);
    const inputs = mapInputs(scanned.getInputsMeta());
    const props = propsFor(scanned, defaultProps, propsVisibility);
    // The declared overlay comes from the same AST scan that feeds the props schema:
    // `scanned.prop` lays the declaration call's resolved args over the spec defaults,
    // handling named AND positional forms and never matching comments, string literals,
    // or a plot's `force_overlay` — the raw-source regex this replaces mis-routed all of
    // those (`indicator("I", "i", true)` mounted its placeholder in a sub pane, then
    // jumped to the price pane when the first computed model landed). A non-boolean scan
    // means the script passes a variable the scanner can't resolve — keep the literal
    // regex as the placeholder guess (word-bounded: a `my_overlay = true` assignment must
    // not match), and leave `declaredOverlay` unset so the computed model keeps the
    // runtime's own answer.
    const scannedOverlay = scanned.prop.overlay;
    const declaredOverlay = typeof scannedOverlay === 'boolean' ? scannedOverlay : undefined;
    const overlay = declaredOverlay ?? /(?<![\w.$])overlay\s*[:=]\s*true/.test(source);
    // strategy() declares exactly like indicator() — without the alternative, every
    // strategy script showed a placeholder "Indicator" legend title until its first run.
    // The title argument comes in two shapes — positional (`indicator("X")`) and named
    // (`indicator(title = "X")`) — and the string itself may hold the OTHER quote or
    // escapes; missing any of these left the generic "Indicator" on the loading legend
    // for the script's whole first compute. Anchored to a line start so a commented-out
    // declaration above the real one can never win.
    const declared = /^\s*(?:indicator|strategy)\s*\(\s*(?:title\s*=\s*)?(["'])((?:\\.|(?!\1).)*)\1/m.exec(source)?.[2];
    const title = declared?.replace(/\\(.)/g, '$1').trim() || 'Indicator';
    // Statically detect viewport dependence so the orchestrator can route:
    // viewport-dependent scripts keep the (debounced) full-run path; others stream.
    const reactsToViewport = /chart\.(left|right)_visible_bar(_time)?\b/.test(source);
    const token: PineToken = {
        source,
        instanceId,
        build: PINE_EXECUTION_BUILD_INFO,
        ...(declaredOverlay !== undefined ? { declaredOverlay } : {}),
    };
    return { language: 'pine', inputs, ...(props.length > 0 ? { props } : {}), meta: { title, overlay }, reactsToViewport, token };
}

/**
 * A fresh Indicator per (input, prop)-set: PineTS bakes input overrides at construction
 * and prop overrides via `.prop` writes, so reuse the last instance when both bags are
 * unchanged (live ticks / re-runs) to avoid re-transpiling on every poke.
 */
export function indicatorFor(cache: IndicatorCache, source: string, inputs: Record<string, InputValue>, props: Record<string, InputValue> = {}): InstanceType<typeof Indicator> {
    const key = JSON.stringify([inputs, props]);
    if (cache.lastKey !== key || !cache.lastInd) {
        const ind = new Indicator(source, inputs);
        applyProps(ind, props);
        cache.lastInd = ind;
        cache.lastKey = key;
    }
    return cache.lastInd;
}

/**
 * Normalize only the parent periods covered by TradingView's documented Bar
 * Magnifier table.  This intentionally does not turn an arbitrary duration
 * (for example 3m, 45m, or 2h) into a guessed child period: an unsupported
 * mapping must fall back to chart-OHLC rather than claim precision we did not
 * request or validate.
 */
function normalizeBarMagnifierParent(timeframe: string): string | undefined {
    const raw = timeframe.trim();
    if (!raw) return undefined;

    // Pine's canonical minute form is a bare integer.  Vela/venue aliases use
    // a lower-case `m`; keep the case-sensitive check so upper-case `M` stays
    // a calendar month and cannot be mistaken for minutes.
    if (/^\d+$/.test(raw)) return String(Number(raw));
    if (/^\d+(?:\.0+)?m$/.test(raw)) return String(Number(raw.slice(0, -1)));

    // Only the explicitly documented hour/day/week aliases are accepted.
    // (The numeric equivalents above cover 60/240/1440/4320/10080.)
    if (/^1h$/i.test(raw)) return '60';
    if (/^4h$/i.test(raw)) return '240';
    if (/^(?:1d|d)$/i.test(raw)) return 'D';
    if (/^3d$/i.test(raw)) return '3D';
    if (/^(?:1w|w)$/i.test(raw)) return 'W';
    return undefined;
}

/**
 * TradingView's documented Bar Magnifier mapping for the provider-backed
 * periods in this workspace.
 *
 * The reference table also contains 1m→10s and 5m→30s. Binance and
 * Hyperliquid expose minute candles as their finest historical feed, so those
 * second-based mappings deliberately return `undefined`; `resolveBarMagnifier`
 * then reports the normal chart-OHLC fallback without issuing an impossible
 * second-candle request. The 15m→2m child is provider-backed by deterministic
 * aggregation from 1m candles.
 */
export function barMagnifierTimeframe(timeframe: string | undefined): string | undefined {
    if (!timeframe) return undefined;
    const parent = normalizeBarMagnifierParent(timeframe);
    if (!parent) return undefined;

    const map: Record<string, string> = {
        '10': '1',
        '15': '2',
        '30': '5',
        '60': '10',
        '240': '30',
        // Vela can serialize day/week selections as their minute equivalent.
        // Keep these aliases explicit instead of deriving arbitrary ratios: the
        // entries are still exactly the documented TradingView parent periods.
        '1440': '60',
        '4320': '240',
        '10080': 'D',
        D: '60',
        '3D': '240',
        W: 'D',
    };
    return map[parent];
}

function boolProp(ind: InstanceType<typeof Indicator>, props: Record<string, InputValue> | undefined, key: string): boolean {
    const override = props?.[key];
    if (typeof override === 'boolean') return override;
    try {
        return ind.prop[key] === true;
    } catch {
        return false;
    }
}

function childInputBars(bars: OHLCV[] | undefined): NonNullable<BarMagnifierInput['bars']> {
    return (bars ?? []).map((bar) => ({
        openTime: bar.time,
        ...(Number.isFinite((bar as OHLCV & { closeTime?: number }).closeTime)
            ? { closeTime: Number((bar as OHLCV & { closeTime?: number }).closeTime) }
            : {}),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        ...(bar.volume == null ? {} : { volume: bar.volume }),
    }));
}

/** Parse Vela/Pine timeframe spellings into a fixed duration in milliseconds. */
function timeframeDurationMs(timeframe: string | undefined): number | null {
    const raw = String(timeframe ?? '').trim();
    if (!raw) return null;
    const safeDuration = (value: number): number | null =>
        Number.isSafeInteger(value) && value > 0 ? value : null;
    // Lowercase `m` is the provider's minute suffix; Pine's upper-case M is
    // the calendar-month spelling.  Keep this distinction before upper-case
    // normalization.
    if (/^\d+(?:\.\d+)?m$/.test(raw)) return safeDuration(Number(raw.slice(0, -1)) * 60_000);
    // A few provider gateways use the bare lower-case `m` for one minute.
    // Treat it exactly like `1m`; upper-case `M` remains a calendar month.
    if (raw === 'm') return 60_000;
    if (/^\d+(?:\.\d+)?$/.test(raw)) return safeDuration(Number(raw) * 60_000);
    if (raw === 'D' || raw === '1D' || raw === 'd' || raw === '1d') return 86_400_000;
    if (raw === 'W' || raw === '1W' || raw === 'w' || raw === '1w') return 7 * 86_400_000;
    if (raw === 'M' || raw === '1M') return 30 * 86_400_000;
    // Pine uses an upper-case `M` for calendar months.  Keep this explicit
    // before the case-insensitive unit parser so a supplied `2M` child is not
    // mistaken for two minutes (provider minute aliases use lower-case `m`).
    if (/^\d+(?:\.\d+)?M$/.test(raw)) return safeDuration(Number(raw.slice(0, -1)) * 30 * 86_400_000);
    const match = /^(\d+(?:\.\d+)?)(S|SEC|SECS|SECOND|SECONDS|MIN|MINS|MINUTE|MINUTES|H|HR|HRS|HOUR|HOURS|D|DAY|DAYS|W|WK|WKS|WEEK|WEEKS|MO|MOS|MONTH|MONTHS)$/i.exec(raw);
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    switch (match[2]!.toUpperCase()) {
        case 'S': case 'SEC': case 'SECS': case 'SECOND': case 'SECONDS': return safeDuration(value * 1_000);
        case 'MIN': case 'MINS': case 'MINUTE': case 'MINUTES': return safeDuration(value * 60_000);
        case 'H': case 'HR': case 'HRS': case 'HOUR': case 'HOURS': return safeDuration(value * 3_600_000);
        case 'D': case 'DAY': case 'DAYS': return safeDuration(value * 86_400_000);
        case 'W': case 'WK': case 'WKS': case 'WEEK': case 'WEEKS': return safeDuration(value * 7 * 86_400_000);
        default: return safeDuration(value * 30 * 86_400_000);
    }
}

function precisionFallback(
    bars: OHLCV[],
    lowerTimeframe: string | undefined,
    lowerBars: number,
    fallbackReason: BarMagnifierFallbackReason,
): BarMagnifierStatus {
    return {
        requested: true,
        applied: false,
        requestedPrecision: 'lower-timeframe',
        appliedPrecision: 'chart-ohlc',
        ...(lowerTimeframe ? { lowerTimeframe } : {}),
        parentBars: bars.length,
        lowerBars,
        coveredParentBars: 0,
        coverage: 0,
        fallbackReason,
    };
}

function parentEndTime(bars: OHLCV[], timeframe: string | undefined): number | undefined {
    const last = bars[bars.length - 1];
    if (!last || !Number.isFinite(last.time)) return undefined;
    const rawCloseTime = 'closeTime' in last ? last.closeTime : undefined;
    const duration = timeframeDurationMs(timeframe);
    if (typeof rawCloseTime === 'number' && Number.isFinite(rawCloseTime)) {
        // Some gateways/fixtures preserve Binance's inclusive close stamp
        // (`periodEnd - 1ms`) even though Bar Magnifier validates half-open
        // windows. Expand only the exact fixed-period-minus-one shape; a
        // session close or an arbitrary timestamp remains untouched.
        if (duration != null && rawCloseTime === last.time + duration - 1) {
            return last.time + duration;
        }
        return rawCloseTime;
    }
    return duration != null ? last.time + duration : undefined;
}

/** Align a lower-feed request to the provider's fixed UTC candle grid. */
function lowerFeedRequestStart(openTime: number, timeframe: string | undefined): number {
    const duration = timeframeDurationMs(timeframe);
    if (duration == null || !Number.isFinite(openTime) || !Number.isFinite(duration) || duration <= 0) return openTime;
    const remainder = ((openTime % duration) + duration) % duration;
    return openTime - remainder;
}

function childFetchLimit(parentBars: number, parentTimeframe: string | undefined, lowerTimeframe: string | undefined): number {
    const parentMs = timeframeDurationMs(parentTimeframe);
    const lowerMs = timeframeDurationMs(lowerTimeframe);
    // Unknown/calendar ratios remain bounded by the historical 12× estimate;
    // fixed-duration pairs use the exact ceiling (1D→60m therefore requests
    // at least 24 children per parent rather than silently under-fetching).
    const ratio = parentMs != null && lowerMs != null && lowerMs > 0
        ? Math.max(1, Math.ceil(parentMs / lowerMs))
        : 12;
    const expected = parentBars * ratio;
    return Math.max(100, expected + Math.max(2, ratio));
}

/**
 * Resolve a lower feed without conflating a request with an applied mode.  A
 * fetch failure is deliberately converted to chart-OHLC fallback metadata;
 * it never fabricates child bars from the parent OHLC range.
 */
export async function resolveBarMagnifier(
    ind: InstanceType<typeof Indicator>,
    bars: OHLCV[],
    market: ExecutionMarket,
    props: Record<string, InputValue> | undefined,
    fetchSeries: FetchSeries | undefined,
    supplied?: PineBarMagnifierOptions,
    lowerTimeframeFetchCache?: LowerTimeframeFetchCache,
): Promise<{ input: BarMagnifierInput; status?: BarMagnifierStatus }> {
    const requested = supplied?.requested ?? boolProp(ind, props, 'use_bar_magnifier');
    const lowerTimeframe = supplied?.lowerTimeframe ?? barMagnifierTimeframe(market.timeframe);
    if (!requested) return { input: { requested: false }, status: undefined };
    if (supplied?.live) {
        return {
            input: { requested: true, ...(lowerTimeframe ? { lowerTimeframe } : {}), live: true },
            status: precisionFallback(bars, lowerTimeframe, supplied.bars?.length ?? 0, 'live-mode-not-supported'),
        };
    }
    if (!lowerTimeframe) {
        // A requested Bar Magnifier without a supported parent→child mapping
        // must remain observable as a chart-OHLC fallback.  Leaving status
        // undefined makes PineTS' generic constructor fallback report
        // `lower-data-unavailable`, which incorrectly suggests that a valid
        // child timeframe was requested but the provider returned no rows.
        return {
            input: { requested: true },
            status: precisionFallback(
                bars,
                undefined,
                supplied?.bars?.length ?? 0,
                'lower-timeframe-undetermined',
            ),
        };
    }

    let lowerBars: OHLCV[] = [];
    let fallback: BarMagnifierFallbackReason | undefined;
    if (supplied?.bars) {
        lowerBars = supplied.bars.map((bar) => ({
            time: bar.openTime,
            ...(bar.closeTime == null ? {} : { closeTime: bar.closeTime }),
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            ...(bar.volume == null ? {} : { volume: bar.volume }),
        }));
        // An explicitly supplied empty array is different from an omitted
        // child feed: the host did resolve a lower timeframe, but it returned
        // no candles for this window. Preserve that distinction in the
        // machine-readable status so the UI can explain a data-empty fallback
        // and a retry/cache policy can treat it correctly.
        if (lowerBars.length === 0) fallback = 'lower-data-empty';
    } else if (fetchSeries && bars.length > 0) {
        try {
            // Fetch from the lower-period grid boundary at or before the first
            // parent.  This matters for non-divisible mappings such as
            // 15m→2m: a parent opening at 00:15 must include the provider's
            // 00:14–00:16 child so the remaining 00:16… rows stay on the
            // canonical UTC grid.  The broker later ignores the crossing row
            // itself and only consumes fully-contained children.
            const first = lowerFeedRequestStart(bars[0]!.time, lowerTimeframe);
            // `BarRange.to` is an open-time bound.  Request through the END of
            // the final parent bar, otherwise the final parent receives only
            // a child at its open (or none at all) and is falsely marked as
            // partial coverage.
            const last = parentEndTime(bars, market.timeframe) ?? bars[bars.length - 1]!.time;
            const range = {
                from: first,
                to: last,
                limit: childFetchLimit(bars.length, market.timeframe, lowerTimeframe),
            };
            const fetched = await (lowerTimeframeFetchCache
                ? lowerTimeframeFetchCache.fetch(fetchSeries, market.symbol, lowerTimeframe, range)
                : fetchSeries(market.symbol, lowerTimeframe, range));
            // The transport contract is typed as OHLCV[], but provider
            // adapters are external boundaries and historically have returned
            // undefined/null (or another malformed value) on failures. Keep
            // that failure local to Bar Magnifier so childInputBars() cannot
            // throw and abort the whole strategy run.
            if (Array.isArray(fetched)) {
                lowerBars = fetched;
                if (fetched.length === 0) fallback = 'lower-data-empty';
            } else {
                lowerBars = [];
                fallback = 'lower-data-unavailable';
            }
        } catch {
            lowerBars = [];
            fallback = 'lower-data-unavailable';
        }
    } else if (!supplied?.bars) {
        fallback = 'lower-data-unavailable';
    }
    const input: BarMagnifierInput = { requested: true, lowerTimeframe, bars: childInputBars(lowerBars) };
    return {
        input,
        ...(supplied?.status
            ? { status: supplied.status }
            : fallback
                ? { status: precisionFallback(bars, lowerTimeframe, lowerBars.length, fallback) }
                : {}),
    };
}

/** Run a prepared script once over `bars`, returning the neutral model + alerts/warnings. */
export async function runPineStatic(opts: {
    ind: InstanceType<typeof Indicator>;
    bars: OHLCV[];
    market: ExecutionMarket;
    visibleRange: VisibleBarRange | undefined;
    prepared: PreparedScript;
    instanceId: string;
    inputs: Record<string, InputValue>;
    props?: Record<string, InputValue>;
    fetchSeries: FetchSeries | undefined;
    barMagnifier?: PineBarMagnifierOptions;
    lowerTimeframeFetchCache?: LowerTimeframeFetchCache;
}): Promise<PineRunResult> {
    const { ind, bars, market, visibleRange, prepared, instanceId, inputs, props, fetchSeries, lowerTimeframeFetchCache } = opts;
    ensurePineTablePatch();
    ensurePineMarkerPatch();
    const klines = toKlines(bars, market.timeframe, market.symbolInfo);
    // The virtual provider: serve the chart's own series in-memory (the bars Vela
    // owns), but route any OTHER (symbol, timeframe) — i.e. request.security HTF/LTF/
    // cross-symbol — back to Vela's cache-backed gateway. PineTS reuses this same
    // provider for its secondary contexts, so MTF data is real and timeframe-separated.
    const source = {
        getMarketData: (sym?: string, tf?: string, limit?: number, sDate?: number, eDate?: number) =>
            isChartSeries(sym, tf, market) ? Promise.resolve(klines) : secondaryKlines(fetchSeries, sym, tf, limit, sDate, eDate, syminfoForSymbol(market, sym)),
        getSymbolInfo: async (sym?: string) => syminfoForSymbol(market, sym),
    };
    const precision = await resolveBarMagnifier(ind, bars, market, props, fetchSeries, opts.barMagnifier, lowerTimeframeFetchCache);
    const pine = new PineTS(source as never, chartTickerOf(market), market.timeframe, klines.length, undefined, undefined, {
        barMagnifier: precision.input,
        ...(precision.status ? { barMagnifierStatus: precision.status } : {}),
    });
    await pine.ready();
    // Feed the chart viewport so `chart.left/right_visible_bar_time` resolve to the
    // visible window; a no-op for scripts that don't reference those built-ins.
    if (visibleRange) pine.setVisibleRange(visibleRange.left, visibleRange.right);
    const ctx = (await pine.run(ind)) as PineCtx;
    // A static invocation is one immutable report run. Stamp before callers emit
    // its model so ScriptRun/context reads observe the same identity.
    stampReportIdentity(ctx, nextReportRunId(instanceId), 1);
    const reactsToViewport = typeof pine.usesVisibleRange === 'function' ? pine.usesVisibleRange() : false;

    return {
        model: declarationExecuted(ctx) ? pineCtxToModel(ctx, instanceId, prepared, inputs, props ?? {}, bars[0]?.time) : null,
        alerts: (ctx.alerts ?? []).map(mapAlert),
        warnings: (ctx.warnings ?? []).map(mapWarning),
        reactsToViewport,
        ctx, // raw run context — engines derive read-only snapshots from it (never exposed live)
    };
}

/**
 * Map a PineTS run/stream context to the neutral indicator model. `anchorTime` is the
 * time of the FIRST bar this run executed over — index-aligned renderers align the
 * model's dense arrays and `bar_index` drawings to the chart through it (offset 0 when
 * the run spanned the whole chart, the norm).
 */
export function pineCtxToModel(ctx: unknown, instanceId: string, prepared: PreparedScript, inputs: Record<string, InputValue>, props: Record<string, InputValue>, anchorTime?: number): IndicatorModel {
    const { model } = toScene(normalizeContext(ctx), instanceId);
    // Pane routing must follow the DECLARATION. Vela re-routes an indicator's pane when
    // the first computed model's `overlay` disagrees with the prepared meta, and the
    // runtime context is a lossy source for that flag — the strategy runtime drops
    // positional declaration args, so `strategy("S", "s", true)` executes with
    // `config.overlay: false` and would tear the placeholder off the price pane. The
    // statically scanned declaration is the truth; a host's prop override
    // (`setProps({ overlay })`, mutable per the Pine spec) is the one legitimate
    // runtime divergence and stays on top of it.
    const overlay = typeof props.overlay === 'boolean' ? props.overlay : (prepared.token as PineToken).declaredOverlay;
    if (overlay !== undefined) {
        model.overlay = overlay;
        model.paneHint = overlay ? 'price' : 'new';
    }
    model.inputs = prepared.inputs;
    model.inputValues = { ...defaultsOf(prepared.inputs), ...inputs };
    if (prepared.props) {
        model.props = prepared.props;
        model.propValues = { ...defaultsOf(prepared.props), ...props };
    }
    if (anchorTime != null) model.anchorTime = anchorTime;
    return model;
}

/** `HHMM-HHMM` → minutes-of-day span (wraps midnight when start > end, e.g. the
 *  futures trading day `1700-1600`); null for anything else (`24x7`, the synthesized
 *  `regular`, absent) — callers treat null as "no session vocabulary". */
function sessionSpan(s: unknown): { start: number; end: number } | null {
    if (typeof s !== 'string') return null;
    const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(s);
    if (!m) return null;
    return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]) };
}

const inSpan = (m: number, s: { start: number; end: number }): boolean => (s.start <= s.end ? m >= s.start && m < s.end : m >= s.start || m < s.end);

/** Timezone offset per (tz, hour) via Intl, cached — one Intl call per distinct hour of
 *  data keeps a 10k-bar series in the sub-millisecond range. */
const tzOffsetCache = new Map<string, number>();
function wallMinuteOfDay(ts: number, tz: string): number | null {
    const key = `${tz}:${Math.floor(ts / 3_600_000)}`;
    let off = tzOffsetCache.get(key);
    if (off == null) {
        try {
            const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(ts);
            const g = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? NaN);
            off = Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute')) - ts) / 60_000);
        } catch {
            off = NaN;
        }
        if (tzOffsetCache.size > 100_000) tzOffsetCache.clear();
        tzOffsetCache.set(key, off);
    }
    if (Number.isNaN(off)) return null;
    return ((Math.floor(ts / 60_000) + off) % 1440 + 1440) % 1440;
}

/** Chart timeframe → minutes, for the closeTime cap. Intraday and daily only — W/M
 *  session closes need trading-day grouping this template-local pass cannot do, so
 *  they (like unknown spellings) keep the engine's own `open + tf` net. */
function tfMinutesFor(tf: string | undefined): number | null {
    if (tf == null) return null;
    if (/^\d+$/.test(tf)) return Number(tf);
    if (/^1?D$/i.test(tf)) return 1440;
    return null;
}

/**
 * The per-bar SESSION close for a series on a session market — TV convention, and what
 * the engine's kline contract asks providers for: `min(open + tf, the declared session
 * window's end)`. A daily bar labeled at the session open closes at the session end
 * (08:30 → 15:15), the last intraday bucket runs short (15:00 + 1h → 15:15), and a
 * trading-day roll span (`1700-1600`) closes next-day. Which window rules — regular or
 * extended — is read off the BARS themselves: any bar outside the regular span means
 * the series is the extended tape. Template-local like the widget's session shading:
 * holidays/early closes are deliberately NOT recomputed here (the resolved calendar
 * stays the truth for consumers that need them), and a bar outside every declared
 * window falls back to the engine's `open + tf` net. DST transitions inside one bar's
 * open→close span keep the offset of the open (off by the jump on those bars, twice a
 * year).
 */
function sessionCloser(bars: OHLCV[], tf: string | undefined, syminfo: unknown): ((openMs: number) => number | null) | null {
    // `unknown` on purpose: callers hand over whatever symbol-info shape their feed
    // declares (the port type varies across host versions) — one narrowing here keeps
    // every call site assertion-free under either set of typings.
    const si = typeof syminfo === 'object' && syminfo != null ? (syminfo as Record<string, unknown>) : null;
    const tfMin = tfMinutesFor(tf);
    const regular = sessionSpan(si?.session);
    const tz = typeof si?.timezone === 'string' ? si.timezone : null;
    if (tfMin == null || regular == null || tz == null || bars.length === 0) return null;
    const extended = sessionSpan(si?.session_extended);
    let active = regular;
    if (extended) {
        for (const b of bars) {
            const m = wallMinuteOfDay(b.time, tz);
            if (m != null && !inSpan(m, regular) && inSpan(m, extended)) {
                active = extended;
                break;
            }
        }
    }
    return (openMs: number): number | null => {
        const m = wallMinuteOfDay(openMs, tz);
        if (m == null || !inSpan(m, active)) return null;
        const untilEnd = (active.end - m + 1440) % 1440 || 1440;
        return openMs + Math.min(tfMin, untilEnd) * 60_000;
    };
}

/** OHLCV → PineTS kline shape (openTime-keyed). With a chart timeframe and a
 *  session-market syminfo, each kline carries its session {@link sessionCloser | closeTime}
 *  — continuous markets (and W/M) emit none and the engine's `open + tf` net applies. */
export function toKlines(bars: OHLCV[], tf?: string, syminfo?: unknown): Array<Record<string, number>> {
    const closer = sessionCloser(bars, tf, syminfo);
    return bars.map((b) => {
        const k: Record<string, number> = { openTime: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 };
        const ct = closer?.(b.time);
        if (ct != null) k.closeTime = ct;
        return k;
    });
}

/**
 * The ticker the CHART SERIES is addressed by — THE CHART TYPE IS THE TICKER, the single
 * channel through which PineTS learns it. On a bar-transforming style the chart's data
 * is its derived view, so the chart ticker is the EXTENDED ticker (`"SYM;heikinashi"`):
 * PineTS derives `chart.is_heikinashi` + the `syminfo.tickerid` suffix from it, and a
 * PLAIN same-symbol request becomes unambiguous — it can only mean STANDARD data
 * (routed through the gateway), never the in-memory view. Without this,
 * `security(ticker.standard(...), <chart tf>, …)` would collide with the chart series
 * and silently receive derived bars. Only the bar-transforming style matters — every
 * other Vela price style draws standard data.
 */
export function chartTickerOf(market: ExecutionMarket): string {
    return market.chartStyle === 'heikinashi' ? `${market.symbol};heikinashi` : market.symbol;
}

/** True when PineTS is asking for the chart's own series (served in-memory) — addressed by {@link chartTickerOf}. */
export function isChartSeries(sym: string | undefined, tf: string | undefined, market: ExecutionMarket): boolean {
    return (sym == null || sym === chartTickerOf(market)) && (tf == null || tf === market.timeframe);
}

/** Klines for a secondary (non-chart) series via Vela's cache-backed gateway. */
export async function secondaryKlines(
    fetchSeries: FetchSeries | undefined,
    sym: string | undefined,
    tf: string | undefined,
    limit?: number,
    sDate?: number,
    eDate?: number,
    syminfo?: Record<string, unknown>,
): Promise<Array<Record<string, number>>> {
    if (!fetchSeries || !sym || !tf) return [];
    const fetched = await fetchSeries(sym, tf, { from: sDate, to: eDate, limit });
    // Secondary feeds cross the same host/provider boundary as Bar Magnifier.
    // A malformed *resolved* response must degrade to an empty series, not
    // throw from `toKlines()`; a rejected Promise is deliberately preserved so
    // provider error metadata can reach the Pine session error channel.
    if (!Array.isArray(fetched)) return [];
    const bars = fetched.filter((bar): bar is OHLCV => (
        bar !== null
        && typeof bar === 'object'
        && Number.isFinite(bar.time)
        && Number.isFinite(bar.open)
        && Number.isFinite(bar.high)
        && Number.isFinite(bar.low)
        && Number.isFinite(bar.close)
    ));
    return toKlines(bars, tf, syminfo);
}

/** The streaming provider a live PineTS session polls (see {@link makeLiveProvider}). */
export interface LiveProvider {
    markDirty(): void;
    getMarketData(ticker: string, tf: string, limit?: number, sDate?: number, eDate?: number): Promise<unknown[]>;
    getSymbolInfo(ticker?: string): Promise<Record<string, unknown>>;
}

/**
 * A provider adapter that serves the chart's OWN live bars to a streaming PineTS
 * instance (no extra network). Dedupes so the stream only re-executes when the
 * bars actually change (or when `markDirty()` forces it, e.g. on a visible-range
 * change). Mirrors `IProvider.getMarketData(ticker, tf, limit, sDate, eDate)`:
 * `sDate == null` = the stream's initial full-history load; non-null = a live
 * poll for the tail, where an EMPTY result means "no change — skip execution".
 * Shared by the in-process live engine and the worker's streaming session (the
 * only difference is how `getBars` is backed: a closure vs a message-fed array).
 */
export function makeLiveProvider(getBars: () => OHLCV[], getMarket: () => ExecutionMarket, fetchSeries: FetchSeries | undefined): LiveProvider {
    let lastKey = '';
    let dirty = false;
    return {
        markDirty: () => {
            dirty = true;
        },
        getMarketData: async (ticker, tf, limit, sDate, eDate) => {
            // Secondary series (request.security HTF/LTF/cross-symbol) → cache-backed gateway.
            const market = getMarket();
            if (!isChartSeries(ticker, tf, market)) {
                return secondaryKlines(fetchSeries, ticker, tf, limit, sDate, eDate, syminfoForSymbol(market, ticker));
            }
            const klines = toKlines(getBars(), market.timeframe, market.symbolInfo);
            // Initial load (no sDate): full history.
            if (sDate == null) return klines;
            // Streaming update: only the forming candle + any newer bars.
            const tail = klines.filter((k) => (k.openTime ?? 0) >= sDate);
            const last = tail[tail.length - 1];
            const sig = last ? `${tail.length}|${last.openTime}|${last.close}|${last.high}|${last.low}|${last.volume}` : '';
            if (!dirty && sig === lastKey) return []; // unchanged → no re-execution
            dirty = false;
            lastKey = sig;
            return tail;
        },
        getSymbolInfo: async (ticker) => syminfoForSymbol(getMarket(), ticker),
    };
}

/** A running live stream (see {@link openLiveStream}). */
export interface LiveStreamHandle {
    stop(): void;
    setVisibleRange(left: number, right: number): void;
    /** Force the next poll through the provider's dedupe (e.g. after a viewport change). */
    markDirty(): void;
    /** The most recent raw run context (null before the first streamed evaluation). */
    lastCtx(): unknown;
}

/**
 * Open ONE persistent streaming PineTS session over the caller's bars: PineTS polls the
 * {@link makeLiveProvider} adapter (its dedupe makes quiet polls free) and re-executes only
 * the forming/new bars per tick; each emission maps to a neutral model stamped with the
 * stream's anchor (its first bar — the history is frozen at open, so a deepened chart needs
 * a REOPEN, not a poke). Shared by the in-process live engine and the worker's live
 * sessions — the transport differs, the session logic doesn't.
 */
export function openLiveStream(opts: {
    token: PineToken;
    cache: IndicatorCache;
    prepared: PreparedScript;
    inputs: Record<string, InputValue>;
    props?: Record<string, InputValue>;
    bars: () => OHLCV[];
    market: () => ExecutionMarket;
    fetchSeries?: FetchSeries;
    /** Optional Bar Magnifier request. Live execution is explicitly reported
     * as unsupported until a refreshed child feed can be synchronized safely. */
    barMagnifier?: PineBarMagnifierOptions;
    /** Session-scoped lower-feed cache; request.security remains uncached. */
    lowerTimeframeFetchCache?: LowerTimeframeFetchCache;
    visibleRange?: VisibleBarRange;
    onModel(model: IndicatorModel): void;
    onAlert?(alert: EngineAlert): void;
    onWarning?(warning: EngineWarning): void;
    onError?(error: Error): void;
}): LiveStreamHandle {
    const bars = opts.bars();
    ensurePineTablePatch();
    ensurePineMarkerPatch();    
    const ind = indicatorFor(opts.cache, opts.token.source, opts.inputs, opts.props ?? {});
    const anchorTime = bars[0]?.time;
    // pageSize = full length: the initial drain must emit ONE complete model (a smaller
    // page would mount a partial one); ≥1 so an empty array can't zero the page size.
    const initialLen = Math.max(1, bars.length);
    const provider = makeLiveProvider(opts.bars, opts.market, opts.fetchSeries);
    const requestedMagnifier = opts.barMagnifier?.requested ?? boolProp(ind, opts.props, 'use_bar_magnifier');
    const liveMagnifier = requestedMagnifier
        ? {
            ...(opts.barMagnifier ?? {}),
            requested: true,
            live: true,
        }
        : undefined;
    const pine = new PineTS(
        provider as never,
        chartTickerOf(opts.market()),
        opts.market().timeframe,
        initialLen,
        undefined,
        undefined,
        liveMagnifier ? { barMagnifier: liveMagnifier } : {},
    );
    if (opts.visibleRange) pine.setVisibleRange(opts.visibleRange.left, opts.visibleRange.right);
    const evt = pine.stream(ind, { live: true, interval: 1000, pageSize: initialLen }) as {
        on(e: string, cb: (arg: unknown) => void): void;
        stop(): void;
    };
    let stopped = false;
    let lastCtx: unknown = null;
    // Host callbacks are an integration boundary. A renderer/adapter can
    // throw while handling an error; that must not escape PineTS' stream
    // promise and become an unhandled rejection (or stop future polls).
    const notifyError = (value: unknown): void => {
        try {
            opts.onError?.(value instanceof Error ? value : new Error(String(value)));
        } catch {
            // Diagnostics are best effort; the stream lifecycle remains owned
            // by PineTS and continues/tears down normally.
        }
    };
    const reportRunId = nextReportRunId(opts.token.instanceId);
    let reportSnapshotRevision = 0;
    evt.on('data', (ctx) => {
        if (stopped) return;
        // One persistent stream is one run; each evaluated tick is a newer snapshot.
        stampReportIdentity(ctx, reportRunId, ++reportSnapshotRevision);
        lastCtx = ctx;
        // A tick that never executed the script body (a stream opened over zero bars)
        // carries no declaration — emit nothing rather than a fabricated default model
        // (same rule as runPineStatic's null model).
        if (!declarationExecuted(ctx)) return;
        try {
            opts.onModel(pineCtxToModel(ctx, opts.token.instanceId, opts.prepared, opts.inputs, opts.props ?? {}, anchorTime));
        } catch (err) {
            notifyError(err);
        }
    });
    // `PineTS.stream` invokes listeners synchronously from its polling task.
    // Keep optional host callbacks behind the same boundary as `onModel`: a
    // renderer/notification adapter can disappear during teardown and throw
    // on a late alert or warning. Let that become a normal engine error rather
    // than escaping the stream task and stopping future polls.
    evt.on('alert', (a) => {
        try {
            opts.onAlert?.(mapAlert(a as never));
        } catch (error) {
            notifyError(error);
        }
    });
    evt.on('warning', (w) => {
        try {
            opts.onWarning?.(mapWarning(w as never));
        } catch (error) {
            notifyError(error);
        }
    });
    evt.on('error', notifyError);
    return {
        stop: () => {
            stopped = true;
            evt.stop();
        },
        setVisibleRange: (left, right) => {
            pine.setVisibleRange(left, right);
            provider.markDirty();
        },
        markDirty: () => provider.markDirty(),
        lastCtx: () => lastCtx,
    };
}

/** syminfo for a (possibly secondary) symbol — synthesizes per-symbol when it differs from the chart. */
export function syminfoForSymbol(market: ExecutionMarket, sym: string | undefined): Record<string, unknown> {
    // A secondary symbol may arrive as an extended ticker ("SYM;heikinashi"); synthesize
    // the display fields from the PLAIN symbol (the modifier is a data-routing marker,
    // not part of the instrument's identity).
    const plain = sym ? sym.split(';')[0]! : sym;
    return plain && plain !== market.symbol ? syminfoFor({ symbol: plain, timeframe: market.timeframe }) : syminfoFor(market);
}

/** Symbol info for execution: prefer the feed's, else synthesize from the ticker. */
function syminfoFor(market: ExecutionMarket): Record<string, unknown> {
    if (market.symbolInfo) return market.symbolInfo;
    const symbol = market.symbol;
    const base = symbol.replace(/(USDT|USDC|USD|PERP|BUSD)$/i, '') || symbol;
    return {
        ticker: symbol,
        tickerid: symbol,
        main_tickerid: symbol,
        description: symbol,
        prefix: '',
        root: symbol,
        type: 'crypto',
        basecurrency: base,
        currency: 'USD',
        timezone: 'UTC',
        session: 'regular',
        mintick: 0.01,
        minmove: 1,
        pointvalue: 1,
        pricescale: 100,
    };
}

interface PineCtx {
    alerts?: RawAlert[];
    warnings?: RawWarning[];
}
interface RawAlert {
    id?: unknown;
    message?: unknown;
    title?: string;
    time?: unknown;
    bar_index?: unknown;
    freq?: string;
}
interface RawWarning {
    message?: unknown;
    method?: string;
    bar?: unknown;
}

function defaultsOf(inputs: PreparedScript['inputs']): Record<string, InputValue> {
    const out: Record<string, InputValue> = {};
    for (const input of inputs) out[input.key] = input.defval;
    return out;
}

export function mapAlert(a: RawAlert): EngineAlert {
    return {
        id: String(a.id ?? ''),
        message: String(a.message ?? ''),
        title: a.title,
        time: Number(a.time ?? 0),
        barIndex: Number(a.bar_index ?? 0),
        freq: a.freq,
    };
}

export function mapWarning(w: RawWarning): EngineWarning {
    return { message: String(w.message ?? ''), method: w.method, bar: Number(w.bar ?? 0) };
}
