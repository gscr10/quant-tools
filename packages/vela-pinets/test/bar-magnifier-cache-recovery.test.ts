import { describe, expect, it } from 'vitest';
import type { OHLCV } from '@luxalgo/vela/plugin';
import type { BarMagnifierStatus } from 'pinets';
import { indicatorFor, LowerTimeframeFetchCache, preparePine, resolveBarMagnifier, runPineStatic } from '../src/pinets/runtime';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 1);
const SOURCE = `//@version=6
strategy('Incomplete child cache recovery', use_bar_magnifier=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
if bar_index >= 1
    strategy.exit('X', 'L', stop=95, limit=105)
`;

interface ResultContext {
    executionPrecision: BarMagnifierStatus;
    strategy: { closedtrades: Array<{ exit_price: number; profit: number }> };
}

const parents: OHLCV[] = Array.from({ length: 4 }, (_, index) => ({
    time: T0 + index * HOUR, open: 100, high: index === 2 ? 110 : 101,
    low: index === 2 ? 80 : 99, close: 100, volume: 6,
}));
const children: OHLCV[] = Array.from({ length: 24 }, (_, index) => {
    const prices = index === 12 ? [100, 101, 94, 96] : index === 13 ? [96, 110, 96, 105]
        : index === 14 ? [105, 106, 80, 100] : [100, 101, 99, 100];
    return { time: T0 + index * HOUR / 6, open: prices[0]!, high: prices[1]!,
        low: prices[2]!, close: prices[3]!, volume: 1 };
});

describe('Bar Magnifier cache recovery after broker validation', () => {
    it('does not retain a structurally valid but incomplete child window after fallback', async () => {
        const lowerTimeframeFetchCache = new LowerTimeframeFetchCache({ ttlMs: Infinity });
        let available = children.slice(0, -1);
        let calls = 0;
        const fetchSeries = async (): Promise<OHLCV[]> => { calls += 1; return available; };
        const run = async (): Promise<ResultContext> => (await runPineStatic({
            ind: indicatorFor({}, SOURCE, {}), bars: parents,
            market: { symbol: 'BTCUSDT', timeframe: '60' }, visibleRange: undefined,
            prepared: preparePine(SOURCE, 'child-recovery'), instanceId: 'child-recovery',
            inputs: {}, props: {}, fetchSeries, lowerTimeframeFetchCache,
        })).ctx as ResultContext;

        const incomplete = await run();
        expect(incomplete.executionPrecision).toMatchObject({
            requested: true, applied: false, fallbackReason: 'partial-lower-coverage',
        });
        // Parent 2 opens at 100; 110 is closer than 80, so normal OHLC hits
        // the 105 profit target before the stop. No result-derived oracle.
        expect(incomplete.strategy.closedtrades).toMatchObject([{ exit_price: 105 }]);
        expect(lowerTimeframeFetchCache.size).toBe(0);

        available = children;
        const recovered = await run();
        expect(calls).toBe(2);
        expect(recovered.executionPrecision).toMatchObject({ requested: true, applied: true, coverage: 1 });
        // Complete children reach 94 in the first child of parent 2, before
        // 110 in its second child, so the 95 stop must be first.
        expect(recovered.strategy.closedtrades).toMatchObject([{ exit_price: 95 }]);
        await run();
        expect(calls).toBe(2); // Fully validated results still benefit from caching.
    });

    it('a late failed-window disposal cannot remove the replacement request for that same range', async () => {
        const cache = new LowerTimeframeFetchCache({ ttlMs: Infinity });
        // Reusing the same array intentionally defeats a payload-identity
        // check: ownership must follow the exact request Promise instead.
        const available = children.slice(0, -1);
        let calls = 0;
        const fetchSeries = async (): Promise<OHLCV[]> => { calls += 1; return available; };
        const ind = indicatorFor({}, SOURCE, {});
        const market = { symbol: 'BTCUSDT', timeframe: '60' };
        const first = await resolveBarMagnifier(ind, parents, market, {}, fetchSeries, undefined, cache);
        expect(first.input.bars).toHaveLength(23);
        cache.clear(); // A host bars notification supersedes this request.
        available.push(children.at(-1)!);
        const replacement = await resolveBarMagnifier(ind, parents, market, {}, fetchSeries, undefined, cache);
        expect(replacement.input.bars).toHaveLength(24);
        expect(calls).toBe(2);
        first.discardCachedWindow?.(); // Old broker validation arrives late.
        expect(cache.size).toBe(1);
        const current = await resolveBarMagnifier(ind, parents, market, {}, fetchSeries, undefined, cache);
        expect(current.input.bars).toHaveLength(24);
        expect(calls).toBe(2);
        replacement.discardCachedWindow?.();
        expect(cache.size).toBe(0);
    });
});
