import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const HOUR = 3_600_000;
const CHILD = 600_000;
const T0 = Date.UTC(2024, 0, 1);
const row = (time: number, duration: number, open: number, high: number, low: number, close: number) => ({
    openTime: time, closeTime: time + duration, open, high, low, close, volume: 1,
});

// Parent 1 travels 100 -> 105 -> 90 -> 95 in its first child, then stays at
// 95. An order created at the 90 endpoint cannot use the earlier 105 price.
const parents = [row(T0, HOUR, 100, 100, 100, 100), row(T0 + HOUR, HOUR, 100, 105, 90, 95)];
const children = [
    ...Array.from({ length: 6 }, (_, i) => row(T0 + i * CHILD, CHILD, 100, 100, 100, 100)),
    row(T0 + HOUR, CHILD, 100, 105, 90, 95),
    ...Array.from({ length: 5 }, (_, i) => row(T0 + HOUR + (i + 1) * CHILD, CHILD, 95, 95, 95, 95)),
];

const run = (body: string, extra = '') => new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined, {
    barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
}).run(`//@version=6
strategy('recalculation causality', initial_capital=10000, calc_on_every_tick=true${extra})
${body}
`);

describe('same-parent lower-timeframe order causality', () => {
    it('does not fill a newly created take-profit using a price already crossed', async () => {
        const result = await run(`
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1 and close == 90
    strategy.exit('late TP', 'L', limit=103)
`);
        expect(result.executionPrecision.applied).toBe(true);
        expect(result.strategy.closedtrades).toHaveLength(0);
        expect(result.strategy.opentrades).toMatchObject([{ entry_price: 100, size: 1 }]);
        expect(result.strategy._fill_events!.map(fill => [fill.sourceOrderId, fill.price])).toEqual([['L', 100]]);
    });

    it('allows a stop created by recalculation to fill on the next price point of the same parent', async () => {
        const result = await run(`
if bar_index == 1 and close == 90
    strategy.entry('new stop', strategy.long, qty=2, stop=94)
`);
        expect(result.strategy.opentrades).toMatchObject([{ entry_id: 'new stop', entry_price: 94, entry_bar_index: 1, size: 2 }]);
        expect(result.strategy._fill_events!.map(fill => [fill.sourceOrderId, fill.price, fill.time])).toEqual([
            ['new stop', 94, T0 + HOUR],
        ]);
        expect(result.strategy.netprofit).toBe(0);
        expect(result.strategy.openprofit).toBe(2);
        expect(result.strategy._report_series).toHaveLength(2);
    });

    it('allows a market close from recalculation at the next child open, without waiting another parent', async () => {
        const result = await run(`
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1 and close == 90
    strategy.close('L')
`);
        expect(result.strategy.closedtrades).toMatchObject([{
            entry_price: 100, exit_price: 95, exit_bar_index: 1, exit_time: T0 + HOUR + CHILD, profit: -5,
        }]);
        expect(result.strategy.opentrades).toHaveLength(0);
    });

    it('matches the previous bracket before every-tick replacement at a later endpoint', async () => {
        const result = await run(`
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if strategy.position_size > 0
    strategy.exit('TP', 'L', limit=103)
`);
        expect(result.strategy.closedtrades).toMatchObject([{
            entry_price: 100, exit_price: 103, exit_bar_index: 1, profit: 3,
        }]);
        expect(result.strategy.opentrades).toHaveLength(0);
        expect(result.strategy._report_series).toHaveLength(2);
    });

    it.each([[false, 'entry'], [true, 'entry'], [false, ' entry '], [true, ' entry ']] as const)(
        'fills the nearer OCA stop first even when declared later (magnified=%s, name=%s)', async (magnified, farName) => {
        const pathParents = [row(T0, HOUR, 100, 100, 100, 100), row(T0 + HOUR, HOUR, 100, 115, 99, 110)];
        const pathChildren = [
            ...children.slice(0, 6), row(T0 + HOUR, CHILD, 100, 115, 99, 110),
            ...Array.from({ length: 5 }, (_, i) => row(T0 + HOUR + (i + 1) * CHILD, CHILD, 110, 110, 110, 110)),
        ];
        const result = await new PineTS(pathParents, 'BTCUSDT', '60', undefined, undefined, undefined,
            magnified ? { barMagnifier: { requested: true, lowerTimeframe: '10', bars: pathChildren } } : undefined).run(`//@version=6
strategy('OCA path order', initial_capital=10000)
if bar_index == 0
    strategy.order('far', strategy.long, qty=1, stop=110, oca_name='${farName}', oca_type=strategy.oca.cancel)
    strategy.order('near', strategy.long, qty=1, stop=105, oca_name='entry', oca_type=strategy.oca.cancel)
`);
        // The chosen path is 100 -> 99 -> 115 -> 110: it crosses 105 before
        // 110. Declaration order must not change which OCA sibling survives.
        expect(result.strategy.opentrades).toMatchObject([{ entry_id: 'near', entry_price: 105 }]);
        expect(result.strategy._fill_events!.map(fill => fill.sourceOrderId)).toEqual(['near']);
    });

    it('uses the reverse crossing order for OCA short stops and preserves equal-level source order', async () => {
        for (const equal of [false, true]) {
            const result = await run(`
if bar_index == 0
    strategy.order('first', strategy.short, qty=1, stop=${equal ? 98 : 92}, oca_name='short', oca_type=strategy.oca.cancel)
    strategy.order('second', strategy.short, qty=1, stop=98, oca_name='short', oca_type=strategy.oca.cancel)
`);
            // 105 -> 90 crosses 98 before 92. At an equal trigger retain the
            // declaration order as a deterministic same-price tie-breaker.
            expect(result.strategy.opentrades).toMatchObject([{
                entry_id: equal ? 'first' : 'second', entry_price: 98, size: -1,
            }]);
            expect(result.strategy._fill_events).toHaveLength(1);
        }
    });

    it('keeps calc_on_order_fills follow-up entry and fees within the same parent', async () => {
        const result = await run(`
if bar_index == 0
    strategy.entry('A', strategy.long, qty=1)
    strategy.exit('TP', 'A', limit=103)
if strategy.closedtrades > 0 and strategy.position_size == 0
    strategy.entry('B', strategy.short, qty=1, stop=98)
`, ', calc_on_order_fills=true, commission_type=strategy.commission.cash_per_order, commission_value=1');
        expect(result.strategy.closedtrades).toMatchObject([{ entry_id: 'A', entry_price: 100, exit_price: 103, profit: 1 }]);
        expect(result.strategy.opentrades).toMatchObject([{ entry_id: 'B', entry_price: 98, entry_bar_index: 1, size: -1 }]);
        expect(result.strategy.netprofit).toBe(0); // +3 gross, three actual orders at $1 each
        expect(result.strategy.openprofit).toBe(3); // short 98 marked to 95
        expect(result.strategy._fill_events!.map(fill => fill.sourceOrderId)).toEqual(['A', 'TP', 'B']);
        expect(result.strategy._report_series).toHaveLength(2);
    });
});
