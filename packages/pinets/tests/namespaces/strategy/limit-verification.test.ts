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

describe('backtest_fill_limits_assumption', () => {
    it('requires the configured verification distance but fills at the requested limit', async () => {
        const bars = [
            bar(0, 100, 101, 99, 100),
            // The limit is touched, but price does not move one full dollar
            // beyond it (mintick is 0.01; assumption=100).
            bar(1, 100, 101, 98.5, 100),
            // This bar verifies the limit and should fill at 99, not 97.
            bar(2, 100, 101, 97, 100),
        ];
        const source = `
//@version=6
strategy('limit verification', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1, backtest_fill_limits_assumption=100)
if bar_index == 0
    strategy.entry('L', strategy.long, limit=99)
`;
        const result: any = await new PineTS(bars as any, 'BTCUSDT', '60').run(source);
        expect(result.strategy.opentrades[0]).toMatchObject({
            entry_price: 99,
            entry_bar_index: 2,
        });
    });

    it('keeps the legacy immediate-touch behavior when the assumption is zero', async () => {
        const bars = [
            bar(0, 100, 101, 99, 100),
            bar(1, 100, 101, 98.5, 100),
        ];
        const source = `
//@version=6
strategy('zero verification', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, limit=99)
`;
        const result: any = await new PineTS(bars as any, 'BTCUSDT', '60').run(source);
        expect(result.strategy.opentrades[0]).toMatchObject({
            entry_price: 99,
            entry_bar_index: 1,
        });
    });
});
