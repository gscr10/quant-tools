import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { evaluateCatastrophicRiskHalt, initializeStrategy, prepareRiskDay } from '../../../src/namespaces/strategy/utils';
import { Series } from '../../../src/Series';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2024, 0, 1);

function bar(index: number, open: number, high: number, low: number, close: number, time = T0 + index * HOUR) {
    return {
        openTime: time,
        closeTime: time + HOUR,
        open,
        high,
        low,
        close,
        volume: 1,
    };
}

describe('strategy intraday risk rules', () => {
    it('uses the exchange timezone for rollover instead of UTC date', () => {
        const context: any = {
            idx: 0,
            data: { openTime: new Series([Date.UTC(2024, 0, 2, 0, 30)]) }, // Jan 1, 19:30 New York
            pine: { syminfo: { timezone: 'America/New_York' } },
            strategy: undefined,
        };
        initializeStrategy(context, { initial_capital: 1000 });
        prepareRiskDay(context);
        expect(context.strategy._risk_day_key).toBe('2024-01-01');
        context.strategy._risk_day_filled_orders = 1;

        // Still Jan 1 in the exchange timezone although the UTC date changed.
        context.idx = 1;
        context.data.openTime = new Series([Date.UTC(2024, 0, 2, 4, 59)]);
        prepareRiskDay(context);
        expect(context.strategy._risk_day_key).toBe('2024-01-01');
        expect(context.strategy._risk_day_filled_orders).toBe(1);

        // 05:00 UTC is midnight EST on Jan 2, so the intraday counters reset.
        context.idx = 2;
        context.data.openTime = new Series([Date.UTC(2024, 0, 2, 5, 0)]);
        prepareRiskDay(context);
        expect(context.strategy._risk_day_key).toBe('2024-01-02');
        expect(context.strategy._risk_day_filled_orders).toBe(0);
    });

    it('keeps the closed-trade fallback for direct states before a day baseline exists', () => {
        const context: any = { strategy: undefined };
        initializeStrategy(context, { initial_capital: 1000 });
        context.strategy.risk_rules.max_cons_loss_days = { count: 1 };
        context.strategy.closedtrades.push({ profit: -1 });

        // This helper is also used by low-level adapters/tests that construct
        // state without running a broker bar. The initialized numeric counter
        // must not mask the legacy closed-trade fallback before _risk_day_key
        // has been established.
        evaluateCatastrophicRiskHalt(context.strategy);
        expect(context.strategy.risk_halted).toBe(true);
    });

    it('counts same-bar close-pass fills immediately and rejects later orders', async () => {
        const bars = [
            bar(0, 100, 100, 100, 100),
            bar(1, 100, 100, 100, 100),
        ];
        const result: any = await new PineTS(bars as any, 'BTCUSDT', '60').run(`
//@version=6
strategy('same-bar order cap', process_orders_on_close=true, pyramiding=5)
strategy.risk.max_intraday_filled_orders(1)
if bar_index == 0
    strategy.order('first', strategy.long, qty=1)
    strategy.order('second', strategy.long, qty=1)
`);

        expect(result.strategy.opentrades.map((trade: any) => trade.entry_id)).toEqual(['first']);
        expect(result.strategy._risk_day_filled_orders).toBe(1);
        expect(result.strategy._order_events.filter((event: any) => event.kind === 'rejected').map((event: any) => event.sourceOrderId)).toContain('second');
    });

    it('limits filled orders per exchange day and resets at the next day', async () => {
        const bars = [
            bar(0, 100, 100, 100, 100),
            bar(1, 100, 100, 100, 100),
            bar(2, 100, 100, 100, 100),
            bar(3, 100, 100, 100, 100, T0 + DAY),
        ];
        const result: any = await new PineTS(bars as any, 'BTCUSDT', '60').run(`
//@version=6
strategy('intraday order cap', pyramiding=5)
strategy.risk.max_intraday_filled_orders(1)
if bar_index == 0
    strategy.entry('first', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('same_day', strategy.long, qty=1)
if bar_index == 2
    strategy.entry('next_day', strategy.long, qty=1)
`);

        // first fills on bar 1; same_day is rejected on bar 2 because the
        // daily cap has been reached. next_day is queued after the cap's day
        // has ended and fills at the first bar of the new exchange day.
        expect(result.strategy.opentrades).toHaveLength(2);
        expect(result.strategy.opentrades.map((trade: any) => trade.entry_id)).toEqual(['first', 'next_day']);
        expect(result.strategy._order_events.filter((event: any) => event.kind === 'rejected').map((event: any) => event.sourceOrderId)).toContain('same_day');
    });

    it('halts after an intraday cash loss, then resumes on the next day', async () => {
        const bars = [
            bar(0, 1000, 1000, 1000, 1000),
            bar(1, 1000, 1000, 800, 800),
            bar(2, 800, 800, 800, 800),
            bar(3, 800, 800, 800, 800, T0 + DAY),
        ];
        const result: any = await new PineTS(bars as any, 'BTCUSDT', '60').run(`
//@version=6
strategy('intraday loss', pyramiding=5)
strategy.risk.max_intraday_loss(100, strategy.cash)
if bar_index == 0
    strategy.entry('first', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('blocked', strategy.long, qty=1)
if bar_index == 2
    strategy.entry('new_day', strategy.long, qty=1)
`);

        expect(result.strategy.opentrades.map((trade: any) => trade.entry_id)).toEqual(['first', 'new_day']);
        expect(result.strategy._order_events.filter((event: any) => event.kind === 'rejected').map((event: any) => event.sourceOrderId)).toContain('blocked');
        expect(result.strategy._risk_intraday_halted).toBe(false);
    });

    it('counts consecutive losing exchange days instead of consecutive losing trades', async () => {
        const bars = [
            bar(0, 100, 100, 100, 100),
            bar(1, 100, 100, 90, 90),
            bar(2, 90, 90, 90, 90, T0 + DAY),
            bar(3, 90, 90, 90, 90, T0 + DAY + HOUR),
        ];
        const result: any = await new PineTS(bars as any, 'BTCUSDT', '60').run(`
//@version=6
strategy('loss days', process_orders_on_close=true, pyramiding=5)
strategy.risk.max_cons_loss_days(1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.close('L')
if bar_index == 2
    strategy.entry('after_loss_day', strategy.long, qty=1)
`);

        expect(result.strategy.closedtrades).toHaveLength(1);
        expect(result.strategy.closedtrades[0].profit).toBe(-10);
        expect(result.strategy._order_events.filter((event: any) => event.kind === 'rejected').map((event: any) => event.sourceOrderId)).toContain('after_loss_day');
        expect(result.strategy.risk_halted).toBe(true);
    });
});
