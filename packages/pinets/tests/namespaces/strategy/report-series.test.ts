// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';

import { Context } from '../../../src/Context.class';
import { PineTS } from '../../../src/PineTS.class';
import { Series } from '../../../src/Series';
import {
    finalizeStrategyBar,
    initializeStrategy,
    restoreStrategyState,
    snapshotStrategyState,
} from '../../../src/namespaces/strategy/utils';

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

function makeContext(config: Record<string, unknown> = {}) {
    const context: any = new Context({
        marketData: [],
        source: [],
        tickerId: 'TEST',
        timeframe: '1',
    } as any);
    context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } } as any;
    initializeStrategy(context, config);
    return context;
}

function setBar(
    context: any,
    index: number,
    { open, high, low, close }: { open: number; high: number; low: number; close: number },
) {
    context.idx = index;
    context.data.open = new Series([open]);
    context.data.high = new Series([high]);
    context.data.low = new Series([low]);
    context.data.close = new Series([close]);
    context.data.openTime = new Series([T0 + index * MINUTE]);
    context.data.closeTime = new Series([T0 + (index + 1) * MINUTE - 1]);
}

describe('strategy report series', () => {
    it('records a real per-bar equity/P&L curve and anchors the benchmark at the first fill', async () => {
        const bars = [
            candle(0, 100, 100, 100, 100),
            candle(1, 100, 110, 100, 110),
            candle(2, 110, 120, 110, 120),
            candle(3, 120, 120, 90, 90),
        ];
        const source = `
//@version=6
strategy('Report series', initial_capital=1000,
     default_qty_type=strategy.fixed, default_qty_value=1)

if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.close('L')
`;

        const context: any = await new PineTS(bars as any, 'TEST', '1').run(source);
        const points = context.strategy._report_series;

        expect(points).toHaveLength(4);
        expect(points.map((point: any) => point.barIndex)).toEqual([0, 1, 2, 3]);
        expect(points.map((point: any) => point.time)).toEqual(bars.map((bar) => bar.openTime));
        expect(points.map((point: any) => point.closeTime)).toEqual(bars.map((bar) => bar.closeTime));

        // First bar: strategy has been declared, but the queued entry has not
        // filled yet. It still gets the initial-capital report point.
        expect(points[0]).toMatchObject({
            equity: 1000,
            realizedPnl: 0,
            openPnl: 0,
            underwater: 0,
            underwaterPercent: 0,
            benchmarkEquity: null,
            benchmarkPnl: null,
            benchmarkReturnPercent: null,
        });

        // Bar 1: the entry really filled at 100; close marks it to 110.
        expect(points[1]).toMatchObject({
            equity: 1010,
            realizedPnl: 0,
            openPnl: 10,
            benchmarkEquity: 1100,
            benchmarkPnl: 100,
            benchmarkReturnPercent: 10,
        });

        // Bar 2: strategy.close filled at the 110 open, realizing +10.
        expect(points[2]).toMatchObject({
            equity: 1010,
            realizedPnl: 10,
            openPnl: 0,
            benchmarkEquity: 1200,
            benchmarkPnl: 200,
            benchmarkReturnPercent: 20,
        });
        expect(points[3]).toMatchObject({
            equity: 1010,
            realizedPnl: 10,
            openPnl: 0,
            benchmarkEquity: 900,
            benchmarkPnl: -100,
            benchmarkReturnPercent: -10,
        });
    });

    it('keeps benchmark fields null for a strategy that never fills an order', async () => {
        const bars = [candle(0, 100, 101, 99, 100), candle(1, 100, 102, 98, 101), candle(2, 101, 103, 100, 102)];
        const context: any = await new PineTS(bars as any, 'TEST', '1').run(`
//@version=6
strategy('No trades', initial_capital=1000)
`);

        expect(context.strategy._report_series).toHaveLength(bars.length);
        for (const point of context.strategy._report_series) {
            expect(point.benchmarkEquity).toBeNull();
            expect(point.benchmarkPnl).toBeNull();
            expect(point.benchmarkReturnPercent).toBeNull();
        }
    });

    it('upserts a repeated forming-bar point and appends only for a new bar', () => {
        const context = makeContext({ initial_capital: 1000 });

        setBar(context, 0, { open: 100, high: 100, low: 100, close: 100 });
        finalizeStrategyBar(context);
        expect(context.strategy._report_series).toHaveLength(1);

        setBar(context, 0, { open: 100, high: 110, low: 100, close: 110 });
        finalizeStrategyBar(context);
        expect(context.strategy._report_series).toHaveLength(1);
        expect(context.strategy._report_series[0]).toMatchObject({ barIndex: 0, equity: 1000 });

        setBar(context, 1, { open: 110, high: 111, low: 109, close: 110 });
        finalizeStrategyBar(context);
        expect(context.strategy._report_series).toHaveLength(2);
        expect(context.strategy._report_series.map((point: any) => point.barIndex)).toEqual([0, 1]);
    });

    it('does not confuse close-equity underwater with cumulative intrabar max drawdown', () => {
        const context = makeContext({ initial_capital: 1000 });
        const strategy = context.strategy;
        strategy.opentrades = [{
            id: 'trade_0',
            entry_id: 'L',
            entry_price: 100,
            entry_bar_index: 0,
            entry_time: T0,
            size: 1,
            commission: 0,
            max_drawdown: 0,
            max_runup: 0,
            status: 'open',
        }];
        strategy.position_size = 1;
        strategy.position_avg_price = 100;

        // It closes exactly at entry (no close underwater), but traded down
        // to 50 intrabar, so Broker Emulator max drawdown is 50.
        setBar(context, 0, { open: 100, high: 100, low: 50, close: 100 });
        finalizeStrategyBar(context);

        expect(strategy._report_series[0].underwater).toBe(0);
        expect(strategy._report_series[0].underwaterPercent).toBe(0);
        expect(strategy._report_series[0].maxDrawdown).toBe(50);
        expect(strategy._report_series[0].maxDrawdownPercent).toBe(5);
    });

    it('snapshots report history as length + tail and restores it in place', () => {
        const context = makeContext({ initial_capital: 1000 });
        setBar(context, 0, { open: 100, high: 100, low: 100, close: 100 });
        finalizeStrategyBar(context);

        const reportSeries = context.strategy._report_series;
        const originalTail = { ...reportSeries[0] };
        const snapshot = snapshotStrategyState(context.strategy);

        expect(snapshot.fields).not.toHaveProperty('_report_series');
        expect(snapshot.reportSeriesLength).toBe(1);
        expect(snapshot.reportSeriesLastPoint).toEqual(originalTail);

        // Replace the tail at the same index, then append another bar.
        context.strategy.netprofit = 25;
        setBar(context, 0, { open: 100, high: 125, low: 100, close: 125 });
        finalizeStrategyBar(context);
        setBar(context, 1, { open: 125, high: 130, low: 120, close: 130 });
        finalizeStrategyBar(context);
        expect(reportSeries).toHaveLength(2);
        expect(reportSeries[0]).not.toEqual(originalTail);

        restoreStrategyState(context.strategy, snapshot);

        expect(context.strategy._report_series).toBe(reportSeries);
        expect(reportSeries).toHaveLength(1);
        expect(reportSeries[0]).toEqual(originalTail);
    });
});
