import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const T0 = Date.UTC(2024, 0, 1);
const HOUR = 3_600_000;
const CHILD = 600_000;
const bars = (duration: number, count: number) => Array.from({ length: count }, (_, i) => ({
    openTime: T0 + i * duration, closeTime: T0 + (i + 1) * duration - 1,
    open: 100, high: 100, low: 100, close: 100, volume: 1,
}));

describe.each([false, true])('entry-only risk controls (magnified=%s)', (magnified) => {
    async function run(body: string) {
        const result = await new PineTS(bars(HOUR, 4), 'BTCUSDT', '60', undefined, undefined, undefined,
            magnified ? { barMagnifier: { requested: true, lowerTimeframe: '10', bars: bars(CHILD, 24) } } : undefined)
            .run(`//@version=6
strategy('entry risk controls', initial_capital=1000, pyramiding=10,
    commission_type=strategy.commission.cash_per_contract, commission_value=0.5)
${body}`);
        expect(result.executionPrecision.applied).toBe(magnified);
        if (magnified) expect(result.executionPrecision.coverage).toBe(1);
        expect(result.strategy.pending_orders).toHaveLength(0);
        return result.strategy;
    }

    it('reduces a requested entry to the maximum position instead of rejecting the whole order', async () => {
        const s = await run(`strategy.risk.max_position_size(2)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=3)`);
        expect(s.position_size).toBe(2);
        expect(s.opentrades).toMatchObject([{ entry_id: 'L', size: 2 }]);
        expect(s.equity).toBe(999); // Two contracts, entry fee 0.5 each.
        expect(s._fill_events).toMatchObject([{ sourceOrderId: 'L', qty: 2 }]);
    });

    it('caps successive queued entries against the position actually left by earlier fills', async () => {
        const s = await run(`strategy.risk.max_position_size(3)
if bar_index == 0
    strategy.entry('A', strategy.long, qty=2)
    strategy.entry('B', strategy.long, qty=2)
    strategy.entry('C', strategy.long, qty=2)`);
        expect(s.position_size).toBe(3);
        expect(s._fill_events?.map(fill => [fill.sourceOrderId, fill.qty])).toEqual([['A', 2], ['B', 1]]);
        expect(s.equity).toBe(998.5);
        expect(s._order_events).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceOrderId: 'C', kind: 'rejected', reason: 'risk_rule' }),
        ]));
    });

    it('caps an opposite entry open leg while still closing the complete previous position', async () => {
        const s = await run(`strategy.risk.max_position_size(3)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=2)
if bar_index == 1
    strategy.entry('S', strategy.short, qty=4)`);
        // Buy 2, then sell 5 = close 2 + open short 3; 7 filled contracts.
        expect(s.position_size).toBe(-3);
        expect(s._fill_events?.map(fill => [fill.sourceOrderId, fill.qty])).toEqual([['L', 2], ['S', 5]]);
        expect(s.closedtrades).toMatchObject([{ entry_id: 'L', exit_id: 'S', size: 2 }]);
        expect(s.equity).toBe(996.5);
    });

    it('projects capped orders before sizing several same-bar reversals', async () => {
        const s = await run(`strategy.risk.max_position_size(2)
if bar_index == 0
    strategy.entry('A', strategy.long, qty=3)
    strategy.entry('B', strategy.short, qty=1)
    strategy.entry('C', strategy.long, qty=1)`);
        // Accepted position path: +2 -> -1 -> +1, hence fills 2,3,2.
        expect(s._fill_events?.map(fill => [fill.sourceOrderId, fill.qty])).toEqual([['A', 2], ['B', 3], ['C', 2]]);
        expect(s.position_size).toBe(1);
        expect(s.closedtrades.map(trade => trade.size)).toEqual([2, -1]);
        expect(s.equity).toBe(996.5);
    });

    it('checks the cap when multiple conditional entries actually fill', async () => {
        const s = await run(`strategy.risk.max_position_size(3)
if bar_index == 0
    strategy.entry('A', strategy.long, qty=2, limit=100)
    strategy.entry('B', strategy.long, qty=2, limit=100)`);
        expect(s.position_size).toBe(3);
        expect(s._fill_events?.map(fill => fill.qty)).toEqual([2, 1]);
    });

    it('bypasses the entry size cap for strategy.order', async () => {
        const s = await run(`strategy.risk.max_position_size(2)
if bar_index == 0
    strategy.order('uncapped', strategy.long, qty=3)`);
        expect(s.position_size).toBe(3);
        expect(s.equity).toBe(998.5);
        expect(s._fill_events).toMatchObject([{ sourceOrderId: 'uncapped', qty: 3 }]);
    });

    it('includes queued strategy.order exposure when sizing a capped entry reversal', async () => {
        const s = await run(`strategy.risk.max_position_size(2)
if bar_index == 0
    strategy.order('uncapped', strategy.long, qty=4)
    strategy.entry('S', strategy.short, qty=1)`);
        expect(s.position_size).toBe(-1);
        expect(s._fill_events?.map(fill => fill.qty)).toEqual([4, 5]);
        expect(s.equity).toBe(995.5);
    });

    it.each(['long', 'short'])('a denied opposing entry closes the allowed %s position without reversing', async (allowed) => {
        const denied = allowed === 'long' ? 'short' : 'long';
        const s = await run(`strategy.risk.allow_entry_in(strategy.direction.${allowed})
if bar_index == 0
    strategy.entry('A', strategy.${allowed}, qty=2)
if bar_index == 1
    strategy.entry('B', strategy.${denied}, qty=1)`);
        expect(s.position_size).toBe(0);
        expect(s.opentrades).toHaveLength(0);
        expect(s.closedtrades).toMatchObject([{ entry_id: 'A', exit_id: 'B', size: allowed === 'long' ? 2 : -2 }]);
        expect(s._fill_events?.map(fill => fill.qty)).toEqual([2, 2]);
        expect(s.equity).toBe(998);
    });

    it('does not turn subsequent denied entries into new positions after a queued close-only entry', async () => {
        const s = await run(`strategy.risk.allow_entry_in(strategy.direction.long)
if bar_index == 0
    strategy.entry('L', strategy.long, qty=2)
    strategy.entry('close', strategy.short, qty=1)
    strategy.entry('denied', strategy.short, qty=2)`);
        expect(s.position_size).toBe(0);
        expect(s._fill_events?.map(fill => [fill.sourceOrderId, fill.qty])).toEqual([['L', 2], ['close', 2]]);
        expect(s.equity).toBe(998);
    });

    it('does not open a denied entry when the account is flat', async () => {
        const s = await run(`strategy.risk.allow_entry_in(strategy.direction.long)
if bar_index == 0
    strategy.entry('denied', strategy.short, qty=2)`);
        expect(s.position_size).toBe(0);
        expect(s._fill_events).toHaveLength(0);
        expect(s.equity).toBe(1000);
    });

    it('does not apply either entry restriction to strategy.order', async () => {
        const s = await run(`strategy.risk.allow_entry_in(strategy.direction.long)
strategy.risk.max_position_size(2)
if bar_index == 0
    strategy.order('S', strategy.short, qty=3)`);
        expect(s.position_size).toBe(-3);
        expect(s._fill_events).toMatchObject([{ sourceOrderId: 'S', qty: 3 }]);
        expect(s.equity).toBe(998.5);
    });

    it('keeps an account-wide filled-order halt effective for both entry and order', async () => {
        const s = await run(`strategy.risk.allow_entry_in(strategy.direction.long)
strategy.risk.max_position_size(2)
strategy.risk.max_intraday_filled_orders(1)
if bar_index == 0
    strategy.order('first', strategy.long, qty=3)
    strategy.order('blocked-order', strategy.long, qty=1)
    strategy.entry('blocked-entry', strategy.long, qty=1)`);
        expect(s.position_size).toBe(0);
        expect(s._fill_events?.map(fill => fill.sourceOrderId)).toEqual(['first', 'risk.max_intraday_filled_orders']);
        expect(s.equity).toBe(997); // Three contracts in and out, 0.5 per side.
    });
});
