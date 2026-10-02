// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo
import { IProvider, ISymbolInfo } from './marketData/IProvider';
import { Context } from './Context.class';
import { splitTickerModifier, withTickerModifier } from './tickerModifier';
import { Series } from './Series';
import { Indicator } from './Indicator';
import { processStrategyOrders, processExitOrders, processMarginCall, finalizeStrategyBar, finalizeStrategyRun, isAdverseFirstBar, applyPendingCloseMarginCall, snapshotStrategyState, restoreStrategyState, checkpointStrategyExecutionRange } from './namespaces/strategy/utils';
import type { BarMagnifierInput, BarMagnifierStatus } from './types/ExecutionPrecision';

/** Options used by the local broker-emulator precision fork. */
export interface PineTSExecutionOptions {
    /** Lower-timeframe input and the explicit request state from the host. */
    readonly barMagnifier?: BarMagnifierInput;
    /** Pre-resolved status (used by the Vela bridge after its fetch/validation). */
    readonly barMagnifierStatus?: BarMagnifierStatus;
}

type BrokerBar = {
    openTime: number;
    closeTime?: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
};

// ── Timeframe duration utility ──────────────────────────────────────
//prettier-ignore
const TIMEFRAME_DURATION_MS: Record<string, number> = {
    '1': 60_000, '3': 180_000, '5': 300_000, '15': 900_000, '30': 1_800_000,
    '60': 3_600_000, '120': 7_200_000, '180': 10_800_000, '240': 14_400_000,
    '4H': 14_400_000, '1D': 86_400_000, 'D': 86_400_000,
    '1W': 604_800_000, 'W': 604_800_000,
    '1M': 30 * 86_400_000, 'M': 30 * 86_400_000,
};
function getTimeframeDurationMs(timeframe: string | undefined): number {
    if (!timeframe) return 86_400_000; // default to 1D when timeframe is unknown

    // Keep the historical lookup table for Pine's canonical spellings, but
    // also parse the complete family of Vela/provider aliases.  In
    // particular, Bar Magnifier commonly maps a 60-minute parent to a
    // 10-minute child; treating the unknown key "10" as one day silently
    // breaks child close-time/coverage validation.
    const raw = String(timeframe).trim();
    // Provider aliases use a lower-case `m` for minutes, while Pine uses an
    // upper-case `M` for calendar months. Check the alias before the
    // case-insensitive table lookup below.
    if (/^\d+(?:\.\d+)?m$/.test(raw)) {
        const minutes = Number(raw.slice(0, -1));
        return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 86_400_000;
    }
    // Some provider adapters serialize a one-minute interval as the bare
    // lower-case `m` (the suffixed form `1m` is handled above).  Preserve
    // Pine's upper-case `M` month semantics while accepting that provider
    // alias; otherwise a 1m child feed would be treated as a 30-day candle
    // and every Bar Magnifier coverage check would fall back incorrectly.
    if (raw === 'm') return 60_000;
    if (raw === 'M' || raw === '1M') return 30 * 86_400_000;
    const direct = TIMEFRAME_DURATION_MS[raw] ?? TIMEFRAME_DURATION_MS[raw.toUpperCase()];
    if (direct != null) return direct;
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
        const minutes = Number(raw);
        return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 86_400_000;
    }
    const match = /^(\d+(?:\.\d+)?)(S|SEC|SECS|SECOND|SECONDS|M|MIN|MINS|MINUTE|MINUTES|H|HR|HRS|HOUR|HOURS|D|DAY|DAYS|W|WK|WKS|WEEK|WEEKS)$/i.exec(raw);
    if (!match) return 86_400_000;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return 86_400_000;
    // Pine reserves an upper-case `M` for calendar months.  The lower-case
    // provider spelling (`2m`) was handled before this case-insensitive
    // expression, so preserving the original token here keeps `2M` from
    // silently becoming two minutes.
    if (match[2] === 'M') return value * 30 * 86_400_000;
    switch (match[2]!.toUpperCase()) {
        case 'S': case 'SEC': case 'SECS': case 'SECOND': case 'SECONDS':
            return value * 1_000;
        case 'M': case 'MIN': case 'MINS': case 'MINUTE': case 'MINUTES':
            return value * 60_000;
        case 'H': case 'HR': case 'HRS': case 'HOUR': case 'HOURS':
            return value * 3_600_000;
        case 'D': case 'DAY': case 'DAYS':
            return value * 86_400_000;
        case 'W': case 'WK': case 'WKS': case 'WEEK': case 'WEEKS':
            return value * 7 * 86_400_000;
        default:
            // A bare upper-case M means a calendar month in Pine.  We use the
            // same 30-day approximation as the existing duration table.
            return value * 30 * 86_400_000;
    }
}

/**
 * Whether a timeframe has a concrete duration understood by the broker.
 * `getTimeframeDurationMs()` intentionally keeps a one-day fallback for the
 * legacy chart-series closeTime safety net, but that fallback must never be
 * used to claim Bar Magnifier precision for an unknown parent/child period.
 */
function hasKnownTimeframeDuration(timeframe: string | undefined): boolean {
    if (!timeframe) return false;
    const raw = String(timeframe).trim();
    if (!raw) return false;
    if (/^\d+(?:\.\d+)?m$/.test(raw)) {
        const value = Number(raw.slice(0, -1));
        return Number.isFinite(value) && value > 0;
    }
    if (raw === 'm' || raw === 'M' || raw === '1M') return true;
    const direct = TIMEFRAME_DURATION_MS[raw] ?? TIMEFRAME_DURATION_MS[raw.toUpperCase()];
    if (direct != null) return true;
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
        const value = Number(raw);
        return Number.isFinite(value) && value > 0;
    }
    const match = /^(\d+(?:\.\d+)?)(S|SEC|SECS|SECOND|SECONDS|M|MIN|MINS|MINUTE|MINUTES|H|HR|HRS|HOUR|HOURS|D|DAY|DAYS|W|WK|WKS|WEEK|WEEKS)$/i.exec(raw);
    if (!match) return false;
    const value = Number(match[1]);
    return Number.isFinite(value) && value > 0;
}

function precisionStatus(
    requested: boolean,
    applied: boolean,
    lowerTimeframe: string | undefined,
    parentBars: number,
    lowerBars: number,
    coveredParentBars: number,
    fallbackReason?: BarMagnifierStatus['fallbackReason'],
): BarMagnifierStatus {
    return {
        requested,
        applied,
        requestedPrecision: requested ? 'lower-timeframe' : 'chart-ohlc',
        appliedPrecision: applied ? 'lower-timeframe' : 'chart-ohlc',
        ...(lowerTimeframe ? { lowerTimeframe } : {}),
        parentBars,
        lowerBars,
        coveredParentBars,
        coverage: parentBars > 0 ? coveredParentBars / parentBars : 0,
        ...(fallbackReason ? { fallbackReason } : {}),
    };
}

function defaultBarMagnifierStatus(input: BarMagnifierInput | undefined): BarMagnifierStatus {
    const requested = input?.requested === true;
    const fallbackReason = !requested
        ? 'not-requested'
        : input?.live
            ? 'live-mode-not-supported'
            : 'lower-data-unavailable';
    return precisionStatus(
        requested,
        false,
        input?.lowerTimeframe,
        0,
        input?.bars?.length ?? 0,
        0,
        fallbackReason,
    );
}

type BarWindow = { start: number; end: number };

function isValidOhlc(bar: BrokerBar): boolean {
    return Number.isFinite(bar.openTime)
        && Number.isFinite(bar.open)
        && Number.isFinite(bar.high)
        && Number.isFinite(bar.low)
        && Number.isFinite(bar.close)
        && bar.high >= Math.max(bar.open, bar.close)
        && bar.low <= Math.min(bar.open, bar.close)
        && bar.low <= bar.high;
}

function barWindow(
    bar: BrokerBar,
    nextOpenTime: number | undefined,
    durationMs: number,
    rejectExpandedWindow = false,
): BarWindow | null {
    const start = Number(bar.openTime);
    // A missing next bar may mean either a normal final bar or a session/data
    // gap. Never let a gap extend the current parent window: lower candles in
    // that interval must remain out-of-range instead of being treated as part
    // of the preceding chart candle. If the next bar starts *inside* the
    // nominal duration (short session/early close), retain that earlier bound.
    const nominalEnd = start + durationMs;
    const inferredEnd = nextOpenTime != null && Number.isFinite(nextOpenTime)
        ? Math.min(nextOpenTime, nominalEnd)
        : nominalEnd;
    let end = Number(bar.closeTime ?? inferredEnd);
    // Vela's OHLCV transport normally exposes only `time`, but callers may
    // provide Binance-style rows where closeTime is the *last millisecond*
    // in the candle (`nextOpen - 1`).  The broker windows are half-open
    // [start, end), so normalize that one-millisecond representation at the
    // boundary instead of rejecting an otherwise complete lower feed.  Do not
    // add a millisecond to arbitrary session closes: only an exact nominal
    // endpoint-minus-one is unambiguous.
    if (bar.closeTime != null) {
        const fixedEndpoint = start + durationMs;
        if (end === fixedEndpoint - 1 || end === inferredEnd - 1) end += 1;
    }
    // An explicit provider close may shorten a candle (early session close),
    // but it cannot enlarge a fixed-timeframe candle beyond its nominal
    // duration. Accepting such a row would let malformed metadata turn, for
    // example, one 15m parent into a 30m replay window and falsely claim that
    // twice as many lower candles were covered. Binance's inclusive
    // `nominalEnd - 1ms` form was normalized above and remains valid.
    if (!Number.isFinite(start)
        || !Number.isFinite(end)
        || end <= start
        || (rejectExpandedWindow && end > nominalEnd)) return null;
    return { start, end };
}

/** First sorted child whose open time is >= `value`. */
function lowerBoundBars(bars: readonly BrokerBar[], value: number): number {
    let lo = 0;
    let hi = bars.length;
    while (lo < hi) {
        const mid = lo + Math.floor((hi - lo) / 2);
        if (bars[mid]!.openTime < value) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * Provider-backed fixed-period candles must start on their canonical UTC
 * duration grid.  Binance and Hyperliquid expose crypto candles on that
 * epoch-based grid; accepting a shifted aggregate (for example 00:01, 00:03,
 * … for a 2-minute feed) would make a non-divisible parent such as 15m look
 * complete while replaying the wrong prices.  Parent/session origins may be
 * arbitrary, so this check is intentionally applied to the lower feed only.
 */
function isFixedGridAligned(openTime: number, durationMs: number): boolean {
    if (!Number.isSafeInteger(openTime) || !Number.isSafeInteger(durationMs) || durationMs <= 0) return false;
    const remainder = ((openTime % durationMs) + durationMs) % durationMs;
    return remainder === 0;
}

/** Validate parent/child timestamps before allowing the broker to use them. */
function resolveBarMagnifierStatus(
    input: BarMagnifierInput | undefined,
    parents: readonly BrokerBar[],
    children: readonly BrokerBar[],
    parentTimeframe?: string,
): BarMagnifierStatus {
    const requested = input?.requested === true;
    const lowerTimeframe = input?.lowerTimeframe;
    if (!requested) return precisionStatus(false, false, lowerTimeframe, parents.length, children.length, 0, 'not-requested');
    if (input?.live) return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, 0, 'live-mode-not-supported');
    if (!lowerTimeframe) return precisionStatus(true, false, undefined, parents.length, children.length, 0, 'lower-timeframe-undetermined');
    if (children.length === 0) return precisionStatus(true, false, lowerTimeframe, parents.length, 0, 0, 'lower-data-empty');

    // Do not silently turn the duration helper's legacy one-day fallback into
    // an applied precision claim. Explicit Bar Magnifier callers must supply
    // two known periods, and the child must actually be lower than the parent.
    if (!hasKnownTimeframeDuration(parentTimeframe) || !hasKnownTimeframeDuration(lowerTimeframe)) {
        return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, 0, 'lower-timeframe-undetermined');
    }
    const parentDuration = getTimeframeDurationMs(parentTimeframe);
    const childDuration = getTimeframeDurationMs(lowerTimeframe);
    if (!(childDuration < parentDuration)) {
        return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, 0, 'lower-timeframe-undetermined');
    }
    const parentWindows: BarWindow[] = [];
    let previousParentStart = -Infinity;
    let previousParentEnd = -Infinity;
    for (let i = 0; i < parents.length; i += 1) {
        const parent = parents[i]!;
        if (!isValidOhlc(parent)) {
            return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, 0, 'invalid-parent-bars');
        }
        if (parent.openTime <= previousParentStart) {
            return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, 0, 'duplicate-parent-bars');
        }
        const window = barWindow(parent, parents[i + 1]?.openTime, parentDuration, true);
        if (!window) {
            return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, 0, 'invalid-parent-bars');
        }
        if (i > 0 && window.start < previousParentEnd) {
            return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, 0, 'overlapping-parent-bars');
        }
        parentWindows.push(window);
        previousParentStart = window.start;
        previousParentEnd = window.end;
    }

    let previousChildStart = -Infinity;
    let previousChildEnd = -Infinity;
    const childWindows: BarWindow[] = [];
    for (let i = 0; i < children.length; i += 1) {
        const child = children[i]!;
        if (!isValidOhlc(child)) {
            return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, 0, 'invalid-lower-bars');
        }
        if (child.openTime <= previousChildStart) {
            return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, 0, 'duplicate-lower-bars');
        }
        // Lower rows are fixed-duration candles. Do not infer an omitted
        // close from the next open: doing so would turn a missing child into
        // an apparently contiguous span and defeat the gap/coverage check.
        const window = barWindow(child, undefined, childDuration);
        if (!window) {
            return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, 0, 'invalid-lower-bars');
        }
        if (i > 0 && window.start < previousChildEnd) {
            return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, 0, 'overlapping-lower-bars');
        }
        childWindows.push(window);
        previousChildStart = child.openTime;
        previousChildEnd = window.end;
    }

    if (parentWindows.length === 0) {
        return precisionStatus(true, false, lowerTimeframe, 0, children.length, 0, 'partial-lower-coverage');
    }
    const firstParent = parentWindows[0]!;
    const lastParent = parentWindows[parentWindows.length - 1]!;
    // Provider range APIs are commonly inclusive at the upper bound. A fetch
    // through the final parent close can therefore contain the first child of
    // the *next* parent exactly at `lastParent.end`; it is harmless. A lower
    // candle may also straddle the final boundary when the periods are not
    // evenly divisible. Anything starting beyond that boundary is genuinely
    // out of range and must fall back.
    const leadingChild = childWindows[0]!;
    const hasLeadingCrossing = leadingChild.start < firstParent.start
        && leadingChild.end > firstParent.start
        && firstParent.start - leadingChild.start < childDuration;
    if ((!hasLeadingCrossing && leadingChild.start < firstParent.start)
        || childWindows[childWindows.length - 1]!.start > lastParent.end) {
        return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, 0, 'out-of-range-lower-bars');
    }

    const consumedChildren = new Set<number>();
    let covered = 0;
    for (let i = 0; i < parentWindows.length; i += 1) {
        const parent = parentWindows[i]!;
        const startIndex = lowerBoundBars(children, parent.start);
        const endIndex = lowerBoundBars(children, parent.end);
        const contained: number[] = [];
        for (let childIndex = startIndex; childIndex < endIndex; childIndex += 1) {
            const child = childWindows[childIndex]!;
            // Only complete child candles are eligible for broker replay. A
            // candle crossing the parent close belongs to neither side.
            if (child.start >= parent.start
                && child.end <= parent.end
                && child.end - child.start === childDuration) {
                contained.push(childIndex);
            }
        }

        const parentSpan = parent.end - parent.start;
        const expectedChildren = Math.floor(parentSpan / childDuration);
        const edgeRemainder = parentSpan - expectedChildren * childDuration;
        if (expectedChildren <= 0 || contained.length < expectedChildren) {
            // Distinguish a missing candle inside the available run from a
            // truncated leading/trailing response.
            for (let childIndex = 1; childIndex < contained.length; childIndex += 1) {
                if (childWindows[contained[childIndex]!]!.start > childWindows[contained[childIndex - 1]!]!.end) {
                    return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, covered, 'gapped-lower-bars');
                }
            }
            return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, covered, 'partial-lower-coverage');
        }
        if (contained.length > expectedChildren) {
            return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, covered, 'overlapping-lower-bars');
        }

        for (let childIndex = 1; childIndex < contained.length; childIndex += 1) {
            const previous = childWindows[contained[childIndex - 1]!]!;
            const child = childWindows[contained[childIndex]!]!;
            if (child.start !== previous.end) {
                return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, covered, 'gapped-lower-bars');
            }
        }

        const firstChild = childWindows[contained[0]!]!;
        const lastChild = childWindows[contained[contained.length - 1]!]!;
        const leadingRemainder = firstChild.start - parent.start;
        const trailingRemainder = parent.end - lastChild.end;
        // Exact-ratio periods still require complete edge-to-edge coverage.
        // For floor mappings such as 15m -> 2m, the unavoidable one-minute
        // remainder may sit at either edge (or be split across both), but it
        // may never hide an internal missing candle.
        if (leadingRemainder < 0 || trailingRemainder < 0
            || leadingRemainder + trailingRemainder !== edgeRemainder) {
            return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, covered, 'partial-lower-coverage');
        }

        // A complete count and edge remainder are not sufficient for
        // provider-aggregated candles: a shifted origin can satisfy both
        // conditions for floor mappings (15m -> 2m).  Reject any consumed
        // child outside the fixed UTC grid before enabling the replay path.
        for (const childIndex of contained) {
            if (!isFixedGridAligned(childWindows[childIndex]!.start, childDuration)) {
                return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, covered, 'unaligned-lower-bars');
            }
        }

        for (const childIndex of contained) consumedChildren.add(childIndex);
        covered += 1;
    }

    // Every supplied row must either be replayable, a provider-inclusive row
    // starting at the final parent close, or a fixed-duration candle crossing
    // a non-divisible boundary. Rows in session gaps or arbitrary out-of-range
    // data remain a hard fallback.
    // `childWindows` and `parentWindows` are both sorted.  Keep a monotonic
    // parent cursor while checking the rows that were not consumed by the
    // per-parent binary bounds above.  The old implementation searched every
    // parent for every leftover child, which made a long, mostly valid history
    // degrade to O(parentBars * lowerBars) (and, for one crossing row per
    // parent, effectively O(parentBars²)).
    let candidateParentIndex = 0;
    for (let childIndex = 0; childIndex < childWindows.length; childIndex += 1) {
        if (consumedChildren.has(childIndex)) continue;
        const child = childWindows[childIndex]!;
        if (child.start === lastParent.end) continue;

        let allowedCrossing = false;
        let allowedEdgePartial = false;
        while (candidateParentIndex < parentWindows.length
            && child.start >= parentWindows[candidateParentIndex]!.end) {
            candidateParentIndex += 1;
        }
        const parent = parentWindows[candidateParentIndex];
        if (parent) {
            const nextParent = parentWindows[candidateParentIndex + 1];
            const consecutiveBoundary = nextParent === undefined || nextParent.start === parent.end;
            const remainder = (parent.end - parent.start) % childDuration;
            const nonDivisible = remainder !== 0;
            if (consecutiveBoundary && nonDivisible && child.start < parent.end && child.end > parent.end) {
                allowedCrossing = true;
            }
            const partialSpan = child.end - child.start;
            if (nonDivisible
                && partialSpan > 0
                && partialSpan <= remainder
                && child.start >= parent.start
                && child.end <= parent.end
                && (child.start === parent.start || child.end === parent.end)) {
                allowedEdgePartial = true;
            }
        }
        const leadingCrossing = child.start < firstParent.start
            && child.end > firstParent.start
            && child.start >= firstParent.start - childDuration
            && childIndex === 0;
        if (!allowedCrossing && !allowedEdgePartial && !leadingCrossing) {
            return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, covered, 'out-of-range-lower-bars');
        }
    }
    if (covered !== parents.length) {
        return precisionStatus(true, false, lowerTimeframe, parents.length, children.length, covered, 'partial-lower-coverage');
    }
    return precisionStatus(true, true, lowerTimeframe, parents.length, children.length, covered);
}

/**
 * This class is a wrapper for the Pine Script language, it allows to run Pine Script code in a JavaScript environment
 */
export class PineTS {
    public data: any = [];

    //#region [Pine Script built-in variables]
    public open: any = [];
    public high: any = [];
    public low: any = [];
    public close: any = [];
    public volume: any = [];
    public hl2: any = [];
    public hlc3: any = [];
    public ohlc4: any = [];
    public hlcc4: any = [];
    public openTime: any = [];
    public closeTime: any = [];
    //#endregion

    //#region run context
    // private _periods: number = undefined;
    // public get periods() {
    //     return this._periods;
    // }
    //#endregion

    //public fn: Function;

    private _readyPromise: Promise<any> = null;

    private _ready = false;

    private _debugSettings = {
        ln: false,
        debug: false,
    };

    private _transpiledCode: Function | String = null;
    public get transpiledCode() {
        return this._transpiledCode;
    }

    // Tracks the most recently prepared Indicator. Used by the back-compat
    // forwarding paths (e.g. `usesVisibleRange()`) and by the internal
    // _initializeContext to surface the original pineTSCode on the Context.
    private _currentIndicator: Indicator | null = null;

    private _isSecondaryContext: boolean = false;
    public markAsSecondary() {
        this._isSecondaryContext = true;
    }

    private _syminfo: ISymbolInfo;
    private _chartTimezone: string | null = null;

    /** Child bars used by the optional Bar Magnifier broker path. */
    private readonly _barMagnifierBars: readonly BrokerBar[];
    /** Original host envelope; request state must be re-evaluated per run. */
    private readonly _barMagnifierInput?: BarMagnifierInput;
    /** Transport-side fallback, retained only when it still applies to a run. */
    private readonly _barMagnifierHostStatus?: BarMagnifierStatus;
    private _barMagnifierStatus: BarMagnifierStatus;

    /**
     * Set the chart display timezone (like TradingView's timezone picker).
     * This only affects log timestamp formatting — it does NOT change the timezone
     * used by computation functions (timestamp(), dayofmonth, hour, etc.), which
     * always use the exchange timezone from syminfo.timezone.
     * @param timezone IANA timezone name (e.g. 'America/New_York'), UTC offset ('UTC+5'), or 'UTC'
     */
    public setTimezone(timezone: string) {
        this._chartTimezone = timezone;
    }

    private _maxLoops: number = 500000;

    /**
     * Set the maximum number of iterations allowed per loop.
     * Mirrors TradingView's internal loop protection. If a for/while loop
     * exceeds this limit, a runtime error is thrown.
     * @param maxLoops Maximum iterations per loop (default: 500000)
     */
    public setMaxLoops(maxLoops: number) {
        this._maxLoops = maxLoops;
    }

    private _alertMode: 'realtime' | 'all' = 'realtime';

    /**
     * Set alert mode.
     * - 'realtime' (default): alerts only fire on the last (realtime) bar,
     *   matching TradingView behavior.
     * - 'all': alerts fire on every bar, useful for backtesting alert strategies.
     * @param mode Alert firing mode
     */
    public setAlertMode(mode: 'realtime' | 'all') {
        this._alertMode = mode;
    }

    // ── Visible-range / host environment ────────────────────────────────
    // Values come from the host (UI). When unset, Pine built-ins like
    // `chart.left_visible_bar_time` fall back to marketData-derived defaults
    // (first/last loaded bar's openTime).
    private _viewportLeft: number | undefined = undefined;
    private _viewportRight: number | undefined = undefined;

    // Set by `run()` from the prepared Indicator. Mirrors the Indicator's own
    // `usesVisibleRange` flag on the PineTS instance so legacy callers of
    // `pine.usesVisibleRange()` keep working.
    // True iff the script references any built-in in VIEWPORT_DEPENDENT_BUILTINS.
    // Consumers should check this before re-running on viewport changes — non-
    // viewport-dependent scripts produce identical output regardless of viewport.
    private _usesVisibleRange: boolean = false;

    // Snapshot of viewport at the time of the last update()-cached run, used to
    // decide whether an update() call can return the cached result.
    private _lastRunViewport: { left?: number; right?: number } = {};
    private _lastResult: Context | null = null;
    private _lastPineTSCode: Indicator | Function | String | null = null;

    /**
     * Set the visible range of bars from the host (e.g. chart UI viewport).
     * Affects `chart.left_visible_bar_time` and `chart.right_visible_bar_time`.
     * Defaults derive from `marketData[0]/[last].openTime` if never called.
     *
     * The setter only stores values; it does NOT trigger a re-run. Call
     * `update()` afterwards to apply the change. For scripts that don't
     * reference visible-range built-ins, `update()` is a no-op.
     *
     * @param left  openTime of the leftmost visible bar
     * @param right openTime of the rightmost visible bar
     */
    public setVisibleRange(left: number, right: number): void {
        this._viewportLeft = left;
        this._viewportRight = right;
    }

    /**
     * Whether the loaded script references any visible-range built-in
     * (e.g. `chart.left_visible_bar_time`). Detected statically during
     * transpile. Consumers fanning viewport changes across many indicators
     * should skip non-tagged instances to avoid unnecessary re-runs.
     */
    public usesVisibleRange(): boolean {
        return this._usesVisibleRange;
    }

    /** Current viewport left (undefined if setter never called). */
    public get visibleRangeLeft(): number | undefined {
        return this._viewportLeft;
    }

    /** Current viewport right (undefined if setter never called). */
    public get visibleRangeRight(): number | undefined {
        return this._viewportRight;
    }

    /**
     * Smart re-run: executes `run()` only if a re-run is actually needed.
     *
     * - First call: behaves like `run()` (always executes).
     * - Subsequent calls: returns the cached previous result UNLESS the script
     *   is viewport-dependent (`usesVisibleRange()`) AND the viewport has
     *   changed since the last cached run.
     *
     * The typical pattern for a chart consumer with multiple indicators:
     *
     *     // user pans the chart
     *     for (const p of indicators) {
     *         p.setVisibleRange(left, right);
     *         await p.update(code);   // no-op for non-viewport indicators
     *     }
     *
     * The pineTSCode argument is optional after the first call — the same code
     * is reused. Pass it again only when the script source itself has changed.
     */
    public async update(pineTSCode?: Indicator | Function | String): Promise<Context> {
        const codeToRun = pineTSCode ?? this._lastPineTSCode;
        if (!codeToRun) {
            throw new Error('pine.update(): pineTSCode is required on the first call.');
        }

        const isFirstRun = this._lastResult === null;
        const viewportChanged = this._viewportLeft !== this._lastRunViewport.left
            || this._viewportRight !== this._lastRunViewport.right;

        const needsRun = isFirstRun || (this._usesVisibleRange && viewportChanged);
        if (!needsRun) return this._lastResult as Context;

        this._lastPineTSCode = codeToRun;
        this._lastRunViewport = { left: this._viewportLeft, right: this._viewportRight };
        this._lastResult = (await this.run(codeToRun)) as Context;
        return this._lastResult;
    }

    constructor(
        private source: IProvider | any[],
        private tickerId?: string,
        private timeframe?: string,
        private limit?: number,
        private sDate?: number,
        private eDate?: number,
        executionOptions: PineTSExecutionOptions = {},
    ) {
        const input = executionOptions.barMagnifier;
        this._barMagnifierInput = input;
        this._barMagnifierHostStatus = executionOptions.barMagnifierStatus;
        this._barMagnifierBars = (input?.bars ?? []).map((bar) => ({
            openTime: Number(bar.openTime),
            closeTime: bar.closeTime == null ? undefined : Number(bar.closeTime),
            open: Number(bar.open),
            high: Number(bar.high),
            low: Number(bar.low),
            close: Number(bar.close),
            ...(bar.volume == null ? {} : { volume: Number(bar.volume) }),
        }));
        this._barMagnifierStatus = executionOptions.barMagnifierStatus ?? defaultBarMagnifierStatus(input);
        this._readyPromise = new Promise((resolve, reject) => {
            this.loadMarketData(source, tickerId, timeframe, limit, sDate, eDate).then((data) => {
                const marketData = data;

                //this._periods = marketData.length;
                this.data = marketData;

                const _open = marketData.map((d) => d.open);
                const _close = marketData.map((d) => d.close);
                const _high = marketData.map((d) => d.high);
                const _low = marketData.map((d) => d.low);
                const _volume = marketData.map((d) => d.volume);
                const _hlc3 = marketData.map((d) => (d.high + d.low + d.close) / 3);
                const _hl2 = marketData.map((d) => (d.high + d.low) / 2);
                const _ohlc4 = marketData.map((d) => (d.high + d.low + d.open + d.close) / 4);
                const _hlcc4 = marketData.map((d) => (d.high + d.low + d.close + d.close) / 4);
                const _openTime = marketData.map((d) => d.openTime);
                // Providers should supply closeTime as session close time (TV convention).
                // Safety-net for array-based data or providers that omit closeTime:
                // estimate as openTime + timeframe duration (accurate for 24/7 crypto).
                const tfDurationMs = getTimeframeDurationMs(this.timeframe);
                const _closeTime = marketData.map((d) =>
                    d.closeTime != null ? d.closeTime : d.openTime + tfDurationMs
                );

                this.open = _open;
                this.close = _close;
                this.high = _high;
                this.low = _low;
                this.volume = _volume;
                this.hl2 = _hl2;
                this.hlc3 = _hlc3;
                this.ohlc4 = _ohlc4;
                this.hlcc4 = _hlcc4;
                this.openTime = _openTime;
                this.closeTime = _closeTime;

                // Parent bars are not available until the provider/array has
                // resolved.  Recompute coverage here so the status attached to
                // every resulting context describes the actual run, not only
                // the host's request envelope.
                const computedPrecision = resolveBarMagnifierStatus(
                    input,
                    marketData as BrokerBar[],
                    this._barMagnifierBars,
                    this.timeframe,
                );
                if (!executionOptions.barMagnifierStatus) {
                    this._barMagnifierStatus = computedPrecision;
                } else if (computedPrecision.applied) {
                    // A host may pre-resolve a status while fetching the child
                    // feed, but the broker must never trust an `applied=true`
                    // claim without validating the actual parent/child arrays
                    // that reached this PineTS instance.  Conversely, a stale
                    // host-side fallback must not survive a successful local
                    // validation: `applied=true` and `fallbackReason` are
                    // mutually exclusive in the public envelope.
                    this._barMagnifierStatus = computedPrecision;
                } else {
                    // Preserve a more specific host-side transport failure
                    // (for example `lower-data-unavailable` versus an empty
                    // response) while taking all counts/coverage from the
                    // local validation. Once local rows are present, however,
                    // structural validation is authoritative: a stale host
                    // reason must not hide duplicate/gapped/out-of-range
                    // child data from the UI.
                    const hostReason = executionOptions.barMagnifierStatus.fallbackReason;
                    const computedReason = computedPrecision.fallbackReason;
                    const preserveHostReason = hostReason !== undefined
                        && (computedReason === 'lower-data-empty'
                            || computedReason === 'lower-data-unavailable'
                            || computedReason === 'lower-timeframe-undetermined');
                    this._barMagnifierStatus = {
                        ...computedPrecision,
                        ...(preserveHostReason
                            ? { fallbackReason: hostReason }
                            : {}),
                    };
                }

                if (source && (source as IProvider).getSymbolInfo) {
                    const symbolInfo = (source as IProvider)
                        .getSymbolInfo(tickerId)
                        .then((symbolInfo) => {
                            this._syminfo = symbolInfo;
                            this._ready = true;
                            resolve(true);
                        })
                        .catch((error) => {
                            console.warn('Failed to get symbol info, using default values:', error);
                            this._ready = true;
                            resolve(true);
                        });
                } else {
                    this._ready = true;
                    resolve(true);
                }
            }).catch((error: unknown) => {
                // A provider failure must reject the readiness boundary.  The
                // previous constructor only attached a fulfilment handler,
                // leaving the promise pending forever while the rejected
                // market-data request surfaced as an unhandled rejection. That
                // made request.security failures (including provider timeouts)
                // strand the Pine/Worker session without an error event. Keep
                // the original error object so its provider/status/timeout
                // metadata can cross the Worker envelope unchanged.
                reject(error);
            });
        });
        // Consumers normally await `ready()` through `run()`, but a failed
        // secondary context can be created speculatively by request.security.
        // Attach a noop observer to the base promise so a caller that stops a
        // session before awaiting it does not create a process-level
        // unhandled-rejection warning. The promise remains rejected for every
        // actual awaiter.
        void this._readyPromise.catch(() => undefined);
    }

    public setDebugSettings({ ln, debug }: { ln: boolean; debug: boolean }) {
        this._debugSettings.ln = ln;
        this._debugSettings.debug = debug;
    }

    private async loadMarketData(source: IProvider | any[], tickerId: string, timeframe: string, limit?: number, sDate?: number, eDate?: number) {
        if (Array.isArray(source)) {
            return source;
        } else {
            return (source as IProvider).getMarketData(tickerId, timeframe, limit, sDate, eDate);
        }
    }

    public async ready() {
        if (this._ready) return true;
        if (!this._readyPromise) throw new Error('PineTS is not ready');
        return this._readyPromise;
    }

    /**
     * Run the Pine Script code and return the resulting context.
     * @param pineTSCode
     * @param periods
     * @returns Promise<Context>
     */
    public run(pineTSCode: Indicator | Function | String, periods?: number): Promise<Context>;
    /**
     * Run the Pine Script code with pagination, yielding results page by page.
     * @param pineTSCode
     * @param periods
     * @param pageSize
     * @returns AsyncGenerator<Context>
     */
    public run(pineTSCode: Indicator | Function | String, periods: number | undefined, pageSize: number): AsyncGenerator<Context>;
    /**
     * Run the Pine Script code and return the resulting context.
     * if pageSize is provided, the function will return an iterator that will yield the results page by page.
     * each page contains the results of "pageSize" periods.
     * @param pineTSCode
     * @param periods
     * @param pageSize
     * @returns Context if pageSize is 0 or undefined, or AsyncGenerator<Context> if pageSize > 0
     */
    public run(pineTSCode: Indicator | Function | String, periods?: number, pageSize?: number): Promise<Context> | AsyncGenerator<Context> {
        const ind = Indicator.from(pineTSCode as any);
        this._currentIndicator = ind;
        // NB: `ind.prepare()` may throw synchronously for malformed Pine /
        // unparseable JS. We push it inside the async path so the throw
        // surfaces as a Promise rejection (matches the pre-refactor contract:
        // `await pine.run(badCode)` rejects, never throws synchronously).

        if (pageSize && pageSize > 0) {
            const enableLiveStream = typeof this.eDate === 'undefined' && !Array.isArray(this.source);
            return this._runPaginated(ind, periods, pageSize, enableLiveStream);
        } else {
            return this._runComplete(ind, periods);
        }
    }

    /**
     * Stream the results of the Pine Script code.
     * Provides an event-based interface for handling streaming data.
     * @param pineTSCode The Pine Script code to execute
     * @param options Streaming options
     * @returns Object with on(event, callback) and stop() methods
     */
    public stream(
        pineTSCode: Indicator | Function | String,
        options: { pageSize?: number; live?: boolean; interval?: number } = {},
    ): { on: (event: 'data' | 'error' | 'warning' | 'alert', callback: Function) => void; stop: () => void } {
        const { live = true, interval = 1000 } = options;
        const pageSize = options.pageSize || this.data.length; // Default pageSize to full data if not provided

        const ind = Indicator.from(pineTSCode as any);
        this._currentIndicator = ind;
        // prepare() is deferred to inside _runPaginated so transpile errors
        // surface as Promise rejections on the stream's `error` event.

        const listeners: { [key: string]: Function[] } = { data: [], error: [], warning: [], alert: [] };
        let stopped = false;

        const emit = (event: string, ...args: any[]) => {
            if (listeners[event]) {
                listeners[event].forEach((cb) => cb(...args));
            }
        };

        const on = (event: 'data' | 'error' | 'warning' | 'alert', callback: Function) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(callback);
        };

        const stop = () => {
            stopped = true;
        };

        // Start execution
        (async () => {
            try {
                // When live streaming is requested with an eDate, clamp eDate to now
                // to avoid gaps between historical data end and live data start
                if (live && typeof this.eDate !== 'undefined') {
                    this.eDate = Math.max(this.eDate, Date.now());
                }

                // Determine if live streaming is possible and requested
                const isLiveCapable = !Array.isArray(this.source);
                const enableLiveStream = isLiveCapable && live;

                // Pass undefined for periods to include all data
                // We use the generator version directly to control enableLiveStream
                const iterator = this._runPaginated(ind, undefined, pageSize, enableLiveStream);

                for await (const ctx of iterator) {
                    if (stopped) break;

                    if (ctx === null) {
                        // No new data
                        // This block is only reached if enableLiveStream is true and provider yields no data

                        // Wait and retry
                        await new Promise((resolve) => setTimeout(resolve, interval));
                        continue;
                    }

                    emit('data', ctx);

                    // Emit any NEW runtime warnings accumulated since last tick
                    if (ctx.warnings && ctx.warnings.length > 0) {
                        for (const w of ctx.warnings) {
                            emit('warning', w);
                        }
                        // Clear so next tick only emits newly added warnings
                        ctx.warnings.length = 0;
                    }

                    // Emit any NEW alert events accumulated since last tick
                    if (ctx.alerts && ctx.alerts.length > 0) {
                        for (const a of ctx.alerts) {
                            emit('alert', a);
                        }
                        // Clear so next tick only emits newly added alerts
                        ctx.alerts.length = 0;
                    }

                    // If live streaming is enabled, wait for the interval before fetching next data
                    // This prevents hammering the API when new data is available immediately or in rapid succession
                    if (enableLiveStream && !stopped) {
                        const currentCandle = ctx.marketData[ctx.idx];
                        const isHistorical = currentCandle && currentCandle.closeTime < Date.now();
                        const isLastBar = ctx.idx >= ctx.marketData.length - 1;

                        // Always throttle when on the last bar (caught up to current data).
                        // For mid-stream historical pages, skip the delay so initial load is fast.
                        if (!isHistorical || isLastBar) {
                            await new Promise((resolve) => setTimeout(resolve, interval));
                        }
                    }
                }
            } catch (error) {
                emit('error', error);
            }
        })();

        return { on, stop };
    }

    /**
     * Run an already-transpiled PineTS function in this instance — no
     * additional transpile/parse pass. Used by `request.security_lower_tf`'s
     * slow path to execute the slice produced at primary-transpile time
     * (a truncated body containing only the prefix up to the call). The
     * caller is responsible for ensuring `transpiledFn` was produced by
     * this transpiler against the same source — calling this with an
     * arbitrary function is unsafe.
     */
    public async runPretranspiled(transpiledFn: Function, inputs: Record<string, any> = {}, periods?: number): Promise<Context> {
        await this.ready();
        if (!periods) periods = this.data.length;

        const context = this._initializeContext(null as any, inputs, this._isSecondaryContext);
        this._transpiledCode = transpiledFn;
        // Preserve slice attribution on the context so any nested LTF
        // request inside the slice can keep using the same map.
        const slices = (transpiledFn as any)._ltfSlices;
        if (slices) (context as any)._ltfTruncatedBodies = slices;

        await this._executeIterations(context, transpiledFn, this.data.length - periods, this.data.length);

        return context;
    }

    /**
     * Run the script completely and return the final context.
     *
     * Execution is split: all bars except the last are processed first, then a
     * var-state snapshot is taken, then the last bar is processed. This gives
     * updateTail() a reliable snapshot-based restore point, matching the
     * pattern used by _runPaginated and eliminates the pop-based drift that
     * occurred when var variables were modified in-place during re-execution.
     * @private
     */
    private async _runComplete(ind: Indicator, periods?: number): Promise<Context> {
        await this.ready();
        if (!periods) periods = this.data.length;

        const prepared = ind.prepare(this._debugSettings);
        this._usesVisibleRange = prepared.usesVisibleRange;
        this._refreshBarMagnifierStatus(ind);

        const context = this._initializeContext(ind.source ?? null as any, prepared.inputs, this._isSecondaryContext);
        this._transpiledCode = prepared.fn;
        // Propagate transpile-time slices (one per request.security_lower_tf
        // call site) onto the Context so the slow path of the LTF runtime
        // can pick the right truncated body to run in the secondary
        // instead of the FULL user script.
        if (prepared.ltfSlices) (context as any)._ltfTruncatedBodies = prepared.ltfSlices;

        // Split execution: process all bars except the last, snapshot, then
        // process the last bar. This gives updateTail() a reliable restore
        // point, matching the pattern used by _runPaginated.
        const startIdx = this.data.length - periods;
        const endIdx = this.data.length;

        if (endIdx - startIdx > 1) {
            await this._executeIterations(context, prepared.fn, startIdx, endIdx - 1);
            (context as any)._varSnapshot = this._snapshotVarState(context);
            await this._executeIterations(context, prepared.fn, endIdx - 1, endIdx);
        } else {
            // A one-bar dataset still needs a real "before forming bar"
            // snapshot. In particular, strategy() and local declarations are
            // both created by that first execution and must disappear before
            // the bar is recalculated on the next live tick.
            (context as any)._varSnapshot = this._snapshotVarState(context);
            await this._executeIterations(context, prepared.fn, startIdx, endIdx);
        }

        return context;
    }

    /**
     * Run the script with pagination, yielding results page by page
     * Each page contains only the new results for that page, not cumulative results
     * Uses a unified loop that handles both historical and live streaming data
     * @private
     */
    private async *_runPaginated(
        ind: Indicator,
        periods: number | undefined,
        pageSize: number,
        enableLiveStream: boolean = false,
    ): AsyncGenerator<Context> {
        await this.ready();
        if (!periods) periods = this.data.length;

        const prepared = ind.prepare(this._debugSettings);
        this._usesVisibleRange = prepared.usesVisibleRange;
        this._refreshBarMagnifierStatus(ind);

        const context = this._initializeContext(ind.source ?? null as any, prepared.inputs, this._isSecondaryContext);
        this._transpiledCode = prepared.fn;
        if (prepared.ltfSlices) (context as any)._ltfTruncatedBodies = prepared.ltfSlices;

        const startIdx = this.data.length - periods;
        let processedUpToIdx = startIdx; // Track what we've fully processed
        let varSnapshot: any = null; // Snapshot of var state before last bar processing

        // Unified loop handles both historical and live data
        while (true) {
            const availableData = this.data.length;
            const unprocessedCount = availableData - processedUpToIdx;

            // #1: If we have unprocessed data, process it
            if (unprocessedCount > 0) {
                const toProcess = Math.min(unprocessedCount, pageSize);
                const previousResultLength = this._getResultLength(context.result);

                // If this batch includes the last bar AND live streaming is enabled,
                // snapshot the state BEFORE processing the last bar so we can restore
                // it cleanly on streaming re-execution.
                const batchEnd = processedUpToIdx + toProcess;
                if (enableLiveStream && batchEnd >= availableData && toProcess > 1) {
                    // Process all bars except the last one
                    await this._executeIterations(context, this._transpiledCode, processedUpToIdx, batchEnd - 1);
                    // Snapshot state before the last bar
                    varSnapshot = this._snapshotVarState(context);
                    // Now process the last bar
                    await this._executeIterations(context, this._transpiledCode, batchEnd - 1, batchEnd);
                } else if (enableLiveStream && batchEnd >= availableData && toProcess === 1) {
                    // Usually the snapshot came from the preceding batch. A
                    // one-bar initial history has no preceding batch, so take
                    // its empty pre-forming snapshot here.
                    if (varSnapshot === null) {
                        varSnapshot = this._snapshotVarState(context);
                    }
                    await this._executeIterations(context, this._transpiledCode, processedUpToIdx, batchEnd);
                } else {
                    await this._executeIterations(context, this._transpiledCode, processedUpToIdx, batchEnd);
                }

                processedUpToIdx += toProcess;

                // Yield the page with new results
                const pageContext = this._createPageContext(context, previousResultLength);
                yield pageContext;
                continue;
            }

            // UNUSED — snapshot is now taken in #1 before processing the last bar

            // #2: Caught up to current data (processedUpToIdx === this.data.length)

            // If not live streaming, we're done
            if (!enableLiveStream || Array.isArray(this.source)) {
                break;
            }

            // #3: Fetch new data, always starting from last candle's openTime
            // Throttle: minimum 1 second between API fetches to prevent hammering
            const fetchStart = Date.now();
            const { newCandles, updatedLastCandle } = await this._updateMarketData();
            const fetchDuration = Date.now() - fetchStart;

            if (newCandles === 0 && !updatedLastCandle) {
                // No new data available, yield null to signal caller
                yield null as any;
                continue;
            }

            // If only the last candle was updated (no new bars), throttle to avoid
            // rapid-fire fetching when the market is closed or candle is still forming
            if (newCandles === 0 && updatedLastCandle && fetchDuration < 1000) {
                await new Promise((resolve) => setTimeout(resolve, 1000 - fetchDuration));
            }

            // #4: Data changed — bump version so secondary contexts know to refresh
            context.dataVersion++;

            // Update context.length so barstate.islast (which checks
            // context.idx === context.length - 1) works correctly for new bars.
            // Without this, barstate.islast stays false after new candles arrive,
            // and any `if barstate.islast` drawing logic never executes.
            context.length = this.data.length;

            // Restore variable state to the snapshot (before last bar was processed).
            // This is more reliable than _removeLastResult's pop-based approach for
            // var variables, which can drift when re-executing modifies values in-place.
            // _restoreVarState handles var/let/const/params Series truncation,
            // so we skip _removeLastResult (which would double-pop).
            this._restoreVarState(context, varSnapshot);

            // Still need to remove last result and market data series entries
            // (these are not covered by _restoreVarState)
            if (Array.isArray(context.result)) {
                context.result.pop();
            } else if (typeof context.result === 'object' && context.result !== null) {
                for (let key in context.result) {
                    if (Array.isArray(context.result[key])) {
                        context.result[key].pop();
                    }
                }
            }
            // Pop market data series (close, open, high, low, volume, etc.)
            context.data.close.data.pop();
            context.data.open.data.pop();
            context.data.high.data.pop();
            context.data.low.data.pop();
            context.data.volume.data.pop();
            context.data.hl2.data.pop();
            context.data.hlc3.data.pop();
            context.data.ohlc4.data.pop();
            context.data.hlcc4.data.pop();
            context.data.openTime.data.pop();
            if (context.data.closeTime) context.data.closeTime.data.pop();
            context.data.bar_index.data.pop();

            // Step back one position to reprocess last candle
            processedUpToIdx = this.data.length - (newCandles + 1);

            // Roll back drawing objects created during the previous processing of
            // these bars so they don't accumulate on each streaming tick.
            context.rollbackDrawings(processedUpToIdx);

            // If new candles arrived, invalidate snapshot (will re-snapshot after next full process)
            if (newCandles > 0) {
                varSnapshot = null;
            }

            // Next iteration of loop will process from updated position (#1)

            //barstate.isnew becomes false on live bars
            context.pine.barstate.setLive();
        }
    }

    /**
     * Get the length of the result (works for arrays and objects)
     * @private
     */
    private _getResultLength(result: any): number {
        if (Array.isArray(result)) {
            return result.length;
        } else if (typeof result === 'object' && result !== null) {
            const keys = Object.keys(result);
            if (keys.length > 0 && Array.isArray(result[keys[0]])) {
                return result[keys[0]].length;
            }
        }
        return 0;
    }

    /**
     * Create a context containing only the new results for the current page
     * @private
     */
    private _createPageContext(fullContext: Context, previousResultLength: number): Context {
        // console.log('_createPageContext fullContext.inputs keys:', fullContext.inputs ? Object.keys(fullContext.inputs) : 'undefined');
        const pageContext = new Context({
            marketData: this.data,
            source: this.source,
            tickerId: this.tickerId,
            timeframe: this.timeframe,
            limit: this.limit,
            sDate: this.sDate,
            eDate: this.eDate,
            fullContext,
            inputs: fullContext.inputs,
        });

        pageContext.pineTSCode = fullContext.pineTSCode;
        pageContext.idx = fullContext.idx;

        // Copy only the new results for this page
        if (Array.isArray(fullContext.result)) {
            pageContext.result = fullContext.result.slice(previousResultLength);
        } else if (typeof fullContext.result === 'object' && fullContext.result !== null) {
            pageContext.result = {};
            for (let key in fullContext.result) {
                if (Array.isArray(fullContext.result[key])) {
                    pageContext.result[key] = fullContext.result[key].slice(previousResultLength);
                } else {
                    pageContext.result[key] = fullContext.result[key];
                }
            }
        } else {
            pageContext.result = fullContext.result;
        }

        // Copy plots metadata
        pageContext.plots = { ...fullContext.plots };

        // Copy runtime warnings
        pageContext.warnings = fullContext.warnings;

        // Copy alert events
        pageContext.alerts = fullContext.alerts;

        return pageContext;
    }

    /**
     * Update market data from the last known candle to now (or eDate if provided)
     * Intelligently replaces the last candle if it's still open, or appends new candles
     * @param eDate - Optional end date, defaults to now
     * @returns Object containing: { newCandles: number, updatedLastCandle: boolean }
     * @private
     */
    private async _updateMarketData(eDate?: number): Promise<{ newCandles: number; updatedLastCandle: boolean }> {
        // Can only update if source is a Provider
        if (Array.isArray(this.source)) {
            return { newCandles: 0, updatedLastCandle: false };
        }

        const provider = this.source as IProvider;
        const lastCandleIdx = this.data.length - 1;
        const lastCandle = this.data[lastCandleIdx];
        const lastCandleOpenTime = lastCandle.openTime;

        try {
            // Fetch new data starting from the last candle's open time
            const newData = await provider.getMarketData(this.tickerId!, this.timeframe!, undefined, lastCandleOpenTime, eDate);

            if (!newData || newData.length === 0) {
                return { newCandles: 0, updatedLastCandle: false };
            }

            let updatedLastCandle = false;
            let newCandles = 0;

            // Process the fetched data
            for (let i = 0; i < newData.length; i++) {
                const candle = newData[i];

                // Check if this candle is an update to our last candle
                if (candle.openTime === lastCandleOpenTime) {
                    // Update the existing last candle
                    this._replaceCandle(lastCandleIdx, candle);
                    updatedLastCandle = true;
                } else if (candle.openTime > lastCandleOpenTime) {
                    // This is a new candle, append it
                    this._appendCandle(candle);
                    newCandles++;
                }
                // Skip candles with openTime < lastCandleOpenTime (shouldn't happen)
            }

            return { newCandles, updatedLastCandle };
        } catch (error) {
            console.error('Error updating market data:', error);
            return { newCandles: 0, updatedLastCandle: false };
        }
    }

    /**
     * Replace a candle at a specific index with new data
     * @private
     */
    private _replaceCandle(index: number, candle: any): void {
        this.data[index] = candle;
        this.open[index] = candle.open;
        this.close[index] = candle.close;
        this.high[index] = candle.high;
        this.low[index] = candle.low;
        this.volume[index] = candle.volume;
        this.hl2[index] = (candle.high + candle.low) / 2;
        this.hlc3[index] = (candle.high + candle.low + candle.close) / 3;
        this.ohlc4[index] = (candle.high + candle.low + candle.open + candle.close) / 4;
        this.hlcc4[index] = (candle.high + candle.low + candle.close + candle.close) / 4;
        this.openTime[index] = candle.openTime;
        this.closeTime[index] = candle.closeTime;
    }

    /**
     * Append a new candle to the end of market data arrays
     * @private
     */
    private _appendCandle(candle: any): void {
        this.data.push(candle);
        this.open.push(candle.open);
        this.close.push(candle.close);
        this.high.push(candle.high);
        this.low.push(candle.low);
        this.volume.push(candle.volume);
        this.hl2.push((candle.high + candle.low) / 2);
        this.hlc3.push((candle.high + candle.low + candle.close) / 3);
        this.ohlc4.push((candle.high + candle.low + candle.open + candle.close) / 4);
        this.hlcc4.push((candle.high + candle.low + candle.close + candle.close) / 4);
        this.openTime.push(candle.openTime);
        this.closeTime.push(candle.closeTime);
    }

    /**
     * Update the secondary context's tail with fresh market data.
     *
     * Uses snapshot-restore for reliable var state rollback, matching the
     * approach used by _runPaginated. The pop-based _removeLastResult is
     * only used as a fallback for contexts that have no snapshot (e.g. those
     * produced by runPretranspiled, which skips the split-execute pattern).
     *
     * After restoring state and re-executing, a fresh snapshot is taken before
     * the last bar so that subsequent updateTail() calls also have a valid
     * restore point.
     *
     * @param context - The cached secondary context to update
     * @returns true if data was updated, false if no changes
     */
    public async updateTail(context: Context): Promise<boolean> {
        // Guard: skip if no data (e.g. secondary context failed to load from provider)
        if (this.data.length === 0 || Array.isArray(this.source)) return false;

        const { newCandles, updatedLastCandle } = await this._updateMarketData();
        if (newCandles === 0 && !updatedLastCandle) return false;

        // Use snapshot-restore for reliable var state rollback.
        // _removeLastResult's pop-based approach drifts when re-executing
        // modifies var values in-place (see _runPaginated comment, line 591).
        const snapshot = (context as any)._varSnapshot;
        if (snapshot) {
            this._restoreVarState(context, snapshot);
        } else {
            // No snapshot available (context from runPretranspiled or single-bar
            // _runComplete) — fall back to pop-based rollback.
            this._removeLastResult(context);
        }

        // Pop result + market-data series.
        // _restoreVarState handles var/let/const/params Series but does NOT
        // cover result arrays or the market data series on context.data —
        // those must be popped explicitly here.
        if (Array.isArray(context.result)) {
            context.result.pop();
        } else if (typeof context.result === 'object' && context.result !== null) {
            for (let key in context.result) {
                if (Array.isArray(context.result[key])) {
                    context.result[key].pop();
                }
            }
        }

        context.data.close.data.pop();
        context.data.open.data.pop();
        context.data.high.data.pop();
        context.data.low.data.pop();
        context.data.volume.data.pop();
        context.data.hl2.data.pop();
        context.data.hlc3.data.pop();
        context.data.ohlc4.data.pop();
        context.data.hlcc4.data.pop();
        context.data.openTime.data.pop();
        if (context.data.closeTime) context.data.closeTime.data.pop();
        context.data.bar_index.data.pop();

        context.dataVersion = (context.dataVersion || 0) + 1;
        context.length = this.data.length;

        const processFrom = this.data.length - (newCandles + 1);
        context.rollbackDrawings(processFrom);

        // Split execution: process bars before last → snapshot → last bar.
        // Ensures the next updateTail() call has a fresh, valid restore point.
        const endIdx = this.data.length;

        if (processFrom < endIdx - 1) {
            // Multiple bars to re-execute: snapshot before the last one.
            await this._executeIterations(context, this._transpiledCode as Function, processFrom, endIdx - 1);
            (context as any)._varSnapshot = this._snapshotVarState(context);
            await this._executeIterations(context, this._transpiledCode as Function, endIdx - 1, endIdx);
        } else {
            // Only 1 bar to re-execute (same-bar tick update).
            // The existing snapshot remains valid as "before this bar" — no refresh needed.
            await this._executeIterations(context, this._transpiledCode as Function, processFrom, endIdx);
        }

        return true;
    }

    /**
     * Remove the last result from context (for updating an open candle)
     * @private
     */
    private _removeLastResult(context: Context): void {
        if (Array.isArray(context.result)) {
            context.result.pop();
        } else if (typeof context.result === 'object' && context.result !== null) {
            for (let key in context.result) {
                if (Array.isArray(context.result[key])) {
                    context.result[key].pop();
                }
            }
        }

        // Also remove from context.data arrays (last element = most recent in forward array)
        context.data.close.data.pop();
        context.data.open.data.pop();
        context.data.high.data.pop();
        context.data.low.data.pop();
        context.data.volume.data.pop();
        context.data.hl2.data.pop();
        context.data.hlc3.data.pop();
        context.data.ohlc4.data.pop();
        context.data.hlcc4.data.pop();
        context.data.openTime.data.pop();
        if (context.data.closeTime) {
            context.data.closeTime.data.pop();
        }
        context.data.bar_index.data.pop();

        // Fix: Rollback context variables (let, var, const, params)
        const contextVarNames = ['const', 'var', 'let', 'params'];
        const rollbackVariables = (container: any) => {
            for (let ctxVarName of contextVarNames) {
                if (!container[ctxVarName]) continue;
                for (let key in container[ctxVarName]) {
                    const item = container[ctxVarName][key];
                    if (item instanceof Series) {
                        item.data.pop();
                    } else if (Array.isArray(item)) {
                        item.pop();
                    }
                }
            }
        };

        rollbackVariables(context);
        if (context.lctx) {
            context.lctx.forEach((lctx: any) => rollbackVariables(lctx));
        }
    }

    /**
     * Snapshot the var/let/const/params Series state — plus the strategy
     * ledger, via snapshotStrategyState — for streaming rollback.
     * Captures the data array length and last value for each variable so we can
     * restore to this exact state before re-executing the last bar.
     *
     * PERF NOTE: This currently snapshots ALL scopes (const, var, let, params).
     * In practice, only `var` variables need snapshot/restore because:
     *   - `let` variables are re-initialized every bar via $.init() — they reset naturally
     *   - `const` variables are set once and never modified
     *   - `params` are function parameters, not modified across bars
     * Only `var` variables persist and get modified in-place by $.set() (e.g. n += 1),
     * which causes drift on streaming re-execution.
     * If this becomes a bottleneck, narrow to `['var']` only.
     *
     * An even lighter alternative: make $.set() on var Series append-only (push
     * instead of in-place modify). Then the existing pop-based _removeLastResult
     * would correctly revert var state without any snapshot. This would require
     * changes to the core Series/set mechanics.
     *
     * @private
     */
    private _snapshotVarState(context: Context): any {
        const contextVarNames = ['const', 'var', 'let', 'params'];
        const snapshot: any = { main: {}, lctx: [] };

        const snapContainer = (container: any) => {
            const snap: any = { __keys: {} };
            for (const ctxVarName of contextVarNames) {
                if (!container[ctxVarName]) continue;
                snap[ctxVarName] = {};
                snap.__keys[ctxVarName] = Object.keys(container[ctxVarName]);
                for (const key in container[ctxVarName]) {
                    const item = container[ctxVarName][key];
                    if (item instanceof Series) {
                        // Save length AND the last value so we can restore both
                        const len = item.data.length;
                        const lastVal = len > 0 ? item.data[len - 1] : undefined;
                        snap[ctxVarName][key] = { len, lastVal };
                    }
                }
            }
            return snap;
        };

        snapshot.main = snapContainer(context);
        if (context.lctx) {
            const lctxSnaps: any[] = [];
            context.lctx.forEach((lctx: any) => lctxSnaps.push(snapContainer(lctx)));
            snapshot.lctx = lctxSnaps;
            snapshot.lctxKeys = Array.from(context.lctx.keys());
        }

        // Strategy ledger (pending_orders / opentrades / position / equity /
        // peaks). Without this, orders queued by a discarded execution of the
        // forming bar survive the rollback and fill as duplicates on the next
        // bar. Null for indicator contexts.
        snapshot.strategy = snapshotStrategyState(context.strategy);
        snapshot.strategyPresent = context.strategy !== undefined;

        // Also snapshot result and data array lengths
        snapshot.resultLength = this._getResultLength(context.result);
        snapshot.dataLength = context.data.close?.data?.length ?? 0;

        return snapshot;
    }

    /**
     * Restore var/let/const/params Series state from a snapshot.
     * Truncates each Series' data array back to the snapshotted length.
     * @private
     */
    private _restoreVarState(context: Context, snapshot: any): void {
        if (!snapshot) return;
        const contextVarNames = ['const', 'var', 'let', 'params'];

        const restoreContainer = (container: any, snap: any) => {
            for (const ctxVarName of contextVarNames) {
                if (!container[ctxVarName]) continue;

                // Declarations first encountered while evaluating the
                // discarded forming bar are not represented in the snapshot.
                // Remove those keys before replaying the bar, including for a
                // one-bar history whose pre-bar buckets were entirely empty.
                const snapKeys = new Set<string>(snap.__keys?.[ctxVarName] ?? Object.keys(snap[ctxVarName] ?? {}));
                for (const key of Object.keys(container[ctxVarName])) {
                    if (!snapKeys.has(key)) delete container[ctxVarName][key];
                }

                if (!snap[ctxVarName]) continue;
                for (const key in snap[ctxVarName]) {
                    const item = container[ctxVarName][key];
                    const snapInfo = snap[ctxVarName][key];
                    if (item instanceof Series && snapInfo && typeof snapInfo.len === 'number') {
                        // Truncate back to snapshot length
                        if (item.data.length > snapInfo.len) {
                            item.data.length = snapInfo.len;
                        }
                        // Restore the last value (which may have been modified in-place)
                        if (snapInfo.len > 0 && snapInfo.lastVal !== undefined) {
                            item.data[snapInfo.len - 1] = snapInfo.lastVal;
                        }
                    }
                }
            }
        };

        restoreContainer(context, snapshot.main);
        if (context.lctx && snapshot.lctx) {
            if (snapshot.lctxKeys) {
                const existingKeys = new Set(snapshot.lctxKeys);
                for (const key of context.lctx.keys()) {
                    if (!existingKeys.has(key)) context.lctx.delete(key);
                }
            }
            let i = 0;
            context.lctx.forEach((lctx: any) => {
                if (snapshot.lctx[i]) restoreContainer(lctx, snapshot.lctx[i]);
                i++;
            });
        }

        // Roll the strategy ledger back to its pre-last-bar state (no-op for
        // indicators). Mutates context.strategy in place — its identity is
        // public API.
        if (snapshot.strategyPresent === false) {
            context.strategy = undefined;
        } else {
            restoreStrategyState(context.strategy, snapshot.strategy);
        }
    }

    /**
     * Initialize a new context for running Pine Script code
     * @private
     */
    private _initializeContext(pineTSCode: Function | String, inputs: Record<string, any> = {}, isSecondary: boolean = false): Context {
        const context = new Context({
            marketData: this.data,
            source: this.source,
            tickerId: this.tickerId,
            timeframe: this.timeframe,
            limit: this.limit,
            sDate: this.sDate,
            eDate: this.eDate,
            inputs,
        });

        context.pine.syminfo = this._syminfo;
        // THE CHART TYPE IS THE TICKER (single source of truth): a non-standard chart is
        // addressed by an extended ticker — `new PineTS(source, "SYM;heikinashi", …)` — so
        // the data source can distinguish the chart series from standard-data requests.
        // Everything else derives from that modifier here: `context.chartStyle` (behind
        // `chart.is_*`) and the `syminfo.tickerid` suffix (a CLONE — the provider's cached
        // syminfo object, which is always modifier-free since providers strip, must stay
        // untouched). PineTS never transforms bars: the source of an extended ticker is
        // expected to serve the chart-type view already.
        const chartModifier = splitTickerModifier(String(this.tickerId ?? '')).modifier;
        context.chartStyle = chartModifier === 'heikinashi' ? 'heikinashi' : 'standard';
        if (this._syminfo && chartModifier === 'heikinashi') {
            context.pine.syminfo = {
                ...this._syminfo,
                tickerid: withTickerModifier(String(this._syminfo.tickerid ?? this.tickerId), 'heikinashi'),
            };
        }
        // Chart timezone only affects display formatting (log timestamps).
        // It does NOT override syminfo.timezone, which drives computation
        // (timestamp(), hour, dayofmonth, time_tradingday, etc.).
        if (this._chartTimezone) {
            context.chartTimezone = this._chartTimezone;
        }
        // Host-bound viewport overrides (chart.left/right_visible_bar_time).
        // Undefined values mean "use marketData-derived defaults" — see ChartHelper.
        context.viewportLeft = this._viewportLeft;
        context.viewportRight = this._viewportRight;

        context.__maxLoops = this._maxLoops;
        context._alertMode = this._alertMode;
        context.executionPrecision = this._barMagnifierStatus;

        // User-explicit prop overrides flow from the Indicator to the runtime.
        // Read by Core.indicator() and initializeStrategy/strategy.any() to
        // merge on top of source-code declaration args.
        context._propOverrides = this._currentIndicator?.getRuntimePropOverrides() ?? {};

        context.pineTSCode = pineTSCode;
        context.isSecondaryContext = isSecondary; // Set secondary context flag
        context.data.close = new Series([]);
        context.data.open = new Series([]);
        context.data.high = new Series([]);
        context.data.low = new Series([]);
        context.data.volume = new Series([]);
        context.data.hl2 = new Series([]);
        context.data.hlc3 = new Series([]);
        context.data.ohlc4 = new Series([]);
        context.data.hlcc4 = new Series([]);
        context.data.openTime = new Series([]);
        context.data.closeTime = new Series([]);

        context.length = this.data.length;

        return context;
    }

    /** Return lower bars belonging to one parent chart bar, in feed order. */
    private _lowerBarsForParent(parentIndex: number): readonly BrokerBar[] {
        if (!this._barMagnifierStatus.applied) return [];
        const parent = this.data[parentIndex] as BrokerBar | undefined;
        if (!parent) return [];
        const next = this.data[parentIndex + 1] as BrokerBar | undefined;
        const window = barWindow(
            parent,
            next?.openTime,
            getTimeframeDurationMs(this.timeframe),
            true,
        );
        if (!window) return [];
        const end = window.end;
        // `_barMagnifierBars` has already passed the monotonicity check in
        // resolveBarMagnifierStatus.  Binary bounds keep a long backtest at
        // O(parentBars * log(childBars) + childBars), rather than filtering
        // the complete lower feed for every parent bar.
        const start = lowerBoundBars(this._barMagnifierBars, Number(parent.openTime));
        const finish = lowerBoundBars(this._barMagnifierBars, end);
        const childDuration = getTimeframeDurationMs(this._barMagnifierStatus.lowerTimeframe);
        return this._barMagnifierBars.slice(start, finish).filter((child) => {
            const childWindow = barWindow(child, undefined, childDuration);
            return childWindow !== null
                && childWindow.start >= window.start
                && childWindow.end <= window.end
                && childWindow.end - childWindow.start === childDuration;
        });
    }

    /**
     * Broker helpers read the current bar through `context.data.*`.  During a
     * magnified parent bar we temporarily expose one child OHLC snapshot to
     * those helpers, then restore the parent values before Pine evaluates its
     * script body.  No script-visible series is appended or shifted here.
     */
    private _withBrokerBar(context: any, bar: BrokerBar, fn: () => void): void {
        const keys = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'openTime', 'closeTime'];
        const previous: Record<string, unknown> = {};
        const latest = (key: string): any[] | undefined => context.data?.[key]?.data;
        for (const key of keys) {
            const data = latest(key);
            if (data && data.length > 0) previous[key] = data[data.length - 1];
        }
        const write = (key: string, value: unknown): void => {
            const data = latest(key);
            if (data && data.length > 0) data[data.length - 1] = value;
        };
        write('open', bar.open);
        write('high', bar.high);
        write('low', bar.low);
        write('close', bar.close);
        write('volume', bar.volume ?? 0);
        write('hl2', (bar.high + bar.low) / 2);
        write('hlc3', (bar.high + bar.low + bar.close) / 3);
        write('ohlc4', (bar.high + bar.low + bar.open + bar.close) / 4);
        write('hlcc4', (bar.high + bar.low + bar.close + bar.close) / 4);
        write('openTime', bar.openTime);
        if (bar.closeTime !== undefined) write('closeTime', bar.closeTime);
        try {
            fn();
        } finally {
            for (const [key, value] of Object.entries(previous)) write(key, value);
        }
    }

    /**
     * Replay one lower-timeframe candle along TradingView's four-point path:
     * `open → high → low → close` when the open is nearer the high, otherwise
     * `open → low → high → close`. A whole-child broker call only sees the
     * extrema and can therefore lose TP/SL ordering inside that child. These
     * synthetic point bars reuse the existing broker state machine while
     * making each crossing observable in sequence. All points retain the
     * child's open timestamp because the feed has no intra-candle timestamps.
     */
    private async _processMagnifiedChild(
        context: any,
        child: BrokerBar,
        transpiledFn?: Function,
    ): Promise<void> {
        const open = child.open;
        const highFirst = Math.abs(child.high - open) <= Math.abs(open - child.low);
        const prices = highFirst
            ? [open, child.high, child.low, child.close]
            : [open, child.low, child.high, child.close];

        for (const [pointIndex, price] of prices.entries()) {
            const previousPrice = pointIndex === 0 ? price : prices[pointIndex - 1]!;
            const point: BrokerBar = {
                openTime: child.openTime,
                ...(child.closeTime == null ? {} : { closeTime: child.closeTime }),
                // Each synthetic point describes the segment from the prior
                // point to this one. Keeping the segment's true open is
                // important for gap-fill semantics: a stop crossed on the
                // way from 100 to 94 fills at 95, not at the synthetic point's
                // terminal 94.
                open: previousPrice,
                high: Math.max(previousPrice, price),
                low: Math.min(previousPrice, price),
                close: price,
                ...(child.volume == null ? {} : { volume: child.volume }),
            };
            await this._withBrokerBarAsync(context, point, async () => {
                const positionBefore = Number(context.strategy?.position_size ?? 0);
                context._barMagnifierPointPhase = pointIndex === 0 ? 'open' : 'path';
                // Keep the actually-travelled segment available to the
                // broker while it executes fills.  A position can be flat by
                // the time the post-pass checkpoint below runs; exit handling
                // then uses this start (or a same-segment entry fill) to latch
                // the last reachable pre-exit equity range first.
                context._barMagnifierSegmentStart = previousPrice;
                delete context._barMagnifierExecutionRange;
                delete context._barMagnifierTradeExecutionRanges;
                delete context._barMagnifierPositionTransitionFillPrice;
                // Market orders fill only at the child open; stop/limit orders
                // remain eligible at every synthetic path point.
                const orderPass = processStrategyOrders(context, pointIndex === 0 ? 'open' : 'path', true);

                // A lower-timeframe point is the only historical equivalent
                // of a realtime tick available to this broker.  Re-run the
                // script after fills when requested, and on every simulated
                // point when calc_on_every_tick=true.  The callback intentionally
                // does not append a report/result row; the parent-bar pass
                // below remains the sole public series cardinality.
                const filledAfterEntryPass = this._strategyFillCount(context) > (context._strategyFillCursor ?? 0);
                if (transpiledFn && context.strategy?.config?.calc_on_every_tick === true) {
                    await this._runStrategyRecalcPass(context, transpiledFn, 'every_tick');
                }
                if (transpiledFn && context.strategy?.config?.calc_on_order_fills === true && filledAfterEntryPass) {
                    await this._runStrategyRecalcPass(context, transpiledFn, 'order_fill');
                }
                context._strategyFillCursor = this._strategyFillCount(context);

                if (Number.isFinite(orderPass.positionTransitionFillPrice)) {
                    context._barMagnifierPositionTransitionFillPrice = orderPass.positionTransitionFillPrice;
                }

                // A fill on a path segment can happen after its first
                // endpoint. Restrict exit evaluation and the equity range for
                // newly-created lots to the reachable suffix of that segment.
                // Existing lots still see the complete segment in their own
                // bracket/excursion calculations.
                if (orderPass.newTradeIds && orderPass.newTradeIds.length > 0) {
                    const opened = context.strategy?.opentrades?.find((trade: any) =>
                        orderPass.newTradeIds!.includes(trade.id),
                    );
                    const fillPrice = Number(opened?.entry_price ?? orderPass.positionTransitionFillPrice ?? price);
                    context._barMagnifierExecutionRange = {
                        high: Math.max(fillPrice, price),
                        low: Math.min(fillPrice, price),
                    };
                }
                if (orderPass.newTradeExecutionRanges && orderPass.newTradeExecutionRanges.length > 0) {
                    context._barMagnifierTradeExecutionRanges = new Map(
                        orderPass.newTradeExecutionRanges.map(({ tradeId, high, low }) => [tradeId, { high, low }]),
                    );
                }

                if (pointIndex === 0) {
                    // Preserve exits that were queued before a pending entry
                    // becomes live. The broker's explicit open phase keeps a
                    // waiting bracket alive when there is no matching trade
                    // yet, while also handling a genuine gap on the child
                    // open before new entries are admitted.
                    processExitOrders(context, 'open');
                    processMarginCall(context, 'open');
                    processExitOrders(context, 'intrabar');
                } else {
                    const direction = Math.sign(context.strategy?.position_size ?? 0);
                    const isAdversePoint = direction !== 0 && (
                        direction === 1 ? pointIndex === (highFirst ? 2 : 1) : pointIndex === (highFirst ? 1 : 2)
                    );
                    // On a favorable-first path exits free margin before the
                    // adverse checkpoint; on an adverse-first path it is reversed.
                    const previous = prices[pointIndex - 1]!;
                    context._barMagnifierPathDirection = price > previous ? 'up' : price < previous ? 'down' : 'flat';
                    try {
                        if (isAdversePoint) processMarginCall(context, 'extreme');
                        processExitOrders(context, 'intrabar');
                    } finally {
                        delete context._barMagnifierPathDirection;
                    }
                }

                // Exit and margin processing can create additional fills at
                // this point.  A calc_on_order_fills pass observes those
                // fills immediately; newly queued orders are eligible on the
                // next simulated point (or the explicit close pass), matching
                // broker causality and avoiding retroactive fills.
                const filledAfterExitPass = this._strategyFillCount(context) > (context._strategyFillCursor ?? 0);
                if (transpiledFn && context.strategy?.config?.calc_on_order_fills === true && filledAfterExitPass) {
                    await this._runStrategyRecalcPass(context, transpiledFn, 'order_fill');
                }
                context._strategyFillCursor = this._strategyFillCount(context);

                // Latch only the range observable while the surviving
                // position was live. Doing this at each path segment retains
                // a real favorable/adverse excursion even if a later child
                // closes the position and the parent finishes flat.
                const positionAfter = Number(context.strategy?.position_size ?? 0);
                if (positionAfter !== 0) {
                    const range = context._barMagnifierExecutionRange as { high: number; low: number } | undefined;
                    const positionTransitioned = Math.sign(positionBefore) !== Math.sign(positionAfter);
                    const observed = positionTransitioned && range
                        ? range
                        : { high: point.high, low: point.low };
                    checkpointStrategyExecutionRange(context, observed, price);
                }

                delete context._barMagnifierPointPhase;
                delete context._barMagnifierSegmentStart;
                delete context._barMagnifierExecutionRange;
                delete context._barMagnifierTradeExecutionRanges;
                delete context._barMagnifierPositionTransitionFillPrice;
            });
        }
    }

    /** Execute the existing broker state machine over all child bars. */
    private async _processMagnifiedStrategyBar(
        context: any,
        children: readonly BrokerBar[],
        transpiledFn?: Function,
    ): Promise<void> {
        // A deferred close margin call is booked at the beginning of the next
        // parent bar.  It must run once, before the first child entry phase.
        applyPendingCloseMarginCall(context);
        for (const child of children) {
            await this._processMagnifiedChild(context, child, transpiledFn);
        }
        // The report/equity point remains parent-bar based.  This preserves
        // the existing public series cardinality while fills carry the child
        // timestamp and the parent `bar_index`.
        const parentClose = Number(Series.from(context.data.close).get(0));
        finalizeStrategyBar(context, { high: parentClose, low: parentClose });
    }

    /** Number of actual broker fills recorded by the internal ledger. */
    private _strategyFillCount(context: any): number {
        const fills = context?.strategy?._fill_events;
        return Array.isArray(fills) ? fills.length : 0;
    }

    /**
     * Execute one same-parent-bar strategy recalculation.  Its return value is
     * intentionally ignored: only the normal parent-bar invocation publishes
     * plot/result rows, while side effects (orders, exits, drawings and var
     * state) remain visible to subsequent broker points.
     */
    private async _runStrategyRecalcPass(
        context: any,
        transpiledFn: Function,
        reason: 'order_fill' | 'every_tick',
    ): Promise<void> {
        // Plot helpers append a point immediately.  Recalculation passes are
        // broker-internal and must not inflate the public parent-bar series;
        // the ordinary invocation at the end of the parent bar publishes the
        // one canonical point.  Keep metadata for existing plots, discard
        // appended points, and remove plots created only by a transient pass.
        const plotKeys = new Set(Object.keys(context.plots ?? {}));
        const plotLengths = new Map<string, number>();
        for (const [key, plot] of Object.entries(context.plots ?? {})) {
            if (plot && typeof plot === 'object' && Array.isArray((plot as any).data)) {
                plotLengths.set(key, (plot as any).data.length);
            }
        }
        context._strategyRecalcReason = reason;
        context._strategyRecalcPass = Number(context._strategyRecalcPass ?? 0) + 1;
        try {
            await transpiledFn(context);
        } finally {
            for (const key of Object.keys(context.plots ?? {})) {
                if (!plotKeys.has(key)) {
                    delete context.plots[key];
                    continue;
                }
                const plot = context.plots[key];
                const length = plotLengths.get(key);
                if (length !== undefined && plot && typeof plot === 'object' && Array.isArray(plot.data)) {
                    plot.data.length = length;
                }
            }
            delete context._strategyRecalcReason;
        }
    }

    /** Async counterpart of the existing broker-bar swap helper. */
    private async _withBrokerBarAsync(context: any, bar: BrokerBar, fn: () => Promise<void>): Promise<void> {
        const keys = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'openTime', 'closeTime'];
        const previous: Record<string, unknown> = {};
        const latest = (key: string): any[] | undefined => context.data?.[key]?.data;
        for (const key of keys) {
            const data = latest(key);
            if (data && data.length > 0) previous[key] = data[data.length - 1];
        }
        const write = (key: string, value: unknown): void => {
            const data = latest(key);
            if (data && data.length > 0) data[data.length - 1] = value;
        };
        write('open', bar.open);
        write('high', bar.high);
        write('low', bar.low);
        write('close', bar.close);
        write('volume', bar.volume ?? 0);
        write('hl2', (bar.high + bar.low) / 2);
        write('hlc3', (bar.high + bar.low + bar.close) / 3);
        write('ohlc4', (bar.high + bar.low + bar.open + bar.close) / 4);
        write('hlcc4', (bar.high + bar.low + bar.close + bar.close) / 4);
        write('openTime', bar.openTime);
        if (bar.closeTime !== undefined) write('closeTime', bar.closeTime);
        try {
            await fn();
        } finally {
            for (const [key, value] of Object.entries(previous)) write(key, value);
        }
    }

    /** Keep direct PineTS callers truthful when no host envelope was supplied. */
    private _syncStrategyPrecision(context: any): void {
        // An explicit host envelope is authoritative even when it disables the
        // feature.  Without this guard a reusable PineTS instance receiving
        // `{ requested: false, ... }` would see the script declaration on the
        // first execution and silently flip the public status back to a
        // requested fallback, making an intentional host opt-out look enabled.
        if (this._barMagnifierInput?.requested !== undefined) return;
        const requested = context.strategy?.config?.use_bar_magnifier === true;
        if (!requested || this._barMagnifierStatus.requested) return;
        this._barMagnifierStatus = precisionStatus(
            true,
            false,
            undefined,
            this.data.length,
            this._barMagnifierBars.length,
            0,
            'lower-data-unavailable',
        );
        context.executionPrecision = this._barMagnifierStatus;
    }

    /**
     * Recompute precision metadata for the current script before execution.
     * PineTS instances are reusable: callers may run a second Indicator with
     * a different `use_bar_magnifier` declaration (or mutate `.prop`). A
     * constructor-level status would otherwise leak the previous run's
     * applied lower-timeframe mode into the new context and broker path.
     */
    private _refreshBarMagnifierStatus(ind: Indicator): void {
        let declarationRequested = false;
        try {
            declarationRequested = ind.getDeclarationType() === 'strategy'
                && ind.prop.use_bar_magnifier === true;
        } catch {
            // JS callbacks and malformed declarations have no readable prop;
            // they remain on the explicit host request (if any) or default off.
        }

        const explicitRequested = this._barMagnifierInput?.requested;
        const requested = explicitRequested ?? declarationRequested;
        const input: BarMagnifierInput = {
            ...(this._barMagnifierInput ?? {}),
            requested,
        };
        const computed = resolveBarMagnifierStatus(
            input,
            this.data as BrokerBar[],
            this._barMagnifierBars,
            this.timeframe,
        );

        // A host transport failure can be more specific than the local empty
        // array (for example a rejected network fetch). Preserve that reason
        // only while the current run still requested magnification; never let
        // it survive a subsequent run that explicitly disabled the feature.
        const hostReason = requested ? this._barMagnifierHostStatus?.fallbackReason : undefined;
        const preserveHostReason = hostReason !== undefined
            && (computed.fallbackReason === 'lower-data-empty'
                || computed.fallbackReason === 'lower-data-unavailable'
                || computed.fallbackReason === 'lower-timeframe-undetermined');
        this._barMagnifierStatus = {
            ...computed,
            ...(preserveHostReason ? { fallbackReason: hostReason } : {}),
        };
    }

    /**
     * Execute iterations from startIdx to endIdx, updating the context
     * @private
     */
    private async _executeIterations(context: Context, transpiledFn: Function, startIdx: number, endIdx: number): Promise<void> {
        const contextVarNames = ['const', 'var', 'let', 'params'];

        for (let i = startIdx; i < endIdx; i++) {
            context.idx = i;
            context._execTick = (context._execTick || 0) + 1;

            context.data.close.data.push(this.close[i]);
            context.data.open.data.push(this.open[i]);
            context.data.high.data.push(this.high[i]);
            context.data.low.data.push(this.low[i]);
            context.data.volume.data.push(this.volume[i]);
            context.data.hl2.data.push(this.hl2[i]);
            context.data.hlc3.data.push(this.hlc3[i]);
            context.data.ohlc4.data.push(this.ohlc4[i]);
            context.data.hlcc4.data.push(this.hlcc4[i]);
            context.data.openTime.data.push(this.openTime[i]);
            context.data.closeTime.data.push(this.closeTime[i]);
            context.data.bar_index.data.push(i);

            // Process strategy orders at the START of the bar (filling at Open).
            // Entry-category orders fill first (market/limit/stop pending
            // orders), then exit-category orders evaluate against the bar's
            // open/high/low — so an exit gap-firing at the open covers trades
            // that filled at that same open (entry-first precedence). TV
            // evidence is majority-but-not-unanimous here: 3 of 4 gap events
            // in the QA pyramiding xlsx (2021-02-24, 2021-09-08, 2024-02-29)
            // catch the same-open entry; one (2024-03-21) spares it. The
            // 'open' phase of processExitOrders implements the minority
            // (exit-first) semantics and is currently not wired in.
            const hadStrategy = context.strategy !== undefined;
            if (hadStrategy) {
                // Book a second margin call scheduled on the PREVIOUS bar
                // by the phantom re-check (it fills at that bar's close,
                // after its script evaluation — see processMarginCall and
                // applyPendingCloseMarginCall). Must run before entries so
                // a reversal queued at that close (qty frozen at queue
                // time) overshoots by exactly the deferred quantity, as TV
                // does.
                const children = this._lowerBarsForParent(i);
                if (this._barMagnifierStatus.applied && children.length > 0) {
                    // Pass the script callback so the lower-timeframe broker
                    // can honor calc_on_order_fills/calc_on_every_tick without
                    // publishing duplicate parent-bar result points.
                    context._strategyFillCursor = this._strategyFillCount(context);
                    await this._processMagnifiedStrategyBar(context, children, transpiledFn);
                    delete context._strategyFillCursor;
                } else {
                    // Chart-OHLC/default path. Keep the existing ordering
                    // unchanged when no valid child feed is applied.
                    applyPendingCloseMarginCall(context);
                    context._strategyFillCursor = this._strategyFillCount(context);
                    processStrategyOrders(context);
                    processMarginCall(context, 'open');
                    const adverseFirst = isAdverseFirstBar(context);
                    if (adverseFirst) processMarginCall(context, 'extreme');
                    processExitOrders(context, 'intrabar');
                    if (!adverseFirst) processMarginCall(context, 'extreme');

                    // Historical chart-OHLC has no lower-timeframe points to
                    // replay, but calc_on_order_fills still needs to expose a
                    // post-fill script pass.  Orders queued by this pass are
                    // intentionally deferred to the next broker opportunity
                    // (or to process_orders_on_close below); there is no
                    // retroactive price point in the chart bar.
                    if (transpiledFn
                        && context.strategy?.config?.calc_on_order_fills === true
                        && this._strategyFillCount(context) > context._strategyFillCursor) {
                        await this._runStrategyRecalcPass(context, transpiledFn, 'order_fill');
                    }
                    finalizeStrategyBar(context);
                    delete context._strategyFillCursor;
                }
            }

            const result = await transpiledFn(context);

            // Pine's `process_orders_on_close` adds a single broker pass after
            // the script has evaluated the current bar. `strategy.close()` /
            // `close_all()` with `immediately=true` request the same close
            // execution even when the declaration flag is false. Keep the
            // ordinary next-bar market-order contract untouched in both
            // cases. Entry orders are included in the pass only for the
            // declaration-level option; an immediate close by itself must not
            // turn a same-bar entry into a close-priced fill.
            let finalizedAfterClosePass = false;
            const processOrdersOnClose = context.strategy?.config?.process_orders_on_close === true;
            const hasImmediateClose = context.strategy?.pending_orders?.some((order: any) =>
                order.status === 'pending'
                && (order.category ?? 'entry') === 'exit'
                && order.immediately === true
                && order.bar === context.idx,
            ) === true;
            if (processOrdersOnClose || hasImmediateClose) {
                // Keep the close pass in the same fill-observation contract as
                // lower-timeframe and chart-OHLC broker passes. A strategy
                // using both process_orders_on_close and calc_on_order_fills
                // must be able to observe a fill made at the current close and
                // queue its follow-up order from that recalculation. The
                // follow-up is intentionally deferred to the next broker
                // opportunity; this close pass remains single-shot.
                const closeFillCursor = this._strategyFillCount(context);
                if (processOrdersOnClose) processStrategyOrders(context, 'close');
                processExitOrders(context, 'close');
                if (transpiledFn
                    && context.strategy?.config?.calc_on_order_fills === true
                    && this._strategyFillCount(context) > closeFillCursor) {
                    await this._runStrategyRecalcPass(context, transpiledFn, 'order_fill');
                }
                // The normal broker pass finalizes a parent-bar report before
                // the script body.  A close pass can change realized/open P&L
                // on that same bar, so replace the current report tail after
                // the close fills instead of leaving a stale equity snapshot.
                finalizeStrategyBar(context);
                finalizedAfterClosePass = true;
            }

            // Direct PineTS callers may omit the host request envelope. Once
            // strategy() executes, expose the request but keep the fallback
            // explicit because no lower-timeframe feed was supplied.
            this._syncStrategyPrecision(context);

            // The very first strategy() call happens inside transpiledFn, so
            // there was no strategy state to finalize in the pre-script phase
            // above. Add exactly one initial-capital report point for that
            // declaration bar. All later bars retain the established
            // pre-script broker/finalize ordering.
            if (!hadStrategy && context.strategy && !finalizedAfterClosePass) {
                finalizeStrategyBar(context);
            }

            //collect results
            if (typeof result === 'object') {
                if (typeof context.result !== 'object') {
                    context.result = {};
                }
                for (let key in result) {
                    if (context.result[key] === undefined) {
                        context.result[key] = [];
                    }

                    let val;
                    if (result[key] instanceof Series) {
                        val = result[key].get(0);
                    } else if (Array.isArray(result[key])) {
                        val = result[key][result[key].length - 1];
                    } else {
                        val = result[key];
                    }

                    context.result[key].push(val);
                }
            } else {
                if (!Array.isArray(context.result)) {
                    context.result = [];
                }

                context.result.push(result);
            }

            // Sync drawing object plots after all mutations for this bar.
            // Serializes the current state of labels/lines/boxes/etc. into plain objects
            // so that context.plots contains safe, JSON-serializable data.
            for (const helper of context._drawingHelpers) {
                if (helper.syncToPlot) helper.syncToPlot();
            }

            //shift context
            const shiftVariables = (container: any) => {
                for (let ctxVarName of contextVarNames) {
                    if (!container[ctxVarName]) continue;
                    for (let key in container[ctxVarName]) {
                        const item = container[ctxVarName][key];

                        if (item instanceof Series) {
                            const val = item.get(0);
                            item.data.push(val);
                        } else if (Array.isArray(item)) {
                            // Legacy array support during transition
                            const val = item[item.length - 1];
                            item.push(val);
                        }
                    }
                }
            };

            shiftVariables(context);
            if (context.lctx) {
                context.lctx.forEach((lctx: any) => shiftVariables(lctx));
            }
        }

        // End-of-run: compute the risk-adjusted performance ratios
        // (Sharpe / Sortino) from the monthly equity curve accumulated
        // across the bar loop. Runs once, after the last bar.
        if (context.strategy) {
            finalizeStrategyRun(context);
        }
    }
}

export default PineTS;
