// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const MINUTE = 60_000;
const T0 = Date.UTC(2024, 0, 1);

function candle(index: number, open: number, high: number, low: number, close: number) {
    return {
        openTime: T0 + index * MINUTE,
        closeTime: T0 + (index + 1) * MINUTE - 1,
        open,
        high,
        low,
        close,
        volume: 1,
    };
}

const BARS = [
    // The limit order is queued here and can only fill on the next chart bar.
    candle(0, 100, 102, 98, 100),
    // This bar reaches the limit and also contains a wide, intentionally
    // ambiguous OHLC range. A lower-timeframe feed would be needed to decide
    // the exact path; PineTS currently has no such feed in its run contract.
    candle(1, 100, 110, 90, 100),
    candle(2, 100, 101, 99, 100),
];

function source(useBarMagnifier: boolean): string {
    return `
//@version=6
strategy('Bar magnifier boundary',
    initial_capital=1000,
    default_qty_type=strategy.fixed,
    default_qty_value=1,
    use_bar_magnifier=${useBarMagnifier ? 'true' : 'false'})

if bar_index == 0
    strategy.entry('L', strategy.long, qty=1, limit=97)
if bar_index == 1
    strategy.close('L')
`;
}

function stableLedger(context: any) {
    return {
        closed: context.strategy.closedtrades.map((trade: any) => ({
            entry_id: trade.entry_id,
            entry_price: trade.entry_price,
            entry_bar_index: trade.entry_bar_index,
            exit_id: trade.exit_id,
            exit_price: trade.exit_price,
            exit_bar_index: trade.exit_bar_index,
            size: trade.size,
            profit: trade.profit,
        })),
        open: context.strategy.opentrades.map((trade: any) => ({
            entry_id: trade.entry_id,
            entry_price: trade.entry_price,
            entry_bar_index: trade.entry_bar_index,
            size: trade.size,
        })),
        report: context.strategy._report_series,
    };
}

describe('use_bar_magnifier capability boundary', () => {
    it('does not silently claim lower-timeframe execution when enabled', async () => {
        const chartOnly: any = await new PineTS(BARS as any, 'TEST', '60').run(source(false));
        const requested: any = await new PineTS(BARS as any, 'TEST', '60').run(source(true));

        // The declaration is parsed and retained, so callers can expose the
        // user request. It is not an indication that lower bars were loaded.
        expect(chartOnly.strategy.config.use_bar_magnifier).toBe(false);
        expect(requested.strategy.config.use_bar_magnifier).toBe(true);

        // Both runs consume exactly the supplied chart OHLC bars. Until a
        // lower-timeframe market is part of the execution request, enabling
        // the property must not produce a different, fabricated fill path.
        expect(stableLedger(requested)).toEqual(stableLedger(chartOnly));
        expect(requested.strategy._report_series).toHaveLength(BARS.length);
    });
});
