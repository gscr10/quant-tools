import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Context } from '../../../src/Context.class';
import { Series } from '../../../src/Series';
import { applyPendingCloseMarginCall, initializeStrategy, processMarginCall, processStrategyOrders } from '../../../src/namespaces/strategy/utils';

const T0 = Date.UTC(2024, 0, 1);
const HOUR = 3_600_000;
const CHILD = 600_000;
const bar = (time: number, duration: number, open: number, low = open) => ({
    openTime: time, closeTime: time + duration - 1,
    open, high: open, low, close: low, volume: 1,
});

describe.each([false, true])('margin-call audit (magnified=%s)', (magnified) => {
    it.each([false, true])('records the actual margin fill before nested risk (risk=%s)', async (risk) => {
        const parents = [bar(T0, HOUR, 100), bar(T0 + HOUR, HOUR, 100, 70), bar(T0 + 2 * HOUR, HOUR, 70)];
        const children = parents.flatMap(parent => [
            bar(parent.openTime, CHILD, parent.open, parent.low),
            ...Array.from({ length: 5 }, (_, j) => bar(parent.openTime + (j + 1) * CHILD, CHILD, parent.close)),
        ]);
        const result = await new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined,
            magnified ? { barMagnifier: { requested: true, lowerTimeframe: '10', bars: children } } : undefined).run(`//@version=6
strategy('margin audit', initial_capital=600, margin_long=50,
    commission_type=strategy.commission.cash_per_contract, commission_value=1)
${risk ? 'strategy.risk.max_intraday_loss(100, strategy.cash)' : ''}
if bar_index == 0
    strategy.entry('L', strategy.long, qty=10)
`);
        expect(result.executionPrecision.applied).toBe(magnified);
        if (magnified) expect(result.executionPrecision.coverage).toBe(1);
        const s = result.strategy;
        // At 70: equity=600-10-300=290; required margin=350.
        // Liquidate 4*(350-290)/(70*.5)=48/7, with one exit fee per unit.
        const marginQty = 48 / 7;
        expect(s.closedtrades[0]).toMatchObject({ exit_id: 'Margin call', exit_price: 70 });
        expect(s.closedtrades[0].size).toBeCloseTo(marginQty, 10);
        expect(s.closedtrades[0].profit).toBeCloseTo(-32 * marginQty, 10);
        expect(s.position_size).toBeCloseTo(risk ? 0 : 22 / 7, 10);
        expect(s.netprofit).toBeCloseTo(risk ? -320 : -10 - 31 * marginQty, 10);
        expect(s.equity).toBeCloseTo(risk ? 280 : 290 - marginQty, 10);

        const fills = s._fill_events!;
        expect(fills.map(fill => fill.sourceOrderId)).toEqual(risk ? ['L', 'Margin call', 'risk.max_intraday_loss'] : ['L', 'Margin call']);
        const margin = fills[1];
        expect(margin).toMatchObject({
            qty: marginQty, requestedQty: marginQty, cumulativeQty: marginQty,
            remainingQty: 0, fillSequence: 1, isPartial: false,
            price: 70, direction: -1, category: 'exit',
            parentOrderIds: [fills[0].orderId], tradeIds: [s.closedtrades[0].id],
        });
        expect(s._order_events!.filter(event => event.orderId === margin.orderId).map(event => event.kind)).toEqual(['created', 'filled']);
        expect(new Set(fills.map(fill => fill.fillId)).size).toBe(fills.length);
        if (risk) expect(fills[2].qty).toBeCloseTo(22 / 7, 10);
    });
});

function deferredContext(risk: boolean) {
    const context: any = new Context({ marketData: [], source: [], tickerId: 'BTCUSDT', timeframe: '60' } as any);
    context.idx = 1;
    for (const key of ['open', 'high', 'low', 'close']) context.data[key] = new Series([100, 100]);
    context.data.openTime = new Series([T0, T0 + HOUR]);
    context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } } as any;
    initializeStrategy(context, { initial_capital: 600, margin_long: 50, pyramiding: 3,
        commission_type: 'cash_per_contract', commission_value: 1 });
    if (risk) context.strategy.risk_rules.max_intraday_loss = { value: 100, type: 'cash' };
    context.strategy.pending_orders.push({ id: 'L', direction: 1, qty: 10, category: 'entry', type: 'market',
        bar: 0, time: T0, status: 'pending' });
    processStrategyOrders(context);
    context.idx = 2;
    for (const key of ['open', 'high', 'low', 'close']) context.data[key] = new Series([100, 100, 90]);
    context.data.openTime = new Series([T0, T0 + HOUR, T0 + 2 * HOUR]);
    // The deferred branch is replayed at the next parent bar while retaining
    // the preceding checkpoint's economic price/time. No extra slippage.
    context.strategy._pending_close_mc = { qty: 3, price: 90, time: T0 + HOUR, dir: 1 };
    return context;
}

describe('deferred margin-call audit', () => {
    it('audits both FIFO parents then only the surviving parent on a broker-scheduled second liquidation', () => {
        const context: any = new Context({ marketData: [], source: [], tickerId: 'BTCUSDT', timeframe: '60' } as any);
        context.pine = { syminfo: { mintick: 0.01, pointvalue: 1 } } as any;
        const setBar = (index: number, open: number, high = open, close = open) => {
            context.idx = index;
            context.data.open = new Series([open]);
            context.data.high = new Series([high]);
            context.data.low = new Series([open]);
            context.data.close = new Series([close]);
            context.data.openTime = new Series([T0 + index * HOUR]);
        };
        setBar(1, 100);
        initializeStrategy(context, { initial_capital: 2200, margin_short: 100, pyramiding: 3 });
        const queue = (id: string, qty: number) => {
            context.strategy.pending_orders.push({ id, direction: -1, qty, category: 'entry', type: 'market',
                bar: context.idx - 1, time: T0 + (context.idx - 1) * HOUR, status: 'pending' });
            processStrategyOrders(context);
        };
        queue('A', 1);
        setBar(2, 150, 200, 180);
        queue('B', 9);
        processMarginCall(context, 'extreme');
        const s = context.strategy;
        // Short 1@100 + 9@150: at 200 the equity is 1650 and margin
        // is 2000. First liquidation=4*350/200=7 (A1 + B6).
        // Deferred rule sees 350-200-100=50, so q2=4*(50/200)=1.
        expect(s.closedtrades.map(trade => trade.size)).toEqual([-1, -6]);
        expect(s.netprofit).toBe(-400);
        expect(s._pending_close_mc).toMatchObject({ qty: 1, price: 180, time: T0 + 2 * HOUR, dir: -1 });
        const [a, b, first] = s._fill_events;
        expect(first).toMatchObject({ sourceOrderId: 'Margin call', qty: 7, price: 200,
            parentOrderIds: [a.orderId, b.orderId], tradeIds: s.closedtrades.map(trade => trade.id) });
        setBar(3, 180);
        applyPendingCloseMarginCall(context);
        applyPendingCloseMarginCall(context);
        expect(s.netprofit).toBe(-430);
        expect(s.equity).toBe(1710);
        expect(s.position_size).toBe(-2);
        expect(s._fill_events).toHaveLength(4);
        expect(s._fill_events[3]).toMatchObject({ sourceOrderId: 'Margin call', qty: 1, price: 180,
            direction: 1, time: T0 + 2 * HOUR, barIndex: 3,
            parentOrderIds: [b.orderId], tradeIds: [s.closedtrades[2].id] });
        expect(s._fill_events[3].orderId).not.toBe(first.orderId);
    });

    it.each([false, true])('preserves booked time and emits once before nested risk (risk=%s)', (risk) => {
        const context = deferredContext(risk);
        applyPendingCloseMarginCall(context);
        applyPendingCloseMarginCall(context);
        const s = context.strategy;
        expect(s.closedtrades[0]).toMatchObject({ size: 3, exit_price: 90, exit_time: T0 + HOUR,
            exit_bar_index: 2, commission: 6, profit: -36 });
        expect(s.netprofit).toBe(risk ? -120 : -43);
        expect(s.equity).toBe(risk ? 480 : 487);
        expect(s.position_size).toBe(risk ? 0 : 7);
        const fills = s._fill_events;
        expect(fills.map(fill => fill.sourceOrderId)).toEqual(risk ? ['L', 'Margin call', 'risk.max_intraday_loss'] : ['L', 'Margin call']);
        expect(fills[1]).toMatchObject({ qty: 3, price: 90, time: T0 + HOUR, barIndex: 2,
            direction: -1, parentOrderIds: [fills[0].orderId], tradeIds: [s.closedtrades[0].id] });
        expect(s._order_events.filter(event => event.orderId === fills[1].orderId)).toMatchObject([
            { kind: 'created', time: T0 + HOUR, barIndex: 2 },
            { kind: 'filled', time: T0 + HOUR, barIndex: 2 },
        ]);
    });
});
