import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const START = Date.UTC(2024, 0, 1);
const MINUTE = 60_000;

function bars(prices: number[]) {
    return prices.map((price, index) => ({
        openTime: START + index * MINUTE, closeTime: START + (index + 1) * MINUTE,
        open: price, high: price, low: price, close: price, volume: 1,
    }));
}

const SOURCE = `//@version=6
strategy('Boundary accounting', initial_capital=10000, pyramiding=2, close_entries_rule='RULE',
    commission_type=strategy.commission.cash_per_contract, commission_value=1)
if bar_index == 0
    strategy.entry('A', strategy.long, qty=5)
if bar_index == 1
    strategy.entry('B', strategy.long, qty=10)
if bar_index == 2
    strategy.close('B', qty_percent=25)
    strategy.exit('first bracket', from_entry='A', limit=130)
`;

describe('entry accounting boundaries', () => {
    it.each(['FIFO', 'ANY'])('allocates commission once across partial exit and later bracket with %s', async (rule) => {
        const context = await new PineTS(bars([100, 100, 110, 120, 130]), 'BTCUSDT', '1').run(SOURCE.replace('RULE', rule));
        const strategy = context.strategy;
        expect(strategy.position_size).toBe(7.5);
        expect(strategy.position_avg_price).toBe(110);
        expect(strategy.netprofit).toBe(152.5);
        expect(strategy.openprofit).toBe(150);
        expect(strategy.equity).toBe(10302.5);
        expect(strategy.closedtrades.map((trade) => [trade.entry_id, trade.size, trade.profit, trade.commission, trade.max_runup]))
            .toEqual(rule === 'FIFO'
                ? [['A', 2.5, 45, 5, 47.5], ['A', 2.5, 70, 5, 72.5], ['B', 2.5, 45, 5, 47.5]]
                : [['B', 2.5, 20, 5, 22.5], ['A', 5, 140, 10, 145]]);
        expect(strategy._ledger_entries).toMatchObject([{
            entry_id: 'B', entry_price: 110, qty: 7.5, commission: 7.5, max_runup: 142.5,
        }]);
        const closedFees = strategy.closedtrades.reduce((sum, trade) => sum + (trade.commission ?? 0), 0);
        const openFees = strategy._ledger_entries!.reduce((sum, entry) => sum + entry.commission, 0);
        expect(closedFees + openFees).toBe(22.5);
        expect(strategy.closedtrades.reduce((sum, trade) => sum + (trade.profit ?? 0), 0) - openFees).toBe(strategy.netprofit);
    });

    it.each(['FIFO', 'ANY'])('allocates each cash-per-order exit once with %s', async (rule) => {
        const source = SOURCE.replace('RULE', rule).replace('cash_per_contract', 'cash_per_order')
            .replace("strategy.close('B', qty_percent=25)", "strategy.close('B')");
        const context = await new PineTS(bars([100, 100, 110, 120, 130]), 'BTCUSDT', '1').run(source);
        expect(context.strategy.netprofit).toBe(246);
        expect(context.strategy.equity).toBe(10246);
        expect(context.strategy.closedtrades.reduce((sum, trade) => sum + (trade.commission ?? 0), 0)).toBe(4);
        expect(context.strategy._ledger_entries).toEqual([]);
    });

    it.each(['FIFO', 'ANY'])('records a bracket filled on the entry bar once with %s', async (rule) => {
        const candles = bars([100, 100]);
        candles[1] = { ...candles[1], high: 110, low: 99, close: 104 };
        const context = await new PineTS(candles, 'BTCUSDT', '1').run(`//@version=6
strategy('entry-bar bracket', initial_capital=10000, close_entries_rule='${rule}', commission_type=strategy.commission.cash_per_contract, commission_value=1)
if bar_index == 0
    strategy.entry('A', strategy.long, qty=2)
    strategy.exit('bracket', from_entry='A', limit=105)
`);
        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.closedtrades[0]).toMatchObject({
            entry_bar_index: 1, exit_bar_index: 1, entry_price: 100, exit_price: 105,
            size: 2, profit: 6, commission: 4, max_runup: 8,
        });
        expect(context.strategy._ledger_entries).toEqual([]);
        expect(context.strategy.equity).toBe(10006);
    });

    it.each(['FIFO', 'ANY'])('does not recycle a physical entry ID after multiple closes and a fresh entry with %s', async (rule) => {
        const source = SOURCE.replace('RULE', rule).replace('commission_value=1', 'commission_value=0') + `
if bar_index == 4
    strategy.close_all()
if bar_index == 5
    strategy.entry('C', strategy.long, qty=3)
if bar_index == 6
    strategy.close('C', qty=1)
if bar_index == 7
    strategy.close_all()
`;
        const prices = [100, 100, 110, 120, 130, 130, 130, 140, 150];
        const context = await new PineTS(bars(prices), 'BTCUSDT', '1').run(source);
        const closed = context.strategy.closedtrades;
        expect(new Set(closed.map((trade) => trade.id)).size).toBe(closed.length);
        expect(context.strategy._ledger_entries).toEqual([]);
        expect(context.strategy.position_size).toBe(0);
        expect(context.strategy.netprofit).toBe(375);
        expect(closed.filter((trade) => trade.entry_id === 'C').map((trade) => [trade.size, trade.profit])).toEqual([[1, 10], [2, 40]]);
    });

    it('does not reuse a closed id for a newly opened physical lot', async () => {
        const context = await new PineTS(bars([100, 100, 110, 120]), 'BTCUSDT', '1').run(`//@version=6
strategy('id boundary', initial_capital=10000)
if bar_index == 0
    strategy.entry('A', strategy.long, qty=1)
if bar_index == 1
    strategy.close('A')
if bar_index == 2
    strategy.entry('B', strategy.long, qty=1)
`);
        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.closedtrades[0]!.id).not.toBe(context.strategy.opentrades[0]!.id);
        expect(context.strategy.closedtrades[0]!.id).toBe('trade_1');
        expect(context.strategy.opentrades[0]!.id).toBe('trade_2');
    });
});
