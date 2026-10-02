// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { PineTS } from '../../../src/PineTS.class';
import { Series } from '../../../src/Series';
import { processStrategyOrders, initializeStrategy } from '../../../src/namespaces/strategy/utils';
import type { Order } from '../../../src/namespaces/strategy/types';

function makeContext() {
    const context: any = new Context({
        marketData: [],
        source: [],
        tickerId: 'TEST',
        timeframe: '60',
    } as any);
    // Order is queued on bar 0 and processed on bar 1. The bar first reaches
    // the buy stop (105), then has enough range to execute the limit (106).
    context.idx = 1;
    context.data.open = new Series([100, 100]);
    context.data.high = new Series([101, 110]);
    context.data.low = new Series([99, 99]);
    context.data.close = new Series([100, 100]);
    context.data.openTime = new Series([0, 60_000]);
    context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } } as any;
    initializeStrategy(context, { initial_capital: 1_000 });
    return context;
}

describe('strategy.order stop-limit execution', () => {
    it('activates at the stop and fills the resulting limit order', () => {
        const context = makeContext();
        const order: Order = {
            id: 'buy-stop-limit',
            direction: 1,
            qty: 1,
            type: 'stop-limit',
            stop: 105,
            limit: 106,
            bar: 0,
            time: 0,
            status: 'pending',
            category: 'entry',
        };
        context.strategy.pending_orders.push(order);

        processStrategyOrders(context);

        expect(context.strategy.pending_orders).toHaveLength(0);
        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.opentrades[0]).toMatchObject({
            entry_id: 'buy-stop-limit',
            entry_price: 106,
            entry_bar_index: 1,
            size: 1,
        });
    });

    it('keeps the behavior wired through the Pine source order API', async () => {
        const bars = [
            { openTime: 0, closeTime: 59_999, open: 100, high: 101, low: 99, close: 100, volume: 1 },
            { openTime: 60_000, closeTime: 119_999, open: 100, high: 110, low: 99, close: 100, volume: 1 },
        ];
        const context: any = await new PineTS(bars as any, 'TEST', '60').run(`
//@version=6
strategy('Source stop-limit', initial_capital=1000)
if bar_index == 0
    strategy.order('SL', strategy.long, qty=1, stop=105, limit=106)
`);

        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.opentrades[0]).toMatchObject({ entry_id: 'SL', entry_price: 106, entry_bar_index: 1 });
    });

    it('retains an activated limit across bars until it is reachable', () => {
        const context = makeContext();
        const order: Order = {
            id: 'deferred-stop-limit',
            direction: 1,
            qty: 1,
            type: 'stop-limit',
            stop: 105,
            limit: 115,
            bar: 0,
            time: 0,
            status: 'pending',
            category: 'entry',
        };
        context.strategy.pending_orders.push(order);

        processStrategyOrders(context);
        expect(context.strategy.pending_orders).toHaveLength(1);
        expect(context.strategy.pending_orders[0]._stopTriggered).toBe(true);

        context.idx = 2;
        context.data.open = new Series([100, 100, 100]);
        context.data.high = new Series([101, 110, 116]);
        context.data.low = new Series([99, 99, 99]);
        context.data.close = new Series([100, 100, 100]);
        context.data.openTime = new Series([0, 60_000, 120_000]);
        processStrategyOrders(context);

        expect(context.strategy.pending_orders).toHaveLength(0);
        expect(context.strategy.opentrades[0]).toMatchObject({ entry_price: 115, entry_bar_index: 2 });
    });
});
