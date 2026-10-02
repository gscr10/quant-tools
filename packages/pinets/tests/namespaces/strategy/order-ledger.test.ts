import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Series } from '../../../src/Series';
import {
    initializeStrategy,
    restoreStrategyState,
    snapshotStrategyState,
} from '../../../src/namespaces/strategy/utils';
import { getStrategyLedger, recordOrderCreated, recordFillEvent } from '../../../src/namespaces/strategy/ledger';

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

describe('PineTS internal order/fill ledger', () => {
    it('records one real market order creation and fill', async () => {
        const result: any = await new PineTS(
            [bar(0, 100, 101, 99, 100), bar(1, 105, 106, 104, 105)],
            'BTCUSDT',
            '60',
        ).run(`
//@version=6
strategy('ledger market', initial_capital=1000)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
`);

        expect(result.strategy._order_events.map((event: any) => event.kind)).toEqual(['created', 'filled']);
        expect(result.strategy._order_events[0]).toMatchObject({
            kind: 'created',
            sourceOrderId: 'L',
            category: 'entry',
        });
        expect(result.strategy._order_events[1]).toMatchObject({
            kind: 'filled',
            sourceOrderId: 'L',
            // The order is queued on bar 0 but fills at the next bar's open;
            // lifecycle timestamps describe the actual transition, not the
            // original request.
            barIndex: 1,
            time: T0 + HOUR,
            fillPrice: 105,
            fillQty: 1,
        });
        expect(result.strategy._fill_events).toHaveLength(1);
        expect(result.strategy._fill_events[0]).toMatchObject({
            sourceOrderId: 'L',
            qty: 1,
            price: 105,
        });
    });

    it('keeps an unfilled limit as created-only history', async () => {
        const result: any = await new PineTS(
            [bar(0, 100, 101, 99, 100), bar(1, 105, 106, 95, 105)],
            'BTCUSDT',
            '60',
        ).run(`
//@version=6
strategy('ledger limit', initial_capital=1000)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1, limit=90)
`);

        expect(result.strategy._order_events.map((event: any) => event.kind)).toEqual(['created']);
        expect(result.strategy._fill_events).toHaveLength(0);
    });

    it('records explicit cancellation and does not fabricate a fill', async () => {
        const result: any = await new PineTS(
            [bar(0, 100, 101, 99, 100), bar(1, 105, 106, 95, 105)],
            'BTCUSDT',
            '60',
        ).run(`
//@version=6
strategy('ledger cancel', initial_capital=1000)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1, limit=90)
    strategy.cancel('L')
`);

        expect(result.strategy._order_events.map((event: any) => event.kind)).toEqual(['created', 'cancelled']);
        expect(result.strategy._order_events[1].reason).toBe('strategy.cancel');
        expect(result.strategy._fill_events).toHaveLength(0);
    });

    it('distinguishes a risk rejection from a cancellation', async () => {
        const result: any = await new PineTS(
            [bar(0, 100, 101, 99, 100), bar(1, 105, 106, 104, 105)],
            'BTCUSDT',
            '60',
        ).run(`
//@version=6
strategy('ledger reject', initial_capital=1000)
strategy.risk.allow_entry_in(strategy.short)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
`);

        expect(result.strategy._order_events.map((event: any) => event.kind)).toEqual(['created', 'rejected']);
        expect(result.strategy._order_events[1].reason).toBe('risk_rule');
        expect(result.strategy._fill_events).toHaveLength(0);
    });

    it('records an exit fill as an actual close event and links it to its parent entry', async () => {
        const result: any = await new PineTS(
            [
                bar(0, 100, 101, 99, 100),
                bar(1, 100, 111, 99, 105),
                bar(2, 110, 112, 109, 111),
            ],
            'BTCUSDT',
            '60',
        ).run(`
//@version=6
strategy('ledger exit', initial_capital=1000)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if strategy.position_size > 0
    strategy.exit('X', 'L', limit=110)
`);

        expect(result.strategy._order_events.map((event: any) => event.kind)).toEqual([
            'created', 'filled', 'created', 'filled',
        ]);
        expect(result.strategy._fill_events).toHaveLength(2);
        expect(result.strategy._fill_events[1]).toMatchObject({
            sourceOrderId: 'X',
            direction: -1,
            qty: 1,
            price: 110,
            parentOrderIds: [result.strategy._order_events[0].orderId],
            requestedQty: 1,
            cumulativeQty: 1,
            remainingQty: 0,
            fillSequence: 1,
            isPartial: false,
        });
        expect(result.strategy._order_events[3]).toMatchObject({
            parentOrderIds: [result.strategy._order_events[0].orderId],
            requestedQty: 1,
            cumulativeFillQty: 1,
            remainingQty: 0,
            fillSequence: 1,
            isPartial: false,
        });
    });

    it('links a reversal fill to the source order and physical trade lot', async () => {
        const result: any = await new PineTS(
            [
                bar(0, 100, 101, 99, 100),
                bar(1, 105, 106, 104, 105),
                bar(2, 95, 96, 94, 95),
            ],
            'BTCUSDT',
            '60',
        ).run(`
//@version=6
strategy('ledger reversal', initial_capital=100000)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=2)
if bar_index == 1
    strategy.entry('S', strategy.short, qty=1)
`);

        const created = result.strategy._order_events.filter((event: any) => event.kind === 'created');
        const filled = result.strategy._order_events.filter((event: any) => event.kind === 'filled');
        const sourceTradeId = result.strategy._fill_events[0].tradeIds[0];
        expect(filled).toHaveLength(2);
        expect(filled[1]).toMatchObject({
            sourceOrderId: 'S',
            reversalOfOrderId: created[0].orderId,
            reversalOfTradeIds: [sourceTradeId],
            parentOrderIds: [created[0].orderId],
        });
        expect(result.strategy._fill_events[1]).toMatchObject({
            sourceOrderId: 'S',
            reversalOfOrderId: created[0].orderId,
            reversalOfTradeIds: [sourceTradeId],
            parentOrderIds: [created[0].orderId],
        });
    });

    it('records actual multi-leg exit progress as partial then complete fills', async () => {
        const result: any = await new PineTS(
            [
                bar(0, 100, 101, 99, 100),
                bar(1, 100, 111, 99, 105),
                bar(2, 110, 112, 109, 111),
            ],
            'BTCUSDT',
            '60',
        ).run(`
//@version=6
strategy('ledger partial', initial_capital=100000, pyramiding=2)
if bar_index == 0
    strategy.entry('L1', strategy.long, qty=1)
if bar_index == 1
    strategy.entry('L2', strategy.long, qty=1)
if strategy.position_size > 0
    strategy.exit('X', '', qty=2, profit=5)
`);

        const fills = result.strategy._fill_events.filter((event: any) => event.sourceOrderId === 'X');
        expect(fills.length).toBeGreaterThanOrEqual(2);
        expect(fills[0]).toMatchObject({
            requestedQty: 2,
            cumulativeQty: 1,
            remainingQty: 1,
            fillSequence: 1,
            isPartial: true,
        });
        expect(fills[1]).toMatchObject({
            requestedQty: 2,
            cumulativeQty: 2,
            remainingQty: 0,
            fillSequence: 2,
            isPartial: false,
        });
        expect(fills[0].parentOrderIds).toEqual(fills[1].parentOrderIds);
        expect(fills[0].parentOrderIds).toHaveLength(2);
    });

    it('keeps internal order identities unique when Pine reuses an order id', async () => {
        const result: any = await new PineTS(
            [bar(0, 100, 101, 99, 100), bar(1, 105, 106, 104, 105), bar(2, 110, 111, 109, 110)],
            'BTCUSDT',
            '60',
        ).run(`
//@version=6
strategy('ledger ids', initial_capital=100000, pyramiding=2)
if bar_index < 2
    strategy.order('same', strategy.long, qty=1)
`);

        const created = result.strategy._order_events.filter((event: any) => event.kind === 'created');
        expect(created).toHaveLength(2);
        expect(new Set(created.map((event: any) => event.orderId)).size).toBe(2);
        expect(new Set(result.strategy._fill_events.map((event: any) => event.orderId)).size).toBe(2);
    });

    it('rolls back ledger arrays and sequence with the strategy snapshot', () => {
        const context: any = {
            idx: 0,
            data: { openTime: new Series([T0]) },
            strategy: undefined,
        };
        initializeStrategy(context, { initial_capital: 1000 });
        const order: any = {
            id: 'L', direction: 1, qty: 1, type: 'market',
            bar: 0, time: T0, status: 'pending', category: 'entry',
        };
        context.strategy.pending_orders.push(order);
        recordOrderCreated(context, order);
        const snapshot = snapshotStrategyState(context.strategy);
        const before = JSON.stringify({
            orders: context.strategy._order_events,
            fills: context.strategy._fill_events,
            sequence: context.strategy._ledger_sequence,
        });

        // Simulate a discarded forming-bar execution.
        recordFillEvent(context, order, { price: 100, qty: 1, direction: 1 });
        context.strategy._ledger_sequence = 999;
        restoreStrategyState(context.strategy, snapshot);

        expect(JSON.stringify({
            orders: context.strategy._order_events,
            fills: context.strategy._fill_events,
            sequence: context.strategy._ledger_sequence,
        })).toBe(before);
    });

    it('returns an immutable ledger snapshot instead of live broker buffers', () => {
        const context: any = {
            idx: 0,
            data: { openTime: new Series([T0]) },
            strategy: undefined,
        };
        initializeStrategy(context, { initial_capital: 1000 });
        const order: any = {
            id: 'L', direction: 1, qty: 1, type: 'market',
            bar: 0, time: T0, status: 'pending', category: 'entry',
        };
        context.strategy.pending_orders.push(order);
        recordOrderCreated(context, order);
        recordFillEvent(context, order, { price: 100, qty: 1, direction: 1, tradeIds: ['trade_1'] });

        const snapshot = getStrategyLedger(context.strategy)!;
        expect(snapshot.orderEvents).not.toBe(context.strategy._order_events);
        expect(snapshot.fillEvents).not.toBe(context.strategy._fill_events);
        expect(Object.isFrozen(snapshot.orderEvents)).toBe(true);
        expect(Object.isFrozen(snapshot.orderEvents[0])).toBe(true);
        expect(Object.isFrozen(snapshot.fillEvents[0]!.tradeIds)).toBe(true);
        expect(() => (snapshot.orderEvents as unknown as unknown[]).push({})).toThrow();

        // A later broker append does not alter the previously returned view.
        recordOrderCreated(context, {
            id: 'L2', direction: 1, qty: 1, type: 'market',
            bar: 0, time: T0, status: 'pending', category: 'entry',
        });
        expect(snapshot.orderEvents).toHaveLength(1);
        expect(context.strategy._order_events).toHaveLength(2);
    });
});
