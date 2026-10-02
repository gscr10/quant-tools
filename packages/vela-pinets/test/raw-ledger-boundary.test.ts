import { describe, expect, it } from 'vitest';
import { snapshotFromCtx } from '../src/pinets/contextSnapshot';
import { pineContextSelect } from '../src/pinets/reportSeries';

describe('public ledger boundary', () => {
    it('does not promote PineTS pending/raw order data into the Vela snapshot', () => {
        const source = {
            idx: 2,
            strategy: {
                position_size: 1,
                position_avg_price: 100,
                equity: 1_000,
                openprofit: 0,
                netprofit: 0,
                grossprofit: 0,
                grossloss: 0,
                wintrades: 0,
                losstrades: 0,
                eventrades: 0,
                max_drawdown: 0,
                max_runup: 0,
                initial_capital: 1_000,
                // These are intentionally present to model the broker's
                // short-lived internals. They are not a public history.
                pending_orders: [
                    { id: 'pending-1', status: 'pending', direction: 1, qty: 1, type: 'limit' },
                ],
                orders: [{ orderId: 'order-1', status: 'filled' }],
                fills: [{ fillId: 'fill-1', orderId: 'order-1', price: 100 }],
                closedtrades: [],
                opentrades: [{
                    id: 'trade-1',
                    entry_id: 'L',
                    entry_price: 100,
                    entry_time: 1,
                    entry_bar_index: 1,
                    size: 1,
                    status: 'open',
                }],
            },
        };

        const snapshot = snapshotFromCtx(source, 'idle', pineContextSelect('strategy', 'trades'));

        expect(snapshot.strategy).toBeDefined();
        expect(snapshot.trades).toHaveLength(1);
        expect(snapshot.strategy).not.toHaveProperty('pending_orders');
        expect(snapshot.strategy).not.toHaveProperty('orders');
        expect(snapshot.strategy).not.toHaveProperty('fills');
        expect(snapshot).not.toHaveProperty('orders');
        expect(snapshot).not.toHaveProperty('fills');
    });
});
