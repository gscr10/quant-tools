// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import type { Order, StrategyFillEvent, StrategyOrderEvent, StrategyOrderEventKind, StrategyState } from './types';

export interface StrategyLedger {
    readonly orderEvents: readonly StrategyOrderEvent[];
    readonly fillEvents: readonly StrategyFillEvent[];
}

interface FillDetails {
    price: number;
    qty: number;
    /** Requested/capped quantity for the order.  For dynamic exits this is
     * resolved at the first real fill; it is not inferred from `order.qty`
     * because Pine close/exit orders may leave that field at zero. */
    requestedQty?: number;
    /** Direction of the executed leg.  Exit orders have order.direction=0. */
    direction?: number;
    tradeIds?: readonly string[];
    /** Internal: the caller already emitted the fill row (e.g. a multi-leg
     * exit order) but still wants the terminal order event enriched. */
    record?: boolean;
}

interface RejectedAttempt {
    id?: string;
    direction?: number;
    qty?: number;
    type?: Order['type'];
    category?: Order['category'];
    limit?: number;
    stop?: number;
    reason?: string;
    barIndex?: number;
    time?: number;
}

type LedgerState = StrategyState & {
    _order_events?: StrategyOrderEvent[];
    _fill_events?: StrategyFillEvent[];
    _ledger_sequence?: number;
    _ledger_trade_order_ids?: Record<string, string>;
};

function stateOf(context: any): LedgerState | undefined {
    return context?.strategy as LedgerState | undefined;
}

function ensureCollections(strategy: LedgerState): void {
    if (!Array.isArray(strategy._order_events)) strategy._order_events = [];
    if (!Array.isArray(strategy._fill_events)) strategy._fill_events = [];
    if (!Number.isFinite(strategy._ledger_sequence)) strategy._ledger_sequence = 0;
}

function nextSequence(strategy: LedgerState): number {
    ensureCollections(strategy);
    strategy._ledger_sequence = (strategy._ledger_sequence ?? 0) + 1;
    return strategy._ledger_sequence;
}

function readSeriesHead(value: any): number {
    if (value && typeof value.get === 'function') return Number(value.get(0));
    if (Array.isArray(value)) return Number(value[value.length - 1]);
    return Number(value);
}

function currentBar(context: any): number {
    const n = Number(context?.idx);
    return Number.isFinite(n) ? n : -1;
}

function currentTime(context: any): number {
    const value = readSeriesHead(context?.data?.openTime);
    return Number.isFinite(value) ? value : 0;
}

function finiteNonNegative(value: unknown): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function uniqueStrings(values: readonly unknown[] | undefined): string[] {
    if (!values) return [];
    return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function tradeOrderMap(strategy: LedgerState): Record<string, string> {
    if (!strategy._ledger_trade_order_ids || typeof strategy._ledger_trade_order_ids !== 'object') {
        strategy._ledger_trade_order_ids = {};
    }
    return strategy._ledger_trade_order_ids;
}

/** Return stable ledger order ids for physical trade lots. */
export function parentOrderIdsForTrades(strategy: StrategyState | undefined, tradeIds: readonly string[]): string[] {
    if (!strategy) return [];
    const map = (strategy as LedgerState)._ledger_trade_order_ids;
    if (!map) return [];
    return uniqueStrings(tradeIds.map((tradeId) => map[tradeId]));
}

function orderTradeIds(context: any, order: Order): string[] {
    const strategy = stateOf(context);
    if (!strategy) return [];
    if (Array.isArray(order._intended_trade_ids)) return uniqueStrings(order._intended_trade_ids);
    if ((order.category ?? 'entry') === 'entry') {
        const direction = Number(order.direction);
        if (direction === 0 || strategy.position_size === 0 || Math.sign(direction) === Math.sign(strategy.position_size)) {
            return [];
        }
        return strategy.opentrades.map((trade) => trade.id);
    }
    const fromEntry = order.from_entry ?? '';
    return strategy.opentrades
        .filter((trade) => !fromEntry || trade.entry_id === fromEntry)
        .map((trade) => trade.id);
}

/**
 * Capture relation metadata before a broker operation mutates the open book.
 * Exit orders point at the entry order(s) that own their targeted lots;
 * opposite-direction entry/order requests additionally retain the source
 * order and trade ids they reverse.  This is diagnostic metadata only and
 * does not affect the public StrategyTrade contract.
 */
export function captureOrderRelations(
    context: any,
    order: Order,
    tradeIds?: readonly string[],
): void {
    const strategy = stateOf(context);
    if (!strategy) return;
    const ids = uniqueStrings(tradeIds ?? orderTradeIds(context, order));
    const parentIds = parentOrderIdsForTrades(strategy, ids);
    if (parentIds.length > 0) {
        // A multi-leg exit can close one lot and then observe the remaining
        // lot(s) after the first fill. Preserve the complete parent set rather
        // than replacing it with only the still-open suffix.
        order._ledger_parent_order_ids = uniqueStrings([
            ...(order._ledger_parent_order_ids ?? []),
            ...parentIds,
        ]);
    }

    const direction = Number(order.direction);
    const position = Number(strategy.position_size);
    const opposite = direction !== 0 && position !== 0 && Math.sign(position) !== Math.sign(direction);
    const requestedQty = finiteNonNegative(order.qty) ?? 0;
    const reversal = order._isReversalEntry === true
        || (opposite && requestedQty > Math.abs(position) + 1e-9);
    if (reversal && ids.length > 0) {
        order._ledger_reversal_of_trade_ids = uniqueStrings([
            ...(order._ledger_reversal_of_trade_ids ?? []),
            ...ids,
        ]);
        if (order._ledger_reversal_of_order_id === undefined && parentIds.length > 0) {
            order._ledger_reversal_of_order_id = parentIds[0];
        }
    }
}

function relationFields(order: Order): Pick<StrategyOrderEvent, 'parentOrderIds' | 'reversalOfOrderId' | 'reversalOfTradeIds' | 'requestedQty' | 'cumulativeFillQty' | 'remainingQty' | 'fillSequence' | 'isPartial'> {
    const requested = finiteNonNegative(order._ledger_requested_qty);
    const cumulative = finiteNonNegative(order._ledger_filled_qty);
    const remaining = requested === undefined || cumulative === undefined
        ? undefined
        : Math.max(0, requested - cumulative);
    const sequence = finiteNonNegative(order._ledger_fill_sequence);
    return {
        ...(order._ledger_parent_order_ids?.length ? { parentOrderIds: Object.freeze([...order._ledger_parent_order_ids]) } : {}),
        ...(order._ledger_reversal_of_order_id ? { reversalOfOrderId: order._ledger_reversal_of_order_id } : {}),
        ...(order._ledger_reversal_of_trade_ids?.length ? { reversalOfTradeIds: Object.freeze([...order._ledger_reversal_of_trade_ids]) } : {}),
        ...(requested === undefined ? {} : { requestedQty: requested }),
        ...(cumulative === undefined ? {} : { cumulativeFillQty: cumulative }),
        ...(remaining === undefined ? {} : { remainingQty: remaining }),
        ...(sequence === undefined ? {} : { fillSequence: sequence }),
        ...(requested !== undefined && cumulative !== undefined ? { isPartial: remaining! > 1e-9 } : {}),
    };
}

/** Ensure a pending order has a stable identity across duplicate Pine ids and
 * streaming snapshots.  The field is intentionally internal to Order. */
export function ensureOrderLedgerId(context: any, order: Order): string {
    const strategy = stateOf(context);
    if (!strategy) return `order_untracked_${String(order.id)}`;
    ensureCollections(strategy);
    const existing = (order as any)._ledger_order_id;
    if (typeof existing === 'string' && existing.length > 0) return existing;
    const id = `order_${nextSequence(strategy)}`;
    (order as any)._ledger_order_id = id;
    return id;
}

function eventAlreadyRecorded(strategy: LedgerState, orderId: string, kind: StrategyOrderEventKind): boolean {
    return (strategy._order_events ?? []).some((event) => event.orderId === orderId && event.kind === kind);
}

function baseOrderEvent(context: any, order: Order, kind: StrategyOrderEventKind, details: Partial<StrategyOrderEvent> = {}): StrategyOrderEvent {
    const strategy = stateOf(context)!;
    const orderId = ensureOrderLedgerId(context, order);
    const orderBar = Number(order.bar);
    const orderTime = Number(order.time);
    return {
        eventId: `event_${nextSequence(strategy)}`,
        orderId,
        sourceOrderId: order.id,
        kind,
        barIndex: details.barIndex ?? (Number.isFinite(orderBar) ? orderBar : currentBar(context)),
        time: details.time ?? (Number.isFinite(orderTime) ? orderTime : currentTime(context)),
        direction: details.direction ?? (Number(order.direction) || 0),
        qty: details.qty ?? Math.abs(Number(order.qty) || 0),
        orderType: details.orderType ?? order.type,
        category: details.category ?? order.category ?? 'entry',
        limit: details.limit ?? order.limit,
        stop: details.stop ?? order.stop,
        fillPrice: details.fillPrice,
        fillQty: details.fillQty,
        tradeIds: details.tradeIds,
        reason: details.reason,
        ...relationFields(order),
    };
}

/** Record queue acceptance. Safe to call more than once for an order. */
export function recordOrderCreated(context: any, order: Order): string | undefined {
    const strategy = stateOf(context);
    if (!strategy) return undefined;
    ensureCollections(strategy);
    const orderId = ensureOrderLedgerId(context, order);
    captureOrderRelations(context, order);
    if (!eventAlreadyRecorded(strategy, orderId, 'created')) {
        strategy._order_events!.push(baseOrderEvent(context, order, 'created', {
            barIndex: order.bar,
            time: order.time,
        }));
    }
    return orderId;
}

/** Record a terminal/observable cancellation. */
export function recordOrderCancelled(context: any, order: Order, reason?: string): void {
    const strategy = stateOf(context);
    if (!strategy) return;
    ensureCollections(strategy);
    captureOrderRelations(context, order);
    recordOrderCreated(context, order);
    const orderId = ensureOrderLedgerId(context, order);
    if (eventAlreadyRecorded(strategy, orderId, 'cancelled') || eventAlreadyRecorded(strategy, orderId, 'filled') || eventAlreadyRecorded(strategy, orderId, 'rejected')) return;
    // `created` keeps the order's queue timestamp, while terminal lifecycle
    // events must describe when the broker actually observed the transition.
    // This matters for a pending limit cancelled several bars after it was
    // queued (and for child-bar execution under Bar Magnifier).
    strategy._order_events!.push(baseOrderEvent(context, order, 'cancelled', {
        barIndex: currentBar(context),
        time: currentTime(context),
        reason,
    }));
}

/** Record an order rejected by a broker/risk/margin rule.  Order.status is
 * still the historical `cancelled` value because that is the existing
 * StrategyState contract; the audit stream preserves the distinction. */
export function recordOrderRejected(context: any, order: Order, reason?: string): void {
    const strategy = stateOf(context);
    if (!strategy) return;
    ensureCollections(strategy);
    captureOrderRelations(context, order);
    recordOrderCreated(context, order);
    const orderId = ensureOrderLedgerId(context, order);
    if (eventAlreadyRecorded(strategy, orderId, 'rejected') || eventAlreadyRecorded(strategy, orderId, 'filled')) return;
    strategy._order_events!.push(baseOrderEvent(context, order, 'rejected', {
        barIndex: currentBar(context),
        time: currentTime(context),
        reason,
    }));
}

/** Record one actual fill.  Calls from the existing broker paths should pass
 * the quantity they really executed; no synthetic remainder/partial row is
 * generated here. */
export function recordFillEvent(context: any, order: Order, details: FillDetails): void {
    const strategy = stateOf(context);
    if (!strategy) return;
    ensureCollections(strategy);
    captureOrderRelations(context, order);
    const orderId = ensureOrderLedgerId(context, order);
    const qty = Math.abs(Number(details.qty) || 0);
    const requested = Math.max(
        qty,
        finiteNonNegative(order._ledger_requested_qty)
            ?? finiteNonNegative(details.requestedQty)
            ?? finiteNonNegative(order.qty)
            ?? qty,
    );
    const cumulative = (finiteNonNegative(order._ledger_filled_qty) ?? 0) + qty;
    const fillSequence = (finiteNonNegative(order._ledger_fill_sequence) ?? 0) + 1;
    order._ledger_requested_qty = requested;
    order._ledger_filled_qty = cumulative;
    order._ledger_fill_sequence = fillSequence;
    const remaining = Math.max(0, requested - cumulative);
    const fillId = `fill_${nextSequence(strategy)}`;
    strategy._fill_events!.push({
        fillId,
        orderId,
        sourceOrderId: order.id,
        barIndex: currentBar(context),
        time: currentTime(context),
        direction: details.direction ?? (Number(order.direction) || 0),
        qty,
        price: Number(details.price),
        orderType: order.type,
        category: order.category ?? 'entry',
        tradeIds: details.tradeIds,
        parentOrderIds: order._ledger_parent_order_ids?.length
            ? Object.freeze([...order._ledger_parent_order_ids])
            : undefined,
        reversalOfOrderId: order._ledger_reversal_of_order_id,
        reversalOfTradeIds: order._ledger_reversal_of_trade_ids?.length
            ? Object.freeze([...order._ledger_reversal_of_trade_ids])
            : undefined,
        requestedQty: requested,
        cumulativeQty: cumulative,
        remainingQty: remaining,
        fillSequence,
        isPartial: remaining > 1e-9,
    });
}

/** Mark an order filled and optionally append its actual fill row. */
export function markOrderFilled(context: any, order: Order, details?: FillDetails): void {
    const strategy = stateOf(context);
    if (!strategy) return;
    ensureCollections(strategy);
    captureOrderRelations(context, order);
    recordOrderCreated(context, order);
    ensureOrderLedgerId(context, order);
    order.status = 'filled';
    if (details) {
        order.fill_price = details.price;
        order.fill_bar = currentBar(context);
        order.fill_time = currentTime(context);
        if (details.record !== false) recordFillEvent(context, order, details);
    }
    const orderId = ensureOrderLedgerId(context, order);
    if (!eventAlreadyRecorded(strategy, orderId, 'filled')) {
        strategy._order_events!.push(baseOrderEvent(context, order, 'filled', {
            barIndex: currentBar(context),
            time: currentTime(context),
            fillPrice: details?.price,
            fillQty: details?.qty,
            direction: details?.direction,
            tradeIds: details?.tradeIds,
        }));
    }
}

/** Mark an order cancelled while preserving the existing pending-order
 * behavior. */
export function markOrderCancelled(context: any, order: Order, reason?: string): void {
    order.status = 'cancelled';
    recordOrderCancelled(context, order, reason);
}

/** Mark an order rejected by a risk/margin guard. */
export function markOrderRejected(context: any, order: Order, reason?: string): void {
    order.status = 'cancelled';
    recordOrderRejected(context, order, reason);
}

/** Record an attempted request rejected before a pending Order object is
 * created (for example a pyramiding guard).  There is intentionally no
 * `created` event for such a request. */
export function recordRejectedAttempt(context: any, attempt: RejectedAttempt): void {
    const strategy = stateOf(context);
    if (!strategy) return;
    ensureCollections(strategy);
    const orderId = `order_${nextSequence(strategy)}`;
    strategy._order_events!.push({
        eventId: `event_${nextSequence(strategy)}`,
        orderId,
        sourceOrderId: attempt.id,
        kind: 'rejected',
        barIndex: attempt.barIndex ?? currentBar(context),
        time: attempt.time ?? currentTime(context),
        direction: attempt.direction ?? 0,
        qty: Math.abs(attempt.qty ?? 0),
        orderType: attempt.type ?? 'market',
        category: attempt.category ?? 'entry',
        limit: attempt.limit,
        stop: attempt.stop,
        reason: attempt.reason,
    });
}

/** Read-only internal snapshot useful to host adapters/tests. */
export function getStrategyLedger(strategy: StrategyState | undefined): StrategyLedger | undefined {
    if (!strategy) return undefined;
    const state = strategy as LedgerState;
    // Do not leak the broker's append-only buffers across the adapter boundary.
    // `readonly` protects TypeScript callers only; the old implementation still
    // returned the live arrays, allowing a host to mutate the engine's next run.
    // Keep this helper a true snapshot while preserving the experimental,
    // internal-only nature of the ledger API.
    const freezeEvent = <T extends { tradeIds?: readonly string[]; parentOrderIds?: readonly string[]; reversalOfTradeIds?: readonly string[] }>(event: T): T => {
        const copy = { ...event };
        if (copy.tradeIds) copy.tradeIds = Object.freeze([...copy.tradeIds]);
        if (copy.parentOrderIds) copy.parentOrderIds = Object.freeze([...copy.parentOrderIds]);
        if (copy.reversalOfTradeIds) copy.reversalOfTradeIds = Object.freeze([...copy.reversalOfTradeIds]);
        return Object.freeze(copy) as T;
    };
    const orderEvents = Object.freeze((state._order_events ?? []).map(freezeEvent));
    const fillEvents = Object.freeze((state._fill_events ?? []).map(freezeEvent));
    return {
        orderEvents,
        fillEvents,
    };
}
