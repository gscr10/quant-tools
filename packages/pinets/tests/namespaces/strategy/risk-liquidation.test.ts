import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const HOUR = 3_600_000;
const CHILD = 600_000;
const T0 = Date.UTC(2024, 0, 1);
const bar = (time: number, duration: number, open: number, high = open, low = open, close = open) => ({
    openTime: time, closeTime: time + duration - 1, open, high, low, close, volume: 1,
});

describe.each([false, true])('risk halt liquidates the account (magnified=%s)', (magnified) => {
    it('closes an existing position when the filled-order cap is reached and cancels later orders', async () => {
        const parents = [bar(T0, HOUR, 100), bar(T0 + HOUR, HOUR, 100)];
        const children = parents.flatMap(parent => Array.from({ length: 6 }, (_, j) => bar(parent.openTime + j * CHILD, CHILD, 100)));
        const result = await new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined,
            magnified ? { barMagnifier: { requested: true, lowerTimeframe: '10', bars: children } } : undefined).run(`//@version=6
strategy('filled order risk', initial_capital=1000, pyramiding=5,
    commission_type=strategy.commission.cash_per_order, commission_value=2)
strategy.risk.max_intraday_filled_orders(1)
if bar_index == 0
    strategy.entry('first', strategy.long, qty=1)
    strategy.order('second', strategy.long, qty=1)
`);
        expect(result.executionPrecision.applied).toBe(magnified);
        if (magnified) expect(result.executionPrecision.coverage).toBe(1);
        // One allowed entry followed by the mandatory risk close. Each
        // transaction costs 2; the second requested entry never fills.
        expect(result.strategy.position_size).toBe(0);
        expect(result.strategy.closedtrades).toMatchObject([{ entry_id: 'first', exit_price: 100, profit: -4, commission: 4 }]);
        expect(result.strategy.pending_orders).toHaveLength(0);
        expect(result.strategy._fill_events?.map(event => event.sourceOrderId)).toEqual(['first', 'risk.max_intraday_filled_orders']);
        expect(result.strategy.netprofit).toBe(-4);
    });

    it('evaluates maximum drawdown even if the strategy never requested an exit', async () => {
        const parents = [bar(T0, HOUR, 100), bar(T0 + HOUR, HOUR, 100, 100, 90, 90), bar(T0 + 2 * HOUR, HOUR, 110)];
        const children = parents.flatMap(parent => [
            bar(parent.openTime, CHILD, parent.open, parent.high, parent.low, parent.close),
            ...Array.from({ length: 5 }, (_, j) => bar(parent.openTime + (j + 1) * CHILD, CHILD, parent.close)),
        ]);
        const result = await new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined,
            magnified ? { barMagnifier: { requested: true, lowerTimeframe: '10', bars: children } } : undefined).run(`//@version=6
strategy('max drawdown liquidation', initial_capital=1000)
strategy.risk.max_drawdown(10, strategy.cash)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
`);
        expect(result.executionPrecision.applied).toBe(magnified);
        if (magnified) expect(result.executionPrecision.coverage).toBe(1);
        expect(result.strategy.position_size).toBe(0);
        expect(result.strategy.risk_halted).toBe(true);
        expect(result.strategy.closedtrades).toMatchObject([{ exit_id: 'risk.max_drawdown', exit_price: 90, profit: -10 }]);
        expect(result.strategy.equity).toBe(990);
    });

    it('closes the carried position when the prior exchange day reaches the consecutive-loss limit', async () => {
        const parents = [bar(T0, HOUR, 100), bar(T0 + HOUR, HOUR, 90),
            bar(T0 + 24 * HOUR, HOUR, 95), bar(T0 + 25 * HOUR, HOUR, 80)];
        const children = parents.flatMap(parent => Array.from({ length: 6 }, (_, j) => bar(parent.openTime + j * CHILD, CHILD, parent.close)));
        const result = await new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined,
            magnified ? { barMagnifier: { requested: true, lowerTimeframe: '10', bars: children } } : undefined).run(`//@version=6
strategy('loss-day carried position', initial_capital=1000, process_orders_on_close=true)
strategy.risk.max_cons_loss_days(1)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=2)
if bar_index == 1
    strategy.close('L', qty=1)
if bar_index == 2
    strategy.order('blocked', strategy.short, qty=1)
`);
        expect(result.executionPrecision.applied).toBe(magnified);
        if (magnified) expect(result.executionPrecision.coverage).toBe(1);
        // First day realizes -10 on one unit. At the next day's first
        // available price 95 the remaining unit must close at -5.
        expect(result.strategy.position_size).toBe(0);
        expect(result.strategy.closedtrades).toMatchObject([
            { size: 1, exit_price: 90, profit: -10 },
            { size: 1, exit_price: 95, profit: -5, exit_id: 'risk.max_cons_loss_days' },
        ]);
        expect(result.strategy.netprofit).toBe(-15);
        expect(result.strategy.equity).toBe(985);
        expect(result.strategy.risk_halted).toBe(true);
        expect(result.strategy.pending_orders).toHaveLength(0);
    });

    it('closes the position, charges both fees and cancels pending orders at the loss checkpoint', async () => {
        const parents = [bar(T0, HOUR, 100), bar(T0 + HOUR, HOUR, 100, 100, 90, 90), bar(T0 + 2 * HOUR, HOUR, 110)];
        const children = [
            ...Array.from({ length: 6 }, (_, i) => bar(T0 + i * CHILD, CHILD, 100)),
            bar(T0 + HOUR, CHILD, 100, 100, 90, 90),
            ...Array.from({ length: 5 }, (_, i) => bar(T0 + HOUR + (i + 1) * CHILD, CHILD, 90)),
            ...Array.from({ length: 6 }, (_, i) => bar(T0 + 2 * HOUR + i * CHILD, CHILD, 110)),
        ];
        const result = await new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined,
            magnified ? { barMagnifier: { requested: true, lowerTimeframe: '10', bars: children } } : undefined).run(`//@version=6
strategy('risk liquidation', initial_capital=1000, margin_long=50, pyramiding=5,
    commission_type=strategy.commission.cash_per_contract, commission_value=0.5)
strategy.risk.max_intraday_loss(20, strategy.cash)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=2)
    strategy.order('unfilled', strategy.long, qty=1, limit=80)
if bar_index == 1
    strategy.entry('blocked', strategy.long, qty=1)
`);
        expect(result.executionPrecision.applied).toBe(magnified);
        if (magnified) expect(result.executionPrecision.coverage).toBe(1);
        // Entry 2 @ 100 costs 1. At the observed 90 checkpoint the
        // account is 1000 - 1 - 20 = 979, exceeding the 20 cash limit.
        // The risk close costs another 1: flat equity/net must be 978/-22,
        // even though the following bar recovers to 110.
        expect(result.strategy.position_size).toBe(0);
        expect(result.strategy.opentrades).toHaveLength(0);
        expect(result.strategy.closedtrades).toMatchObject([{
            entry_id: 'L', size: 2, entry_price: 100, exit_price: 90,
            exit_bar_index: 1, profit: -22, commission: 2,
        }]);
        expect(result.strategy.netprofit).toBe(-22);
        expect(result.strategy.equity).toBe(978);
        expect(result.strategy.pending_orders).toHaveLength(0);
        expect(result.strategy._order_events).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceOrderId: 'unfilled', kind: 'cancelled', reason: 'risk.max_intraday_loss' }),
        ]));
        expect(result.strategy._fill_events?.filter(event => event.sourceOrderId === 'blocked')).toHaveLength(0);
        expect(result.strategy._fill_events?.filter(event => event.sourceOrderId === 'risk.max_intraday_loss')).toMatchObject([
            { price: 90, qty: 2, direction: -1, barIndex: 1 },
        ]);
    });

    it('finishes a partial margin liquidation without duplicate quantity or fees when risk also trips', async () => {
        const parents = [bar(T0, HOUR, 100), bar(T0 + HOUR, HOUR, 100, 100, 70, 70), bar(T0 + 2 * HOUR, HOUR, 110)];
        const children = parents.flatMap((parent, i) => [
            bar(T0 + i * HOUR, CHILD, parent.open, parent.high, parent.low, parent.close),
            ...Array.from({ length: 5 }, (_, j) => bar(T0 + i * HOUR + (j + 1) * CHILD, CHILD, parent.close)),
        ]);
        const result = await new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined,
            magnified ? { barMagnifier: { requested: true, lowerTimeframe: '10', bars: children } } : undefined).run(`//@version=6
strategy('margin plus risk liquidation', initial_capital=600, margin_long=50,
    commission_type=strategy.commission.cash_per_contract, commission_value=1)
strategy.risk.max_intraday_loss(100, strategy.cash)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=10)
    strategy.order('pending', strategy.long, qty=1, limit=50)
`);
        expect(result.executionPrecision.applied).toBe(magnified);
        if (magnified) expect(result.executionPrecision.coverage).toBe(1);
        // Entry commission 10; at 70 equity=600-10-300=290,
        // margin=10*70*50%=350. Margin closes 4*(60/35)=48/7,
        // then max-loss closes the exact remainder. Total economic loss
        // is 10*(100-70)+10 entry fees+10 exit fees = 320.
        const closed = result.strategy.closedtrades;
        expect(closed).toHaveLength(2);
        expect(closed[0].size).toBeCloseTo(48 / 7, 10);
        expect(closed[1].size).toBeCloseTo(22 / 7, 10);
        expect(closed.map(trade => trade.exit_id)).toEqual(['Margin call', 'risk.max_intraday_loss']);
        expect(closed.every(trade => trade.exit_price === 70)).toBe(true);
        expect(closed.reduce((sum, trade) => sum + trade.size, 0)).toBeCloseTo(10, 10);
        expect(closed.reduce((sum, trade) => sum + trade.commission, 0)).toBeCloseTo(20, 10);
        expect(result.strategy.position_size).toBe(0);
        expect(result.strategy.opentrades).toHaveLength(0);
        expect(result.strategy.pending_orders).toHaveLength(0);
        expect(result.strategy.netprofit).toBeCloseTo(-320, 10);
        expect(result.strategy.equity).toBeCloseTo(280, 10);
    });

    it('does not carry a reversal position after its transaction commission trips risk', async () => {
        const parents = [bar(T0, HOUR, 100), bar(T0 + HOUR, HOUR, 100), bar(T0 + 2 * HOUR, HOUR, 100)];
        const children = parents.flatMap((parent, i) => Array.from({ length: 6 }, (_, j) => bar(T0 + i * HOUR + j * CHILD, CHILD, parent.close)));
        const result = await new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined,
            magnified ? { barMagnifier: { requested: true, lowerTimeframe: '10', bars: children } } : undefined).run(`//@version=6
strategy('fee-triggered reversal risk', initial_capital=1000,
    commission_type=strategy.commission.cash_per_contract, commission_value=10)
strategy.risk.max_intraday_loss(15, strategy.cash)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('S', strategy.short, qty=1)
`);
        expect(result.executionPrecision.applied).toBe(magnified);
        if (magnified) expect(result.executionPrecision.coverage).toBe(1);
        // At unchanged price, the first entry costs 10. The reversal is a
        // single sell-2 transaction (20 commission), crossing the 15 limit;
        // the resulting short must be closed (10), for 40 total fees.
        expect(result.strategy.position_size).toBe(0);
        expect(result.strategy.opentrades).toHaveLength(0);
        expect(result.strategy.netprofit).toBe(-40);
        expect(result.strategy.equity).toBe(960);
        expect(result.strategy.closedtrades).toHaveLength(2);
    });

    it('records a partial close before the fee-triggered liquidation of its remainder', async () => {
        const parents = [bar(T0, HOUR, 100), bar(T0 + HOUR, HOUR, 100), bar(T0 + 2 * HOUR, HOUR, 100)];
        const children = parents.flatMap(parent => Array.from({ length: 6 }, (_, j) => bar(parent.openTime + j * CHILD, CHILD, 100)));
        const result = await new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined,
            magnified ? { barMagnifier: { requested: true, lowerTimeframe: '10', bars: children } } : undefined).run(`//@version=6
strategy('partial fee risk', initial_capital=1000,
    commission_type=strategy.commission.cash_per_contract, commission_value=10)
strategy.risk.max_intraday_loss(25, strategy.cash)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=2)
if bar_index == 1
    strategy.close('L', qty=1)
`);
        expect(result.executionPrecision.applied).toBe(magnified);
        if (magnified) expect(result.executionPrecision.coverage).toBe(1);
        expect(result.strategy.netprofit).toBe(-40);
        expect(result.strategy.position_size).toBe(0);
        const exitFills = result.strategy._fill_events!.filter(event => event.category === 'exit');
        expect(exitFills).toHaveLength(2);
        expect(exitFills[0].sourceOrderId).not.toBe('risk.max_intraday_loss');
        expect(exitFills[0].qty).toBe(1);
        expect(exitFills[0].tradeIds).toHaveLength(1);
        expect(exitFills[1]).toMatchObject({ sourceOrderId: 'risk.max_intraday_loss', qty: 1 });
        expect(result.strategy._order_events!.some(event => event.orderId === exitFills[0].orderId && event.kind === 'cancelled')).toBe(false);
    });

    it.each([
        [1, 'percent'], [-1, 'percent'], [1, 'cash_per_order'], [-1, 'cash_per_order'],
    ] as const)('charges %s-side slippage and %s fees on the mandatory risk close', async (direction, feeType) => {
        const adverse = direction === 1 ? 90 : 110;
        const parents = [bar(T0, HOUR, 100), bar(T0 + HOUR, HOUR, 100, Math.max(100, adverse), Math.min(100, adverse), adverse)];
        const children = parents.flatMap((parent, i) => [
            bar(T0 + i * HOUR, CHILD, parent.open, parent.high, parent.low, parent.close),
            ...Array.from({ length: 5 }, (_, j) => bar(T0 + i * HOUR + (j + 1) * CHILD, CHILD, parent.close)),
        ]);
        const result = await new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined,
            magnified ? { barMagnifier: { requested: true, lowerTimeframe: '10', bars: children } } : undefined).run(`//@version=6
strategy('risk fee and slippage', initial_capital=1000, margin_long=50, margin_short=50,
    slippage=3, commission_type=strategy.commission.${feeType}, commission_value=1)
strategy.risk.max_intraday_loss(2, strategy.percent_of_equity)
if bar_index == 0
    strategy.entry('position', strategy.${direction === 1 ? 'long' : 'short'}, qty=2)
`);
        expect(result.executionPrecision.applied).toBe(magnified);
        if (magnified) expect(result.executionPrecision.coverage).toBe(1);
        // BTC mintick=0.01. Both market legs incur adverse 0.03 slippage,
        // so loss is 20.12. Percent fees charge the actual two notionals;
        // cash_per_order is charged once for entry and once for the close.
        const entry = 100 + direction * 0.03;
        const exit = adverse - direction * 0.03;
        const commission = feeType === 'percent' ? 2 * (entry + exit) * 0.01 : 2;
        expect(result.strategy.closedtrades).toHaveLength(1);
        expect(result.strategy.closedtrades[0].entry_price).toBeCloseTo(entry, 10);
        expect(result.strategy.closedtrades[0].exit_price).toBeCloseTo(exit, 10);
        expect(result.strategy.closedtrades[0].commission).toBeCloseTo(commission, 10);
        expect(result.strategy.netprofit).toBeCloseTo(-20.12 - commission, 10);
        expect(result.strategy.equity).toBeCloseTo(979.88 - commission, 10);
        expect(result.strategy.position_size).toBe(0);
    });

    it('keeps a percent-equity bankruptcy halt across the next exchange day', async () => {
        const parents = [bar(T0, HOUR, 100), bar(T0 + HOUR, HOUR, 100, 100, 40, 40),
            bar(T0 + 24 * HOUR, HOUR, 100), bar(T0 + 25 * HOUR, HOUR, 100)];
        const children = parents.flatMap(parent => [
            bar(parent.openTime, CHILD, parent.open, parent.high, parent.low, parent.close),
            ...Array.from({ length: 5 }, (_, j) => bar(parent.openTime + (j + 1) * CHILD, CHILD, parent.close)),
        ]);
        const result = await new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined,
            magnified ? { barMagnifier: { requested: true, lowerTimeframe: '10', bars: children } } : undefined).run(`//@version=6
strategy('percent risk bankruptcy', initial_capital=100, margin_long=0, margin_short=0)
strategy.risk.max_intraday_loss(100, strategy.percent_of_equity)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=2)
if bar_index == 2
    strategy.entry('new day forbidden', strategy.short, qty=1)
`);
        expect(result.executionPrecision.applied).toBe(magnified);
        if (magnified) expect(result.executionPrecision.coverage).toBe(1);
        // margin=0 does not impose a positive collateral floor. The drop
        // loses 2*(100-40)=120 from capital 100, reaching equity=-20.
        expect(result.strategy.position_size).toBe(0);
        expect(result.strategy.equity).toBe(-20);
        expect(result.strategy.risk_halted).toBe(true);
        expect(result.strategy._fill_events?.some(event => event.sourceOrderId === 'new day forbidden')).toBe(false);
        expect(result.strategy.closedtrades.reduce((sum, trade) => sum + trade.size, 0)).toBe(2);
    });
});

describe('lower-timeframe risk causality', () => {
    it.each(['entry', 'order'])('rejects strategy.%s through later children and at the last parent close after a risk halt', async (method) => {
        const parents = [bar(T0, HOUR, 100), bar(T0 + HOUR, HOUR, 100, 110, 90, 110)];
        const children = [
            ...Array.from({ length: 6 }, (_, i) => bar(T0 + i * CHILD, CHILD, 100)),
            bar(T0 + HOUR, CHILD, 100, 100, 90, 90),
            ...Array.from({ length: 5 }, (_, i) => bar(T0 + HOUR + (i + 1) * CHILD, CHILD, 110)),
        ];
        const result = await new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
        }).run(`//@version=6
strategy('risk recovery causality', initial_capital=1000, calc_on_every_tick=true, calc_on_order_fills=true)
strategy.risk.max_intraday_loss(10, strategy.cash)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
    strategy.order('later low', strategy.long, qty=1, limit=80)
if bar_index == 1 and strategy.position_size == 0
    strategy.${method}('must stay blocked', strategy.long, qty=1)
`);
        expect(result.executionPrecision).toMatchObject({ applied: true, coverage: 1 });
        expect(result.strategy.closedtrades).toMatchObject([{
            entry_id: 'L', entry_price: 100, exit_price: 90,
            exit_time: T0 + HOUR, exit_bar_index: 1, profit: -10,
        }]);
        expect(result.strategy._fill_events?.map(event => event.sourceOrderId)).toEqual(['L', 'risk.max_intraday_loss']);
        expect(result.strategy._order_events?.some(event => event.sourceOrderId === 'later low' && event.kind === 'cancelled')).toBe(true);
        expect(result.strategy._order_events?.some(event => event.sourceOrderId === 'must stay blocked' && event.kind === 'rejected')).toBe(true);
        expect(result.strategy.position_size).toBe(0);
        expect(result.strategy.equity).toBe(990);
        expect(result.strategy.pending_orders).toHaveLength(0);
    });

    it('does not record a phantom bracket fill when its checkpoint has already triggered liquidation', async () => {
        const parents = [bar(T0, HOUR, 100), bar(T0 + HOUR, HOUR, 100, 100, 90, 90)];
        const children = [
            ...Array.from({ length: 6 }, (_, i) => bar(T0 + i * CHILD, CHILD, 100)),
            bar(T0 + HOUR, CHILD, 100, 100, 90, 90),
            ...Array.from({ length: 5 }, (_, i) => bar(T0 + HOUR + (i + 1) * CHILD, CHILD, 90)),
        ];
        const result = await new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined, {
            barMagnifier: { requested: true, lowerTimeframe: '10', bars: children },
        }).run(`//@version=6
strategy('risk and bracket checkpoint', initial_capital=1000)
strategy.risk.max_intraday_loss(5, strategy.cash)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
    strategy.exit('bracket', 'L', stop=90)
`);
        expect(result.executionPrecision).toMatchObject({ applied: true, coverage: 1 });
        expect(result.strategy.position_size).toBe(0);
        expect(result.strategy.closedtrades).toHaveLength(1);
        // There was one real entry and one real one-contract close.
        // A cancelled bracket cannot emit a second close against a flat book.
        expect(result.strategy._fill_events?.filter(event => event.category === 'exit').reduce((sum, event) => sum + event.qty, 0)).toBe(1);
    });
});
