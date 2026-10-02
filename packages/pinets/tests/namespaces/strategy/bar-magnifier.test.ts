// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const HOUR = 60 * 60_000;
const TEN_MIN = 10 * 60_000;
const T0 = Date.UTC(2024, 0, 1);

function parent(index: number, open: number, high: number, low: number, close: number) {
    return {
        openTime: T0 + index * HOUR,
        closeTime: T0 + (index + 1) * HOUR,
        open, high, low, close, volume: 1,
    };
}

function child(index: number, open: number, high: number, low: number, close: number) {
    return {
        openTime: T0 + index * TEN_MIN,
        closeTime: T0 + (index + 1) * TEN_MIN,
        open, high, low, close, volume: 1,
    };
}

const PARENTS = [
    parent(0, 100, 101, 99, 100),
    parent(1, 100, 101, 99, 100),
    // The chart OHLC path is favorable-first (high before low); child bars
    // deliberately travel low first, so the stop wins under magnification.
    parent(2, 100, 110, 90, 100),
];

const CHILDREN = [
    ...Array.from({ length: 12 }, (_, index) => child(index, 100, 101, 99, 100)),
    child(12, 100, 100, 94, 95),
    child(13, 95, 106, 95, 105),
    child(14, 105, 110, 100, 100),
    child(15, 100, 101, 99, 100),
    child(16, 100, 101, 99, 100),
    child(17, 100, 101, 99, 100),
];

const GAP_PARENTS = [
    parent(0, 100, 101, 99, 100),
    parent(1, 100, 101, 99, 100),
    parent(2, 150, 160, 140, 150),
    parent(3, 150, 151, 149, 150),
];

const GAP_CHILDREN = [
    ...Array.from({ length: 12 }, (_, index) => child(index, 100, 101, 99, 100)),
    ...Array.from({ length: 6 }, (_, index) => child(12 + index, 150, 150, 150, 150)),
    ...Array.from({ length: 6 }, (_, index) => child(18 + index, 150, 160, 140, 150)),
    ...Array.from({ length: 12 }, (_, index) => child(24 + index, 150, 151, 149, 150)),
];

const SOURCE = `
//@version=6
strategy("LTF fixture", initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry("L", strategy.long)
if bar_index >= 1
    strategy.exit("X", "L", stop=95, limit=105)
`;

const DECLARED_MAGNIFIER_SOURCE = `
//@version=6
strategy("LTF declaration", initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1, use_bar_magnifier=true)
if bar_index == 0
    strategy.entry("L", strategy.long)
if bar_index >= 1
    strategy.exit("X", "L", stop=95, limit=105)
`;

const DECLARED_CHART_SOURCE = DECLARED_MAGNIFIER_SOURCE.replace('use_bar_magnifier=true', 'use_bar_magnifier=false');

function rows(context: any) {
    return context.strategy.closedtrades.map((trade: any) => ({
        entry_price: trade.entry_price,
        exit_price: trade.exit_price,
        entry_time: trade.entry_time,
        exit_time: trade.exit_time,
        entry_bar_index: trade.entry_bar_index,
        exit_bar_index: trade.exit_bar_index,
    }));
}

describe('Bar Magnifier lower-timeframe broker path', () => {
    it('accepts the seven complete 2m children of one 15m parent and ignores a crossing eighth row', async () => {
        const fifteenMinutes = 15 * 60_000;
        const twoMinutes = 2 * 60_000;
        const parentRows = [{
            openTime: T0,
            closeTime: T0 + fifteenMinutes,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }];
        const sevenComplete = Array.from({ length: 7 }, (_, index) => ({
            openTime: T0 + index * twoMinutes,
            closeTime: T0 + (index + 1) * twoMinutes,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }));
        const crossingTail = {
            openTime: T0 + 14 * 60_000,
            closeTime: T0 + 16 * 60_000,
            open: 100,
            high: 150,
            low: 50,
            close: 100,
            volume: 1,
        };
        const partialTail = {
            openTime: T0 + 14 * 60_000,
            closeTime: T0 + 15 * 60_000,
            open: 100,
            high: 150,
            low: 50,
            close: 100,
            volume: 1,
        };

        for (const bars of [sevenComplete, [...sevenComplete, crossingTail], [...sevenComplete, partialTail]]) {
            const ctx: any = await new PineTS(
                parentRows as any,
                'BTCUSDT',
                '15',
                undefined,
                undefined,
                undefined,
                { barMagnifier: { requested: true, lowerTimeframe: '2', bars } },
            ).run(SOURCE);
            expect(ctx.executionPrecision).toMatchObject({
                applied: true,
                coveredParentBars: 1,
                coverage: 1,
                lowerBars: bars.length,
            });
        }
    });

    it('accepts a canonical leading child that crosses an odd 15m parent open', async () => {
        const fifteenMinutes = 15 * 60_000;
        const twoMinutes = 2 * 60_000;
        // 00:15 is not on the 2m UTC grid. The provider therefore returns
        // 00:14–00:16 as the first row; it overlaps the parent open and must
        // be ignored, while the seven fully-contained 00:16…00:30 rows remain
        // eligible for replay.
        const parentRows = [{
            openTime: T0 + 15 * 60_000,
            closeTime: T0 + 30 * 60_000,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }];
        const lowerRows = Array.from({ length: 8 }, (_, index) => ({
            openTime: T0 + 14 * 60_000 + index * twoMinutes,
            closeTime: T0 + 16 * 60_000 + index * twoMinutes,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }));
        const ctx: any = await new PineTS(
            parentRows as any,
            'BTCUSDT',
            '15',
            undefined,
            undefined,
            undefined,
            { barMagnifier: { requested: true, lowerTimeframe: '2', bars: lowerRows } },
        ).run(SOURCE);
        expect(ctx.executionPrecision).toMatchObject({ applied: true, coveredParentBars: 1, coverage: 1 });
    });

    it('replays only fully-contained 2m children across consecutive 15m parents', async () => {
        const fifteenMinutes = 15 * 60_000;
        const twoMinutes = 2 * 60_000;
        const parentRows = Array.from({ length: 3 }, (_, index) => ({
            openTime: T0 + index * fifteenMinutes,
            closeTime: T0 + (index + 1) * fifteenMinutes,
            open: 100,
            high: index === 1 ? 110 : 101,
            low: 99,
            close: 100,
            volume: 1,
        }));
        // Keep the provider's fixed 2m UTC grid. Parent 1 has seven complete
        // rows at 16..29; the row at 14..16 crosses the 15m boundary and must
        // be ignored rather than assigned to either parent.
        const crossingRows = Array.from({ length: 22 }, (_, index) => {
            const start = T0 + index * twoMinutes;
            const crossesSecondBoundary = start === T0 + 14 * 60_000;
            return {
                openTime: start,
                closeTime: start + twoMinutes,
                open: 100,
                high: crossesSecondBoundary ? 110 : 101,
                low: 99,
                close: 100,
                volume: 1,
            };
        });
        const partialRows = crossingRows.map((row) => row.openTime === T0 + 14 * 60_000
            ? { ...row, closeTime: T0 + 15 * 60_000 }
            : row);
        const source = `
//@version=6
strategy('15m floor replay', initial_capital=1000, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
    strategy.exit('X', 'L', limit=105)
`;
        for (const lowerRows of [crossingRows, partialRows]) {
            const ctx: any = await new PineTS(
                parentRows as any,
                'BTCUSDT',
                '15',
                undefined,
                undefined,
                undefined,
                { barMagnifier: { requested: true, lowerTimeframe: '2', bars: lowerRows } },
            ).run(source);

            expect(ctx.executionPrecision).toMatchObject({ applied: true, coveredParentBars: 3, coverage: 1 });
            expect(ctx.strategy.closedtrades).toHaveLength(0);
            expect(ctx.strategy.opentrades).toHaveLength(1);
        }
    });

    it('rejects a parent closeTime that expands a 15m candle to 30m', async () => {
        const twoMinutes = 2 * 60_000;
        const malformedParent = [{
            openTime: T0,
            // A provider timestamp may shorten a session candle, but it must
            // never enlarge a fixed 15m parent into a 30m replay window.
            closeTime: T0 + 30 * 60_000,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }];
        const thirtyMinutesOfChildren = Array.from({ length: 15 }, (_, index) => ({
            openTime: T0 + index * twoMinutes,
            closeTime: T0 + (index + 1) * twoMinutes,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }));

        const ctx: any = await new PineTS(
            malformedParent as any,
            'BTCUSDT',
            '15',
            undefined,
            undefined,
            undefined,
            { barMagnifier: { requested: true, lowerTimeframe: '2', bars: thirtyMinutesOfChildren } },
        ).run(SOURCE);

        expect(ctx.executionPrecision).toMatchObject({
            requested: true,
            applied: false,
            coveredParentBars: 0,
            coverage: 0,
            fallbackReason: 'invalid-parent-bars',
        });
    });

    it('rejects a missing/internal 2m child inside a 15m parent floor window', async () => {
        const twoMinutes = 2 * 60_000;
        const parentRows = [{
            openTime: T0,
            closeTime: T0 + 15 * 60_000,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }];
        const withInternalGap = [0, 1, 2, 4, 5, 6].map((index) => ({
            openTime: T0 + index * twoMinutes,
            closeTime: T0 + (index + 1) * twoMinutes,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }));
        const ctx: any = await new PineTS(
            parentRows as any,
            'BTCUSDT',
            '15',
            undefined,
            undefined,
            undefined,
            { barMagnifier: { requested: true, lowerTimeframe: '2', bars: withInternalGap } },
        ).run(SOURCE);
        expect(ctx.executionPrecision).toMatchObject({ applied: false, fallbackReason: 'gapped-lower-bars' });
    });

    it('re-evaluates direct PineTS declarations on each reusable run', async () => {
        // The host envelope may omit `requested` for direct PineTS callers;
        // the declaration itself should still opt into the supplied child
        // feed. A subsequent run with the same instance must not inherit the
        // prior applied mode after the declaration disables the property.
        const pine = new PineTS(PARENTS as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { lowerTimeframe: '10', bars: CHILDREN },
        });
        const magnified: any = await pine.run(DECLARED_MAGNIFIER_SOURCE);
        expect(magnified.executionPrecision).toMatchObject({ applied: true, coveredParentBars: 3 });
        expect(rows(magnified)[0].exit_price).toBe(95);

        const chart: any = await pine.run(DECLARED_CHART_SOURCE);
        expect(chart.executionPrecision).toMatchObject({
            requested: false,
            applied: false,
            appliedPrecision: 'chart-ohlc',
            fallbackReason: 'not-requested',
        });
        expect(rows(chart)[0].exit_price).toBe(105);

        const reverse = new PineTS(PARENTS as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { lowerTimeframe: '10', bars: CHILDREN },
        });
        const chartFirst: any = await reverse.run(DECLARED_CHART_SOURCE);
        expect(chartFirst.executionPrecision).toMatchObject({ requested: false, applied: false });
        expect(rows(chartFirst)[0].exit_price).toBe(105);
        const magnifiedSecond: any = await reverse.run(DECLARED_MAGNIFIER_SOURCE);
        expect(magnifiedSecond.executionPrecision).toMatchObject({ requested: true, applied: true });
        expect(rows(magnifiedSecond)[0].exit_price).toBe(95);
    });

    it('honors an explicit host opt-out over a strategy declaration', async () => {
        const pine = new PineTS(PARENTS as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            // The child feed is present, but the host explicitly disabled the
            // feature for this run. A declaration must not override that
            // decision after the first strategy() call executes.
            barMagnifier: { requested: false, lowerTimeframe: '10', bars: CHILDREN },
        });
        const ctx: any = await pine.run(DECLARED_MAGNIFIER_SOURCE);
        expect(ctx.executionPrecision).toMatchObject({
            requested: false,
            applied: false,
            appliedPrecision: 'chart-ohlc',
            fallbackReason: 'not-requested',
        });
        expect(rows(ctx)[0].exit_price).toBe(105);
    });

    it('replays child OHLC in order and changes the fill path', async () => {
        const chart: any = await new PineTS(PARENTS as any, 'BTCUSDT', '60').run(SOURCE);
        const magnified: any = await new PineTS(PARENTS as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: CHILDREN },
        }).run(SOURCE);

        expect(rows(chart)).toHaveLength(1);
        expect(rows(magnified)).toHaveLength(1);
        expect(rows(chart)[0].exit_price).toBe(105);
        expect(rows(magnified)[0].exit_price).toBe(95);
        expect(rows(magnified)[0].exit_time).toBe(CHILDREN[12]!.openTime);
        // The ledger keeps chart bar indices while fill timestamps identify
        // the lower-timeframe event.
        expect(rows(magnified)[0].exit_bar_index).toBe(2);
        expect(magnified.executionPrecision).toMatchObject({
            requested: true,
            applied: true,
            requestedPrecision: 'lower-timeframe',
            appliedPrecision: 'lower-timeframe',
            lowerTimeframe: '10',
            coveredParentBars: 3,
        });
    });

    it('falls back explicitly for duplicate or partial child coverage', async () => {
        const duplicate = [...CHILDREN.slice(0, -1), CHILDREN[CHILDREN.length - 2]!];
        const duplicateCtx: any = await new PineTS(PARENTS as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: duplicate },
        }).run(SOURCE);
        expect(duplicateCtx.executionPrecision).toMatchObject({ applied: false, fallbackReason: 'duplicate-lower-bars' });

        const partialCtx: any = await new PineTS(PARENTS as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: CHILDREN.slice(2, 5) },
        }).run(SOURCE);
        expect(partialCtx.executionPrecision).toMatchObject({ applied: false, fallbackReason: 'partial-lower-coverage' });
    });

    it('derives child windows from the lower timeframe and rejects gaps', async () => {
        // Provider OHLCV rows normally carry only open time. The validator
        // must infer each child close from the next child (and the final
        // lower-timeframe duration), rather than treating the unknown "10"
        // timeframe as a one-day bar.
        const noCloseTime = CHILDREN.map(({ closeTime: _closeTime, ...bar }) => bar);
        const complete: any = await new PineTS(PARENTS as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: noCloseTime },
        }).run(SOURCE);
        expect(complete.executionPrecision).toMatchObject({ applied: true, coveredParentBars: 3, coverage: 1 });

        const gap = noCloseTime.filter((_bar, index) => index !== 4);
        const gapped: any = await new PineTS(PARENTS as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: gap },
        }).run(SOURCE);
        expect(gapped.executionPrecision).toMatchObject({ applied: false, fallbackReason: 'gapped-lower-bars' });

        const overlap = noCloseTime.map((bar, index) => index === 1
            ? { ...bar, closeTime: bar.openTime + 2 * TEN_MIN }
            : { ...bar, closeTime: bar.openTime + TEN_MIN });
        const overlapped: any = await new PineTS(PARENTS as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: overlap },
        }).run(SOURCE);
        expect(overlapped.executionPrecision).toMatchObject({ applied: false, fallbackReason: 'overlapping-lower-bars' });

        const boundaryTail = [
            ...noCloseTime,
            child(18, 100, 101, 99, 100), // starts exactly at the final parent close
        ];
        const withInclusiveFetchTail: any = await new PineTS(PARENTS as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: boundaryTail },
        }).run(SOURCE);
        expect(withInclusiveFetchTail.executionPrecision).toMatchObject({ applied: true, coveredParentBars: 3 });
    });

    it('accepts Binance-style inclusive closeTime stamps on both feeds', async () => {
        // Binance rows use the last millisecond in each candle as closeTime
        // (e.g. 09:59:59.999), while the broker validator slices half-open
        // windows. The one-millisecond boundary must not force a chart-OHLC
        // fallback or move the child fill to the next parent bar.
        const inclusiveParents = PARENTS.map((bar) => ({ ...bar, closeTime: bar.closeTime! - 1 }));
        const inclusiveChildren = CHILDREN.map((bar) => ({ ...bar, closeTime: bar.closeTime! - 1 }));
        const ctx: any = await new PineTS(inclusiveParents as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: inclusiveChildren },
        }).run(SOURCE);

        expect(ctx.executionPrecision).toMatchObject({
            requested: true,
            applied: true,
            coveredParentBars: PARENTS.length,
            coverage: 1,
        });
        expect(rows(ctx)[0]).toMatchObject({
            exit_price: 95,
            exit_time: inclusiveChildren[12]!.openTime,
            exit_bar_index: 2,
        });
    });

    it('keeps an inclusive early-session parent close bounded by the next open', async () => {
        const twoMinutes = 2 * 60_000;
        const firstClose = T0 + 14 * 60_000;
        const secondClose = firstClose + 15 * 60_000;
        const sessionParents = [
            {
                openTime: T0,
                closeTime: firstClose - 1,
                open: 100,
                high: 101,
                low: 99,
                close: 100,
                volume: 1,
            },
            {
                openTime: firstClose,
                closeTime: secondClose - 1,
                open: 100,
                high: 101,
                low: 99,
                close: 100,
                volume: 1,
            },
        ];
        const sessionChildren = Array.from({ length: 14 }, (_, index) => ({
            openTime: T0 + index * twoMinutes,
            closeTime: T0 + (index + 1) * twoMinutes - 1,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }));

        const ctx: any = await new PineTS(
            sessionParents as any,
            'BTCUSDT',
            '15',
            undefined,
            undefined,
            undefined,
            { barMagnifier: { requested: true, lowerTimeframe: '2', bars: sessionChildren } },
        ).run(SOURCE);

        expect(ctx.executionPrecision).toMatchObject({
            applied: true,
            coveredParentBars: 2,
            coverage: 1,
        });
    });

    it('reports live Bar Magnifier requests as an explicit fallback', async () => {
        const live: any = await new PineTS(PARENTS as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', live: true },
        }).run(SOURCE);
        expect(live.executionPrecision).toMatchObject({
            requested: true,
            applied: false,
            fallbackReason: 'live-mode-not-supported',
        });
    });

    it('keeps uppercase multi-month periods on calendar-month duration semantics', async () => {
        const monthStart = T0;
        const parentMonth = {
            openTime: monthStart,
            closeTime: monthStart + 60 * 24 * 60 * 60_000,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        };
        const dailyChildren = Array.from({ length: 60 }, (_, index) => ({
            openTime: monthStart + index * 24 * 60 * 60_000,
            closeTime: monthStart + (index + 1) * 24 * 60 * 60_000,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }));
        const ctx: any = await new PineTS(
            [parentMonth] as any,
            'BTCUSDT',
            '2M',
            undefined,
            undefined,
            undefined,
            { barMagnifier: { requested: true, lowerTimeframe: 'D', bars: dailyChildren } },
        ).run(SOURCE);
        expect(ctx.executionPrecision).toMatchObject({
            applied: true,
            lowerTimeframe: 'D',
            coveredParentBars: 1,
            coverage: 1,
        });
    });

    it('treats the provider bare lower-case m alias as one minute', async () => {
        const minuteParents = [
            {
                openTime: T0,
                closeTime: T0 + HOUR,
                open: 100,
                high: 101,
                low: 99,
                close: 100,
                volume: 1,
            },
        ];
        const minuteChildren = Array.from({ length: 60 }, (_, index) => ({
            openTime: T0 + index * 60_000,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }));
        const ctx: any = await new PineTS(
            minuteParents as any,
            'BTCUSDT',
            '60',
            undefined,
            undefined,
            undefined,
            { barMagnifier: { requested: true, lowerTimeframe: 'm', bars: minuteChildren } },
        ).run(SOURCE);
        expect(ctx.executionPrecision).toMatchObject({
            applied: true,
            lowerTimeframe: 'm',
            coveredParentBars: 1,
            coverage: 1,
        });
    });

    it('does not retain a stale host fallback after local validation succeeds', async () => {
        const staleHostStatus = {
            requested: true,
            applied: false,
            requestedPrecision: 'lower-timeframe',
            appliedPrecision: 'chart-ohlc',
            lowerTimeframe: '10',
            parentBars: PARENTS.length,
            lowerBars: CHILDREN.length,
            coveredParentBars: 0,
            coverage: 0,
            fallbackReason: 'lower-data-unavailable',
        };
        const ctx: any = await new PineTS(
            PARENTS as any,
            'BTCUSDT',
            '60',
            undefined,
            undefined,
            undefined,
            {
                barMagnifier: { requested: true, lowerTimeframe: '10', bars: CHILDREN },
                barMagnifierStatus: staleHostStatus,
            },
        ).run(SOURCE);

        expect(ctx.executionPrecision).toMatchObject({ applied: true, coveredParentBars: PARENTS.length });
        expect(ctx.executionPrecision.fallbackReason).toBeUndefined();
    });

    it('does not let a stale transport reason hide malformed lower rows', async () => {
        const duplicate = [...CHILDREN.slice(0, -1), CHILDREN[CHILDREN.length - 2]!];
        const ctx: any = await new PineTS(
            PARENTS as any,
            'BTCUSDT',
            '60',
            undefined,
            undefined,
            undefined,
            {
                barMagnifier: { requested: true, lowerTimeframe: '10', bars: duplicate },
                barMagnifierStatus: {
                    requested: true,
                    applied: false,
                    requestedPrecision: 'lower-timeframe',
                    appliedPrecision: 'chart-ohlc',
                    lowerTimeframe: '10',
                    parentBars: PARENTS.length,
                    lowerBars: duplicate.length,
                    coveredParentBars: 0,
                    coverage: 0,
                    fallbackReason: 'lower-data-unavailable',
                },
            },
        ).run(SOURCE);
        expect(ctx.executionPrecision).toMatchObject({
            applied: false,
            fallbackReason: 'duplicate-lower-bars',
        });
    });

    it('checks the open margin event before a lower-bar gap exit', async () => {
        const source = `
//@version=6
strategy('Margin ordering', initial_capital=700, margin_short=100, default_qty_type=strategy.fixed, default_qty_value=5)
if bar_index == 0
    strategy.entry('S', strategy.short)
if bar_index == 1
    strategy.exit('X', 'S', stop=140)
`;
        const chart: any = await new PineTS(GAP_PARENTS as any, 'BTCUSDT', '60').run(source);
        const magnified: any = await new PineTS(GAP_PARENTS as any, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: GAP_CHILDREN },
        }).run(source);
        const ids = (ctx: any) => ctx.strategy.closedtrades.map((trade: any) => trade.exit_id);
        // A magnified run must not let the stop consume the position before
        // the open margin checkpoint. Both paths therefore retain the broker
        // margin-call event as the first close event.
        expect(ids(magnified)[0]).toBe('Margin call');
        expect(ids(magnified)[0]).toBe(ids(chart)[0]);
    });

    it('does not extend a parent window across a session/data gap', async () => {
        const hour = 60 * 60_000;
        const tenMinutes = 10 * 60_000;
        const start = T0;
        const parentRows = [
            { openTime: start, open: 100, high: 101, low: 99, close: 100, volume: 1 },
            // The second parent starts two hours later; the one-hour interval
            // in between is a session/data gap, not part of parent 0.
            { openTime: start + 2 * hour, open: 100, high: 101, low: 99, close: 100, volume: 1 },
        ];
        const childRows = Array.from({ length: 18 }, (_, index) => ({
            // Deliberately include lower bars through the gap. A parent window
            // derived from `nextOpenTime` would incorrectly claim full
            // precision and consume these rows; nominal-duration windows must
            // reject them as out-of-range.
            openTime: start + index * tenMinutes,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }));
        const ctx: any = await new PineTS(
            parentRows as any,
            'BTCUSDT',
            '60',
            undefined,
            undefined,
            undefined,
            { barMagnifier: { requested: true, lowerTimeframe: '10', bars: childRows } },
        ).run(SOURCE);
        expect(ctx.executionPrecision).toMatchObject({
            applied: false,
            fallbackReason: 'out-of-range-lower-bars',
        });
    });

    it('rejects an equal or unknown parent/child timeframe pair', async () => {
        const equalChildren = PARENTS.map((bar) => ({
            openTime: bar.openTime,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: 1,
        }));
        const equal: any = await new PineTS(
            PARENTS as any,
            'BTCUSDT',
            '60',
            undefined,
            undefined,
            undefined,
            { barMagnifier: { requested: true, lowerTimeframe: '60', bars: equalChildren } },
        ).run(SOURCE);
        expect(equal.executionPrecision).toMatchObject({
            applied: false,
            fallbackReason: 'lower-timeframe-undetermined',
        });

        const unknown: any = await new PineTS(
            PARENTS as any,
            'BTCUSDT',
            'custom-period',
            undefined,
            undefined,
            undefined,
            { barMagnifier: { requested: true, lowerTimeframe: '10', bars: CHILDREN } },
        ).run(SOURCE);
        expect(unknown.executionPrecision).toMatchObject({
            applied: false,
            fallbackReason: 'lower-timeframe-undetermined',
        });
    });

    it('rejects a lower feed shifted by an unaligned aggregation origin', async () => {
        // A provider may synthesize (for example) 2m/10m candles by grouping
        // whatever row happened to be returned first.  If that fetch starts
        // at 00:05 instead of the parent boundary 00:00, the resulting child
        // sequence must not be treated as precise merely because it contains
        // the expected number of rows.  The coverage validator keeps the
        // broker on chart-OHLC until the provider returns an aligned window.
        const shifted = CHILDREN.map((bar) => ({
            ...bar,
            openTime: bar.openTime + 5 * 60_000,
            closeTime: bar.closeTime! + 5 * 60_000,
        }));
        const ctx: any = await new PineTS(
            PARENTS as any,
            'BTCUSDT',
            '60',
            undefined,
            undefined,
            undefined,
            { barMagnifier: { requested: true, lowerTimeframe: '10', bars: shifted } },
        ).run(SOURCE);
        expect(ctx.executionPrecision).toMatchObject({
            applied: false,
            fallbackReason: 'partial-lower-coverage',
        });
    });

    it('rejects a one-minute origin shift that still fills a 15m floor window', async () => {
        const fifteenMinutes = 15 * 60_000;
        const twoMinutes = 2 * 60_000;
        const parentRows = [{
            openTime: T0,
            closeTime: T0 + fifteenMinutes,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }];
        // Seven complete rows plus the one-minute non-divisible remainder;
        // without a fixed-grid check this would incorrectly be considered a
        // valid 15m -> 2m replay despite the aggregation origin being shifted.
        const shifted = Array.from({ length: 7 }, (_, index) => ({
            openTime: T0 + 60_000 + index * twoMinutes,
            closeTime: T0 + 60_000 + (index + 1) * twoMinutes,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }));
        const ctx: any = await new PineTS(
            parentRows as any,
            'BTCUSDT',
            '15',
            undefined,
            undefined,
            undefined,
            { barMagnifier: { requested: true, lowerTimeframe: '2', bars: shifted } },
        ).run(SOURCE);
        expect(ctx.executionPrecision).toMatchObject({
            applied: false,
            fallbackReason: 'unaligned-lower-bars',
        });
    });
});
