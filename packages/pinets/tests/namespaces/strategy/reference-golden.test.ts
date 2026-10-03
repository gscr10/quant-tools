// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 LuxAlgo

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

/**
 * Independent broker-golden fixture.
 *
 * The expected rows below are deliberately written as a value table rather
 * than derived from the PineTS context.  This keeps the test useful when the
 * broker changes: a regression must either preserve the documented execution
 * path or update the fixture with an independently reviewed result.
 */
const HOUR = 60 * 60_000;
const TEN_MINUTE = 10 * 60_000;
const T0 = Date.UTC(2024, 0, 1);

function parent(index: number, open: number, high: number, low: number, close: number) {
    return { openTime: T0 + index * HOUR, closeTime: T0 + (index + 1) * HOUR, open, high, low, close, volume: 1 };
}

function child(index: number, open: number, high: number, low: number, close: number) {
    return { openTime: T0 + index * TEN_MINUTE, closeTime: T0 + (index + 1) * TEN_MINUTE, open, high, low, close, volume: 1 };
}

const PARENTS = [
    parent(0, 100, 101, 99, 100),
    parent(1, 100, 110, 90, 100),
    parent(2, 100, 103, 97, 101),
    parent(3, 101, 103, 95, 101),
];

const CHILDREN = [
    ...Array.from({ length: 6 }, (_, index) => child(index, 100, 101, 99, 100)),
    // The lower feed travels down first.  The stop therefore wins over the
    // later 110 high that is present on the parent candle.
    child(6, 100, 100, 95, 96),
    child(7, 96, 110, 96, 108),
    ...Array.from({ length: 4 }, (_, index) => child(8 + index, 108, 109, 107, 108)),
    child(12, 100, 100, 95, 96),
    ...Array.from({ length: 5 }, (_, index) => child(13 + index, 96, 103, 96, 101)),
    child(18, 101, 101, 95, 96),
    ...Array.from({ length: 5 }, (_, index) => child(19 + index, 96, 103, 96, 101)),
];

describe('TradingView-style execution golden', () => {
    it('keeps lower-timeframe stop ordering and trade excursions deterministic', async () => {
        const source = `
//@version=6
strategy('reference golden', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1, use_bar_magnifier=true)
if bar_index == 0
    strategy.entry('L', strategy.long)
if bar_index == 2
    strategy.exit('X', 'L', stop=95, limit=110)
`;
        const context: any = await new PineTS(
            PARENTS as any,
            'BTCUSDT',
            '60',
            undefined,
            undefined,
            undefined,
            { barMagnifier: { requested: true, lowerTimeframe: '10', bars: CHILDREN } },
        ).run(source);

        expect(context.executionPrecision).toMatchObject({
            requested: true,
            applied: true,
            appliedPrecision: 'lower-timeframe',
            coveredParentBars: 4,
            coverage: 1,
        });

        const closed = context.strategy.closedtrades.map((trade: any) => ({
            entry_id: trade.entry_id,
            exit_id: trade.exit_id,
            entry_price: trade.entry_price,
            exit_price: trade.exit_price,
            entry_bar_index: trade.entry_bar_index,
            exit_bar_index: trade.exit_bar_index,
            entry_time: trade.entry_time,
            exit_time: trade.exit_time,
            size: trade.size,
            profit: trade.profit,
            max_drawdown: trade.max_drawdown,
            max_runup: trade.max_runup,
        }));

        expect(closed).toEqual([{
            entry_id: 'L',
            exit_id: 'X',
            entry_price: 100,
            exit_price: 95,
            entry_bar_index: 1,
            exit_bar_index: 3,
            entry_time: T0 + HOUR,
            exit_time: T0 + 18 * TEN_MINUTE,
            size: 1,
            profit: -5,
            max_drawdown: 5,
            max_runup: 0,
        }]);
        expect(context.strategy.opentrades).toHaveLength(0);
    });
});
