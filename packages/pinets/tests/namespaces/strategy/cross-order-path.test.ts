import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const T0 = Date.UTC(2024, 0, 1), HOUR = 3_600_000, CHILD = 600_000;
const row = (time: number, duration: number, open: number, high = open, low = open, close = open) => ({
    openTime: time, closeTime: time + duration - 1, open, high, low, close, volume: 1,
});

describe.each([false, true])('cross-order price-path arbitration (magnified=%s)', magnified => {
    async function run(body: string, pathBar = 1) {
        const parents = Array.from({ length: pathBar + 1 }, (_, i) => i === pathBar
            ? row(T0 + i * HOUR, HOUR, 100, 115, 99, 112) : row(T0 + i * HOUR, HOUR, 100));
        const children = parents.flatMap(parent => [
            { ...parent, closeTime: parent.openTime + CHILD - 1 },
            ...Array.from({ length: 5 }, (_, j) => row(parent.openTime + (j + 1) * CHILD, CHILD, parent.close)),
        ]);
        const result = await new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined,
            magnified ? { barMagnifier: { requested: true, lowerTimeframe: '10', bars: children } } : undefined).run(`//@version=6
strategy('cross-order path', initial_capital=10000, pyramiding=5,
    commission_type=strategy.commission.cash_per_order, commission_value=1)
strategy.risk.max_position_size(1)
${body}`);
        expect(result.executionPrecision.applied).toBe(magnified);
        if (magnified) expect(result.executionPrecision.coverage).toBe(1);
        return result.strategy;
    }

    it('fills an ungrouped nearer stop before a farther stop sharing the position cap', async () => {
        const s = await run(`if bar_index == 0
    strategy.entry('far', strategy.long, qty=1, stop=110)
    strategy.entry('near', strategy.long, qty=1, stop=105)`);
        // Path 100 -> 99 -> 115 -> 112 reaches 105 before 110. The
        // 1-contract cap admits near, then rejects far, independent of code order.
        expect(s.opentrades).toMatchObject([{ entry_id: 'near', entry_price: 105, size: 1 }]);
        expect(s._fill_events?.map(f => [f.sourceOrderId, f.price])).toEqual([['near', 105]]);
        expect(s.netprofit).toBe(-1);
        expect(s.equity).toBe(10006);
    });

    it.each([false, true])('a preceding exit frees capacity before a later entry (exitDeclaredFirst=%s)', async exitFirst => {
        const orders = ["    strategy.exit('TP', 'A', limit=105)", "    strategy.entry('B', strategy.long, qty=1, stop=110)"];
        if (!exitFirst) orders.reverse();
        const s = await run(`if bar_index == 0
    strategy.entry('A', strategy.long, qty=1)
if bar_index == 1
${orders.join('\n')}`, 2);
        // A enters at 100 on bar 1. Bar 2 reaches TP105 before B110:
        // realized +5, three $1 order fees, then B's open gain +2.
        expect(s.closedtrades).toMatchObject([{ entry_id: 'A', exit_id: 'TP', entry_price: 100, exit_price: 105, profit: 3 }]);
        expect(s.opentrades).toMatchObject([{ entry_id: 'B', entry_price: 110, size: 1 }]);
        expect(s._fill_events?.map(f => [f.sourceOrderId, f.price])).toEqual([['A', 100], ['TP', 105], ['B', 110]]);
        expect(s.netprofit).toBe(2);
        expect(s.equity).toBe(10004);
    });

    it('does not free capacity from an exit that occurs after the attempted entry', async () => {
        const s = await run(`if bar_index == 0
    strategy.entry('A', strategy.long, qty=1)
if bar_index == 1
    strategy.exit('TP', 'A', limit=110)
    strategy.entry('B', strategy.long, qty=1, stop=105)`, 2);
        // At 105 A still occupies the cap, so B is rejected. Only later does
        // TP110 close A: gross 10 less two order fees = net 8.
        expect(s.opentrades).toHaveLength(0);
        expect(s._fill_events?.map(f => [f.sourceOrderId, f.price])).toEqual([['A', 100], ['TP', 110]]);
        expect(s.netprofit).toBe(8);
        expect(s.equity).toBe(10008);
    });

    it('preserves entry-first precedence when entry and exit have the exact same crossing price', async () => {
        const s = await run(`if bar_index == 0
    strategy.entry('A', strategy.long, qty=1)
if bar_index == 1
    strategy.exit('TP', 'A', limit=105)
    strategy.entry('B', strategy.long, qty=1, stop=105)`, 2);
        // A tie must not invent a strictly earlier exit. The existing
        // entry-first convention rejects B at the full cap, then exits A.
        expect(s.opentrades).toHaveLength(0);
        expect(s._fill_events?.map(f => [f.sourceOrderId, f.price])).toEqual([['A', 100], ['TP', 105]]);
        expect(s.netprofit).toBe(3);
        expect(s.equity).toBe(10003);
    });
});
