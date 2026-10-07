import { expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const T0 = Date.UTC(2024, 0, 1), HOUR = 3_600_000;
const rowWithCloseTime = (i: number, close: number, low = close, high = close) => ({
    openTime: T0 + i * HOUR, closeTime: T0 + (i + 1) * HOUR - 1,
    open: i === 3 ? 105 : 100, high, low, close, volume: 1,
});

it.each([true, false])('restores risk state and curve boundaries after a forming close recovers (provider closeTime=%s)', async explicitCloseTime => {
    const row = (...args: Parameters<typeof rowWithCloseTime>) => {
        const { closeTime, ...bar } = rowWithCloseTime(...args);
        return explicitCloseTime ? { ...bar, closeTime } : bar;
    };
    let bars = [row(0, 100), row(1, 100), row(2, 90, 90, 100)];
    let polls = 0;
    const provider = {
        getMarketData: async (_symbol: string, _tf: string, _limit?: number, from?: number) => {
            if (from !== undefined) {
                polls++;
                if (polls === 1) bars[2] = row(2, 105, 90, 105);
                else if (polls === 2) bars.push(row(3, 105));
            }
            return bars.filter(bar => from === undefined || bar.openTime >= from).map(bar => ({ ...bar }));
        },
        getSymbolInfo: async () => ({ ticker: 'BTCUSDT', mintick: .01, pointvalue: 1, currency: 'USD', timezone: 'UTC' }),
        configure() {},
    };
    const source = `//@version=6
strategy('forming risk rollback', initial_capital=1000, calc_on_every_tick=true,
    commission_type=strategy.commission.cash_per_contract, commission_value=0.5)
strategy.risk.max_position_size(2)
strategy.risk.allow_entry_in(strategy.direction.long)
strategy.risk.max_intraday_loss(20, strategy.cash)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=3)
    strategy.order('waiting', strategy.long, qty=1, limit=80)
if bar_index == 2 and strategy.position_size == 0
    strategy.entry('blocked', strategy.long, qty=1)
`;
    const pine = new PineTS(provider as any, 'BTCUSDT', '60');
    const context = await pine.run(source);
    // First forming close: accepted L2@100, close90, fees 1+1 => -22/978.
    expect(context.strategy.position_size).toBe(0);
    expect(context.strategy.netprofit).toBe(-22);
    expect(context.strategy.equity).toBe(978);
    expect(context.strategy._risk_intraday_halted).toBe(true);
    expect(context.strategy._fill_events?.map(f => f.sourceOrderId)).toEqual(['L', 'risk.max_intraday_loss']);

    await pine.updateTail(context);
    // The forming close is revised to105. Restore the committed entry fee1
    // and position2; unrealized gain10 => equity1009, no realized close.
    expect(context.strategy.position_size).toBe(2);
    expect(context.strategy.netprofit).toBe(-1);
    expect(context.strategy.equity).toBe(1009);
    expect(context.strategy.closedtrades).toHaveLength(0);
    expect(context.strategy._risk_intraday_halted).toBe(false);
    expect(context.strategy._risk_day_filled_orders).toBe(1);
    expect(context.strategy._fill_events?.map(f => f.sourceOrderId)).toEqual(['L']);
    expect(context.strategy._order_events?.map(e => [e.sourceOrderId, e.kind])).toEqual([
        ['L', 'created'], ['waiting', 'created'], ['L', 'filled'],
    ]);
    expect(context.strategy.pending_orders).toMatchObject([{ id: 'waiting', status: 'pending' }]);
    expect(context.strategy._report_series).toHaveLength(3);

    await pine.updateTail(context);
    expect(context.strategy.position_size).toBe(2);
    expect(context.strategy.equity).toBe(1009);
    expect(context.strategy._report_series).toHaveLength(4);
    const fresh = await new PineTS(bars, 'BTCUSDT', '60').run(source);
    for (const field of ['closedtrades', 'opentrades', 'pending_orders', '_fill_events', '_order_events', '_report_series'] as const) {
        expect(context.strategy[field]).toEqual(fresh.strategy[field]);
    }
});
