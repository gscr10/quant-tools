// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Order } from '../types';
import { markOrderCancelled } from '../ledger';

/**
 * Cancel every currently pending order, including conditional exits and
 * market-close requests. Pine's `strategy.cancel_all()` operates on the
 * broker's working-order book; an exit bracket is still an unfilled order
 * even though it is attached to an open position. Filled orders remain in
 * the lifecycle ledger and are never rewritten.
 *
 * Pine signature: strategy.cancel_all() → void
 */
export function cancel_all(context: any) {
    return () => {
        if (!context.strategy) {
            throw new Error('strategy.cancel_all() called before strategy() declaration');
        }
        const pending = context.strategy.pending_orders as Order[];
        for (const order of pending) {
            if (order.status === 'pending') {
                markOrderCancelled(context, order, 'strategy.cancel_all');
            }
        }
        context.strategy.pending_orders = pending.filter(
            (o: Order) => o.status === 'pending',
        );
    };
}
