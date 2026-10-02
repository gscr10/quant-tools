// SPDX-License-Identifier: AGPL-3.0-only

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

const BARS = [
    bar(0, 100, 101, 99, 100),
    // The first limit (95) is not reached before the script updates the
    // pending order at the end of this bar.
    bar(1, 100, 101, 96, 100),
    // Both old (95) and new (90) levels are reachable. Only the replacement
    // may fill, otherwise one logical order produces two physical entries.
    bar(2, 100, 101, 89, 95),
];

async function run(body: string): Promise<any> {
    const source = `
//@version=6
strategy('same-id replacement', initial_capital=10000, default_qty_type=strategy.fixed, default_qty_value=1)
${body}
`;
    return new PineTS(BARS as any, 'BTCUSDT', '60').run(source) as Promise<any>;
}

describe('pending order replacement by ID', () => {
    it('replaces an unfilled strategy.entry with the latest price levels', async () => {
        const result = await run(`
if bar_index == 0
    strategy.entry('L', strategy.long, limit=95)
if bar_index == 1
    strategy.entry('L', strategy.long, limit=90)
`);

        expect(result.strategy.opentrades).toHaveLength(1);
        expect(result.strategy.opentrades[0]).toMatchObject({
            entry_id: 'L',
            entry_price: 90,
            entry_bar_index: 2,
        });
        expect(result.strategy._order_events).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceOrderId: 'L', kind: 'cancelled', reason: 'replaced' }),
            expect.objectContaining({ sourceOrderId: 'L', kind: 'filled', fillPrice: 90 }),
        ]));
    });

    it('replaces an unfilled strategy.order with the latest price levels', async () => {
        const result = await run(`
if bar_index == 0
    strategy.order('L', strategy.long, qty=1, limit=95)
if bar_index == 1
    strategy.order('L', strategy.long, qty=1, limit=90)
`);

        expect(result.strategy.opentrades).toHaveLength(1);
        expect(result.strategy.opentrades[0]).toMatchObject({
            entry_id: 'L',
            entry_price: 90,
            entry_bar_index: 2,
        });
        expect(result.strategy._order_events).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceOrderId: 'L', kind: 'cancelled', reason: 'replaced' }),
            expect.objectContaining({ sourceOrderId: 'L', kind: 'filled', fillPrice: 90 }),
        ]));
    });

    it('does not count a replaced same-bar market entry toward reversal size', async () => {
        const result = await run(`
if bar_index == 0
    strategy.entry('L', strategy.long)
    strategy.entry('L', strategy.short)
`);

        expect(result.strategy.opentrades).toHaveLength(1);
        expect(result.strategy.opentrades[0]).toMatchObject({
            entry_id: 'L',
            entry_price: 100,
            entry_bar_index: 1,
            size: -1,
        });
    });
});
