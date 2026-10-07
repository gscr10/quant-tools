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

describe('process_orders_on_close', () => {
    it.each(['stop=95', 'limit=105'])('fills a close-created marketable %s at the available close', async (trigger) => {
        const result = await new PineTS([bar(0, 90, 110, 80, 100)], 'BTCUSDT', '60').run(`//@version=6
strategy('marketable close', initial_capital=1000, process_orders_on_close=true)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1, ${trigger})
`);
        expect(result.strategy.opentrades).toMatchObject([{ entry_price: 100, entry_bar_index: 0 }]);
    });

    it('cannot retroactively fill a stop created at close against an earlier high', async () => {
        const result = await new PineTS([
            bar(0, 100, 110, 90, 100), bar(1, 100, 102, 98, 100),
        ], 'BTCUSDT', '60').run(`//@version=6
strategy('close causality', initial_capital=1000, process_orders_on_close=true)
if bar_index == 0
    strategy.entry('late stop', strategy.long, qty=1, stop=105)
`);
        expect(result.strategy.opentrades).toHaveLength(0);
        expect(result.strategy._fill_events).toHaveLength(0);
    });

    it('does not assign pre-entry extremes or a past take-profit to a close-priced entry', async () => {
        const result = await new PineTS([
            bar(0, 100, 110, 90, 100),
        ], 'BTCUSDT', '60').run(`//@version=6
strategy('close bracket causality', initial_capital=1000, process_orders_on_close=true)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
    strategy.exit('TP', 'L', limit=105)
`);
        expect(result.strategy.closedtrades).toHaveLength(0);
        expect(result.strategy.opentrades).toMatchObject([{ entry_price: 100, max_runup: 0, max_drawdown: 0 }]);
        expect(result.strategy._report_series![0]).toMatchObject({ maxDrawdown: 0, equity: 1000 });
    });

    it('fills a market entry on the creating bar close only when enabled', async () => {
        const bars = [
            bar(0, 100, 112, 98, 110),
            bar(1, 120, 121, 119, 120),
        ];
        const source = `
//@version=6
strategy('close entry', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1, process_orders_on_close=true)
if bar_index == 0
    strategy.entry('L', strategy.long)
`;
        const enabled: any = await new PineTS(bars as any, 'BTCUSDT', '60').run(source);
        expect(enabled.strategy.opentrades[0]).toMatchObject({
            entry_price: 110,
            entry_bar_index: 0,
        });

        const defaultSource = source.replace(', process_orders_on_close=true', '');
        const disabled: any = await new PineTS(bars as any, 'BTCUSDT', '60').run(defaultSource);
        expect(disabled.strategy.opentrades[0]).toMatchObject({
            entry_price: 120,
            entry_bar_index: 1,
        });
    });

    it('closes a position at the current close without creating a duplicate trade', async () => {
        const bars = [
            bar(0, 100, 105, 99, 102),
            bar(1, 103, 111, 102, 110),
            bar(2, 111, 112, 109, 111),
        ];
        const source = `
//@version=6
strategy('close exit', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1, process_orders_on_close=true)
if bar_index == 0
    strategy.entry('L', strategy.long)
if bar_index == 1
    strategy.close('L')
`;
        const result: any = await new PineTS(bars as any, 'BTCUSDT', '60').run(source);
        expect(result.strategy.closedtrades).toHaveLength(1);
        expect(result.strategy.closedtrades[0]).toMatchObject({
            entry_price: 102,
            entry_bar_index: 0,
            exit_price: 110,
            exit_bar_index: 1,
        });
        expect(result.strategy.opentrades).toHaveLength(0);
        expect(result.strategy._report_series).toHaveLength(3);
        // The close pass updates the same parent-bar report tail; it must not
        // leave the pre-close unrealized snapshot behind.
        expect(result.strategy._report_series[1].equity).toBe(1008);
        expect(result.strategy._report_series[1].realizedPnl).toBe(8);
        expect(result.strategy._report_series[1].openPnl).toBe(0);
    });

    it('honors close(immediately=true) without requiring process_orders_on_close', async () => {
        const bars = [
            bar(0, 100, 101, 99, 100),
            bar(1, 105, 112, 104, 110),
            bar(2, 120, 121, 119, 120),
        ];
        const source = `
//@version=6
strategy('immediate close', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
if bar_index == 1 and strategy.position_size > 0
    strategy.close('L', immediately=true)
`;
        const result: any = await new PineTS(bars as any, 'BTCUSDT', '60').run(source);
        expect(result.strategy.closedtrades).toHaveLength(1);
        expect(result.strategy.closedtrades[0]).toMatchObject({
            entry_bar_index: 1,
            entry_price: 105,
            exit_bar_index: 1,
            exit_price: 110,
        });
        expect(result.strategy.opentrades).toHaveLength(0);
    });
});
