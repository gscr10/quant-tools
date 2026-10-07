import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2024, 0, 1);

function bar(index: number, open: number, high: number, low: number, close: number) {
    return {
        openTime: T0 + index * HOUR,
        closeTime: T0 + (index + 1) * HOUR,
        open,
        high,
        low,
        close,
        volume: 1,
    };
}

async function run(bars: ReturnType<typeof bar>[], body: string) {
    const source = `
//@version=6
strategy('OCA semantics', initial_capital=10000, default_qty_type=strategy.fixed, default_qty_value=1)
${body}
`;
    return new PineTS(bars as any, 'BTCUSDT', '60').run(source) as Promise<any>;
}

describe('strategy OCA groups', () => {
    it('oca.cancel cancels sibling pending orders after the first fill', async () => {
        const result = await run([
            bar(0, 100, 101, 99, 100),
            bar(1, 100, 101, 94, 98),
            bar(2, 98, 100, 88, 92),
        ], `
if bar_index == 0
    strategy.order('near', strategy.long, qty=1, limit=95, oca_name='entry-bracket', oca_type=strategy.oca.cancel)
    strategy.order('far', strategy.long, qty=1, limit=90, oca_name='entry-bracket', oca_type=strategy.oca.cancel)
`);

        expect(result.strategy.opentrades).toHaveLength(1);
        expect(result.strategy.opentrades[0]).toMatchObject({
            entry_id: 'near',
            entry_price: 95,
            entry_bar_index: 1,
        });
        expect(result.strategy._order_events).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceOrderId: 'near', kind: 'filled' }),
            expect.objectContaining({ sourceOrderId: 'far', kind: 'cancelled', reason: 'oca.cancel' }),
        ]));
        expect(result.strategy.pending_orders).toHaveLength(0);
    });

    it('oca.reduce subtracts the executed quantity and keeps a positive remainder pending', async () => {
        const result = await run([
            bar(0, 100, 101, 99, 100),
            bar(1, 100, 101, 94, 98),
            bar(2, 98, 100, 88, 92),
        ], `
if bar_index == 0
    strategy.order('first', strategy.long, qty=1, limit=95, oca_name='entry-bracket', oca_type=strategy.oca.reduce)
    strategy.order('second', strategy.long, qty=2, limit=90, oca_name='entry-bracket', oca_type=strategy.oca.reduce)
`);

        expect(result.strategy.opentrades).toHaveLength(2);
        expect(result.strategy.opentrades.map((trade: any) => [trade.entry_id, trade.size, trade.entry_price])).toEqual([
            ['first', 1, 95],
            ['second', 1, 90],
        ]);
        expect(result.strategy._order_events).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceOrderId: 'first', kind: 'filled' }),
            expect.objectContaining({ sourceOrderId: 'second', kind: 'filled' }),
        ]));
        expect(result.strategy.pending_orders).toHaveLength(0);
    });

    it('does not infer an OCA group when the name is omitted', async () => {
        const result = await run([
            bar(0, 100, 101, 99, 100),
            bar(1, 100, 101, 94, 98),
            bar(2, 98, 100, 88, 92),
        ], `
if bar_index == 0
    strategy.order('near', strategy.long, qty=1, limit=95, oca_type=strategy.oca.cancel)
    strategy.order('far', strategy.long, qty=1, limit=90, oca_type=strategy.oca.cancel)
`);

        expect(result.strategy.opentrades).toHaveLength(2);
        expect(result.strategy.opentrades.map((trade: any) => trade.entry_id)).toEqual(['near', 'far']);
    });

    it('orders a mixed stop-limit OCA group by the first actual fill path', async () => {
        const result = await run([
            bar(0, 100, 101, 99, 100),
            // The path reaches 105 before 110. The far stop-limit is declared
            // first, but its limit cannot fill until after its stop activates.
            bar(1, 100, 115, 99, 110),
            bar(2, 110, 110, 110, 110),
        ], `
if bar_index == 0
    strategy.order('far-stop-limit', strategy.long, qty=1, stop=110, limit=111, oca_name='mixed', oca_type=strategy.oca.cancel)
    strategy.order('near-stop', strategy.long, qty=1, stop=105, oca_name='mixed', oca_type=strategy.oca.cancel)
`);

        expect(result.strategy.opentrades).toMatchObject([{ entry_id: 'near-stop', entry_price: 105 }]);
        expect(result.strategy._order_events).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceOrderId: 'near-stop', kind: 'filled' }),
            expect.objectContaining({ sourceOrderId: 'far-stop-limit', kind: 'cancelled', reason: 'oca.cancel' }),
        ]));
    });
});
