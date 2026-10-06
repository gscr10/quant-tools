import { describe, expect, it } from 'vitest';

import { normalizeContext } from '../src/pinets/normalizeContext';
import { toStrategyTrades } from '../src/pinets/strategyState';

function fifoContext(direction = 1) {
    return {
        strategy: {
            config: { title: 'FIFO ledger', close_entries_rule: 'FIFO' },
            position_size: direction * 5,
            opentrades: [{
                id: 'physical_A', entry_id: 'A', entry_price: 100, entry_time: 1000,
                entry_bar_index: 1, size: direction * 5, commission: 0, status: 'open',
            }],
            closedtrades: [],
            _ledger_entries: [{
                id: 'physical_B', entry_id: 'B', entry_price: 110, entry_time: 2000,
                entry_bar_index: 2, entry_comment: 'second entry', qty: 5, direction,
                commission: 0, max_runup: 50, max_drawdown: 0,
            }],
        },
    };
}

describe('open trade projection from the remaining FIFO accounting ledger', () => {
    it.each([1, -1])('projects the remaining entry with direction %s without mutating bracket lots', (direction) => {
        const context = fifoContext(direction);
        const before = structuredClone(context);
        expect(toStrategyTrades(context.strategy)).toEqual([{
            id: 'physical_B', side: direction === 1 ? 'long' : 'short', qty: 5,
            entry: { id: 'B', time: 2000, price: 110, comment: 'second entry' },
            entryBarIndex: 2, open: true, commission: 0, maxRunup: 50, maxDrawdown: 0,
        }]);
        expect(normalizeContext(context).trades).toMatchObject([{
            id: 'physical_B', entry_id: 'B', entry_price: 110, entry_time: 2000,
            size: direction * 5, status: 'open',
        }]);
        expect(context).toEqual(before);
    });

    it('keeps a remaining accounting entry split from its closed portion', () => {
        const context = fifoContext();
        const closed = {
            id: 'closed_B', entry_id: 'B', entry_price: 110, entry_time: 2000,
            size: 5, exit_price: 120, exit_time: 3000, exit_id: 'close_B',
            status: 'closed', profit: 50,
        };
        const strategy = { ...context.strategy, closedtrades: [closed] };
        const trades = toStrategyTrades(strategy);
        expect(trades.map((trade) => [trade.entry.id, trade.qty, trade.open])).toEqual([
            ['B', 5, false], ['B', 5, true],
        ]);
        expect(new Set(trades.map((trade) => trade.id)).size).toBe(2);
    });

    it('does not revive physical lots after the accounting ledger becomes empty', () => {
        const context = fifoContext();
        context.strategy.position_size = 0;
        context.strategy._ledger_entries = [];
        expect(toStrategyTrades(context.strategy)).toEqual([]);
        expect(normalizeContext(context).trades).toEqual([]);
    });

    it('disambiguates a reused physical ID from an existing closed row', () => {
        const context = fifoContext();
        const strategy = { ...context.strategy, closedtrades: [{
            id: 'physical_B', entry_id: 'prior', entry_time: 500, entry_price: 90,
            size: 5, status: 'closed', exit_price: 100, exit_time: 1000,
        }] };
        expect(toStrategyTrades(strategy).map((trade) => trade.id)).toEqual(['physical_B', 'open_physical_B']);
        expect(normalizeContext({ strategy }).trades?.map((trade) => trade.id))
            .toEqual(['physical_B', 'open_physical_B']);
    });

    it('preserves legacy engines without a separate accounting ledger', () => {
        const { _ledger_entries: omitted, ...strategy } = fifoContext().strategy;
        expect(omitted).toHaveLength(1);
        expect(toStrategyTrades(strategy)[0]).toMatchObject({ entry: { id: 'A', price: 100 }, qty: 5 });
        expect(normalizeContext({ strategy }).trades?.[0]).toMatchObject({ entry_id: 'A', entry_price: 100, size: 5 });
    });

    it('omits malformed accounting records instead of falling back to unrelated physical lots', () => {
        const strategy = { ...fifoContext().strategy, _ledger_entries: [null, {}, { qty: Number.NaN }] };
        expect(toStrategyTrades(strategy)).toEqual([]);
        expect(normalizeContext({ strategy }).trades).toEqual([]);
    });
});
