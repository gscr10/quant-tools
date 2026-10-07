// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * The price-resolution used by the broker emulator for a run.
 *
 * `use_bar_magnifier` is a request, not proof that a lower-timeframe feed was
 * available.  Keeping the request and the applied mode in separate fields is
 * deliberate: a host can show a truthful fallback instead of inferring it from
 * the Pine declaration.
 */
export type ExecutionPrecision = 'chart-ohlc' | 'lower-timeframe' | 'tick';

export type BarMagnifierFallbackReason =
    | 'not-requested'
    | 'live-mode-not-supported'
    | 'lower-timeframe-undetermined'
    | 'lower-data-unavailable'
    | 'lower-data-empty'
    | 'invalid-parent-bars'
    | 'duplicate-parent-bars'
    | 'overlapping-parent-bars'
    | 'invalid-lower-bars'
    | 'duplicate-lower-bars'
    | 'overlapping-lower-bars'
    | 'unaligned-lower-bars'
    | 'gapped-lower-bars'
    | 'out-of-range-lower-bars'
    | 'partial-lower-coverage'
    | 'forming-lower-bar';

/** Immutable, serializable status attached to a PineTS run context. */
export interface BarMagnifierStatus {
    /** The script/host requested `use_bar_magnifier=true`. */
    readonly requested: boolean;
    /** The mode actually used by the broker emulator. */
    readonly applied: boolean;
    readonly requestedPrecision: ExecutionPrecision;
    readonly appliedPrecision: ExecutionPrecision;
    readonly lowerTimeframe?: string;
    readonly parentBars: number;
    readonly lowerBars: number;
    /**
     * Parent bars whose complete replay contract is satisfied. For a
     * non-divisible mapping (for example 15m -> 2m), a parent is covered when
     * all floor(parent/child) fully-contained candles are present and the
     * unavoidable remainder exists only at the parent edges.
     */
    readonly coveredParentBars: number;
    /** `coveredParentBars / parentBars`; this is not wall-clock coverage. */
    readonly coverage: number;
    readonly fallbackReason?: BarMagnifierFallbackReason;
}

/**
 * Optional execution input accepted by the local PineTS fork.  The public Vela
 * request remains backwards compatible; Vela-PineTS transports this envelope
 * when a caller supplies it, and otherwise resolves lower bars through its
 * existing `fetchSeries` gateway.
 */
export interface BarMagnifierInput {
    readonly requested?: boolean;
    readonly lowerTimeframe?: string;
    /**
     * Snapshot time in epoch milliseconds, captured before fetching children.
     * A child ending after this instant is still forming for this run even if
     * the network response arrives after its close. Omit for timeless offline
     * inputs; Vela-PineTS supplies the execution request's current timestamp.
     */
    readonly asOf?: number;
    readonly bars?: readonly {
        readonly openTime: number;
        readonly closeTime?: number;
        readonly open: number;
        readonly high: number;
        readonly low: number;
        readonly close: number;
        readonly volume?: number;
    }[];
    /** A live execution cannot safely claim a refreshed child feed yet. */
    readonly live?: boolean;
}
