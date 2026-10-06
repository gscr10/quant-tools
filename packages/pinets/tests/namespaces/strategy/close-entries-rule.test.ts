import { describe, expect, it } from 'vitest';

import { PineTS } from '../../../src/PineTS.class';

const START = Date.UTC(2024, 0, 1);
const MINUTE = 60_000;

function bars(prices: number[]) {
    return prices.map((price, index) => ({
        openTime: START + index * MINUTE,
        closeTime: START + (index + 1) * MINUTE,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 1,
    }));
}

async function run(rule: 'FIFO' | 'ANY' | undefined, exit: string, direction = 'long', prices = [100, 100, 110, 120]) {
    return new PineTS(bars(prices), 'BTCUSDT', '1').run(`
//@version=6
strategy('Close entries rule', initial_capital=10000, pyramiding=2${rule ? `, close_entries_rule='${rule}'` : ''})
if bar_index == 0
    strategy.entry('Buy1', strategy.${direction}, qty=5, comment='first entry')
if bar_index == 1
    strategy.entry('Buy2', strategy.${direction}, qty=10, comment='second entry')
if bar_index == 2
    ${exit}
`);
}

describe('TradingView documented close_entries_rule', () => {
    it.each([undefined, 'FIFO'] as const)('pairs a Buy2 market close with oldest entries for %s', async (rule) => {
        const context = await run(rule, "strategy.close('Buy2')");
        expect(context.strategy.closedtrades.map((trade) => ({
            entry: trade.entry_id,
            price: trade.entry_price,
            bar: trade.entry_bar_index,
            comment: trade.entry_comment,
            size: trade.size,
            profit: trade.profit,
        }))).toEqual([
            { entry: 'Buy1', price: 100, bar: 1, comment: 'first entry', size: 5, profit: 100 },
            { entry: 'Buy2', price: 110, bar: 2, comment: 'second entry', size: 5, profit: 50 },
        ]);
        expect(context.strategy.netprofit).toBe(150);
        expect(context.strategy.closedtrades.map((trade) => trade.max_runup)).toEqual([100, 50]);
        expect(context.strategy.openprofit).toBe(50);
        expect(context.strategy.position_size).toBe(5);
        expect(context.strategy.position_avg_price).toBe(110);
        expect(context.strategy.equity).toBe(10200);
    });

    it('uses the requested entry first with ANY', async () => {
        const context = await run('ANY', "strategy.close('Buy2')");
        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.closedtrades[0]).toMatchObject({
            entry_id: 'Buy2', entry_price: 110, size: 10, profit: 100,
            entry_bar_index: 2, entry_comment: 'second entry',
        });
        expect(context.strategy.netprofit).toBe(100);
        expect(context.strategy.openprofit).toBe(100);
        expect(context.strategy.position_size).toBe(5);
        expect(context.strategy.position_avg_price).toBe(100);
        expect(context.strategy.equity).toBe(10200);
    });

    it.each(['FIFO', 'ANY'] as const)('sizes a partial close from its requested ID with %s', async (rule) => {
        const context = await run(rule, "strategy.close('Buy2', qty_percent=25)");
        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.closedtrades[0]).toMatchObject({
            entry_id: rule === 'FIFO' ? 'Buy1' : 'Buy2',
            size: 2.5,
            profit: rule === 'FIFO' ? 50 : 25,
            max_runup: rule === 'FIFO' ? 50 : 25,
        });
        expect(context.strategy.position_size).toBe(12.5);
        expect(context.strategy.equity).toBe(10200);
    });

    it.each(['FIFO', 'ANY'] as const)('applies the rule to conditional exits with %s', async (rule) => {
        const context = await run(rule, "strategy.exit('second exit', from_entry='Buy2', limit=120)");
        expect(context.strategy.closedtrades.map((trade) => [trade.entry_id, trade.size, trade.profit]))
            .toEqual(rule === 'FIFO' ? [['Buy1', 5, 100], ['Buy2', 5, 50]] : [['Buy2', 10, 100]]);
        expect(context.strategy.closedtrades.every((trade) => trade.exit_id === 'second exit')).toBe(true);
        expect(context.strategy.equity).toBe(10200);
    });

    it.each(['FIFO', 'ANY'] as const)('preserves the remaining bracket from the documented example with %s', async (rule) => {
        const context = await run(rule, "strategy.close('Buy2')\n    strategy.exit('first bracket', from_entry='Buy1', limit=130)", 'long', [100, 100, 110, 120, 130]);
        expect(context.strategy.closedtrades.map((trade) => [trade.entry_id, trade.exit_id, trade.size, trade.profit]))
            .toEqual(rule === 'FIFO'
                ? [['Buy1', 'close_Buy2', 5, 100], ['Buy2', 'close_Buy2', 5, 50], ['Buy2', 'first bracket', 5, 100]]
                : [['Buy2', 'close_Buy2', 10, 100], ['Buy1', 'first bracket', 5, 150]]);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.closedtrades.map((trade) => trade.max_runup))
            .toEqual(rule === 'FIFO' ? [100, 50, 100] : [100, 150]);
        expect(context.strategy.opentrades).toHaveLength(0);
        expect(new Set(context.strategy.closedtrades.map((trade) => trade.id)).size).toBe(context.strategy.closedtrades.length);
        expect(context.strategy.netprofit).toBe(250);
        expect(context.strategy.equity).toBe(10250);
    });

    it.each(['FIFO', 'ANY'] as const)('pairs short exits without changing position or total equity with %s', async (rule) => {
        const context = await run(rule, "strategy.close('Buy2')", 'short', [120, 120, 110, 100]);
        expect(context.strategy.closedtrades.map((trade) => [trade.entry_id, trade.size, trade.profit]))
            .toEqual(rule === 'FIFO' ? [['Buy1', -5, 100], ['Buy2', -5, 50]] : [['Buy2', -10, 100]]);
        expect(context.strategy.position_size).toBe(-5);
        expect(context.strategy.equity).toBe(10200);
    });

    it.each(['FIFO', 'ANY'] as const)('leaves the position untouched for a nonexistent requested ID with %s', async (rule) => {
        const context = await run(rule, "strategy.close('missing')");
        expect(context.strategy.closedtrades).toHaveLength(0);
        expect(context.strategy.position_size).toBe(15);
    });

    it.each(['FIFO', 'ANY'] as const)('scales adverse excursion to each consumed ledger slice with %s', async (rule) => {
        const context = await run(rule, "strategy.close('Buy2')", 'long', [100, 100, 90, 80]);
        expect(context.strategy.closedtrades.map((trade) => [trade.entry_id, trade.profit, trade.max_drawdown]))
            .toEqual(rule === 'FIFO' ? [['Buy1', -100, 100], ['Buy2', -50, 50]] : [['Buy2', -100, 100]]);
    });
});
