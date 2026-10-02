import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const HOUR = 60 * 60_000;
const TEN_MIN = 10 * 60_000;
const T0 = Date.UTC(2024, 0, 1);

function parent(index: number, open: number, high: number, low: number, close: number) {
    return {
        openTime: T0 + index * HOUR,
        closeTime: T0 + (index + 1) * HOUR,
        open, high, low, close, volume: 1,
    };
}

function child(index: number, open: number, high: number, low: number, close: number) {
    return {
        openTime: T0 + index * TEN_MIN,
        closeTime: T0 + (index + 1) * TEN_MIN,
        open, high, low, close, volume: 1,
    };
}

const PARENTS = [
    parent(0, 100, 101, 99, 100),
    parent(1, 100, 112, 94, 105),
];

const CHILDREN = [
    ...Array.from({ length: 6 }, (_, index) => child(index, 100, 101, 99, 100)),
    child(6, 100, 101, 99, 100),
    child(7, 100, 100, 94, 95),
    child(8, 95, 111, 95, 110),
    ...Array.from({ length: 3 }, (_, index) => child(9 + index, 110, 111, 109, 110)),
];

const MAGNIFIER = { requested: true, lowerTimeframe: '10', bars: CHILDREN } as const;

describe('strategy recalculation controls', () => {
    it('keeps order-fill recalculation opt-in and scoped to the lower path', async () => {
        const source = `
//@version=6
strategy('recalc', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1, calc_on_order_fills=true)
if bar_index == 0
    strategy.entry('L', strategy.long, limit=95)
if strategy.position_size > 0
    strategy.exit('X', 'L', limit=110)
`;
        const enabled: any = await new PineTS(PARENTS as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: MAGNIFIER,
        }).run(source);
        expect(enabled.strategy.closedtrades).toHaveLength(1);
        expect(enabled.strategy.closedtrades[0]).toMatchObject({ exit_bar_index: 1, exit_price: 110 });
        expect(enabled.strategy._report_series).toHaveLength(PARENTS.length);

        const disabled: any = await new PineTS(PARENTS as any, 'BTCUSDT', '60').run(source.replace(', calc_on_order_fills=true', ''));
        expect(disabled.strategy.closedtrades).toHaveLength(0);
        expect(disabled.strategy.opentrades).toHaveLength(1);
    });

    it('runs calc_on_every_tick passes on simulated lower-timeframe points without duplicating report rows', async () => {
        const source = `
//@version=6
strategy('tick recalc', initial_capital=1000, calc_on_every_tick=true)
var int passes = 0
passes += 1
plot(passes, 'passes')
`;
        const result: any = await new PineTS(PARENTS as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: MAGNIFIER,
        }).run(source);
        const values = (result.plots?.passes?.data ?? []).map((point: any) => point.value);
        expect(values).toHaveLength(PARENTS.length);
        // First bar has no strategy state until its normal script pass.  The
        // second bar has 4 synthetic points per child (4 children) plus the
        // ordinary parent pass: 1, then 18+ in the final series.  Keep this
        // as a lower bound so provider child-count changes do not turn the
        // contract into a brittle exact visual fixture.
        expect(Number(values[0])).toBe(1);
        expect(Number(values[1])).toBeGreaterThan(Number(values[0]) + 1);
    });

    it('recalculates after a process_orders_on_close fill without duplicating report rows', async () => {
        const source = `
//@version=6
strategy('close-fill recalc', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1, process_orders_on_close=true, calc_on_order_fills=true)
if bar_index == 0
    strategy.entry('L', strategy.long)
// This condition is true only in the fill-triggered pass on bar zero. The
// close order is then consumed at bar one open; without the missing close-pass
// recalculation it is never queued and the trade remains open.
if bar_index == 0 and strategy.position_size > 0
    strategy.close('L')
plot(strategy.position_size, 'position')
`;
        const result: any = await new PineTS([
            parent(0, 100, 110, 100, 110),
            parent(1, 120, 125, 115, 120),
        ] as any, 'BTCUSDT', '60').run(source);

        expect(result.strategy.closedtrades).toHaveLength(1);
        expect(result.strategy.closedtrades[0]).toMatchObject({
            entry_bar_index: 0,
            entry_price: 110,
            exit_bar_index: 1,
            exit_price: 120,
        });
        expect(result.strategy.opentrades).toHaveLength(0);
        expect(result.strategy._report_series).toHaveLength(2);
        expect(result.plots.position.data).toHaveLength(2);
    });
});
