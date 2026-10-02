// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { Order } from '../types';
import { parseArgsForPineParams } from '../../utils';
import { markOrderCancelled } from '../ledger';

/**
 * Cancel pending orders by id.
 *
 * Pine signature: strategy.cancel(id, immediately) → void
 * Removes only PENDING orders whose `id` matches. Filled orders are untouched.
 * `immediately` is reserved (no-op for now — applies to broker-level behavior
 * not modeled here).
 */
const CANCEL_SIGNATURES = [['id', 'immediately']];
const CANCEL_ARGS_TYPES = { id: 'string', immediately: 'boolean' };

export function cancel(context: any) {
    return (...args: any[]) => {
        if (!context.strategy) {
            throw new Error('strategy.cancel() called before strategy() declaration');
        }
        const parsed = parseArgsForPineParams<any>(args, CANCEL_SIGNATURES, CANCEL_ARGS_TYPES);
        const targetId = parsed.id;
        if (targetId === undefined || targetId === null) return;

        const pending = context.strategy.pending_orders as Order[];
        for (const order of pending) {
            if (order.status === 'pending' && order.id === targetId) {
                markOrderCancelled(context, order, 'strategy.cancel');
            }
        }
        context.strategy.pending_orders = pending.filter((o: Order) => o.status === 'pending');
    };
}
