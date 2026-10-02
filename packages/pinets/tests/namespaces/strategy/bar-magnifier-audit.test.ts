import { describe, expect, it } from 'vitest';
import { Context } from '../../../src/Context.class';
import { PineTS } from '../../../src/PineTS.class';
import { Series } from '../../../src/Series';
import { initializeStrategy, processExitOrders } from '../../../src/namespaces/strategy/utils';

const H = 60 * 60_000;
const M10 = 10 * 60_000;
const T0 = Date.UTC(2024, 0, 1);
const parent = (i: number, open: number, high: number, low: number, close: number) => ({
    openTime: T0 + i * H,
    closeTime: T0 + (i + 1) * H,
    open, high, low, close, volume: 1,
});
const child = (i: number, open: number, high: number, low: number, close: number) => ({
    openTime: T0 + i * M10,
    closeTime: T0 + (i + 1) * M10,
    open, high, low, close, volume: 1,
});

describe('Bar Magnifier execution edge cases', () => {
    it('fills gap-through limit/stop entries at the child open, not the trigger level', async () => {
        const parents = [
            parent(0, 100, 101, 99, 100),
            parent(1, 90, 100, 89, 95),
            parent(2, 95, 96, 94, 95),
        ];
        const children = [
            ...Array.from({ length: 6 }, (_, i) => child(i, 100, 101, 99, 100)),
            child(6, 90, 95, 89, 94),
            ...Array.from({ length: 5 }, (_, i) => child(7 + i, 94, 96, 93, 95)),
            ...Array.from({ length: 6 }, (_, i) => child(12 + i, 95, 96, 94, 95)),
        ];
        const source = `
//@version=6
strategy('Gap order', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, limit=95)
`;
        const chart: any = await new PineTS(parents as any, 'BTCUSDT', '60').run(source);
        const ctx: any = await new PineTS(parents as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
        }).run(source);
        // The fork's pre-existing chart-OHLC contract fills at the literal
        // order price. Child-open gap pricing is magnified-path-only.
        expect(chart.strategy.opentrades[0]?.entry_price).toBe(95);
        expect(ctx.strategy.opentrades[0]?.entry_price).toBe(90);
    });

    it('applies the same gap rule symmetrically to short limits and both stops', async () => {
        const cases = [
            { id: 'short-limit', direction: 'strategy.short', order: 'limit=105', expected: 110, open: 110, high: 110, low: 105, close: 110 },
            { id: 'long-stop', direction: 'strategy.long', order: 'stop=105', expected: 110, open: 110, high: 110, low: 109, close: 110 },
            { id: 'short-stop', direction: 'strategy.short', order: 'stop=95', expected: 90, open: 90, high: 91, low: 90, close: 90 },
        ];
        for (const testCase of cases) {
            const parents = [
                parent(0, 100, 101, 99, 100),
                parent(1, testCase.open, testCase.high, testCase.low, testCase.close),
                parent(2, testCase.close, testCase.close + 1, testCase.close - 1, testCase.close),
            ];
            const children = [
                ...Array.from({ length: 6 }, (_, i) => child(i, 100, 101, 99, 100)),
                child(6, testCase.open, testCase.high, testCase.low, testCase.close),
                ...Array.from({ length: 5 }, (_, i) => child(7 + i, testCase.close, testCase.close + 1, testCase.close - 1, testCase.close)),
                ...Array.from({ length: 6 }, (_, i) => child(12 + i, testCase.close, testCase.close + 1, testCase.close - 1, testCase.close)),
            ];
            const source = `
//@version=6
strategy('Gap order ${testCase.id}', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('${testCase.id}', ${testCase.direction}, ${testCase.order})
`;
            const ctx: any = await new PineTS(parents as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
                barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
            }).run(source);
            expect(ctx.strategy.opentrades[0]?.entry_price, testCase.id).toBe(testCase.expected);
        }
    });

    it('keeps a trail open when the active child arms after an adverse leg without retracing', async () => {
        const parents = [
            parent(0, 100, 101, 99, 100),
            parent(1, 100, 110, 95, 110),
            parent(2, 110, 110, 110, 110),
        ];
        const children = [
            ...Array.from({ length: 6 }, (_, i) => child(i, 100, 101, 99, 100)),
            ...Array.from({ length: 5 }, (_, i) => child(6 + i, 100, 101, 99, 100)),
            child(11, 100, 110, 95, 110),
            ...Array.from({ length: 6 }, (_, i) => child(12 + i, 110, 110, 110, 110)),
        ];
        const source = `
//@version=6
strategy('Trail active', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
    strategy.exit('T', 'L', trail_points=200, trail_offset=100)
`;
        const ctx: any = await new PineTS(parents as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
        }).run(source);
        expect(ctx.strategy.closedtrades).toHaveLength(0);
        expect(ctx.strategy.opentrades).toHaveLength(1);
    });

    it('keeps an exit queued before a delayed limit entry until that entry fills', async () => {
        const parents = [
            parent(0, 100, 101, 99, 100),
            parent(1, 100, 112, 94, 105),
            parent(2, 105, 106, 104, 105),
        ];
        const children = [
            ...Array.from({ length: 6 }, (_, i) => child(i, 100, 101, 99, 100)),
            child(6, 100, 101, 99, 100),
            child(7, 100, 100, 94, 95),
            child(8, 95, 111, 95, 110),
            ...Array.from({ length: 3 }, (_, i) => child(9 + i, 110, 111, 109, 110)),
            ...Array.from({ length: 6 }, (_, i) => child(12 + i, 105, 106, 104, 105)),
        ];
        const source = `
//@version=6
strategy('Delayed exit', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, limit=95)
    strategy.exit('X', 'L', limit=110, stop=90)
`;
        const ctx: any = await new PineTS(parents as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
        }).run(source);
        expect(ctx.strategy.closedtrades).toHaveLength(1);
        expect(ctx.strategy.closedtrades[0]).toMatchObject({ exit_id: 'X', exit_price: 110 });
    });

    it('does not let an exit reuse the pre-entry side of the same synthetic segment', async () => {
        const parents = [
            parent(0, 100, 101, 99, 100),
            parent(1, 100, 101, 90, 90),
            parent(2, 90, 90, 90, 90),
        ];
        const children = [
            ...Array.from({ length: 6 }, (_, i) => child(i, 100, 101, 99, 100)),
            // Assumed path is 100 -> 101 -> 90 -> 90. The entry fills at 95
            // on the downward segment, after 101 has already happened. The
            // queued 101 target cannot travel backwards to that old high.
            child(6, 100, 101, 90, 90),
            ...Array.from({ length: 5 }, (_, i) => child(7 + i, 90, 90, 90, 90)),
            ...Array.from({ length: 6 }, (_, i) => child(12 + i, 90, 90, 90, 90)),
        ];
        const source = `
//@version=6
strategy('Causal same-segment exit', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, limit=95)
    strategy.exit('X', 'L', limit=101)
`;
        const ctx: any = await new PineTS(parents as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
        }).run(source);
        expect(ctx.strategy.closedtrades).toHaveLength(0);
        expect(ctx.strategy.opentrades[0]).toMatchObject({ entry_id: 'L', entry_price: 95 });
    });

    it('clips a shared old + newly-pyramided bracket per trade', () => {
        const context: any = new Context({
            marketData: [],
            source: [],
            tickerId: 'BTCUSDT',
            timeframe: '60',
        } as any);
        context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } } as any;
        initializeStrategy(context, { initial_capital: 1000, pyramiding: 2 });
        context.idx = 1;
        context.data.open = new Series([101]);
        context.data.high = new Series([101]);
        context.data.low = new Series([90]);
        context.data.close = new Series([90]);
        context.data.openTime = new Series([T0 + H]);

        const oldTrade = {
            id: 'old', entry_id: 'L', entry_price: 100, _bracket_entry: 100,
            entry_bar_index: 0, entry_time: T0, size: 1, commission: 0,
            max_drawdown: 0, max_runup: 0, status: 'open',
        };
        const newTrade = {
            id: 'new', entry_id: 'L', entry_price: 95, _bracket_entry: 95,
            entry_bar_index: 1, entry_time: T0 + H, size: 1, commission: 0,
            max_drawdown: 5, max_runup: 0, status: 'open',
        };
        context.strategy.opentrades = [oldTrade, newTrade];
        context.strategy.position_size = 2;
        context.strategy.position_avg_price = 97.5;
        context.strategy.pending_orders = [{
            id: 'X', direction: -1, qty: 2, type: 'limit', category: 'exit',
            from_entry: 'L', limit: 101, status: 'pending', bar: 0, time: T0,
        }];
        // The full segment is 101 -> 90. The new lot filled at 95, so its
        // reachable suffix is only 95 -> 90; the old lot did see 101.
        context._barMagnifierTradeExecutionRanges = new Map([
            ['new', { high: 95, low: 90 }],
        ]);

        processExitOrders(context, 'intrabar');

        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.closedtrades[0]).toMatchObject({ entry_price: 100, exit_price: 101, exit_id: 'X' });
        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.opentrades[0]).toMatchObject({ id: 'new', entry_price: 95 });
        expect(context.strategy.pending_orders).toHaveLength(1);
    });

    it('does not let a shared trailing trigger close a lot opened after that trigger was crossed', () => {
        const context: any = new Context({
            marketData: [],
            source: [],
            tickerId: 'BTCUSDT',
            timeframe: '60',
        } as any);
        context.pine = { syminfo: { mintick: 1, pointvalue: 1 } } as any;
        initializeStrategy(context, { initial_capital: 1000, pyramiding: 2 });
        context.idx = 1;
        context.data.open = new Series([110]);
        context.data.high = new Series([110]);
        context.data.low = new Series([100]);
        context.data.close = new Series([100]);
        context.data.openTime = new Series([T0 + H]);

        const oldTrade = {
            id: 'old', entry_id: 'L', entry_price: 100, _bracket_entry: 100,
            entry_bar_index: 0, entry_time: T0, size: 1, commission: 0,
            max_drawdown: 0, max_runup: 10, status: 'open',
        };
        const newTrade = {
            id: 'new', entry_id: 'L', entry_price: 102, _bracket_entry: 102,
            entry_bar_index: 1, entry_time: T0 + H, size: 1, commission: 0,
            max_drawdown: 2, max_runup: 0, status: 'open',
        };
        context.strategy.opentrades = [oldTrade, newTrade];
        context.strategy.position_size = 2;
        context.strategy.position_avg_price = 101;
        context.strategy.pending_orders = [{
            id: 'T', direction: -1, qty: 2, type: 'stop', category: 'exit',
            from_entry: 'L', trail_price: 110, trail_offset: 5,
            trail_peak: 110, trail_armed: true, status: 'pending', bar: 0, time: T0,
        }];
        context._barMagnifierPathDirection = 'down';
        context._barMagnifierPointPhase = 'path';
        context._barMagnifierTradeExecutionRanges = new Map([
            ['new', { high: 102, low: 100 }],
        ]);

        processExitOrders(context, 'intrabar');

        expect(context.strategy.closedtrades).toHaveLength(1);
        expect(context.strategy.closedtrades[0]).toMatchObject({ entry_price: 100, exit_price: 105, exit_id: 'T' });
        expect(context.strategy.opentrades).toHaveLength(1);
        expect(context.strategy.opentrades[0]).toMatchObject({ id: 'new', entry_price: 102 });
        expect(context.strategy.pending_orders).toHaveLength(1);
    });

    it('does not fill a stop-limit at its limit when a child open gaps beyond both prices', async () => {
        const parents = [
            parent(0, 100, 101, 99, 100),
            parent(1, 110, 110, 109, 109),
            parent(2, 109, 109, 109, 109),
        ];
        const children = [
            ...Array.from({ length: 6 }, (_, i) => child(i, 100, 101, 99, 100)),
            // The 110 open activates the 105 stop, but a buy limit at 106 is
            // below the market. No later price reaches 106.
            child(6, 110, 110, 109, 109),
            ...Array.from({ length: 5 }, (_, i) => child(7 + i, 109, 109, 109, 109)),
            ...Array.from({ length: 6 }, (_, i) => child(12 + i, 109, 109, 109, 109)),
        ];
        const source = `
//@version=6
strategy('Gap stop-limit', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.order('SL', strategy.long, qty=1, stop=105, limit=106)
`;
        const ctx: any = await new PineTS(parents as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
        }).run(source);
        expect(ctx.strategy.opentrades).toHaveLength(0);
        expect(ctx.strategy.pending_orders).toHaveLength(1);
        expect(ctx.strategy.pending_orders[0]).toMatchObject({ id: 'SL', status: 'pending', _stopTriggered: true });
    });

    it('fills an armed trailing stop at a gapped child open instead of its stale trigger', async () => {
        const parents = [
            parent(0, 100, 101, 99, 100),
            parent(1, 100, 110, 100, 100),
            parent(2, 100, 100, 100, 100),
        ];
        const children = [
            ...Array.from({ length: 6 }, (_, i) => child(i, 100, 101, 99, 100)),
            // Entry at 100; the move to 110 arms a trail whose trigger is
            // 105. The next child opens directly at 100.
            child(6, 100, 110, 100, 110),
            child(7, 100, 100, 100, 100),
            ...Array.from({ length: 4 }, (_, i) => child(8 + i, 100, 100, 100, 100)),
            ...Array.from({ length: 6 }, (_, i) => child(12 + i, 100, 100, 100, 100)),
        ];
        const source = `
//@version=6
strategy('Trailing child gap', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
    strategy.exit('T', 'L', trail_price=110, trail_offset=500)
`;
        const ctx: any = await new PineTS(parents as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
        }).run(source);
        expect(ctx.strategy.closedtrades).toHaveLength(1);
        expect(ctx.strategy.closedtrades[0]).toMatchObject({ exit_id: 'T', exit_price: 100 });
        // The parent finishes flat, but the strategy still experienced the
        // 100 -> 110 favorable excursion before the gap close.
        expect(ctx.strategy.max_runup).toBe(10);
        expect(ctx.strategy.max_drawdown).toBe(0);
    });

    it('checkpoints global runup before an in-segment exit flattens the parent-bar position', async () => {
        const parents = [
            parent(0, 100, 100, 100, 100),
            parent(1, 100, 105, 100, 100),
            parent(2, 100, 100, 100, 100),
        ];
        const children = [
            ...Array.from({ length: 6 }, (_, i) => child(i, 100, 100, 100, 100)),
            // The market entry fills at this child's open. Its synthetic
            // 100 -> 105 segment then reaches the profit exit and flattens
            // the position before the segment-level post-pass checkpoint.
            child(6, 100, 105, 100, 100),
            ...Array.from({ length: 5 }, (_, i) => child(7 + i, 100, 100, 100, 100)),
            ...Array.from({ length: 6 }, (_, i) => child(12 + i, 100, 100, 100, 100)),
        ];
        const source = `
//@version=6
strategy('In-segment runup checkpoint', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
    strategy.exit('X', 'L', limit=105)
`;
        const ctx: any = await new PineTS(parents as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
        }).run(source);

        expect(ctx.strategy.closedtrades).toHaveLength(1);
        expect(ctx.strategy.closedtrades[0]).toMatchObject({ exit_id: 'X', exit_price: 105 });
        // The final realized P&L is lower because it already includes the
        // exit commission. Global runup must retain the pre-exit 105 mark.
        expect(ctx.strategy.netprofit).toBeCloseTo(2.95, 10);
        expect(ctx.strategy.max_runup).toBe(5);
    });

    it('treats an intrabar-activated stop-limit as a normal limit on later child gaps', async () => {
        const parents = [
            parent(0, 100, 101, 99, 100),
            parent(1, 100, 106, 99, 100),
            parent(2, 100, 101, 99, 100),
        ];
        const children = [
            ...Array.from({ length: 6 }, (_, i) => child(i, 100, 101, 99, 100)),
            // The stop (105) is crossed on the way up, but the lower limit
            // (95) is not reached. The next child opens below the active
            // limit and must
            // fill at that better opening price.
            child(6, 100, 106, 100, 106),
            child(7, 90, 91, 89, 90),
            ...Array.from({ length: 4 }, (_, i) => child(8 + i, 90, 91, 89, 90)),
            ...Array.from({ length: 6 }, (_, i) => child(12 + i, 90, 91, 89, 90)),
        ];
        const source = `
//@version=6
strategy('Deferred stop-limit gap', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.order('SL', strategy.long, qty=1, stop=105, limit=95)
`;
        const ctx: any = await new PineTS(parents as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
        }).run(source);
        expect(ctx.strategy.opentrades[0]).toMatchObject({
            entry_id: 'SL',
            entry_price: 90,
            entry_time: children[7]!.openTime,
            entry_bar_index: 1,
        });
    });

    it('excludes the pre-fill side of a child segment from fill-bar trade excursions', async () => {
        const cases = [
            {
                id: 'long-stop',
                direction: 'strategy.long',
                order: 'stop=105',
                childBar: child(6, 100, 110, 100, 110),
                settledPrice: 110,
                expectedDrawdown: 0,
                expectedRunup: 5,
            },
            {
                id: 'short-stop',
                direction: 'strategy.short',
                order: 'stop=95',
                childBar: child(6, 100, 100, 90, 90),
                settledPrice: 90,
                expectedDrawdown: 0,
                expectedRunup: 5,
            },
            {
                id: 'long-limit',
                direction: 'strategy.long',
                order: 'limit=95',
                childBar: child(6, 100, 100, 90, 90),
                settledPrice: 90,
                expectedDrawdown: 5,
                expectedRunup: 0,
            },
            {
                id: 'short-limit',
                direction: 'strategy.short',
                order: 'limit=105',
                childBar: child(6, 100, 110, 100, 110),
                settledPrice: 110,
                expectedDrawdown: 5,
                expectedRunup: 0,
            },
        ];

        for (const testCase of cases) {
            const parents = [
                parent(0, 100, 101, 99, 100),
                parent(
                    1,
                    testCase.childBar.open,
                    Math.max(testCase.childBar.high, testCase.settledPrice),
                    Math.min(testCase.childBar.low, testCase.settledPrice),
                    testCase.settledPrice,
                ),
                parent(2, testCase.settledPrice, testCase.settledPrice, testCase.settledPrice, testCase.settledPrice),
            ];
            const children = [
                ...Array.from({ length: 6 }, (_, i) => child(i, 100, 101, 99, 100)),
                testCase.childBar,
                ...Array.from({ length: 5 }, (_, i) => child(
                    7 + i,
                    testCase.settledPrice,
                    testCase.settledPrice,
                    testCase.settledPrice,
                    testCase.settledPrice,
                )),
                ...Array.from({ length: 6 }, (_, i) => child(
                    12 + i,
                    testCase.settledPrice,
                    testCase.settledPrice,
                    testCase.settledPrice,
                    testCase.settledPrice,
                )),
            ];
            const source = `
//@version=6
strategy('Fill excursion ${testCase.id}', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('${testCase.id}', ${testCase.direction}, ${testCase.order})
`;
            const ctx: any = await new PineTS(parents as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
                barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
            }).run(source);
            expect(ctx.strategy.opentrades[0]?.max_drawdown, `${testCase.id} MAE`).toBe(testCase.expectedDrawdown);
            expect(ctx.strategy.opentrades[0]?.max_runup, `${testCase.id} MFE`).toBe(testCase.expectedRunup);
        }
    });

    it('does not feed a pre-entry child extreme back into trade or strategy drawdown at parent finalize', async () => {
        const parents = [
            parent(0, 100, 101, 99, 100),
            parent(1, 100, 111, 90, 110),
            parent(2, 110, 110, 110, 110),
        ];
        const children = [
            ...Array.from({ length: 6 }, (_, i) => child(i, 100, 101, 99, 100)),
            // Open is closer to low, so the path is 100 -> 90 -> 111 -> 110.
            // The 105 long stop fills only after the 90 low has passed.
            child(6, 100, 111, 90, 110),
            ...Array.from({ length: 5 }, (_, i) => child(7 + i, 110, 110, 110, 110)),
            ...Array.from({ length: 6 }, (_, i) => child(12 + i, 110, 110, 110, 110)),
        ];
        const source = `
//@version=6
strategy('Post-low stop entry', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long, stop=105)
`;
        const ctx: any = await new PineTS(parents as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
        }).run(source);
        expect(ctx.strategy.opentrades[0]?.entry_price).toBe(105);
        expect(ctx.strategy.opentrades[0]?.max_drawdown).toBe(0);
        expect(ctx.strategy.max_drawdown).toBe(0);
    });

    it('recalculates after a lower-timeframe fill when calc_on_order_fills is enabled', async () => {
        const parents = [
            parent(0, 100, 101, 99, 100),
            parent(1, 100, 112, 94, 105),
            parent(2, 105, 112, 104, 110),
        ];
        const children = [
            ...Array.from({ length: 6 }, (_, i) => child(i, 100, 101, 99, 100)),
            child(6, 100, 101, 99, 100),
            child(7, 100, 100, 94, 95),
            child(8, 95, 111, 95, 110),
            ...Array.from({ length: 3 }, (_, i) => child(9 + i, 110, 111, 109, 110)),
            ...Array.from({ length: 6 }, (_, i) => child(12 + i, 105, 112, 104, 110)),
        ];
        const source = `
//@version=6
strategy('Recalc boundary', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1, calc_on_order_fills=true)
if bar_index == 0
    strategy.entry('L', strategy.long, limit=95)
if strategy.position_size > 0
    strategy.exit('X', 'L', limit=110)
`;
        const ctx: any = await new PineTS(parents as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
        }).run(source);
        // The limit fills on child 7 of parent 1.  The fill-triggered
        // recalculation sees strategy.position_size immediately, queues X,
        // and the remaining child path reaches its 110 limit before parent 1
        // closes.  The public report remains parent-bar cardinality while the
        // trade ledger records the same-parent execution.
        expect(ctx.strategy.closedtrades[0]).toMatchObject({ exit_id: 'X', exit_bar_index: 1 });
    });

});
