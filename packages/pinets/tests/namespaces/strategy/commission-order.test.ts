import { describe, expect, it } from 'vitest';

import { PineTS } from '../../../src/PineTS.class';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { closePartialPosition, initializeStrategy } from '../../../src/namespaces/strategy/utils';

const MINUTE = 60_000;
const T0 = Date.UTC(2024, 0, 1);

function bar(index: number, open: number, high: number, low: number, close: number) {
    return {
        openTime: T0 + index * MINUTE,
        closeTime: T0 + (index + 1) * MINUTE,
        open,
        high,
        low,
        close,
        volume: 1,
    };
}

describe('strategy commission accounting', () => {
    it('clamps an oversized close request instead of manufacturing a reversal', () => {
        const context: any = new Context({
            marketData: [],
            source: [],
            tickerId: 'BTCUSDT',
            timeframe: '1',
        } as any);
        context.idx = 0;
        context.data.open = new Series([100]);
        context.data.high = new Series([110]);
        context.data.low = new Series([90]);
        context.data.close = new Series([100]);
        context.data.openTime = new Series([T0]);
        context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } };
        initializeStrategy(context, {
            initial_capital: 1_000,
            default_qty_value: 1,
            commission_type: 'percent',
            commission_value: 0,
        });
        context.strategy.opentrades.push({
            id: 'trade_1',
            entry_id: 'L',
            entry_price: 100,
            entry_bar_index: 0,
            entry_time: T0,
            size: 2,
            commission: 0,
            max_drawdown: 0,
            max_runup: 0,
            status: 'open',
        });
        context.strategy.position_size = 2;
        context.strategy.position_avg_price = 100;

        // The broker can only close the two contracts actually held. A prior
        // implementation applied the requested 10 contracts to position_size
        // after correctly limiting the ledger close, leaving -8 contracts.
        closePartialPosition(context, 10, 110, T0 + 60_000);

        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.opentrades).toHaveLength(0);
        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.closedtrades[0].size).toBe(2);
        expect(context.strategy.closedtrades[0].profit).toBe(20);
    });

    it('charges cash_per_order once when one close order consumes multiple FIFO lots', async () => {
        const result: any = await new PineTS([
            bar(0, 100, 100, 100, 100),
            bar(1, 100, 110, 100, 110),
            bar(2, 110, 120, 110, 120),
            bar(3, 120, 120, 120, 120),
        ] as any, 'BTCUSDT', '1').run(`
//@version=6
strategy('cash per order close',
    initial_capital=1000,
    pyramiding=10,
    commission_type=strategy.commission.cash_per_order,
    commission_value=10)

if bar_index == 0
    strategy.entry('A', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('B', strategy.long, qty=1)
if bar_index == 2
    strategy.close_all()
`);

        expect(result.strategy.closedtrades).toHaveLength(2);
        // Gross profit is 20 + 10. Two entry orders and the one close order
        // cost 10 each, so net profit is exactly zero.
        expect(result.strategy.netprofit).toBeCloseTo(0, 10);
        const totalCommission = result.strategy.closedtrades
            .reduce((sum: number, trade: any) => sum + Number(trade.commission ?? 0), 0);
        expect(totalCommission).toBeCloseTo(30, 10);
        expect(result.strategy.closedtrades.map((trade: any) => trade.profit))
            .toEqual([5, -5]);
    });

    it('splits one reversal order fee across its close and open legs', async () => {
        const result: any = await new PineTS([
            bar(0, 100, 100, 100, 100),
            bar(1, 100, 110, 100, 110),
            bar(2, 110, 120, 110, 120),
            bar(3, 120, 120, 120, 120),
        ] as any, 'BTCUSDT', '1').run(`
//@version=6
strategy('cash per order reversal',
    initial_capital=1000,
    pyramiding=10,
    commission_type=strategy.commission.cash_per_order,
    commission_value=10)

if bar_index == 0
    strategy.entry('A', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('B', strategy.long, qty=1)
if bar_index == 2
    strategy.entry('S', strategy.short, qty=3)
`);

        expect(result.strategy.closedtrades).toHaveLength(2);
        expect(result.strategy.opentrades).toHaveLength(1);
        const closedCommission = result.strategy.closedtrades
            .reduce((sum: number, trade: any) => sum + Number(trade.commission ?? 0), 0);
        const openCommission = Number(result.strategy.opentrades[0].commission ?? 0);
        // A and B cost 10 each; the reversal order costs 10 once, split as
        // 5 on the close leg and 5 on the new short entry.
        expect(closedCommission + openCommission).toBeCloseTo(30, 10);
        expect(openCommission).toBeCloseTo(5, 10);
    });
});
