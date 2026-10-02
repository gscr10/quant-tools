// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

/**
 * Strategy configuration options.
 *
 * Field names mirror Pine's strategy() declaration parameters exactly
 * (snake_case, single-word where Pine uses one word). See
 * https://www.tradingview.com/pine-script-reference/v5/#fun_strategy
 */
export interface StrategyConfig {
    title: string;
    shorttitle?: string;
    overlay: boolean;
    format?: string;
    precision?: number;
    scale?: string;
    pyramiding?: number;
    calc_on_order_fills?: boolean;
    calc_on_every_tick?: boolean;
    max_bars_back?: number;
    backtest_fill_limits_assumption?: number;
    default_qty_type?: string;
    default_qty_value?: number;
    initial_capital?: number;
    currency?: string;
    slippage?: number;
    commission_type?: string;
    commission_value?: number;
    process_orders_on_close?: boolean;
    close_entries_rule?: string;
    margin_long?: number;
    margin_short?: number;
    explicit_plot_zorder?: boolean;
    max_lines_count?: number;
    max_labels_count?: number;
    max_boxes_count?: number;
    max_polylines_count?: number;
    calc_bars_count?: number;
    risk_free_rate?: number;
    use_bar_magnifier?: boolean;
    fill_orders_on_standard_ohlc?: boolean;
    dynamic_requests?: boolean;
    behind_chart?: boolean;
}

/**
 * One close-marked point in the strategy report equity curve.
 *
 * `underwater` is the drawdown of CLOSE equity from its prior close-equity
 * peak. It is deliberately separate from `maxDrawdown`, which is the broker
 * emulator's cumulative maximum and includes intrabar high/low excursions.
 * Benchmark fields stay null until the first real entry fill establishes the
 * buy-and-hold anchor.
 */
export interface StrategyReportPoint {
    readonly barIndex: number;
    readonly time: number;
    readonly closeTime?: number;

    readonly equity: number;
    readonly realizedPnl: number;
    readonly openPnl: number;

    readonly underwater: number;
    readonly underwaterPercent: number | null;

    readonly maxDrawdown: number;
    readonly maxDrawdownPercent: number;

    readonly benchmarkEquity: number | null;
    readonly benchmarkPnl: number | null;
    readonly benchmarkReturnPercent: number | null;
}

/**
 * A single trade — either currently open or already closed.
 *
 * Field names mirror Pine's per-trade getters from
 * strategy.closedtrades.*(idx) / strategy.opentrades.*(idx).
 *
 * `size` is SIGNED to match Pine: positive = long, negative = short.
 * The historical direction/qty pair has been collapsed into this single
 * field, matching what `strategy.closedtrades.size(idx)` returns.
 */
export interface Trade {
    id: string; // unique trade id (internal)
    entry_id: string; // id passed to strategy.entry()
    entry_price: number;
    entry_bar_index: number;
    entry_time: number;
    entry_comment?: string;
    exit_id?: string; // id passed to strategy.exit/close — set on close
    exit_price?: number;
    exit_bar_index?: number;
    exit_time?: number;
    exit_comment?: string;
    size: number; // SIGNED — positive long, negative short
    profit?: number; // realized P&L on close; undefined while open
    commission?: number; // commission charged on this trade
    max_drawdown?: number; // per-trade peak drawdown from entry
    max_runup?: number; // per-trade peak runup from entry
    status: 'open' | 'closed';
    /**
     * PHYSICAL entry price of this lot, immutable — used to compute
     * per-lot exit-bracket levels (strategy.exit profit/loss ticks).
     * Distinct from `entry_price`, which is the LEDGER value and can be
     * swapped by FIFO entry/exit pairing when a newer lot's bracket fills
     * before an older lot's (TV ledger convention).
     */
    _bracket_entry?: number;
}

/**
 * A pending or filled order tracked internally by the engine.
 *
 * No Pine API exposes pending orders directly. Field names follow Pine's
 * `strategy.entry()` / `strategy.order()` parameter names where they map
 * (`limit`, `stop`, `oca_name`, `oca_type`), and snake_case for the rest.
 */
export interface Order {
    id: string;
    direction: number; // +1 long, -1 short
    qty: number; // unsigned
    type: 'market' | 'limit' | 'stop' | 'stop-limit';
    limit?: number; // matches strategy.entry(limit=...)
    stop?: number; // matches strategy.entry(stop=...)
    bar: number;
    time: number;
    oca_name?: string;
    oca_type?: 'cancel' | 'reduce' | 'none';
    comment?: string;
    fill_price?: number;
    fill_bar?: number;
    fill_time?: number;
    status: 'pending' | 'filled' | 'cancelled';

    // Distinguishes pending entries (market/limit/stop) from conditional
    // exit orders that ride on open positions. Defaults to 'entry' when
    // unset for backward-compat.
    category?: 'entry' | 'exit';

    // Exit-specific fields (only set when category === 'exit').
    // strategy.exit() parameters: profit (TP in ticks), loss (SL in ticks),
    // limit/stop (price-based TP/SL), trail_price/trail_offset/trail_points
    // (trailing-stop trio), from_entry (which entries to attach to;
    // empty/"" or undefined means "all"), qty / qty_percent (partial close).
    profit?: number; // TP in ticks
    loss?: number; // SL in ticks
    trail_price?: number; // price level at which trailing arms
    trail_offset?: number; // offset in ticks the trail rides at
    trail_points?: number; // alternative trail-arm: entry_price + N ticks
    from_entry?: string; // entry id this exit attaches to ('' = all)
    qty_percent?: number; // percent of matching position to close
    comment_profit?: string;
    comment_loss?: string;
    comment_trailing?: string;
    alert_message?: string;
    alert_profit?: string;
    alert_loss?: string;
    alert_trailing?: string;
    disable_alert?: boolean;
    immediately?: boolean; // strategy.close/close_all: fill at current bar's close
    // Internal: tracks the running peak used by trailing-stop logic.
    // For a long: highest high seen since the trail armed; for a short: lowest low.
    trail_peak?: number;
    trail_armed?: boolean;

    // Internal: a stop-limit entry becomes a limit order after its stop leg is
    // touched. The flag persists across bars when the activated limit is not
    // filled immediately. It is deliberately not part of the public Vela
    // snapshot/order contract.
    _stopTriggered?: boolean;
    /** True when the stop leg was activated by an opening gap. */
    _stopTriggeredAtOpen?: boolean;

    // Internal: set on `strategy.entry` orders that REVERSE the current
    // position (opposite direction with existing size). Used by
    // `strategy.exit` to detect when its absolute limit/stop values were
    // computed from the OUTGOING position's avg (i.e. stale): the user
    // typically writes `stop = strategy.position_avg_price + N` on the
    // crossunder bar, but at that point position_avg_price still reflects
    // the position being reversed away. TV silently ignores stale legs;
    // PT drops them at trigger evaluation (see processExitOrders).
    _isReversalEntry?: boolean;
    _attachedAtReversal?: boolean;

    // Internal: cadence-detection for strategy.exit. TV's broker
    // emulator uses Pine's lazy series-eval semantic for exit
    // parameters — the variable behind limit/stop is re-read each bar.
    // For a variable scoped INSIDE an if-block (sparse pattern), that
    // gives NA on non-trigger bars → TV doesn't fire stale captures.
    // For a variable in MAIN scope (persistent pattern, called every
    // bar), TV reads the captured value → fires stale captures.
    //
    // PT can't see the variable's scope from runtime, but the call
    // CADENCE (how often the user calls strategy.exit per call site)
    // correlates 1:1. Detected at queue time: if the user called this
    // exit's callsite on the PRIOR bar, `_isPersistent = true`. Used
    // by processExitOrders to suppress the stale-reversal drop on
    // persistent-pattern exits.
    _isPersistent?: boolean;
    _callsiteId?: string;

    // Internal: snapshot of open trade IDs at the moment strategy.close_all()
    // or strategy.close(id) was called. TV binds `close_all` / `close(id)` to
    // the position state at CALL time; if those trades are closed by another
    // mechanism (e.g. a reversal entry filling on the next bar) before the
    // close order fires, TV silently drops the close. PineTS achieves the
    // same by filtering matching open trades against this snapshot at fill
    // time — if none of the originally-intended trades are still open, the
    // close order is cancelled.
    _intended_trade_ids?: string[];

    /** Internal stable identity used by the append-only broker audit ledger.
     * It is distinct from `id`, which Pine scripts may intentionally reuse. */
    _ledger_order_id?: string;

    /** Internal relation metadata for the opt-in broker audit stream.  These
     * fields never cross the ordinary Vela strategy/trade snapshot. */
    _ledger_parent_order_ids?: string[];
    _ledger_reversal_of_order_id?: string;
    _ledger_reversal_of_trade_ids?: string[];
    _ledger_requested_qty?: number;
    _ledger_filled_qty?: number;
    _ledger_fill_sequence?: number;

    /** Internal guard: prevents one order from counting twice toward
     * max_intraday_filled_orders when an execution path revisits it. */
    _risk_counted_fill?: boolean;
}

/**
 * Lifecycle events emitted by the PineTS broker emulator. This is an
 * internal append-only audit stream: it describes what the emulator actually
 * accepted/rejected/cancelled/filled, not a claim of TradingView raw-feed
 * equivalence. It is intentionally separate from the public Vela snapshot
 * contract; rawOrders/rawFills remain disabled until a complete cross-worker
 * wire schema exists.
 */
export type StrategyOrderEventKind = 'created' | 'filled' | 'cancelled' | 'rejected';

export interface StrategyOrderEvent {
    readonly eventId: string;
    readonly orderId: string;
    readonly sourceOrderId?: string;
    readonly kind: StrategyOrderEventKind;
    readonly barIndex: number;
    readonly time: number;
    readonly direction: number;
    readonly qty: number;
    readonly orderType: Order['type'];
    readonly category?: Order['category'];
    readonly limit?: number;
    readonly stop?: number;
    readonly fillPrice?: number;
    readonly fillQty?: number;
    readonly tradeIds?: readonly string[];
    readonly reason?: string;
    /** Orders whose open trade(s) this order is attached to. */
    readonly parentOrderIds?: readonly string[];
    /** Source entry order closed by a reversal order, if any. */
    readonly reversalOfOrderId?: string;
    /** Source trade lots closed by a reversal order, if known. */
    readonly reversalOfTradeIds?: readonly string[];
    /** Requested quantity and cumulative/remaining progress for fills. */
    readonly requestedQty?: number;
    readonly cumulativeFillQty?: number;
    readonly remainingQty?: number;
    readonly fillSequence?: number;
    readonly isPartial?: boolean;
}

export interface StrategyFillEvent {
    readonly fillId: string;
    readonly orderId: string;
    readonly sourceOrderId?: string;
    readonly barIndex: number;
    readonly time: number;
    readonly direction: number;
    readonly qty: number;
    readonly price: number;
    readonly orderType: Order['type'];
    readonly category?: Order['category'];
    readonly tradeIds?: readonly string[];
    /** Orders whose open trade(s) this fill is attached to. */
    readonly parentOrderIds?: readonly string[];
    /** Source entry order/trades closed by a reversal fill, if any. */
    readonly reversalOfOrderId?: string;
    readonly reversalOfTradeIds?: readonly string[];
    /** Quantity progress across real fills of one order. */
    readonly requestedQty: number;
    readonly cumulativeQty: number;
    readonly remainingQty: number;
    readonly fillSequence: number;
    readonly isPartial: boolean;
}

/**
 * Strategy state stored on the Context after a backtest run.
 *
 * Top-level scalars mirror Pine's `strategy.*` properties 1:1 (snake_case,
 * Pine's single-word concatenations like `netprofit` / `grossprofit` /
 * `grossloss` / `openprofit` preserved). Position fields are FLATTENED
 * — Pine exposes `strategy.position_size` / `position_avg_price` /
 * `position_entry_name` as three separate scalars, not a nested object.
 *
 * The `opentrades` / `closedtrades` arrays use Pine's exact names with
 * `.length` providing the count — same semantic as Pine's int count but
 * also indexable for the per-trade getter equivalents.
 */
export interface StrategyState {
    config: StrategyConfig;

    // Trade collections (arrays — `.length` is the Pine count)
    opentrades: Trade[];
    closedtrades: Trade[];
    pending_orders: Order[];

    /** Internal append-only order lifecycle history. Optional for backwards
     * compatibility with hand-built StrategyState fixtures. */
    _order_events?: StrategyOrderEvent[];
    /** Internal actual-fill history; no synthetic partial fills are emitted. */
    _fill_events?: StrategyFillEvent[];
    /** Monotonic sequence backing stable event/order/fill ids. */
    _ledger_sequence?: number;
    /** Internal mapping from physical trade lot id to its ledger order id. */
    _ledger_trade_order_ids?: Record<string, string>;

    // Position info — flattened to match Pine's separate-scalars data model
    position_size: number; // SIGNED (matches strategy.position_size)
    position_avg_price: number; // NaN when flat (matches Pine semantics)
    position_entry_name: string; // entry_id that opened current position

    // Account info — matches Pine names exactly
    initial_capital: number;
    account_currency: string;
    equity: number;
    netprofit: number; // realized only
    grossprofit: number;
    grossloss: number;
    openprofit: number; // unrealized P&L of open positions
    // Compound Annual Growth Rate (%) of strategy equity over the backtest
    // window. Computed ONCE at end-of-run by finalizeStrategyRun from
    // initial_capital, netprofit, and the first/last bar open times. Like
    // Sharpe / Sortino this is a report-only field (NOT a Pine built-in),
    // read via ctx.strategy.cagr after the run. NaN when the window is
    // shorter than one day or the figures are non-finite.
    cagr: number;

    // Peaks — used by strategy.max_drawdown / strategy.max_runup
    max_drawdown: number;
    max_runup: number;
    // Internal: running high-/low-water marks of REALIZED equity
    // (initial_capital + netprofit). Used symmetrically:
    //   max_drawdown reference is equity_peak  (worst dip below the high)
    //   max_runup    reference is equity_trough (best rise above the low)
    // equity_peak also serves as the denominator of max_drawdown_percent.
    equity_peak: number;
    equity_trough: number;
    // Total equity at the moment max_runup was last bumped — i.e. the
    // intra-bar high-water of (realized + best_unrealized_excursion). Used
    // as the denominator of max_runup_percent (TV reports runup as a
    // percentage of the equity AT the peak, not of initial_capital).
    equity_at_runup_peak: number;
    // Max-Equity snapshot (running high-water of realized equity) at the
    // moment max_drawdown was last bumped to a new peak. Used as the
    // denominator of max_drawdown_percent — TV's empirical behavior is
    // ddpct = max_drawdown / Max_Equity-at-latch × 100, NOT against
    // initial_capital or current equity_peak.
    equity_at_drawdown_peak: number;

    // Running max of `(latched_drawdown / equity_at_that_latch) × 100` and
    // `(latched_runup / equity_at_that_latch) × 100` across the strategy's
    // lifetime. Pine's max_drawdown_percent / max_runup_percent are the
    // HIGHEST RATIO observed across all latch events — NOT
    // (current_max_value / current_equity_at_peak). The two interpretations
    // diverge when a later latch produces a larger absolute value but a
    // smaller percentage (because equity grew faster than the latched
    // metric), so the running-max formulation is the only one that
    // matches the spec.
    max_drawdown_percent_value: number;
    max_runup_percent_value: number;

    // Risk-adjusted performance ratios (TV's "Risk-adjusted performance"
    // panel). Computed ONCE at end-of-run by finalizeStrategyRun from the
    // monthly equity curve — NOT Pine built-in variables (TV exposes them
    // only in the Strategy Tester report / xlsx, not to scripts), so they
    // live on the state object and are read via ctx.strategy.*.
    sharpe_ratio: number;
    sortino_ratio: number;

    // Buy-and-hold benchmark (TV's "Buy & Hold Return" report figures).
    // Computed ONCE at end-of-run by finalizeStrategyRun. Not Pine built-in
    // variables (TV exposes them only in the Strategy Tester report), so they
    // live on the state object and are read via ctx.strategy.* after the run.
    //
    // Model: a single long position bought with the ENTIRE initial capital at
    // the FIRST trade's entry price (slippage already baked into that fill
    // price) and held open through the last bar — never sold, so commissions
    // never apply and the exit leg carries no slippage.
    //   qty                  = initial_capital / first_entry_price
    //   buy_and_hold_pnl      = qty × (last_close − first_entry_price)
    //                         = initial_capital × per_gain / 100
    //   buy_and_hold_per_gain = (last_close − first_entry_price)
    //                            / first_entry_price × 100
    //   strategy_outperformance = netprofit − buy_and_hold_pnl
    // All NaN until the first trade opens (no entry price to anchor on).
    buy_and_hold_pnl: number;
    buy_and_hold_per_gain: number;
    strategy_outperformance: number;
    // Internal: entry price (slippage-adjusted) of the FIRST trade ever
    // opened in the run — the anchor for the buy-and-hold benchmark. Latched
    // once in openTrade and never overwritten.
    _first_entry_price?: number;

    // Internal: mark-to-market equity at each calendar month's last bar,
    // and the month key of the most recent bar (rollover detector). Feed
    // the Sharpe / Sortino computation.
    _monthly_equity?: number[];
    _last_month_key?: number;

    // Internal close-marked report curve. This is consumed by host report
    // workspaces and is not a Pine built-in. Streaming rollback snapshots it
    // as length + last point, avoiding an O(history) clone on every tick.
    _report_series?: StrategyReportPoint[];
    _report_close_equity_peak?: number;

    // Trade-stat counters — updated each time a trade closes
    wintrades: number; // count of closed trades with profit > 0
    losstrades: number; // count of closed trades with profit < 0
    eventrades: number; // count of closed trades with profit === 0
    wintrades_total_profit: number; // sum of profits across winning closed trades (for avg)
    losstrades_total_loss: number; // sum of |loss| across losing closed trades (for avg)

    // Position-size peaks (in contracts/units)
    max_contracts_held_all: number; // max(|position_size|) seen
    max_contracts_held_long: number; // max(position_size) where > 0
    max_contracts_held_short: number; // max(|position_size|) where < 0

    // Pre-trade risk-management filters (configured via strategy.risk.*).
    // Each rule is optional; if undefined, the rule does not apply.
    risk_rules: {
        allow_entry_in?: 'long' | 'short' | 'all';
        max_cons_loss_days?: { count: number; alert_message?: string };
        max_drawdown?: { value: number; type: 'cash' | 'percent_of_equity' };
        max_intraday_filled_orders?: { count: number; alert_message?: string };
        max_intraday_loss?: { value: number; type: 'cash' | 'percent_of_equity' };
        max_position_size?: number;
    };

    // Once max_drawdown or max_cons_loss_days triggers, entries are blocked
    // for the rest of the run. max_intraday_loss and
    // max_intraday_filled_orders use the exchange-local day state above and
    // reset at the next day boundary (subject to chart-OHLC precision).
    risk_halted: boolean;

    /** Intraday risk accounting is kept separate from `risk_halted`: Pine's
     * max_intraday_* rules reset at the exchange-local day boundary, while
     * max_drawdown/max_cons_loss_days remain run-level halts. */
    _risk_day_key?: string;
    _risk_day_start_equity?: number;
    _risk_day_start_netprofit?: number;
    _risk_day_filled_orders?: number;
    _risk_intraday_halted?: boolean;
    _risk_consecutive_loss_days?: number;
    _risk_day_last_closed_count?: number;
    _risk_day_had_activity?: boolean;

    // Internal: per-callsite cadence tracking for strategy.exit. Keyed by the
    // transpiler-injected __callsiteId; value is the last context.idx the user
    // called strategy.exit at that site. Read at queue time to detect whether
    // the prior bar also called this site (persistent pattern) or not (sparse
    // / inside-if-block pattern). See Order._isPersistent.
    _exit_call_history?: Map<string, number>;
    // Fallback counter for non-transpiled callers (no __callsiteId injection)
    // — paired with per-bar reset so each "first-of-bar" raw call gets a
    // stable synthetic id like `exit_raw_N`.
    _exit_fallback_counter?: number;
    _exit_fallback_last_bar?: number;
}
